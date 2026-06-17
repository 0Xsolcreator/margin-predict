import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../app.js';
import { MARGIN_MANAGER_ID, MARGIN_MANAGER_KEY, SWAP_DEEP_AMOUNT } from '../config.js';
import { makeMockKeypair, makeMockMarginClient, makeMockSwapClient, mockArg } from '../../test/helpers.js';

vi.mock('../chain/client.js', () => ({
  loadKeypair: vi.fn(),
  createGrpcClient: vi.fn(),
  createMarginClient: vi.fn(),
  createSwapClient: vi.fn(),
  injectPythPrices: vi.fn(),
  fetchSuiPrice: vi.fn(),
}));

vi.mock('../chain/contract.js', () => ({
  readPositionContext: vi.fn(),
  buildTakeEscrow: vi.fn(),
  buildDeployPosition: vi.fn(),
}));

vi.mock('../deepbook/swap.js', () => ({
  buildSwapStep: vi.fn(),
}));

vi.mock('../store/positions.js', () => ({
  setPosition: vi.fn(),
}));

vi.mock('../chain/transaction.js', () => ({
  executeTransaction: vi.fn(),
}));

import {
  loadKeypair,
  createGrpcClient,
  createMarginClient,
  createSwapClient,
  injectPythPrices,
  fetchSuiPrice,
} from '../chain/client.js';
import { readPositionContext, buildTakeEscrow, buildDeployPosition } from '../chain/contract.js';
import { buildSwapStep } from '../deepbook/swap.js';
import { setPosition } from '../store/positions.js';
import { executeTransaction } from '../chain/transaction.js';

const KEEPER_ADDRESS = '0x' + 'aa'.repeat(32);
const OWNER_ADDRESS = '0xowner';
const POSITION_ID = '0xposition';
const ORACLE_ID = '0xoracle';

const marginClient = makeMockMarginClient();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadKeypair).mockReturnValue(makeMockKeypair(KEEPER_ADDRESS));
  vi.mocked(createGrpcClient).mockReturnValue({ __brand: 'base' } as any);
  vi.mocked(createMarginClient).mockReturnValue(marginClient);
  vi.mocked(createSwapClient).mockReturnValue(makeMockSwapClient({ baseOut: 3.96, quoteOut: 0 }));
  vi.mocked(injectPythPrices).mockResolvedValue();
  vi.mocked(readPositionContext).mockResolvedValue({
    owner: OWNER_ADDRESS,
    escrowValue: 10_000_000_000n, // 10 SUI
  });
  vi.mocked(fetchSuiPrice).mockResolvedValue(2); // $2/SUI
  vi.mocked(buildTakeEscrow).mockReturnValue(mockArg(0));
  vi.mocked(buildSwapStep).mockReturnValue(() => [mockArg(10), mockArg(11), mockArg(12)]);
  vi.mocked(buildDeployPosition).mockReturnValue(undefined);
  vi.mocked(executeTransaction).mockResolvedValue({
    digest: 'DIGEST123',
    effects: {},
    balanceChanges: [],
    events: [],
  } as any);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function openBody(overrides: Partial<{ leverageBps: number; oracleId: string }> = {}) {
  return { leverageBps: 12_000, oracleId: ORACLE_ID, ...overrides };
}

describe('POST /positions/:positionId/open', () => {
  it('400s when oracleId is missing', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/open`,
      payload: { leverageBps: 12_000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'oracleId is required' });
  });

  it('500s (via generic handler) when leverageBps is out of range', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/open`,
      payload: openBody({ leverageBps: 10_000 }),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: 'leverageBps must be in [11000, 14000] (1.10x – 1.40x), got 10000',
    });
  });

  it('500s when DUSDC_DBUSDC_POOL_ID is not configured', async () => {
    vi.stubEnv('DUSDC_DBUSDC_POOL_ID', '');
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/open`,
      payload: openBody(),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'DUSDC_DBUSDC_POOL_ID not configured' });
  });

  it('409s when there is no escrowed SUI', async () => {
    vi.mocked(readPositionContext).mockResolvedValue({ owner: OWNER_ADDRESS, escrowValue: 0n });
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/open`,
      payload: openBody(),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'No escrowed SUI — already opened or cancelled?' });
  });

  it('422s when the computed borrow amount is zero', async () => {
    vi.mocked(fetchSuiPrice).mockResolvedValue(0);
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/open`,
      payload: openBody(),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Computed DBUSDC borrow amount is zero' });
    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it('opens a position end-to-end: deposit, borrow, swap, deploy, register', async () => {
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/open`,
      payload: openBody({ leverageBps: 12_000 }),
    });

    expect(res.statusCode).toBe(200);

    // 10 SUI * $2 = $20 collateral; borrow = $20 * (1.2 - 1) = $4 DBUSDC.
    // marginDebt is the *swapped DUSDC output* (quote.baseOut = 3.96), not the
    // borrow — so the contract's ±10% tolerance check sees the actual deployed
    // collateral. 3.96 DUSDC -> 3_960_000 raw (6dp).
    const body = res.json();
    expect(body).toMatchObject({
      digest: 'DIGEST123',
      positionId: POSITION_ID,
      owner: OWNER_ADDRESS,
      leverageBps: 12_000,
      collateralSui: '10000000000',
      marginManagerId: MARGIN_MANAGER_ID,
      marginDebt: '3960000',
    });

    // 1. Escrowed SUI is deposited into the shared MarginManager.
    expect(marginClient.deepbook.marginManager.depositBase).toHaveBeenCalledWith({
      managerKey: MARGIN_MANAGER_KEY,
      coin: mockArg(0),
    });

    // 2. Borrow sized from collateral value, not from the requested leverage directly.
    expect(marginClient.deepbook.marginManager.borrowQuote).toHaveBeenCalledWith(MARGIN_MANAGER_KEY, expect.closeTo(4, 9));
    expect(marginClient.deepbook.marginManager.withdrawQuote).toHaveBeenCalledWith(MARGIN_MANAGER_KEY, expect.closeTo(4, 9));

    // 3. Borrowed DBUSDC is swapped to DUSDC with the configured slippage applied.
    expect(buildSwapStep).toHaveBeenCalledWith({
      client: expect.anything(),
      poolKey: 'DUSDC_DBUSDC',
      direction: 'quoteToBase',
      amount: expect.closeTo(4, 9),
      minOut: 3.96 * 0.99,
      deepAmount: SWAP_DEEP_AMOUNT,
      inputCoin: mockArg(1),
    });

    // 4. Position is deployed with the swapped DUSDC and the reported margin debt.
    expect(buildDeployPosition).toHaveBeenCalledWith(
      expect.anything(),
      POSITION_ID,
      ORACLE_ID,
      mockArg(10),
      MARGIN_MANAGER_ID,
      3_960_000n,
    );

    // 5. Transaction is signed/executed under the keeper's keypair.
    expect(executeTransaction).toHaveBeenCalledWith(marginClient, expect.anything(), expect.anything(), 'Open position');

    // 6. Local registry records the owner so /positions can enumerate it.
    expect(setPosition).toHaveBeenCalledTimes(1);
    const [storedId, record] = vi.mocked(setPosition).mock.calls[0];
    expect(storedId).toBe(POSITION_ID);
    expect(record.owner).toBe(OWNER_ADDRESS);
    expect(new Date(record.updatedAt).toISOString()).toBe(record.updatedAt);
  });

  it('sizes the borrow proportionally to leverage (1.4x => 40% of collateral value)', async () => {
    // $20 collateral * (1.4 - 1) = $8 borrow; swap returns ~8 DUSDC at 1:1.
    vi.mocked(createSwapClient).mockReturnValue(makeMockSwapClient({ baseOut: 8, quoteOut: 0 }));
    const app = buildApp({ logger: false });
    const res = await app.inject({
      method: 'POST',
      url: `/positions/${POSITION_ID}/open`,
      payload: openBody({ leverageBps: 14_000 }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().marginDebt).toBe('8000000'); // 8 DUSDC swap output -> 8_000_000 raw
    expect(marginClient.deepbook.marginManager.borrowQuote).toHaveBeenCalledWith(MARGIN_MANAGER_KEY, expect.closeTo(8, 9));
  });
});
