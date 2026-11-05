# Known limitations

Status as of 2026-11-05. Each item is a current fact about the product, not a roadmap promise.

## Evidence and adoption

- **No signed-request settlement exists on-chain yet.** The MUSD transfer and the BTC→MUSD swap are verified (PASS). No transaction carrying Cambio's request-id suffix was found for the known wallets. See `submission/evidence/signed-payment-settlement.md` for the five-minute procedure that completes it.
- **No user research or pilot results exist yet.** The templates, consent form and metrics tool are ready (`docs/USER_RESEARCH.md`, `docs/MERCHANT_PILOT_PLAN.md`, `npm run pilot:metrics`). No interviews or pilot payments have taken place. There are no customers or revenue.
- The live deployment at https://cambio-five.vercel.app runs the Wave 1 code until this branch is merged and redeployed. The Mezo position card, Fund & Pay and the invoice registry are **not live** until then.

## Payments

- **Single-use invoices are not enforced on-chain.** A plain `MUSD.transfer` cannot refuse a second payment. Cambio checks for an existing settlement before enabling Pay and flags duplicates, but a payer using another wallet UI can pay twice. Enforcement needs a checkout contract, which would require design, an audit and owner approval. None of that has been started.
- **Fund & Pay uses only the MUSD/BTC pool.** There is no multi-hop routing and no Slipstream/CL pools. Testnet liquidity prices differ from the Mezo oracle (2.0–2.1% spread observed). The payer must hold enough BTC for the swap plus gas.
- **Fund & Pay is two wallet prompts plus the payment.** Exact approvals are a deliberate safety choice.
- A payment-link page refresh during a swap does not resume the swap UI. The swap continues on-chain, the ledger tracks it, and balances are re-read on reload.
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
- The Telegram/WhatsApp distribution channels mentioned in the track description are not built.
- No independent security audit. See `docs/SECURITY_REVIEW.md`.
