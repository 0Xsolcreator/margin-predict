/// Read-only visibility into tracked positions and their on-chain state.
///
/// GET /positions            — list all tracked positions with live on-chain state
/// GET /positions/:id        — get a single position's live on-chain state
/// GET /positions/:id/health — live health factor from chain

import type { FastifyInstance } from 'fastify';
import { HF_HARD_BPS, HF_SOFT_BPS } from '../config.js';
import { loadKeypair, createGrpcClient } from '../chain/client.js';
import { readHealthFactor, readPositionFinancials } from '../chain/contract.js';
import { readPositionOracleId } from '../chain/positionOracle.js';
import { getPosition, listPositions } from '../store/positions.js';

const STATUS_NAMES = ['PENDING_OPEN', 'OPEN', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];
const OPEN_STATUS = 1;

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

  // Public monitor: every OPEN position with its live health, sorted ascending
  // (closest to liquidation first). `liquidatable` is true at/under the soft
  // threshold. Heavier than /positions (health read per position) — meant for
  // liquidator polling, not the trading UI.
  app.get('/monitor', async () => {
    const keypair = loadKeypair();
    const base = createGrpcClient();
    const address = keypair.toSuiAddress();

    type Row = {
      positionId: string; owner: string; oracleId: string | null;
      mode: 'hard' | 'soft' | 'healthy' | 'expired';
      liquidatable: boolean; healthFactorBps: string | null;
      marginDebt: string; collateralSui: string; hf: number;
    };
    const rows: Row[] = [];
    for (const [positionId, record] of Object.entries(listPositions())) {
      try {
        const { status, marginDebt, collateralSui } = await readPositionFinancials(base, address, positionId);
        if (status !== OPEN_STATUS) continue;

        const oracleId = record.oracleId ?? (await readPositionOracleId(positionId));
        let mode: Row['mode'] = 'expired';
        let liquidatable = false;
        let healthFactorBps: string | null = null;
        let hf = Number.POSITIVE_INFINITY; // unreadable/expired sort last

        if (oracleId) {
          try {
            const bps = await readHealthFactor(base, address, positionId, oracleId);
            hf = Number(bps);
            healthFactorBps = bps.toString();
            liquidatable = bps <= HF_SOFT_BPS;
            mode = bps <= HF_HARD_BPS ? 'hard' : bps <= HF_SOFT_BPS ? 'soft' : 'healthy';
          } catch { /* oracle likely expired/settled — leave as 'expired' */ }
        }

        rows.push({
          positionId, owner: record.owner, oracleId: oracleId ?? null,
          mode, liquidatable, healthFactorBps,
          marginDebt: marginDebt.toString(), collateralSui: collateralSui.toString(), hf,
        });
      } catch { /* skip positions that can't be read this tick */ }
    }

    rows.sort((a, b) => a.hf - b.hf); // ascending: most at-risk first
    return rows.map(({ hf, ...r }) => r);
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
