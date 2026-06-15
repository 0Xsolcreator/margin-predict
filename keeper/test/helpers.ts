import { vi } from 'vitest';
import type { TransactionObjectArgument } from '@mysten/sui/transactions';

/**
 * Placeholder TransactionObjectArgument. Uses `$kind: 'GasCoin'` because it's the
 * only object-argument variant that passes Transaction's argument-availability
 * check without a corresponding real command having been added to the PTB
 * (which mocked builder functions never do). The `index` only distinguishes
 * call-site intent in test code — all instances are structurally identical.
 */
export function mockArg(index = 0): TransactionObjectArgument {
  void index;
  return { $kind: 'GasCoin', GasCoin: true } as unknown as TransactionObjectArgument;
}

export function makeMockKeypair(address: string) {
  return { toSuiAddress: () => address } as any;
}

export function makeMockMarginManager() {
  return {
    depositBase: vi.fn(() => vi.fn()),
    borrowQuote: vi.fn(() => vi.fn()),
    withdrawQuote: vi.fn(() => vi.fn(() => mockArg(1))),
    depositQuote: vi.fn(() => vi.fn()),
    repayQuote: vi.fn(() => vi.fn()),
    withdrawBase: vi.fn(() => vi.fn(() => mockArg(2))),
  };
}

export function makeMockMarginClient() {
  return { deepbook: { marginManager: makeMockMarginManager() } } as any;
}

export function makeMockSwapClient(quote: { baseOut: number; quoteOut: number }) {
  return {
    deepbook: {
      getBaseQuantityOutInputFee: vi.fn(async () => quote),
    },
  } as any;
}
