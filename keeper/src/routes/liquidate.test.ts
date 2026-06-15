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
  readHealthFactor: vi.fn(),
  readLiquidationFlagged: vi.fn(),
  readPositionFinancials: vi.fn(),
  buildFlagLiquidation: vi.fn(),
  buildExecuteLiquidation: vi.fn(),
}));

vi.mock('../deepbook/unwind.js', () => ({
  unwindPosition: vi.fn(),
}));

vi.mock('../store/positions.js', () => ({
  getPosition: vi.fn(),
  setPosition: vi.fn(),
  deletePosition: vi.fn(),
}));

vi.mock('../chain/transaction.js', () => ({
  executeTransaction: vi.fn(),
}));

import { loadKeypair, createGrpcClient, createMarginClient, createSwapClient, injectPythPrices } from '../chain/client.js';
import {
  readHealthFactor,
  readLiquidationFlagged,
  readPositionFinancials,
  buildFlagLiquidation,
  buildExecuteLiquidation,
} from '../chain/contract.js';
import { unwindPosition } from '../deepbook/unwind.js';
import { getPosition, setPosition, deletePosition } from '../store/positions.js';
import { executeTransaction } from '../chain/transaction.js';

const KEEPER_ADDRESS = '0x' + 'aa'.repeat(32);
const OWNER_ADDRESS = '0x' + 'bb'.repeat(32);
const POSITION_ID = '0xposition';
const ORACLE_ID = '0xoracle';
const RECORD = { owner: OWNER_ADDRESS, updatedAt: '2026-01-01T00:00:00.000Z' };

const marginClient = makeMockMarginClient();
const swapClient = makeMockSwapClient({ baseOut: 0, quoteOut: 0 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadKeypair).mockReturnValue(makeMockKeypair(KEEPER_ADDRESS));
  vi.mocked(createGrpcClient).mockReturnValue({ __brand: 'base' } as any);
  vi.mocked(createMarginClient).mockReturnValue(marginClient);
  vi.mocked(createSwapClient).mockReturnValue(swapClient);
  vi.mocked(injectPythPrices).mockResolvedValue();
  vi.mocked(getPosition).mockReturnValue({ ...RECORD });
  vi.mocked(readHealthFactor).mockResolvedValue(9_000n); // hard by default
  vi.mocked(readLiquidationFlagged).mockResolvedValue(false);
  vi.mocked(readPositionFinancials).mockResolvedValue({
    owner: OWNER_ADDRESS,
    marginDebt: 4_000_000n,
    collateralSui: 10_000_000_000n,
  } as any);
  vi.mocked(buildExecuteLiquidation).mockReturnValue(mockArg(5));
  vi.mocked(executeTransaction).mockResolvedValue({
    digest: 'LIQ_DIGEST',
    effects: {},
    balanceChanges: [],
    events: [],
  } as any);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /positions/:positionId/liquidate', () => {
  it('400s when oracleId is missing', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/liquidate`,
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
      url: `/positions/${POSITION_ID}/liquidate`,
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
      url: `/positions/${POSITION_ID}/liquidate`,
      payload: { oracleId: ORACLE_ID },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'DUSDC_DBUSDC_POOL_ID not configured' });
  });

  it('409s when the position is healthy (hf > HF_SOFT_BPS)', async () => {
    vi.mocked(readHealthFactor).mockResolvedValue(10_501n);
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/liquidate`,
      payload: { oracleId: ORACLE_ID },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: 'Position is healthy (hf=10501 > 10500)',
      healthFactorBps: '10501',
    });
    expect(readLiquidationFlagged).not.toHaveBeenCalled();
    expect(readPositionFinancials).not.toHaveBeenCalled();
    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it('treats hf == HF_SOFT_BPS (10500) as liquidatable and soft (not hard)', async () => {
    vi.mocked(readHealthFactor).mockResolvedValue(10_500n);
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/liquidate`,
      payload: { oracleId: ORACLE_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('soft');
    expect(res.json().healthFactorBps).toBe('10500');
  });

  it('treats hf == HF_HARD_BPS (10000) as hard', async () => {
    vi.mocked(readHealthFactor).mockResolvedValue(10_000n);
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/liquidate`,
      payload: { oracleId: ORACLE_ID },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe('hard');
    expect(res.json().healthFactorBps).toBe('10000');
  });

  it('soft-liquidates 25% of debt, leaves collateral in place, and updates the tracked record', async () => {
    vi.mocked(readHealthFactor).mockResolvedValue(10_200n); // between HARD and SOFT

    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/liquidate`,
      payload: { oracleId: ORACLE_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      digest: 'LIQ_DIGEST',
      positionId: POSITION_ID,
      owner: OWNER_ADDRESS,
      mode: 'soft',
      healthFactorBps: '10200',
      repaidDebt: '1000000', // 25% of 4_000_000
      remainingDebt: '3000000', // 75% of 4_000_000
      withdrawnCollateral: '0',
    });

    // Not yet flagged -> keeper flags it itself.
    expect(buildFlagLiquidation).toHaveBeenCalledWith(expect.anything(), POSITION_ID, ORACLE_ID);
    expect(buildExecuteLiquidation).toHaveBeenCalledWith(expect.anything(), POSITION_ID, ORACLE_ID);

    expect(unwindPosition).toHaveBeenCalledWith({
      tx: expect.anything(),
      marginClient,
      swapClient,
      swapPool: expect.objectContaining({ key: 'DUSDC_DBUSDC' }),
      proceedsCoin: mockArg(5),
      repayAmount: 1_000_000n,
      withdrawSuiAmount: 0n,
      recipient: OWNER_ADDRESS,
      keeperAddress: KEEPER_ADDRESS,
    });

    expect(executeTransaction).toHaveBeenCalledWith(marginClient, expect.anything(), expect.anything(), 'Liquidate position');

    // Position stays tracked (partial liquidation), record refreshed with a new timestamp.
    expect(deletePosition).not.toHaveBeenCalled();
    expect(setPosition).toHaveBeenCalledTimes(1);
    const [storedId, record] = vi.mocked(setPosition).mock.calls[0];
    expect(storedId).toBe(POSITION_ID);
    expect(record.owner).toBe(OWNER_ADDRESS);
    expect(new Date(record.updatedAt).toISOString()).toBe(record.updatedAt);
  });

  it('hard-liquidates the full position, withdraws all collateral, and untracks it', async () => {
    vi.mocked(readHealthFactor).mockResolvedValue(9_000n); // <= HARD

    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/liquidate`,
      payload: { oracleId: ORACLE_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      digest: 'LIQ_DIGEST',
      positionId: POSITION_ID,
      owner: OWNER_ADDRESS,
      mode: 'hard',
      healthFactorBps: '9000',
      repaidDebt: '4000000',
      remainingDebt: '0',
      withdrawnCollateral: '10000000000',
    });

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

    expect(setPosition).not.toHaveBeenCalled();
    expect(deletePosition).toHaveBeenCalledWith(POSITION_ID);
  });

  it('does not re-flag a position that is already flagged for liquidation', async () => {
    vi.mocked(readLiquidationFlagged).mockResolvedValue(true);

    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/liquidate`,
      payload: { oracleId: ORACLE_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(buildFlagLiquidation).not.toHaveBeenCalled();
    expect(buildExecuteLiquidation).toHaveBeenCalledWith(expect.anything(), POSITION_ID, ORACLE_ID);
  });
});
