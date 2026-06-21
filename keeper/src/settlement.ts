/// Shared settlement logic — called by both the POST /settle route and the
/// background monitor. Once a position's oracle has expired and settled, the
/// position can no longer be closed (no live price); it must be settled, which
/// redeems the Predict position at the settlement price, repays debt, and
/// returns the SUI collateral to the owner ("claiming" the position).

import { Transaction } from '@mysten/sui/transactions';
import { getSwapPool } from './config.js';
import {
  loadKeypair,
  createGrpcClient,
  createMarginClient,
  createSwapClient,
  injectPythPrices,
} from './chain/client.js';
import { readOracleSettled, readPositionFinancials, buildSettlePosition } from './chain/contract.js';
import { readPositionOracleId } from './chain/positionOracle.js';
import { unwindPosition } from './deepbook/unwind.js';
import { getPosition, deletePosition } from './store/positions.js';
import { executeTransaction } from './chain/transaction.js';

export type SettlementOutcome =
  | {
      status: 'settled';
      digest: string;
      positionId: string;
      owner: string;
      repaidDebt: string;
      withdrawnCollateral: string;
    }
  | { status: 'not_settled'; positionId: string; oracleId: string }
  | { status: 'not_tracked'; positionId: string }
  | { status: 'misconfigured'; positionId: string; error: string };

export async function settlePosition(positionId: string, oracleIdFallback?: string): Promise<SettlementOutcome> {
  const record = getPosition(positionId);
  if (!record) return { status: 'not_tracked', positionId };

  const oracleId = record.oracleId ?? (await readPositionOracleId(positionId)) ?? oracleIdFallback;
  if (!oracleId) return { status: 'misconfigured', positionId, error: 'could not resolve the position oracle' };

  const swapPool = getSwapPool();
  if (!swapPool) return { status: 'misconfigured', positionId, error: 'DUSDC_DBUSDC_POOL_ID not configured' };

  const keypair = loadKeypair();
  const address = keypair.toSuiAddress();
  const base = createGrpcClient();

  if (!(await readOracleSettled(base, address, oracleId))) {
    return { status: 'not_settled', positionId, oracleId };
  }

  const marginClient = createMarginClient(base, address);
  const swapClient = createSwapClient(base, address);

  const { owner, marginDebt, collateralSui } = await readPositionFinancials(base, address, positionId);

  const tx = new Transaction();
  await injectPythPrices(base, tx, address);

  const proceedsCoin = buildSettlePosition(tx, positionId, oracleId);

  unwindPosition({
    tx, marginClient, swapClient, swapPool, proceedsCoin,
    repayAmount: marginDebt,
    withdrawSuiAmount: collateralSui,
    recipient: owner,
    keeperAddress: address,
  });

  const result = await executeTransaction(marginClient, keypair, tx, 'Settle position');
  deletePosition(positionId);

  return {
    status: 'settled',
    digest: result.digest,
    positionId,
    owner,
    repaidDebt: marginDebt.toString(),
    withdrawnCollateral: collateralSui.toString(),
  };
}
