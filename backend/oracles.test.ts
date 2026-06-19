import { test, expect, mock } from 'bun:test';
import Fastify from 'fastify';
import { registerOracleRoutes } from './oracles.ts';

function app() {
  const a = Fastify({ logger: false });
  registerOracleRoutes(a);
  return a;
}

test('GET /oracles returns only active markets, soonest expiry first', async () => {
  globalThis.fetch = mock(async () => new Response(JSON.stringify([
    { oracle_id: '0xa', status: 'active', expiry: 300 },
    { oracle_id: '0xb', status: 'settled', expiry: 100 },
    { oracle_id: '0xc', status: 'active', expiry: 200 },
  ]), { status: 200 })) as any;

  const res = await app().inject({ method: 'GET', url: '/oracles' });
  expect(res.statusCode).toBe(200);
  expect(res.json().map((o: any) => o.oracle_id)).toEqual(['0xc', '0xa']);
});

test('GET /oracles?all=1 returns every status', async () => {
  globalThis.fetch = mock(async () => new Response(JSON.stringify([
    { oracle_id: '0xa', status: 'active', expiry: 1 },
    { oracle_id: '0xb', status: 'settled', expiry: 2 },
  ]), { status: 200 })) as any;

  const res = await app().inject({ method: 'GET', url: '/oracles?all=1' });
  expect(res.json()).toHaveLength(2);
});

test('GET /oracles/:id proxies the indexer state endpoint', async () => {
  globalThis.fetch = mock(async (url: any) =>
    new Response(JSON.stringify({ url: String(url) }), { status: 200 })) as any;

  const res = await app().inject({ method: 'GET', url: '/oracles/0xfeed' });
  expect(res.json().url).toContain('/oracles/0xfeed/state');
});
