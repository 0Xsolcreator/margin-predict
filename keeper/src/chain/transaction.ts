import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { Transaction } from '@mysten/sui/transactions';
import { ExecutionError } from './errors.js';

type ExecutableClient = Pick<SuiGrpcClient, 'signAndExecuteTransaction' | 'waitForTransaction'>;

/** Signs, executes, waits for finality, and throws `ExecutionError` on failure. */
export async function executeTransaction(
  client: ExecutableClient,
  keypair: Ed25519Keypair,
  tx: Transaction,
  label: string,
) {
  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    include: { effects: true, balanceChanges: true, events: true },
  });

  if (result.$kind === 'FailedTransaction') {
    throw new ExecutionError(label, result.FailedTransaction.effects?.status);
  }

  const { digest, effects, balanceChanges, events } = result.Transaction;
  if (!effects?.status.success) {
    throw new ExecutionError(label, effects?.status);
  }

  await client.waitForTransaction({ digest });
  return { digest, effects, balanceChanges: balanceChanges ?? [], events: events ?? [] };
}
