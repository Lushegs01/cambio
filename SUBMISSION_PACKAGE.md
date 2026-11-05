# Cambio: Wave 2 submission draft

Prepared 2026-11-05 from the official AKINDO event data (`app.akindo.io/wave-hacks/OVOO0gdrVU8379D10`) and the Mezo announcement. **Nothing has been submitted.** The owner reviews and enters this manually.

## Verified requirements and dates

- **Hard requirements:**
  - MUSD and/or MEZO integration;
  - a working deployment (Mezo testnet accepted);
  - developed during the hackathon, or a new extension;
  - extends MUSD/MEZO utility.
- **Submit:** live link, **public** GitHub repo (`Lushegs01/cambio` is public, checked 2026-11-05), product deck, **2-minute** pitch video.
- **Wave 2 resubmissions:** "be explicit about what changed since Wave 1". Use `submission/WAVE_2_REPORT.md`.
- **Judging:** Mezo Integration 30%, Product & Business Viability 30%, Technical Implementation 20%, User Experience 10%, Submission Materials 10%.
- **Deadline:** the event text says Wave 2 runs "November 2 – November 15, 2026". However, the platform's own Wave 2 `submissionDeadline` field reads **2026-11-13T05:30 UTC**. **Submit before 2026-11-13 05:30 UTC** to be safe, and confirm in the AKINDO UI.
- Eligibility: 18+, not in a prohibited jurisdiction, Terms of Participation accepted, KYB for payout. These are the owner's responsibility.

## Form fields

**Project name:** Cambio

**Project category:** Verified MUSD payments and invoicing

**TL;DR:** Cambio lets merchants send wallet-signed MUSD invoices that customers can pay from any wallet, even with only BTC, and that anyone can verify as settled on Mezo.

**How it works:**
- The merchant claims a `@username` (server-verified SIWE signature) and signs an EIP-712 invoice that binds the recipient, amount, MUSD token, chain, request ID and expiry.
- The customer's browser verifies the signature and checks that the invoice has not already been paid.
- If the customer is short on MUSD, **Fund & Pay** sizes a BTC→MUSD swap on Mezo's MUSD/BTC pool for exactly the shortfall. It shows the router-guaranteed output, fee, slippage and the Mezo PriceFeed value. It asks for an exact approval and the swap, each as a separate wallet prompt.
- The payment is `MUSD.transfer` with the request ID appended to the calldata. Cambio waits for the receipt and the matching `Transfer` event.
- The merchant's invoice registry records the settlement only after the server re-reads the chain. Anyone can verify the proof link.
- Cambio also reads Mezo's **PriceFeed**, **TroveManager** (trove health, ICR, Recovery Mode) and **BorrowerOperations** (read-only borrowing preview).
- It is non-custodial and has no custom contracts: it composes Mezo's MUSD, Router, pools, PriceFeed and trove contracts.

**Target group:** Crypto-native freelancers, small studios and Mezo-ecosystem merchants who want dollar-stable payments with proof. Their payers are BTC holders on Mezo who need to pay a dollar amount. Desktop and mobile web (MetaMask, Rabby, WalletConnect). This is the product hypothesis; user research has not started yet.

**Tech stack:** TypeScript, React 19, Vite, Tailwind, Reown AppKit, wagmi, viem, Express, Firebase Admin / Firestore (or SQLite self-hosted), Vitest, Playwright, ESLint, GitHub Actions.

**Track:** Track 2, Access and Distribution.

**Chain deployed on:** Mezo (testnet, chain 31611). Mainnet is disabled.

**Project status:** Existing project (Wave 1) with new features added during Wave 2. See `submission/WAVE_2_REPORT.md`.

**Project readiness:** Testnet deployment.

**Future milestones** (from `submission/WAVE_3_ROADMAP.md`):
1. By 2026-12-15: signed-settlement proof, a 3–5 merchant pilot with chain-derived metrics, and 10 user interviews.
2. By 2027-02-15: Merchant Pro billing via signed invoices, reminders and webhooks, and a Telegram bot.
3. By 2027-05-15: an audited checkout contract for enforced single-use invoices and fees; mainnet only after review.

**Team info:** Lushegs, solo developer (product, design, engineering). GitHub: https://github.com/Lushegs01. *Owner to add X or LinkedIn.*

**Links:**
- Live: https://cambio-five.vercel.app. Redeploy the Wave 2 build before submitting.
- Repo: https://github.com/Lushegs01/cambio
- Deck: `submission/CAMBIO_FINAL_PITCH_DECK.pdf`
- Video: *to record* (`submission/DEMO_SCRIPT.md`)

**On-chain evidence to cite:**
- MUSD transfer: https://explorer.test.mezo.org/tx/0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e (PASS)
- BTC→MUSD swap: https://explorer.test.mezo.org/tx/0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e (PASS)
- Signed-request settlement: **pending**. Add it only after `npm run verify:evidence` returns PASS.

## Owner checklist before submitting

- [ ] Merge and redeploy; confirm `/api/health` shows invoices available
- [ ] Deploy the Firestore index and TTL policies
- [ ] Record the signed-request payment, verify it (PASS), and update the evidence files, README and deck
- [ ] Record the 2-minute video (`submission/DEMO_RECORDING_GUIDE.md`)
- [ ] Add social links to the team info
- [ ] Submit before **2026-11-13 05:30 UTC**
