/// Value types stored inside a `MarginPosition`. Defined separately so
/// `margin_position` stays focused on the shared object itself.
module margin_predict::types;

use deepbook_predict::market_key::MarketKey;

// ---------------------------------------------------------------------------
// Intent kinds
// ---------------------------------------------------------------------------
const INTENT_OPEN: u8  = 0;
const INTENT_CLOSE: u8 = 1;

// ---------------------------------------------------------------------------
// Liquidation modes
// ---------------------------------------------------------------------------
const LIQ_SOFT: u8 = 0;
const LIQ_HARD: u8 = 1;

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/// Pending owner action awaiting keeper execution.
public struct Intent has store, copy, drop {
    kind: u8,
    leverage_bps: u64,
    market_key: Option<MarketKey>,
    requested_at_ms: u64,
}

/// Immutable snapshot of an open position's on-chain parameters.
public struct PositionSnapshot has store, copy, drop {
    market_key: MarketKey,
    quantity: u64,
    leverage_bps: u64,
    opened_at_ms: u64,
}

/// Set by a watcher when health factor drops below the soft threshold.
/// First reporter wins the `LIQ_REPORTER_BPS` fee on execution.
public struct LiquidationFlag has store, copy, drop {
    reporter: address,
    mode: u8,
    flagged_at_ms: u64,
}

// ---------------------------------------------------------------------------
// Intent constructors & accessors
// ---------------------------------------------------------------------------

public fun new_open_intent(leverage_bps: u64, market_key: MarketKey, requested_at_ms: u64): Intent {
    Intent { kind: INTENT_OPEN, leverage_bps, market_key: option::some(market_key), requested_at_ms }
}

public fun new_close_intent(requested_at_ms: u64): Intent {
    Intent { kind: INTENT_CLOSE, leverage_bps: 0, market_key: option::none(), requested_at_ms }
}

public fun intent_kind(i: &Intent): u8          { i.kind }
public fun intent_leverage_bps(i: &Intent): u64 { i.leverage_bps }
public fun intent_market_key(i: &Intent): &Option<MarketKey> { &i.market_key }
public fun intent_requested_at_ms(i: &Intent): u64 { i.requested_at_ms }
public fun intent_kind_open(): u8  { INTENT_OPEN }
public fun intent_kind_close(): u8 { INTENT_CLOSE }

// ---------------------------------------------------------------------------
// PositionSnapshot constructors & accessors
// ---------------------------------------------------------------------------

public fun new_snapshot(
    market_key: MarketKey,
    quantity: u64,
    leverage_bps: u64,
    opened_at_ms: u64,
): PositionSnapshot {
    PositionSnapshot { market_key, quantity, leverage_bps, opened_at_ms }
}

public fun snapshot_market_key(s: &PositionSnapshot): MarketKey { s.market_key }
public fun snapshot_quantity(s: &PositionSnapshot): u64         { s.quantity }
public fun snapshot_leverage_bps(s: &PositionSnapshot): u64     { s.leverage_bps }
public fun snapshot_opened_at_ms(s: &PositionSnapshot): u64     { s.opened_at_ms }

// ---------------------------------------------------------------------------
// LiquidationFlag constructors & accessors
// ---------------------------------------------------------------------------

public fun new_flag(reporter: address, mode: u8, flagged_at_ms: u64): LiquidationFlag {
    LiquidationFlag { reporter, mode, flagged_at_ms }
}

public fun flag_reporter(f: &LiquidationFlag): address { f.reporter }
public fun flag_mode(f: &LiquidationFlag): u8          { f.mode }
public fun flag_flagged_at_ms(f: &LiquidationFlag): u64 { f.flagged_at_ms }
public fun liq_soft(): u8 { LIQ_SOFT }
public fun liq_hard(): u8 { LIQ_HARD }
