// Server-custodial Enoki wallet infra for non-crypto onboarding.
//
// The frontend does Google sign-in (just UX — the Google account picker, no
// wallet). Everything else is server-side: the backend holds the zkLogin
// ephemeral key, builds the ZK proof, and signs + sponsors + executes txns.
//
// Because the backend holds the key, Google sign-in must use a nonce bound to
// it — so the frontend fetches a nonce first, then signs in, then hands back
// the JWT:
//   POST /auth/start                 -> { state, nonce }   (backend makes+keeps the ephemeral key)
//     frontend runs Google sign-in with `nonce` -> id_token (JWT)
//   POST /auth/finish { state, jwt }  -> { sessionToken, address }  (backend makes+keeps the ZK proof)
//   GET  /stats        Bearer         -> on-chain balances
//   POST /tx           Bearer + { transactionKindBytes } -> { digest }
//        backend sponsors (gas) + signs (sender, via the held key + proof) + executes.
//
// Tradeoff: this server IS the key custodian. It can move user funds; protect
// this process and its memory accordingly.

import crypto from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { EnokiClient, EnokiClientError } from '@mysten/enoki';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getZkLoginSignature } from '@mysten/sui/zklogin';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import type { ZkLoginSignatureInputs } from '@mysten/sui/zklogin';
import { registerPositionRoutes } from './positions.ts';
import { registerOracleRoutes } from './oracles.ts';

const NETWORK = (process.env.NETWORK ?? 'testnet') as 'mainnet' | 'testnet' | 'devnet';
const RPC_URL = process.env.SUI_RPC_URL ?? `https://fullnode.${NETWORK}.sui.io:443`;
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const ADDITIONAL_EPOCHS = Number(process.env.ADDITIONAL_EPOCHS ?? 2); // how long the proof/session stays valid (Sui epoch ~24h)
const ALLOWED_TARGETS = (process.env.SPONSOR_ALLOWED_TARGETS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SECRET = process.env.ENOKI_SECRET_KEY;
if (!SECRET) throw new Error('ENOKI_SECRET_KEY not set in .env');

const enoki = new EnokiClient({ apiKey: SECRET });
const sui = new SuiGrpcClient({ network: NETWORK, baseUrl: RPC_URL });

// ponytail: in-memory custody + session store with lazy expiry. The held
// ephemeral keys are the keys to user funds — for production, move to a KMS /
// encrypted store and run a single trusted instance (or shard by user).
type Pending = { kp: Ed25519Keypair; randomness: string; maxEpoch: number; expires: number };
export type Session = { address: string; kp: Ed25519Keypair; zkp: ZkLoginSignatureInputs; maxEpoch: number; expires: number };
const pending = new Map<string, Pending>();
const sessions = new Map<string, Session>();
const token = () => crypto.randomBytes(32).toString('hex');

export function createSession(data: Omit<Session, 'expires'>, expires: number): string {
  const t = token();
  sessions.set(t, { ...data, expires });
  return t;
}
export function getSession(t: string): Session {
  const s = sessions.get(t);
  if (!s || s.expires < Date.now()) {
    sessions.delete(t);
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

// Sponsor (gas) + sign (sender, via the held zkLogin key) + execute. The user
// signs nothing client-side; this is the single custodial signing path.
export async function sponsorExecute(s: Session, transactionKindBytes: string) {
  const { bytes, digest } = await enoki.createSponsoredTransaction({
    network: NETWORK,
    transactionKindBytes,
    sender: s.address,
    allowedAddresses: [s.address],
    ...(ALLOWED_TARGETS.length ? { allowedMoveCallTargets: ALLOWED_TARGETS } : {}),
  });
  const { signature: userSignature } = await s.kp.signTransaction(fromBase64(bytes));
  const signature = getZkLoginSignature({ inputs: s.zkp, maxEpoch: s.maxEpoch, userSignature });
  return enoki.executeSponsoredTransaction({ digest, signature });
}

// Build a server-constructed PTB and run it through the custodial signer.
// onlyTransactionKind: Enoki provides gas; we only ship the command kind.
export async function runTx(s: Session, tx: Transaction): Promise<{ digest: string }> {
  tx.setSenderIfNotSet(s.address);
  const kind = await tx.build({ client: sui as never, onlyTransactionKind: true });
  return sponsorExecute(s, toBase64(kind));
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
  const [{ balance }, { balances }] = await Promise.all([
    sui.getBalance({ owner: address }),
    sui.listBalances({ owner: address }),
  ]);
  return { address, network: NETWORK, sui: balance.balance, balances };
});

// Escape hatch: client-built transaction kind, server-sponsored + signed.
app.post<{ Body: { transactionKindBytes: string } }>('/tx', async (req) => {
  const s = authed(req);
  return sponsorExecute(s, req.body.transactionKindBytes);
});

registerPositionRoutes(app);
registerOracleRoutes(app);

if (import.meta.main) {
  app.listen({ port: PORT, host: '0.0.0.0' }).catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
}
