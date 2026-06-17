/**
 * Step 1 — User on-chain: request_open
 *
 * Creates a MarginPosition<DUSDC> in PENDING_OPEN by calling
 * position_manager::request_open. Escrows the user's SUI collateral and
 * records the desired leverage + market. The keeper then picks this up via
 * Step 2 (keeper_open).
 *
 * Usage:
 *   cd examples && cp .env.example .env  # fill in values
 *   npm run request-open
 *
 * Prints the positionId — pass it as POSITION_ID to subsequent steps.
 */

import { Transaction } from '@mysten/sui/transactions';
import {
  PREDICT_PACKAGE, CLOCK_ID, DUSDC_TYPE,
  MARGIN_PREDICT_PACKAGE, PREDICT_MANAGER_ID,
  createSuiClient, loadUserKeypair,
  getOracleParams, getPositionParams,
  signAndExecute, extractPositionId, type TxResult,
  log, printResult,
} from './shared.ts';

async function main() {
  const client  = createSuiClient();
  const keypair = loadUserKeypair();
  const address = keypair.toSuiAddress();
  const { oracleId, expiry, strike, isUp } = getOracleParams();
  const { collateralSui, leverageBps } = getPositionParams();
  const collateralMist = BigInt(Math.round(collateralSui * 1e9));

  log(`User address  : ${address}`);
  log(`Collateral    : ${collateralSui} SUI (${collateralMist} MIST)`);
  log(`Leverage      : ${(leverageBps / 10000).toFixed(2)}x (${leverageBps} bps)`);
  log(`Oracle        : ${oracleId}`);
  log(`Market        : expiry=${expiry}  strike=${strike}  direction=${isUp ? 'UP' : 'DOWN'}`);

  const tx = new Transaction();
  tx.setSender(address);

  // Split collateral from the gas coin
  const [payment] = tx.splitCoins(tx.gas, [collateralMist]);

  // Build MarketKey value from oracle params
  const marketKey = tx.moveCall({
    target: `${PREDICT_PACKAGE}::market_key::new`,
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiry),
      tx.pure.u64(strike),
      tx.pure.bool(isUp),
    ],
  });

  // Creates and shares a MarginPosition<DUSDC> in PENDING_OPEN
  tx.moveCall({
    target: `${MARGIN_PREDICT_PACKAGE}::position_manager::request_open`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.pure.id(PREDICT_MANAGER_ID),
      tx.pure.u64(leverageBps),
      marketKey,
      payment,
      tx.object(CLOCK_ID),
    ],
  });

  const result = await signAndExecute(client, keypair, tx, 'request_open');

  const positionId = extractPositionId(result as TxResult);

  printResult('request_open — success', {
    positionId,
    digest: result.digest,
    status: 'PENDING_OPEN',
    collateralSui,
    leverageBps,
    oracleId,
    expiry: expiry.toString(),
    strike: strike.toString(),
    isUp,
  });

  // Print positionId last for easy shell capture: POSITION_ID=$(npm run request-open -s)
  console.log(`\nPOSITION_ID=${positionId}`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
