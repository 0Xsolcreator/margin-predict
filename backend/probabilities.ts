// Strike probability oracle.
// Probes the on-chain DeepBook Predict AMM via devInspectTransactionBlock to
// get the entry premium (= implied probability) for each strike in the ±50
// tick window around the current spot price.
//
// Uses batched RPC: jobs are processed in sequential groups of BATCH_SIZE,
// with calls inside each group running in parallel. Deep-OTM strikes abort the
// devInspect call and are silently returned as null (filtered client-side).
//
// Results are cached per (oracleId, centerTick) for CACHE_TTL ms so rapid
// frontend polls don't hammer the RPC node.

import type { FastifyInstance } from 'fastify';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { NETWORK } from './index.ts';

// deepbook_predict package — same constants as examples/shared.ts
const PREDICT_PACKAGE = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID      = process.env.PREDICT_ID?.trim()      || '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const CLOCK_ID        = '0x6';
const INDEXER         = process.env.PREDICT_INDEXER?.trim() || 'https://predict-server.testnet.mystenlabs.com';

const PROBE        = 1_000_000n;   // $1 notional in 6dp — mirrors run_e2e.ts
const BATCH_SIZE   = 10;
const CACHE_TTL    = 10_000;       // ms
const FLOAT_SCALE  = 1_000_000_000;
const GRID_TICKS   = 100_000;
const WINDOW       = 50;           // ±50 ticks around spot
const DUMMY_SENDER = '0x0000000000000000000000000000000000000000000000000000000000000000';

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeU64(bytes: number[] | Uint8Array): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

function rpcClient(): SuiJsonRpcClient {
  const url = process.env.SUI_RPC_URL?.trim() || getJsonRpcFullnodeUrl(NETWORK);
  return new SuiJsonRpcClient({ url });
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface ProbEntry { strike: number; up: number | null; down: number | null }
interface CacheSlot { ts: number; data: ProbEntry[] }
const cache = new Map<string, CacheSlot>();

function cachePut(key: string, data: ProbEntry[]): void {
  cache.set(key, { ts: Date.now(), data });
}
function cacheGet(key: string): ProbEntry[] | null {
  const e = cache.get(key);
  if (!e || Date.now() - e.ts > CACHE_TTL) { cache.delete(key); return null; }
  return e.data;
}

// ── Core probe ────────────────────────────────────────────────────────────────

async function probeOne(
  client: SuiJsonRpcClient,
  oracleId: string,
  expiry: bigint,
  strikeFixed: bigint,
  dir: 'up' | 'down',
): Promise<number | null> {
  try {
    const tx = new Transaction();
    tx.setSender(DUMMY_SENDER);
    const key = tx.moveCall({
      target: `${PREDICT_PACKAGE}::market_key::${dir}`,
      arguments: [tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strikeFixed)],
    });
    tx.moveCall({
      target: `${PREDICT_PACKAGE}::predict::get_trade_amounts`,
      arguments: [
        tx.object(PREDICT_ID),
        tx.object(oracleId),
        key,
        tx.pure.u64(PROBE),
        tx.object(CLOCK_ID),
      ],
    });
    const res = await client.devInspectTransactionBlock({
      sender: DUMMY_SENDER,
      transactionBlock: tx,
    });
    const raw = res.results?.[1]?.returnValues?.[0]?.[0];
    if (!raw) return null;
    const pct = Number(decodeU64(raw)) / Number(PROBE);
    return pct > 0 && pct <= 1 ? pct : null;
  } catch {
    return null;
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export function registerProbabilityRoutes(app: FastifyInstance): void {
  app.get<{
    Params: { oracleId: string };
    Querystring: { spot?: string };
  }>('/oracles/:oracleId/probabilities', async (req, reply) => {
    const { oracleId } = req.params;

    // Fetch oracle grid params from indexer
    const stateRes = await fetch(`${INDEXER}/oracles/${oracleId}/state`);
    if (!stateRes.ok) return reply.code(502).send({ error: 'Failed to fetch oracle state' });
    const { oracle, latest_price } = await stateRes.json() as {
      oracle: { min_strike: number; tick_size: number; expiry: number };
      latest_price: { spot: number } | null;
    };

    const minFixed  = oracle.min_strike;
    const tickFixed = oracle.tick_size;
    const minUsd    = minFixed  / FLOAT_SCALE;
    const tickUsd   = tickFixed / FLOAT_SCALE;
    const expiry    = BigInt(oracle.expiry);

    const rawSpot = req.query.spot ? parseFloat(req.query.spot) : null;
    const spotUsd = rawSpot ?? (latest_price ? latest_price.spot / FLOAT_SCALE : null);
    if (spotUsd == null) return reply.code(422).send({ error: 'spot price unavailable' });

    // Snap spot to the tick grid and use as center of the query window
    const centerIdx = Math.round((spotUsd - minUsd) / tickUsd);
    const cacheKey = `${oracleId}:${centerIdx}`;
    const hit = cacheGet(cacheKey);
    if (hit) return { probabilities: hit };

    // Enumerate ±WINDOW ticks, clamped to the oracle's grid bounds
    const strikes: bigint[] = [];
    for (let i = -WINDOW; i <= WINDOW; i++) {
      const idx = centerIdx + i;
      if (idx < 0 || idx >= GRID_TICKS) continue;
      strikes.push(BigInt(Math.round(minFixed + idx * tickFixed)));
    }

    // Build flat job list: [up₀, down₀, up₁, down₁, ...]
    type Job = { strikeFixed: bigint; dir: 'up' | 'down' };
    const jobs: Job[] = strikes.flatMap(s => [
      { strikeFixed: s, dir: 'up'   as const },
      { strikeFixed: s, dir: 'down' as const },
    ]);

    // Sequential batches, parallel within each batch
    const client = rpcClient();
    const flat: (number | null)[] = [];
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const batch = jobs.slice(i, i + BATCH_SIZE);
      const settled = await Promise.allSettled(
        batch.map(({ strikeFixed, dir }) => probeOne(client, oracleId, expiry, strikeFixed, dir)),
      );
      for (const r of settled) {
        flat.push(r.status === 'fulfilled' ? r.value : null);
      }
    }

    // Pair results back to strikes — jobs are interleaved [up, down] per strike
    const probabilities: ProbEntry[] = strikes.map((s, i) => ({
      strike: Number(s) / FLOAT_SCALE,
      up:   flat[i * 2]     ?? null,
      down: flat[i * 2 + 1] ?? null,
    }));

    cachePut(cacheKey, probabilities);
    return { probabilities };
  });
}
