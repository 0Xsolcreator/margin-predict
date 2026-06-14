/// Per-position shared object. Each `MarginPosition<T>` represents one
/// leveraged Predict bet. State changes follow a two-phase request/execute
/// pattern: the owner signs `request_*` mutations, and the keeper
/// (the `PredictManager`'s owner) signs the matching `execute_*`, which
/// calls the `confirm_*` / `apply_*` functions here.
module margin_predict::margin_position;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock::Clock;
use deepbook_predict::market_key::MarketKey;

// === Errors ===
const ENotOwner: u64 = 0;
const EWrongStatus: u64 = 1;
const EIntentAlreadyPending: u64 = 2;
const ENoPendingIntent: u64 = 3;
const EWrongIntentKind: u64 = 4;
const ETimeoutNotElapsed: u64 = 5;
const EAlreadyFlagged: u64 = 6;

// === Lifecycle statuses ===
const STATUS_PENDING_OPEN: u8 = 0;
const STATUS_OPEN: u8 = 1;
const STATUS_CLOSED: u8 = 2;
const STATUS_LIQUIDATED: u8 = 3;
const STATUS_CANCELLED: u8 = 4;

// === Intent kinds ===
const INTENT_OPEN: u8 = 0;
const INTENT_CLOSE: u8 = 1;

// === Liquidation modes ===
const LIQ_SOFT: u8 = 0;
const LIQ_HARD: u8 = 1;

/// Shared object representing a single leveraged prediction market position.
/// `T` is the quote asset (DUSDC on testnet).
public struct MarginPosition<phantom T> has key {
    id: UID,
    owner: address,
    predict_manager_id: ID,
    status: u8,
    /// SUI escrowed at `request_open`, held until the keeper deposits it into
    /// DeepBook Margin as collateral.
    escrow: Balance<SUI>,
    pending_intent: Option<Intent>,
    /// The DeepBook Margin `MarginManager` whose DBUSDC borrow (swapped to `T`)
    /// funds this position. Set at `confirm_open`, cleared on close/settle/liquidation.
    margin_manager_id: Option<ID>,
    /// DBUSDC principal borrowed for this position (6 decimals).
    /// Reduced proportionally on soft liquidation, zeroed on close/settle/hard liquidation.
    margin_debt: u64,
    position: Option<PositionSnapshot>,
    liquidation_flag: Option<LiquidationFlag>,
}

/// Pending owner action awaiting keeper execution.
public struct Intent has store, copy, drop {
    kind: u8,
    leverage_bps: u64,
    market_key: Option<MarketKey>,
    requested_at_ms: u64,
}

/// Immutable record of an open position's on-chain state.
public struct PositionSnapshot has store, copy, drop {
    market_key: MarketKey,
    quantity: u64,
    leverage_bps: u64,
    opened_at_ms: u64,
}

/// Set by a watcher when the position's health factor drops below the soft
/// threshold. First reporter wins the `LIQ_REPORTER_BPS` fee.
public struct LiquidationFlag has store, copy, drop {
    reporter: address,
    mode: u8,
    flagged_at_ms: u64,
}

// === Constructor ===

public(package) fun new<T>(
    owner: address,
    predict_manager_id: ID,
    leverage_bps: u64,
    market_key: MarketKey,
    payment: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
): MarginPosition<T> {
    MarginPosition {
        id: object::new(ctx),
        owner,
        predict_manager_id,
        status: STATUS_PENDING_OPEN,
        escrow: payment.into_balance(),
        pending_intent: option::some(Intent {
            kind: INTENT_OPEN,
            leverage_bps,
            market_key: option::some(market_key),
            requested_at_ms: clock.timestamp_ms(),
        }),
        margin_manager_id: option::none(),
        margin_debt: 0,
        position: option::none(),
        liquidation_flag: option::none(),
    }
}

public fun share<T>(position: MarginPosition<T>) {
    transfer::share_object(position);
}

// === Read accessors ===

public fun owner<T>(pos: &MarginPosition<T>): address { pos.owner }
public fun predict_manager_id<T>(pos: &MarginPosition<T>): ID { pos.predict_manager_id }
public fun status<T>(pos: &MarginPosition<T>): u8 { pos.status }
public fun escrow_value<T>(pos: &MarginPosition<T>): u64 { pos.escrow.value() }
public fun margin_manager_id<T>(pos: &MarginPosition<T>): Option<ID> { pos.margin_manager_id }
public fun margin_debt<T>(pos: &MarginPosition<T>): u64 { pos.margin_debt }
public fun pending_intent<T>(pos: &MarginPosition<T>): &Option<Intent> { &pos.pending_intent }
public fun position<T>(pos: &MarginPosition<T>): &Option<PositionSnapshot> { &pos.position }
public fun liquidation_flag<T>(pos: &MarginPosition<T>): &Option<LiquidationFlag> { &pos.liquidation_flag }

// === Status constant accessors ===

public fun status_pending_open(): u8 { STATUS_PENDING_OPEN }
public fun status_open(): u8 { STATUS_OPEN }
public fun status_closed(): u8 { STATUS_CLOSED }
public fun status_liquidated(): u8 { STATUS_LIQUIDATED }
public fun status_cancelled(): u8 { STATUS_CANCELLED }

public fun intent_kind_open(): u8 { INTENT_OPEN }
public fun intent_kind_close(): u8 { INTENT_CLOSE }

public fun liq_soft(): u8 { LIQ_SOFT }
public fun liq_hard(): u8 { LIQ_HARD }

// === Intent accessors ===

public fun intent_kind(intent: &Intent): u8 { intent.kind }
public fun intent_leverage_bps(intent: &Intent): u64 { intent.leverage_bps }
public fun intent_market_key(intent: &Intent): &Option<MarketKey> { &intent.market_key }
public fun intent_requested_at_ms(intent: &Intent): u64 { intent.requested_at_ms }

// === PositionSnapshot accessors ===

public fun new_snapshot(
    market_key: MarketKey,
    quantity: u64,
    leverage_bps: u64,
    opened_at_ms: u64,
): PositionSnapshot {
    PositionSnapshot { market_key, quantity, leverage_bps, opened_at_ms }
}

public fun snapshot_market_key(snap: &PositionSnapshot): MarketKey { snap.market_key }
public fun snapshot_quantity(snap: &PositionSnapshot): u64 { snap.quantity }
public fun snapshot_leverage_bps(snap: &PositionSnapshot): u64 { snap.leverage_bps }
public fun snapshot_opened_at_ms(snap: &PositionSnapshot): u64 { snap.opened_at_ms }

// === LiquidationFlag accessors ===

public fun flag_reporter(flag: &LiquidationFlag): address { flag.reporter }
public fun flag_mode(flag: &LiquidationFlag): u8 { flag.mode }
public fun flag_flagged_at_ms(flag: &LiquidationFlag): u64 { flag.flagged_at_ms }

// === Owner-side mutations ===

public(package) fun assert_owner<T>(pos: &MarginPosition<T>, sender: address) {
    assert!(pos.owner == sender, ENotOwner);
}

/// Records a close intent on an `OPEN` position with no other pending intent.
public(package) fun request_close<T>(pos: &mut MarginPosition<T>, clock: &Clock) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    assert!(pos.pending_intent.is_none(), EIntentAlreadyPending);
    pos.pending_intent = option::some(Intent {
        kind: INTENT_CLOSE,
        leverage_bps: 0,
        market_key: option::none(),
        requested_at_ms: clock.timestamp_ms(),
    });
}

/// Cancels a pending intent the keeper hasn't executed within `timeout_ms`,
/// returning any escrowed SUI. Escape hatch bounding keeper-availability risk.
public(package) fun cancel_intent<T>(
    pos: &mut MarginPosition<T>,
    timeout_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert!(pos.pending_intent.is_some(), ENoPendingIntent);
    let intent = pos.pending_intent.borrow();
    let elapsed = clock.timestamp_ms() - intent.requested_at_ms;
    assert!(elapsed >= timeout_ms, ETimeoutNotElapsed);
    let kind = intent.kind;
    pos.pending_intent = option::none();
    if (kind == INTENT_OPEN) {
        pos.status = STATUS_CANCELLED;
        coin::from_balance(pos.escrow.withdraw_all(), ctx)
    } else {
        coin::zero<SUI>(ctx)
    }
}

// === Keeper-side mutations ===

/// Withdraws escrowed SUI for the keeper to use as margin collateral.
public(package) fun take_escrow<T>(pos: &mut MarginPosition<T>): Balance<SUI> {
    assert!(pos.pending_intent.is_some(), ENoPendingIntent);
    pos.escrow.withdraw_all()
}

public(package) fun confirm_open<T>(
    pos: &mut MarginPosition<T>,
    snapshot: PositionSnapshot,
    margin_manager_id: ID,
    margin_debt: u64,
) {
    assert!(pos.status == STATUS_PENDING_OPEN, EWrongStatus);
    assert!(pos.pending_intent.borrow().kind == INTENT_OPEN, EWrongIntentKind);
    pos.position = option::some(snapshot);
    pos.margin_manager_id = option::some(margin_manager_id);
    pos.margin_debt = margin_debt;
    pos.status = STATUS_OPEN;
    pos.pending_intent = option::none();
}

public(package) fun confirm_close<T>(pos: &mut MarginPosition<T>) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    assert!(pos.pending_intent.borrow().kind == INTENT_CLOSE, EWrongIntentKind);
    pos.position = option::none();
    pos.margin_manager_id = option::none();
    pos.margin_debt = 0;
    pos.status = STATUS_CLOSED;
    pos.pending_intent = option::none();
}

/// Post-expiry settlement: clears the position regardless of any pending
/// intent (a pending close is moot once the oracle settles).
public(package) fun confirm_settle<T>(pos: &mut MarginPosition<T>) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    pos.position = option::none();
    pos.margin_manager_id = option::none();
    pos.margin_debt = 0;
    pos.status = STATUS_CLOSED;
    pos.pending_intent = option::none();
}

// === Liquidation ===

/// First-reporter-wins: records `reporter` / `mode` if no flag is set.
public(package) fun set_liquidation_flag<T>(
    pos: &mut MarginPosition<T>,
    reporter: address,
    mode: u8,
    clock: &Clock,
) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    assert!(pos.liquidation_flag.is_none(), EAlreadyFlagged);
    pos.liquidation_flag = option::some(LiquidationFlag {
        reporter,
        mode,
        flagged_at_ms: clock.timestamp_ms(),
    });
}

/// Clears a flag without acting (e.g. HF recovered before execution).
public(package) fun clear_liquidation_flag<T>(pos: &mut MarginPosition<T>) {
    pos.liquidation_flag = option::none();
}

/// Soft liquidation: reduces position size and debt, position stays open.
public(package) fun apply_soft_liquidation<T>(
    pos: &mut MarginPosition<T>,
    new_quantity: u64,
    new_debt: u64,
) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    let snap = pos.position.borrow();
    pos.position = option::some(PositionSnapshot {
        market_key: snap.market_key,
        quantity: new_quantity,
        leverage_bps: snap.leverage_bps,
        opened_at_ms: snap.opened_at_ms,
    });
    pos.margin_debt = new_debt;
    pos.liquidation_flag = option::none();
}

/// Hard liquidation: fully closes the position.
public(package) fun apply_hard_liquidation<T>(pos: &mut MarginPosition<T>) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    pos.position = option::none();
    pos.margin_manager_id = option::none();
    pos.margin_debt = 0;
    pos.status = STATUS_LIQUIDATED;
    pos.pending_intent = option::none();
    pos.liquidation_flag = option::none();
}
