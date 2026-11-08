# Two-minute demo script

> **Superseded on 2026-11-08 by [`submission/WAVE2_PITCH_SCRIPT.md`](/submission/WAVE2_PITCH_SCRIPT.md).** Kept for history; where the two differ, the newer document is current.


Record only real UI and real transactions. If a step has not genuinely happened on-chain, say so on camera; never show a simulated hash as real. Times are an editing guide.

**Pre-flight:**
- Browser A: merchant wallet, with a username claimed.
- Browser B: a payer wallet holding **some BTC and less MUSD than the invoice** (for example 20 MUSD against a 50 MUSD invoice).
- Both on Mezo Testnet, both on the **redeployed Wave 2 build**.

| Time | Screen | Narration |
| --- | --- | --- |
| 0:00–0:12 | Landing page | "Cambio lets you get paid in MUSD and prove it on-chain. It's non-custodial and runs on Mezo Testnet. I'm Lushegs, a solo developer, building for the Access & Distribution track." |
| 0:12–0:30 | A: Request → 50 MUSD, note → **Sign & create request** → "Saved to the invoice registry" → QR | "As a merchant I sign this invoice with my wallet. It's free, and the signature binds the amount, recipient, token, network and expiry. The link can't be edited without breaking the signature." |
| 0:30–0:45 | B: open the link → "Signed by the recipient's wallet" → connect | "My customer opens the link in any wallet. Cambio verifies the signature and checks the invoice hasn't already been paid." |
| 0:45–1:10 | B: **Fund this payment with BTC** panel → Swap → approve → swap → confirmed | "They only have 20 MUSD. Cambio sizes a BTC-to-MUSD swap on Mezo's pool for exactly the shortfall, shows the guaranteed output, fee, slippage and Mezo's oracle price, and asks for an exact approval. Here's the real swap confirming." |
| 1:10–1:30 | B: **Review payment → Confirm in wallet** → Confirmed → explorer tab: input ends with `434d4232…` | "Now they pay. The transaction carries the invoice ID in its calldata. Here it is on the Mezo explorer." |
| 1:30–1:45 | A: Invoices → **Paid · verified**, totals updated; open the proof link in a private window | "The merchant's dashboard shows it paid. The server re-read the chain itself; it never accepts a client status. Anyone can open this proof link and verify it." |
| 1:45–1:55 | Overview → Mezo position (oracle price, trove health, borrow preview) | "Cambio also reads Mezo's PriceFeed and trove health, and previews borrowing MUSD against BTC, read-only." |
| 1:55–2:00 | `npm run verify:evidence` output, PASS | "Every transaction we cite re-verifies from the chain with one command." |

**If the signed-settlement payment could not be recorded**, replace 1:10–1:45 with:

> "The app asks the wallet to sign this exact calldata. Our tests prove it. We have not yet recorded a signed-invoice payment on-chain, so I'm not showing one."

Then show the e2e assertion or the review screen only.

**Do not claim:** customers, revenue, an audit, mainnet availability, or live features that are not deployed at recording time.
