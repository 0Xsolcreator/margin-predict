/// Owner-facing entry points and the read-only health factor query.
/// Keeper execution lives in `position_executor` and `position_liquidator`.
module margin_predict::position_manager;

use sui::coin::Coin;
use sui::sui::SUI;
use sui::clock::Clock;
use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::oracle::OracleSVI;
use deepbook_predict::market_key::MarketKey;
use margin_predict::types;
use margin_predict::margin_position::{Self, MarginPosition};

// === Errors ===
const EZeroAmount: u64      = 0;
const EInvalidLeverage: u64 = 1;
const EWrongStatus: u64     = 2;

// === Constants ===
const BPS: u64              = 10_000;
const MIN_LEVERAGE_BPS: u64 = 11_000; // 1.10x — post-withdraw ratio 10.0
const MAX_LEVERAGE_BPS: u64 = 14_000; // 1.40x — post-withdraw ratio  2.5
const CANCEL_TIMEOUT_MS: u64 = 120_000;
const HF_INFINITE: u64      = 18_446_744_073_709_551_615; // u64::MAX (no debt)

// === Owner-signed mutations ===

/// Creates a `MarginPosition` in `PENDING_OPEN`, escrowing `payment` (SUI)
/// and recording the desired leverage and market.
public fun request_open<T>(
    predict_manager_id: ID,
    leverage_bps: u64,
    market_key: MarketKey,
    payment: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(payment.value() > 0, EZeroAmount);
    assert!(
        leverage_bps >= MIN_LEVERAGE_BPS && leverage_bps <= MAX_LEVERAGE_BPS,
        EInvalidLeverage,
    );
    margin_position::share(margin_position::new<T>(
        ctx.sender(),
        predict_manager_id,
        leverage_bps,
        market_key,
        payment,
        clock,
        ctx,
    ));
}

/// Records a close intent on an open position.
public fun request_close<T>(pos: &mut MarginPosition<T>, clock: &Clock, ctx: &TxContext) {
    margin_position::assert_owner(pos, ctx.sender());
    margin_position::request_close(pos, clock);
}

/// Cancels a pending intent the keeper hasn't executed within `CANCEL_TIMEOUT_MS`,
/// returning any escrowed SUI to the owner.
public fun cancel_intent<T>(
    pos: &mut MarginPosition<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<SUI> {
    margin_position::assert_owner(pos, ctx.sender());
    margin_position::cancel_intent(pos, CANCEL_TIMEOUT_MS, clock, ctx)
}

// === Read-only ===

/// Position mark value divided by recorded margin debt, in bps.
/// Returns `HF_INFINITE` (u64::MAX) when the position carries no debt.
public fun health_factor<T>(
    pos: &MarginPosition<T>,
    predict: &Predict,
    oracle: &OracleSVI,
    clock: &Clock,
): u64 {
    assert!(margin_position::status(pos) == margin_position::status_open(), EWrongStatus);
    let snap = *margin_position::position(pos).borrow();
    let (_, mark_value) = predict::get_trade_amounts(
        predict, oracle,
        types::snapshot_market_key(&snap),
        types::snapshot_quantity(&snap),
        clock,
    );
    let debt = margin_position::margin_debt(pos);
    if (debt == 0) {
        HF_INFINITE
    } else {
        (((mark_value as u128) * (BPS as u128) / (debt as u128)) as u64)
    }
}
