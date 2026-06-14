/// POST /positions/:positionId/close
///
/// Closes an OPEN MarginPosition<DUSDC> and unwinds its DeepBook Margin borrow:
///   1. Redeem the full Predict position → Coin<DUSDC> proceeds.
///   2. Swap DUSDC → DBUSDC.
///   3. Deposit DBUSDC and repay this position's recorded debt.
///   4. Withdraw this position's SUI collateral.
///   5. Forward SUI + DUSDC dust to the position owner.

import type { FastifyInstance } from 'fastify';
import { Transaction } from '@mysten/sui/transactions';
import { getSwapPool } from '../config.js';
import {
  loadKeypair,
  createGrpcClient,
  createMarginClient,
  createSwapClient,
  injectPythPrices,
} from '../chain/client.js';
import { buildClosePosition } from '../chain/contract.js';
import { unwindPosition } from '../deepbook/unwind.js';
import { getPosition, deletePosition } from '../store/positions.js';
import { executeTransaction } from '../chain/transaction.js';

export function registerCloseRoute(app: FastifyInstance): void {
  app.post<{ Params: { positionId: string }; Body: { oracleId: string } }>(
    '/positions/:positionId/close',
    async (request, reply) => {
      const { positionId } = request.params;
      const { oracleId } = request.body ?? {};

      if (!oracleId) return reply.code(400).send({ error: 'oracleId is required' });

      const record = getPosition(positionId);
      if (!record) return reply.code(404).send({ error: `Position ${positionId} not tracked` });

      const swapPool = getSwapPool();
      if (!swapPool) return reply.code(500).send({ error: 'DUSDC_DBUSDC_POOL_ID not configured' });

      const keypair = loadKeypair();
      const address = keypair.toSuiAddress();
      const base = createGrpcClient();
      const marginClient = createMarginClient(base, address);
      const swapClient = createSwapClient(base, address);

      const tx = new Transaction();
      await injectPythPrices(base, tx, address);

      const proceedsCoin = buildClosePosition(tx, positionId, oracleId);

      unwindPosition({
        tx, marginClient, swapClient, swapPool, proceedsCoin,
        repayAmount: BigInt(record.marginDebt),
        withdrawSuiAmount: BigInt(record.collateralSui),
        recipient: record.owner,
        keeperAddress: address,
      });

      const result = await executeTransaction(marginClient, keypair, tx, 'Close position');
      deletePosition(positionId);

      return reply.send({
        digest: result.digest,
        positionId,
        owner: record.owner,
        repaidDebt: record.marginDebt,
        withdrawnCollateral: record.collateralSui,
      });
    },
  );
}
