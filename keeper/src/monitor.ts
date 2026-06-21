/// Background liquidation monitor.
///
/// Every LIQUIDATION_POLL_MS, scans tracked positions, reads each one's on-chain
/// status, and runs liquidatePosition() on any OPEN position that has dropped to
/// the soft/hard threshold. The liquidation itself (health re-check, flag,
/// execute) is the same code path the manual API uses.
///
/// Env:
///   LIQUIDATION_MONITOR=off   disable the loop
///   LIQUIDATION_POLL_MS=30000 poll interval

import type { FastifyInstance } from 'fastify';
import { loadKeypair, createGrpcClient } from './chain/client.js';
import { readPositionFinancials } from './chain/contract.js';
import { listPositions } from './store/positions.js';
import { liquidatePosition } from './liquidation.js';

const OPEN_STATUS = 1;

export function startLiquidationMonitor(app: FastifyInstance): void {
  if (process.env.LIQUIDATION_MONITOR === 'off') {
    app.log.info('liquidation monitor disabled (LIQUIDATION_MONITOR=off)');
    return;
  }
  const intervalMs = parseInt(process.env.LIQUIDATION_POLL_MS ?? '30000', 10);
  let running = false; // ponytail: skip overlapping ticks instead of queueing

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const base = createGrpcClient();
      const address = loadKeypair().toSuiAddress();
      for (const [positionId, record] of Object.entries(listPositions())) {
        try {
          const { status } = await readPositionFinancials(base, address, positionId);
          if (status !== OPEN_STATUS) continue;

          // oracleId resolves inside liquidatePosition (tracked, else from chain).
          const out = await liquidatePosition(positionId, record.oracleId);
          if (out.status === 'liquidated') {
            app.log.warn(
              { positionId, mode: out.mode, healthFactorBps: out.healthFactorBps, digest: out.digest },
              'auto-liquidated unhealthy position',
            );
          } else if (out.status !== 'healthy') {
            app.log.error({ positionId, outcome: out.status }, 'liquidation attempt did not complete');
          }
        } catch (err) {
          app.log.error({ err, positionId }, 'liquidation monitor: position check failed');
        }
      }
    } finally {
      running = false;
    }
  };

  setInterval(() => { void tick(); }, intervalMs).unref();
  app.log.info({ intervalMs }, 'liquidation monitor started');
}
