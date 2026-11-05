# Roadmap after Wave 2

The official Mezo Buildathon has two waves; there is **no Wave 3**. This is Cambio's plan after the Wave 2 submission, written for a solo developer. Dates are targets, not commitments made to anyone.

## Milestone 1: proof and pilot (by 2026-12-15)

- Record and publish the signed-request settlement proof (`submission/evidence/signed-payment-settlement.md`).
- Merge, redeploy, deploy the Firestore index and TTL policies, and confirm `/api/health`.
- Run the 3–5 merchant testnet pilot. Publish `pilot-metrics.json` with transaction hashes.
- Run 10 problem interviews and 5 usability sessions. Publish the anonymised synthesis.
- **Exit metric:** at least 30 verified settlements from at least 15 payers, and at least 3 merchants saying they would pay.

## Milestone 2: merchant value (by 2027-02-15)

- Merchant Pro billing via Cambio's own signed invoices, gated by a server-verified settlement. Needs owner approval of the treasury address.
- Invoice reminders and payment notifications (email or Telegram) and signed webhooks for merchants.
- Telegram bot that creates signed requests and shares links (Track 2 distribution).
- Embeddable "Pay with MUSD" button that opens the signed request page.
- **Exit metric:** at least 5 paying Pro merchants on testnet billing, or a documented decision to change pricing.

## Milestone 3: enforceable settlement and mainnet readiness (by 2027-05-15)

- Design a minimal checkout contract: single-use request IDs, optional fee split, events for indexing. Get an independent audit before any deployment.
- Optional executable borrowing route (BorrowerOperations `openTrove` with HintHelpers hints), only after a risk review and with explicit wallet-step disclosures.
- Dedicated RPC plus a second independent RPC for verification; WAF in front of the API.
- Resolve or replace the wallet-SDK dependency advisories.
- Mainnet launch only after the audit and a security review sign-off.

## Not planned

- Fiat off-ramps or naira conversion.
- Custodial balances of any kind.
