/**
 * Step 4 — User on-chain: request_close
 *
 * Sets a close intent on an OPEN MarginPosition. The keeper then picks this up
 * via Step 5 (keeper_close) to redeem the Predict position, repay the margin
 * debt, and forward SUI + any DUSDC dust back to the owner.
 *
 * Must be signed by the position owner (same wallet as Step 1).
 *
 * Usage:
 *   POSITION_ID=0x... npm run request-close
 */

import { Transaction } from '@mysten/sui/transactions';
import {
  CLOCK_ID, DUSDC_TYPE, MARGIN_PREDICT_PACKAGE,
  createSuiClient, loadUserKeypair,
  signAndExecute, log, printResult,
} from './shared.ts';

async function main() {
  const positionId = process.env.POSITION_ID?.trim();
  if (!positionId) throw new Error('POSITION_ID must be set (output from Step 1)');

  const client  = createSuiClient();
  const keypair = loadUserKeypair();
  const address = keypair.toSuiAddress();

  log(`User address : ${address}`);
  log(`Position ID  : ${positionId}`);

  const tx = new Transaction();
  tx.setSender(address);

  tx.moveCall({
    target: `${MARGIN_PREDICT_PACKAGE}::position_manager::request_close`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(positionId),
      tx.object(CLOCK_ID),
    ],
  });

  const result = await signAndExecute(client, keypair, tx, 'request_close');

  printResult('request_close — success', {
    positionId,
    digest: result.digest,
    note: 'Close intent recorded. Run Step 5 (keeper-close) to complete.',
  });
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
