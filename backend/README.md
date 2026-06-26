# backend

User-facing API for Strike. Built with Bun + Fastify.

The backend is **server-custodial** — it holds the zkLogin ephemeral key, builds the ZK proof, and sponsors every transaction via [Enoki](https://enoki.mystenlabs.com). Users sign in with Google and never touch a wallet or pay gas. On-chain intents (`request_open` / `request_close` / `cancel_intent`) are signed here; the actual borrow/swap/deploy/unwind is delegated to the [keeper](../keeper).

---

## Getting started

```bash
bun install
cp .env.example .env   # fill in required vars
bun run index.ts       # listens on PORT (default 3000)
bun test
```

---

## Environment

| Variable | Required | Default | Description |
|---|---|---|---|
| `ENOKI_SECRET_KEY` | yes | — | Enoki API key — custody + gas sponsorship |
| `MARGIN_PREDICT_PACKAGE` | yes | — | Published `margin_predict` package id |
| `PREDICT_MANAGER_ID` | yes | — | `PredictManager` shared object id |
| `KEEPER_URL` | no | `http://localhost:4000` | Keeper service base URL |
| `NETWORK` | no | `testnet` | `mainnet` · `testnet` · `devnet` |
| `SUI_RPC_URL` | no | fullnode for `NETWORK` | gRPC endpoint |
| `PORT` | no | `3000` | HTTP listen port |
| `ADDITIONAL_EPOCHS` | no | `2` | Session lifetime (~24h per epoch) |

---

## Auth

Sign-in is a two-step nonce handshake. The backend mints the ephemeral key, so Google sign-in must bind its nonce to it:

```
POST /auth/start                        → { state, nonce }
  (frontend runs Google sign-in with `nonce`)
POST /auth/finish  { state, jwt }       → { sessionToken, address }
```

All authenticated routes require `Authorization: Bearer <sessionToken>`.

Errors return `{ "error": string }` with status `401` (invalid session), `502` (Enoki or move-abort), or `500`.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/start` | — | Begin login, mint a zkLogin nonce |
| POST | `/auth/finish` | — | Exchange Google JWT for a session token |
| GET | `/stats` | ✓ | Wallet balances for the session address |
| POST | `/tx` | ✓ | Sponsor + sign + execute a client-built transaction |
| POST | `/positions` | ✓ | Open a leveraged position |
| GET | `/positions` | ✓ | List the caller's positions |
| GET | `/positions/:id` | ✓ | Position detail (+ live health factor) |
| POST | `/positions/:id/close` | ✓ | Close a position |
| POST | `/positions/:id/withdraw` | ✓ | Cancel a pending intent / claw back escrow |
| GET | `/oracles` | — | List active prediction markets |
| GET | `/oracles/:id` | — | Single oracle state + latest price |

### POST /auth/start

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

### POST /positions — open a position

Escrows the user's SUI via `request_open`, then calls the keeper to borrow/swap/deploy.

Request:
```json
{
  "oracleId": "0x…",
  "expiry": "1750000000000",
  "strike": "1000000",
  "isUp": true,
  "collateralSui": 1.0,
  "leverageBps": 12000
}
```

`leverageBps` range: `11000` (1.10×) → `14000` (1.40×). `400` if `oracleId` / `collateralSui` / `leverageBps` is missing.

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

### GET /positions

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

`status` ∈ `PENDING_OPEN | OPEN | CLOSED | LIQUIDATED | CANCELLED`. Amounts are raw (`marginDebt` 6dp dBUSDC, `collateralSui` 9dp SUI).

### GET /positions/:id

Pass `?oracleId=0x…` to merge in the live health factor:

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

`healthFactorBps`: `10000` = 1.00× (hard liquidation), `10500` = soft liquidation zone, `18446744073709551615` = no debt. `404` if the keeper isn't tracking the id.

### POST /positions/:id/close

Request:
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

Calls `cancel_intent` — claws back escrowed SUI from a stuck `PENDING_OPEN`, or cancels a pending close. No request body. Aborts with `502` if the intent is younger than 120s (on-chain enforced).

```json
{ "positionId": "0x…", "digest": "0x…" }
```

### GET /oracles

Markets from the Predict indexer, soonest expiry first. Pass `?all=1` to include non-active markets.

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

```json
{
  "oracle": { "oracle_id": "0x…", "status": "active", "expiry": 1750000000000 },
  "latest_price": { "spot": 1000000000, "forward": 1000000000, "onchain_timestamp": 0 }
}
```

`min_strike` / `tick_size` / `spot` / `forward` are 1e9 fixed-point USD. `expiry` is a ms UTC timestamp.

---

## Files

| File | Description |
|---|---|
| `index.ts` | Server entry — Enoki client, session store, auth routes, custodial signer |
| `protocol.ts` | Move call builders (`request_open`, `request_close`, `cancel_intent`) + keeper proxy |
| `positions.ts` | Position lifecycle routes |
| `oracles.ts` | Oracle indexer proxy |
| `probabilities.ts` | Probability / pricing helpers |
| `recover.ts` | Recovery routes for stuck positions |
