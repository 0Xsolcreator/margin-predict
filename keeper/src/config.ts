import 'dotenv/config';
import { testnetCoins } from '@mysten/deepbook-v3';
import type { SwapAsset, SwapPool } from './deepbook/swap.js';

export type Network = 'testnet' | 'mainnet';

export const NETWORK = (process.env.NETWORK ?? 'testnet') as Network;
export const PORT = parseInt(process.env.KEEPER_PORT ?? '4000', 10);

// ---------------------------------------------------------------------------
// RPC & oracle
// ---------------------------------------------------------------------------

export const RPC_URLS: Record<Network, string> = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
};

export const PYTH_HERMES: Record<Network, string> = {
  testnet: 'https://hermes-beta.pyth.network',
  mainnet: 'https://hermes.pyth.network',
};

export const PYTH_STATE: Record<Network, { pythStateId: string; wormholeStateId: string }> = {
  testnet: {
    pythStateId: '0x243759059f4c3111179da5878c12f68d612c21a8d54d85edc86164bb18be1c7c',
    wormholeStateId: '0x31358d198147da50db32eda2562951d53973a0c0ad5ed738e9b17d88b213d790',
  },
  mainnet: {
    pythStateId: '0x1f9310238ee9298fb703c3419030b35b22bb1cc37113e3bb5007c99aec79e5b8',
    wormholeStateId: '0xaeab97f96cf9877fee2883315d459552b2b921edc16d7ceac6eab944dd88919c',
  },
};

export const PYTH_FEED_IDS: Record<Network, { SUI: string; QUOTE: string }> = {
  testnet: {
    SUI:   '0x50c67b3fd225db8912a424dd4baed60ffdde625ed2feaaf283724f9608fea266',
    QUOTE: '0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722',
  },
  mainnet: {
    SUI:   '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
    QUOTE: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  },
};

// ---------------------------------------------------------------------------
// DeepBook Predict (read-only — set by the protocol)
// ---------------------------------------------------------------------------

export const PREDICT_PACKAGE = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
export const PREDICT_ID      = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
export const CLOCK_ID        = '0x6';

// ---------------------------------------------------------------------------
// margin_predict package — set after publishing contracts/margin_predict/
// ---------------------------------------------------------------------------

export const MARGIN_PREDICT_PACKAGE = process.env.MARGIN_PREDICT_PACKAGE?.trim() ?? '';

export function requireMarginPredictPackage(): string {
  if (!MARGIN_PREDICT_PACKAGE) {
    throw new Error(
      'MARGIN_PREDICT_PACKAGE not set — publish contracts/margin_predict/ and ' +
      'paste the package ID into keeper/.env as MARGIN_PREDICT_PACKAGE=0x...',
    );
  }
  return MARGIN_PREDICT_PACKAGE;
}

// ---------------------------------------------------------------------------
// Shared PredictManager (owned by this keeper)
// ---------------------------------------------------------------------------

export const PREDICT_MANAGER_ID = process.env.PREDICT_MANAGER_ID?.trim() ?? '';

export function requirePredictManagerId(): string {
  if (!PREDICT_MANAGER_ID) {
    throw new Error('PREDICT_MANAGER_ID not set in keeper/.env');
  }
  return PREDICT_MANAGER_ID;
}

// ---------------------------------------------------------------------------
// Shared SUI/DBUSDC MarginManager (owned by this keeper)
// ---------------------------------------------------------------------------

export const MARGIN_POOL_KEY     = 'SUI_DBUSDC'; // testnet pool key
export const MARGIN_MANAGER_KEY  = 'KEEPER_MARGIN_MANAGER';
export const MARGIN_MANAGER_ID   = process.env.MARGIN_MANAGER_ID?.trim() ?? '';

export function requireMarginManagerId(): string {
  if (!MARGIN_MANAGER_ID) {
    throw new Error('MARGIN_MANAGER_ID not set in keeper/.env');
  }
  return MARGIN_MANAGER_ID;
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

export const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';

export const DUSDC_COIN: SwapAsset = {
  key: 'DUSDC',
  address: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a',
  type: DUSDC_TYPE,
  scalar: 1_000_000,
};

export const DBUSDC_COIN: SwapAsset = {
  key:     'DBUSDC',
  address: testnetCoins.DBUSDC.address,
  type:    testnetCoins.DBUSDC.type,
  scalar:  testnetCoins.DBUSDC.scalar,
};

export const DEEP_COIN: SwapAsset = {
  key:     'DEEP',
  address: testnetCoins.DEEP.address,
  type:    testnetCoins.DEEP.type,
  scalar:  testnetCoins.DEEP.scalar,
};

export const SUI_COIN: SwapAsset = {
  key:     'SUI',
  address: testnetCoins.SUI.address,
  type:    testnetCoins.SUI.type,
  scalar:  testnetCoins.SUI.scalar,
};

// ---------------------------------------------------------------------------
// DUSDC/DBUSDC swap pool
// ---------------------------------------------------------------------------

export function getSwapPool(): SwapPool | null {
  const address = process.env.DUSDC_DBUSDC_POOL_ID?.trim();
  if (!address) return null;
  return { key: 'DUSDC_DBUSDC', address, base: DUSDC_COIN, quote: DBUSDC_COIN };
}

// ---------------------------------------------------------------------------
// Leverage bounds (mirrors position_manager constants)
// ---------------------------------------------------------------------------

export const BPS              = 10_000;
export const MIN_LEVERAGE_BPS = 11_000; // 1.10x
export const MAX_LEVERAGE_BPS = 14_000; // 1.40x

export const HF_HARD_BPS = 10_000n; // ≤ 1.00x → hard liquidation
export const HF_SOFT_BPS = 10_500n; // ≤ 1.05x → soft liquidation

// ---------------------------------------------------------------------------
// Swap settings
// ---------------------------------------------------------------------------

export const SWAP_SLIPPAGE_BPS = parseInt(process.env.SWAP_SLIPPAGE_BPS ?? '100', 10);
export const SWAP_DEEP_AMOUNT  = parseFloat(process.env.SWAP_DEEP_AMOUNT ?? '0');

// Fallback SUI/USD price used only to size DBUSDC borrows — never for risk.
export const SUI_PRICE_FALLBACK = parseFloat(process.env.SUI_PRICE_ESTIMATE ?? '1.5');
