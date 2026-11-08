# Cambio — response to the Wave 1 judge feedback

**Project:** Cambio, non-custodial MUSD invoicing and payments with verifiable settlement on Mezo.
**Track:** Track 2 — Access & Distribution.
**Team:** Lushegs, solo builder (product, design, engineering). GitHub: [@Lushegs01](https://github.com/Lushegs01).
**Live:** https://cambio-five.vercel.app (Mezo Testnet, chain 31611; mainnet disabled).
**Repo:** https://github.com/Lushegs01/cambio.

Wave 1 scores for reference: Integration 4, Business 6, Technical 4, UX 4, Materials 2. These are history, not the current evaluation.

Status words used below:
- **Verified**: re-checked against the chain or the deployment on 2026-11-08.
- **Implemented, not live yet**: merged code, waiting for the redeploy in owner action §0.
- **Pending (owner)**: needs the owner's wallets or people.

Nothing below is simulated.

## The feedback, point by point

| Wave 1 criticism | Wave 1 state | Wave 2 implementation | Evidence | Status | Remaining limitation |
| --- | --- | --- | --- | --- | --- |
| "No MUSD payment … has actually happened on-chain" — cite a MUSD send | No hashes anywhere | A real 10 MUSD transfer between two SIWE-verified usernames (@solo → @lushegs), re-verified by `npm run verify:evidence`: chain, MUSD contract, `transfer` calldata, receipt, matching `Transfer` event, sender, recipient, amount | [`0x8e39d309…5065e`](https://explorer.test.mezo.org/tx/0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e) | **Verified: PASS** | — |
| … "a BTC→MUSD swap" | None | A real 0.01 BTC → 786.1477 MUSD swap through the official Mezo Router, with the PoolFactory route checked, the BTC paid into the MUSD/BTC pool, and output ≥ the router minimum (782.2170) | [`0x4af2b0f0…33f6e`](https://explorer.test.mezo.org/tx/0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e) | **Verified: PASS** | — |
| … "a settled payment request" | Signed links existed; no settlement on-chain | The payment calldata is `transfer(merchant, amount) ‖ "CMB2" ‖ requestId`. The server, the browser proof viewer and the CLI all run the same check: EIP-712 signature by the merchant, exact calldata, success, `Transfer` event, block time after creation. A plain transfer to the merchant is **not** accepted as settlement (unit, API and live e2e tests). **New:** `verify:evidence --discover <merchant> --write` finds and records the proof automatically once it exists | Browser e2e asserts the exact calldata the wallet is asked to sign; a live e2e shows the real plain transfer above being **rejected** as a settlement | **Pending (owner, about 10 minutes, `WAVE2_OWNER_ACTIONS.md` §1)**. A re-scan of the known wallets on 2026-11-08 found no CMB2 payment | Needs two owner wallets. The agent will not broadcast or fake it |
| "Go beyond plain ERC-20 transfers … reading Mezo PriceFeed or trove health" | Not present | **PriceFeed**: live BTC/USD, 18-decimal handling, a stale-oracle revert shown as stale (no off-chain substitute). **TroveManager**: status, collateral, debt, `getCurrentICR` (equal to our calculation to the wei), MCR/CCR, TCR, Recovery Mode, liquidation price. Reads are batched through Multicall3 | `npm run test:live` (7/7), `npm run verify:chain`, `docs/MEZO_INTEGRATION.md` | **Verified** (live reads); UI is live in production | Trove figures shown only for wallets that have a trove; none are invented |
| … "or letting payers mint MUSD against BTC through BorrowerOperations" | Not present | **Read-only `openTrove` preview** (borrowing fee, minimum debt, gas compensation, resulting ICR/TCR, Recovery Mode rules). **Executable borrowing was deliberately not shipped**: it would put payers into liquidatable debt from a payment page, and the safety gate (hints, recovery-mode edge cases, a risk review) cannot be met responsibly this wave | `src/lib/mezoProtocol.ts`, tests; feasibility gate in `docs/WAVE2_IMPLEMENTATION_AUDIT.md` (G) | **Preview verified; execution not built (by decision)** | Owner decision for Wave 3 |
| (implied) BTC-funded payment | Not present | **Fund & Pay**: on a signed invoice, Cambio computes the exact MUSD shortfall, sizes a BTC → MUSD swap from live pool reserves, confirms with a live Router quote, applies slippage protection, keeps BTC aside for gas, and shows the guaranteed minimum, fee, price impact and the Mezo oracle value. It asks for an **exact** approval, then the swap, then returns to the same invoice. **New:** a stepper, and a pending payment is recovered after a refresh | e2e: exact approval to the Router (never unlimited); live sizing test (1/25/500 MUSD) | **Live; on-chain run pending (owner)** | Approval, swap and payment are **three separate transactions, not atomic**, and the UI says so |
| "Add a revenue model (merchant fees, a routing fee or subscriptions)" | Described only | **Merchant Pro subscription, implemented** (testnet): the server issues an order (price, the owner's treasury, period, random id). The merchant's wallet pays it with the same `CMB2` binding. The server verifies the payment on-chain and extends `proUntil` atomically and at most once. One tx can credit one order. Pro unlocks a server-verified reconciliation report. No fee is ever taken from invoice payments. Routing and in-payment fees need a contract, and that trade-off is documented | `tests/billing.api.test.ts` (10), store contract on memory/SQLite/Firestore emulator, browser e2e; `docs/WAVE2_BUSINESS_MODEL.md` | **Implemented, not live yet** (needs owner action §0.3: treasury address) | Testnet MUSD has no value: this proves the mechanism, **not revenue**. No subscription has been paid |
| "… and some evidence of real users" | None | Pilot and research kit: consent form, onboarding, session observation, feedback report, case-study template. `npm run pilot:metrics` counts **only** verifiable settlements. The readiness checker blocks the submission until consenting participants exist | `docs/WAVE2_PRODUCT_VALIDATION.md`, `scripts/pilot-metrics.ts` | **Pending (owner): no users, interviews or testimonials exist, and none are claimed** | Needs real people |
| "Add a pitch deck" | None | 12-slide deck built from real product screenshots | `submission/CAMBIO_FINAL_PITCH_DECK.pdf` | **Done** | Evidence slide updates once §1 is done |
| "State your track and team" | Missing | Stated in the README, deck, this file and the form draft | `README.md` | **Done** | — |
| "Remove claims that don't match the repo, such as 'Solidity smart contracts' and the 'CRYPTO → NAIRA' mockup text" | Present | The mockup was replaced with a real rendering of the signed-request page. Every document says there are **no custom contracts**. A stale "production runs Wave 1" line was also removed. `npm run check:submission` now **fails** if any judge-facing doc reintroduces these claims, or if a `contracts/` directory or `.sol` file appears in the repository root | `scripts/check-submission.ts` | **Verified** | — |

## What else changed since the first Wave 2 pass

These items came from an adversarial review on 2026-11-08 and are fixed and tested:

- **Double-payment bug fixed.** While a submitted payment was still pending, or the RPC could not read it, the Pay button stayed enabled. Now only a reverted or mismatching transaction re-enables payment. A refresh resumes watching the pending payment and says "Do not pay again" (e2e).
- **Silent registry failures removed.** The payer's page used to swallow errors when telling the merchant's registry about a payment. It now records only after on-chain confirmation, retries the conditions that can resolve by waiting (not yet visible, confirmations, 503), and shows the outcome.
- **Public proof viewer** at `#proof/<merchant>/<requestId>`. It needs no wallet and runs the same `checkSignedSettlement` as the CLI in the browser. It shows the receipt, a per-check breakdown, explorer links, and copy/share/print. A lying registry can only make it fail.
- **CI fix.** The scheduled live-chain CI run on main failed on 2026-11-07 because the load-balanced public RPC returned nothing for a mined transaction. Evidence reads now retry not-found and transport errors (reverts still fail fast). The live suite is green.
- **Distribution:** WhatsApp, Telegram and email sharing, plus an embeddable "Pay with Cambio" button (a plain link, no script). Each channel carries the exact signed link, which is tested to still verify.
- **Merchant dashboard:** late and duplicate filters; a proof link on every paid row.
- **Submission readiness checker** (`npm run check:submission`): PASS/FAIL/BLOCKED across deployment, CI, live evidence, materials, claims, users and links.

## How a judge can check this in five minutes

```bash
git clone https://github.com/Lushegs01/cambio && cd cambio && npm ci
npm run verify:evidence        # re-reads every cited transaction from the Mezo RPC (read-only)
npm run test:live              # PriceFeed, protocol rules, Router, Multicall parity, recorded evidence
npm run check:submission       # the same readiness report as submission/WAVE2_FINAL_READINESS.md
```

In a browser: open any proof link, and the page verifies it on-chain with no wallet. To see a forged claim rejected, open `https://cambio-five.vercel.app/#proof/<any merchant>/<any stored request id>?tx=0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e`. The checks show which facts are true (a real, successful MUSD transfer) and which are false (wrong recipient, no request id).

## What we do not claim

- No customers, users, interviews, testimonials or revenue.
- No audit.
- No mainnet.
- No custom smart contracts.
- No atomic swap-and-pay.
- No fiat or naira conversion.
- On-chain single use of an invoice is **not enforceable** with a plain ERC-20 transfer. Cambio detects and flags duplicate payments instead.
