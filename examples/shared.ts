// Shared config, clients, and helpers for all example scripts.

import 'dotenv/config';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';

// ── Protocol constants (testnet) ─────────────────────────────────────────────

// deepbook_predict package — home of MarketKey, Predict, PredictManager
export const PREDICT_PACKAGE = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
// Predict shared object (global singleton)
export const PREDICT_ID      = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
export const CLOCK_ID        = '0x6';
export const DUSDC_TYPE      = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';

// ── User-supplied environment ────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} must be set in examples/.env`);
  return v;
}

export const MARGIN_PREDICT_PACKAGE = required('MARGIN_PREDICT_PACKAGE');
export const PREDICT_MANAGER_ID     = required('PREDICT_MANAGER_ID');
export const KEEPER_URL             = process.env.KEEPER_URL?.trim() ?? 'http://localhost:4000';
export const NETWORK                = (process.env.NETWORK ?? 'testnet') as 'testnet' | 'mainnet';

// ── Chain client ─────────────────────────────────────────────────────────────

export function createSuiClient(): SuiJsonRpcClient {
  const url = process.env.RPC_URL?.trim() ?? getJsonRpcFullnodeUrl(NETWORK);
  return new SuiJsonRpcClient({ url, network: NETWORK });
}

// ── User wallet ──────────────────────────────────────────────────────────────

export function loadUserKeypair(): Ed25519Keypair {
  const key = process.env.USER_PRIVATE_KEY?.trim();
  if (!key) throw new Error('USER_PRIVATE_KEY must be set in examples/.env');

  // Bech32 format: suiprivkey1... (note the "1" after "suiprivkey")
  if (key.startsWith('suiprivkey')) {
    try {
      return Ed25519Keypair.fromSecretKey(key);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `USER_PRIVATE_KEY starts with "suiprivkey" but failed bech32 decode: ${detail}\n` +
        `Expected format: suiprivkey1... (the "1" after "suiprivkey" is required).\n` +
        `Export your key with:  sui keytool export --key-identity <your-address>`,
      );
    }
  }

  // Legacy: base64-encoded 33-byte key [scheme_byte | 32 raw bytes]
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length === 33) return Ed25519Keypair.fromSecretKey(bytes.subarray(1));
  if (bytes.length === 32) return Ed25519Keypair.fromSecretKey(bytes);

  throw new Error(
    `USER_PRIVATE_KEY format not recognized (base64 decoded to ${bytes.length} bytes, expected 32 or 33).\n` +
    `Use:  sui keytool export --key-identity <your-address>  and paste the "suiprivkey1..." output.`,
  );
}

// ── Oracle / market params ───────────────────────────────────────────────────

export interface OracleParams {
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
}

export function getOracleParams(): OracleParams {
  const oracleId  = process.env.ORACLE_ID?.trim();
  const expiryStr = process.env.ORACLE_EXPIRY?.trim();
  const strikeStr = process.env.ORACLE_STRIKE?.trim();
  if (!oracleId || !expiryStr || !strikeStr) {
    throw new Error('ORACLE_ID, ORACLE_EXPIRY, and ORACLE_STRIKE must be set in examples/.env');
  }
  return {
    oracleId,
    expiry: BigInt(expiryStr),
    strike: BigInt(strikeStr),
    isUp: process.env.IS_UP?.trim() !== 'false',
  };
}

export function getPositionParams() {
  return {
    collateralSui: parseFloat(process.env.COLLATERAL_SUI ?? '1.0'),
    leverageBps:   parseInt(process.env.LEVERAGE_BPS ?? '12000', 10),
  };
}

// ── Execute a signed PTB ─────────────────────────────────────────────────────

// JSON-RPC returns `effects.status.status: 'success' | 'failure'`
export interface TxResult {
  digest: string;
  effects: {
    status: { status: 'success' | 'failure'; error?: string };
  } | null | undefined;
  objectChanges: Array<{ type: string; objectId: string; objectType: string }> | null | undefined;
}

export async function signAndExecute(
  client: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  tx: Transaction,
  label: string,
): Promise<TxResult> {
  log(`Submitting: ${label}`);
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showEffects: true,
      showObjectChanges: true,
      showEvents: true,
    },
  }) as TxResult;

  await client.waitForTransaction({ digest: result.digest });

  if (result.effects?.status.status !== 'success') {
    throw new Error(`${label} failed: ${result.effects?.status.error ?? 'unknown'}`);
  }
  log(`Confirmed: ${label} — digest: ${result.digest}`);
  return result;
}

// ── Find a newly created MarginPosition in tx output ─────────────────────────

export function extractPositionId(result: TxResult): string {
  const change = (result.objectChanges ?? []).find(
    (c) => c.type === 'created' && c.objectType.includes('margin_position::MarginPosition'),
  );
  if (!change) throw new Error('MarginPosition not found in transaction objectChanges');
  return change.objectId;
}

// ── Keeper API helpers ───────────────────────────────────────────────────────

export async function keeperPost<T = unknown>(path: string, body: object): Promise<T> {
  const res = await fetch(`${KEEPER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json() as T;
  if (!res.ok) throw new Error(`Keeper POST ${path} (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

export async function keeperGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${KEEPER_URL}${path}`);
  const data = await res.json() as T;
  if (!res.ok) throw new Error(`Keeper GET ${path} (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

// ── SUI/USD price (for valuing SUI collateral, same source as the keeper) ─────

const PYTH_HERMES = NETWORK === 'mainnet' ? 'https://hermes.pyth.network' : 'https://hermes-beta.pyth.network';
const SUI_FEED_ID = NETWORK === 'mainnet'
  ? '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744'
  : '0x50c67b3fd225db8912a424dd4baed60ffdde625ed2feaaf283724f9608fea266';

/** Live SUI/USD from Pyth Hermes. null if unreachable (callers degrade gracefully). */
export async function fetchSuiUsdPrice(): Promise<number | null> {
  try {
    const res = await fetch(`${PYTH_HERMES}/api/latest_price_feeds?ids[]=${SUI_FEED_ID}`);
    if (!res.ok) return null;
    const [feed] = (await res.json()) as Array<{ price?: { price: string; expo: number } }>;
    const price = feed?.price ? Number(feed.price.price) * 10 ** Number(feed.price.expo) : NaN;
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

// ── BCS decode (devInspect return values) ────────────────────────────────────

/** Decodes a little-endian BCS u64 (as returned by devInspect returnValues). */
export function decodeU64(bytes: number[] | Uint8Array): bigint {
  let result = 0n;
  for (let i = 7; i >= 0; i--) result = (result << 8n) | BigInt(bytes[i]);
  return result;
}

// ── Logging ──────────────────────────────────────────────────────────────────

export function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export function printResult(label: string, data: unknown) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
  console.log(JSON.stringify(data, null, 2));
  console.log('─'.repeat(60) + '\n');
}
