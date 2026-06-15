import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import { makeMockKeypair } from '../../test/helpers.js';

vi.mock('../chain/client.js', () => ({
  loadKeypair: vi.fn(),
  createGrpcClient: vi.fn(),
}));

vi.mock('../chain/contract.js', () => ({
  readHealthFactor: vi.fn(),
  readPositionFinancials: vi.fn(),
}));

vi.mock('../store/positions.js', () => ({
  getPosition: vi.fn(),
  listPositions: vi.fn(),
}));

import { loadKeypair, createGrpcClient } from '../chain/client.js';
import { readHealthFactor, readPositionFinancials } from '../chain/contract.js';
import { getPosition, listPositions } from '../store/positions.js';

const KEEPER_ADDRESS = '0x' + 'aa'.repeat(32);
const ORACLE_ID = '0xoracle';

const STATUS_NAMES = ['PENDING_OPEN', 'OPEN', 'CLOSED', 'LIQUIDATED', 'CANCELLED'];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadKeypair).mockReturnValue(makeMockKeypair(KEEPER_ADDRESS));
  vi.mocked(createGrpcClient).mockReturnValue({ __brand: 'base' } as any);
});

describe('GET /positions', () => {
  it('maps every lifecycle status code to its name, and falls back to the raw code if out of range', async () => {
    const records: Record<string, { owner: string; updatedAt: string }> = {};
    const statusByPosition: Record<string, number> = {};
    for (let i = 0; i <= 4; i++) {
      const id = `0xpos${i}`;
      records[id] = { owner: `0xowner${i}`, updatedAt: `2026-01-0${i + 1}T00:00:00.000Z` };
      statusByPosition[id] = i;
    }
    // Unknown/out-of-range status code.
    records['0xpos99'] = { owner: '0xowner99', updatedAt: '2026-02-01T00:00:00.000Z' };
    statusByPosition['0xpos99'] = 99;

    vi.mocked(listPositions).mockReturnValue(records);
    vi.mocked(readPositionFinancials).mockImplementation(async (_base, _addr, positionId) => ({
      owner: records[positionId].owner,
      status: statusByPosition[positionId],
      marginDebt: 1_000_000n,
      collateralSui: 2_000_000_000n,
    }));

    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/positions' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(6);

    for (let i = 0; i <= 4; i++) {
      const entry = body.find((p: any) => p.positionId === `0xpos${i}`);
      expect(entry).toMatchObject({
        owner: `0xowner${i}`,
        updatedAt: `2026-01-0${i + 1}T00:00:00.000Z`,
        status: STATUS_NAMES[i],
        marginDebt: '1000000',
        collateralSui: '2000000000',
      });
    }

    const unknown = body.find((p: any) => p.positionId === '0xpos99');
    expect(unknown).toMatchObject({ owner: '0xowner99', status: 99 });
  });

  it('returns an empty array when nothing is tracked', async () => {
    vi.mocked(listPositions).mockReturnValue({});
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/positions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(readPositionFinancials).not.toHaveBeenCalled();
  });
});

describe('GET /positions/:positionId', () => {
  it('404s when the position is not tracked', async () => {
    vi.mocked(getPosition).mockReturnValue(undefined);
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/positions/0xpos0' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Position 0xpos0 not tracked' });
  });

  it('returns live status/debt/collateral for a tracked position', async () => {
    vi.mocked(getPosition).mockReturnValue({ owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
    vi.mocked(readPositionFinancials).mockResolvedValue({
      owner: '0xowner',
      status: 1,
      marginDebt: 4_000_000n,
      collateralSui: 10_000_000_000n,
    } as any);

    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/positions/0xpos0' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      positionId: '0xpos0',
      owner: '0xowner',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'OPEN',
      marginDebt: '4000000',
      collateralSui: '10000000000',
    });
  });
});

describe('GET /positions/:positionId/health', () => {
  it('400s when oracleId query parameter is missing', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: '/positions/0xpos0/health' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'oracleId query parameter is required' });
  });

  it('404s when the position is not tracked', async () => {
    vi.mocked(getPosition).mockReturnValue(undefined);
    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: `/positions/0xpos0/health?oracleId=${ORACLE_ID}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Position 0xpos0 not tracked' });
    expect(readHealthFactor).not.toHaveBeenCalled();
  });

  it('returns the live health factor for a tracked position', async () => {
    vi.mocked(getPosition).mockReturnValue({ owner: '0xowner', updatedAt: '2026-01-01T00:00:00.000Z' });
    vi.mocked(readHealthFactor).mockResolvedValue(10_750n);

    const app = buildApp({ logger: false });
    const res = await app.inject({ method: 'GET', url: `/positions/0xpos0/health?oracleId=${ORACLE_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ positionId: '0xpos0', healthFactorBps: '10750' });
    expect(readHealthFactor).toHaveBeenCalledWith(expect.anything(), KEEPER_ADDRESS, '0xpos0', ORACLE_ID);
  });
});
