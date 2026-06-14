/// File-based position store.
///
/// The keeper runs ONE shared MarginManager. Every open MarginPosition<DUSDC>
/// borrows against that manager, so this store tracks each position's slice of
/// debt and collateral so the keeper can unwind the right amounts on
/// close / settle / liquidation.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA_DIR  = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const STORE_PATH = join(DATA_DIR, 'positions.json');

export interface PositionRecord {
  /** Owner address — receives funds on close / settle / hard liquidation. */
  owner: string;
  /** Shared MarginManager object id this position's borrow lives in. */
  marginManagerId: string;
  /** Outstanding DBUSDC principal (raw, 6 decimals). */
  marginDebt: string;
  /** SUI collateral deposited for this position (raw, 9 decimals). */
  collateralSui: string;
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
