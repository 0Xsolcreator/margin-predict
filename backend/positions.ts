// User-facing position lifecycle. All routes are custodial: the held zkLogin
// key signs and Enoki sponsors gas. On-chain user moves (request_open /
// request_close / cancel_intent) go through runTx; keeper-side orchestration
// (the actual borrow/swap/deploy/unwind) is proxied to the keeper service.
//
//   POST /positions               place bet  (request_open + keeper open)
//   GET  /positions               list the caller's positions
//   GET  /positions/:id           single position + health
//   POST /positions/:id/close     request_close + keeper close
//   POST /positions/:id/withdraw  cancel_intent (claw back escrow / cancel close)

import type { FastifyInstance } from 'fastify';
import { Transaction } from '@mysten/sui/transactions';
import { authed, runTx, sui } from './index.ts';
import {
  buildRequestOpen, buildRequestClose, buildCancelIntent, keeper,
} from './protocol.ts';

interface PlaceBetBody {
  oracleId: string;
  expiry: string | number;
  strike: string | number;
  isUp?: boolean;
  collateralSui: number;
  leverageBps: number;
}

/** Finds the MarginPosition created by a request_open tx. */
async function createdPositionId(digest: string): Promise<string> {
  const r = await sui.waitForTransaction({ digest, include: { effects: true, objectTypes: true } });
  const t = r.Transaction ?? r.FailedTransaction;
  const types = t?.objectTypes ?? {};
  const created = (t?.effects?.changedObjects ?? []).find(
    (o) => o.idOperation === 'Created' && (types[o.objectId] ?? '').includes('margin_position::MarginPosition'),
  );
  if (!created) throw new Error('MarginPosition not found in open transaction');
  return created.objectId;
}

export function registerPositionRoutes(app: FastifyInstance): void {
  // Place bet: escrow collateral on-chain, then have the keeper open the position.
  app.post<{ Body: PlaceBetBody }>('/positions', async (req, reply) => {
    const s = authed(req);
    const b = req.body ?? ({} as PlaceBetBody);
    if (!b.oracleId || b.collateralSui == null || b.leverageBps == null) {
      return reply.code(400).send({ error: 'oracleId, collateralSui, leverageBps are required' });
    }

    const tx = new Transaction();
    buildRequestOpen(tx, {
      oracleId: b.oracleId,
      expiry: BigInt(b.expiry),
      strike: BigInt(b.strike),
      isUp: b.isUp !== false,
      collateralMist: BigInt(Math.round(b.collateralSui * 1e9)),
      leverageBps: b.leverageBps,
    });
    const { digest } = await runTx(s, tx);
    const positionId = await createdPositionId(digest);

    const open = await keeper('POST', `/positions/${positionId}/open`, {
      leverageBps: b.leverageBps,
      oracleId: b.oracleId,
    });
    return { positionId, requestDigest: digest, open };
  });

  // List the caller's positions (keeper tracks all; filter to this owner).
  app.get('/positions', async (req) => {
    const s = authed(req);
    const all = await keeper<Array<{ owner: string }>>('GET', '/positions');
    return all.filter((p) => p.owner === s.address);
  });

  // Single position state + health (health needs the oracleId it was opened on).
  app.get<{ Params: { id: string }; Querystring: { oracleId?: string } }>(
    '/positions/:id',
    async (req) => {
      authed(req);
      const { id } = req.params;
      const position = await keeper<{ status: string }>('GET', `/positions/${id}`);
      if (position.status === 'OPEN' && req.query.oracleId) {
        const health = await keeper('GET', `/positions/${id}/health?oracleId=${req.query.oracleId}`);
        return { ...position, ...(health as object) };
      }
      return position;
    },
  );

  // Close: record the close intent on-chain, then have the keeper unwind.
  app.post<{ Params: { id: string }; Body: { oracleId: string } }>(
    '/positions/:id/close',
    async (req, reply) => {
      const s = authed(req);
      const { id } = req.params;
      const { oracleId } = req.body ?? {};
      if (!oracleId) return reply.code(400).send({ error: 'oracleId is required' });

      const tx = new Transaction();
      buildRequestClose(tx, id);
      const { digest } = await runTx(s, tx);

      const close = await keeper('POST', `/positions/${id}/close`, { oracleId });
      return { positionId: id, requestDigest: digest, close };
    },
  );

  // Withdraw / cancel: claw back escrowed SUI on a stuck pending-open, or cancel
  // a pending close. On-chain enforces the 120s timeout.
  app.post<{ Params: { id: string } }>('/positions/:id/withdraw', async (req) => {
    const s = authed(req);
    const tx = new Transaction();
    buildCancelIntent(tx, req.params.id, s.address);
    const { digest } = await runTx(s, tx);
    return { positionId: req.params.id, digest };
  });

  // PUBLIC monitor: every OPEN position with live health, sorted most-at-risk
  // first; each flags whether it's liquidatable. No session.
  app.get('/monitor', async () => keeper('GET', '/monitor'));

  // Liquidate: PUBLIC, no session. Anyone can trigger liquidation of an unhealthy
  // position — the keeper signs it from its own wallet and earns the on-chain
  // reporter fee. oracleId is optional (the keeper resolves the position's oracle
  // from chain). Returns 409 if the position is still healthy.
  app.post<{ Params: { id: string }; Body: { oracleId?: string } }>(
    '/positions/:id/liquidate',
    async (req) => {
      const { id } = req.params;
      const oracleId = req.body?.oracleId;
      return keeper('POST', `/positions/${id}/liquidate`, oracleId ? { oracleId } : undefined);
    },
  );
}
