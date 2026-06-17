/**
 * Step 3 — Check position status and health
 *
 * Reads live on-chain state from the keeper:
 *   GET /positions/:id          — status, margin debt, SUI collateral
 *   GET /positions/:id/health   — health factor in bps (10000 = 1.00x)
 *   GET /positions              — all tracked positions
 *
 * Usage:
 *   POSITION_ID=0x... ORACLE_ID=0x... npm run check
 *   ORACLE_ID=0x... npm run check          # lists all positions
 */

import { KEEPER_URL, keeperGet, getOracleParams, log, printResult } from './shared.ts';

const STATUS_NAMES: Record<string, string> = {
  PENDING_OPEN: 'PENDING_OPEN',
  OPEN:         'OPEN',
  CLOSED:       'CLOSED',
  LIQUIDATED:   'LIQUIDATED',
  CANCELLED:    'CANCELLED',
};

function formatHealthFactor(bps: string): string {
  const n = BigInt(bps);
  if (n === BigInt('18446744073709551615')) return 'INFINITE (no debt)';
  const pct = (Number(n) / 100).toFixed(2);
  let warning = '';
  if (n <= 10_000n) warning = '  ⚠  HARD LIQUIDATION ZONE';
  else if (n <= 10_500n) warning = '  ⚠  SOFT LIQUIDATION ZONE';
  return `${pct}% (${n} bps)${warning}`;
}

async function main() {
  const positionId = process.env.POSITION_ID?.trim();
  const { oracleId } = getOracleParams();

  log(`Keeper URL : ${KEEPER_URL}`);

  if (positionId) {
    log(`Position   : ${positionId}`);

    // Single position details
    const position = await keeperGet(`/positions/${positionId}`) as any;
    printResult('Position state', {
      ...position,
      marginDebtDbusdc: (Number(position.marginDebt) / 1e6).toFixed(6) + ' DBUSDC',
      collateralSuiHuman: (Number(position.collateralSui) / 1e9).toFixed(9) + ' SUI',
    });

    // Health factor (requires OPEN status)
    if (position.status === 'OPEN') {
      const health = await keeperGet(
        `/positions/${positionId}/health?oracleId=${oracleId}`,
      ) as any;
      log(`Health factor: ${formatHealthFactor(health.healthFactorBps)}`);
    } else {
      log(`Skipping health check — position is ${STATUS_NAMES[position.status] ?? position.status}`);
    }
  } else {
    // List all tracked positions
    log('No POSITION_ID set — listing all tracked positions');
    const positions = await keeperGet('/positions') as any[];
    if (positions.length === 0) {
      log('No positions are currently tracked by this keeper');
    } else {
      printResult(`All positions (${positions.length})`, positions);
    }
  }

  // Always show config
  const config = await keeperGet('/config/leverage-range') as any;
  log(`Leverage range: ${config.min}x – ${config.max}x (${config.minBps}–${config.maxBps} bps)`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
