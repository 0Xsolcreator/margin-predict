/// Shared protocol constants. Centralised here so position_manager,
/// position_executor, and position_liquidator stay in sync without duplication.
module margin_predict::constants;

// Basis-points denominator (10 000 == 1.00x / 100 %)
public const BPS: u64 = 10_000;

// ---------------------------------------------------------------------------
// Leverage bounds
// DeepBook Margin's minimum withdraw risk ratio (2.0: assets ≥ 2 × debt)
// constrains the achievable redeploy leverage to ≤ 1.5x (B ≤ 0.5 × C).
// These bounds stay inside that ceiling with a safety buffer.
// ---------------------------------------------------------------------------
public const MIN_LEVERAGE_BPS: u64 = 11_000; // 1.10x — post-withdraw ratio 10.0
public const MAX_LEVERAGE_BPS: u64 = 14_000; // 1.40x — post-withdraw ratio  2.5

/// How long the owner must wait for the keeper to act before `cancel_intent`
/// becomes callable.
public const CANCEL_TIMEOUT_MS: u64 = 120_000; // 2 minutes

// ---------------------------------------------------------------------------
// Position sizing
// ---------------------------------------------------------------------------

/// Notional (6 decimals, DUSDC) used to probe the current ask price when
/// sizing a new position.
public const PROBE_QUANTITY: u64 = 1_000_000;   // $1
public const SIZING_ITERATIONS: u64 = 4;

// ---------------------------------------------------------------------------
// Health-factor thresholds (bps, 10_000 == 1.00x)
// ---------------------------------------------------------------------------
public const HF_HARD_BPS: u64 = 10_000;  // ≤ 1.00x → hard liquidation
public const HF_SOFT_BPS: u64 = 10_500;  // ≤ 1.05x → soft liquidation
public const HF_INFINITE: u64 = 18_446_744_073_709_551_615; // u64::MAX (no debt)

// ---------------------------------------------------------------------------
// Liquidation parameters
// ---------------------------------------------------------------------------
public const SOFT_LIQ_FRACTION_BPS: u64 = 2_500; // 25 % closed per soft liquidation
public const LIQ_REPORTER_BPS: u64 = 200;          // 2 % of proceeds to the reporter
