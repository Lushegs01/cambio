# Business model

Status: **hypotheses, not results.** Cambio has no paying customers, no revenue and no completed user research as of 2026-11-05. Everything below is a plan to test, with the mechanism and the evidence that would confirm or reject it.

## Customer segments

| Segment | Who | Job to be done | Why Mezo / MUSD |
| --- | --- | --- | --- |
| **Primary: crypto-native freelancers and small studios** | Designers, developers and consultants already paid in crypto, often across borders | Send an invoice that cannot be tampered with, get paid in a dollar-stable asset, and prove payment to an accountant or client | MUSD is dollar-denominated and Bitcoin-backed. Clients who hold BTC can pay without selling first, via Fund & Pay. |
| **Secondary: merchants in the Mezo ecosystem** | Projects, communities and event organisers that sell to MUSD/BTC holders | Shareable payment links and QR codes, reconciliation, CSV export | Their customers already hold MUSD or BTC on Mezo. |
| **Payer side: BTC holders** | People with BTC on Mezo who need to pay a dollar amount | Pay an exact MUSD invoice without a separate trip to a DEX | Fund & Pay sizes and executes the BTC→MUSD swap on the invoice itself. |

We do **not** claim mass-market or regional demand. Earlier materials implied a crypto→naira product, and that claim was removed. Cambio has no fiat off-ramp.

## Persona: "Ada, independent product designer"

- Bills 3–8 international clients a month, $300–$3,000 per invoice. Some clients prefer to pay in crypto.
- Today she pastes a wallet address into an email, asks for a screenshot, then checks an explorer by hand. She has once been sent funds on the wrong network.
- She needs a link the client cannot edit, a clear "paid" status she can trust, a monthly export for bookkeeping, and no custody risk.
- What would make her pay: saved invoices across devices, export, reminders, and branded links. These are **hypotheses to test** in interviews (`docs/USER_RESEARCH.md`).

## Revenue options and how each would actually be collected

A non-custodial `MUSD.transfer` pays the merchant directly. **It pays Cambio nothing.** Every fee needs an explicit mechanism.

| Option | Mechanism | Implementable now? | Pros | Cons / risks |
| --- | --- | --- | --- | --- |
| **A. Merchant Pro subscription (recommended first)** | Cambio's treasury wallet signs a monthly Cambio invoice. The merchant pays it like any other request. Pro features unlock when the server has a **verified settlement** of that invoice in the last 30 days. | **Yes**, using the existing signed-request + server-verified-settlement code. It needs only a treasury address (owner decision) and a feature flag. | Uses the product itself; no new contracts; no payment-path risk | Manual monthly payment unless renewals are prompted; requires a pricing test |
| B. Volume-based statement | Monthly statement computed from verified settlements (e.g. 0.25% of verified volume above a free tier), billed via option A | Yes, computed from registry data | Revenue scales with use | Billing after the fact, so collection risk |
| C. In-payment merchant fee | A checkout contract splits each payment between merchant and fee recipient | **No.** Needs a new contract, an audit and owner approval | Automatic collection; could also enforce single-use invoices | Contract risk, audit cost; changes the "no custom contracts" trust story |
| D. Routing fee on Fund & Pay swaps | Fee on the swap leg | **No.** Mezo's Router `swapExactTokensForTokens` has no referral or fee parameter. Would need a wrapper contract or a separate fee transfer. | Monetises the Mezo-specific feature | Adds cost exactly when the payer is short; contract risk |

Recommendation: **A, then B.** Do not build C or D until pilots show willingness to pay and an audit budget exists.

## Pricing hypotheses (to validate, not to quote as fact)

| Tier | Price hypothesis | Includes |
| --- | --- | --- |
| Personal | Free | Usernames, signed requests, QR, settlement proof, Fund & Pay, device-local history |
| Merchant Pro | **$9 / month, paid in MUSD** (test $5 / $9 / $19) | Cross-device invoice registry, reconciliation, CSV export, duplicate-payment alerts, reminders (to build), branded links (to build) |
| Volume (later) | 0.25% of verified monthly volume above $2,000 (test) | Same as Pro, for higher-volume merchants |

Validation questions are in `docs/USER_RESEARCH.md`. Pricing changes only after at least 5 willingness-to-pay interviews.

## Unit economics (estimates; verify current vendor pricing before relying on them)

| Cost | Estimate | Note |
| --- | --- | --- |
| Hosting (Vercel Pro) | about $20 / month | Hobby is free but not for commercial use; check Vercel's current terms |
| Firestore | $0 to about $25 / month at pilot scale | Free daily quotas cover pilot traffic; each invoice is about 1 write plus a few reads |
| RPC | $0 now (public Mezo RPC); budget about $50–$200 / month for a dedicated or second provider at scale | Also improves verification independence |
| Domain, email, monitoring | about $10–$20 / month | |
| **Fixed total** | **about $30 / month (pilot) to about $270 / month (scaled)** | Solo developer time not included |

At a $9 Pro price, about 4 paying merchants cover pilot costs and about 30 cover the scaled stack. The marginal cost per invoice is a fraction of a cent (a few Firestore operations plus RPC reads), so gross margin on Pro is high **if** merchants convert.

## Competitive landscape (positioning, from public descriptions; verify before citing)

| Alternative | What it does well | Where Cambio differs |
| --- | --- | --- |
| Wallet "send" plus a pasted address | Universal and free | No tamper-evident request, no settlement proof, no reconciliation |
| Hosted crypto checkouts (e.g. Coinbase Commerce, Stripe crypto) | Polished merchant tooling and fiat integrations | Typically stablecoin- or exchange-centric and hosted. We have not verified MUSD/Mezo support. Cambio is non-custodial, MUSD-native, and uses Mezo's oracle, pools and troves. |
| Invoicing protocols (e.g. Request Network) | Rich invoicing standard, multi-chain | We have not verified Mezo support. Cambio needs no contract deployment and binds the request ID in calldata. |
| The Mezo app itself | Borrowing, earning, swapping | Cambio extends it into *payments between people*. It does not compete with borrowing or yield; it previews the borrowing route. |

## Acquisition and growth (solo-developer scale)

1. **Mezo community first:** Discord builders and existing MUSD holders, offering the pilot to 3–5 merchants (`docs/MERCHANT_PILOT_PLAN.md`).
2. **Product-led loop:** every invoice is shown to a payer who may not know Cambio. The payment page invites them to claim a username and create their own request. Measure invites to creators.
3. **Content:** "How to invoice in MUSD and get paid by BTC holders" guides with real explorer proofs.
4. **Ecosystem integrations later:** a Telegram bot that creates signed requests (in line with Track 2 examples) and an embeddable "Pay with MUSD" button.

## Traction metrics (definitions; current values are all zero or pending)

| Metric | Definition | Source | Current |
| --- | --- | --- | --- |
| Verified settlements | Payments that pass `verifySettlement` for a stored signed request | `npm run pilot:metrics` | 0 |
| Active merchants | Merchants with at least 1 verified settlement in 30 days | registry + chain | 0 |
| Funded payments | Verified settlements preceded by a Fund & Pay swap from the same payer | chain | 0 |
| Completion rate | Verified settlements ÷ invoices opened by a connected payer | registry + analytics (to add) | n/a |
| Time to pay | Block time − `createdAt` | `pilot:metrics` | n/a |
| Willingness to pay | Interviewees who would pay ≥ $9/month | interviews | pending |

## Monetisation risks

- MUSD payment volume between individuals may be small in the near term.
- Merchants may expect payments to be free. Subscription conversion is unproven.
- A checkout contract (option C) would add audit cost and change the trust model.
- Testnet usage does not predict mainnet demand. Mainnet stays disabled pending a security review.
