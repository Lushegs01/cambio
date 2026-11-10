# Cambio Wave 2 implementation tracker

> **Superseded on 2026-11-08 by [`docs/WAVE2_IMPLEMENTATION_AUDIT.md`](/docs/WAVE2_IMPLEMENTATION_AUDIT.md).** Kept for history; where the two differ, the newer document is current.


Branch `lushegs/magical-hamilton-fopk6s`, starting from `0961046` (Wave 1). Last updated 2026-11-05.

Status legend: ✅ implemented & verified · 🟡 implemented, unverified or not deployed · ⏳ blocked on an owner/external action · ❌ not done

## Baseline audit (start of Wave 2)

| Area | Found at `0961046` | Classification |
| --- | --- | --- |
| MUSD transfer path | Preflight → wallet → receipt → `Transfer` check; tested with mocks | Implemented, unverified on-chain in repo |
| Signed requests + settlement | EIP-712 + calldata suffix; settlement search read only explorer page 1 / 10 candidates | Partially implemented (search bug) |
| Swaps | Router quotes, exact approvals, re-quote + simulate | Implemented, unverified on-chain in repo |
| Transaction evidence | No hashes anywhere in the repo | Missing |
| PriceFeed / troves / BorrowerOperations | None | Missing |
| Fund & Pay | None | Missing |
| Persistent invoices | Browser `localStorage` only | Missing |
| CI / ESLint | None; `lint` was an alias for `tsc` | Missing |
| Claims | `mockup.png` showed "CRYPTO → NAIRA"; deck cited CaNoN-0 repo and old test counts; docs said repo private | Inaccurate |
| Tests | 179/181 unit pass (2 SQLite tests need Node 24) | Verified |

## Work items

| # | Priority | Item | Status | Files | Verification evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | P0 | Collect and verify real transactions | ✅ transfer, ✅ swap, ⏳ signed settlement | `submission/evidence/*`, `scripts/verify-evidence.ts`, `src/lib/evidence.ts` | `npm run verify:evidence` → PASS, PASS, INCONCLUSIVE (stable over 3+ runs). Scans of @lushegs, @solo, @blurize and `0xB771…5BFC` found no CMB2 payments. |
| 2 | P0 | Calldata suffix reaches the wallet | ✅ | `tests/e2e/*` | e2e asserts `eth_sendTransaction.data == expectedPaymentCalldata(req)` |
| 3 | P0 | RPC "not found" inconsistency | ✅ | `src/lib/rpcRetry.ts` | Measured 8/12 and 9/12 receipt reads; unit tests |
| 4 | P0 | Mezo PriceFeed | ✅ (🟡 not deployed) | `src/lib/mezoProtocol.ts` | Unit (stale/unavailable), live test, `verify:chain` |
| 5 | P0 | Trove health | ✅ (🟡 not deployed) | same + `MezoProtocolCard.tsx` | ICR equals a live `getCurrentICR` to the wei; screenshot |
| 6 | P0 | BorrowerOperations | ✅ read-only preview; ❌ executable flow (needs owner approval) | same | Unit tests mirror `openTrove` rules |
| 7 | P0 | Fund & Pay | ✅ (🟡 not deployed) | `src/lib/fundAndPay.ts`, `FundAndPayPanel.tsx` | Unit, live sizing (1/25/500 MUSD), e2e exact approval |
| 8 | P1 | Persistent invoices + merchant sessions | ✅ (🟡 not deployed) | `server/invoices/*` | 10 API tests; store contract on memory, SQLite (Node 24) and Firestore emulator |
| 9 | P1 | Server-verified settlement + duplicates | ✅ | `server/invoices/service.ts` | API tests: hash-only, 422 on plain transfer, 503 on RPC failure, duplicates |
| 10 | P1 | Reconciliation beyond page 1, incomplete = unknown | ✅ | `src/lib/requestSettlement.ts` | `tests/reconciliation.test.ts` |
| 11 | P1 | Merchant dashboard | ✅ (🟡 not deployed) | `MerchantInvoices.tsx`, `src/lib/invoices.ts` | Unit tests; e2e cross-device recovery; screenshot |
| 12 | P1 | Double-payment protection | ✅ best-effort (on-chain enforcement needs a contract) | `PaymentRequestPage.tsx` | e2e; documented limits |
| 13 | P1 | Notifications | 🟡 in-app only (existing); no email/push/webhooks | — | `KNOWN_LIMITATIONS.md` |
| 14 | P0/P1 | Security review | ✅ | `docs/SECURITY_REVIEW.md` | 5 findings fixed; residual risks listed |
| 15 | P1 | ESLint + CI | ✅ (CI first run happens on push) | `eslint.config.js`, `.github/workflows/ci.yml` | `npm run lint`: 0 problems; workflow YAML valid |
| 16 | P1 | Dependency advisory | ✅ `follow-redirects` patched; 🟡 11 high in the Zod 3 wallet-SDK chain, no fix published | `package-lock.json` | `npm audit --omit=dev` |
| 17 | P1 | Performance | ✅ | `src/lib/readClient.ts`, `docs/PERFORMANCE_REPORT.md` | `npm run measure:rpc`: 17→5 and 7→3 requests |
| 18 | P0 | Remove unsupported claims | ✅ | `mockup.png`, `README.md`, deck, `SELF_HOSTING.md` | grep for NAIRA, Solidity, CaNoN-0 and team claims |
| 19 | P0 | README, deck, Wave 2 report, demo script | ✅ (video ⏳) | `README.md`, `submission/*` | Deck: 12 pages from real screenshots |
| 20 | P1 | Business model, research kit, pilot plan, metrics tool | ✅ materials; ⏳ real research/pilot | `docs/*`, `scripts/pilot-metrics.ts` | Dry run on the real wallet: 0 Cambio payments (consistent with #1) |

## Test results (2026-11-05)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | ✅ clean |
| `npm run lint` (ESLint, max-warnings 0) | ✅ clean |
| `npm test` on Node 24.22.2 | ✅ 250/250 (26 files) |
| `npm test` on Node 22.23.4 (this container's default) | 244 pass, 4 skipped; 2 SQLite tests fail by design (they need Node ≥ 24) |
| `npm run test:rules` (Firestore emulator) | ✅ 19/19 |
| `npm run test:e2e` (production build, Chromium, desktop + mobile) | ✅ 20/20 |
| `npm run test:live` (read-only, live testnet) | ✅ 7/7 |
| `npm run verify:chain` (testnet + mainnet) | ✅ all checks pass |
| `npm run verify:evidence` | 2 PASS · 1 INCONCLUSIVE (pending) |
| `npm run build` | ✅ |

## Owner actions remaining (cannot be done by the agent)

1. **Record the signed-request payment.** About 5 minutes with two testnet wallets; steps are in `submission/evidence/signed-payment-settlement.md`. Then run `npm run verify:evidence -- --write`.
2. **Review and merge this branch, then redeploy.** Deploy `firestore.indexes.json`, add TTL policies on `merchant_sessions.ttl` and `merchant_challenges.ttl`, and confirm `/api/health`.
3. **Record the 2-minute video** (`submission/DEMO_RECORDING_GUIDE.md`).
4. **Run the interviews and the merchant pilot** (`docs/USER_RESEARCH.md`, `docs/MERCHANT_PILOT_PLAN.md`).
5. **Submit on AKINDO before 2026-11-13 05:30 UTC** (the platform deadline field, earlier than the "Nov 15" in the text). Add social links to the team field.
6. Decide on a treasury address before enabling Merchant Pro billing. Decide whether to pursue an executable borrowing flow or a checkout contract; both need review.

## Final assessment (agent's evidence-based estimate; not the judges' score)

Weights are verified against the official AKINDO criteria.

| Criterion (weight) | Score | Achieved | Deficiencies | What would raise it |
| --- | --- | --- | --- | --- |
| Mezo Integration (30%) | **7.5/10** | Real MUSD transfer and Router swap verified; PriceFeed, TroveManager and BorrowerOperations reads with protocol-accurate rules; Fund & Pay composes pool, router and oracle; Multicall3 | No signed-settlement tx yet; borrowing is preview-only; new features not live until redeploy | Record the settlement; redeploy; an executable, risk-reviewed borrowing route |
| Product & Business Viability (30%) | **6/10** | Specific segment and journey; a revenue mechanism that needs no contracts; unit economics; pilot and research kit; honest metrics tool | Zero users, interviews or pilot data; pricing untested | 3–5 pilot merchants, 30 verified settlements, WTP interviews |
| Technical Implementation (20%) | **8/10** | Server-verified settlement, three stores under one contract suite, reconciliation and RPC fixes, real ESLint, CI, 296 automated tests across suites, security review | No audit; CI not yet run on GitHub; wallet-SDK advisories | First green CI run; dedicated RPC; external review |
| User Experience (10%) | **7/10** | Clear Fund & Pay explanation, explicit states, mobile-verified layouts, accessible labels | No usability sessions; Fund & Pay needs three prompts | 5 moderated sessions, then fix the drop-off points |
| Submission Materials (10%) | **6.5/10** | Accurate README, 12-slide deck from real screens, Wave 2 report mapping each piece of feedback, evidence verifier | Video not recorded; signed proof pending | Record the video showing the real signed settlement |

Weighted estimate: **about 7.0/10** today. If the owner completes actions 1–3, the projection is about 7.8/10. A higher score requires real pilot users.
