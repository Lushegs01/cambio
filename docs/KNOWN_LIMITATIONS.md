# Known limitations

Status as of 2026-11-08. Each item is a current fact about the product, not a roadmap promise.

## Evidence and adoption

- **No signed-request settlement exists on-chain yet.** The MUSD transfer and the BTC→MUSD swap are verified (PASS). A re-scan on 2026-11-08 found no transaction carrying Cambio's request-id suffix for the known wallets. `submission/WAVE2_OWNER_ACTIONS.md` §1 completes it; `npm run verify:evidence -- --discover <merchant> --write` then records it.
- **No user research or pilot results exist yet.** The templates, consent form and metrics tool are ready (`docs/USER_RESEARCH.md`, `docs/MERCHANT_PILOT_PLAN.md`, `npm run pilot:metrics`). No interviews or pilot payments have taken place. There are no customers or revenue.
- Production at https://cambio-five.vercel.app runs the first Wave 2 build (Fund & Pay, Mezo position card, invoice registry are live). The proof viewer, stepper, Merchant Pro and new share channels go live only after branch `lushegs/focused-goldberg-9ruzxf` is merged and redeployed.
- **Merchant Pro billing is off in production** until the owner sets `PRO_TREASURY_ADDRESS`. No subscription has been paid; testnet MUSD is not revenue.

## Payments

- **Single-use invoices are not enforced on-chain.** A plain `MUSD.transfer` cannot refuse a second payment. Cambio checks for an existing settlement before enabling Pay and flags duplicates, but a payer using another wallet UI can pay twice. Enforcement needs a checkout contract, which would require design, an audit and owner approval. None of that has been started.
- **Fund & Pay uses only the MUSD/BTC pool.** There is no multi-hop routing and no Slipstream/CL pools. Testnet liquidity prices differ from the Mezo oracle (2.0–2.1% spread observed). The payer must hold enough BTC for the swap plus gas.
- **Fund & Pay is two wallet prompts plus the payment.** Exact approvals are a deliberate safety choice.
- A refresh **during the Fund & Pay swap** does not resume the swap progress UI. The swap continues on-chain, the ledger tracks it, balances are re-read on reload, and the funding panel recomputes the remaining shortfall. A refresh **during the payment** does resume: the submitted hash is recovered and Pay stays locked until the chain decides.
- Approval, swap and payment are **three separate transactions**, not atomic. A swap can succeed while the payment is never sent; the MUSD then stays in the payer's wallet.
- Unsigned links (from Receive) still work and are labelled unsigned.

## Mezo protocol

- **Borrowing is read-only.** Cambio previews `openTrove` but sends no BorrowerOperations transaction. An executable flow needs owner approval, a risk review, hint calculation via HintHelpers/SortedTroves, and liquidation/redemption disclosures in the wallet step.
- The liquidation price is derived arithmetic. It moves as interest accrues and ignores redistributions that have not happened yet.
- Redemptions can reduce or close a trove at face value. Cambio discloses this but does not model a redemption position.

## Registry and infrastructure

- The invoice registry (Firestore on Vercel) needs the composite index from `firestore.indexes.json`, plus TTL policies on `merchant_sessions.ttl` and `merchant_challenges.ttl`, to be deployed by the operator.
- Session tokens live in the browser's `localStorage` for 24 hours.
- The listing returns at most 1,000 invoices (10 pages). There is no server-side search.
- History in Activity shows the latest 50 MUSD transfers from the explorer. Settlement search pages further back.
- SQLite self-hosting requires Node ≥ 24 and one local disk. The 2 SQLite tests fail on Node 22 by design.

## Product scope

- MUSD only for requests. There are no fiat off-ramps. Fiat values are display estimates from public FX APIs, labelled as such.
- No notifications outside the app: no email, push or webhooks yet. In-app notifications are not persisted across sessions.
- WhatsApp, Telegram and email sharing are links that open those apps with the signed link prefilled. There is no bot or integration that creates invoices inside those apps.
- No independent security audit. See `docs/SECURITY_REVIEW.md`.
