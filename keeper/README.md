# keeper

Permissionless off-chain service for Strike. Executes the Margin Loop when users open positions, unwinds positions on close, and runs a background monitor that auto-settles expired markets and liquidates undercollateralized positions.

Built with Bun + Fastify. Called by the [backend](../backend) for user-triggered actions; also operates autonomously via its internal monitor.

---

## Getting started

```bash
bun install
cp .env.example .env   # fill in required vars
bun src/index.ts       # listens on PORT (default 4000)
```

---

## Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `KEEPER_PRIVATE_KEY` | yes | — | Ed25519 keypair (hex) — signs all keeper transactions |
| `MARGIN_PREDICT_PACKAGE` | yes | — | Published `margin_predict` package id |
| `PREDICT_MANAGER_ID` | yes | — | `PredictManager` shared object id (owned by this keeper) |
| `MARGIN_MANAGER_ID` | yes | — | `MarginManager` shared object id (owned by this keeper) |
| `DUSDC_DBUSDC_POOL_ID` | yes | — | DeepBook pool id for the DUSDC ↔ DBUSDC swap |
| `NETWORK` | no | `testnet` | `mainnet` · `testnet` |
| `PORT` / `KEEPER_PORT` | no | `4000` | HTTP listen port |
| `SWAP_SLIPPAGE_BPS` | no | `100` | Max swap slippage (1%) |
| `LIQUIDATION_MONITOR` | no | on | Set to `off` to disable the background monitor |
| `LIQUIDATION_POLL_MS` | no | `30000` | Monitor poll interval in ms |

---

## API

All routes are called by the backend and do not require user auth — the keeper signs transactions itself using `KEEPER_PRIVATE_KEY`.

| Method | Path | Description |
|---|---|---|
| POST | `/positions/:id/open` | Execute the Margin Loop — borrow, swap, deploy into Predict |
| POST | `/positions/:id/close` | Unwind a position — redeem, swap, repay borrow, return collateral |
| POST | `/positions/:id/liquidate` | Liquidate an undercollateralized position |
| POST | `/positions/:id/settle` | Settle a position whose oracle has expired |
| GET | `/positions` | List all tracked positions |
| GET | `/positions/:id` | Single position record |

### POST /positions/:id/open

Executes the full Margin Loop in a single PTB:

1. Withdraw escrowed SUI from the `MarginPosition`
2. Deposit SUI into the shared `MarginManager` as collateral
3. Borrow `(leverage − 1) × collateral` DBUSDC against it
4. Swap DBUSDC → DUSDC via DeepBook
5. Deploy DUSDC into a new Predict position, confirming `OPEN`

Request:
```json
{ "leverageBps": 12000, "oracleId": "0x…" }
```

### POST /positions/:id/close

Unwinds a position in a single PTB:

1. Redeem the full Predict position → DUSDC proceeds
2. Swap DUSDC → DBUSDC
3. Repay the recorded margin debt
4. Withdraw SUI collateral
5. Forward SUI + any DUSDC dust to the position owner

Request:
```json
{ "oracleId": "0x…" }
```

### POST /positions/:id/liquidate

Liquidates a flagged position. Re-checks health factor on execution:

- **Soft** (hf ≤ 1.05×): closes 25% of the position, reduces debt proportionally, position stays `OPEN`
- **Hard** (hf ≤ 1.00×): closes the full position, repays all debt, withdraws collateral, marks `LIQUIDATED`

Request:
```json
{ "oracleId": "0x…" }
```

### POST /positions/:id/settle

Same flow as close, but requires the oracle to have settled post-expiry. The keeper resolves the oracle from its own records if `oracleId` is not provided.

---

## Background monitor

Starts automatically on launch (disable with `LIQUIDATION_MONITOR=off`). Every `LIQUIDATION_POLL_MS` (default 30s) it scans all tracked `OPEN` positions and:

1. **Settle** — if the position's oracle has expired and settled, auto-redeems and returns collateral to the owner
2. **Liquidate** — if the health factor has dropped to the soft or hard threshold, triggers liquidation

---

## Source layout

| Path | Description |
|---|---|
| `src/index.ts` | Entry point — starts the server and the background monitor |
| `src/config.ts` | All env vars, network constants, coin types, pool keys |
| `src/monitor.ts` | Background liquidation + settlement loop |
| `src/liquidation.ts` | Liquidation logic (shared by route + monitor) |
| `src/settlement.ts` | Settlement logic (shared by route + monitor) |
| `src/routes/` | Route handlers: `open`, `close`, `liquidate`, `settle`, `positions` |
| `src/chain/` | Sui client, contract call builders, transaction execution |
| `src/deepbook/` | Swap and unwind helpers via DeepBook v3 |
| `src/math/` | Leverage and borrow amount calculations |
| `src/store/` | In-process position store (file-backed) |
