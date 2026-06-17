/**
 * Step 7 (escape hatch) — User on-chain: cancel_intent
 *
 * Cancels a pending open or close intent if the keeper has not executed it
 * within 120 seconds. Returns any escrowed SUI to the position owner.
 *
 * - Cancelling a PENDING_OPEN: returns the SUI collateral, marks CANCELLED
 * - Cancelling a pending CLOSE: clears the intent, leaves position OPEN
 *
 * Only works after the 120-second CANCEL_TIMEOUT_MS has elapsed.
 * Must be signed by the position owner.
 *
 * Usage:
 *   POSITION_ID=0x... npm run cancel-intent
 */

import { Transaction } from '@mysten/sui/transactions';
import {
  CLOCK_ID, DUSDC_TYPE, MARGIN_PREDICT_PACKAGE,
  createSuiClient, loadUserKeypair,
  signAndExecute, log, printResult,
} from './shared.ts';

async function main() {
  const positionId = process.env.POSITION_ID?.trim();
  if (!positionId) throw new Error('POSITION_ID must be set');

  const client  = createSuiClient();
  const keypair = loadUserKeypair();
  const address = keypair.toSuiAddress();

  log(`User address : ${address}`);
  log(`Position ID  : ${positionId}`);
  log('Cancelling pending intent (must be ≥ 120s old)...');

  const tx = new Transaction();
  tx.setSender(address);

  // cancel_intent returns Coin<SUI> (non-zero only for pending-open cancellation)
  const [returnedSui] = tx.moveCall({
    target: `${MARGIN_PREDICT_PACKAGE}::position_manager::cancel_intent`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(positionId),
      tx.object(CLOCK_ID),
    ],
  });

  // Transfer returned SUI back to owner (zero coin on close-intent cancel is harmless)
  tx.transferObjects([returnedSui], address);

  const result = await signAndExecute(client, keypair, tx, 'cancel_intent');

  printResult('cancel_intent — success', {
    positionId,
    digest: result.digest,
    note: 'Any escrowed SUI has been returned to your wallet.',
  });
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
