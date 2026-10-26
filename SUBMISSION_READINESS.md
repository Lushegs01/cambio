# Cambio submission readiness

**Verdict: NOT READY for submission.** All seven requested test/build scripts passed, but a working public deployment with durable identity and a real wallet-approved testnet payment/proof remain essential, uncompleted gates. During the audit, no deployment, push, contract deployment, production-data mutation, mainnet enablement or transaction broadcast was performed. After the audit, the user authorized committing and pushing the reviewed changes; that source publication does not complete the remaining release gates.

**2026-10-26 deployment follow-up:** the user subsequently supplied https://cambio-rho.vercel.app and authorized backend deployment. Its frontend returned 200, but API and direct `/app/activity` routes returned Vercel 404 responses. This revision adds the Node API function, explicit API/SPA routing, CDN security headers, server-only Firebase credential support, and compiled-Node startup regression coverage. See [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md). The connected Vercel account cannot access the owning team (403; authorization recovery returned team not found). Firebase runtime credentials/IAM therefore remain unverified; a healthy durable registry and live payment proof are still required. The original audit evidence below retains its original date and scope.

**Observed live result:** Vercel successfully deployed `f7e3911224b22efe236e9b1ee2449602e98113a5`. The public homepage, built JavaScript and `/app/activity` returned 200 with CSP; an unknown API route returned Express 404 JSON. `/api/health` returned 503 JSON, `identity.available=false`, `identity.durable=false`, and `Firestore identity store could not be initialised.` The API routing blocker is fixed; the identity backend is still not ready. `audit-evidence/vercel-public-health.json` preserves these responses. The follow-up suite passed 152 unit/integration, 14 emulator and 18 browser tests plus typecheck/lint/build/read-only chain checks; those local passes do not establish healthy production credentials.

**Self-hosting follow-up (2026-10-26):** the user selected hosting the app and database themselves. An optional, durable SQLite registry and Docker/Caddy package now support that path without Firebase credentials. A local instance at `http://localhost:3100` returned HTTP 200 with `kind=sqlite`, `available=true`, `durable=true`. See [SELF_HOSTING_READINESS.md](SELF_HOSTING_READINESS.md) for 167 unit/integration tests, 14 emulator tests, 18 SQLite browser tests, real-disk restart/nonce/backup evidence and the verifier latency fix. A server/domain has not yet been obtained; Docker/WSL is unavailable here. Public self-hosting, TLS, container/volume verification and the live human-wallet payment/proof remain incomplete. The existing Vercel Firestore configuration was not changed.

Test/audit runs: **2026-10-25**. Handoff and source-publication authorization: **2026-10-26, Africa/Lagos**. Audited base: **`bea064ab58384703cc2a4e51470d5888afe2b80b`**, branch `main`, repository https://github.com/CaNoN-0/Cambio. The starting workspace contained no checkout. A fresh clone was clean; there was no uncommitted user work to discard. The base SHA identifies the code before these fixes. Review the commit containing this report against that base for the complete changes and evidence.

## Scope and trust boundaries

The inspection covered React startup and navigation, all payment/identity/swap/activity surfaces, wallet configuration, exact integer arithmetic, EIP-4361 and EIP-712 construction and verification, receipt recovery and request settlement, Express routes and production serving, Firestore stores/rules/configuration, rate limiting, FX services, browser storage, dependency manifests/lockfiles, tests, metadata and deployment instructions.

| Surface | Implementation and boundaries | Evidence / limits |
| --- | --- | --- |
| Landing, overview, sidebar, settings, notifications and themes | React SPA; path/hash navigation; local preferences; notifications describe local wallet/transaction events | Browser tests and unit UI tests; no claim of a full assistive-technology audit |
| Wallet connection and balance card | Reown/wagmi, injected EIP-6963 wallets and WalletConnect; explicit testnet RPC; native BTC and ERC-20 MUSD reads are separate | Live read-only browser checks; mobile wallet pairing still requires a human device and a project ID owned by the deployer |
| Send / review / transaction status | Resolve recipient, parse base units, check account/network/balances, estimate exact calldata gas, review, wallet approval, receipt/event verification, unknown-outcome recheck | Deterministic executors and UI tests plus live preflight up to rejection; no real broadcast |
| Username/profile | Same-origin API issues SIWE challenge; wallet signs; backend verifies; atomic nonce consumption and username/reverse mapping update | Real EOA signatures in HTTP/browser tests; Firestore emulator concurrency tests; live cloud persistence and contract-wallet signatures not demonstrated |
| Request creation / QR / sharing / pay page | EIP-712 signed payload; strict Base64URL/shape validation; recipient/amount/token/network/id/memo/times bound; unsigned legacy links explicitly warned | Real disposable-key signatures, tamper tests and browser request generation/navigation; mobile native share sheet is manual |
| Settlement | Exact `MUSD.transfer` input plus `CMB2` + 16-byte ID; correct chain, successful receipt, exact Transfer event and readable block time; signature must verify before showing a proof | Deterministic adversarial tests; read-only live suffix simulation; actual settled request/proof is BLOCKED |
| Swap | Three configured direct MUSD pools; router quote/probe, on-chain fee, slippage minimum, exact approval, fresh quote, simulation, wallet transaction, input/output receipt evidence | Deterministic state tests, live quotes and rejected wallet prompts; no real swap/approval broadcast |
| Activity and CSV | Explorer index, RPC logs over up to 10,000 blocks, per-device ledger; indexed activity distinguished from independently verified request settlement | Parser/reconciliation tests; history is partial, and explorer data is not independently verified settlement |
| FX | CoinGecko/Coinbase BTC reference, exchange-rate providers, $1 stablecoin peg estimates | Display only; stale/unavailable providers remain external dependencies; testnet pool quotes are not market prices |
| Demo | Simulated balances/history/transfers, separated and labeled; swaps disabled | No generated demo hash is treated as blockchain evidence |
| Database | Admin SDK writes; clients denied writes/listing; public exact-document registry reads; legacy collections closed | Rules and store/API tests use only demo emulator projects; deployed rules/IAM not inspected |
| Production | One Express process serves built Vite assets and API; canonical-origin/proxy validation; CSP/security headers | Local production smoke; missing Google credentials truthfully produce identity 503 |

The browser trusts the deployed application and wallet SDK supply chain. User signatures authorize operations; the server never holds signing keys. Firestore Admin credentials are privileged and bypass rules. RPCs and the explorer are external data sources, not cryptographic light-client proofs. Username verification is server attestated wallet ownership, not an on-chain identity contract or legal identity certification.

## Defects repaired and regression coverage

| ID / priority | Root cause and repair | Regression evidence |
| --- | --- | --- |
| PAY-01 / P0 | Unknown-transfer recheck and local ledger reconciliation upgraded a successful receipt without validating the intended token event. Shared receipt evidence now checks exact token/sender/recipient/amount; missing evidence stays unknown. Cached confirmations are revalidated. | `tests/release-ui.test.tsx`, `tests/release-safety.test.ts`, existing `musdTransfer.test.ts` |
| SWAP-01 / P0 | Swap execution called a successful receipt confirmed even when no output arrived. Require exact input spent and positive output at least the reviewed minimum; otherwise unknown. | `release-safety.test.ts`; swap happy-path fixture strengthened to include actual input evidence |
| SWAP-02 / P1 | Price-impact restriction existed only in the UI; unknown impact was permitted; account could change during asynchronous simulation. Executor enforces known impact <=15%, positive minimum and connection recheck after simulation. | `release-safety.test.ts`, `swap.test.ts` |
| PROOF-01 / P1 | Settlement tolerated missing chain/time, could accept a payment before request creation, and did not check returned transaction hash. Require known matching chain, requested hash and readable block time; expiry boundary is inclusive. Indexed candidates whose RPC proof is unavailable are unknown, not unpaid. | `release-safety.test.ts`, `paymentRequest.test.ts` |
| PROOF-02 / P1 | A notification latch prevented proof generation when an unknown payment later confirmed. Notify once per changed terminal outcome, allowing confirmed recovery to publish the proof link. | `ui.test.tsx`: unknown -> confirmed request proof |
| LINK-01 / P1 | Hash navigation reused the previous recipient/proof state. Key the payment surface by parsed link and rerun verification. Refuse duplicate parameters and signed-payload removal; request creation now applies the same shape checks as parsing. | `release-safety.test.ts`, e2e hash navigation/refresh |
| TIME-01 / P1 | An open request page did not update expiry with time; a request could expire during preflight before the wallet prompt. Add a clock, block future-created requests and recheck request times in the executor immediately before prompting. | `musdTransfer.test.ts` expiry-during-preflight, existing expiry/link tests |
| ACCOUNT-01 / P1 | Confirm rebuilt transfer parameters from the latest account instead of the reviewed account. Preserve reviewed parameters and force review after account/network change. Request signing has a synchronous lock and rejects results after a wallet change. Username completion cannot update an unmounted prior wallet dialog. | `ui.test.tsx` payer-account regression; existing duplicate-click and connection tests |
| DATA-01 / P1 | In-flight history/quote responses could repopulate after disconnect/input changes. Invalidate sequences during cleanup/disabled inputs, scope results to account/network and reject quote/input mismatches. | `release-ui.test.tsx` stale quote and previous-wallet history |
| ID-01 / P1 | SIWE metadata was not fully compared to stored authorization, and expiry used a timestamp taken before potentially slow signature verification. Check URI/version/chain/times/action text and use current commit time. Reject unsupported/mainnet challenges and hide records from disabled chains. | `server-security.test.ts`, existing replay/domain/tamper/race API tests |
| ID-02 / P1 | Firestore record parser promoted arbitrary record data to proof `siwe`; emulator storage reported durable. Require actual proof/valid fields/key agreement; report emulator non-durable and refuse it by default in production. | Emulator `firestoreStore.test.ts`, bootstrap tests |
| API-01 / P1 | Limits were per instance; proxy hop strings were not converted to numbers; untrusted origins were not explicitly rejected. Add atomic Firestore shared counters, fail closed on limiter errors, numeric trusted-hop parsing with direct-host default 0, and explicit origin rejection. | Emulator independent-store shared-limit race; `server-security.test.ts`; existing API rate-limit tests |
| HTTP-01 / P1 | Missing CSP/frame protection; inline theme bootstrap incompatible with strict CSP. Serve theme script externally and add CSP, no-referrer, frame denial, permissions/nosniff headers and HTTPS HSTS. Disable Coinbase/Base SDK connectors that automatically injected inline telemetry; extensions and WalletConnect remain. | Production e2e CSP/runtime checks and server-header tests; browser evidence records initial CSP failures and source trace |
| BOOT-01 / P1 | Theme and wallet SDK module initialization could crash when localStorage was denied. Bootstrap SDKs after installing a labeled session-memory Storage fallback; theme still works without persistence and restores system preference. | `release-ui.test.tsx`; storage-denied browser test |
| BUILD-01 / P0 portability | Documented `npm ci` had no npm lock and dependency peers conflicted. Production start and clean used POSIX-only syntax; chain check relied on Node native TS behavior unsupported by the advertised minimum. Add npm lock, align esbuild/TypeScript peers, pin toolchain minimum, use JS build/clean scripts, portable start and tsx chain runner; include scripts/Playwright config in typecheck. Remove stale Bun lock. | Clean npm install/ci, typecheck, build/start and chain command logs |
| UI-01 / P1 | Send review was actionable before its balance loaded; a browser test hit the transient loading path instead of the intended balance check. Disable review while unavailable; retain honest loading/error values. | `ui.test.tsx`, live insufficient-balance e2e |
| HISTORY-01 / P1 | Malformed explorer response looked like an empty history, and duplicate indexed events were displayed repeatedly. Fail malformed responses into the fallback path and deduplicate event keys. | `activity-ledger.test.ts` |
| CSV-01 / P1 | Formula neutralization missed whitespace-prefixed formulas/newline prefixes. Central CSV quoting now neutralizes these inputs as well. | `release-safety.test.ts` formula/control/quote cases |
| DEPS-01 / P1 | body-parser compressed-body DoS and vulnerable gRPC dependencies. Apply compatible body-parser update and gRPC override to patched 1.14.6; retain regression suites. | npm audit before/after and HTTP/Firestore tests |
| META-01 / P2 | Manifest claimed two square icon sizes for an actual 480x520 image; missing asset paths returned SPA HTML 200. Correct metadata and return 404 for unknown asset chunks. | File dimensions inspected; production asset e2e |

Short ERC-1271 signatures are now structurally permitted as bounded, even-length hex. They still require cryptographic verification. This deliberately strengthens protocol compatibility; malformed odd-length hex remains rejected. No assertion was relaxed to allow forged signatures. Digit-lookalike reserved names such as camb10, mez0 and supp0rt are also rejected. Malformed cached ledger decimals, swap fields and memos can no longer crash activity rendering. No passing test is evidence of a real transaction broadcast.

## Commands and observed results

The final sequential release run completed every command below with exit code 0. See `AUDIT_COMMANDS.md` for baseline/intermediate command outcomes and `audit-evidence/` for retained logs.

| Gate | Final observed result |
| --- | --- |
| Clean reproducible install | PASS: `npm ci --cache ../npm-cache --prefer-online`, 1,098 packages installed. Original frozen Bun install also passed. First npm ci failed on a corrupted shared-cache ENOENT, then the isolated-cache retry passed |
| `npm run typecheck` | PASS, exit 0. Now includes Playwright config and chain verifier |
| `npm run lint` | PASS, exit 0 (repository alias for tsc, not a separate ESLint suite) |
| `npm test` | PASS: 12 files, 143 tests; baseline was 112 tests |
| `npm run test:rules` | PASS: 3 files, 14 tests, including independent-instance shared limits and invalid proof records. A prior cold-start hook timeout was corrected by matching the hook budget to the existing 30-second emulator budget |
| `npm run test:e2e` | PASS: 18 tests (17 desktop + 1 mobile), production build, live testnet reads, no unhandled runtime errors or CSP violations |
| `npm run verify:chain` | PASS: read-only contract/pool/quote/fee checks and exact suffix simulation, including ERC-20 true return. One warning: empty testnet MUSD/mUSDT pool; anomalous mUSDC quote investigated |
| `npm run build` | PASS: Vite frontend and bundled Express server, exit 0 |
| Production / development startup | PASS startup and app/deep-link/asset serving. Final smoke: app 200, unknown API/asset 404, identity health and lookup 503 without credentials. Healthy durable production identity remains BLOCKED. Dev root/health previously returned 200 with durable=false |
| npm security audit | FAIL security-clean gate: full audit 16 affected packages (11 high / 5 moderate / 0 critical), production-only audit 11 high / 0 critical. Remaining root advisories assessed below |

Intermediate failures are not hidden: initial missing dependencies/Java/Firebase CLI; stale Bun executable shim blocked by Windows Device Guard; npm peer resolution conflict; transient implementation parse/type errors caught and repaired; review-before-balance readiness; CSP-blocked Coinbase/Base telemetry; storage-disabled SDK startup; emulator hook cold-start timeout; shared npm cache ENOENT. Required suites are never skipped to claim a release pass.

## Live blockchain evidence

Official network and token/router addresses were checked against [Mezo getting started](https://mezo.org/docs/developers/getting-started), [contract reference](https://mezo.org/docs/users/resources/contracts-reference), and [Mezo Pools](https://mezo.org/docs/developers/features/mezo-pools). The baseline read-only verifier observed testnet chain 31611, MUSD 18 decimals, BTC 18, mUSDC/mUSDT 6, router/factory agreement and configured pool tokens/stable flags.

The testnet MUSD/mUSDC quote remained approximately **0.844238 mUSDC per 1 MUSD** in the observed read; this is anomalous test liquidity, not a market rate. Testnet MUSD/mUSDT returned zero output. The latter is a warning about unavailable liquidity, not a successful swap. Testnet pool fees read as 4 bps volatile / 1 bps stable. The exact request-ID suffix simulated with an estimated 34,617 gas on testnet in the baseline run. The improved verifier additionally requires the ERC-20 call to return true. These are read-only simulations and snapshots, not transactions.

**No real transaction hash or payment-proof link was created or verified in this review.** A funded human testnet wallet, wallet approval and independent recipient-side proof opening are still required. The test wallet rejects all transaction broadcasts. Mainnet remained disabled; the script's original mainnet checks were read-only.

## Security findings that remain

1. **High transitive wallet-SDK advisory remains:** [Zod collection-validation resource exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Reown uses pinned Zod 3 and Coinbase dependencies use Zod 3. The published patch is Zod 4.6.6+, a major API change. Forcing it globally could break wallet validation; no blind major override was applied. The unused Coinbase/Base SDK connectors are disabled and the Express API does not accept Zod collections (it uses explicit checks and a 4 KB body limit), but wallet SDK supply-chain availability risk remains. Eleven audit package entries propagate this finding; they are not eleven distinct exploits. Resolve via upstream compatible releases or a separately reviewed wallet-SDK migration before claiming a clean security gate.
2. Dev tooling still includes moderate [OpenTelemetry baggage allocation](https://github.com/advisories/GHSA-8988-4f7v-96qf) and [uuid buffer bounds](https://github.com/advisories/GHSA-w5hq-g745-h8pq) findings through Firebase CLI. Cambio does not run the CLI as its production server or expose those buffer APIs. Do not install development tooling into a minimal runtime image unless needed.
3. No independent application or smart-contract audit was conducted. This review does not certify Mezo, MUSD, the router, wallet SDKs, RPC truthfulness, finality, economic conditions or freedom from undiscovered defects.
4. Cloud credentials/IAM, actual named database, TTL cleanup and deployed Firestore rules remain unverified. Enable TTL on `identity_rate_limits.expiresAt`; expired SIWE challenge retention also needs an operational retention policy. Shared Firestore limits address multi-instance quotas, not volumetric DDoS or database-cost abuse; configure trusted ingress and WAF limits.
5. ERC-1271 code paths exist but no live contract-wallet signature/payment was demonstrated. Real WalletConnect pairing, rejected mobile network switching, native share/clipboard permission behavior, screen-reader/focus trapping, tablet device behavior and HTTPS hosting require manual release checks. Desktop Chromium plus a mobile viewport does not cover every wallet/browser.
6. History is partial (latest explorer page; RPC fallback up to 10,000 blocks; recipient settlement scan considers up to ten indexed candidates). An absent result is not universal proof of nonpayment. Use a known proof hash for definitive request checking. Chain reorganization/finality beyond the available receipt is not independently proven.
7. Names are mutable centralized mappings. ASCII prevents Unicode homoglyphs but not all ASCII lookalikes. Always review the full address. Mainnet identity is disabled; extending contract-wallet identities across chains needs chain-scoped authorization and registry design, not just a frontend build flag.
8. Fiat values are reference/peg estimates. Storage-denied mode has no persistent local history or session recovery. No offline service worker / installable-PWA guarantee or deployed OpenGraph preview was verified.

A filename-only secret-pattern scan flagged the public Firebase browser configuration identifier; no private signing key, mnemonic or service-account private key was found in inspected application source. No credential value is included in this report. This is a scoped pattern/code inspection, not an exhaustive secrets-provenance guarantee.

## Deployment status and required manual steps

GitHub public metadata returned homepage=null and zero public deployment records. The source contains deployment instructions, not a verified live origin. No deployment credentials or deployer-owned Reown project ID were present in this task environment. No public deployment URL was invented.

Before submission, the operator must:

1. Configure and deploy this reviewed source as a Node service (not a static-only Vite preview). Build with Node >=22.12, `npm ci --include=dev`, `npm run build`; run `npm start` with the host's PORT. Set a deployer-owned, origin-allowlisted `VITE_WALLETCONNECT_PROJECT_ID` at build time; keep `VITE_ENABLE_MAINNET=false`.
2. Set APP_URL to the exact HTTPS origin, correct TRUST_PROXY for ingress, Firestore project/database and Application Default Credentials/service account with appropriate database permissions. Deploy deny-by-default rules to that exact database. Do not set ALLOW_NON_DURABLE_IDENTITY or FIRESTORE_EMULATOR_HOST in the real deployment.
3. Observe `GET /api/health` returning 200 with identity available=true, durable=true and Firestore kind. Register/change a test username, restart the service, resolve it again from another browser; test shared 429 enforcement across instances. Configure TTL/ingress limits and inspect HTTPS headers.
4. Use two human-controlled funded **testnet** wallets: claim @username, create/sign a small MUSD request, open it as payer, review exact network/token/recipient/fee, approve the actual transfer, wait for receipt and matching event, copy the real explorer and proof links, and open the proof independently as recipient. Record those real URLs and a demo video. Reject a second wallet prompt and show tamper/expiry rejection. Never use the read-only pool watch address as a signing wallet.
5. Complete mobile WalletConnect pairing/network switching, native sharing/clipboard, keyboard/focus and assistive-technology checks at the deployed origin. Verify swaps only on liquid testnet pairs if needed; do not promise an empty pool will work.
6. Resolve or explicitly assess remaining dependency advisories; rerun release gates. Provide the working public application URL, source repository and honest demonstration/evidence in the actual submission form. A public GitHub repository by itself is not a working deployment.

## Repeatable judge demonstration

The core story is **verified @username -> signed request -> wallet-confirmed MUSD transfer -> independently verified settlement**. With the prerequisites above, use two browsers/wallets and about five minutes:

1. Recipient connects to Mezo Testnet; show separately read MUSD and BTC balances. Claim a username with the SIWE message naming the deployed origin.
2. Request a small amount the payer can afford; sign the EIP-712 request. Share the actual link/QR. Payer opens it and sees verified signature, address, amount and expiry.
3. Payer reviews token contract/network/full recipient/RPC fee and approves in their wallet. Wait for the actual receipt; do not call a pending hash successful.
4. Open the real explorer transaction and recipient proof link in the other browser. Demonstrate exact request-ID-bound settlement. Refresh balances/history; explain indexed history versus RPC-verified proof.
5. Change a signed field in a copy of the link; show rejection. Reject another wallet prompt and show cancellation. Explain testnet liquidity and absence of an independent audit.

Until step 3 genuinely occurs, describe this as a rehearsable runbook, not a completed payment demonstration.

## Release gate checklist

- [x] Reproducible final dependency installation observed.
- [x] Final typecheck and lint observed passing.
- [x] Final unit/integration/UI suite observed passing.
- [x] Final Firestore emulator rules/store/API suite observed passing.
- [x] Final production browser suite observed passing.
- [x] Final production build/startup smoke observed passing.
- [x] Final read-only chain verification and warnings evaluated.
- [x] Initial checkout preserved; repairs and regression coverage prepared.
- [x] Mainnet disabled; no real-fund or production-data action performed.
- [x] Demo outcomes explicitly separated from financial evidence.
- [x] No remaining known P0 or critical vulnerability identified in the inspected/tested paths. This is a scoped finding, not a zero-bug or independent-audit guarantee.
- [ ] Durable deployed identity, correct project/database/rules/IAM and restart survival verified.
- [ ] Human testnet payment and independently opened settlement proof demonstrated.
- [ ] Real mobile/contract-wallet/assistive-technology limits assessed where applicable.
- [ ] Remaining dependency advisories resolved or accepted with an evidence-based risk decision.
- [ ] Working deployment URL, source URL, demonstration and required submission fields assembled.

## Official submission requirement check

The [official October 19 announcement](https://mezo.org/blog/mezo-buildathon-is-underway) states that entries must integrate MUSD and/or MEZO and include a working deployment; Mezo testnet is eligible. It lists Wave 1 October 16-26 and Wave 2 November 2-15, 2026. Cambio fits the access/distribution story, but eligibility is not a readiness verdict.

The interactive [AKINDO event](https://app.akindo.io/wave-hacks/OVOO0gdrVU8379D10) was subsequently read successfully. It requires a live project link, public repository, product deck and two-minute pitch video. Its form requests product, audience, implementation, status, milestones and team information. Judging weights are integration 30%, business 30%, implementation 20%, UX 10% and materials 10%. See SUBMISSION_PACKAGE.md for the draft and recording script. Registration/terms, team eligibility and the exact deadline timezone remain operator checks. A six-slide PDF deck is prepared; the real video and deployment remain incomplete.

The final release command results are recorded in audit-evidence/release-results.json. Expected remaining warnings: future Vite native-config import-extension warnings, Node color-environment warnings, emulator metadata lookup warnings without cloud credentials, and the empty testnet pool. None was suppressed to claim a pass.
