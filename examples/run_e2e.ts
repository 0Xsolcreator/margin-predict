/**
 * margin-predict — Interactive End-to-End Flow
 *
 * Walks through the full leveraged prediction market lifecycle in your
 * terminal: pick a live market from the indexer, configure the position,
 * watch it execute step-by-step, then choose how to exit.
 *
 * Flow:
 *   1. Select an active oracle from the indexer
 *   2. Choose direction (UP / DOWN), strike, collateral, leverage
 *   3. request_open  → on-chain (user wallet)
 *   4. keeper open   → keeper API
 *   5. Show live status & health factor
 *   6. Choose: Close | Liquidate | Settle | Leave open
 *
 * Usage:
 *   cd examples && npm run e2e
 *
 * Required .env keys: USER_PRIVATE_KEY, MARGIN_PREDICT_PACKAGE,
 *                     PREDICT_MANAGER_ID, KEEPER_URL
 */

import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Transaction } from '@mysten/sui/transactions';
import {
  PREDICT_PACKAGE, CLOCK_ID, DUSDC_TYPE,
  MARGIN_PREDICT_PACKAGE, PREDICT_MANAGER_ID, KEEPER_URL, NETWORK,
  createSuiClient, loadUserKeypair,
  signAndExecute, extractPositionId, type TxResult,
  keeperPost, keeperGet,
  log,
} from './shared.ts';
import {
  fetchActiveOracles, fetchOracleState,
  strikeRange, snapToTick, isOnGrid,
  fixedToUsd, usdToFixed,
  formatUsd, formatExpiry,
  type OracleSummary,
} from './oracle.ts';

// ── readline ─────────────────────────────────────────────────────────────────

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (prompt: string) => (await rl.question(prompt)).trim();

// ── Display helpers ───────────────────────────────────────────────────────────

const HR = '─'.repeat(60);
const HR2 = '═'.repeat(60);

function section(title: string) {
  console.log(`\n${HR}`);
  console.log(`  ${title}`);
  console.log(HR);
}

function formatHf(bpsStr: string): string {
  const bps = BigInt(bpsStr);
  if (bps >= BigInt('18446744073709551615')) return '∞  (no debt)';
  const pct = (Number(bps) / 100).toFixed(2);
  if (bps <= 10_000n) return `${pct}%  ⚠  HARD LIQUIDATION ZONE`;
  if (bps <= 10_500n) return `${pct}%  ⚠  SOFT LIQUIDATION ZONE`;
  return `${pct}%  (healthy)`;
}

function printOracleLine(i: number, o: OracleSummary) {
  const { min, max, tick } = strikeRange(o);
  console.log(`  [${i}] ${o.underlying_asset.padEnd(10)}  ${formatExpiry(o.expiry)}`);
  console.log(`        oracle  : ${o.oracle_id}`);
  console.log(`        strikes : ${formatUsd(min)} … ${formatUsd(max)}  (tick ${formatUsd(tick)})`);
}

// ── Interactive prompts ───────────────────────────────────────────────────────

async function selectOracle(): Promise<OracleSummary | null> {
  section('Step 1 — Select a market');
  process.stdout.write('Fetching active markets from indexer…');
  const oracles = await fetchActiveOracles();
  process.stdout.write('\r');

  if (oracles.length === 0) {
    console.log('No active markets right now. Try again later.');
    return null;
  }

  console.log(`\n${oracles.length} active market(s) — sorted by soonest expiry:\n`);
  oracles.forEach((o, i) => printOracleLine(i + 1, o));

  while (true) {
    const answer = await ask(`\nPick a market [1–${oracles.length}] or q to quit: `);
    if (answer.toLowerCase() === 'q') return null;
    const idx = parseInt(answer, 10) - 1;
    if (!Number.isNaN(idx) && idx >= 0 && idx < oracles.length) return oracles[idx];
    console.log(`  Invalid — enter a number between 1 and ${oracles.length}.`);
  }
}

async function selectDirection(): Promise<'up' | 'down' | null> {
  while (true) {
    const answer = await ask('\n  Direction — [u]p  [d]own  [q]uit: ');
    const l = answer.toLowerCase();
    if (l === 'q') return null;
    if (l === 'u' || l === 'up')   return 'up';
    if (l === 'd' || l === 'down') return 'down';
    console.log('  Enter u or d.');
  }
}

async function selectStrike(
  oracle: OracleSummary,
  spotUsd: number | null,
): Promise<number | null> {
  const { min, max, tick } = strikeRange(oracle);
  const suggestion = spotUsd !== null ? snapToTick(spotUsd, min, tick) : snapToTick((min + max) / 2, min, tick);

  console.log(`\n  Strike range : ${formatUsd(min)} … ${formatUsd(max)}`);
  console.log(`  Tick size    : ${formatUsd(tick)}`);
  if (spotUsd !== null) console.log(`  Current spot : ${formatUsd(spotUsd)}`);
  console.log(`  Suggested    : ${formatUsd(suggestion)}`);

  while (true) {
    const answer = await ask(`\n  Strike in USD [${suggestion}] or q to cancel: `);
    if (answer.toLowerCase() === 'q') return null;
    const value = answer === '' ? suggestion : parseFloat(answer);
    if (Number.isNaN(value)) { console.log('  Not a number.'); continue; }
    if (value < min || value > max) {
      console.log(`  Out of range (${formatUsd(min)} … ${formatUsd(max)}).`);
      continue;
    }
    if (!isOnGrid(value, min, tick)) {
      const lo = snapToTick(value, min, tick);
      const hi = lo + tick;
      console.log(`  Not on tick grid. Nearest valid: ${formatUsd(lo)} or ${formatUsd(Math.min(hi, max))}.`);
      continue;
    }
    return value;
  }
}

async function selectCollateral(): Promise<number | null> {
  while (true) {
    const answer = await ask('\n  Collateral in SUI [1.0] or q to cancel: ');
    if (answer.toLowerCase() === 'q') return null;
    const value = answer === '' ? 1.0 : parseFloat(answer);
    if (Number.isNaN(value) || value <= 0) { console.log('  Enter a positive number.'); continue; }
    return value;
  }
}

async function selectLeverage(): Promise<number | null> {
  console.log('\n  Valid leverage: 1.10x–1.40x (11000–14000 bps)');
  while (true) {
    const answer = await ask('  Leverage bps [12000 = 1.20x] or q to cancel: ');
    if (answer.toLowerCase() === 'q') return null;
    const value = answer === '' ? 12000 : parseInt(answer, 10);
    if (Number.isNaN(value) || value < 11000 || value > 14000) {
      console.log('  Must be an integer between 11000 and 14000.');
      continue;
    }
    return value;
  }
}

async function confirmPrompt(msg: string): Promise<boolean> {
  const answer = await ask(`\n  ${msg} [y/N]: `);
  return answer.toLowerCase() === 'y';
}

// ── On-chain helpers ──────────────────────────────────────────────────────────

async function doRequestOpen(
  oracle: OracleSummary,
  direction: 'up' | 'down',
  strikeUsd: number,
  collateralSui: number,
  leverageBps: number,
): Promise<string> {
  section('Step 3 — request_open  (user on-chain)');
  const client  = createSuiClient();
  const keypair = loadUserKeypair();
  const address = keypair.toSuiAddress();
  const collateralMist = BigInt(Math.round(collateralSui * 1e9));
  const expiry  = BigInt(oracle.expiry);
  const strike  = usdToFixed(strikeUsd);

  log(`User        : ${address}`);
  log(`Market      : ${oracle.underlying_asset} ${direction.toUpperCase()} @ ${formatUsd(strikeUsd)}`);
  log(`Collateral  : ${collateralSui} SUI`);
  log(`Leverage    : ${(leverageBps / 10000).toFixed(2)}x`);

  const tx = new Transaction();
  tx.setSender(address);

  const [payment] = tx.splitCoins(tx.gas, [collateralMist]);

  const marketKey = tx.moveCall({
    target: `${PREDICT_PACKAGE}::market_key::${direction}`,
    arguments: [
      tx.pure.id(oracle.oracle_id),
      tx.pure.u64(expiry),
      tx.pure.u64(strike),
    ],
  });

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

  log(`✓ MarginPosition : ${positionId}`);
  log(`  Status         : PENDING_OPEN`);
  return positionId;
}

async function doKeeperOpen(
  positionId: string,
  oracleId: string,
  leverageBps: number,
): Promise<void> {
  section('Step 4 — keeper open  (keeper API)');
  log(`POST ${KEEPER_URL}/positions/${positionId}/open`);

  const result = await keeperPost<any>(`/positions/${positionId}/open`, {
    leverageBps,
    oracleId,
  });

  log(`✓ Status         : OPEN`);
  log(`  Digest         : ${result.digest}`);
  log(`  Collateral SUI : ${(Number(result.collateralSui) / 1e9).toFixed(6)} SUI`);
  log(`  Margin debt    : ${(Number(result.marginDebt) / 1e6).toFixed(6)} DBUSDC`);
  log(`  Margin manager : ${result.marginManagerId}`);
}

async function showStatus(positionId: string, oracleId: string): Promise<void> {
  section('Step 5 — Position status');
  const pos    = await keeperGet<any>(`/positions/${positionId}`);
  const health = await keeperGet<any>(`/positions/${positionId}/health?oracleId=${oracleId}`);

  console.log(`  Status         : ${pos.status}`);
  console.log(`  Owner          : ${pos.owner}`);
  console.log(`  Margin debt    : ${(Number(pos.marginDebt) / 1e6).toFixed(6)} DBUSDC`);
  console.log(`  Collateral SUI : ${(Number(pos.collateralSui) / 1e9).toFixed(6)} SUI`);
  console.log(`  Health factor  : ${formatHf(health.healthFactorBps)}`);
}

// ── Exit actions ──────────────────────────────────────────────────────────────

async function doClose(positionId: string, oracleId: string): Promise<void> {
  section('Close — request_close  (user on-chain)');
  const client  = createSuiClient();
  const keypair = loadUserKeypair();
  const address = keypair.toSuiAddress();

  const tx = new Transaction();
  tx.setSender(address);
  tx.moveCall({
    target: `${MARGIN_PREDICT_PACKAGE}::position_manager::request_close`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(positionId), tx.object(CLOCK_ID)],
  });

  const result = await signAndExecute(client, keypair, tx, 'request_close');
  log(`✓ Close intent recorded — digest: ${result.digest}`);

  section('Close — keeper close  (keeper API)');
  log(`POST ${KEEPER_URL}/positions/${positionId}/close`);
  const r = await keeperPost<any>(`/positions/${positionId}/close`, { oracleId });
  log(`✓ Position CLOSED`);
  log(`  Digest         : ${r.digest}`);
  log(`  Repaid debt    : ${(Number(r.repaidDebt) / 1e6).toFixed(6)} DBUSDC`);
  log(`  Returned SUI   : ${(Number(r.withdrawnCollateral) / 1e9).toFixed(6)} SUI → ${r.owner}`);
}

async function doLiquidate(positionId: string, oracleId: string): Promise<void> {
  section('Liquidate  (keeper API)');

  const health = await keeperGet<any>(`/positions/${positionId}/health?oracleId=${oracleId}`);
  const hfBps  = BigInt(health.healthFactorBps);
  log(`Current health factor: ${formatHf(health.healthFactorBps)}`);

  if (hfBps > 10_500n) {
    console.log('\n  Position is still healthy — keeper will reject this.');
    const proceed = await confirmPrompt('Attempt liquidation anyway?');
    if (!proceed) return;
  }

  log(`POST ${KEEPER_URL}/positions/${positionId}/liquidate`);
  const r = await keeperPost<any>(`/positions/${positionId}/liquidate`, { oracleId });

  log(`✓ Liquidation executed (${r.mode})`);
  log(`  Digest          : ${r.digest}`);
  log(`  Mode            : ${r.mode}`);
  log(`  Repaid debt     : ${(Number(r.repaidDebt) / 1e6).toFixed(6)} DBUSDC`);
  log(`  Remaining debt  : ${(Number(r.remainingDebt) / 1e6).toFixed(6)} DBUSDC`);
  if (r.mode === 'hard') {
    log(`  Returned SUI    : ${(Number(r.withdrawnCollateral) / 1e9).toFixed(6)} SUI → ${r.owner}`);
    log(`  Status          : LIQUIDATED`);
  } else {
    log(`  Status          : Still OPEN — 25% closed, 75% remains`);
  }
}

async function doSettle(positionId: string, oracleId: string): Promise<void> {
  section('Settle  (keeper API)');
  log('Checking oracle settlement status…');
  log(`POST ${KEEPER_URL}/positions/${positionId}/settle`);
  const r = await keeperPost<any>(`/positions/${positionId}/settle`, { oracleId });

  log(`✓ Position SETTLED`);
  log(`  Digest         : ${r.digest}`);
  log(`  Repaid debt    : ${(Number(r.repaidDebt) / 1e6).toFixed(6)} DBUSDC`);
  log(`  Returned SUI   : ${(Number(r.withdrawnCollateral) / 1e9).toFixed(6)} SUI → ${r.owner}`);
}

// ── Exit menu ─────────────────────────────────────────────────────────────────

async function exitMenu(positionId: string, oracleId: string): Promise<void> {
  section('What would you like to do?');
  console.log('  [1] Close     — request_close (on-chain) + keeper close');
  console.log('  [2] Liquidate — keeper liquidate  (position must be unhealthy ≤ 1.05x)');
  console.log('  [3] Settle    — keeper settle     (oracle must have expired & settled)');
  console.log('  [q] Quit      — leave position open (re-run scripts 4-6 manually later)');

  while (true) {
    const choice = (await ask('\n  Choice: ')).toLowerCase();
    try {
      if (choice === '1') { await doClose(positionId, oracleId); break; }
      if (choice === '2') { await doLiquidate(positionId, oracleId); break; }
      if (choice === '3') { await doSettle(positionId, oracleId); break; }
      if (choice === 'q' || choice === 'quit') {
        console.log(`\n  Position ${positionId} is still OPEN.`);
        console.log('  Use the individual scripts or re-run npm run e2e to close it later.');
        break;
      }
      console.log('  Invalid — enter 1, 2, 3, or q.');
    } catch (err) {
      console.error(`\n  ✗ ${(err as Error).message}`);
      const retry = await confirmPrompt('Try a different action?');
      if (!retry) break;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + HR2);
  console.log('  margin-predict  —  End-to-End Interactive Flow');
  console.log(HR2);
  console.log(`  Network : ${NETWORK}`);
  console.log(`  Keeper  : ${KEEPER_URL}`);
  try {
    const keypair = loadUserKeypair();
    console.log(`  User    : ${keypair.toSuiAddress()}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('must be set')) {
      console.log('  User    : (set USER_PRIVATE_KEY in examples/.env)');
    } else {
      console.log('  User    : ✗ invalid key —', msg.split('\n')[0]);
    }
  }

  // ── 1. Select oracle ──────────────────────────────────────────────────────
  const oracle = await selectOracle();
  if (!oracle) { rl.close(); return; }

  // ── Fetch spot price ──────────────────────────────────────────────────────
  const state   = await fetchOracleState(oracle.oracle_id).catch(() => null);
  const spotUsd = state?.latest_price ? fixedToUsd(state.latest_price.spot) : null;

  section('Step 2 — Configure position');
  console.log(`  Asset     : ${oracle.underlying_asset}`);
  console.log(`  Expiry    : ${formatExpiry(oracle.expiry)}`);
  if (spotUsd !== null) console.log(`  Spot      : ${formatUsd(spotUsd)}`);

  // ── 2a. Direction ─────────────────────────────────────────────────────────
  const direction = await selectDirection();
  if (!direction) { rl.close(); return; }

  // ── 2b. Strike ────────────────────────────────────────────────────────────
  const strikeUsd = await selectStrike(oracle, spotUsd);
  if (strikeUsd === null) { rl.close(); return; }

  // ── 2c. Collateral ────────────────────────────────────────────────────────
  const collateralSui = await selectCollateral();
  if (collateralSui === null) { rl.close(); return; }

  // ── 2d. Leverage ──────────────────────────────────────────────────────────
  const leverageBps = await selectLeverage();
  if (leverageBps === null) { rl.close(); return; }

  // ── Preview & confirm ─────────────────────────────────────────────────────
  console.log(`\n${HR}`);
  console.log('  Position preview');
  console.log(HR);
  console.log(`  Market     : ${oracle.underlying_asset} ${direction.toUpperCase()} @ ${formatUsd(strikeUsd)}`);
  console.log(`  Oracle     : ${oracle.oracle_id}`);
  console.log(`  Expiry     : ${formatExpiry(oracle.expiry)}`);
  console.log(`  Collateral : ${collateralSui} SUI`);
  console.log(`  Leverage   : ${(leverageBps / 100).toFixed(2)}x (${leverageBps} bps)`);
  console.log(`  Borrow est : ~collateral_SUI × SUI/USD × ${((leverageBps / 10000 - 1) * 100).toFixed(0)}%  DBUSDC`);
  console.log(`               (exact amount fetched from Pyth at open time)`);

  const ok = await confirmPrompt('Proceed with this position?');
  if (!ok) { console.log('  Cancelled.'); rl.close(); return; }

  // ── 3. request_open ───────────────────────────────────────────────────────
  const positionId = await doRequestOpen(
    oracle, direction, strikeUsd, collateralSui, leverageBps,
  );

  // ── 4. keeper open ────────────────────────────────────────────────────────
  await doKeeperOpen(positionId, oracle.oracle_id, leverageBps);

  // ── 5. show live status ───────────────────────────────────────────────────
  await showStatus(positionId, oracle.oracle_id);

  // ── 6. exit menu ─────────────────────────────────────────────────────────
  await exitMenu(positionId, oracle.oracle_id);

  console.log(`\n${HR2}`);
  console.log('  Done');
  console.log(`  positionId : ${positionId}`);
  console.log(HR2 + '\n');

  rl.close();
}

main().catch((err) => {
  console.error('\n[FATAL]', (err as Error).message);
  if (process.env.DEBUG) console.error(err);
  rl.close();
  process.exit(1);
});
