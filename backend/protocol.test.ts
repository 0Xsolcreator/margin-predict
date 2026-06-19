import { test, expect, mock } from 'bun:test';

process.env.MARGIN_PREDICT_PACKAGE = '0xmargin';
process.env.PREDICT_MANAGER_ID = '0xmanager';

const { buildRequestOpen, buildRequestClose, buildCancelIntent, keeper } = await import('./protocol.ts');

const ORACLE = '0x' + '11'.repeat(32);
const POS    = '0x' + '22'.repeat(32);
const OWNER  = '0x' + '33'.repeat(32);

// Record builder output through a fake tx — avoids tx.getData()'s validation
// (flaky under bun) and lets us assert the move-call targets directly.
function recorder() {
  const targets: string[] = [];
  const transfers: unknown[][] = [];
  const tx = {
    addIntentResolver: () => {},
    add: () => ({ $kind: 'Result' }),
    moveCall: (c: { target: string }) => { targets.push(c.target); return [{ $kind: 'NestedResult' }]; },
    object: (id: string) => ({ object: id }),
    pure: { id: (x: unknown) => x, u64: (x: unknown) => x, bool: (x: unknown) => x },
    transferObjects: (objs: unknown[], to: unknown) => { transfers.push([objs, to]); },
  };
  const modFns = () => targets.map((t) => t.split('::').slice(1).join('::'));
  return { tx, targets, transfers, modFns };
}

test('buildRequestOpen calls market_key::new then position_manager::request_open', () => {
  const r = recorder();
  buildRequestOpen(r.tx as any, {
    oracleId: ORACLE, expiry: 1n, strike: 2n, isUp: true,
    collateralMist: 1_000_000_000n, leverageBps: 12_000,
  });
  expect(r.modFns()).toEqual(['market_key::new', 'position_manager::request_open']);
  expect(r.targets[1]).toBe('0xmargin::position_manager::request_open');
});

test('buildRequestClose calls position_manager::request_close', () => {
  const r = recorder();
  buildRequestClose(r.tx as any, POS);
  expect(r.targets).toEqual(['0xmargin::position_manager::request_close']);
});

test('buildCancelIntent calls cancel_intent and transfers returned SUI to owner', () => {
  const r = recorder();
  buildCancelIntent(r.tx as any, POS, OWNER);
  expect(r.targets).toEqual(['0xmargin::position_manager::cancel_intent']);
  expect(r.transfers).toHaveLength(1);
  expect(r.transfers[0][1]).toBe(OWNER);
});

test('builders throw if MARGIN_PREDICT_PACKAGE is unset', () => {
  const saved = process.env.MARGIN_PREDICT_PACKAGE;
  delete process.env.MARGIN_PREDICT_PACKAGE;
  try {
    expect(() => buildRequestClose(recorder().tx as any, POS)).toThrow('MARGIN_PREDICT_PACKAGE not set');
  } finally {
    process.env.MARGIN_PREDICT_PACKAGE = saved;
  }
});

test('keeper() returns parsed JSON and builds the right URL/method', async () => {
  const seen: any[] = [];
  globalThis.fetch = mock(async (url: any, init: any) => {
    seen.push({ url: String(url), method: init?.method });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as any;

  const r = await keeper('GET', '/positions');
  expect(r).toEqual({ ok: true });
  expect(seen[0]).toEqual({ url: 'http://localhost:4000/positions', method: 'GET' });
});

test('keeper() throws with status and body on non-2xx', async () => {
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ error: 'boom' }), { status: 502 })) as any;
  await expect(keeper('POST', '/positions/0x1/open', { x: 1 }))
    .rejects.toThrow('Keeper POST /positions/0x1/open (502)');
});
