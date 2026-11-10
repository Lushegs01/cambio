# Cambio product validation (Wave 2)

Updated 2026-11-08.

## Status

**No user research, usability sessions, pilot payments or pricing interviews have taken place.**
- 0 participants have been recruited.
- 0 interviews have been run.
- 0 testnet invoices have been paid by pilot users.
- 0 testimonials exist.
- Every results table below is empty until real, consented sessions happen.
- The submission checker reports this area as **BLOCKED**.

What exists is the complete kit to run the pilot, and a metrics tool that counts only on-chain-verifiable payments. This file supersedes nothing: it collects and extends `docs/USER_RESEARCH.md` (interview scripts) and `docs/MERCHANT_PILOT_PLAN.md` (pilot plan), which remain accurate.

## Targets (recruitment and testing goals — not results)

| Goal | Target |
| --- | --- |
| Independent merchants or freelancers | 3–5 |
| Genuine testnet invoice payment attempts | 10–20 |
| Usability sessions | ≥ 5 |
| Pricing interviews | ≥ 3 |

## Methodology

1. **Recruit** in the Mezo Discord and the owner's network of crypto-paid freelancers. Each merchant recruits 2–4 of their own payers.
2. **Consent** using the form below, before any session. Keep the replies.
3. **Onboard** each merchant (checklist below, about 15 minutes on a call).
4. **Pilot invoice workflow.** The merchant sends a real testnet invoice to a real payer, through the channel they normally use (WhatsApp, Telegram or email). The payer pays unassisted if possible. The moderator observes with the observation template.
5. **Measure from the chain** with `npm run pilot:metrics`, which counts:
   - verified settlements;
   - unique paying wallets;
   - median time from invoice creation to payment.

   Session notes add completion rate, errors and assists.
6. **Pricing interview** (about 10 minutes, at exit).
7. **Report** anonymised results in the tables at the end. Change the product only for observed problems, and list what changed.

**Wallets are not people:** one person may use several wallets. Always report **unique wallets** and **participants** separately.

## Recruitment post (template)

> I'm testing **Cambio**, a free testnet tool for sending wallet-signed MUSD invoices on Mezo. Your client can pay from any wallet, even with only BTC, and both sides get an on-chain proof. I'm looking for 3–5 freelancers or merchants for a 30-minute session plus one real **testnet** invoice (no real money). You keep your own wallet; I never ask for keys or seed phrases. Interested? Reply or DM.

## Consent form

> **Cambio pilot consent**
>
> Cambio is a non-custodial MUSD payment app on Mezo Testnet, built by Lushegs (solo developer).
> - Sessions take about 30 minutes. With your permission I take notes and may record the screen.
> - You use **test funds only**. I will **never** ask for your seed phrase or private key.
> - Testnet wallet addresses are public on-chain. Results are reported without names. Your address is listed in pilot metrics only if you tick the box.
> - You can stop at any time and ask me to delete your notes and recordings.
>
> ☐ I agree to take part ☐ You may record my screen ☐ You may include my testnet address in aggregate pilot metrics ☐ You may quote me anonymously
>
> Name or handle: ______ Date: ______

## Merchant onboarding checklist

1. A wallet on Mezo Testnet (MetaMask, Rabby or any WalletConnect wallet).
2. **Testnet funding guide:** get BTC for gas from https://faucet.test.mezo.org. For MUSD, use Cambio → **Swap** (BTC → MUSD), or let payers use **Fund & Pay**.
3. Claim a `@username`. This is a free signature, not a transaction.
4. **Request** → amount and note → **Sign & create request** → **Sign in to sync across devices**.
5. Share the link through your usual channel (WhatsApp, Telegram, email or QR).
6. Watch **Invoices**. "Paid · verified" appears only after an on-chain check. Open the proof link.

**Payer instructions to forward:**

> Open the link and connect any wallet. If you don't have enough MUSD, use **Fund this payment with BTC** (two wallet prompts). Then **Review payment → Confirm in wallet**. When you see "Paid — verified", tap **View receipt and independent proof**.

## Session observation template (one per session)

| Field | Value |
| --- | --- |
| Session id / date | |
| Participant pseudonym · role (merchant / payer) | |
| Device · browser · wallet | |
| Start → invoice opened → wallet connected → funded (if needed) → payment confirmed → proof viewed (timestamps) | |
| Completed unassisted? (y / n / with assist) | |
| Assists given (what, at which step) | |
| Errors seen (exact on-screen text) | |
| Confusing steps (participant's words) | |
| Wallet prompts understood? (approve / swap / pay) | |
| Mobile issues | |
| Tx hashes (swap, payment) | |
| SUS score (10 questions) | |

## Transaction tracking and metrics

```bash
cp pilot/participants.example.json pilot/participants.json    # git-ignored; consenting merchants only
npm run pilot:metrics -- --out submission/evidence/pilot-metrics.json
npm run check:submission                                      # flips to PASS at ≥ 3 consenting merchants
```

| Metric | Source |
| --- | --- |
| Participants recruited / onboarded | consent forms / checklist |
| Invoices created | merchant registry (signed-in dashboard counts) |
| Payments attempted | observation log (an attempt that never reached the chain is not visible on-chain) |
| Verified payments · unique paying wallets · median time to pay | `pilot:metrics` (chain-derived) |
| Failed payments (reverted) · errors · assists | chain + observation log |
| Invoice completion rate | verified payments ÷ invoices opened by a connected payer |
| Satisfaction | SUS |
| Willingness to pay | pricing interview |

## Pricing interview (at exit)

1. "What do you use today to get paid and reconcile? What does it cost?"
2. "Merchant Pro adds a server-verified reconciliation report. Too cheap / cheap / expensive / too expensive: 5, 9, 19 MUSD per month?"
3. "Monthly fee, or 0.25% of verified volume?"
4. "What would have to exist before you paid?" (Record features verbatim; do not promise them.)

## Anonymised feedback report (template)

| # | Pseudonym | Role | Completed | Time to pay | Issue (verbatim) | Severity | Product change made |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | *No sessions conducted yet* | — | — |

## Pilot case study (template, fill only from real data)

> **Merchant:** pseudonym, type (freelance designer / studio / community).
> **Before:** how they were paid, and what went wrong (their words).
> **Pilot:** N invoices, N verified settlements (tx hashes), N via Fund & Pay, median time to pay.
> **Result:** what changed for them; willingness to pay (number, verbatim).
> **Evidence:** links to proof pages and explorer transactions.

## Results

| Metric | Value | Evidence |
| --- | --- | --- |
| Participants recruited | **0** | — |
| Completed onboarding | **0** | — |
| Invoices created by pilot merchants | **0** | — |
| Payments attempted | **0** | — |
| Verified payments | **0** | `pilot:metrics` (not run with real participants) |
| Unique paying wallets | **0** | — |
| Completion rate / median time to pay | n/a | — |
| Usability sessions / pricing interviews | **0 / 0** | — |

## Changes made because of feedback

None yet from users. The changes in Wave 2 came from the judges' feedback and from an internal adversarial review:
- the double-payment bug;
- pending-payment recovery;
- registry sync visibility;
- the stepper.

None of these come from participants.

## Limitations

- Testnet behaviour does not predict mainnet demand.
- A pilot recruited through the developer's network is not representative.
- Self-reported willingness to pay overstates real conversion.
