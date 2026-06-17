/**
 * Step 5 — Keeper API: close position
 *
 * Executes the close lifecycle for a position that has a pending CLOSE intent:
 *   1. Redeem the full Predict position → Coin<DUSDC> proceeds
 *   2. Swap DUSDC → DBUSDC
 *   3. Deposit DBUSDC and repay this position's recorded debt
 *   4. Withdraw the position's SUI collateral from the MarginManager
 *   5. Forward withdrawn SUI + DUSDC dust to the position owner
 *
 * Prerequisites:
 *   - Step 4 (request_close) has been executed on-chain by the owner
 *   - The keeper service is running
 *
 * Usage:
 *   POSITION_ID=0x... ORACLE_ID=0x... npm run keeper-close
 */

import { KEEPER_URL, keeperPost, getOracleParams, log, printResult } from './shared.ts';

async function main() {
  const positionId = process.env.POSITION_ID?.trim();
  if (!positionId) throw new Error('POSITION_ID must be set (output from Step 1)');

  const { oracleId } = getOracleParams();

  log(`Keeper URL  : ${KEEPER_URL}`);
  log(`Position ID : ${positionId}`);
  log(`Oracle ID   : ${oracleId}`);

  const result = await keeperPost(`/positions/${positionId}/close`, { oracleId });

  printResult('keeper close — success', result);
  log('Position fully closed. SUI collateral returned to owner.');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
