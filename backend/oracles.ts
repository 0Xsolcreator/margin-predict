// Oracle market data — proxied from the MystenLabs predict indexer. Public,
// no auth. GET /oracles (active markets) and GET /oracles/:id (single state).

import type { FastifyInstance } from 'fastify';

const INDEXER = process.env.PREDICT_INDEXER?.trim() || 'https://predict-server.testnet.mystenlabs.com';
// The indexer keys oracles by the on-chain Predict singleton, not the package.
const PREDICT_ID = process.env.PREDICT_ID?.trim() || '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';

interface OracleSummary {
  oracle_id: string;
  status: 'inactive' | 'active' | 'pending_settlement' | 'settled';
  expiry: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${INDEXER}${path}`);
  if (!res.ok) throw new Error(`Indexer ${path} -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function registerOracleRoutes(app: FastifyInstance): void {
  // Active markets, soonest expiry first. ?all=1 returns every status.
  app.get<{ Querystring: { all?: string } }>('/oracles', async (req) => {
    const all = await getJson<OracleSummary[]>(`/predicts/${PREDICT_ID}/oracles`);
    const list = req.query.all ? all : all.filter((o) => o.status === 'active');
    return list.sort((a, b) => a.expiry - b.expiry);
  });

  app.get<{ Params: { oracleId: string } }>('/oracles/:oracleId', async (req) => {
    return getJson(`/oracles/${req.params.oracleId}/state`);
  });
}
