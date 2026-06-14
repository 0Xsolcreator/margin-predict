/// Shared unwind sequence used by close, settle, and liquidate routes.
///
/// Converts DUSDC proceeds back to DBUSDC, repays this position's recorded
/// margin debt, optionally withdraws its SUI collateral, and forwards
/// everything to the position owner.

import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { buildSwapStep, fromRawAmount } from './swap.js';
import type { SwapClient, SwapPool } from './swap.js';
import type { MarginClient } from '../chain/client.js';
import { DBUSDC_COIN, MARGIN_MANAGER_KEY, SWAP_DEEP_AMOUNT } from '../config.js';

export interface UnwindParams {
  tx: Transaction;
  marginClient: MarginClient;
  swapClient: SwapClient;
  swapPool: SwapPool;
  /** Coin<DUSDC> proceeds from execute_close / execute_settle / execute_liquidation. */
  proceedsCoin: TransactionObjectArgument;
  /** DBUSDC principal to repay (raw, 6 decimals). */
  repayAmount: bigint;
  /** SUI collateral to withdraw (raw, 9 decimals). 0 or omitted = leave in place (soft liquidation). */
  withdrawSuiAmount?: bigint;
  /** Receives withdrawn SUI (if any) and DUSDC swap dust. */
  recipient: string;
  /** Receives DEEP swap dust. */
  keeperAddress: string;
}

/**
 * Appends to `tx`:
 *   1. Swap `proceedsCoin` (DUSDC) → DBUSDC.
 *   2. Deposit DBUSDC into the shared MarginManager.
 *   3. Repay `repayAmount` of this position's recorded debt.
 *   4. Optionally withdraw `withdrawSuiAmount` SUI collateral.
 *   5. Transfer withdrawn SUI + DUSDC dust to `recipient`; DEEP dust to keeper.
 *
 * Repays the recorded principal exactly, not the manager's full
 * interest-accruing debt — residual interest is absorbed by future positions.
 */
export function unwindPosition(params: UnwindParams): void {
  const {
    tx, marginClient, swapClient, swapPool, proceedsCoin,
    repayAmount, withdrawSuiAmount, recipient, keeperAddress,
  } = params;

  // minOut is 0 because proceedsCoin value is only known mid-PTB.
  // Acceptable on a thin testnet pool; tighten for mainnet.
  const [dusdcDust, dbusdcOut, deepDust] = buildSwapStep({
    client: swapClient,
    poolKey: swapPool.key,
    direction: 'baseToQuote',
    amount: 0,
    minOut: 0,
    deepAmount: SWAP_DEEP_AMOUNT,
    inputCoin: proceedsCoin,
  })(tx);

  marginClient.deepbook.marginManager.depositQuote({ managerKey: MARGIN_MANAGER_KEY, coin: dbusdcOut })(tx);
  marginClient.deepbook.marginManager.repayQuote(
    MARGIN_MANAGER_KEY,
    fromRawAmount(repayAmount, DBUSDC_COIN.scalar),
  )(tx);

  const toOwner: TransactionObjectArgument[] = [dusdcDust];
  if (withdrawSuiAmount && withdrawSuiAmount > 0n) {
    const sui = marginClient.deepbook.marginManager.withdrawBase(
      MARGIN_MANAGER_KEY,
      fromRawAmount(withdrawSuiAmount, 1_000_000_000),
    )(tx);
    toOwner.push(sui);
  }

  tx.transferObjects(toOwner, recipient);
  tx.transferObjects([deepDust], keeperAddress);
}
