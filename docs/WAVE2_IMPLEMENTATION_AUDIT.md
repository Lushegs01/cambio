# Cambio Wave 2 implementation audit

Baseline audited on 2026-11-08 at `main` = `c3c47df`. Work is on branch `lushegs/focused-goldberg-9ruzxf`. This supersedes `docs/CAMBIO_10_10_IMPLEMENTATION_TRACKER.md` (2026-11-05).

**Status vocabulary** (from the brief):

| Status | Meaning |
| --- | --- |
| **IMPLEMENTED AND VERIFIED** | Implemented and verified on the live chain or live deployment |
| **IMPLEMENTED BUT NOT LIVE-VERIFIED** | Code and tests exist; not on the deployment yet, or not exercised on-chain |
| **TESTED ONLY WITH MOCKS** | Tests use fakes for the chain or the server |
| **REQUIRES OWNER ACTION** | Needs the owner's wallets, accounts or people |
| **BLOCKED** | Cannot proceed for an external reason |
| **NOT IMPLEMENTED** | Does not exist |

## Baseline facts found at the start of this pass

| Fact | How it was checked |
| --- | --- |
| Production (`cambio-five.vercel.app`) already runs the first Wave 2 build: Fund & Pay, CMB2 suffix, PriceFeed code are in the served chunks; `/api/health` reports Firestore-backed, durable identity and invoices. The README still said "runs the Wave 1 build" (**stale claim, fixed**) | Downloaded the 50 production chunks and fingerprinted them; `curl /api/health` |
| Production API behaves correctly: listing needs auth (401), malformed invoices rejected (400), foreign `Origin` rejected (403), SIWE challenge bound to the domain | `curl` probes, rejected inputs only |
| CI on main: push run green; **the latest scheduled live-chain run (2026-11-07) failed** (`RPC did not return the evidence transactions`) | GitHub Actions logs |
| MUSD transfer and Router swap proofs: **PASS**, re-verified live | `npm run verify:evidence` |
| No CMB2-suffixed payment exists for @lushegs or @solo. Two @solo transfers were unreadable on the first scan; read directly: both plain 68-byte `transfer` calldata | `--scan` plus a raw `eth_getTransactionByHash` |
| Unit tests 250/250 on Node 24 (2 SQLite tests need Node ≥ 24 by design); typecheck and lint clean | local runs |
| `npm audit --omit=dev`: 11 high + 4 moderate, all transitive (Zod 3 in wallet SDKs; glob/minimatch/rimraf in firebase-admin) | `npm audit --json` |
| AKINDO deadline: not publicly confirmable; repo records the platform field 2026-11-13 05:30 UTC; planned against it | web search; `SUBMISSION_PACKAGE.md` |

## Audit matrix

| Req. | Requirement | Existing implementation | Deficiency found | Judging impact | Priority | Solution | Status | Verification evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | Real MUSD transfer | Verified proof `0x8e39…065e` | — | Integration | P0 | Preserved, not re-manufactured | **IMPLEMENTED AND VERIFIED** | `verify:evidence` PASS (chain, contract, calldata, receipt, Transfer, sender, recipient, amount, time) |
| B | Real BTC → MUSD Router swap | Verified proof `0x4af2…3f6e`; Swap view | — | Integration | P0 | Preserved | **IMPLEMENTED AND VERIFIED** | PASS (router, PoolFactory route, pool, amount in, out ≥ min) |
| C | Real signed-invoice settlement | EIP-712 binds id, recipient, token, chain, amount, memo, createdAt, expiresAt; CMB2 calldata; strict `verifySettlement` | No on-chain settlement; manual, error-prone recording procedure | **Integration (largest gap)** | P0 | `verify:evidence --discover <merchant> --write`: finds CMB2 payments, fetches the signed request from the public registry by on-chain id, re-verifies signature and settlement, records it. Owner runbook | **REQUIRES OWNER ACTION** (tooling: IMPLEMENTED AND VERIFIED against production; correctly finds 0) | `tests/evidence-discovery.test.ts` (incl. forged registry → rejected); live discover run |
| C′ | Opening a link never marks paid; a plain transfer never counts | Implemented | — | Integration / Tech | P0 | Added a live e2e with the real plain transfer | **IMPLEMENTED AND VERIFIED** | e2e `public proof viewer: a real plain transfer is rejected…` |
| D | Fund & Pay (shortfall, quote, fee, slippage, gas reserve, minimum, impact, oracle, exact approval, swap, refresh, resume) | Implemented | No step guidance; refresh mid-payment lost state; not atomic (correctly disclosed) | Integration / UX | P0 | Stepper; recovery of a submitted payment; Pay locked while in flight | **IMPLEMENTED BUT NOT LIVE-VERIFIED** (no on-chain Fund & Pay run yet) | e2e exact approval; live sizing test 1/25/500 MUSD; journey unit tests |
| D′ | Refresh during the *swap* itself | Ledger tracks the swap; balances re-read on reload | Swap progress UI does not resume; the shortfall is recomputed from the new balance | UX | P2 | Documented | **IMPLEMENTED BUT NOT LIVE-VERIFIED** | `docs/KNOWN_LIMITATIONS.md` |
| E | PriceFeed (live, decimals, freshness, states, pool comparison, deviation warning) | Implemented; stale revert shown as stale; no off-chain substitute | — | Integration | P1 | — | **IMPLEMENTED AND VERIFIED** | `test:live` "PriceFeed returns a fresh 18-decimal BTC price"; `verify:chain` |
| F | Trove health | Implemented (ICR equals `getCurrentICR` to the wei; MCR/CCR/TCR/Recovery Mode/liquidation price) | — | Integration | P1 | — | **IMPLEMENTED AND VERIFIED** | `test:live`; unit tests |
| G | Executable BorrowerOperations | Read-only `openTrove` preview | Execution would put payers into liquidatable debt from a payment page; needs HintHelpers/SortedTroves hints, recovery-mode edge cases, disclosures, risk review | Integration | P2 | **Safety gate not met; not built.** Preview kept and labelled read-only | **NOT IMPLEMENTED** (by decision) | — |
| H | Public proof viewer (no wallet, details, explorer, failure reasons, no tokens) | Payment page with `?tx=` showed a single banner | No per-check breakdown or receipt; long link | Integration / UX / Materials | P0 | `#proof/<recipient>/<id>` runs `checkSignedSettlement` in the browser; receipt; checks; copy/share/print; dashboard link | **IMPLEMENTED BUT NOT LIVE-VERIFIED** (live after redeploy; e2e on production build + live chain) | `tests/proofViewer.test.ts` (10); 3 e2e incl. mobile |
| I | Evidence reproducible in CI | Daily live job | **Failed on 2026-11-07** (RPC flake) | Tech / Integration | P0 | `retryRead()` for not-found and transient errors; longer evidence schedule | **IMPLEMENTED AND VERIFIED** (locally live; CI after push) | `test:live` 7/7; retry unit tests |
| Biz-A | Target market | Documented | — | Business | P1 | Narrowed and updated | **IMPLEMENTED AND VERIFIED** (documentation) | `docs/WAVE2_BUSINESS_MODEL.md` |
| Biz-B | Merchant dashboard (create, share, QR, history, pending, paid, expired, late, duplicates, volume, search, CSV, proof links, cross-device, authorized listing) | Most present | No late or duplicate filters; no proof links | Business / UX | P1 | Added late and duplicate filters and a proof link per paid row | **IMPLEMENTED BUT NOT LIVE-VERIFIED** | e2e cross-device; unit filters |
| Biz-C | Merchant Pro billing (treasury, order, wallet payment, server verification, start/end, expiry, entitlement, duplicates, renewal) | Described only | **Not built** | **Business (revenue model)** | P1 | Server-issued orders bound by CMB2; `verifyPaymentTx`; atomic `activateOrder`; tx uniqueness; `proUntil` extension; Pro reconciliation report (402 gate); UI | **IMPLEMENTED BUT NOT LIVE-VERIFIED**. **REQUIRES OWNER ACTION**: `PRO_TREASURY_ADDRESS` | `tests/billing.api.test.ts` (10, mock chain); store contract ×3 incl. Firestore emulator; rules test; e2e |
| Biz-D | Distribution (WhatsApp, link, QR, wallets, embed, mobile page) | Copy, QR, native share, MetaMask deep link | No WhatsApp/Telegram/email; no embed | Business (Track 2) | P1 | Share helpers plus an escaped, script-free embed button | **IMPLEMENTED BUT NOT LIVE-VERIFIED** | `tests/share.test.ts`; e2e |
| Biz-E | Real merchant pilot | Plans and metrics tool | No participants | **Business** | P0 (owner) | Full kit: consent, onboarding, funding guide, observation, feedback, case study; checker gate | **REQUIRES OWNER ACTION** | `docs/WAVE2_PRODUCT_VALIDATION.md` |
| Biz-F | Business model document | `docs/BUSINESS_MODEL.md` | Pro mechanism outdated | Business | P1 | `docs/WAVE2_BUSINESS_MODEL.md` | **IMPLEMENTED AND VERIFIED** (documentation) | — |
| T-B | Transaction reliability (validation, chain/account/contract/balance checks, gas, slippage, simulation, rejection, hash persistence, pending recovery, receipt + event, revert, timeout ≠ failed, unknown, duplicate protection, idempotency) | Mostly present | Pay while pending (W2-1); refresh lost the hash (W2-2) | Tech | P0 | Fixed | **IMPLEMENTED AND VERIFIED** (production build e2e) | `docs/WAVE2_SECURITY_REPORT.md` |
| T-C | Payment security matrix | Present | — | Tech | P0 | Tests added for billing, proof viewer, discovery | **IMPLEMENTED AND VERIFIED** (unit/API/e2e) | Security report matrix |
| T-D | Backend hardening | Present; Firestore index and TTL documented | New billing collections | Tech | P1 | Rules and index added; billing fails closed | **REQUIRES OWNER ACTION** (deploy index) | Emulator 26/26 |
| T-E | Security review and dependency audit | First pass 2026-11-05 | Re-check needed | Tech | P1 | Re-run; exploitability analysis | **IMPLEMENTED AND VERIFIED** (review); advisories **BLOCKED** (no upstream fix) | `docs/WAVE2_SECURITY_REPORT.md` |
| T-F | Performance | Multicall batching | — | Tech | P2 | Re-measured; verification timing added | **IMPLEMENTED AND VERIFIED** | `docs/WAVE2_PERFORMANCE_REPORT.md` |
| T-G | Observability | Structured errors; health endpoint; no secrets in logs | No metrics backend | Tech | P2 | Health now reports billing; configuration errors logged by name | **IMPLEMENTED BUT NOT LIVE-VERIFIED**; metrics **NOT IMPLEMENTED** | — |
| T-H | Automated tests incl. the 17 browser scenarios | 20 e2e | Missing: stepper, refresh while pending, proof viewer, Pro | Tech | P1 | +6 e2e | **IMPLEMENTED AND VERIFIED** (mock wallet, live reads; never broadcasts) | `docs/WAVE2_TECHNICAL_VERIFICATION.md` |
| T-I | CI gates | typecheck, lint, unit, build, audit, emulator, e2e, live | Missing proof treated as OK forever | Tech | P1 | `check:submission` turns missing proof into BLOCKED | **IMPLEMENTED BUT NOT LIVE-VERIFIED** (CI runs on push) | — |
| T-J | Deployment acceptance | Vercel READY | README stale | Tech | P0 | Checker fingerprints the deployed bundle | **REQUIRES OWNER ACTION** (merge and redeploy) | `check:submission` |
| UX-A/B | Stepper; transaction states (awaiting wallet, submitted, confirmed, verified, rejected, reverted, unknown) | States present | No stepper | UX | P0 | `PaymentStepper` | **IMPLEMENTED BUT NOT LIVE-VERIFIED** | e2e stepper |
| UX-C | Receipts | Banner only | — | UX | P1 | Receipt on the proof page; note hidden by default | **IMPLEMENTED BUT NOT LIVE-VERIFIED** | e2e |
| UX-D | Error recovery ("did funds move, what is safe") | Present for transfers | Pending state invited a retry | UX | P0 | "Do not pay again" plus auto re-check | **IMPLEMENTED AND VERIFIED** (e2e) | — |
| UX-E/F | Mobile and accessibility | Pixel 7 e2e; labels; focus | Real devices untested | UX | P2 | Stepper and proof use `aria-current`, live regions and `sr-only` statuses; mobile proof e2e | **TESTED ONLY WITH MOCKS** (emulated viewport) | e2e `@mobile` |
| UX-G | Usability validation | Scripts | No sessions | UX | P1 (owner) | Kit | **REQUIRES OWNER ACTION** | — |
| S-A | Pitch deck | 12 slides from real screens | Old feature set | Materials | P1 | Updated slides; PDF re-rendered | see `submission/WAVE2_FINAL_READINESS.md` | — |
| S-B | Two-minute video | Script | Not recorded | Materials | P1 | Timeline script plus recording guide | **REQUIRES OWNER ACTION** | — |
| S-C … G | Wave 2 report, evidence package, user validation report, README, submission checker | Partial | No checker; stale README line | Materials | P0 | `WAVE2_JUDGE_RESPONSE.md`, `check:submission`, README | **IMPLEMENTED AND VERIFIED** (checker run) | `submission/WAVE2_FINAL_READINESS.md` |

## Not done, with reasons

- **The executable borrowing flow:** the safety gate was not met (G).
- **A checkout contract:** needs an audit.
- **Telegram bot, reminders, webhooks:** prioritised below the flagship journey.
- **Real-device mobile testing and Lighthouse:** no devices were available here.

## Judging scorecard (agent's evidence-based estimate — not the judges' score)

The estimates are deliberately conservative. A score is only raised by results someone can independently verify, never because code exists.

| Category (weight) | Estimate now | Evidence | Remaining weaknesses | Unresolved blockers | Conditions for 10/10-level readiness |
| --- | --- | --- | --- | --- | --- |
| **Mezo Integration (30%)** | **7 / 10** | Transfer and Router swap PASS live; PriceFeed, TroveManager and Multicall reads verified (`test:live`, `verify:chain`); Fund & Pay sizing verified live; settlement verification is strict and shared by server, browser and CLI | No signed-invoice settlement on-chain; Fund & Pay never run end to end on-chain; borrowing is preview-only | Owner action §1 | Signed settlement PASS, plus a Fund & Pay swap and settlement pair from the same payer, both cited; an executable, risk-reviewed borrowing route |
| **Product & Business Viability (30%)** | **6 / 10** | Narrow segment; implemented, tested non-custodial subscription mechanism; distribution channels; honest unit economics | Zero users, interviews or subscriptions; billing is off in production | Owner actions §0.3 and §3 | 3–5 real merchants with verified settlements in `pilot:metrics`; ≥ 3 pricing interviews; one real testnet subscription verified |
| **Technical Implementation (20%)** | **8.5 / 10** | 305 unit, 26 emulator, 26 e2e and 7 live tests; CI green on all jobs (run 42482775620); a double-payment bug found and fixed; three stores under one contract | No independent audit; 11 high transitive advisories (no upstream fix); public RPC trust; no metrics backend | — | Independent review; a second RPC for verification; observability; advisories resolved upstream |
| **User Experience (10%)** | **7 / 10** | Stepper; pending recovery with "do not pay again"; receipt and proof page; plain-language errors; mobile viewport e2e; ARIA states | No usability sessions; no real-device or wallet-app testing; Fund & Pay needs three prompts | Owner action §3 | 5 moderated sessions with the issues they reveal fixed; real MetaMask Mobile and WalletConnect runs |
| **Submission Materials (10%)** | **7 / 10** | Deck (12 slides, real screenshots, overflow-checked); judge response; generated readiness report; owner runbook; script and demo guide | No video; the evidence slide still shows the settlement as pending | Owner actions §1 and §2 | A video of the real journey; all three proofs PASS on the slide and in the README |

**Weighted estimate now: about 7.0 / 10.** After owner actions §0–§2 (deploy, signed settlement, video), the projection is about 7.6. A small but real pilot (§3) would bring it to about 8.1. Reaching 9–10 needs real users and an independent review, and those cannot be produced by code. The judges' decision is theirs.
