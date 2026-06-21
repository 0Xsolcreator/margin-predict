/// Shared liquidation logic — called by both the POST /liquidate route and the
/// background monitor. Reads health, then (if unhealthy) flags + executes the
/// liquidation in one PTB, repaying debt and returning collateral.
///
///   Hard (hf ≤ 1.00x): close full position, repay all debt, return SUI to owner.
///   Soft (hf ≤ 1.05x): close 25%, repay 25%, leave SUI as collateral.

import { Transaction } from '@mysten/sui/transactions';
import { HF_HARD_BPS, HF_SOFT_BPS, getSwapPool } from './config.js';
import {
  loadKeypair,
  createGrpcClient,
  createMarginClient,
  createSwapClient,
  injectPythPrices,
} from './chain/client.js';
import {
  readHealthFactor,
  readLiquidationFlagged,
  readPositionFinancials,
  buildFlagLiquidation,
  buildExecuteLiquidation,
} from './chain/contract.js';
import { unwindPosition } from './deepbook/unwind.js';
import { computeSoftLiqDebt } from './math/leverage.js';
import { getPosition, setPosition, deletePosition } from './store/positions.js';
import { readPositionOracleId } from './chain/positionOracle.js';
import { executeTransaction } from './chain/transaction.js';

export type LiquidationOutcome =
  | {
      status: 'liquidated';
      digest: string;
      positionId: string;
      owner: string;
      mode: 'hard' | 'soft';
      healthFactorBps: string;
      repaidDebt: string;
      remainingDebt: string;
      withdrawnCollateral: string;
    }
  | { status: 'healthy'; positionId: string; healthFactorBps: string }
  | { status: 'not_tracked'; positionId: string }
  | { status: 'misconfigured'; positionId: string; error: string };

export async function liquidatePosition(positionId: string, oracleIdFallback?: string): Promise<LiquidationOutcome> {
  const record = getPosition(positionId);
  if (!record) return { status: 'not_tracked', positionId };

  // The position's own oracle (baked into its market key) — not the active one.
  const oracleId = record.oracleId ?? (await readPositionOracleId(positionId)) ?? oracleIdFallback;
  if (!oracleId) return { status: 'misconfigured', positionId, error: 'could not resolve the position oracle' };

  const swapPool = getSwapPool();
  if (!swapPool) return { status: 'misconfigured', positionId, error: 'DUSDC_DBUSDC_POOL_ID not configured' };

  const keypair = loadKeypair();
  const address = keypair.toSuiAddress();
  const base = createGrpcClient();

  const hf = await readHealthFactor(base, address, positionId, oracleId);
  if (hf > HF_SOFT_BPS) return { status: 'healthy', positionId, healthFactorBps: hf.toString() };

  const isHard = hf <= HF_HARD_BPS;
  const alreadyFlagged = await readLiquidationFlagged(base, address, positionId);

  const { owner, marginDebt: currentDebt, collateralSui } = await readPositionFinancials(base, address, positionId);
  const { repayAmount, newDebt } = isHard
    ? { repayAmount: currentDebt, newDebt: 0n }
    : computeSoftLiqDebt(currentDebt);

  const marginClient = createMarginClient(base, address);
  const swapClient = createSwapClient(base, address);

  const tx = new Transaction();
  await injectPythPrices(base, tx, address);

  if (!alreadyFlagged) buildFlagLiquidation(tx, positionId, oracleId);
  const proceedsCoin = buildExecuteLiquidation(tx, positionId, oracleId);

  unwindPosition({
    tx, marginClient, swapClient, swapPool, proceedsCoin,
    repayAmount,
    withdrawSuiAmount: isHard ? collateralSui : 0n,
    recipient: owner,
    keeperAddress: address,
  });

  const result = await executeTransaction(marginClient, keypair, tx, 'Liquidate position');

  if (isHard) {
    deletePosition(positionId);
  } else {
    setPosition(positionId, { ...record, updatedAt: new Date().toISOString() });
  }

  return {
    status: 'liquidated',
    digest: result.digest,
    positionId,
    owner,
    mode: isHard ? 'hard' : 'soft',
    healthFactorBps: hf.toString(),
    repaidDebt: repayAmount.toString(),
    remainingDebt: newDebt.toString(),
    withdrawnCollateral: isHard ? collateralSui.toString() : '0',
  };
}
