# Two-minute pitch video: script

Record only real UI and real transactions. If the signed-invoice payment has not happened on-chain at recording time, use the alternative lines marked **ALT**, and never show a simulated hash as real. Recording setup and export are in `submission/WAVE2_DEMO_GUIDE.md`.

| Time | Scene (what is on screen) | Narration |
| --- | --- | --- |
| **0:00–0:15** · Problem and customer | Landing page, then a split screen: an email with a pasted 0x address and a "paid?" screenshot | "Freelancers and small studios paid in crypto still paste addresses, trust screenshots and reconcile on an explorer by hand. Their clients often hold Bitcoin, not dollars. I'm Lushegs, building Cambio solo for Mezo's Access and Distribution track." |
| **0:15–0:35** · Solution | Merchant browser: Request → 5 MUSD, note → **Sign & create request** → "Saved to the invoice registry" → QR, then the WhatsApp/Telegram buttons | "Cambio is non-custodial MUSD invoicing on Mezo. The merchant signs the invoice with their wallet. It's free, and it binds the amount, recipient, token, network and expiry. Share it anywhere; the link can't be edited without breaking the signature." |
| **0:35–1:30** · Real invoice, BTC funding, payment, verification | Payer browser: open link → stepper, "Signed by the recipient's wallet" → connect → **Fund this payment with BTC** (guaranteed minimum, fee, impact, oracle value) → exact approval prompt → swap prompt → "Swap confirmed" → **Review payment → Confirm in wallet** → "Paid — verified on Mezo Testnet" → explorer tab with input ending `434d4232…` → **View receipt and independent proof** with all checks green | "My client opens it in any wallet. Cambio verifies the merchant's signature and checks the invoice isn't already paid. They hold BTC but no MUSD, so Cambio sizes a swap on Mezo's own pool for exactly the shortfall. You can see the guaranteed output, the fee and Mezo's oracle price. One exact approval, one swap. These are separate transactions, and the app says so. Now the payment. Its calldata carries this invoice's ID; there it is on the explorer. The receipt page re-checks everything from the chain, with no wallet needed." · **ALT (if no signed payment exists yet):** stop at the wallet prompt and say "The wallet is asked to sign exactly this calldata; our tests prove it. We haven't recorded this payment on-chain yet, so I won't show one." |
| **1:30–1:45** · Mezo integration and evidence | Merchant dashboard: **Paid · verified**, totals, proof icon → Overview: Mezo position card (PriceFeed price, trove health, borrowing preview) → terminal: `npm run verify:evidence` printing PASS lines | "The merchant's dashboard updates only after our server re-reads the chain. Cambio also reads Mezo's PriceFeed and trove health, and previews borrowing MUSD against BTC. Every transaction we cite re-verifies with one command." |
| **1:45–2:00** · Business, team, why it matters | Merchant Pro card (9 MUSD / 30 days, "Testnet pilot") → end card: track, team, links | "Merchants can subscribe to Merchant Pro, paid in MUSD from their own wallet and verified on-chain. We take no fee from payments. This is testnet, so it proves the mechanism, not revenue. Cambio lets anyone holding Bitcoin pay a dollar invoice on Mezo, with proof. Track 2, solo builder Lushegs. Links below." |

**End card text:**
- Cambio · Track 2 — Access & Distribution · Lushegs (solo)
- cambio-five.vercel.app · github.com/Lushegs01/cambio
- Mezo Testnet · test funds · not audited

**Never say or show:**
- customers or users (unless the pilot really happened, with numbers from `pilot:metrics`);
- revenue;
- an audit;
- mainnet;
- "atomic";
- custom contracts;
- any fiat or naira conversion (there is no such product).
