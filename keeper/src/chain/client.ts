import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { deepbook, SuiPythClient, SuiPriceServiceConnection } from '@mysten/deepbook-v3';
import type { MarginManager } from '@mysten/deepbook-v3';
import { makeSwapClient, type SwapClient } from '../deepbook/swap.js';
import {
  NETWORK,
  RPC_URLS,
  PYTH_HERMES,
  PYTH_STATE,
  PYTH_FEED_IDS,
  MARGIN_POOL_KEY,
  MARGIN_MANAGER_KEY,
  DEEP_COIN,
  requireMarginManagerId,
  getSwapPool,
} from '../config.js';

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export function loadKeypair(): Ed25519Keypair {
  const key = process.env.SUI_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      'SUI_PRIVATE_KEY not set in keeper/.env\n' +
      'Export via: sui keytool export --key-identity <your-address>',
    );
  }
  if (key.startsWith('suiprivkey')) return Ed25519Keypair.fromSecretKey(key);
  const bytes = Buffer.from(key, 'base64');
  return Ed25519Keypair.fromSecretKey(bytes.subarray(1));
}

// ---------------------------------------------------------------------------
// Chain clients
// ---------------------------------------------------------------------------

export function createGrpcClient(): SuiGrpcClient {
  return new SuiGrpcClient({ network: NETWORK, baseUrl: RPC_URLS[NETWORK] });
}

export type MarginClient = ReturnType<typeof createMarginClient>;

/** gRPC client extended with the keeper's shared SUI/DBUSDC MarginManager. */
export function createMarginClient(base: SuiGrpcClient, address: string) {
  const marginManagers: Record<string, MarginManager> = {
    [MARGIN_MANAGER_KEY]: { address: requireMarginManagerId(), poolKey: MARGIN_POOL_KEY },
  };
  return base.$extend(deepbook({ address, marginManagers }));
}

/** gRPC client extended with the DUSDC/DBUSDC swap pool. */
export function createSwapClient(base: SuiGrpcClient, address: string): SwapClient {
  const pool = getSwapPool();
  if (!pool) {
    throw new Error('DUSDC_DBUSDC_POOL_ID not set in keeper/.env');
  }
  return makeSwapClient(base, address, pool, DEEP_COIN);
}

// ---------------------------------------------------------------------------
// Pyth price refresh
// ---------------------------------------------------------------------------

/**
 * Pushes fresh Pyth VAA data onto `tx` so on-chain price-freshness checks
 * pass. Required before DeepBook Margin ops that read oracle prices
 * (deposit, borrow, withdraw). NOT required for repay.
 */
export async function injectPythPrices(
  base: SuiGrpcClient,
  tx: Transaction,
  sender: string,
): Promise<void> {
  tx.setSender(sender);
  const feeds = PYTH_FEED_IDS[NETWORK];
  const feedIds = [feeds.SUI, feeds.QUOTE];

  const priceService = new SuiPriceServiceConnection(PYTH_HERMES[NETWORK]);
  const updateData = await priceService.getPriceFeedsUpdateData(feedIds);

  const pythClient = new SuiPythClient(
    base,
    PYTH_STATE[NETWORK].pythStateId,
    PYTH_STATE[NETWORK].wormholeStateId,
  );
  await pythClient.updatePriceFeeds(tx, updateData, feedIds);
}

// ---------------------------------------------------------------------------
// SUI price
// ---------------------------------------------------------------------------

/**
 * Live SUI/USD price from Pyth Hermes, used to size DBUSDC borrows.
 * Throws if Hermes is unreachable or returns no usable price — opening a
 * position with a guessed price would silently mis-size the borrow (no
 * on-chain check ties realized leverage back to the requested leverageBps),
 * so failing here is safer than proceeding. Safe to retry: nothing on-chain
 * has been touched yet at this point.
 */
export async function fetchSuiPrice(): Promise<number> {
  const feedId = PYTH_FEED_IDS[NETWORK].SUI;
  const res = await fetch(`${PYTH_HERMES[NETWORK]}/api/latest_price_feeds?ids[]=${feedId}`);
  if (!res.ok) {
    throw new Error(`Pyth Hermes unreachable (${res.status}) — cannot size DBUSDC borrow`);
  }
  const [feed] = (await res.json()) as Array<{ price?: { price: string; expo: number } }>;
  const price = feed?.price ? Number(feed.price.price) * 10 ** Number(feed.price.expo) : NaN;
  if (!(price > 0)) {
    throw new Error('Pyth Hermes returned no usable SUI/USD price — cannot size DBUSDC borrow');
  }
  return price;
}
