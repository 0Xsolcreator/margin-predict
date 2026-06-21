/// Read-only visibility into tracked positions and their on-chain state.
///
/// GET /positions            — list all tracked positions with live on-chain state
/// GET /positions/:id        — get a single position's live on-chain state
/// GET /positions/:id/health — live health factor from chain

import type { FastifyInstance } from 'fastify';
import { loadKeypair, createGrpcClient } from '../chain/client.js';
import { readHealthFactor, readPositionFinancials } from '../chain/contract.js';
import { getPosition, listPositions } from '../store/positions.js';

const STATUS_NAMES = ['PENDING_OPEN', 'OPEN', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];

export function registerPositionRoutes(app: FastifyInstance): void {
  app.get('/positions', async () => {
    const keypair = loadKeypair();
    const base = createGrpcClient();
    const address = keypair.toSuiAddress();

    const entries = Object.entries(listPositions());
    return Promise.all(
      entries.map(async ([positionId, record]) => {
        const { status, marginDebt, collateralSui } = await readPositionFinancials(base, address, positionId);
        return {
          positionId,
          owner: record.owner,
          oracleId: record.oracleId ?? null,
          updatedAt: record.updatedAt,
          status: STATUS_NAMES[status] ?? status,
          marginDebt: marginDebt.toString(),
          collateralSui: collateralSui.toString(),
        };
      }),
    );
  });

  app.get<{ Params: { positionId: string } }>(
    '/positions/:positionId',
    async (request, reply) => {
      const { positionId } = request.params;
      const record = getPosition(positionId);
      if (!record) return reply.code(404).send({ error: `Position ${positionId} not tracked` });

      const keypair = loadKeypair();
      const base = createGrpcClient();
      const { status, marginDebt, collateralSui } = await readPositionFinancials(base, keypair.toSuiAddress(), positionId);

      return {
        positionId,
        owner: record.owner,
        oracleId: record.oracleId ?? null,
        updatedAt: record.updatedAt,
        status: STATUS_NAMES[status] ?? status,
        marginDebt: marginDebt.toString(),
        collateralSui: collateralSui.toString(),
      };
    },
  );

  app.get<{ Params: { positionId: string }; Querystring: { oracleId?: string } }>(
    '/positions/:positionId/health',
    async (request, reply) => {
      const { positionId } = request.params;
      const { oracleId } = request.query;

      if (!oracleId) return reply.code(400).send({ error: 'oracleId query parameter is required' });

      const record = getPosition(positionId);
      if (!record) return reply.code(404).send({ error: `Position ${positionId} not tracked` });

      const keypair = loadKeypair();
      const base = createGrpcClient();
      const hf = await readHealthFactor(base, keypair.toSuiAddress(), positionId, oracleId);

      return { positionId, healthFactorBps: hf.toString() };
    },
  );
}
