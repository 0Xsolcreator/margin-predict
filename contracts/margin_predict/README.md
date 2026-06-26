# margin_predict

The core Move package for Strike. Manages the full lifecycle of leveraged prediction market positions on Sui, orchestrating cross-protocol interactions across DeepBook Margin and DeepBook Predict in single atomic transactions.

---

## Build & publish

```bash
sui move build --path contracts/margin_predict
sui client publish --path contracts/margin_predict
```

---

## Modules

| Module | Description |
|---|---|
| `position_manager` | Owner-facing entry points and the read-only health factor query |
| `position_executor` | Keeper-signed open / close / settle execution |
| `position_liquidator` | Permissionless flagging + keeper-signed liquidation execution |
| `margin_position` | The `MarginPosition` shared object — escrow, debt, snapshot, and lifecycle state |
| `types` | Value types: `Intent`, `PositionSnapshot`, `LiquidationFlag` |

---

## MarginPosition

The central shared object. One is created per position and persists on-chain through its entire lifecycle.

| Field | Description |
|---|---|
| `owner` | User address |
| `status` | `PENDING_OPEN` · `OPEN` · `CLOSED` · `LIQUIDATED` · `CANCELLED` |
| `escrow` | SUI held until the keeper opens the position |
| `collateral_sui` | SUI deposited into the DeepBook Margin manager |
| `margin_manager_id` | The `MarginManager` backing this position's borrow |
| `margin_debt` | dBUSDC borrowed (6 decimals) |
| `pending_intent` | Queued owner action awaiting keeper execution |
| `position` | Snapshot of the live Predict position (market key + quantity) |
| `liquidation_flag` | Set by a watcher; consumed on liquidation execution |

### Status lifecycle

```
request_open  →  PENDING_OPEN
                    ↓ (keeper executes)
                  OPEN
                 /    \
     request_close    flag_for_liquidation
           ↓                  ↓ (keeper executes)
         CLOSED          soft → stays OPEN (25% closed)
                         hard → LIQUIDATED
                    ↓ (cancel_intent after 120s)
                 CANCELLED
```

---

## Entry points

### User-facing

#### `request_open<T>`
Creates a `MarginPosition` in `PENDING_OPEN`, escrowing the user's SUI payment. The keeper picks it up to run the Margin Loop.

```
leverage_bps: 11_000 – 14_000  (1.10× – 1.40×)
```

#### `request_close<T>`
Records a close intent on an `OPEN` position. The keeper redeems the Predict position, repays the borrow, and returns net collateral to the owner.

#### `cancel_intent<T>`
Escape hatch — cancels a pending intent and returns escrowed SUI to the owner. On-chain enforced: **aborts if the intent is younger than 120 seconds**.

#### `health_factor<T>` *(read-only)*
Returns the position's mark value divided by its margin debt, in basis points.

| Value | Meaning |
|---|---|
| `> 10_500` | Healthy |
| `≤ 10_500` | Soft liquidation zone |
| `≤ 10_000` | Hard liquidation zone |
| `u64::MAX` | No debt |

---

### Permissionless

#### `flag_for_liquidation<T>`
Anyone can call this when a position's health factor drops to or below `10_500` (1.05×). The first caller is recorded as the reporter and earns the **2% liquidation fee** on execution.

---

### Keeper-signed

#### `take_escrow<T>` + `deploy_position<T>`
Two-step open. The keeper withdraws the escrowed SUI, deposits it into DeepBook Margin, borrows dBUSDC, swaps, then calls `deploy_position` which sizes and mints the Predict position and confirms the position as `OPEN`.

#### `execute_close<T>`
Redeems the full Predict position, returns proceeds for the keeper to swap and repay the borrow, marks the position `CLOSED`.

#### `execute_settle<T>`
Same as `execute_close` but requires the oracle to have settled post-expiry.

#### `execute_liquidation<T>`
Executes a flagged liquidation. Re-checks the health factor on execution:
- **Recovered** (hf > 1.05×): clears the flag, no action.
- **Soft** (hf ≤ 1.05×): closes 25% of the position, reduces debt proportionally, position stays `OPEN`.
- **Hard** (hf ≤ 1.00×): closes the full position, marks it `LIQUIDATED`.

In both liquidation cases, **2% of proceeds** are transferred to the original reporter.

---

## Key constants

| Constant | Value | Description |
|---|---|---|
| `MIN_LEVERAGE_BPS` | `11_000` | 1.10× minimum leverage |
| `MAX_LEVERAGE_BPS` | `14_000` | 1.40× maximum leverage |
| `CANCEL_TIMEOUT_MS` | `120_000` | 120s before an intent can be cancelled |
| `HF_SOFT_BPS` | `10_500` | Soft liquidation threshold (1.05×) |
| `HF_HARD_BPS` | `10_000` | Hard liquidation threshold (1.00×) |
| `SOFT_LIQ_FRACTION_BPS` | `2_500` | 25% of position closed per soft liquidation |
| `LIQ_REPORTER_BPS` | `200` | 2% fee to the liquidation reporter |
| `DEBT_TOLERANCE_BPS` | `1_000` | 10% max deviation between reported debt and swap proceeds |
