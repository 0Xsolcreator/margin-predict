/// POST /positions/:positionId/open
///
/// Completes a pending-open MarginPosition<DUSDC> in one atomic PTB:
///   1. Withdraw escrowed SUI (collateral C).
///   2. Deposit C into the shared SUI/DBUSDC MarginManager.
///   3. Borrow B = C_value × (leverage − 1) DBUSDC against it.
///   4. Swap B (DBUSDC) → DUSDC.
///   5. Deploy swapped DUSDC into a new Predict position, confirming OPEN.
///
/// C stays locked in the MarginManager as loan collateral; only B is deployed.

import type { FastifyInstance } from 'fastify';
import { Transaction } from '@mysten/sui/transactions';
import {
  DBUSDC_COIN,
  MARGIN_MANAGER_KEY,
  SWAP_SLIPPAGE_BPS,
  SWAP_DEEP_AMOUNT,
  getSwapPool,
  requireMarginManagerId,
} from '../config.js';
import {
  loadKeypair,
  createGrpcClient,
  createMarginClient,
  createSwapClient,
  injectPythPrices,
  fetchSuiPrice,
} from '../chain/client.js';
import { readPositionContext, buildTakeEscrow, buildDeployPosition } from '../chain/contract.js';
import { buildSwapStep } from '../deepbook/swap.js';
import { assertValidLeverageBps, computeBorrowAmount } from '../math/leverage.js';
import { setPosition } from '../store/positions.js';
import { executeTransaction } from '../chain/transaction.js';

interface OpenBody {
  leverageBps: number;
  oracleId: string;
}

export function registerOpenRoute(app: FastifyInstance): void {
  app.post<{ Params: { positionId: string }; Body: OpenBody }>(
    '/positions/:positionId/open',
    async (request, reply) => {
      const { positionId } = request.params;
      const { leverageBps, oracleId } = request.body ?? ({} as OpenBody);

      if (!oracleId) return reply.code(400).send({ error: 'oracleId is required' });
      assertValidLeverageBps(leverageBps);

      const swapPool = getSwapPool();
      if (!swapPool) return reply.code(500).send({ error: 'DUSDC_DBUSDC_POOL_ID not configured' });

      const marginManagerId = requireMarginManagerId();
      const keypair = loadKeypair();
      const address = keypair.toSuiAddress();
      const base = createGrpcClient();

      const { owner, escrowValue } = await readPositionContext(base, address, positionId);
      if (escrowValue <= 0n) {
        return reply.code(409).send({ error: 'No escrowed SUI — already opened or cancelled?' });
      }

      const suiPrice = await fetchSuiPrice();
      const collateralSui = Number(escrowValue) / 1e9;
      const borrowHuman = computeBorrowAmount(collateralSui * suiPrice, leverageBps);
      if (borrowHuman <= 0) {
        return reply.code(422).send({ error: 'Computed DBUSDC borrow amount is zero' });
      }

      const marginClient = createMarginClient(base, address);
      const swapClient = createSwapClient(base, address);

      const quote = await swapClient.deepbook.getBaseQuantityOutInputFee(swapPool.key, borrowHuman);
      const minDusdcOut = quote.baseOut * (1 - SWAP_SLIPPAGE_BPS / 10_000);

      const tx = new Transaction();
      await injectPythPrices(base, tx, address);

      // 1. Withdraw escrowed SUI
      const suiCoin = buildTakeEscrow(tx, positionId);

      // 2. Deposit SUI into the shared MarginManager
      marginClient.deepbook.marginManager.depositBase({ managerKey: MARGIN_MANAGER_KEY, coin: suiCoin })(tx);

      // 3. Borrow DBUSDC against it
      marginClient.deepbook.marginManager.borrowQuote(MARGIN_MANAGER_KEY, borrowHuman)(tx);
      const dbusdcCoin = marginClient.deepbook.marginManager.withdrawQuote(MARGIN_MANAGER_KEY, borrowHuman)(tx);

      // 4. Swap DBUSDC → DUSDC
      const [dusdcOut, dbusdcLeftover, deepLeftover] = buildSwapStep({
        client: swapClient,
        poolKey: swapPool.key,
        direction: 'quoteToBase',
        amount: borrowHuman,
        minOut: minDusdcOut,
        deepAmount: SWAP_DEEP_AMOUNT,
        inputCoin: dbusdcCoin,
      })(tx);
      tx.transferObjects([dbusdcLeftover, deepLeftover], address);

      // 5. Deploy into Predict, confirm OPEN
      const marginDebt = BigInt(Math.round(borrowHuman * DBUSDC_COIN.scalar));
      buildDeployPosition(tx, positionId, oracleId, dusdcOut, marginManagerId, marginDebt);

      const result = await executeTransaction(marginClient, keypair, tx, 'Open position');

      setPosition(positionId, {
        owner,
        updatedAt: new Date().toISOString(),
      });

      return reply.send({
        digest: result.digest,
        positionId,
        owner,
        leverageBps,
        collateralSui: escrowValue.toString(),
        marginManagerId,
        marginDebt: marginDebt.toString(),
      });
    },
  );
}
