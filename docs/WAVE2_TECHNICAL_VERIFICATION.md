# Cambio technical verification (Wave 2)

Run on 2026-11-08 in this environment: Node 24.22.1, Chromium from Playwright 1.64, Java 21 for the Firestore emulator. The suites ran against the branch `lushegs/focused-goldberg-9ruzxf`, whose final commit is the one that adds this file. Every command is in `package.json` and can be re-run.

## Gates

| Gate | Command | Result | Uses a real chain? |
| --- | --- | --- | --- |
| TypeScript (strict, incl. tests and scripts) | `npm run typecheck` | ✅ clean | — |
| ESLint, zero warnings | `npm run lint` | ✅ clean | — |
| Unit, integration, API, UI | `npm test` | ✅ **305 / 305** (32 files) | No: fake chain readers and stores. These are **mock tests**, not on-chain proof |
| Firestore rules and stores (emulator) | `npm run test:rules` | ✅ **26 / 26** | No: Firestore emulator, real transactions |
| Browser e2e: production build served by `server.js`, Chromium desktop + Pixel 7 | `npm run test:e2e` | ✅ **26 / 26** (3 opt-in screenshot specs skipped) | **Reads live Mezo Testnet**. The injected wallet signs real EIP-712/SIWE messages but **declines every transaction**, so nothing is broadcast |
| Live read-only protocol checks | `npm run test:live` | ✅ **7 / 7** | Yes, read-only |
| Contract and pool addresses (testnet + mainnet) | `npm run verify:chain` | ✅ all checks pass | Yes, read-only |
| Recorded evidence | `npm run verify:evidence` | MUSD transfer **PASS** · BTC→MUSD swap **PASS** · signed settlement **INCONCLUSIVE (pending)**; exit 2 | Yes, read-only |
| Production build | `npm run build` | ✅ | — |
| Deck layout | `npm run deck:check` | ✅ 12 / 12 slides fit | — |
| Submission readiness | `npm run check:submission` | see `submission/WAVE2_FINAL_READINESS.md` | Yes, read-only |

Unit tests on Node 22: the two SQLite suites fail by design, because they need `node:sqlite` from Node ≥ 24. CI runs Node 24.

## What the new tests prove (and what they do not)

| Area | Tests | Proves | Does not prove |
| --- | --- | --- | --- |
| Evidence discovery | `tests/evidence-discovery.test.ts` | A CMB2 payment is recovered by its on-chain request id. A registry entry with an altered amount, a different id, or a different recipient is **rejected**. Transient RPC errors are retried; reverts are not | That a real signed settlement exists (owner action) |
| Payer journey | `tests/paymentJourney.test.ts` | Step derivation. A submitted payment is matched only by id, recipient, token and amount. Registry sync retries only waitable conditions | — |
| Proof viewer | `tests/proofViewer.test.ts` | It verifies end to end and fails on a forged amount or a plain transfer. "Not found" and "unknown" are kept distinct. RPC failure gives inconclusive, never verified | Live UX on real devices |
| Billing | `tests/billing.api.test.ts`, `tests/billing-stores.test.ts`, `tests/rules/billingStore.firestore.test.ts`, rules test | A verified payment grants exactly one period. Plain transfers, wrong amount, wrong treasury, reverts and older txs are refused. One tx credits one order. Activation is atomic under concurrency (emulator). There is no cross-merchant access. Browsers cannot write entitlement | That anyone has subscribed (none have) |
| Distribution | `tests/share.test.ts` | Each channel carries the exact signed link, which still verifies. The embed has no script | — |
| Browser scenarios | `tests/e2e/app.spec.ts` | See the table below | Real wallet broadcasts |

## Browser scenarios (brief §6H)

| # | Scenario | Covered by | Notes |
| --- | --- | --- | --- |
| 1 | First-time visitor | `landing → dashboard loads…` | No runtime errors or CSP violations, asserted after every test |
| 2 | Merchant creates a signed invoice | `recipient creates a signed request…` | Real EIP-712 signature; share channels asserted |
| 3 | Payer opens the signed invoice | `a signed request opened in a separate session…` | |
| 4 | Invalid signature rejected | `a tampered signed link is refused…` | |
| 5 | Wrong chain | `a network change in the wallet is detected…` | |
| 6 | Sufficient MUSD | `… runs the real on-chain preflight` | Live balances of a funded pool address (watch mode) |
| 7 | Insufficient MUSD | `sending more MUSD than the wallet really holds…`, Merchant Pro e2e | |
| 8 | Fund via BTC swap | `Fund & Pay: … exact approval` | Stops at the wallet: exact approval to the Router asserted |
| 9 | Payer approves payment | `… respects a wallet rejection` | Exact `transfer ‖ CMB2 ‖ id` calldata asserted; the wallet declines |
| 10 | Confirmation delayed | `a refresh while a payment is pending…` | Unknown hash stays pending; Pay locked |
| 11 | Refresh while pending | same | |
| 12 | Transaction reverts | Unit only (`verifySettlement`, billing API) | **Mock only.** A revert cannot be produced without broadcasting |
| 13 | Invoice expires | `expired and malformed links are not payable` | |
| 14 | Already paid | Unit (`requestSettlement`, journey); proof viewer "verified" path | **Mock only.** No real settlement exists yet |
| 15 | Proof viewer verifies a genuine settlement | Unit (`proofViewer`) | **Mock only until owner action §1.** The live e2e covers the *rejection* of a real non-settlement |
| 16 | Merchant sees synchronized status | `a signed invoice is stored server-side and recovered on another device…` | |
| 17 | Unauthorized access rejected | API tests (401/404 across merchants); production probe | |

## Production deployment checks (2026-11-08, read-only)

| Check | Result |
| --- | --- |
| `GET /` | 200; CSP, HSTS and `frame-ancestors 'none'` present |
| `GET /api/health` | `ok: true`; identity and invoices on durable Firestore |
| Served build | First Wave 2 build (Fund & Pay, CMB2, PriceFeed present). This branch's features are **not deployed yet** (`check:submission` → BLOCKED until merge) |
| `GET /api/invoices` without a token | 401 |
| `POST /api/invoices` with a malformed body | 400 |
| Foreign `Origin` | 403 `origin_not_allowed` |
| SIWE challenge | Bound to `cambio-five.vercel.app` |
| Wallet connection on a real phone | **Not verified here** (no device) |

Vercel showing READY is not treated as proof of health; the checks above are what was verified.

## CI

`.github/workflows/ci.yml`:
- **On push and pull request:** typecheck, lint, unit, build, audit (fails on critical), Firestore emulator, Playwright.
- **Daily and on manual dispatch:** `verify:chain`, `test:live`, `verify:evidence`. Exit 2 (pending) is tolerated; FAIL is not.

The last scheduled run on main before this branch (2026-11-07, [run 42375106119](https://github.com/Lushegs01/cambio/actions/runs/42375106119)) failed on an RPC read; fixed by `retryRead`.

On this branch, manually dispatched runs found and fixed two more CI-only problems:
- [Run 42481938999](https://github.com/Lushegs01/cambio/actions/runs/42481938999): the mainnet RPC `mezo.drpc.org` refused `eth_call` from GitHub's runners. `verify:chain` now uses the first RPC that serves calls.
- [Run 42482405882](https://github.com/Lushegs01/cambio/actions/runs/42482405882): the readiness checker would have made one failed daily run fail every later run. CI-status rows now judge only completed runs on the head.

[Run 42482775620](https://github.com/Lushegs01/cambio/actions/runs/42482775620) at `c751ee0` is **green on all four jobs**: checks, emulator, Playwright, and live chain incl. `check:submission`. The submission gate is `npm run check:submission`, which turns any missing proof, video or user evidence into BLOCKED and never into ready.
