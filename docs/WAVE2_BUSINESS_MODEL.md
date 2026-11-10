# Cambio business model (Wave 2)

Supersedes `docs/BUSINESS_MODEL.md` (2026-11-05). Updated 2026-11-08.

**Verified facts:**
- The subscription mechanism is implemented and tested on testnet.
- It is not yet enabled in production, because that needs the owner's treasury address.
- No subscription has been paid.
- Cambio has **no customers, no users in research, and no revenue**.

**Hypotheses:** everything about demand, pricing and conversion. Each one is marked, together with the evidence that would confirm or reject it.

## 1. Problem

Getting paid in crypto still means:
- pasting a 42-character address;
- hoping nobody edited the message;
- trusting a screenshot as proof;
- reconciling by hand on an explorer.

Payers who hold BTC but owe a dollar amount must leave the invoice, find a DEX, swap, and come back. *(Problem statement: hypothesis to validate in interviews.)*

## 2. Customer segments (narrow on purpose)

| Priority | Segment | Job to be done | Why Mezo / MUSD |
| --- | --- | --- | --- |
| 1 | **Crypto-native freelancers** (designers, developers, consultants paid across borders) | Send an invoice nobody can tamper with, get a dollar-stable payment, prove it to a client or accountant | MUSD is a Bitcoin-backed dollar; BTC-holding clients can pay without selling elsewhere first |
| 2 | **Small digital agencies and studios** | Same, plus several invoices per month and month-end reconciliation | Merchant dashboard, verified totals, CSV |
| 3 | **Mezo ecosystem merchants** (projects, event organisers) | Shareable links and QR codes for MUSD/BTC holders | Their customers already hold MUSD or BTC on Mezo |
| 4 | **Communities accepting MUSD** (dues, contributions) | Simple links in WhatsApp or Telegram groups, public proof | Distribution channels built in |

Payer side: BTC holders on Mezo who need to pay a dollar amount.

No mass-market or regional claim is made. Cambio has **no fiat off-ramp** and no naira (or other currency) conversion.

## 3. Value proposition and why each feature exists

| Need | Feature (status) |
| --- | --- |
| "Is this link really from my supplier, for this amount?" | EIP-712 **signed invoices**; the payer's browser verifies the signature before showing Pay (**live**) |
| "I have BTC, not MUSD" | **Fund & Pay**: an exact-shortfall BTC → MUSD swap on Mezo, with the guaranteed minimum and the oracle comparison shown (**live**) |
| "Did they pay *this* invoice?" | The request id is bound into the payment calldata; **server-verified settlement**; a **public proof page** that verifies in any browser (**proof page: implemented, live after redeploy**) |
| "Month-end bookkeeping" | Merchant dashboard: verified totals, pending, late, duplicate and expired views; search; CSV (**live**); Pro reconciliation report (**implemented, not live yet**) |
| "Send it where my clients are" | Copy, QR, native share, WhatsApp, Telegram, email, embeddable pay button (**implemented, live after redeploy**) |
| "I don't want a custodian" | Non-custodial: every transaction and signature happens in the user's wallet (**live**) |

## 4. Competitive alternatives (positioning from public descriptions; verify before citing)

| Alternative | Strength | Where Cambio differs |
| --- | --- | --- |
| Wallet send plus a pasted address | Universal, free | No tamper-evident request, no settlement proof, no reconciliation |
| Hosted crypto checkouts (e.g. Coinbase Commerce, Stripe crypto) | Polished tooling, fiat rails | Hosted and exchange-centric; MUSD/Mezo support not verified by us. Cambio is non-custodial and MUSD-native, and uses Mezo's oracle, pool and router |
| Invoicing protocols (e.g. Request Network) | A rich standard, multi-chain | Mezo support not verified by us. Cambio needs no contract deployment and binds the request id in calldata |
| The Mezo app | Borrow, earn, swap | Complementary: Cambio is *payments between people*, funded from BTC via Mezo's own pool |

## 5. Revenue mechanism (implemented)

A non-custodial `MUSD.transfer` pays the merchant directly, and **it pays Cambio nothing**. Every fee therefore needs an explicit mechanism.

**Merchant Pro subscription:**
1. A signed-in merchant clicks **Subscribe**.
2. The server creates an order. The server fixes the price, the operator's treasury (`PRO_TREASURY_ADDRESS`), the period and a random 16-byte id. The client fixes none of them.
3. The merchant's own wallet sends `MUSD.transfer(treasury, price) ‖ "CMB2" ‖ orderId`, after an explicit approval.
4. The server accepts only the transaction hash. It re-reads the chain using the same verifier as invoices: exact calldata, successful receipt, `Transfer` event, block time after the order, and confirmations.
5. It then extends `proUntil` from max(now, current end) by one period. This happens atomically, at most once per order and once per transaction.

Why the server issues an order instead of the treasury signing an invoice: the server holds **no keys**. A server-signed request would need a hot key; a server-issued order needs none, and the on-chain binding is identical.

| Tier | Price (hypothesis) | Includes (only what exists) |
| --- | --- | --- |
| Free | 0 | Usernames, signed invoices, QR and share channels, Fund & Pay, settlement proof, merchant dashboard with cross-device sync, on-screen totals and CSV of visible rows |
| **Merchant Pro** | **9 MUSD / 30 days** (test 5 / 9 / 19) | Server-verified reconciliation report (every stored invoice: status, payer, block, verification time, duplicates, proof URLs). Planned, **not built**: reminders, branding, webhooks |

- Nothing is charged automatically.
- No fee is added to invoice payments.
- With no treasury configured, billing is off and every feature is free. That is the state of production today.

**Not built, by design:** in-payment merchant fees and Fund & Pay routing fees. The Mezo Router's `swapExactTokensForTokens` has no referral or fee parameter. Both would need a new contract and an audit, and would change the "no custom contracts" trust model.

## 6. Unit economics (estimates; vendor prices to re-check)

| Cost | Pilot | Scaled |
| --- | --- | --- |
| Hosting (Vercel) | about $0–20 / month | about $20 / month |
| Firestore | $0 (free quota) | about $25 / month |
| RPC | $0 (public Mezo RPC) | about $50–200 / month (dedicated plus a second provider for verification independence) |
| Domain, email, monitoring | about $10 / month | about $20 / month |
| **Total** | **about $10–30 / month** | **about $115–265 / month** |

- At 9 MUSD/month, about 4 Pro merchants cover the pilot stack, and about 15–30 cover the scaled stack.
- The marginal cost per invoice is a few Firestore operations plus RPC reads: a fraction of a cent.
- Solo developer time is not included. *(All of these are estimates, not measurements.)*

## 7. Acquisition and distribution (Track 2)

1. **The product is the channel.** Every invoice is opened by a payer who may not know Cambio, and the page links to the Cambio dashboard. A dedicated "create your own invoice" invitation is **not built yet**. *Metric to add: payer → merchant conversion.*
2. **Where payments are requested:** WhatsApp and Telegram share links, email, QR on a counter, and an embeddable button on a freelancer's site. All carry the exact signed link.
3. **The Mezo community first:** a 3–5 merchant pilot recruited in the Mezo Discord (`docs/WAVE2_PRODUCT_VALIDATION.md`).
4. **Later:** a Telegram bot that creates signed requests, and a reminder webhook.

## 8. Risks

- Person-to-person MUSD payment volume may stay small in the near term.
- Merchants may expect payments to be free, and conversion to Pro is unproven.
- Testnet behaviour does not predict mainnet demand. Mainnet stays disabled until an independent review.
- Invoice single use is not enforceable without a contract; duplicates are detected, not prevented.
- Dependency risk in the wallet SDKs (`docs/WAVE2_SECURITY_REPORT.md`).

## 9. Validation findings

| Question | Evidence so far |
| --- | --- |
| Do freelancers want signed, verifiable invoices? | **None collected.** 0 interviews |
| Will payers use Fund & Pay? | **None collected.** 0 pilot payments |
| Will merchants pay 9 MUSD/month? | **None collected.** 0 pricing interviews; 0 subscriptions |
| Can the mechanism collect a subscription without custody? | **Yes, mechanically**: API tests and browser e2e on testnet. Not yet used by a real merchant |

## 10. Revenue milestones (targets, not forecasts)

| Milestone | Definition |
| --- | --- |
| M1 | Billing enabled in production with an owner treasury; one end-to-end testnet subscription verified on-chain |
| M2 | 3 pilot merchants with ≥ 1 verified invoice settlement each; 3 pricing interviews |
| M3 | ≥ 3 merchants say they would pay at least 9 MUSD/month, or the price is revised |
| M4 | Mainnet only after an independent security review; first real subscription |

## 11. Roadmap

See `submission/WAVE_3_ROADMAP.md`.
- **Next:** the signed-settlement proof, the pilot, reminders and webhooks.
- **Then:** a Telegram bot.
- **Only with an audit budget:** a checkout contract for enforced single-use invoices and in-payment fees.
