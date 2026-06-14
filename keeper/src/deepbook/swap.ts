/// Pool-agnostic DeepBook spot-swap helpers.
///
/// Registers any pool + coin pair on-the-fly, enabling composable swap steps
/// inside larger PTBs (e.g. borrow → swap → deploy → swap back → repay)
/// without depending on the SDK's predefined pool list.

import type { TransactionObjectArgument } from '@mysten/sui/transactions';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { deepbook } from '@mysten/deepbook-v3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SwapAsset = {
  key: string;     // registry key, e.g. 'DUSDC'
  address: string; // coin package address
  type: string;    // full on-chain coin type
  scalar: number;  // 10^decimals
};

export type SwapPool = {
  key: string;     // registry key, e.g. 'DUSDC_DBUSDC'
  address: string; // on-chain Pool<Base, Quote> object id
  base: SwapAsset;
  quote: SwapAsset;
};

export type SwapDirection = 'baseToQuote' | 'quoteToBase';

export type SwapStepParams = {
  client: SwapClient;
  poolKey: string;
  direction: SwapDirection;
  /** Human units of the asset being sold. */
  amount: number;
  /** Human units minimum received (slippage floor). */
  minOut: number;
  /** Human units of DEEP for trading fees. */
  deepAmount: number;
  inputCoin?: TransactionObjectArgument;
  deepCoin?: TransactionObjectArgument;
};

// ---------------------------------------------------------------------------
// Amount conversion
// ---------------------------------------------------------------------------

export function toRawAmount(human: number, scalar: number): bigint {
  return BigInt(Math.round(human * scalar));
}

export function fromRawAmount(raw: bigint | number | string, scalar: number): number {
  return Number(raw) / scalar;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type SwapClient = ReturnType<typeof makeSwapClient>;

export function makeSwapClient(
  base: SuiGrpcClient,
  address: string,
  pool: SwapPool,
  deepCoin: SwapAsset,
): SwapClient {
  return base.$extend(
    deepbook({
      address,
      pools: {
        [pool.key]: { address: pool.address, baseCoin: pool.base.key, quoteCoin: pool.quote.key },
      },
      coins: {
        [pool.base.key]: pool.base,
        [pool.quote.key]: pool.quote,
        DEEP: deepCoin,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Composable PTB step
// ---------------------------------------------------------------------------

/**
 * Appends a single `swap_exact_quantity` to `tx` and returns
 * `[baseCoin, quoteCoin, deepCoin]` for chaining into further PTB steps.
 */
export function buildSwapStep(params: SwapStepParams) {
  const { client, poolKey, direction, amount, minOut, deepAmount, inputCoin, deepCoin } = params;
  const isBaseToCoin = direction === 'baseToQuote';

  return client.deepbook.deepBook.swapExactQuantity({
    poolKey,
    amount,
    minOut,
    deepAmount,
    isBaseToCoin,
    baseCoin: isBaseToCoin ? inputCoin : undefined,
    quoteCoin: isBaseToCoin ? undefined : inputCoin,
    deepCoin,
  });
}
