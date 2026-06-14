/// POST /positions/:positionId/liquidate
///
/// Liquidates an OPEN position whose health factor has dropped ≤ HF_SOFT_BPS.
///
/// - Hard (hf ≤ 1.00x): closes the full position, repays full debt, withdraws
///   all SUI collateral, clears the tracked record.
/// - Soft (hf ≤ 1.05x): closes 25% of the position, repays 25% of debt, leaves
///   SUI collateral in place, updates the tracked record.
///
/// The keeper self-reports the liquidation flag if no one else has yet,
/// earning the on-chain reporter fee directly to its wallet.

import type { FastifyInstance } from 'fastify';
import { Transaction } from '@mysten/sui/transactions';
import { HF_HARD_BPS, HF_SOFT_BPS, getSwapPool } from '../config.js';
import {
  loadKeypair,
  createGrpcClient,
  createMarginClient,
  createSwapClient,
  injectPythPrices,
} from '../chain/client.js';
import {
  readHealthFactor,
  readLiquidationFlagged,
  buildFlagLiquidation,
  buildExecuteLiquidation,
} from '../chain/contract.js';
import { unwindPosition } from '../deepbook/unwind.js';
import { computeSoftLiqDebt } from '../math/leverage.js';
import { getPosition, setPosition, deletePosition } from '../store/positions.js';
import { executeTransaction } from '../chain/transaction.js';

export function registerLiquidateRoute(app: FastifyInstance): void {
  app.post<{ Params: { positionId: string }; Body: { oracleId: string } }>(
    '/positions/:positionId/liquidate',
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

      const hf = await readHealthFactor(base, address, positionId, oracleId);
      if (hf > HF_SOFT_BPS) {
        return reply.code(409).send({
          error: `Position is healthy (hf=${hf} > ${HF_SOFT_BPS})`,
          healthFactorBps: hf.toString(),
        });
      }

      const isHard = hf <= HF_HARD_BPS;
      const alreadyFlagged = await readLiquidationFlagged(base, address, positionId);

      const currentDebt = BigInt(record.marginDebt);
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
        withdrawSuiAmount: isHard ? BigInt(record.collateralSui) : 0n,
        recipient: record.owner,
        keeperAddress: address,
      });

      const result = await executeTransaction(marginClient, keypair, tx, 'Liquidate position');

      if (isHard) {
        deletePosition(positionId);
      } else {
        setPosition(positionId, {
          ...record,
          marginDebt: newDebt.toString(),
          updatedAt: new Date().toISOString(),
        });
      }

      return reply.send({
        digest: result.digest,
        positionId,
        owner: record.owner,
        mode: isHard ? 'hard' : 'soft',
        healthFactorBps: hf.toString(),
        repaidDebt: repayAmount.toString(),
        remainingDebt: newDebt.toString(),
        withdrawnCollateral: isHard ? record.collateralSui : '0',
      });
    },
  );
}
