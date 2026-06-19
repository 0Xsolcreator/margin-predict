import { test, expect, mock, beforeEach } from 'bun:test';
import Fastify from 'fastify';

// Real builders run (runTx is mocked, so nothing is built/sent), but request_open
// pure.id()s the oracle + manager — those must be valid addresses.
process.env.MARGIN_PREDICT_PACKAGE = '0xmargin';
process.env.PREDICT_MANAGER_ID = '0x' + '55'.repeat(32);

const USER = '0x' + 'ab'.repeat(32);
const POS = '0x' + 'cc'.repeat(32);
const ORACLE = '0x' + '44'.repeat(32);

let runTxCalls = 0;

// Mock only the custodial signer. bun's mock.module is process-global, so this
// must be a faithful superset: index.test.ts imports createSession/getSession
// from here too, and may run after this mock is installed.
const sessions = new Map<string, any>();
mock.module('./index.ts', () => ({
  authed: (req: any) => {
    if (!String(req.headers['authorization'] ?? '').startsWith('Bearer ')) throw new Error('invalid session');
    return { address: USER };
  },
  runTx: async () => { runTxCalls++; return { digest: '0xdigest' }; },
  sui: {
    waitForTransaction: async () => ({
      Transaction: {
        effects: { changedObjects: [
          { objectId: '0xgas', idOperation: 'None' },
          { objectId: POS, idOperation: 'Created' },
        ] },
        objectTypes: { [POS]: '0xpkg::margin_position::MarginPosition<0x2::dusdc::DUSDC>' },
      },
    }),
  },
  createSession: (data: any, expires: number) => {
    const t = Math.random().toString(36).slice(2);
    sessions.set(t, { ...data, expires });
    return t;
  },
  getSession: (t: string) => {
    const s = sessions.get(t);
    if (!s || s.expires < Date.now()) { sessions.delete(t); throw new Error('invalid session'); }
    return s;
  },
}));

const { registerPositionRoutes } = await import('./positions.ts');

// Keeper proxy is real (protocol.ts unmocked); stub its HTTP boundary.
const fetchCalls: Array<{ method: string; path: string; body?: any }> = [];
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
beforeEach(() => {
  runTxCalls = 0;
  fetchCalls.length = 0;
  globalThis.fetch = mock(async (url: any, init: any) => {
    const method = init?.method ?? 'GET';
    const path = String(url).replace('http://localhost:4000', '');
    fetchCalls.push({ method, path, body: init?.body ? JSON.parse(init.body) : undefined });
    if (method === 'GET' && path === '/positions') {
      return json([{ owner: USER, positionId: '0xmine' }, { owner: '0xother', positionId: '0xtheirs' }]);
    }
    if (path.includes('/health')) return json({ healthFactorBps: '10750' });
    if (method === 'GET' && path.startsWith('/positions/')) return json({ status: 'OPEN', positionId: path.split('/')[2] });
    return json({ ok: true });
  }) as any;
});

function app() {
  const a = Fastify({ logger: false });
  // Mirror index.ts's 401 mapping so the auth gate is observable.
  a.setErrorHandler((err: Error, _req, reply) =>
    reply.code(err.message === 'invalid session' ? 401 : 500).send({ error: err.message }));
  registerPositionRoutes(a);
  return a;
}
const AUTH = { authorization: 'Bearer t' };

test('POST /positions places a bet: signs request_open, then calls keeper open', async () => {
  const res = await app().inject({
    method: 'POST', url: '/positions', headers: AUTH,
    payload: { oracleId: ORACLE, expiry: '1', strike: '2', collateralSui: 1, leverageBps: 12_000 },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ positionId: POS, requestDigest: '0xdigest', open: { ok: true } });
  expect(runTxCalls).toBe(1);
  expect(fetchCalls).toEqual([
    { method: 'POST', path: `/positions/${POS}/open`, body: { leverageBps: 12_000, oracleId: ORACLE } },
  ]);
});

test('POST /positions 400s without required fields', async () => {
  const res = await app().inject({ method: 'POST', url: '/positions', headers: AUTH, payload: { oracleId: '0x1' } });
  expect(res.statusCode).toBe(400);
  expect(runTxCalls).toBe(0);
});

test('unauthenticated requests are rejected before any work', async () => {
  const res = await app().inject({ method: 'POST', url: '/positions', payload: {} });
  expect(res.statusCode).toBe(401);
  expect(runTxCalls).toBe(0);
});

test('GET /positions returns only the caller\'s positions', async () => {
  const res = await app().inject({ method: 'GET', url: '/positions', headers: AUTH });
  expect(res.json() as any).toEqual([{ owner: USER, positionId: '0xmine' }]);
});

test('GET /positions/:id merges health when OPEN and oracleId is given', async () => {
  const res = await app().inject({ method: 'GET', url: `/positions/${POS}?oracleId=0xoracle`, headers: AUTH });
  expect(res.json()).toMatchObject({ status: 'OPEN', healthFactorBps: '10750' });
});

test('POST /positions/:id/close signs request_close, then calls keeper close', async () => {
  const res = await app().inject({
    method: 'POST', url: `/positions/${POS}/close`, headers: AUTH, payload: { oracleId: '0xoracle' },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ positionId: POS, requestDigest: '0xdigest', close: { ok: true } });
  expect(fetchCalls).toEqual([{ method: 'POST', path: `/positions/${POS}/close`, body: { oracleId: '0xoracle' } }]);
});

test('POST /positions/:id/close 400s without oracleId', async () => {
  const res = await app().inject({ method: 'POST', url: `/positions/${POS}/close`, headers: AUTH, payload: {} });
  expect(res.statusCode).toBe(400);
  expect(runTxCalls).toBe(0);
});

test('POST /positions/:id/withdraw signs cancel_intent', async () => {
  const res = await app().inject({ method: 'POST', url: `/positions/${POS}/withdraw`, headers: AUTH, payload: {} });
  expect(res.statusCode).toBe(200);
  expect(res.json() as any).toEqual({ positionId: POS, digest: '0xdigest' });
  expect(runTxCalls).toBe(1);
});
