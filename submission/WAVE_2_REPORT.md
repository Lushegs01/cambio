# Cambio: what changed in Wave 2

> **Superseded on 2026-11-08 by [`submission/WAVE2_JUDGE_RESPONSE.md`](/submission/WAVE2_JUDGE_RESPONSE.md).** Kept for history; where the two differ, the newer document is current.


Wave 1 baseline: commit `0961046` (2026-11-03). Wave 2 work is on branch `lushegs/magical-hamilton-fopk6s`. Each row maps to a point in the Wave 1 judge feedback.

| Wave 1 feedback | What changed in Wave 2 | Where to verify |
| --- | --- | --- |
| "No MUSD payment or swap has actually happened on-chain" | A real MUSD transfer and a real BTC→MUSD Router swap are **independently verified** by a new read-only verifier, which reports PASS / FAIL / INCONCLUSIVE. The signed-request settlement is still **pending**: no transaction with Cambio's request-ID suffix exists yet. That is disclosed, and the 5-minute steps to record it are provided. | `npm run verify:evidence`, `submission/evidence/` |
| "Go beyond plain ERC-20 transfers: PriceFeed, trove health, BorrowerOperations" | **Mezo PriceFeed** oracle price, with stale-oracle handling. **Trove health** from TroveManager: ICR from `getCurrentICR`, liquidation estimate, Recovery Mode. A **read-only BorrowerOperations `openTrove` preview** (fee, minimum debt, gas compensation, MCR/CCR, new TCR). **Fund & Pay**: a payer short on MUSD swaps exactly the shortfall from BTC on Mezo's MUSD/BTC pool without leaving the invoice. | `docs/MEZO_INTEGRATION.md`, Overview → Mezo position, any signed link |
| "Add a revenue model" | Merchant Pro subscription, billed with Cambio's own signed invoices and unlocked by a server-verified settlement (no new contracts). The fee mechanisms that would need contracts are documented with their trade-offs. Pricing is labelled a hypothesis. | `docs/BUSINESS_MODEL.md` |
| "Some evidence of real users" | No real-user evidence yet, and none is claimed. Built instead: interview, willingness-to-pay and usability scripts; a consent form; a 3–5 merchant pilot plan; a tool that computes traction **only from verifiable transactions**. | `docs/USER_RESEARCH.md`, `docs/MERCHANT_PILOT_PLAN.md`, `npm run pilot:metrics` |
| "Add a pitch deck, state your track and team" | New 12-slide deck built from real product screenshots. Track 2: Access & Distribution. Team: **Lushegs, solo developer**. | `submission/CAMBIO_FINAL_PITCH_DECK.pdf` |
| "Remove claims that don't match the repo ('Solidity smart contracts', 'CRYPTO → NAIRA')" | The landing mockup that read "CRYPTO → NAIRA" was replaced with a real rendering of the signed-request page. README, deck and submission text now state there are **no custom contracts**: Cambio composes Mezo's existing contracts. The outdated "repository is private" and "Source: CaNoN-0/Cambio" statements were removed (the repo is public). | `mockup.png`, `README.md` |

## Other Wave 2 engineering

- **Merchant invoice registry.** Signed requests are stored server-side, keyed by `(recipient, id)` and authorized by the EIP-712 signature. Listing uses a SIWE merchant session.
  - Settlement is recorded only after the server re-reads the chain; clients send a hash, never a status.
  - Duplicate payments are detected.
  - Memory, SQLite and Firestore stores pass one shared contract suite, with Firestore run on the emulator.
- **Merchant dashboard.** Cross-device sync, verified totals, filters, search, formula-safe CSV export.
- **Reconciliation fix.** Search no longer stops at the explorer's first page: a payment on page 3 was previously reported as unpaid. Incomplete coverage is now *unknown*.
- **RPC reliability fix.** The public testnet RPC returned `null` for 25–33% of mined receipts. Reads now retry before concluding "not found".
- **Double-payment check.** It runs before Pay is enabled.
- **Quality gates.**
  - Real ESLint, with zero warnings.
  - GitHub Actions: typecheck, lint, unit, build, audit, Firestore emulator, Playwright, and a scheduled live-chain job.
  - Patched `follow-redirects`.
  - An e2e assertion on the exact calldata the wallet signs.
- **Performance.** Multicall3 batching took the Mezo refresh from 17 to 5 RPC requests and Fund & Pay sizing from 7 to 3.

## Numbers (2026-11-05)

| Suite | Result |
| --- | --- |
| Unit/integration/UI (Node 24) | 250 / 250 |
| Firestore emulator | 19 / 19 |
| Browser e2e (production build) | 20 / 20 |
| Live read-only | 7 / 7 |
| `verify:chain` (testnet + mainnet) | all checks pass |
| `verify:evidence` | 2 PASS, 1 INCONCLUSIVE (pending) |

## Still open (honest status)

- The signed-request settlement transaction (owner action, about 5 minutes).
- Merge and redeploy, so the live app runs the Wave 2 build.
- Real user interviews and the merchant pilot.
- The 2-minute video recording (script ready).
- No audit, mainnet disabled.
