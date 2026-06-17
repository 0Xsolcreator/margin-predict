// Oracle indexer client — fetches live market data from the MystenLabs predict
// server. Pure HTTP, no chain client needed.
//
// Adapted from preview-functions/scripts/predict/lib.ts

import { PREDICT_ID } from './shared.ts';

const INDEXER = 'https://predict-server.testnet.mystenlabs.com';

export const FLOAT_SCALING            = 1_000_000_000; // strikes & prices are 1e9 fixed-point
export const ORACLE_STRIKE_GRID_TICKS = 100_000;       // ticks per oracle grid

export type OracleStatus = 'inactive' | 'active' | 'pending_settlement' | 'settled';

export interface OracleSummary {
  oracle_id: string;
  underlying_asset: string;
  expiry: number;         // ms UTC timestamp
  min_strike: number;     // 1e9 fixed-point USD
  tick_size: number;      // 1e9 fixed-point USD
  status: OracleStatus;
  settlement_price: number | null;
}

export interface OracleStateResponse {
  oracle: OracleSummary;
  latest_price: {
    spot: number;          // 1e9 fixed-point
    forward: number;       // 1e9 fixed-point
    onchain_timestamp: number;
  } | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${INDEXER}${path}`);
  if (!res.ok) throw new Error(`Indexer ${path} → ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function fetchActiveOracles(): Promise<OracleSummary[]> {
  const all = await getJson<OracleSummary[]>(`/predicts/${PREDICT_ID}/oracles`);
  return all
    .filter((o) => o.status === 'active')
    .sort((a, b) => a.expiry - b.expiry);
}

export async function fetchOracleState(oracleId: string): Promise<OracleStateResponse> {
  return getJson<OracleStateResponse>(`/oracles/${oracleId}/state`);
}

// ── Strike grid ───────────────────────────────────────────────────────────────

export function strikeRange(oracle: OracleSummary) {
  const min  = fixedToUsd(oracle.min_strike);
  const tick = fixedToUsd(oracle.tick_size);
  const max  = min + tick * ORACLE_STRIKE_GRID_TICKS;
  return { min, max, tick };
}

export function snapToTick(usd: number, min: number, tick: number): number {
  return Math.round((usd - min) / tick) * tick + min;
}

export function isOnGrid(usd: number, min: number, tick: number): boolean {
  return Math.abs(((usd - min) / tick) - Math.round((usd - min) / tick)) < 1e-6;
}

// ── Conversions ───────────────────────────────────────────────────────────────

export const fixedToUsd = (raw: number): number => raw / FLOAT_SCALING;
export const usdToFixed = (usd: number): bigint => BigInt(Math.round(usd * FLOAT_SCALING));

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function formatExpiry(ms: number): string {
  const date = new Date(ms).toISOString();
  const mins = (ms - Date.now()) / 60_000;
  if (mins <= 0)  return `${date} (expired)`;
  if (mins < 60)  return `${date} (in ${mins.toFixed(1)} min)`;
  return `${date} (in ${(mins / 60).toFixed(1)} hr)`;
}
