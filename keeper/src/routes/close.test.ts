import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../app.js';
import { makeMockKeypair, makeMockMarginClient, makeMockSwapClient, mockArg } from '../../test/helpers.js';

vi.mock('../chain/client.js', () => ({
  loadKeypair: vi.fn(),
  createGrpcClient: vi.fn(),
  createMarginClient: vi.fn(),
  createSwapClient: vi.fn(),
  injectPythPrices: vi.fn(),
}));

vi.mock('../chain/contract.js', () => ({
  readPositionFinancials: vi.fn(),
  buildClosePosition: vi.fn(),
}));

vi.mock('../deepbook/unwind.js', () => ({
  unwindPosition: vi.fn(),
}));

vi.mock('../store/positions.js', () => ({
  getPosition: vi.fn(),
  deletePosition: vi.fn(),
}));

vi.mock('../chain/transaction.js', () => ({
  executeTransaction: vi.fn(),
}));

import { loadKeypair, createGrpcClient, createMarginClient, createSwapClient, injectPythPrices } from '../chain/client.js';
import { readPositionFinancials, buildClosePosition } from '../chain/contract.js';
import { unwindPosition } from '../deepbook/unwind.js';
import { getPosition, deletePosition } from '../store/positions.js';
import { executeTransaction } from '../chain/transaction.js';

const KEEPER_ADDRESS = '0x' + 'aa'.repeat(32);
const OWNER_ADDRESS = '0x' + 'bb'.repeat(32);
const POSITION_ID = '0xposition';
const ORACLE_ID = '0xoracle';

const marginClient = makeMockMarginClient();
const swapClient = makeMockSwapClient({ baseOut: 0, quoteOut: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadKeypair).mockReturnValue(makeMockKeypair(KEEPER_ADDRESS));
  vi.mocked(createGrpcClient).mockReturnValue({ __brand: 'base' } as any);
  vi.mocked(createMarginClient).mockReturnValue(marginClient);
  vi.mocked(createSwapClient).mockReturnValue(swapClient);
  vi.mocked(injectPythPrices).mockResolvedValue();
  vi.mocked(getPosition).mockReturnValue({ owner: OWNER_ADDRESS, updatedAt: '2026-01-01T00:00:00.000Z' });
  vi.mocked(readPositionFinancials).mockResolvedValue({
    owner: OWNER_ADDRESS,
    marginDebt: 4_000_000n,
    collateralSui: 10_000_000_000n,
  } as any);
  vi.mocked(buildClosePosition).mockReturnValue(mockArg(5));
  vi.mocked(executeTransaction).mockResolvedValue({
    digest: 'CLOSE_DIGEST',
    effects: {},
    balanceChanges: [],
    events: [],
  } as any);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /positions/:positionId/close', () => {
  it('400s when oracleId is missing', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/close`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'oracleId is required' });
  });

  it('404s when the position is not tracked', async () => {
    vi.mocked(getPosition).mockReturnValue(undefined);
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/close`,
      payload: { oracleId: ORACLE_ID },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: `Position ${POSITION_ID} not tracked` });
  });

  it('500s when DUSDC_DBUSDC_POOL_ID is not configured', async () => {
    vi.stubEnv('DUSDC_DBUSDC_POOL_ID', '');
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/close`,
      payload: { oracleId: ORACLE_ID },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'DUSDC_DBUSDC_POOL_ID not configured' });
  });

  it('closes a position end-to-end: redeem, unwind, repay, withdraw, untrack', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/close`,
      payload: { oracleId: ORACLE_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      digest: 'CLOSE_DIGEST',
      positionId: POSITION_ID,
      owner: OWNER_ADDRESS,
      repaidDebt: '4000000',
      withdrawnCollateral: '10000000000',
    });

    // Pyth prices injected before any reads/builds that depend on them.
    expect(injectPythPrices).toHaveBeenCalledWith(expect.anything(), expect.anything(), KEEPER_ADDRESS);

    // Predict position redeemed for its full DUSDC proceeds.
    expect(buildClosePosition).toHaveBeenCalledWith(expect.anything(), POSITION_ID, ORACLE_ID);

    // Unwind repays the position's full recorded debt and withdraws all collateral to the owner.
    expect(unwindPosition).toHaveBeenCalledWith({
      tx: expect.anything(),
      marginClient,
      swapClient,
      swapPool: expect.objectContaining({ key: 'DUSDC_DBUSDC' }),
      proceedsCoin: mockArg(5),
      repayAmount: 4_000_000n,
      withdrawSuiAmount: 10_000_000_000n,
      recipient: OWNER_ADDRESS,
      keeperAddress: KEEPER_ADDRESS,
    });

    expect(executeTransaction).toHaveBeenCalledWith(marginClient, expect.anything(), expect.anything(), 'Close position');

    // Closed positions are removed from the local registry.
    expect(deletePosition).toHaveBeenCalledWith(POSITION_ID);
  });
});
