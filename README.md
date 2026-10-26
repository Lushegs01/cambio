# Cambio

**Non-custodial MUSD payments on Mezo.** Send MUSD to a verified `@username`, share a payment request whose amount and recipient cannot be tampered with, and prove on-chain that it was paid.

Cambio is for people and small businesses who want to get paid in MUSD (Mezo's bitcoin-backed stablecoin) without pasting 42-character addresses or trusting screenshots as proof of payment.

| Problem | What Cambio does |
| --- | --- |
| Paying an address is error-prone and easy to phish | `@username` → address resolution through a registry where every name is bound to its wallet by a server-verified signature |
| Payment links can be edited (swap the address, change the amount) | Requests are **EIP-712 signed** by the recipient's wallet; the payer's browser verifies the signature before showing a Pay button |
| "I paid you" is hard to verify | The payment transaction carries the request id in its calldata; anyone can check settlement on-chain from a proof link |
| Wallet UIs hide what is happening | Every transfer shows network, token contract, recipient, RPC fee estimate and a receipt-based outcome |

> **Release review (2026-10-25): NOT READY for submission until the blocked deployment and real testnet-payment gates in [SUBMISSION_READINESS.md](SUBMISSION_READINESS.md) are completed.** Local automated and read-only chain evidence is recorded there.

> **Status:** hackathon MVP on **Mezo Testnet**. Not audited. Do not use with significant real funds. See [Residual risks](#residual-risks).

To run the app and username database on your own server without Firebase/Vercel, see [SELF_HOSTING.md](SELF_HOSTING.md). Current local results and the remaining public-hosting checks are recorded in [SELF_HOSTING_READINESS.md](SELF_HOSTING_READINESS.md).

---

## What is real, what is simulated

| Capability | Status | Evidence |
| --- | --- | --- |
| Native BTC and MUSD balances, read separately | **Real** (`eth_getBalance` + `MUSD.balanceOf`) | `tests/balances.test.ts`, e2e "connecting reads real Mezo Testnet balances" |
| MUSD transfer (wallet-signed `transfer`) | **Real**, receipt-verified | `tests/musdTransfer.test.ts`; e2e runs the live preflight up to the wallet prompt |
| Signed payment requests + settlement proof | **Real** (EIP-712 + calldata-bound request id) | `tests/paymentRequest.test.ts`, e2e tamper/expiry tests |
| `@username` registry | **Real**, server-verified EIP-4361 signatures, atomic Firestore or self-hosted SQLite transactions | `tests/identity.api.test.ts`, `tests/sqlite-identity.test.ts`, `tests/rules/*` (Firestore emulator) |
| Activity history | **Real**: Mezo Blockscout index, RPC-log fallback, plus this device's submitted transactions reconciled against receipts | `tests/activity-ledger.test.ts` |
| Swaps (MUSD⇄BTC, MUSD⇄mUSDC, MUSD⇄mUSDT) | **Real** via Mezo's official Router; quotes from `getAmountsOut`, fees from `PoolFactory.getFee` | `tests/swap.test.ts`; e2e shows a live router quote |
| Demo mode | **Simulated**, clearly labelled on every screen; never mixed into real history; swaps are not simulated at all | `tests/activity-ledger.test.ts`, `tests/balances.test.ts` |
| Fiat estimates | Display-only. BTC/USD from CoinGecko/Coinbase with real timestamps; MUSD/mUSDC/mUSDT valued at their $1 peg | `src/services/liveRatesService.ts` |

**Not verified in this environment:** an actual broadcast testnet transfer. The development sandbox had no funded testnet key (the Mezo faucet is CAPTCHA-protected), so no transaction was broadcast while building this. What *was* verified against the live chain: configured contract addresses, token decimals, pool configuration, router quotes, pool fees, and successful `eth_call`/`eth_estimateGas` simulation of the exact transfer calldata Cambio sends (including the request-id suffix). Run `npm run verify:chain` to repeat those checks. The [judge demo](#judge-demonstration) performs a real transfer with your own testnet wallet.

---

## Architecture

```
Browser (React 19 + Vite)                                   Server (Express, same origin)
┌──────────────────────────────────────────────┐            ┌──────────────────────────────────┐
│ Reown AppKit + wagmi  ── wallet signs ───────┼──► Mezo    │ /api/identity/challenge          │
│ viem public clients ── reads/receipts ───────┼──► RPC     │   EIP-4361 message, single-use   │
│                                              │            │   nonce, 5-min expiry, stored    │
│ lib/musdTransfer   preflight→sign→receipt    │            │ /api/identity/claim              │
│ lib/swap           router quote→approve→swap │            │   verify signature (EOA/1271),   │
│ lib/paymentRequest EIP-712 links, settlement │            │   atomic registry transaction   │
│ lib/activity       Blockscout ▸ RPC logs     │◄── fetch ──┤ /api/identity/username|address   │
│ services/identityClient ─────────────────────┼──── /api ─►│ rate limits, 4 KB bodies, no CORS│
└──────────────────────────────────────────────┘            └───────────────┬──────────────────┘
                                                                            │ Store adapter
                                                                  Firestore via Admin SDK, or
                                                                  SQLite on a self-hosted disk
```

Key modules:

| Path | Purpose |
| --- | --- |
| `src/config/chains.ts` | The only place addresses live: networks, RPCs, explorers, tokens, router, factory, pools |
| `src/lib/amounts.ts` | Exact bigint parsing/formatting; excess precision is rejected, never rounded |
| `src/lib/balances.ts` | Typed `BalanceState<'BTC' \| 'MUSD'>`: loading / error / unsupported / ready, never a fake 0 |
| `src/lib/musdTransfer.ts` | Transfer state machine with injected chain dependencies (tested directly) |
| `src/lib/transactions.ts` | `TxPhase` lifecycle, local ledger of submitted hashes, receipt reconciliation |
| `src/lib/paymentRequest.ts` | Link format, EIP-712 types, validation, signature and settlement verification |
| `src/lib/swap.ts` | Router quotes, price impact, slippage, approval/re-quote/simulate/execute |
| `server/identity/*` | SIWE challenge/claim service, Firestore/SQLite/development-memory stores, shared decision logic |
| `shared/username.ts` | Username normalisation, validation and impersonation blocklist (client + server) |
| `shared/signatureVerification.ts` | Local ECDSA verification with on-chain contract-wallet fallback; no simulated ownership |
| `firestore.rules` | Deny-by-default rules, tested against the emulator |

---

## Networks and verified contracts

Verified on 2026-10-25 against the official Mezo docs ([contracts reference](https://mezo.org/docs/users/resources/contracts-reference), [Mezo Pools](https://mezo.org/docs/developers/features/mezo-pools)) **and** on-chain (`npm run verify:chain`).

| | Mezo Testnet (default) | Mezo Mainnet (off by default) |
| --- | --- | --- |
| Chain ID | 31611 (`0x7b7b`) | 31612 (`0x7b7c`) |
| RPC | `https://rpc.test.mezo.org` | `https://mezo.drpc.org`, `https://mezo-mainnet.boar.network` |
| Explorer | https://explorer.test.mezo.org | https://explorer.mezo.org |
| Faucet | https://faucet.test.mezo.org | — |
| MUSD (18 dec) | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| BTC (native; ERC-20 precompile, 18 dec) | `0x7b7C000000000000000000000000000000000000` | same |
| mUSDC / mUSDT (6 dec) | `0xe1a2…3A59` / `0x6293…950A` | `0x0467…c197` / `0xeB5a…bB8E` |
| Router | `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9` | `0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706` |
| PoolFactory | `0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A` | `0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248` |
| Pool fees (read on-chain) | volatile 0.04%, stable 0.01% | volatile 0.30%, stable 0.02% |

Findings from verification:
- The prototype pointed testnet at `rpc.matsnet.mezo.org` / `explorer.matsnet.mezo.org`; those hosts did not resolve. The official testnet endpoints are used now.
- Testnet pool fees differ from the documented mainnet values, so fees are always read from `PoolFactory.getFee`.
- The testnet MUSD/mUSDT pool exists but has **no liquidity**; Cambio reports "insufficient liquidity" for that pair on testnet. The testnet MUSD/mUSDC pool is off-peg (≈0.84) — test liquidity, not a market price.

Mainnet remains disabled in this release candidate. The frontend build flag is not sufficient to launch mainnet identity: the backend now only authorizes testnet by default, and cross-chain contract-wallet identities require a separately reviewed design.

---

## Local setup

Prerequisites: Node.js ≥ 22.12 (Node 24.20.0 and npm 11.19.0 used for this review), npm, and Java 21 for Firestore emulator tests. The committed npm lockfile is authoritative.

```bash
npm ci                     # reproducible install from package-lock.json
cp .env.example .env.local # set VITE_WALLETCONNECT_PROJECT_ID
npm run dev                # http://localhost:3000 (Vite + the same Express API)
```

In development, when no Firestore credentials or emulator are configured, the identity API uses an **in-memory** store. Signatures are still fully verified, but names are lost on restart; the UI shows a "Development registry" notice. To use Firestore locally:

```bash
npx firebase emulators:start --only firestore --project demo-cambio   # terminal 1
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_PROJECT_ID=demo-cambio npm run dev   # terminal 2
```

### Wallet and test funds

1. Use any EVM wallet (MetaMask, Rabby, a WalletConnect mobile wallet). Cambio offers to add/switch to **Mezo Testnet** (chain 31611) for you.
2. Get test BTC from https://faucet.test.mezo.org (BTC pays gas on Mezo).
3. Get test MUSD by swapping in Cambio (Swap → BTC → MUSD; 0.001 test BTC quoted ≈ 78 MUSD on 2026-10-23).

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR and the API |
| `npm run typecheck` (`npm run lint`) | `tsc --noEmit` in strict mode, including tests |
| `npm test` | Unit, integration and UI tests (Vitest, jsdom) |
| `npm run test:rules` | Firestore rules + Firestore store + API-on-Firestore tests (needs Java; uses the emulator via `firebase-tools`) |
| `npm run test:e2e` | Playwright browser tests against the production build (reads live testnet; never broadcasts) |
| `npm run verify:chain` | Re-verifies every configured address and pool against the live chains (read-only) |
| `npm run build` | Production SPA (`dist/`) and server bundle (`server.js`) |
| `npm start` | Production server: serves `dist/` and `/api` on `$PORT` |

---

## How payments work

**Send.** Recipient (`@name` resolved through the registry, or a 0x address) → amount parsed to base units → **preflight**: wallet and chain re-checked, live MUSD and BTC balances, `eth_estimateGas` on the exact calldata (a call that would revert is caught here) → **review** (network, token contract, full address, fee estimate) → wallet signature → real hash → `waitForTransactionReceipt` → **confirmed** only if the receipt succeeded *and* contains the matching `Transfer(from, to, amount)` event. Reverted receipts are "reverted"; a timeout after broadcast is "unknown" (with a re-check button), never success or failure. Double submits are blocked synchronously.

**Request.** The recipient signs an EIP-712 `PaymentRequest{id, recipient, token, amount, memo, createdAt, expiresAt}` under domain `{name: "Cambio", version: "2", chainId}`. The link (`/#pay?r=<base64url JSON>&s=<signature>`) needs no server. The payer's browser validates the payload strictly (supported chain, MUSD token for that chain, address, amount, memo length, 90-day max expiry), verifies the signature (EOA or ERC-1271), and only then offers payment with recipient and amount locked.

**Settlement.** The payment calls `MUSD.transfer(recipient, amount)` with a 20-byte calldata suffix `"CMB2" ‖ requestId` (ignored by the token; verified to simulate successfully on both networks). A request is "paid" only after its signature is verified and a transaction on the expected chain has that exact calldata, a successful receipt, the matching `Transfer` event and a readable block timestamp at or after request creation. Payments at or after expiry are labeled late. The payer gets a proof link (`…&tx=<hash>`); the recipient can also scan their incoming transfers ("Check paid"). Opening, scanning or "marking" a request never changes its status.

**Unsigned links** (`#pay?to=…&amt=…`, from the Receive screen) still work, but are shown with an "Unsigned link — check the address" warning. Legacy prototype links are treated as unsigned and their embedded username is ignored.

## Identity design

1. `POST /api/identity/challenge {address, chainId, action, username}`: validates, pre-checks availability, and stores an EIP-4361 message bound to this site's domain, the wallet, the action and the name, with a single-use nonce and a 5-minute expiry.
2. The wallet signs that exact text (free; no transaction).
3. `POST /api/identity/claim {nonce, signature}` verifies the signature against the stored message and address (ECDSA, then ERC-1271), re-validates the SIWE fields, then in **one Firestore transaction** consumes the nonce, enforces uniqueness, releases the wallet's previous name (for `change`) and writes both `verified_usernames/{name}` and `verified_wallets/{address}`.

Replays, expired or mismatched challenges, signatures from other keys, a different site's domain, and concurrent claims of the same name are all rejected (see tests). Names are lowercase `a-z0-9_`, 3–20 chars, no leading/trailing/double underscores, and impersonation words (`cambio`, `mezo`, `support`, `admin`, …) are blocked. Records written by the prototype were never ownership-verified and are ignored; users re-claim with a signature.

If the registry is unavailable the API answers **503** and the UI says so; sending to raw addresses keeps working. There is no local fallback that could make an unverified name look verified.

## Security controls

- **Non-custodial:** no private keys, seed phrases or custodial signing anywhere. Every transaction and signature is approved in the user's wallet.
- **Firestore rules:** deny by default; clients can only `get` single verified registry documents; all writes go through the verified backend; challenges, legacy collections, per-wallet history and preferences are closed. Tested against the emulator, including tests that **fail on the original rules** (cross-wallet history/preference access and username impersonation).
- **API:** strict input validation, 4 KB JSON limit, per-IP rate limits (10 mutations/min, 120 lookups/min; atomic shared Firestore counters when Firestore is configured, in-memory counters in local memory mode), no wildcard CORS, no stack traces in responses, `Cache-Control: no-store`, security headers.
- **Swaps:** exact-amount approvals only (never unlimited), fresh on-chain re-quote and `simulateContract` before signing, router-enforced minimum output, 20-minute deadline, quotes expire after 30 s and must be re-reviewed, swaps above 15% price impact are blocked.
- **Data honesty:** no generated hashes, no timer-based confirmations, no optimistic balance deductions, no synthetic prices or price jitter, no faked network responses (the prototype's global `fetch` patch that returned fake `200` responses was removed). RPC failures render as "Unavailable", not `0.00`.
- **Untrusted input:** payment links, explorer data and localStorage contents are validated before use; CSV export neutralises spreadsheet formulas; memos are rendered as text.

## Deployment

The app deploys as one Node service (Cloud Run via AI Studio, or any Node host). To host the app **and its database yourself without Firebase or Vercel**, use [SELF_HOSTING.md](SELF_HOSTING.md): Node 24, SQLite on persistent local disk, Docker Compose and Caddy HTTPS. This is a single-server configuration; the verified username rules and signature checks are the same for both stores.

For the managed Firestore configuration:

```bash
npm ci && npm run build      # dist/ + server.js
npm start                    # NODE_ENV=production node server.js, listens on $PORT
```

1. Set `VITE_WALLETCONNECT_PROJECT_ID` at build time and allow-list your origin in Reown.
2. Grant the service account **Cloud Datastore User** on the Firebase project in `firebase-applet-config.json` (or set `FIREBASE_PROJECT_ID` / `FIRESTORE_DATABASE_ID`).
3. Deploy the rules: `npx firebase deploy --only firestore:rules --project <project>` (`firebase.json` targets the app's named database).
4. Set `APP_URL` explicitly to the public HTTP(S) origin and configure `TRUST_PROXY` for your actual ingress. Do not assume Cloud Run injects `APP_URL`.
5. Check `GET /api/health`: `{"identity":{"available":true,"durable":true}}`. Without credentials the server still serves the app and payments, but identity answers 503.

`vite preview` does not run the API; use `npm start`. Vite's dev middleware is development-only and is not part of the production server.

### Vercel

The Vite frontend and Express API deploy together using `vercel.json` and the `api/index.ts` function. `/api/*` goes to Express, `/app/*` refreshes serve the SPA, and assets stay on the CDN. The function initializes the production Firestore registry once per warm instance and shares rate limits in Firestore. Failed initialization is retried after 30 seconds; it never falls back to a production memory registry.

Set the server runtime variables and Firebase service-account secret described in [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md). A working frontend alone does not prove the backend is deployed or identity is healthy: `/api/health` must return HTTP 200 with `identity.available: true` and `identity.durable: true`. Missing credentials produce an honest HTTP 503. Never put server credentials in a `VITE_*` variable or commit a service-account JSON file.

## Testing evidence

See [SUBMISSION_READINESS.md](SUBMISSION_READINESS.md) and its evidence files for the commands and results observed during the 2026-10-25 review. Earlier claimed results are not used as current evidence. The test wallet signs genuine EIP-191/EIP-712 messages with disposable test keys, reads live testnet state, and rejects every broadcast. It cannot prove an actual payment succeeded.

Production browser tests check CSP violations and unhandled runtime errors as well as payment, identity, startup, navigation and mobile behavior. Coinbase/Base SDK connectors that injected inline telemetry are disabled; injected EIP-6963 extensions and WalletConnect remain supported. When storage is denied, wallet SDKs receive an explicitly labeled, session-only memory store.

lint is the repository's existing alias for TypeScript checking; there is no independent ESLint suite. The manifest is metadata only: Cambio has no service worker, offline-payment capability, or verified installable PWA.

## Judge demonstration

About 5 minutes, two browsers (or a browser + a phone wallet):

1. Open Cambio → **Explore** → **Connect wallet**. Approve the switch to **Mezo Testnet** if asked.
2. Overview shows **MUSD** and **BTC for fees** separately, read from the chain. (Empty wallet? Use the faucet link shown on the card, then **Swap** BTC → MUSD and confirm the approval and swap in your wallet.)
3. Claim a username when prompted: the wallet shows a "Sign-In with Ethereum" message naming this site and the username. Sign it; the name is verified server-side.
4. **Request** → enter 5 MUSD and a note → **Sign & create request** (free signature) → copy the link / show the QR.
5. In a second browser with a different funded wallet, open the link. It shows **"Signed by the recipient's wallet"**, the verified `@username`, amount, expiry and network.
6. **Review payment** → check network, MUSD contract and fee estimate → **Confirm in wallet**.
7. Watch the status go *Waiting for your wallet → Submitted → Confirmed on-chain*, with the real hash and an explorer link. Open it: the transaction's input ends with `434d4232…` (the request id).
8. Copy the **payment proof link** and open it in the first browser: **"Paid — verified on Mezo Testnet"**. Or press **Check paid** on the Request page.
9. Refresh both dashboards: balances and Activity reflect the transfer (explorer-indexed, each row links to the explorer).
10. Failure behaviour: start another payment and **reject** it in the wallet ("Cancelled in wallet — nothing was sent"); edit one character of a request link ("Signature check failed — do not pay"); switch the wallet to another network (balances hidden, one-click switch back).

## Known limitations

- Single-hop swaps on the three verified MUSD pools only; no multi-hop routing or CL (Slipstream) pools.
- History comes from the Mezo explorer index (latest 50 MUSD transfers) with an RPC fallback over up to the latest 10,000 blocks. Non-MUSD swap legs appear from this device's ledger only.
- Private transfer notes and the request list are stored in the browser that created them.
- Firestore and SQLite identity use shared atomic rate limiting. SQLite instances must share one local database file on one server; independent volumes do not share identities or limits. Set the correct `TRUST_PROXY` hop count (0 for direct Node; 1 only behind one trusted proxy). Firestore needs a TTL policy on `identity_rate_limits.expiresAt`; SQLite cleans up expired buckets itself. Local memory mode limits remain per instance.
- Demo mode simulates balances, history and transfers, not swaps.
- The WalletConnect project ID falls back to a shared evaluation ID when unset; set your own for any deployment.

## Residual risks

Address these before exposing real funds or public users:

- **No audit.** Neither the app nor its use of Mezo contracts has been audited. Mainnet is disabled by default for this reason.
- **No end-to-end broadcast was performed in CI.** Real transfers were not executed in the build environment (see above); run the judge demo on testnet before relying on it.
- **Front-end supply chain:** wallet SDKs run in the page. Production now has a restrictive CSP and an npm lockfile. Remaining high-severity dependency alerts affect transitive Zod 3 validation in wallet SDKs; a safe compatible fix is not published. See the advisory assessment in SUBMISSION_READINESS.md.
- **Explorer trust:** history and "Check paid" scanning depend on Blockscout; settlement verification itself re-reads the transaction and receipt from the RPC.
- **Look-alike names:** ASCII-only names prevent Unicode homoglyphs, but `0`/`o` and `1`/`l` look-alikes remain possible. The review screen always shows the full address.
- **Registry availability and abuse:** Firestore rate limits coordinate instances, fail closed when unavailable, and cost database operations. A trusted ingress / WAF is still needed for volumetric attacks. Production credentials, IAM, named database and TTL configuration require live operator verification.
- **Testnet liquidity is not a market:** testnet swap prices and pegs can be far from real values.

Browser activity labels explorer records as **Indexed**. Signed-request settlement is a separate RPC verification. Cached local confirmations are rechecked and become unknown if their receipts or transfer evidence cannot be verified.
