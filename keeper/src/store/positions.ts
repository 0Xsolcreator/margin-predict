/// File-based position registry.
///
/// Tracks which MarginPosition ids this keeper has opened, so /positions can
/// enumerate them (Sui has no on-chain index of shared objects by type).
/// Financial fields (status, margin debt, SUI collateral) are NOT cached here
/// — they're read live from the on-chain MarginPosition via
/// `chain/contract.ts#readPositionFinancials`, which is authoritative.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA_DIR  = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const STORE_PATH = join(DATA_DIR, 'positions.json');

export interface PositionRecord {
  /** Owner address — receives funds on close / settle / hard liquidation. */
  owner: string;
  /** Oracle this position trades against — needed to read health / liquidate.
   * Optional for records written before monitoring existed; those can't be
   * auto-monitored and must be liquidated via the API with an explicit oracleId. */
  oracleId?: string;
  updatedAt: string;
}

type Store = Record<string, PositionRecord>;

function load(): Store {
  if (!existsSync(STORE_PATH)) return {};
  return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as Store;
}

function persist(data: Store): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

export function getPosition(positionId: string): PositionRecord | undefined {
  return load()[positionId];
}

export function setPosition(positionId: string, record: PositionRecord): void {
  const data = load();
  data[positionId] = record;
  persist(data);
}

export function deletePosition(positionId: string): void {
  const data = load();
  delete data[positionId];
  persist(data);
}

export function listPositions(): Store {
  return load();
}
