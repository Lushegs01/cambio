# Security review (Wave 2, 2026-11-05)

Scope: the payment, swap, Fund & Pay, invoice-registry and identity paths in this repository at the commit that adds this file. This is a **targeted engineering review by the implementation agent, not an independent audit.** No third party has audited Cambio. Mainnet stays disabled.

## Findings fixed in this wave

| # | Severity | Finding | Fix | Evidence |
| --- | --- | --- | --- | --- |
| 1 | High (correctness) | The public Mezo testnet RPC returned `null` for 25–33% of receipt reads for **mined** transactions. A paid request could show "not found", and `reconcileLedger` downgraded *confirmed* ledger entries to *unknown*. | `src/lib/rpcRetry.ts` retries "not found" (300/800/1500 ms) before concluding. Applied to proof verification, ledger reconciliation and the evidence verifier. | Measured 8/12 and 9/12 receipt reads; `tests/evidence.test.ts` |
| 2 | High (correctness) | Settlement discovery read only the explorer's first page (50 transfers) and 10 candidates, then reported **unpaid**. | Pages back to the request's `createdAt`; RPC log-scan fallback; an `incomplete` state means *unknown*, never *unpaid*. | `tests/reconciliation.test.ts` (payment on page 3 is now found) |
| 3 | Medium (assurance) | No test proved the request-id calldata suffix reaches the wallet. On-chain evidence showed no suffixed payments. | The e2e test wallet records `eth_sendTransaction`; the test asserts exact calldata `transfer ‖ CMB2 ‖ id`. | `tests/e2e/app.spec.ts` |
| 4 | High (dependency) | `follow-redirects` 1.16.0–1.16.1 (via `@coinbase/cdp-sdk` → axios). | Non-breaking `npm audit fix` → 1.16.2; also patched `glob`/`minimatch`. | `npm audit --omit=dev` |
| 5 | Low | Lint-level defects: a `throw` inside `finally` in a test, dead code, hook dependency issues. | Real ESLint, zero warnings, enforced in CI. | `npm run lint` |

## New surface added in this wave and its controls

| Threat | Control |
| --- | --- |
| Forging an invoice "paid" status | The API accepts only a tx hash. The server re-reads the tx, receipt and block and applies `verifySettlement` (exact calldata with request ID, recipient and amount; success; `Transfer` event; block time; chain), plus the confirmation policy. |
| Occupying another merchant's request ID | Invoices are keyed by `(recipient, id)`. Storing requires the recipient's EIP-712 signature, so an attacker can only store under addresses they control. Same ID with different content under the same recipient → 409. |
| Enumerating a merchant's invoices (amounts, notes) | Listing requires a SIWE merchant session. The token is 32 random bytes, stored only as SHA-256, expires after 24 h, and is sent as a bearer header (not a cookie, so no CSRF). |
| Burning someone's sign-in challenge | The signature is verified **before** the challenge is consumed; consumption is atomic (tested under concurrency on all three stores). |
| Replaying a session challenge | Single use, 5-minute expiry, domain/URI/chain/statement bound (`validateSiweMessage`). |
| Registry spam | Separate 30/min per-IP limit for invoice writes, a cap of 1,000 invoices per recipient (atomic counter in Firestore), and a 4 KB body limit. |
| Paying a request twice | Before Pay is enabled: a registry hint plus an on-chain scan, with any hit re-verified on-chain. Duplicate payments the server sees are recorded and flagged. **On-chain single use is not enforceable with a plain ERC-20 transfer** (see below). |
| Swap approvals in Fund & Pay | Exact amount only; fresh re-quote; `simulateContract` before the prompt; router-enforced minimum; 20-minute deadline; 30 s quote TTL; >15% impact refused. |
| Stale oracle shown as live | A `PriceFeed` revert is displayed as stale or unavailable; there is no off-chain fallback. |
| Client reads of server-only data | Firestore rules deny `invoices`, `invoice_owners`, `merchant_challenges` and `merchant_sessions` (emulator rules test). |

## Checklist status

**Wallet and transaction:**
- Chain and account are re-asserted immediately before every wallet prompt, so switching between review and confirm is caught.
- Unsupported networks hide balances and offer a switch.
- Expiry is re-checked before the prompt.
- Double submits are blocked by synchronous locks.
- Receipts plus `Transfer` events are required for "confirmed".
- RPC failure means *unknown*.
- Contract-wallet signatures are verified via ERC-1271/6492.
- Insufficient gas is checked against an `estimateGas` of the exact calldata.

**Backend:**
- SIWE nonces are single use and expire after 5 minutes.
- Username claims are atomic (tested with 8 concurrent wallets on the emulator).
- Strict input validation; JSON limited to 4 KB; `no-store`.
- No wildcard CORS; `Authorization` is allowed only for explicitly allow-listed origins.
- Trusted-proxy hop count is configurable.
- Error responses never include stack traces.
- Initialization errors are logged without credential contents.

## Residual risks (open)

1. **No independent audit.** Do not use with significant funds. Mainnet is disabled by default.
2. **Wallet-SDK supply chain.** 11 high-severity advisories remain, all via Zod 3 inside Reown AppKit / Coinbase CDP SDK packages, with no compatible fixed release published as of 2026-11-05. A restrictive CSP, disabled Coinbase/Base connectors and the lockfile reduce exposure. Re-check with `npm audit --omit=dev`.
3. **Single-use invoices are best-effort.** A payer can always send the same calldata twice, or use another wallet. Cambio detects and flags it but cannot block it. Enforced single use needs an audited checkout contract (see `KNOWN_LIMITATIONS.md`).
4. **XSS would expose the merchant session token** stored in `localStorage`. Impact is read-only listing for up to 24 h. The CSP blocks inline scripts and third-party script origins.
5. **Explorer trust for discovery.** History and "Check paid" candidates come from Blockscout, but every candidate is re-verified by RPC.
6. **Public RPC trust.** Verification trusts the configured Mezo RPC. A dedicated or second RPC would add independence.
7. **Registry abuse at scale.** Per-IP limits do not stop a distributed attacker generating many keys. A WAF is needed before public scale.
8. **Large contract-wallet signatures.** ERC-6492-wrapped signatures above roughly 3.5 KB exceed the 4 KB body limit, so the invoice is not stored (the link still works).
9. **Look-alike usernames** (`0`/`o`, `1`/`l`). The review screen always shows the full address.
