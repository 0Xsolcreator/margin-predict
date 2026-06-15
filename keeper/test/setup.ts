// Deterministic config for tests, set before any module (and dotenv) loads —
// dotenv only fills in vars that aren't already set, so these win over `.env`.
process.env.NETWORK = 'testnet';
process.env.MARGIN_PREDICT_PACKAGE = '0x' + 'aa'.repeat(32);
process.env.PREDICT_MANAGER_ID = '0x' + 'bb'.repeat(32);
process.env.MARGIN_MANAGER_ID = '0x' + 'cc'.repeat(32);
process.env.DUSDC_DBUSDC_POOL_ID = '0x' + 'dd'.repeat(32);
process.env.SWAP_SLIPPAGE_BPS = '100';
process.env.SWAP_DEEP_AMOUNT = '0';
