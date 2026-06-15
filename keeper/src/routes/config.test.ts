import { describe, it, expect } from 'vitest';
import { buildApp } from '../app.js';

describe('GET /config/leverage-range', () => {
  it('returns the configured leverage bounds', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/config/leverage-range' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      minBps: 11_000,
      maxBps: 14_000,
      min: 1.1,
      max: 1.4,
    });
  });
});
