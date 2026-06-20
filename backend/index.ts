// Server-custodial Enoki wallet infra for non-crypto onboarding.
//
// The frontend does Google sign-in (just UX — the Google account picker, no
// wallet). Everything else is server-side: the backend holds the zkLogin
// ephemeral key, builds the ZK proof, and signs + executes txns (user pays gas).
//
// Because the backend holds the key, Google sign-in must use a nonce bound to
// it — so the frontend fetches a nonce first, then signs in, then hands back
// the JWT:
//   POST /auth/start                 -> { state, nonce }   (backend makes+keeps the ephemeral key)
//     frontend runs Google sign-in with `nonce` -> id_token (JWT)
//   POST /auth/finish { state, jwt }  -> { sessionToken, address }  (backend makes+keeps the ZK proof)
//   GET  /stats        Bearer         -> on-chain balances
//   POST /tx           Bearer + { transactionKindBytes } -> { digest }
//        backend signs (sender, via the held key + proof) + executes; user's account pays gas.
//
// Tradeoff: this server IS the key custodian. It can move user funds; protect
// this process and its memory accordingly.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { EnokiClient, EnokiClientError } from '@mysten/enoki';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { ChannelCredentials } from '@grpc/grpc-js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import { fromBase64 } from '@mysten/sui/utils';
import type { ZkLoginSignatureInputs } from '@mysten/sui/zklogin';
import { registerPositionRoutes } from './positions.ts';
import { registerOracleRoutes } from './oracles.ts';
import { registerProbabilityRoutes } from './probabilities.ts';

const NETWORK = (process.env.NETWORK ?? 'testnet') as 'mainnet' | 'testnet' | 'devnet';
const RPC_URL = process.env.SUI_RPC_URL || `https://fullnode.${NETWORK}.sui.io:443`;
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const ADDITIONAL_EPOCHS = Number(process.env.ADDITIONAL_EPOCHS ?? 2); // how long the proof/session stays valid (Sui epoch ~24h)
const SECRET = process.env.ENOKI_SECRET_KEY;
if (!SECRET) throw new Error('ENOKI_SECRET_KEY not set in .env');

const enoki = new EnokiClient({ apiKey: SECRET });
// Hosted gRPC (Chainstack/QuickNode) want the token as `x-token` metadata. The
// SuiGrpcClient only forwards baseUrl/fetchInit to its transport and drops a
// top-level `meta`, so build the transport ourselves to attach default metadata
// that's merged into every call. If your provider puts the token in the path
// instead, bake it into SUI_RPC_URL and leave SUI_RPC_TOKEN empty.
const RPC_TOKEN = process.env.SUI_RPC_TOKEN;

// Logs the full request/response for any non-2xx so grpc-web errors aren't opaque.
const debugFetch: typeof fetch = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.clone().text().catch(() => '<no body>');
    const h = init?.headers;
    const ct = h instanceof Headers ? h.get('content-type') : (h as Record<string, string>)?.['content-type'];
    console.error(`[grpc] ${res.status} ${res.statusText} ${url}\n  sent content-type: ${ct}\n  response body: ${body}`);
  }
  return res;
};

// Two wire protocols: hosted providers (Chainstack/QuickNode) speak native gRPC
// over HTTP/2 with an `x-token` header — use GrpcTransport when a token is set.
// The public fullnode speaks gRPC-web over fetch — use that otherwise.
const transport = RPC_TOKEN
  ? new GrpcTransport({
      host: RPC_URL.replace(/^https?:\/\//, ''), // host:port, no scheme
      channelCredentials: ChannelCredentials.createSsl(),
      meta: { 'x-token': RPC_TOKEN },
    })
  : new GrpcWebFetchTransport({ baseUrl: RPC_URL, fetch: debugFetch });

const sui = new SuiGrpcClient({ network: NETWORK, transport });

// ponytail: in-memory custody + session store with lazy expiry. The held
// ephemeral keys are the keys to user funds — for production, move to a KMS /
// encrypted store and run a single trusted instance (or shard by user).
type Pending = { kp: Ed25519Keypair; randomness: string; maxEpoch: number; expires: number };
export type Session = { address: string; kp: Ed25519Keypair; zkp: ZkLoginSignatureInputs; maxEpoch: number; expires: number };
const pending = new Map<string, Pending>();
const sessions = new Map<string, Session>();
const token = () => crypto.randomBytes(32).toString('hex');

// File-based session persistence so logins survive backend restarts.
// Contains private keys — never commit sessions.json.
type PersistedSession = { address: string; kpSecret: string; zkp: ZkLoginSignatureInputs; maxEpoch: number; expires: number };
const SESSIONS_FILE = fileURLToPath(new URL('sessions.json', import.meta.url));

function saveSessions(): void {
  const now = Date.now();
  const out: Record<string, PersistedSession> = {};
  for (const [t, s] of sessions) {
    if (s.expires < now) continue;
    out[t] = { address: s.address, kpSecret: s.kp.getSecretKey(), zkp: s.zkp, maxEpoch: s.maxEpoch, expires: s.expires };
  }
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(out));
}

function loadSessions(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as Record<string, PersistedSession>;
    const now = Date.now();
    for (const [t, s] of Object.entries(raw)) {
      if (s.expires < now) continue;
      sessions.set(t, { address: s.address, kp: Ed25519Keypair.fromSecretKey(s.kpSecret), zkp: s.zkp, maxEpoch: s.maxEpoch, expires: s.expires });
    }
  } catch { /* no file yet — start fresh */ }
}

loadSessions();

export function createSession(data: Omit<Session, 'expires'>, expires: number): string {
  const t = token();
  sessions.set(t, { ...data, expires });
  saveSessions();
  return t;
}
export function getSession(t: string): Session {
  const s = sessions.get(t);
  if (!s || s.expires < Date.now()) {
    sessions.delete(t);
    saveSessions();
    throw new Error('invalid session');
  }
  return s;
}
export function authed(req: { headers: Record<string, unknown> }): Session {
  const h = String(req.headers['authorization'] ?? '');
  const t = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!t) throw new Error('invalid session');
  return getSession(t);
}

// Sign (sender, via the held zkLogin key) + execute. The user's own zkLogin
// account pays gas — it must hold SUI. This is the single custodial signing path.
export async function signExecute(s: Session, txBytes: Uint8Array): Promise<{ digest: string }> {
  const { signature: userSignature } = await s.kp.signTransaction(txBytes);
  const signature = getZkLoginSignature({ inputs: s.zkp, maxEpoch: s.maxEpoch, userSignature });
  const result = await sui.executeTransaction({ transaction: txBytes, signatures: [signature] });
  return { digest: (result.Transaction ?? result.FailedTransaction).digest };
}

// Build a server-constructed PTB (full tx incl. gas) and run it through the signer.
export async function runTx(s: Session, tx: Transaction): Promise<{ digest: string }> {
  tx.setSenderIfNotSet(s.address);
  const bytes = await tx.build({ client: sui as never });
  return signExecute(s, bytes);
}

export { sui, NETWORK };

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  credentials: true,
});

app.setErrorHandler((err: Error, _req, reply) => {
  if (err instanceof EnokiClientError) return reply.code(err.status || 502).send({ error: err.message, errors: err.errors });
  if (err.message === 'invalid session' || err.message === 'unknown state') return reply.code(401).send({ error: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: err.message });
});

// Step 1: backend mints the ephemeral key + nonce. Frontend takes `nonce` into Google sign-in.
app.post('/auth/start', async () => {
  const kp = Ed25519Keypair.generate();
  const { nonce, randomness, maxEpoch, estimatedExpiration } = await enoki.createZkLoginNonce({
    network: NETWORK,
    ephemeralPublicKey: kp.getPublicKey(),
    additionalEpochs: ADDITIONAL_EPOCHS,
  });
  const state = token();
  pending.set(state, { kp, randomness, maxEpoch, expires: estimatedExpiration });
  return { state, nonce };
});

// Step 2: frontend posts back the Google JWT. Derive address + ZK proof, open a session.
app.post<{ Body: { state: string; jwt: string } }>('/auth/finish', async (req) => {
  const { state, jwt } = req.body;
  const p = pending.get(state);
  if (!p || p.expires < Date.now()) {
    pending.delete(state);
    throw new Error('unknown state');
  }
  pending.delete(state);

  const { address } = await enoki.getZkLogin({ jwt });
  const zkp = await enoki.createZkLoginZkp({
    network: NETWORK,
    jwt,
    ephemeralPublicKey: p.kp.getPublicKey(),
    randomness: p.randomness,
    maxEpoch: p.maxEpoch,
  });
  // Session validity is bounded by the proof's maxEpoch.
  const sessionToken = createSession({ address, kp: p.kp, zkp, maxEpoch: p.maxEpoch }, p.expires);
  return { sessionToken, address };
});

app.get('/stats', async (req) => {
  const { address } = authed(req);
  // ponytail: only the SUI balance is used; ListBalances isn't supported on all
  // gRPC nodes, so return that single coin as the balances list too.
  const { balance } = await sui.getBalance({ owner: address });
  return { address, network: NETWORK, sui: balance.balance, balances: [balance] };
});

// Escape hatch: client-built transaction kind, server-signed + executed (user pays gas).
app.post<{ Body: { transactionKindBytes: string } }>('/tx', async (req) => {
  const s = authed(req);
  return runTx(s, Transaction.fromKind(fromBase64(req.body.transactionKindBytes)));
});

registerPositionRoutes(app);
registerOracleRoutes(app);
registerProbabilityRoutes(app);

if (import.meta.main) {
  app.listen({ port: PORT, host: '0.0.0.0' }).catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
}
