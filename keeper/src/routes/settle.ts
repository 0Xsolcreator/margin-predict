/// POST /positions/:positionId/settle
///
/// Same as /close but for a position whose market has expired and settled.
/// Delegates to ../settlement.ts (shared with the background monitor), which
/// resolves the position's own oracle, verifies it has settled, then redeems +
/// repays + returns collateral to the owner.

import type { FastifyInstance } from 'fastify';
import { settlePosition } from '../settlement.js';

export function registerSettleRoute(app: FastifyInstance): void {
  app.post<{ Params: { positionId: string }; Body: { oracleId?: string } }>(
    '/positions/:positionId/settle',
    async (request, reply) => {
      const { positionId } = request.params;

      const out = await settlePosition(positionId, request.body?.oracleId);
      switch (out.status) {
        case 'not_tracked':
          return reply.code(404).send({ error: `Position ${positionId} not tracked` });
        case 'misconfigured':
          return reply.code(500).send({ error: out.error });
        case 'not_settled':
          return reply.code(409).send({ error: `Oracle ${out.oracleId} has not settled yet` });
        case 'settled': {
          const { status, ...body } = out;
          return reply.send(body);
        }
      }
    },
  );
}
