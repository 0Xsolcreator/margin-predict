// Recovery sweep for the custodial wallet — the server-side twin of
// examples/8_recover_pending.ts. Finds the caller's PENDING_OPEN MarginPositions
// that still hold escrowed SUI (keeper open failed / never ran) and cancel_intents
// each to claw the SUI back. The 120s timeout is enforced on-chain by cancel_intent.
//
//   GET  /recover   Bearer -> { positions: [{ id, escrowSui }], totalSui }
//   POST /recover   Bearer -> { recoveredSui, results: [{ id, ok, digest?, error? }] }
//
// MarginPosition is a *shared* object, so listOwnedObjects can't find it. We scan
// the caller's tx history (JSON-RPC; the gRPC client has no queryTransactionBlocks)
// for the request_open calls that created them, then read each object's status+escrow.

import type { FastifyInstance } from 'fastify';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { authed, runTx, NETWORK } from './index.ts';
import { buildCancelIntent } from './protocol.ts';

const PENDING_OPEN = 0;

let _rpc: SuiJsonRpcClient | null = null;
const rpc = () =>
  (_rpc ??= new SuiJsonRpcClient({
    url: process.env.SUI_JSON_RPC_URL?.trim() || getJsonRpcFullnodeUrl(NETWORK),
    network: NETWORK,
  }));

async function findCreatedPositionIds(address: string): Promise<string[]> {
  const ids = new Set<string>();
  let cursor: string | null | undefined = undefined;
  do {
    const page = await rpc().queryTransactionBlocks({
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
async function readEscrow(id: string): Promise<{ status: number; escrow: bigint } | null> {
  const obj = await rpc().getObject({ id, options: { showContent: true } });
  const content = obj.data?.content;
  if (!content || content.dataType !== 'moveObject') return null;
  const f = content.fields as Record<string, any>;
  // Balance<SUI> serializes as a bare u64 string; guard the older { value } shape too.
  const escrow = typeof f.escrow === 'string'
    ? BigInt(f.escrow)
    : BigInt(f.escrow?.fields?.value ?? f.escrow?.value ?? 0);
  return { status: Number(f.status), escrow };
}

/** Eligible = PENDING_OPEN with escrow > 0. */
async function findRecoverable(address: string): Promise<{ id: string; escrow: bigint }[]> {
  const out: { id: string; escrow: bigint }[] = [];
  for (const id of await findCreatedPositionIds(address)) {
    const info = await readEscrow(id);
    if (info && info.status === PENDING_OPEN && info.escrow > 0n) out.push({ id, escrow: info.escrow });
  }
  return out;
}

export function registerRecoverRoutes(app: FastifyInstance): void {
  app.get('/recover', async (req) => {
    const { address } = authed(req);
    const eligible = await findRecoverable(address);
    return {
      positions: eligible.map((e) => ({ id: e.id, escrowSui: Number(e.escrow) / 1e9 })),
      totalSui: Number(eligible.reduce((a, e) => a + e.escrow, 0n)) / 1e9,
    };
  });

  app.post('/recover', async (req) => {
    const s = authed(req);
    const eligible = await findRecoverable(s.address);
    // One tx per position so a single not-yet-timed-out abort doesn't block the rest.
    let recovered = 0n;
    const results = [];
    for (const e of eligible) {
      try {
        const tx = new Transaction();
        buildCancelIntent(tx, e.id, s.address);
        const { digest } = await runTx(s, tx);
        recovered += e.escrow;
        results.push({ id: e.id, ok: true, digest });
      } catch (err) {
        app.log.error({ err, positionId: e.id }, 'recovery cancel_intent failed');
        results.push({ id: e.id, ok: false, error: (err as Error).message.split('\n')[0] });
      }
    }
    return { recoveredSui: Number(recovered) / 1e9, results };
  });
}
