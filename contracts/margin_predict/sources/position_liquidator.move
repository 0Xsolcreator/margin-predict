/// Keeper-signed liquidation logic.
/// Flagging is permissionless; execution is keeper-only.
module margin_predict::position_liquidator;

use sui::coin::{Self, Coin};
use sui::clock::Clock;
use deepbook_predict::predict::Predict;
use deepbook_predict::predict_manager::{Self, PredictManager};
use deepbook_predict::oracle::OracleSVI;
use margin_predict::types;
use margin_predict::margin_position::{Self, MarginPosition};
use margin_predict::position_manager::health_factor;
use margin_predict::position_executor::redeem_quantity;

// === Errors ===
const ENotLiquidatable: u64 = 0;
const ENoFlag: u64          = 1;

// === Constants ===
const BPS: u64                   = 10_000;
const HF_HARD_BPS: u64           = 10_000;  // ≤ 1.00x → hard liquidation
const HF_SOFT_BPS: u64           = 10_500;  // ≤ 1.05x → soft liquidation
const SOFT_LIQ_FRACTION_BPS: u64 = 2_500;   // 25 % closed per soft liquidation
const LIQ_REPORTER_BPS: u64      = 200;      // 2 % of proceeds to the reporter

// === Permissionless: flag ===

/// Flags a position whose health factor has dropped to or below `HF_SOFT_BPS`.
/// First caller earns `LIQ_REPORTER_BPS` (2 %) of the eventual liquidation proceeds.
public fun flag_for_liquidation<T>(
    pos: &mut MarginPosition<T>,
    predict: &Predict,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &TxContext,
) {
    let hf = health_factor(pos, predict, oracle, clock);
    assert!(hf <= HF_SOFT_BPS, ENotLiquidatable);
    let mode = if (hf <= HF_HARD_BPS) { types::liq_hard() } else { types::liq_soft() };
    margin_position::set_liquidation_flag(pos, ctx.sender(), mode, clock);
}

// === Keeper-signed: execute ===

/// Executes a previously-flagged liquidation.
///
/// Re-checks the health factor first. If the position recovered above
/// `HF_SOFT_BPS`, clears the flag and returns a zero coin (no action taken).
///
/// - Hard (hf ≤ 1.00x): closes the full position → `LIQUIDATED`.
/// - Soft (hf ≤ 1.05x): closes 25 % of the position, reduces margin debt
///   proportionally, leaves the position `OPEN`.
///
/// `LIQ_REPORTER_BPS` (2 %) of proceeds are transferred to the flag's reporter.
/// The remainder is returned to the keeper to unwind the margin debt.
public fun execute_liquidation<T>(
    pos: &mut MarginPosition<T>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    margin_position::assert_keeper(pos, manager, ctx);
    assert!(margin_position::liquidation_flag(pos).is_some(), ENoFlag);

    let hf = health_factor(pos, predict, oracle, clock);
    if (hf > HF_SOFT_BPS) {
        margin_position::clear_liquidation_flag(pos);
        return coin::zero<T>(ctx)
    };

    let reporter      = types::flag_reporter(margin_position::liquidation_flag(pos).borrow());
    let snap          = *margin_position::position(pos).borrow();
    let quantity      = types::snapshot_quantity(&snap);
    let debt          = margin_position::margin_debt(pos);
    let is_hard       = hf <= HF_HARD_BPS;
    let close_quantity = compute_close_quantity(quantity, is_hard);
    let full_close    = close_quantity == quantity;

    let proceeds = redeem_quantity<T>(
        predict, manager, oracle,
        types::snapshot_market_key(&snap),
        close_quantity, clock, ctx,
    );
    let mut proceeds_coin = predict_manager::withdraw<T>(manager, proceeds, ctx);

    let reporter_cut = (((proceeds as u128) * (LIQ_REPORTER_BPS as u128) / (BPS as u128)) as u64);
    transfer::public_transfer(proceeds_coin.split(reporter_cut, ctx), reporter);

    if (full_close) {
        margin_position::apply_hard_liquidation(pos);
    } else {
        let new_debt = (((debt as u128) * ((BPS - SOFT_LIQ_FRACTION_BPS) as u128) / (BPS as u128)) as u64);
        margin_position::apply_soft_liquidation(pos, quantity - close_quantity, new_debt);
    };

    proceeds_coin
}

// === Internal ===

fun compute_close_quantity(quantity: u64, is_hard: bool): u64 {
    if (is_hard) return quantity;
    let partial = (((quantity as u128) * (SOFT_LIQ_FRACTION_BPS as u128) / (BPS as u128)) as u64);
    if (partial == 0) { quantity } else { partial }
}
