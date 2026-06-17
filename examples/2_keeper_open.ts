/**
 * Step 2 — Keeper API: open position
 *
 * Tells the keeper to execute the open lifecycle for a PENDING_OPEN position:
 *   1. Withdraw escrowed SUI from the MarginPosition
 *   2. Deposit SUI into the shared DeepBook MarginManager as collateral
 *   3. Borrow DBUSDC against it
 *   4. Swap DBUSDC → DUSDC
 *   5. Mint the Predict position, confirm OPEN
 *
 * Prerequisites:
 *   - Step 1 (request_open) has been executed on-chain
 *   - The keeper service is running (cd keeper && npm run dev)
 *
 * Usage:
 *   POSITION_ID=0x... ORACLE_ID=0x... npm run keeper-open
 */

import {
  KEEPER_URL, keeperPost, getOracleParams, getPositionParams,
  log, printResult,
} from './shared.ts';

async function main() {
  const positionId = process.env.POSITION_ID?.trim();
  if (!positionId) throw new Error('POSITION_ID must be set (output from Step 1)');

  const { oracleId } = getOracleParams();
  const { leverageBps } = getPositionParams();

  log(`Keeper URL  : ${KEEPER_URL}`);
  log(`Position ID : ${positionId}`);
  log(`Oracle ID   : ${oracleId}`);
  log(`Leverage    : ${(leverageBps / 100).toFixed(2)}x`);

  const result = await keeperPost(`/positions/${positionId}/open`, {
    leverageBps,
    oracleId,
  });

  printResult('keeper open — success', result);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
