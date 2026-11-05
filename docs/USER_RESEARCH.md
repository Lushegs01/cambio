# User research

**Status: not started. No interviews or tests have been conducted, and no participant data exists.** This file contains the materials needed to run the research. Results sections are empty until real sessions happen.

## Goals (targets, not results)

- 10 problem interviews: 6 freelancers or small studios, 4 merchants in the Mezo ecosystem
- 5 willingness-to-pay conversations, a subset of the above
- 5 moderated usability sessions of the flagship journey on testnet
- Completion rate and time-to-payment for each session

## Recruiting

- Mezo Discord (builders and community channels), with a short post linking the consent form
- Personal network of crypto-paid freelancers
- Payers recruited by pilot merchants (`docs/MERCHANT_PILOT_PLAN.md`)

Offer: early Merchant Pro access free during the pilot. No cash incentives in tokens.

## Consent form (send before any session)

> **Cambio research consent**
>
> Cambio is a non-custodial MUSD payment app on Mezo Testnet built by Lushegs (solo developer).
> - The session lasts about 30 minutes. With your permission, I will take notes and may screen-record.
> - On testnet you use test funds only. I will **never** ask for your seed phrase or private key.
> - Wallet addresses you use on testnet are public on-chain. I will report results without names, and I will only list your address in pilot metrics if you tick the box below.
> - You can stop at any time and ask me to delete your notes and recordings.
>
> ☐ I agree to take part. ☐ You may record my screen. ☐ You may include my testnet merchant address in aggregate pilot metrics.
>
> Name / handle: ________ Date: ________

## Problem interview script (30 minutes)

1. How do you get paid today? Walk me through the last payment, step by step.
2. What went wrong in the last 3 months? (Wrong address, wrong network, disputed amount, waiting to confirm, bookkeeping.)
3. How do you prove a client paid? How does your client prove they paid?
4. Which assets do you accept? Why? Would you accept a Bitcoin-backed dollar stablecoin (MUSD)? What would make you hesitate?
5. Do your payers hold BTC? Would they swap BTC to pay a dollar invoice? What stops them today?
6. What do you do at month end: export, reconcile, report?
7. What tools do you pay for today for invoicing or payments? How much?

## Willingness-to-pay questions

- "If Cambio saved your invoices across devices, reconciled payments automatically and exported a monthly CSV, how much would that be worth per month?" Then test $5 / $9 / $19 (Van Westendorp style: too cheap, cheap, expensive, too expensive).
- "Would you rather pay a monthly fee or 0.25% of paid volume?"
- "Would you pay it in MUSD?"

## Usability test script (flagship journey, testnet)

Setup: the participant uses their own wallet, funded from the faucet. The moderator acts as the merchant.

| Step | Task | Success criterion | Record |
| --- | --- | --- | --- |
| 1 | Open the payment link the moderator sends | Understands who is being paid and how much | Time; confusion points |
| 2 | Connect a wallet and switch to Mezo Testnet | Connected on 31611 | Time; wallet used; mobile or desktop |
| 3 | Notice the MUSD shortfall and fund with BTC | Approves the exact approval and the swap | Prompts understood? |
| 4 | Pay the request | Confirmed on-chain | Time from open to confirmed |
| 5 | Share the proof link | Moderator's browser shows "Paid — verified" | — |
| 6 | Explain what "verified" means | Mentions on-chain or signature | Quote |

Metrics per session: completed (y/n), time to pay, errors, assists needed, SUS score (10 questions), and the tx hash (verify with `npm run verify:evidence`).

## Results

| Date | Participant (pseudonym) | Type | Completed | Time to pay | Key quotes / issues |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | *No sessions conducted yet* |

## Synthesis

*Pending real sessions.*
