/// On-chain reads and PTB builders for the margin_predict contract.
/// All positions this keeper services use T = DUSDC (the Predict quote asset).

import { Transaction } from '@mysten/sui/transactions';
import type { TransactionObjectArgument } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  PREDICT_ID,
  PREDICT_PACKAGE,
  DUSDC_TYPE,
  CLOCK_ID,
  requireMarginPredictPackage,
  requirePredictManagerId,
} from '../config.js';
import { SimulationError } from './errors.js';

// ---------------------------------------------------------------------------
// BCS helpers
// ---------------------------------------------------------------------------

export function decodeU64(bcs: Uint8Array): bigint {
  let result = 0n;
  for (let i = 7; i >= 0; i--) {
    result = (result << 8n) | BigInt(bcs[i]);
  }
  return result;
}

export function decodeAddress(bcs: Uint8Array): string {
  return '0x' + Buffer.from(bcs).toString('hex');
}

// ---------------------------------------------------------------------------
// Simulation helper
// ---------------------------------------------------------------------------

async function simulateReturns(
  client: SuiGrpcClient,
  sender: string,
  build: (tx: Transaction) => void,
): Promise<Uint8Array[][]> {
  const tx = new Transaction();
  tx.setSender(sender);
  build(tx);

  const sim = await client.core.simulateTransaction({
    transaction: tx,
    include: { commandResults: true, effects: true },
  });

  if (sim.$kind === 'FailedTransaction') {
    throw new SimulationError(sim.FailedTransaction.effects?.status);
  }
  return (sim.commandResults ?? []).map((r) => r.returnValues.map((o) => o.bcs));
}

// ---------------------------------------------------------------------------
// On-chain reads
// ---------------------------------------------------------------------------

export interface PositionContext {
  owner: string;
  escrowValue: bigint;
}

/** Owner address and escrowed SUI (raw, 9 decimals) for a pending-open position. */
export async function readPositionContext(
  client: SuiGrpcClient,
  sender: string,
  positionId: string,
): Promise<PositionContext> {
  const pkg = requireMarginPredictPackage();
  const returns = await simulateReturns(client, sender, (tx) => {
    const args = [tx.object(positionId)];
    const typeArgs = [DUSDC_TYPE];
    tx.moveCall({ target: `${pkg}::margin_position::owner`, typeArguments: typeArgs, arguments: args });
    tx.moveCall({ target: `${pkg}::margin_position::escrow_value`, typeArguments: typeArgs, arguments: args });
  });
  return {
    owner: decodeAddress(returns[0][0]),
    escrowValue: decodeU64(returns[1][0]),
  };
}

/** Health factor in bps (u64::MAX when no debt). */
export async function readHealthFactor(
  client: SuiGrpcClient,
  sender: string,
  positionId: string,
  oracleId: string,
): Promise<bigint> {
  const pkg = requireMarginPredictPackage();
  const returns = await simulateReturns(client, sender, (tx) => {
    tx.moveCall({
      target: `${pkg}::position_manager::health_factor`,
      typeArguments: [DUSDC_TYPE],
      arguments: [tx.object(positionId), tx.object(PREDICT_ID), tx.object(oracleId), tx.object(CLOCK_ID)],
    });
  });
  return decodeU64(returns[0][0]);
}

/** Whether the oracle has settled (market expired). */
export async function readOracleSettled(
  client: SuiGrpcClient,
  sender: string,
  oracleId: string,
): Promise<boolean> {
  // `oracle` lives in the deepbook_predict package, not margin_predict.
  const returns = await simulateReturns(client, sender, (tx) => {
    tx.moveCall({
      target: `${PREDICT_PACKAGE}::oracle::is_settled`,
      arguments: [tx.object(oracleId)],
    });
  });
  return returns[0][0][0] === 1;
}

export interface PositionFinancials {
  owner: string;
  /** Lifecycle status (0=PENDING_OPEN, 1=OPEN, 2=CLOSED, 3=LIQUIDATED, 4=CANCELLED). */
  status: number;
  /** Outstanding DBUSDC principal (raw, 6 decimals). */
  marginDebt: bigint;
  /** SUI collateral deposited for this position (raw, 9 decimals). */
  collateralSui: bigint;
}

/** Live owner / status / debt / collateral for an OPEN position, read directly
 * from the on-chain `MarginPosition`. This is the authoritative source for
 * amounts moved during close / settle / liquidation — the keeper's local
 * store only tracks which position ids exist. */
export async function readPositionFinancials(
  client: SuiGrpcClient,
  sender: string,
  positionId: string,
): Promise<PositionFinancials> {
  const pkg = requireMarginPredictPackage();
  const returns = await simulateReturns(client, sender, (tx) => {
    const args = [tx.object(positionId)];
    const typeArgs = [DUSDC_TYPE];
    tx.moveCall({ target: `${pkg}::margin_position::owner`, typeArguments: typeArgs, arguments: args });
    tx.moveCall({ target: `${pkg}::margin_position::status`, typeArguments: typeArgs, arguments: args });
    tx.moveCall({ target: `${pkg}::margin_position::margin_debt`, typeArguments: typeArgs, arguments: args });
    tx.moveCall({ target: `${pkg}::margin_position::collateral_sui`, typeArguments: typeArgs, arguments: args });
  });
  return {
    owner: decodeAddress(returns[0][0]),
    status: returns[1][0][0],
    marginDebt: decodeU64(returns[2][0]),
    collateralSui: decodeU64(returns[3][0]),
  };
}

/** Whether the position already has a liquidation flag set. */
export async function readLiquidationFlagged(
  client: SuiGrpcClient,
  sender: string,
  positionId: string,
): Promise<boolean> {
  const pkg = requireMarginPredictPackage();
  const returns = await simulateReturns(client, sender, (tx) => {
    tx.moveCall({
      target: `${pkg}::margin_position::liquidation_flag`,
      typeArguments: [DUSDC_TYPE],
      arguments: [tx.object(positionId)],
    });
  });
  return returns[0][0][0] === 1;
}

// ---------------------------------------------------------------------------
// PTB builders (keeper-signed)
// ---------------------------------------------------------------------------

/** Step 1 of opening: withdraws escrowed SUI for the keeper to use as margin collateral. */
export function buildTakeEscrow(tx: Transaction, positionId: string): TransactionObjectArgument {
  const pkg = requireMarginPredictPackage();
  return tx.moveCall({
    target: `${pkg}::position_executor::take_escrow`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(positionId), tx.object(requirePredictManagerId())],
  });
}

/** Step 2 of opening: sizes/mints the Predict position and confirms OPEN. */
export function buildDeployPosition(
  tx: Transaction,
  positionId: string,
  oracleId: string,
  collateral: TransactionObjectArgument,
  marginManagerId: string,
  marginDebt: bigint,
): void {
  const pkg = requireMarginPredictPackage();
  tx.moveCall({
    target: `${pkg}::position_executor::deploy_position`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(positionId),
      tx.object(PREDICT_ID),
      tx.object(requirePredictManagerId()),
      tx.object(oracleId),
      collateral,
      tx.pure.id(marginManagerId),
      tx.pure.u64(marginDebt),
      tx.object(CLOCK_ID),
    ],
  });
}

/** Redeems the full position and marks it CLOSED, returning Coin<DUSDC> proceeds. */
export function buildClosePosition(
  tx: Transaction,
  positionId: string,
  oracleId: string,
): TransactionObjectArgument {
  const pkg = requireMarginPredictPackage();
  return tx.moveCall({
    target: `${pkg}::position_executor::execute_close`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(positionId),
      tx.object(PREDICT_ID),
      tx.object(requirePredictManagerId()),
      tx.object(oracleId),
      tx.object(CLOCK_ID),
    ],
  });
}

/** Redeems the full position against a settled oracle, returning Coin<DUSDC> proceeds. */
export function buildSettlePosition(
  tx: Transaction,
  positionId: string,
  oracleId: string,
): TransactionObjectArgument {
  const pkg = requireMarginPredictPackage();
  return tx.moveCall({
    target: `${pkg}::position_executor::execute_settle`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(positionId),
      tx.object(PREDICT_ID),
      tx.object(requirePredictManagerId()),
      tx.object(oracleId),
      tx.object(CLOCK_ID),
    ],
  });
}

/** Permissionless: flags an unhealthy position for liquidation. Caller earns the reporter fee. */
export function buildFlagLiquidation(tx: Transaction, positionId: string, oracleId: string): void {
  const pkg = requireMarginPredictPackage();
  tx.moveCall({
    target: `${pkg}::position_liquidator::flag_for_liquidation`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(positionId),
      tx.object(PREDICT_ID),
      tx.object(oracleId),
      tx.object(CLOCK_ID),
    ],
  });
}

/** Executes a flagged liquidation, returning Coin<DUSDC> proceeds (zero if the position recovered). */
export function buildExecuteLiquidation(
  tx: Transaction,
  positionId: string,
  oracleId: string,
): TransactionObjectArgument {
  const pkg = requireMarginPredictPackage();
  return tx.moveCall({
    target: `${pkg}::position_liquidator::execute_liquidation`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(positionId),
      tx.object(PREDICT_ID),
      tx.object(requirePredictManagerId()),
      tx.object(oracleId),
      tx.object(CLOCK_ID),
    ],
  });
}
