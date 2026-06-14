/// Entry-point module. Wires `margin_position` together with DeepBook Predict
/// (`predict`, `predict_manager`, `oracle`) to open, close, settle, and
/// liquidate leveraged binary/range positions.
///
/// The leveraged top-up comes from DeepBook Margin (SUI/DBUSDC): the keeper
/// deposits the user's escrowed SUI as collateral, borrows DBUSDC against it,
/// swaps it to `T` off-chain, then deploys it into a Predict position.
///
/// Two-phase request/execute pattern:
///   Owner-signed:  `request_open`, `request_close`, `cancel_intent`
///   Keeper-signed: `take_escrow` + `deploy_position`, `execute_close`,
///                  `execute_settle`, `flag_for_liquidation` + `execute_liquidation`
///
/// Opening is split into two keeper calls so a PTB can interleave the
/// DeepBook Margin deposit/borrow and DBUSDC → `T` swap between them:
///   1. `take_escrow` — returns the escrowed SUI as `Coin<SUI>`.
///   2. (PTB: deposit SUI into `MarginManager`, borrow DBUSDC `B`, swap `B` → `T`.)
///   3. `deploy_position` — sizes/mints the Predict position from `Coin<T>` and
///      confirms the account as OPEN, recording the `MarginManager` id and `B`.
module margin_predict::position_manager;

use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock::Clock;

use deepbook_predict::predict::{Self, Predict};
use deepbook_predict::predict_manager::{Self, PredictManager};
use deepbook_predict::oracle::OracleSVI;
use deepbook_predict::market_key::MarketKey;

use margin_predict::margin_position::{Self, MarginPosition};

// === Errors ===
const EZeroAmount: u64 = 0;
const EInvalidLeverage: u64 = 1;
const ENotKeeper: u64 = 2;
const EWrongManager: u64 = 3;
const EWrongStatus: u64 = 4;
const ENotLiquidatable: u64 = 5;
const EOracleNotSettled: u64 = 6;

// === Constants ===
const BPS: u64 = 10_000;

/// DeepBook Margin's minimum withdraw risk ratio (2.0: assets ≥ 2 × debt)
/// bounds how much of the deposited collateral's borrowing power can be
/// redeployed. With collateral `C` and borrow `B`, the post-withdraw ratio
/// is `C / B ≥ 2.0`, so `B ≤ 0.5 × C` and the achievable leverage
/// `L = (C + B) / C ≤ 1.5x`. The bounds below stay inside that ceiling.
const MIN_LEVERAGE_BPS: u64 = 11_000; // 1.10x — post-withdraw ratio 10.0
const MAX_LEVERAGE_BPS: u64 = 14_000; // 1.40x — post-withdraw ratio  2.5

/// How long the owner must wait for the keeper to act before `cancel_intent`
/// becomes callable.
const CANCEL_TIMEOUT_MS: u64 = 120_000; // 2 minutes

/// Notional (6 decimals, DUSDC) used to probe the current ask price when
/// sizing a new position.
const PROBE_QUANTITY: u64 = 1_000_000; // $1
const SIZING_ITERATIONS: u64 = 4;

// === Health-factor thresholds (bps, 10_000 == 1.00) ===
const HF_HARD_BPS: u64 = 10_000;  // ≤ 1.00x → hard liquidation
const HF_SOFT_BPS: u64 = 10_500;  // ≤ 1.05x → soft liquidation
const HF_INFINITE: u64 = 18_446_744_073_709_551_615; // u64::MAX, no debt

const SOFT_LIQ_FRACTION_BPS: u64 = 2_500;  // 25% closed per soft liquidation
const LIQ_REPORTER_BPS: u64 = 200;          // 2% of proceeds to the reporter

// === Owner-signed: request mutations ===

/// Creates a new `MarginPosition` in `PENDING_OPEN`, escrowing `payment` (SUI)
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
    assert!(leverage_bps >= MIN_LEVERAGE_BPS && leverage_bps <= MAX_LEVERAGE_BPS, EInvalidLeverage);
    let pos = margin_position::new<T>(
        ctx.sender(),
        predict_manager_id,
        leverage_bps,
        market_key,
        payment,
        clock,
        ctx,
    );
    margin_position::share(pos);
}

/// Records a close intent on an open position.
public fun request_close<T>(pos: &mut MarginPosition<T>, clock: &Clock, ctx: &TxContext) {
    margin_position::assert_owner(pos, ctx.sender());
    margin_position::request_close(pos, clock);
}

/// Cancels a pending intent the keeper hasn't executed within
/// `CANCEL_TIMEOUT_MS`, returning any escrowed SUI to the owner.
public fun cancel_intent<T>(
    pos: &mut MarginPosition<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<SUI> {
    margin_position::assert_owner(pos, ctx.sender());
    margin_position::cancel_intent(pos, CANCEL_TIMEOUT_MS, clock, ctx)
}

// === Internal keeper guards ===

fun assert_keeper<T>(pos: &MarginPosition<T>, manager: &PredictManager, ctx: &TxContext) {
    assert!(object::id(manager) == margin_position::predict_manager_id(pos), EWrongManager);
    assert!(manager.owner() == ctx.sender(), ENotKeeper);
}

/// Binary-searches (by linear rescaling) for the largest `quantity` whose
/// mint cost fits within `budget`, probing `predict::get_trade_amounts`.
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

// === Keeper-signed: open (two steps) ===

/// Step 1 — Withdraws the owner's escrowed SUI for the keeper to deposit into
/// DeepBook Margin and borrow DBUSDC against before calling `deploy_position`.
public fun take_escrow<T>(
    pos: &mut MarginPosition<T>,
    manager: &PredictManager,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert_keeper(pos, manager, ctx);
    coin::from_balance(margin_position::take_escrow(pos), ctx)
}

/// Step 2 — Sizes and mints the Predict position from `collateral` (the
/// keeper's swapped borrow `B`), then confirms the position as OPEN.
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
    assert_keeper(pos, manager, ctx);

    let (leverage_bps, market_key) = {
        let intent = margin_position::pending_intent(pos).borrow();
        let market_key = *margin_position::intent_market_key(intent).borrow();
        (margin_position::intent_leverage_bps(intent), market_key)
    };

    let total_amount = collateral.value();
    predict_manager::deposit<T>(manager, collateral, ctx);

    let quantity = size_position(predict, oracle, market_key, total_amount, clock);
    assert!(quantity > 0, EZeroAmount);

    predict::mint<T>(predict, manager, oracle, market_key, quantity, clock, ctx);

    let snapshot = margin_position::new_snapshot(market_key, quantity, leverage_bps, clock.timestamp_ms());
    margin_position::confirm_open(pos, snapshot, margin_manager_id, margin_debt);
}

// === Keeper-signed: close ===

/// Redeems the full position and returns `Coin<T>` proceeds for the keeper to
/// swap back to DBUSDC, repay the margin debt, and forward the net to the owner.
public fun execute_close<T>(
    pos: &mut MarginPosition<T>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    assert_keeper(pos, manager, ctx);
    assert!(margin_position::status(pos) == margin_position::status_open(), EWrongStatus);
    let proceeds = redeem_full_position(pos, predict, manager, oracle, clock, ctx);
    margin_position::confirm_close(pos);
    proceeds
}

// === Keeper-signed: settle (post-expiry) ===

/// Redeems the full position against a settled oracle and returns `Coin<T>`
/// proceeds for the keeper to unwind the margin debt and forward to the owner.
public fun execute_settle<T>(
    pos: &mut MarginPosition<T>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    assert_keeper(pos, manager, ctx);
    assert!(oracle.is_settled(), EOracleNotSettled);
    assert!(margin_position::status(pos) == margin_position::status_open(), EWrongStatus);
    let proceeds = redeem_full_position(pos, predict, manager, oracle, clock, ctx);
    margin_position::confirm_settle(pos);
    proceeds
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
    let market_key = margin_position::snapshot_market_key(&snap);
    let quantity = margin_position::snapshot_quantity(&snap);
    let proceeds = redeem_position<T>(predict, manager, oracle, market_key, quantity, clock, ctx);
    predict_manager::withdraw<T>(manager, proceeds, ctx)
}

/// Redeems `quantity` of `market_key` and returns the payout amount (measured
/// via the manager's balance delta, since `redeem` doesn't return it directly).
fun redeem_position<T>(
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

// === Health factor (read-only) ===

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
        margin_position::snapshot_market_key(&snap),
        margin_position::snapshot_quantity(&snap),
        clock,
    );
    let debt = margin_position::margin_debt(pos);
    if (debt == 0) {
        HF_INFINITE
    } else {
        (((mark_value as u128) * (BPS as u128) / (debt as u128)) as u64)
    }
}

// === Liquidation ===

/// Permissionless: flags a position whose health factor has dropped to or
/// below `HF_SOFT_BPS`. First reporter earns `LIQ_REPORTER_BPS` on execution.
public fun flag_for_liquidation<T>(
    pos: &mut MarginPosition<T>,
    predict: &Predict,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &TxContext,
) {
    let hf = health_factor(pos, predict, oracle, clock);
    assert!(hf <= HF_SOFT_BPS, ENotLiquidatable);
    let mode = if (hf <= HF_HARD_BPS) { margin_position::liq_hard() } else { margin_position::liq_soft() };
    margin_position::set_liquidation_flag(pos, ctx.sender(), mode, clock);
}

/// Keeper-signed: executes a previously-flagged liquidation.
///
/// Re-checks the health factor first. If the position has recovered above
/// `HF_SOFT_BPS`, the flag is cleared and a zero coin is returned (no action).
///
/// - Hard (hf ≤ 1.00x): closes the full position → `LIQUIDATED`.
/// - Soft (hf ≤ 1.05x): closes `SOFT_LIQ_FRACTION_BPS` (25%) of the position,
///   reduces margin debt proportionally, leaves the position `OPEN`.
///
/// `LIQ_REPORTER_BPS` (2%) of proceeds go to the flag's reporter immediately.
/// The remainder is returned to the keeper to unwind the margin debt.
public fun execute_liquidation<T>(
    pos: &mut MarginPosition<T>,
    predict: &mut Predict,
    manager: &mut PredictManager,
    oracle: &OracleSVI,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    assert_keeper(pos, manager, ctx);
    assert!(margin_position::liquidation_flag(pos).is_some(), ENotLiquidatable);

    let hf = health_factor(pos, predict, oracle, clock);
    if (hf > HF_SOFT_BPS) {
        margin_position::clear_liquidation_flag(pos);
        return coin::zero<T>(ctx)
    };

    let reporter = margin_position::flag_reporter(margin_position::liquidation_flag(pos).borrow());
    let snap = *margin_position::position(pos).borrow();
    let quantity = margin_position::snapshot_quantity(&snap);
    let debt = margin_position::margin_debt(pos);
    let is_hard = hf <= HF_HARD_BPS;

    let close_quantity = if (is_hard) {
        quantity
    } else {
        let q = (((quantity as u128) * (SOFT_LIQ_FRACTION_BPS as u128) / (BPS as u128)) as u64);
        if (q == 0) { quantity } else { q }
    };
    let full_close = close_quantity == quantity;

    let proceeds = redeem_position<T>(
        predict, manager, oracle,
        margin_position::snapshot_market_key(&snap),
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
