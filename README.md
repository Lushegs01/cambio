# Cambio

**Get paid in MUSD. Prove it on-chain.**

Cambio is a non-custodial MUSD payment app on Mezo:
- A merchant sends an invoice signed by their wallet.
- The customer pays from any EVM wallet. If they're short on MUSD, Cambio swaps BTC → MUSD on Mezo first.
- The merchant gets a settlement proof anyone can check against the chain.

- **Live app:** https://cambio-five.vercel.app. This currently runs the Wave 1 build; the Wave 2 features below go live once this branch is merged and redeployed.
- **Network:** Mezo Testnet, chain 31611. Mainnet is configured but disabled.
- **Track:** Mezo Buildathon Track 2, Access & Distribution.
- **Developer:** Lushegs, solo builder. GitHub [@Lushegs01](https://github.com/Lushegs01).
- **Status:** hackathon product on testnet. Not audited. No customers or revenue yet. See [Known limitations](docs/KNOWN_LIMITATIONS.md).

---

## The problem

Getting paid in crypto still means pasting a 42-character address, hoping nobody edited the link, and trusting a screenshot as proof. Payers who hold BTC but owe a dollar amount must leave the invoice, find a DEX, swap, and come back. Merchants then reconcile by hand on an explorer.

## What Cambio does

| Need | Cambio |
| --- | --- |
| Pay the right person | `@username` → address, bound by a server-verified Sign-In with Ethereum signature |
| A link nobody can edit | Invoices are **EIP-712 signed** by the merchant's wallet; the payer's browser verifies the signature before it shows Pay |
| Pay with BTC when short on MUSD | **Fund & Pay** sizes a BTC → MUSD swap on Mezo's MUSD/BTC pool for the exact shortfall, then returns to the same invoice |
| Proof of payment | The payment carries the request ID in its calldata; anyone can verify the exact calldata, receipt and `Transfer` event |
| Merchant bookkeeping | The invoice registry syncs across devices after a wallet sign-in. It provides on-chain-verified status, totals, filters and CSV export |
| Mezo context | Live **Mezo PriceFeed** BTC price, **trove health** (ICR, liquidation estimate, Recovery Mode) and a read-only **borrowing preview** |

## Verified on-chain evidence

All three proofs are re-verified from the Mezo RPC with `npm run verify:evidence` (read-only), which reports PASS / FAIL / INCONCLUSIVE.

| Proof | Transaction | Verdict |
| --- | --- | --- |
| MUSD transfer, 10 MUSD from @solo to @lushegs | [`0x8e39d309…5065e`](https://explorer.test.mezo.org/tx/0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e) | ✅ PASS |
| BTC → MUSD swap via the Mezo Router, 0.01 BTC → 786.1477 MUSD (min 782.2170) | [`0x4af2b0f0…33f6e`](https://explorer.test.mezo.org/tx/0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e) | ✅ PASS |
| Payment settling an EIP-712 signed request (`CMB2` calldata) | not yet recorded | ⏳ PENDING: [how to complete](submission/evidence/signed-payment-settlement.md) |

The signed-settlement proof is honestly pending. No transaction with Cambio's request-ID suffix was found for the known wallets. An end-to-end test proves the app asks the wallet to sign exactly `transfer(recipient, amount) ‖ CMB2 ‖ requestId`.

## Mezo integration (more than an ERC-20 transfer)

| Mezo component | Use in Cambio |
| --- | --- |
| MUSD token | Balances, transfers with a calldata-bound request ID, `Transfer`-event settlement proof |
| Router · PoolFactory · MUSD/BTC pool | Live quotes, on-chain fees, reserve-based Fund & Pay sizing, exact-approval swaps |
| **PriceFeed** (`0x86bC…9366`) | BTC/USD oracle price; a stale-oracle revert is shown as stale, never replaced by an off-chain price |
| **TroveManager** (`0xE47c…6bb0`) | Trove status, collateral, debt, `getCurrentICR`, MCR/CCR, TCR, Recovery Mode |
| **BorrowerOperations** (`0xCdF7…beE5`) | Minimum debt, borrowing fee, gas compensation for a read-only `openTrove` preview |
| Multicall3 | Batches protocol reads: 17 → 5 RPC requests per refresh |

Protocol addresses come from the official `mezo-org/musd` deployment artifacts and are verified on-chain by `npm run verify:chain`. Details and the protocol rules Cambio follows are in [docs/MEZO_INTEGRATION.md](docs/MEZO_INTEGRATION.md).

## The flagship journey

1. **Merchant:** Request → amount and note → **Sign & create request** (a free EIP-712 signature). The invoice is saved to the registry; share the link or QR code.
2. **Customer:** opens the link and sees "Signed by the recipient's wallet". Cambio checks the request has not already been paid.
3. If the customer is short on MUSD: **Fund this payment with BTC**. Cambio shows the exact BTC in, the guaranteed MUSD out, fee, impact, slippage, and the Mezo oracle value. The wallet asks for an exact approval, then the swap.
4. **Review payment → Confirm in wallet.** Cambio waits for the receipt and the matching `Transfer` event.
5. **Merchant:** Invoices shows **Paid · verified**. The server re-verified the transaction itself, and the proof link verifies in any browser.

## Architecture

React 19 + Vite SPA (Reown AppKit, wagmi, viem) and an Express API on the same origin (Vercel function or Node server), with Firestore or SQLite storage. There are **no custom smart contracts**; Cambio composes Mezo's existing contracts. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Path | Purpose |
| --- | --- |
| `src/config/chains.ts` | Every network, token, pool, router, protocol contract and Multicall3 address |
| `src/lib/paymentRequest.ts` | Link format, EIP-712 types, validation, `verifySettlement` (exact calldata) |
| `src/lib/musdTransfer.ts` | Preflight → wallet → receipt → `Transfer` evidence state machine |
| `src/lib/swap.ts`, `src/lib/fundAndPay.ts` | Router quotes, exact approvals, re-quote + simulate, shortfall sizing |
| `src/lib/mezoProtocol.ts` | PriceFeed, TroveManager, BorrowerOperations reads; contract-identical ICR math |
| `src/lib/requestSettlement.ts` | Settlement search (paged explorer + RPC log fallback; incomplete = unknown) |
| `src/lib/evidence.ts`, `scripts/verify-evidence.ts` | Independent PASS / FAIL / INCONCLUSIVE verification |
| `server/identity/*`, `server/invoices/*` | SIWE username registry, invoice registry, merchant sessions, server-side settlement verification |

## Tech stack

TypeScript, React 19, Vite 8, Tailwind 4, Reown AppKit, wagmi 3, viem 2, Express 4, Firebase Admin / Firestore, `node:sqlite`, Vitest, Playwright, ESLint 10, GitHub Actions.

## Local setup

Prerequisites: Node.js 24 (≥ 22.12 runs everything except SQLite self-hosting), npm, and Java 21 for the Firestore emulator tests.

```bash
npm ci
cp .env.example .env.local     # set VITE_WALLETCONNECT_PROJECT_ID
npm run dev                    # http://localhost:3000, Vite + the same Express API
```

Without Firestore credentials, development uses an in-memory registry (not durable; the UI says so). To use the emulator:

```bash
npx firebase emulators:start --only firestore --project demo-cambio
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_PROJECT_ID=demo-cambio npm run dev
```

**Test funds:** BTC (for gas) from https://faucet.test.mezo.org. Get MUSD with Cambio's Swap (BTC → MUSD), or use Fund & Pay directly on an invoice.

### Environment

See [.env.example](.env.example). Server variables:
- `APP_URL`: the public origin used for SIWE binding.
- `IDENTITY_STORE`: `firestore`, `sqlite` or `memory`.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: server-only.
- `TRUST_PROXY`, `ALLOWED_ORIGINS`.
- `INVOICE_MIN_CONFIRMATIONS`: default 1. Mezo has single-slot finality.

Never put server credentials in a `VITE_*` variable.

## Testing

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript, strict, including tests |
| `npm run lint` | ESLint (typescript-eslint, react-hooks), zero warnings |
| `npm test` | Unit, integration, API and UI tests, with no network access (Node 24 runs the SQLite suites) |
| `npm run test:rules` | Firestore rules, identity and invoice stores against the emulator |
| `npm run test:e2e` | Playwright against the production build. It reads live testnet and never broadcasts; it asserts the exact calldata the wallet is asked to sign. |
| `npm run test:live` | Read-only live checks: PriceFeed, protocol rules, router, recorded evidence, Multicall3 parity |
| `npm run verify:chain` | Every configured address and pool, plus the protocol contracts, on both networks |
| `npm run verify:evidence` | Re-verifies `submission/evidence/transaction-proofs.json` (`--scan <address>` finds Cambio payments) |
| `npm run pilot:metrics` | Chain-derived pilot traction for consenting merchants |
| `npm run measure:rpc` | RPC request counts and latency, batched vs unbatched |

The latest results are recorded in [docs/CAMBIO_10_10_IMPLEMENTATION_TRACKER.md](docs/CAMBIO_10_10_IMPLEMENTATION_TRACKER.md). CI is defined in [.github/workflows/ci.yml](.github/workflows/ci.yml) and uses no secrets.

## How settlement is decided

A signed request is **paid** only when all of these hold:
- a transaction on chain 31611 has calldata exactly `MUSD.transfer(recipient, amount) ‖ 0x434d4232 ‖ requestId`;
- its receipt succeeded;
- the receipt contains the matching MUSD `Transfer` event;
- its block time is at or after the request's creation.

Payments at or after expiry are labelled late. Opening, scanning or "marking" never sets a status.

The server records a settlement only after reading the chain itself. If a search cannot cover the whole period since the request was created, the status is *unknown*, never *unpaid*.

## Identity design

1. `POST /api/identity/challenge` returns an EIP-4361 message bound to this domain, the wallet, the action and the name, with a single-use nonce and a 5-minute expiry.
2. The wallet signs it. This is free and sends no transaction.
3. `POST /api/identity/claim` verifies the signature (ECDSA, then ERC-1271/6492). In one atomic transaction it then:
   - consumes the nonce;
   - enforces uniqueness;
   - writes both mapping directions.

Merchant sign-in for the invoice registry uses the same SIWE pattern and returns a 24-hour bearer token, which is stored server-side only as a SHA-256 hash.

## Security model

- **Non-custodial.** No keys, seed phrases or custodial signing; every transaction and signature is approved in the user's wallet.
- **Data honesty.** No generated hashes, no timer-based confirmations, no optimistic balances, no off-chain substitute for the Mezo oracle. RPC failure shows as unavailable or unknown, never zero, unpaid or paid.
- **Payments.** Chain and account are re-checked immediately before each wallet prompt. Each payment also gets:
  - a gas estimate on the exact calldata;
  - synchronous double-submit locks;
  - a check for an existing settlement before Pay is enabled.
- **Swaps.** Exact approvals only, fresh re-quote plus `simulateContract`, router-enforced minimum output, 30-second quotes, and impact above 15% refused.
- **API.** Strict validation, 4 KB bodies, per-IP rate limits (shared atomically in Firestore/SQLite), no wildcard CORS, `no-store`, CSP and security headers. Firestore rules deny all client access to server collections.

Full review and residual risks: [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md). There is **no independent audit**.

## Deployment

**Vercel.** `vercel.json` serves the SPA from the CDN and `/api/*` from `api/index.ts`. Set the server variables and the Firebase service-account secret as described in [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md). Then:
- Deploy the rules and index:

  ```bash
  npx firebase deploy --only firestore:rules,firestore:indexes
  ```

  `.firebaserc` and `firebase.json` target project `cambio-717c1`, database `(default)`.

- Add TTL policies on `identity_rate_limits.expiresAt`, `merchant_sessions.ttl` and `merchant_challenges.ttl`.
- Check `GET /api/health`. It should report `identity.durable: true` and `invoices.available: true`.

**Self-hosted.** Node 24, SQLite on a persistent disk, Docker Compose and Caddy. See [SELF_HOSTING.md](SELF_HOSTING.md).

## Business model

Free for personal payments. **Merchant Pro** (pricing hypothesis: $9/month, paid in MUSD) adds:
- the cross-device registry;
- reconciliation;
- export;
- alerts.

Pro is billed using Cambio's own signed invoices and unlocked by a server-verified settlement, so no new contracts are needed. A non-custodial transfer pays Cambio nothing. In-payment or routing fees would need an audited contract and are not built. See [docs/BUSINESS_MODEL.md](docs/BUSINESS_MODEL.md), [docs/USER_RESEARCH.md](docs/USER_RESEARCH.md) and [docs/MERCHANT_PILOT_PLAN.md](docs/MERCHANT_PILOT_PLAN.md). Research and pilot results are **pending**.

## Roadmap

See [submission/WAVE_3_ROADMAP.md](submission/WAVE_3_ROADMAP.md). The next items are:
1. Record the signed-settlement proof and redeploy.
2. Run a 3–5 merchant testnet pilot with chain-derived metrics.
3. Test Merchant Pro billing, invoice reminders and webhooks.
4. Build a Telegram bot that creates signed requests (Track 2).
5. Evaluate an audited checkout contract for enforced single-use invoices and fees.
6. Mainnet only after an independent review.

## Submission materials

- Deck: [submission/CAMBIO_FINAL_PITCH_DECK.pdf](submission/CAMBIO_FINAL_PITCH_DECK.pdf)
- What changed in Wave 2: [submission/WAVE_2_REPORT.md](submission/WAVE_2_REPORT.md)
- Demo script and recording guide: [submission/DEMO_SCRIPT.md](submission/DEMO_SCRIPT.md), [submission/DEMO_RECORDING_GUIDE.md](submission/DEMO_RECORDING_GUIDE.md)
- Evidence: [submission/evidence/](submission/evidence/)
- Form draft: [SUBMISSION_PACKAGE.md](SUBMISSION_PACKAGE.md)

## License

Apache-2.0 (see the SPDX headers in the source files).
