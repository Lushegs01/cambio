# Cambio security report (Wave 2)

Updated 2026-11-08. This supersedes `docs/SECURITY_REVIEW.md` (2026-11-05); its findings 1–5 remain fixed and are carried forward.

**Status:**
- This is a targeted engineering review by the implementation agent. It is **not an independent audit**, and nobody has audited Cambio.
- Mainnet is disabled.
- Passing CI is not treated as proof of security.

## Scope

- The payment, Fund & Pay and proof-viewer paths in the browser.
- The invoice registry, merchant sessions and Merchant Pro billing in the API.
- The Firestore rules.
- Production dependencies.
- The live deployment's headers.

## Findings in this pass

| # | Severity | Finding | Fix | Evidence |
| --- | --- | --- | --- | --- |
| W2-1 | **High** (funds) | The payment page kept **Pay enabled** while a known payment hash was pending ("not found yet") or unreadable (RPC error). A payer who saw "Transaction not found yet" could pay a second time. The same applied to `?tx=` links | Pay is disabled whenever a payment is in flight. Only a reverted or mismatching hash re-enables it. The button reads "Payment pending — waiting for the network" | e2e `a refresh while a payment is pending …` (failed before the fix, passes after) |
| W2-2 | Medium (integrity of records) | A refresh during a pending payment lost the hash in the page, so the payer saw an unpaid invoice | The hash is recovered from the device ledger (bound by request id, recipient, token and amount), and the page re-checks it automatically | `tests/paymentJourney.test.ts`, the same e2e |
| W2-3 | Medium (reliability) | Registry notification after payment used `.catch(() => undefined)`. A 404 (tx not yet visible) or 409 (confirmations) silently left the merchant's dashboard unpaid | Notification happens only after on-chain confirmation, retries the conditions that can resolve by waiting, and stops on 422/400/401. The result is shown to the payer | `tests/paymentJourney.test.ts` |
| W2-4 | Medium (assurance) | The scheduled live CI failed. Evidence reads did not retry transport errors, and the not-found retry budget was too short for the load-balanced public RPC | `retryRead()` retries not-found and transient errors (timeouts, 429/5xx, socket errors) on a longer schedule; reverts and malformed requests fail fast. A scan that cannot read a transaction now says the absence is **not proven** | `tests/evidence-discovery.test.ts`; `npm run test:live` 7/7 |
| W2-5 | Low (UI) | The SendModal "signed by the recipient" banner would have been **false** for a server-issued subscription order | The locked-payment notice is per use; orders state that the server fixed the recipient, amount and order id | e2e Merchant Pro |

## New surface and its controls

| Threat | Control | Test |
| --- | --- | --- |
| **Granting yourself Merchant Pro** | Entitlement is written only by `BillingService` after `verifyPaymentTx`. Firestore rules deny all browser access to `billing_*` | Emulator rules test: client writes to `billing_subscriptions` are denied |
| Paying the wrong amount or treasury, a plain transfer, a revert, or a transaction older than the order | All are rejected with 422; `proUntil` is unchanged | `tests/billing.api.test.ts` |
| Reusing one payment for two orders | The order id is bound in the calldata, plus a `billing_payments/{tx}` uniqueness record; the result is `tx_used` | Store contract (memory, SQLite, Firestore emulator) |
| Double activation under concurrency | Atomic `activateOrder`: Firestore transaction, SQLite `BEGIN IMMEDIATE`, synchronous memory store | Store contract: 3 concurrent activations → 1 |
| Another merchant submitting or reading your order | Every billing route requires a SIWE session; orders are visible only to their merchant (404 otherwise) | API test |
| Silent fees | No fee in the payment path; billing is off without `PRO_TREASURY_ADDRESS`; a subscription is a separate, explicit wallet transfer | Code review; UI text |
| Invalid billing configuration | Fails closed. Billing is disabled and logged by variable name only; identity and invoices keep working | `billingConfigFromEnv` tests |
| Proof viewer fooled by the registry | The registry is only the payload source. The browser re-verifies the EIP-712 signature and the settlement; a request with a different id or recipient is refused | `tests/proofViewer.test.ts` (altered amount → failed) |
| Secrets in proof links | Proof links carry only the recipient address and the random request id, never a session token | Route regex rejects extra parameters; e2e asserts this |
| CSV formula injection in the report | `csvCell` quotes every field and prefixes `=+-@` | API test with a `=HYPERLINK(...)` note |
| Embeddable button XSS | It is a plain `<a>`; all attributes and the label are HTML-escaped; no script or iframe | `tests/share.test.ts` |

## Payment-security matrix (brief §6C)

| Attack | Result | Where tested |
| --- | --- | --- |
| Edited invoice amount or recipient | Signature check fails, so no Pay button | e2e tampered link; unit |
| Invalid or wrong-signer EIP-712 signature | Rejected (browser, server, CLI) | unit, API |
| Expired request | Not payable; a late payment is labelled `paid_late` | e2e, unit |
| Unsupported chain id or wrong token | Rejected at parse | unit |
| Malformed calldata or wrong request id | Not a settlement (422 / FAIL) | unit, API, live e2e with a real transfer |
| Replay or double payment | Detected and recorded as a duplicate; **not preventable on-chain** with ERC-20 `transfer`. Before Pay: registry hint plus chain scan; during a pending payment: Pay disabled | unit, e2e |
| Forged "paid" confirmation | Impossible through the API: hash only, and the server re-reads the chain | API |
| Unauthorized merchant listing or billing | 401 without a session; sessions expire after 24 h; tokens are stored as SHA-256 | API |
| Session/SIWE replay | Single-use nonce, 5-minute expiry, bound to domain, URI, chain and statement | API |
| Cross-origin calls | Requests with a foreign `Origin` get 403; no wildcard CORS | API; production probe (`origin_not_allowed`) |
| Request id collision | `(recipient, id)` keyed; different content → 409; 128-bit random ids | store contract |
| Receipt inconsistency (node disagreement) | A missing receipt is retried; "not found" never becomes "unpaid" or "failed" | unit |

**Off-chain vs on-chain enforcement, stated explicitly:**
- Signature validity, settlement verification and entitlement are enforced by **verifiable computation over chain data**.
- Invoice single use and the absence of duplicates are **off-chain detection only**.

## Dependency audit (re-run 2026-11-08, `npm audit --omit=dev`)

The result is **15 advisories (11 high, 4 moderate)**: the same set as on 2026-11-05.

| Package path | Advisory | Exploitable in Cambio? | Fix available? |
| --- | --- | --- | --- |
| `zod` < 4.6.6, via `@reown/appkit-wallet` (zod 3.22.4) and `@base-org/account` → `@coinbase/cdp-sdk` (zod 3.25.76, abitype 1.0.6) — the root of all 11 "high" entries | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): memory exhaustion when validating oversized constrained collections | **Low.** Only in the browser bundle, inside wallet SDKs validating wallet/SDK messages. The worst case is a tab crashing on input that the wallet connector supplies. The API server does not import these SDKs | **No compatible release.** The patched line is zod 4, a breaking API that these SDK versions do not support. Forcing an override risks breaking wallet connection, which e2e cannot fully cover (real WalletConnect paths) |
| `glob`/`minimatch`/`rimraf` via `firebase-admin` → `@google-cloud/firestore-api` → `google-gax@5` | GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249 (moderate) | **No.** They need attacker-controlled glob patterns or AbortSignals; Cambio never passes user input to them | Only via a google-gax major upgrade inside firebase-admin |

**Mitigations in place:**
- A strict CSP (script-src `'self'`; connect-src allow-list).
- A lockfile.
- No server-side use of the affected SDKs.
- CI fails on any **critical** advisory and prints the rest.

**Not fixed. Re-check each release.**

## Live deployment headers (2026-11-08)

`curl -I https://cambio-five.vercel.app/` shows:
- `content-security-policy` with `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'none'`;
- `strict-transport-security: max-age=63072000; includeSubDomains; preload`.

The API answers `no-store`, rejects a foreign `Origin` with 403, and requires a session for listing (401).

## Residual risks (open)

1. **No independent audit.** Testnet only.
2. **Wallet-SDK advisories** (above).
3. **Single-use invoices are best-effort.** Enforcement needs an audited checkout contract.
4. **XSS would expose the merchant session token** in `localStorage` (24 h; read-only listing plus billing order creation, which cannot move funds). The CSP blocks inline and third-party scripts.
5. **Public RPC trust.** Verification trusts `rpc.test.mezo.org`; a second independent RPC would add assurance.
6. **Distributed registry spam.** Per-IP limits do not stop many keys; a WAF is needed before public scale.
7. **Subscription refunds or disputes** have no flow; testnet only.
8. **Look-alike usernames.** The full address is always shown on review.
