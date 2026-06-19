// Protocol constants, PTB builders for the margin_predict contract, and the
// keeper proxy. Testnet defaults mirror examples/shared.ts; override via env.

import { Transaction, coinWithBalance } from '@mysten/sui/transactions';

const env = (k: string, d = '') => process.env[k]?.trim() || d;

export const PREDICT_PACKAGE = env('PREDICT_PACKAGE', '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138');
export const DUSDC_TYPE       = env('DUSDC_TYPE', '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC');
export const CLOCK_ID         = '0x6';
export const KEEPER_URL       = env('KEEPER_URL', 'http://localhost:4000');

// Read live (not at import) so .env loaded after this module still applies.
function pkg(): string {
  const v = env('MARGIN_PREDICT_PACKAGE');
  if (!v) throw new Error('MARGIN_PREDICT_PACKAGE not set in backend/.env');
  return v;
}
function manager(): string {
  const v = env('PREDICT_MANAGER_ID');
  if (!v) throw new Error('PREDICT_MANAGER_ID not set in backend/.env');
  return v;
}

export interface OpenParams {
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
  collateralMist: bigint;
  leverageBps: number;
}

/** request_open: escrows the user's SUI, creates a PENDING_OPEN MarginPosition.
 * useGasCoin:false so collateral comes from the user's SUI, not the sponsor gas. */
export function buildRequestOpen(tx: Transaction, p: OpenParams): void {
  const payment = coinWithBalance({ balance: p.collateralMist, useGasCoin: false })(tx);
  const marketKey = tx.moveCall({
    target: `${PREDICT_PACKAGE}::market_key::new`,
    arguments: [tx.pure.id(p.oracleId), tx.pure.u64(p.expiry), tx.pure.u64(p.strike), tx.pure.bool(p.isUp)],
  });
  tx.moveCall({
    target: `${pkg()}::position_manager::request_open`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.pure.id(manager()), tx.pure.u64(p.leverageBps), marketKey, payment, tx.object(CLOCK_ID)],
  });
}

/** request_close: sets the close intent the keeper picks up to unwind. */
export function buildRequestClose(tx: Transaction, positionId: string): void {
  tx.moveCall({
    target: `${pkg()}::position_manager::request_close`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(positionId), tx.object(CLOCK_ID)],
  });
}

/** cancel_intent: claws back escrowed SUI (pending-open) or clears a close intent.
 * Aborts on-chain if the intent is younger than the 120s timeout. */
export function buildCancelIntent(tx: Transaction, positionId: string, owner: string): void {
  const [returnedSui] = tx.moveCall({
    target: `${pkg()}::position_manager::cancel_intent`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(positionId), tx.object(CLOCK_ID)],
  });
  tx.transferObjects([returnedSui], owner);
}

/** Keeper service proxy. Throws with the keeper's body on non-2xx. */
export async function keeper<T = unknown>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const res = await fetch(`${KEEPER_URL}${path}`, {
    method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Keeper ${method} ${path} (${res.status}): ${JSON.stringify(data)}`);
  return data as T;
}
