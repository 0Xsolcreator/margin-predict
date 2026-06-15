/// POST /positions/:positionId/settle
///
/// Same as /close but for a position whose market has expired and settled.
/// Validates that the oracle has settled before proceeding.

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
import { readOracleSettled, readPositionFinancials, buildSettlePosition } from '../chain/contract.js';
import { unwindPosition } from '../deepbook/unwind.js';
import { getPosition, deletePosition } from '../store/positions.js';
import { executeTransaction } from '../chain/transaction.js';

export function registerSettleRoute(app: FastifyInstance): void {
  app.post<{ Params: { positionId: string }; Body: { oracleId: string } }>(
    '/positions/:positionId/settle',
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

      const settled = await readOracleSettled(base, address, oracleId);
      if (!settled) {
        return reply.code(409).send({ error: `Oracle ${oracleId} has not settled yet` });
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

      return reply.send({
        digest: result.digest,
        positionId,
        owner,
        repaidDebt: marginDebt.toString(),
        withdrawnCollateral: collateralSui.toString(),
      });
    },
  );
}
