# Architecture

Cambio is one TypeScript codebase: a React SPA and a small Express API served from the same origin (Vercel function or a single Node server), with Firestore or SQLite for the identity and invoice registry. There are **no custom smart contracts**. Cambio composes Mezo's MUSD token, Router/PoolFactory/pools, PriceFeed, TroveManager, BorrowerOperations and Multicall3.

```
 Payer / merchant browser (React 19, Vite, Reown AppKit + wagmi, viem)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ PaymentRequestPage   verify EIP-712 → double-pay check → Fund & Pay → pay │
 │ RequestView          sign request → registry save → MerchantInvoices      │
 │ Overview             balances · MezoProtocolCard (oracle, trove, preview) │
 │                                                                           │
 │ lib/paymentRequest   link format, EIP-712, verifySettlement (exact calldata)
 │ lib/musdTransfer     preflight → wallet → receipt → Transfer evidence     │
 │ lib/swap, fundAndPay router quotes, exact approvals, shortfall sizing     │
 │ lib/mezoProtocol     PriceFeed, TroveManager, BorrowerOperations (read)   │
 │ lib/requestSettlement paged explorer search + RPC log fallback            │
 │ lib/evidence         PASS / FAIL / INCONCLUSIVE checks (also used by CLI) │
 │ lib/rpcRetry         "not found" retries for the inconsistent public RPC  │
 │ lib/readClient       Multicall3-batched read client                        │
 └───────────────┬─────────────────────────────────────┬────────────────────┘
       wallet signs │ reads / receipts                 │ fetch /api (same origin)
                    ▼                                  ▼
        Mezo RPC + Blockscout explorer      Express API (server/app.ts)
                                            ├─ /api/identity/*  SIWE username registry
                                            ├─ /api/merchant/*  SIWE merchant session
                                            ├─ /api/invoices    signed-request registry
                                            │    └─ settlement: server re-reads the chain
                                            └─ stores: Firestore | SQLite | memory (dev)
```

## Trust boundaries

| Data | Authority | Never trusted |
| --- | --- | --- |
| Balances, receipts, settlement | Mezo RPC (re-read; retried on "not found") | Client-supplied status, timers, explorer alone |
| Request authenticity | Recipient's EIP-712 signature (EOA, or ERC-1271/6492 via RPC) | Link contents, the server |
| Username → address | Server-verified SIWE claim, atomic store transaction | Link-embedded names, legacy records |
| Invoice listing | SIWE merchant session (hashed bearer token) | Address alone |
| Recorded settlement | Server's own `verifyPaymentTx` + confirmation policy | Anything except a tx hash |
| Oracle price | `PriceFeed.fetchPrice()` | Off-chain price as a substitute |

## Request lifecycle

1. **Create.** The merchant signs EIP-712 (free). The link `/#pay?r=<base64url>&s=<sig>` works with no server. `POST /api/invoices` stores it; the server verifies the signature and keys the record by `(recipient, id)`.
2. **Open.** The payer's browser validates the shape and verifies the signature. It then checks for an existing settlement: a registry hint plus an on-chain scan, with any hit re-verified on-chain. Pay is disabled while this runs.
3. **Fund (optional).** If MUSD is short, a sized BTC→MUSD swap is offered. Each transaction needs its own wallet approval.
4. **Pay.** Preflight (chain, account, expiry, balances, gas estimate on exact calldata) → wallet → receipt → `Transfer` event check. Outcomes: confirmed, reverted, rejected, failed or unknown.
5. **Settle.** The payer's browser submits the hash. The server verifies it on-chain and records it; the first verified payment wins and later ones become duplicates. The proof link `…&tx=<hash>` verifies independently in any browser.
6. **Reconcile.** The merchant's "Check paid" pages the explorer back to `createdAt`, falling back to bounded RPC log scans, and verifies candidates. If coverage is incomplete the result is *unknown*, never *unpaid*.

## Storage

| Store | Identity | Invoices | Rate limits | Use |
| --- | --- | --- | --- | --- |
| Firestore (Admin SDK) | `verified_usernames`, `verified_wallets`, `identity_challenges` | `invoices`, `invoice_owners`, `merchant_challenges`, `merchant_sessions` | `identity_rate_limits` | Vercel / Cloud Run |
| SQLite (one local file, Node ≥ 24) | tables in `IDENTITY_DATABASE_PATH` | same file, added idempotently | same file | Self-hosting |
| Memory | yes | yes | per process | Development / tests only |

All three stores pass one shared contract suite (`tests/invoiceStoreContract.ts`). Firestore runs it against the emulator. Firestore rules deny all client access to these collections. The composite index for listing is in `firestore.indexes.json`.

## Deployment

- **Vercel:** `vercel.json` routes `/api/*` to `api/index.ts`, which is compiled per file as plain ESM. Server-reachable modules therefore use explicit `.js` specifiers, and `tests/serverless.test.ts` boots the compiled function in plain Node.
- **Self-hosted:** `npm run build && npm start` (Node 24), Docker Compose with Caddy. See `SELF_HOSTING.md`.
- **CI:** `.github/workflows/ci.yml` runs typecheck, ESLint, unit tests, build and audit; a Firestore emulator job; Playwright against the production build; and a scheduled read-only live-chain job. It uses no secrets.
