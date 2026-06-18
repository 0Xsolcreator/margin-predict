import { test, expect } from 'bun:test';
import { createSession, getSession } from './index.ts';

const stub = { address: '0xabc', kp: {} as any, zkp: {} as any, maxEpoch: 0 };

test('session round-trips the address', () => {
  const t = createSession(stub, Date.now() + 60_000);
  expect(getSession(t).address).toBe('0xabc');
});

test('expired or unknown tokens are rejected', () => {
  const t = createSession(stub, Date.now() - 1); // already past
  expect(() => getSession(t)).toThrow('invalid session');
  expect(() => getSession('nope')).toThrow('invalid session');
});
