/**
 * Recovery sweep — find all your PENDING_OPEN positions with escrowed SUI
 * (keeper open failed / never ran) and cancel_intent each to claw the SUI back.
 *
 * Discovery: MarginPosition is a *shared* object, so getOwnedObjects can't find
 * it. Instead we scan your own transaction history for the request_open calls
 * that created them, then read each object's current status + escrow.
 *
 * Eligibility: status == PENDING_OPEN(0) and escrow > 0. The 120s timeout is
 * enforced on-chain by cancel_intent — positions younger than that abort and
 * are reported, not retried.
 *
 * Usage:
 *   npm run recover
 */

import { Transaction } from '@mysten/sui/transactions';
import {
  CLOCK_ID, DUSDC_TYPE, MARGIN_PREDICT_PACKAGE,
  createSuiClient, loadUserKeypair, signAndExecute, log,
} from './shared.ts';

const PENDING_OPEN = 0;

async function findCreatedPositionIds(
  client: ReturnType<typeof createSuiClient>,
  address: string,
): Promise<string[]> {
  const ids = new Set<string>();
  let cursor: string | null | undefined = undefined;
  do {
    const page = await client.queryTransactionBlocks({
      filter: { FromAddress: address },
      options: { showObjectChanges: true },
      cursor,
      limit: 50,
    });
    for (const tx of page.data) {
      for (const ch of tx.objectChanges ?? []) {
        if (ch.type === 'created' && ch.objectType.includes('margin_position::MarginPosition')) {
          ids.add(ch.objectId);
        }
      }
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return [...ids];
}

/** status (u8) + escrowed SUI (raw, 9dp) read straight from object content. */
async function readEscrow(
  client: ReturnType<typeof createSuiClient>,
  id: string,
): Promise<{ status: number; escrow: bigint } | null> {
  const obj = await client.getObject({ id, options: { showContent: true } });
  const content = obj.data?.content;
  if (!content || content.dataType !== 'moveObject') return null;
  const f = content.fields as Record<string, any>;
  // Balance<SUI> serializes as a bare u64 string; guard the older { value } shape too.
  const escrow = typeof f.escrow === 'string'
    ? BigInt(f.escrow)
    : BigInt(f.escrow?.fields?.value ?? f.escrow?.value ?? 0);
  return { status: Number(f.status), escrow };
}

async function main() {
  const client  = createSuiClient();
  const keypair = loadUserKeypair();
  const address = keypair.toSuiAddress();

  log(`User address : ${address}`);
  log('Scanning transaction history for MarginPositions…');
  const candidates = await findCreatedPositionIds(client, address);
  log(`Found ${candidates.length} MarginPosition(s) you created.`);

  const eligible: { id: string; escrow: bigint }[] = [];
  for (const id of candidates) {
    const info = await readEscrow(client, id);
    if (info && info.status === PENDING_OPEN && info.escrow > 0n) {
      eligible.push({ id, escrow: info.escrow });
    }
  }

  if (eligible.length === 0) {
    log('No PENDING_OPEN positions with escrowed SUI. Nothing to recover.');
    return;
  }

  const totalSui = eligible.reduce((a, e) => a + e.escrow, 0n);
  log(`Recoverable: ${eligible.length} position(s), ${(Number(totalSui) / 1e9).toFixed(6)} SUI total`);
  for (const e of eligible) log(`  ${e.id}  →  ${(Number(e.escrow) / 1e9).toFixed(6)} SUI`);

  // One tx per position so a single not-yet-timed-out abort doesn't block the rest.
  let recovered = 0n;
  for (const e of eligible) {
    try {
      const tx = new Transaction();
      tx.setSender(address);
      const [sui] = tx.moveCall({
        target: `${MARGIN_PREDICT_PACKAGE}::position_manager::cancel_intent`,
        typeArguments: [DUSDC_TYPE],
        arguments: [tx.object(e.id), tx.object(CLOCK_ID)],
      });
      tx.transferObjects([sui], address);
      const r = await signAndExecute(client, keypair, tx, `cancel_intent ${e.id}`);
      log(`  ✓ ${e.id} recovered — digest ${r.digest}`);
      recovered += e.escrow;
    } catch (err) {
      log(`  ✗ ${e.id} failed: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  log(`Done. Reclaimed ~${(Number(recovered) / 1e9).toFixed(6)} SUI to ${address}`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
