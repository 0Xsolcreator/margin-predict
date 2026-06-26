# Strike Frontend

Trading UI for Strike. Users sign in with Google, no wallet or gas required. All transactions are handled server-side via the [backend](../backend).

---

## Getting started

```bash
bun install
bun start       # dev server on http://localhost:3000
bun run build   # production build
```

---

## Environment

Create a `.env` file in this directory:

```
REACT_APP_BACKEND_URL=http://localhost:3000
REACT_APP_GOOGLE_CLIENT_ID=<your Google OAuth client id>
```

---

## Pages

| Page | Route | Description |
|---|---|---|
| `LandingPage` | `/` | Hero, product intro, and sign-in entry point |
| `TradePage` | `/trade` | Market browser, position sizing, leverage slider |
| `LiquidatePage` | `/liquidate` | Browse undercollateralized positions and trigger liquidation |

---

## Key hooks

| Hook | Description |
|---|---|
| `useOracleCycle` | Polls active oracle markets from the backend |
| `useOracleProbabilities` | Fetches implied probabilities for a given oracle |
| `usePythPrice` | Streams the live spot price for the underlying asset |

---

## Stack

- **React 19** + React Scripts
- **@mysten/dapp-kit** — Sui wallet primitives
- **@mysten/enoki** — zkLogin session handling
- **GSAP** + **Lenis** — animations and smooth scroll
- **@tanstack/react-query** — data fetching and caching
