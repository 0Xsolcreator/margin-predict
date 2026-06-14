/// Read-only visibility into tracked positions and their on-chain health.
///
/// GET /positions            — list all tracked positions
/// GET /positions/:id        — get a single position record
/// GET /positions/:id/health — live health factor from chain

import type { FastifyInstance } from 'fastify';
import { loadKeypair, createGrpcClient } from '../chain/client.js';
import { readHealthFactor } from '../chain/contract.js';
import { getPosition, listPositions } from '../store/positions.js';

export function registerPositionRoutes(app: FastifyInstance): void {
  app.get('/positions', async () => listPositions());

  app.get<{ Params: { positionId: string } }>(
    '/positions/:positionId',
    async (request, reply) => {
      const { positionId } = request.params;
      const record = getPosition(positionId);
      if (!record) return reply.code(404).send({ error: `Position ${positionId} not tracked` });
      return record;
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
