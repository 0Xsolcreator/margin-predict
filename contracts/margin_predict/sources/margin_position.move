/// Shared object representing a single leveraged prediction market position.
/// Owns the escrow, margin debt record, position snapshot, and liquidation flag.
/// Mutations are `public(package)` — callers go through `position_manager`,
/// `position_executor`, or `position_liquidator`.
module margin_predict::margin_position;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::clock::Clock;
use deepbook_predict::predict_manager::PredictManager;
use margin_predict::types::{Self, Intent, PositionSnapshot, LiquidationFlag};

// === Errors ===
const ENotOwner: u64         = 0;
const EWrongStatus: u64      = 1;
const EIntentPending: u64    = 2;
const ENoPendingIntent: u64  = 3;
const EWrongIntentKind: u64  = 4;
const ETimeoutNotElapsed: u64 = 5;
const EAlreadyFlagged: u64   = 6;
const ENotKeeper: u64        = 7;

// === Lifecycle statuses ===
const STATUS_PENDING_OPEN: u8 = 0;
const STATUS_OPEN: u8         = 1;
const STATUS_CLOSED: u8       = 2;
const STATUS_LIQUIDATED: u8   = 3;
const STATUS_CANCELLED: u8    = 4;

public struct MarginPosition<phantom T> has key {
    id: UID,
    owner: address,
    predict_manager_id: ID,
    status: u8,
    /// SUI escrowed at `request_open`, transferred to DeepBook Margin on open.
    escrow: Balance<SUI>,
    pending_intent: Option<Intent>,
    /// DeepBook Margin `MarginManager` whose DBUSDC borrow funds this position.
    margin_manager_id: Option<ID>,
    /// DBUSDC principal borrowed (6 decimals). Reduced on soft liquidation,
    /// zeroed on close / settle / hard liquidation.
    margin_debt: u64,
    position: Option<PositionSnapshot>,
    liquidation_flag: Option<LiquidationFlag>,
}

// === Constructor ===

public(package) fun new<T>(
    owner: address,
    predict_manager_id: ID,
    leverage_bps: u64,
    market_key: deepbook_predict::market_key::MarketKey,
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
        pending_intent: option::some(types::new_open_intent(leverage_bps, market_key, clock.timestamp_ms())),
        margin_manager_id: option::none(),
        margin_debt: 0,
        position: option::none(),
        liquidation_flag: option::none(),
    }
}

public fun share<T>(pos: MarginPosition<T>) { transfer::share_object(pos); }

// === Read accessors ===

public fun owner<T>(pos: &MarginPosition<T>): address    { pos.owner }
public fun predict_manager_id<T>(pos: &MarginPosition<T>): ID { pos.predict_manager_id }
public fun status<T>(pos: &MarginPosition<T>): u8        { pos.status }
public fun escrow_value<T>(pos: &MarginPosition<T>): u64 { pos.escrow.value() }
public fun margin_manager_id<T>(pos: &MarginPosition<T>): Option<ID> { pos.margin_manager_id }
public fun margin_debt<T>(pos: &MarginPosition<T>): u64  { pos.margin_debt }
public fun pending_intent<T>(pos: &MarginPosition<T>): &Option<Intent> { &pos.pending_intent }
public fun position<T>(pos: &MarginPosition<T>): &Option<PositionSnapshot> { &pos.position }
public fun liquidation_flag<T>(pos: &MarginPosition<T>): &Option<LiquidationFlag> { &pos.liquidation_flag }

// === Status constant accessors ===

public fun status_pending_open(): u8 { STATUS_PENDING_OPEN }
public fun status_open(): u8         { STATUS_OPEN }
public fun status_closed(): u8       { STATUS_CLOSED }
public fun status_liquidated(): u8   { STATUS_LIQUIDATED }
public fun status_cancelled(): u8    { STATUS_CANCELLED }

// === Package-internal guards ===

public(package) fun assert_owner<T>(pos: &MarginPosition<T>, sender: address) {
    assert!(pos.owner == sender, ENotOwner);
}

/// Verifies that the caller is the owner of the given `PredictManager` and
/// that it matches the one recorded in this position.
public(package) fun assert_keeper<T>(pos: &MarginPosition<T>, manager: &PredictManager, ctx: &TxContext) {
    assert!(object::id(manager) == pos.predict_manager_id, ENotKeeper);
    assert!(manager.owner() == ctx.sender(), ENotKeeper);
}

// === Owner-side mutations ===

public(package) fun request_close<T>(pos: &mut MarginPosition<T>, clock: &Clock) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    assert!(pos.pending_intent.is_none(), EIntentPending);
    pos.pending_intent = option::some(types::new_close_intent(clock.timestamp_ms()));
}

/// Cancels a pending intent the keeper hasn't executed within `timeout_ms`,
/// returning any escrowed SUI to the owner. Escape hatch for keeper liveness.
public(package) fun cancel_intent<T>(
    pos: &mut MarginPosition<T>,
    timeout_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<SUI> {
    assert!(pos.pending_intent.is_some(), ENoPendingIntent);
    let intent = pos.pending_intent.borrow();
    assert!(clock.timestamp_ms() - types::intent_requested_at_ms(intent) >= timeout_ms, ETimeoutNotElapsed);
    let kind = types::intent_kind(intent);
    pos.pending_intent = option::none();
    if (kind == types::intent_kind_open()) {
        pos.status = STATUS_CANCELLED;
        coin::from_balance(pos.escrow.withdraw_all(), ctx)
    } else {
        coin::zero<SUI>(ctx)
    }
}

// === Keeper-side mutations ===

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
    assert!(types::intent_kind(pos.pending_intent.borrow()) == types::intent_kind_open(), EWrongIntentKind);
    pos.position = option::some(snapshot);
    pos.margin_manager_id = option::some(margin_manager_id);
    pos.margin_debt = margin_debt;
    pos.status = STATUS_OPEN;
    pos.pending_intent = option::none();
}

public(package) fun confirm_close<T>(pos: &mut MarginPosition<T>) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    assert!(types::intent_kind(pos.pending_intent.borrow()) == types::intent_kind_close(), EWrongIntentKind);
    pos.position = option::none();
    pos.margin_manager_id = option::none();
    pos.margin_debt = 0;
    pos.status = STATUS_CLOSED;
    pos.pending_intent = option::none();
}

/// Post-expiry settlement: clears the position regardless of any pending intent.
public(package) fun confirm_settle<T>(pos: &mut MarginPosition<T>) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    pos.position = option::none();
    pos.margin_manager_id = option::none();
    pos.margin_debt = 0;
    pos.status = STATUS_CLOSED;
    pos.pending_intent = option::none();
}

// === Liquidation mutations ===

/// First-reporter-wins: records reporter / mode if no flag is set yet.
public(package) fun set_liquidation_flag<T>(
    pos: &mut MarginPosition<T>,
    reporter: address,
    mode: u8,
    clock: &Clock,
) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    assert!(pos.liquidation_flag.is_none(), EAlreadyFlagged);
    pos.liquidation_flag = option::some(types::new_flag(reporter, mode, clock.timestamp_ms()));
}

public(package) fun clear_liquidation_flag<T>(pos: &mut MarginPosition<T>) {
    pos.liquidation_flag = option::none();
}

public(package) fun apply_soft_liquidation<T>(pos: &mut MarginPosition<T>, new_quantity: u64, new_debt: u64) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    let snap = pos.position.borrow();
    pos.position = option::some(types::new_snapshot(
        types::snapshot_market_key(snap),
        new_quantity,
        types::snapshot_leverage_bps(snap),
        types::snapshot_opened_at_ms(snap),
    ));
    pos.margin_debt = new_debt;
    pos.liquidation_flag = option::none();
}

public(package) fun apply_hard_liquidation<T>(pos: &mut MarginPosition<T>) {
    assert!(pos.status == STATUS_OPEN, EWrongStatus);
    pos.position = option::none();
    pos.margin_manager_id = option::none();
    pos.margin_debt = 0;
    pos.status = STATUS_LIQUIDATED;
    pos.pending_intent = option::none();
    pos.liquidation_flag = option::none();
}
