/// Pure leverage arithmetic — mirrors position_manager.move constants so the
/// keeper's off-chain bookkeeping stays consistent with on-chain state.

import { BPS, MIN_LEVERAGE_BPS, MAX_LEVERAGE_BPS } from '../config.js';

export interface LeverageRange {
  minBps: number;
  maxBps: number;
  min: number;
  max: number;
}

export function getLeverageRange(): LeverageRange {
  return {
    minBps: MIN_LEVERAGE_BPS,
    maxBps: MAX_LEVERAGE_BPS,
    min: MIN_LEVERAGE_BPS / BPS,
    max: MAX_LEVERAGE_BPS / BPS,
  };
}

export function assertValidLeverageBps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`leverageBps must be an integer (got ${JSON.stringify(value)})`);
  }
  if (value < MIN_LEVERAGE_BPS || value > MAX_LEVERAGE_BPS) {
    throw new Error(
      `leverageBps must be in [${MIN_LEVERAGE_BPS}, ${MAX_LEVERAGE_BPS}] ` +
      `(${(MIN_LEVERAGE_BPS / BPS).toFixed(2)}x – ${(MAX_LEVERAGE_BPS / BPS).toFixed(2)}x), got ${value}`,
    );
  }
  return value;
}

/** DBUSDC borrow B = C × (L − 1), where C is collateral USD value. */
export function computeBorrowAmount(collateralUsd: number, leverageBps: number): number {
  return collateralUsd * (leverageBps / BPS - 1);
}

const SOFT_LIQ_FRACTION_BPS = 2_500n;
const BPS_BIG = BigInt(BPS);

/**
 * Replicates `execute_liquidation`'s soft-liquidation debt split (same
 * floor-division order) so the store stays in sync with on-chain state.
 */
export function computeSoftLiqDebt(marginDebt: bigint): { repayAmount: bigint; newDebt: bigint } {
  const newDebt = (marginDebt * (BPS_BIG - SOFT_LIQ_FRACTION_BPS)) / BPS_BIG;
  return { repayAmount: marginDebt - newDebt, newDebt };
}
