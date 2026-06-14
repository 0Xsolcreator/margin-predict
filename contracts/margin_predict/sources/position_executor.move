/// Keeper-signed execution for the open, close, and settle lifecycles.
/// Liquidation execution lives in `position_liquidator`.
module margin_predict::position_executor;

use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock::Clock;
use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::predict_manager::{Self, PredictManager};
use deepbook_predict::oracle::OracleSVI;
use deepbook_predict::market_key::MarketKey;
use margin_predict::types;
use margin_predict::margin_position::{Self, MarginPosition};

// === Errors ===
const EZeroAmount: u64       = 0;
const EWrongStatus: u64      = 1;
const EOracleNotSettled: u64 = 2;

// === Constants ===
const PROBE_QUANTITY: u64    = 1_000_000; // $1 notional (6-decimal DUSDC)
const SIZING_ITERATIONS: u64 = 4;

// === Open: step 1 ===

/// Withdraws the owner's escrowed SUI so the keeper can deposit it into
/// DeepBook Margin and borrow DBUSDC. Call `deploy_position` after the swap.
public fun take_escrow<T>(
    pos: &mut MarginPosition<T>,
    manager: &PredictManager,
    ctx: &mut TxContext,
): Coin<SUI> {
    margin_position::assert_keeper(pos, manager, ctx);
    coin::from_balance(margin_position::take_escrow(pos), ctx)
}

// === Open: step 2 ===

/// Sizes and mints the Predict position from `collateral` (the keeper's
/// swapped DBUSDC borrow), then confirms the position as OPEN.
public fun deploy_position<T>(
    pos: &mut MarginPosition<T>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    collateral: Coin<T>,
    margin_manager_id: ID,
    margin_debt: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    margin_position::assert_keeper(pos, manager, ctx);

    let (market_key_val, leverage_bps_val) = {
        let intent = margin_position::pending_intent(pos).borrow();
        (*types::intent_market_key(intent).borrow(), types::intent_leverage_bps(intent))
    };

    let total_amount = collateral.value();
    predict_manager::deposit<T>(manager, collateral, ctx);

    let quantity = size_position(predict, oracle, market_key_val, total_amount, clock);
    assert!(quantity > 0, EZeroAmount);
    predict::mint<T>(predict, manager, oracle, market_key_val, quantity, clock, ctx);

    margin_position::confirm_open(
        pos,
        types::new_snapshot(market_key_val, quantity, leverage_bps_val, clock.timestamp_ms()),
        margin_manager_id,
        margin_debt,
    );
}

// === Close ===

/// Redeems the full position and marks it CLOSED.
/// Returns `Coin<T>` proceeds for the keeper to swap, repay debt, and
/// forward the net to the owner.
public fun execute_close<T>(
    pos: &mut MarginPosition<T>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    margin_position::assert_keeper(pos, manager, ctx);
    assert!(margin_position::status(pos) == margin_position::status_open(), EWrongStatus);
    let proceeds = redeem_full_position(pos, predict, manager, oracle, clock, ctx);
    margin_position::confirm_close(pos);
    proceeds
}

// === Settle (post-expiry) ===

/// Same as `execute_close` but requires the oracle to have settled.
public fun execute_settle<T>(
    pos: &mut MarginPosition<T>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    margin_position::assert_keeper(pos, manager, ctx);
    assert!(oracle.is_settled(), EOracleNotSettled);
    assert!(margin_position::status(pos) == margin_position::status_open(), EWrongStatus);
    let proceeds = redeem_full_position(pos, predict, manager, oracle, clock, ctx);
    margin_position::confirm_settle(pos);
    proceeds
}

// === Package-internal helpers ===

/// Redeems `quantity` of `market_key` and returns the payout amount measured
/// via the manager balance delta (since `redeem` does not return it directly).
public(package) fun redeem_quantity<T>(
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    market_key: MarketKey,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    let before = manager.balance<T>();
    predict::redeem<T>(predict, manager, oracle, market_key, quantity, clock, ctx);
    manager.balance<T>() - before
}

fun redeem_full_position<T>(
    pos: &MarginPosition<T>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    let snap = *margin_position::position(pos).borrow();
    let proceeds = redeem_quantity<T>(
        predict, manager, oracle,
        types::snapshot_market_key(&snap),
        types::snapshot_quantity(&snap),
        clock, ctx,
    );
    predict_manager::withdraw<T>(manager, proceeds, ctx)
}

/// Binary-searches for the largest `quantity` whose mint cost fits within
/// `budget`, probing `predict::get_trade_amounts`.
fun size_position(
    predict: &Predict,
    oracle: &OracleSVI,
    key: MarketKey,
    budget: u64,
    clock: &Clock,
): u64 {
    let (probe_cost, _) = predict::get_trade_amounts(predict, oracle, key, PROBE_QUANTITY, clock);
    assert!(probe_cost > 0, EZeroAmount);
    let mut quantity = (((budget as u128) * (PROBE_QUANTITY as u128) / (probe_cost as u128)) as u64);
    let mut i = 0;
    while (i < SIZING_ITERATIONS) {
        let (cost, _) = predict::get_trade_amounts(predict, oracle, key, quantity, clock);
        if (cost <= budget || cost == 0) { break };
        quantity = (((quantity as u128) * (budget as u128) / (cost as u128)) as u64);
        i = i + 1;
    };
    quantity
}
