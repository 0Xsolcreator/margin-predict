/**
 * Step 6 (alternative) — Keeper API: liquidate an unhealthy position
 *
 * Checks the health factor then executes a liquidation:
 *
 *   Soft liquidation (health ≤ 1.05x):
 *     - Closes 25% of the position, repays 25% of the margin debt
 *     - Position stays OPEN; SUI collateral stays in MarginManager
 *
 *   Hard liquidation (health ≤ 1.00x):
 *     - Closes the full position, repays all debt
 *     - Position → LIQUIDATED; SUI collateral returned to owner
 *
 * The keeper self-flags the position if no one else has, earning the
 * 2% reporter fee directly to its wallet.
 *
 * Will return 409 if the position is still healthy (hf > 1.05x).
 *
 * Usage:
 *   POSITION_ID=0x... ORACLE_ID=0x... npm run liquidate
 */

import { KEEPER_URL, keeperGet, keeperPost, getOracleParams, log, printResult } from './shared.ts';

async function main() {
  const positionId = process.env.POSITION_ID?.trim();
  if (!positionId) throw new Error('POSITION_ID must be set');

  const { oracleId } = getOracleParams();

  log(`Keeper URL  : ${KEEPER_URL}`);
  log(`Position ID : ${positionId}`);

  // Read current health factor before attempting liquidation
  try {
    const health = await keeperGet(
      `/positions/${positionId}/health?oracleId=${oracleId}`,
    ) as any;
    const hf = BigInt(health.healthFactorBps);
    const hfPct = (Number(hf) / 100).toFixed(2);
    const zone = hf <= 10_000n ? 'HARD' : hf <= 10_500n ? 'SOFT' : 'HEALTHY';
    log(`Health factor: ${hfPct}% → ${zone}`);
  } catch {
    log('Could not read health factor (position may not be OPEN or not tracked)');
  }

  const result = await keeperPost(`/positions/${positionId}/liquidate`, { oracleId });
  printResult('keeper liquidate — success', result);

  const r = result as any;
  if (r.mode === 'hard') {
    log('Hard liquidation complete. Position → LIQUIDATED. SUI returned to owner.');
  } else {
    log(`Soft liquidation complete. 25% closed. Remaining debt: ${r.remainingDebt} DBUSDC raw.`);
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
