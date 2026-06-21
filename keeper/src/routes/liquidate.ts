/// POST /positions/:positionId/liquidate
///
/// Liquidates an OPEN position whose health factor has dropped ≤ HF_SOFT_BPS.
/// The actual flag + execute logic lives in ../liquidation.ts (shared with the
/// background monitor); this route just maps its outcome to HTTP.
///
/// - Hard (hf ≤ 1.00x): closes the full position, repays full debt, withdraws
///   all SUI collateral, clears the tracked record.
/// - Soft (hf ≤ 1.05x): closes 25% of the position, repays 25% of debt, leaves
///   SUI collateral in place, updates the tracked record.

import type { FastifyInstance } from 'fastify';
import { HF_SOFT_BPS } from '../config.js';
import { liquidatePosition } from '../liquidation.js';

export function registerLiquidateRoute(app: FastifyInstance): void {
  app.post<{ Params: { positionId: string }; Body: { oracleId: string } }>(
    '/positions/:positionId/liquidate',
    async (request, reply) => {
      const { positionId } = request.params;
      // oracleId is optional: the service uses the position's tracked oracle and
      // only falls back to this for pre-tracking records.
      const { oracleId } = request.body ?? {};

      const out = await liquidatePosition(positionId, oracleId);
      switch (out.status) {
        case 'not_tracked':
          return reply.code(404).send({ error: `Position ${positionId} not tracked` });
        case 'misconfigured':
          return reply.code(500).send({ error: out.error });
        case 'healthy':
          return reply.code(409).send({
            error: `Position is healthy (hf=${out.healthFactorBps} > ${HF_SOFT_BPS})`,
            healthFactorBps: out.healthFactorBps,
          });
        case 'liquidated': {
          const { status, ...body } = out;
          return reply.send(body);
        }
      }
    },
  );
}
