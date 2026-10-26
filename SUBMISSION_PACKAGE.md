# Cambio submission material

Prepared 2026-10-26. This is a draft for the team to review and enter manually. No submission, registration or terms acceptance was performed.

## Verified event requirements

The interactive [AKINDO event page](https://app.akindo.io/wave-hacks/OVOO0gdrVU8379D10) requires MUSD/MEZO integration, a working supported-chain deployment (Mezo testnet accepted), a public source repository, a product deck and a two-minute pitch video. It asks for product/category, summary, operation, audience, stack, track, chain, project status/readiness, milestones and team details. Its scoring weights are integration 30%, product/business 30%, implementation 20%, UX 10%, materials 10%. Team registration, Discord membership and eligibility/terms are operator responsibilities. Confirm the deadline timezone in the portal.

## Form draft

**Name:** Cambio

**Category:** Verified MUSD payment requests

**TL;DR:** Cambio helps MUSD users pay verified usernames, authenticate signed payment requests and independently check settlement on Mezo.

**Problem and operation:** Copying wallet addresses is error-prone, and screenshots provide weak payment evidence. A recipient proves wallet ownership with a server-verified SIWE signature, then signs an EIP-712 payment request. The payer verifies that signature, reviews the full recipient, amount, token contract and gas estimate, and approves an MUSD transfer in their wallet. Cambio verifies the receipt and matching Transfer event. A shared proof checks exact calldata with the signed request ID. The application never holds private signing keys.

**Audience:** People and small businesses already using MUSD, especially those sharing payment links across desktop and mobile. This is the product hypothesis, not a claim of established customers or regional adoption.

**Stack:** React, Vite, TypeScript, Express, Reown/wagmi, viem, Firebase Admin/Firestore, Vitest, Firebase emulator and Playwright. No new smart contract was deployed by this task.

**Track:** Track 2, Access and Distribution. Swaps integrate the existing Mezo router but are secondary to the payment experience.

**Chain:** Mezo Testnet, chain 31611. Mainnet remains disabled.

**Project status:** Existing Cambio repository with release hardening and regression coverage added during this review. The team must supply its actual development dates and attribution. Do not describe this work as a fresh project without checking that history.

**Readiness:** Public deployment and durable Firestore availability are verified as of 2026-10-26. Local typecheck, lint, build and 173 unit/integration/UI tests pass; the earlier production browser suite passed 18 tests and emulator suite 14. Actual wallet-approved testnet payment/proof evidence, a public matching source repository and the final video/materials remain incomplete. This is not a mainnet release or independent audit.

**Source:** The current deployment uses https://github.com/Lushegs01/cambio at `c690ae489f262f3cae62712d4b01f541bbd374e6`, currently **private**. The earlier https://github.com/CaNoN-0/Cambio is public. Before submitting, provide public source matching the deployed code by publishing the current repository or updating an authorized public mirror. Do not claim that the current private repository satisfies the public-source requirement.

**Live application:** https://cambio-five.vercel.app. Homepage and direct routes return 200; `/api/health` reports HTTP 200 with available, durable Firestore identity. Read-only evidence is in `audit-evidence/submission-live-2026-10-26.json`.

**Deck:** `submission/Cambio-pitch-deck.pdf`, a six-slide draft with explicit verification limits. Review/update its earlier deployment and status statements before upload; this readiness check did not regenerate the PDF.

**Video:** NOT RECORDED. Use the script below after the deployment and real testnet transaction exist. Do not replace missing explorer evidence with a simulated hash.

**Proposed milestones for team approval:** Before submission, complete the two-wallet testnet proof, public matching source and demo materials. During the following development wave, validate mobile wallets and a small merchant pilot if the team chooses to pursue one. Before any mainnet release, resolve/review dependency risks, improve recovery/index coverage and obtain an independent security review. These are proposals, not commitments already made by the user.

**Team:** The operator must enter actual names, roles and profile links. None were invented.

## Two-minute recording script

Times are an editing guide, not measured performance. Record the actual UI and use short cuts between wallet confirmation and the mined receipt if needed.

**0:00-0:15, product and user problem:** “Cambio is a non-custodial MUSD payment application on Mezo. It helps people and small businesses request payment without repeatedly copying long addresses or treating a screenshot as proof.”

**0:15-0:35, verified identity:** “The recipient connects a testnet wallet and claims a username. The wallet signs a message naming this site and the username. The backend verifies ownership and saves the mapping atomically. Here are MUSD and native BTC balances, read separately.”

**0:35-0:55, request authenticity:** “The recipient signs this payment request. The signature binds the address, amount, token, network, request ID and expiry. Another browser checks the signature before offering payment. Editing a signed field causes verification to fail.”

**0:55-1:25, real transfer:** “The payer reviews the full recipient, MUSD contract, network and estimated BTC fee, then approves the transfer in their wallet. This is the actual testnet transaction. Cambio waits for its receipt and matching MUSD Transfer event.”

Only say the previous two sentences after recording a genuine broadcast and matching receipt. Otherwise replace them with: “Live preflight is tested, but we have not yet demonstrated an actual wallet-approved payment. That remains a release blocker.”

**1:25-1:45, independent proof:** “The payment includes the request ID in its calldata. The recipient opens this proof link independently. Cambio checks that exact input, chain, successful receipt, Transfer event and block time. History labels explorer data as indexed.”

Only show a paid proof after it genuinely verifies. Otherwise explicitly state that proof demonstration is blocked.

**1:45-2:00, status:** “The latest local checks passed 173 unit, integration and UI tests; earlier runs passed 14 Firestore emulator tests and 18 production browser tests. The public app now reports healthy, durable Firestore storage. The application has no independent audit, and remaining wallet-SDK dependency risks are documented.”

Before uploading, recheck the final test counts, include the real public app/source URLs and record the actual limits that still apply. The user must approve all factual team and milestone statements.
