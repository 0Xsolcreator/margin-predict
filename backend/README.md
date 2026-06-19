# backend

User-facing API for margin-predict. Server-custodial: the frontend does Google
sign-in for UX only; this server holds the zkLogin key, builds the ZK proof, and
**sponsors + signs + executes** every transaction. On-chain user moves
(`request_open` / `request_close` / `cancel_intent`) are signed here; the actual
borrow/swap/deploy/unwind is delegated to the [keeper](../keeper) service.

```bash
bun install
bun run index.ts        # listens on PORT (default 3000)
bun test
```

## Environment (`backend/.env`)

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `ENOKI_SECRET_KEY` | yes | — | Enoki private key (custody + sponsorship) |
| `MARGIN_PREDICT_PACKAGE` | yes | — | published `margin_predict` package id |
| `PREDICT_MANAGER_ID` | yes | — | PredictManager shared object (matches keeper) |
| `KEEPER_URL` | no | `http://localhost:4000` | keeper service base URL |
| `NETWORK` | no | `testnet` | `mainnet` \| `testnet` \| `devnet` |
| `SUI_RPC_URL` | no | fullnode for `NETWORK` | gRPC endpoint |
| `PORT` | no | `3000` | |
| `ADDITIONAL_EPOCHS` | no | `2` | session/proof lifetime (~24h/epoch) |
| `SPONSOR_ALLOWED_TARGETS` | no | (unrestricted) | comma-separated allowed move-call targets |
| `PREDICT_PACKAGE` / `DUSDC_TYPE` / `PREDICT_ID` / `PREDICT_INDEXER` | no | testnet values | protocol overrides |

## Auth

Authenticated routes take `Authorization: Bearer <sessionToken>`. Errors return
`{ "error": string }` — `401` for an invalid/expired session, `502` for Enoki or
move-abort failures, `500` otherwise.

Sign-in is a two-step nonce handshake (the backend mints the ephemeral key, so
Google sign-in must bind its nonce to it):

```
POST /auth/start                  -> { state, nonce }
  frontend runs Google sign-in with `nonce`  -> id_token (JWT)
POST /auth/finish { state, jwt }  -> { sessionToken, address }
```

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/start` | — | begin login, get a zkLogin nonce |
| POST | `/auth/finish` | — | exchange Google JWT for a session |
| GET | `/stats` | ✓ | wallet balances |
| POST | `/tx` | ✓ | sponsor+sign+execute a client-built tx kind |
| POST | `/positions` | ✓ | place bet (open a leveraged position) |
| GET | `/positions` | ✓ | list the caller's positions |
| GET | `/positions/:id` | ✓ | position detail (+ health) |
| POST | `/positions/:id/close` | ✓ | close a position |
| POST | `/positions/:id/withdraw` | ✓ | claw back escrow / cancel a pending intent |
| GET | `/oracles` | — | list markets |
| GET | `/oracles/:id` | — | market detail |

### POST /auth/start

Response:
```json
{ "state": "hex", "nonce": "string" }
```

### POST /auth/finish

Request:
```json
{ "state": "hex (from /auth/start)", "jwt": "google id_token" }
```
Response:
```json
{ "sessionToken": "hex", "address": "0x…" }
```

### GET /stats

Response:
```json
{
  "address": "0x…",
  "network": "testnet",
  "sui": "1000000000",
  "balances": [{ "coinType": "0x2::sui::SUI", "balance": "1000000000" }]
}
```

### POST /tx

Escape hatch for client-built transactions. Request:
```json
{ "transactionKindBytes": "base64 TransactionKind" }
```
Response: `{ "digest": "0x…" }`

### POST /positions — place bet

Escrows the user's SUI via `request_open`, extracts the created `MarginPosition`,
then calls the keeper to borrow/swap/deploy.

Request:
```json
{
  "oracleId": "0x…",
  "expiry": "1750000000000",      // ms; string or number
  "strike": "1000000",            // Predict units (6dp); string or number
  "isUp": true,                   // optional, default true
  "collateralSui": 1.0,           // human SUI
  "leverageBps": 12000            // 11000=1.10x … 14000=1.40x
}
```
Response:
```json
{
  "positionId": "0x…",
  "requestDigest": "0x…",
  "open": {
    "digest": "0x…",
    "positionId": "0x…",
    "owner": "0x…",
    "leverageBps": 12000,
    "collateralSui": "1000000000",
    "marginManagerId": "0x…",
    "marginDebt": "1100000"
  }
}
```
`400` if `oracleId` / `collateralSui` / `leverageBps` is missing. The `open`
object is the keeper's response (`422` from the keeper bubbles up, e.g. borrow
below the pool minimum).

### GET /positions

The caller's tracked positions (keeper records filtered to `owner == address`):
```json
[
  {
    "positionId": "0x…",
    "owner": "0x…",
    "updatedAt": "2026-06-19T00:00:00.000Z",
    "status": "OPEN",
    "marginDebt": "1100000",
    "collateralSui": "1000000000"
  }
]
```
`status` ∈ `PENDING_OPEN | OPEN | CLOSED | LIQUIDATED | CANCELLED`. Amounts are
raw (`marginDebt` 6dp DBUSDC, `collateralSui` 9dp).

### GET /positions/:id

Query: `oracleId` (optional). When the position is `OPEN` and `oracleId` is
given, the live health factor is merged in:
```json
{
  "positionId": "0x…",
  "owner": "0x…",
  "updatedAt": "2026-06-19T00:00:00.000Z",
  "status": "OPEN",
  "marginDebt": "1100000",
  "collateralSui": "1000000000",
  "healthFactorBps": "10750"
}
```
`healthFactorBps`: `10000` = 1.00x; `≤10500` soft- and `≤10000` hard-liquidation
zones; `18446744073709551615` = no debt. `404` if the keeper isn't tracking the id.

### POST /positions/:id/close

Records the close intent via `request_close`, then has the keeper unwind. Request:
```json
{ "oracleId": "0x…" }
```
Response:
```json
{
  "positionId": "0x…",
  "requestDigest": "0x…",
  "close": {
    "digest": "0x…",
    "positionId": "0x…",
    "owner": "0x…",
    "repaidDebt": "1100000",
    "withdrawnCollateral": "1000000000"
  }
}
```
`400` if `oracleId` is missing.

### POST /positions/:id/withdraw

`cancel_intent` — claws back escrowed SUI from a stuck `PENDING_OPEN`, or cancels
a pending close (leaves the position `OPEN`). No body. On-chain enforces the 120s
timeout, so this **aborts (`502`)** if the intent is younger than 120s.
```json
{ "positionId": "0x…", "digest": "0x…" }
```

### GET /oracles

Markets from the Predict indexer, soonest expiry first. Query `all=1` returns
every status (default: active only).
```json
[
  {
    "oracle_id": "0x…",
    "underlying_asset": "SUI",
    "expiry": 1750000000000,
    "min_strike": 1000000000,
    "tick_size": 100000000,
    "status": "active",
    "settlement_price": null
  }
]
```

### GET /oracles/:id

Single oracle state (passthrough from the indexer):
```json
{
  "oracle": { "oracle_id": "0x…", "status": "active", "expiry": 1750000000000, "...": "..." },
  "latest_price": { "spot": 1000000000, "forward": 1000000000, "onchain_timestamp": 0 }
}
```
`min_strike` / `tick_size` / `spot` / `forward` are 1e9 fixed-point USD; `expiry`
is a ms UTC timestamp.

## Files

- `index.ts` — clients, session store, auth routes, `runTx` (the custodial signer), wiring
- `protocol.ts` — constants, `request_open` / `request_close` / `cancel_intent` builders, keeper proxy
- `positions.ts` — position lifecycle routes
- `oracles.ts` — oracle indexer proxy
