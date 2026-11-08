# Cambio performance report (Wave 2)

Measured 2026-11-08 in this environment against live Mezo Testnet and the live production deployment, unless a row says otherwise. Nothing here is estimated. This supersedes `docs/PERFORMANCE_REPORT.md` (2026-11-05), whose before/after batching figures are kept below.

**Reproduce the RPC rows** with this command. It is read-only; the script is `scripts/measure-rpc.ts`:

```bash
npm run measure:rpc
```

## RPC load and latency (median of 3 runs; settlement verification median of 7)

| Operation | Unbatched (before) | Batched / current | Note |
| --- | --- | --- | --- |
| Mezo position refresh (PriceFeed + 10 protocol parameters + trove) | 17 requests · 815 ms | **5 requests · 533 ms** | Multicall3 batching (`src/lib/readClient.ts`) |
| Fund & Pay sizing (reserves, fee, router quotes, block) | 7 requests · 285 ms | **3 requests · 228 ms** | same |
| Settlement evidence verification (tx + receipt + block, then checks) | — | **4 requests · median 144 ms** (min 142, max 607) · 7/7 PASS | The max reflects one not-found retry on the load-balanced RPC |

The 2026-11-05 run measured 17 → 5 requests (454–563 → 387–394 ms) and 7 → 3 requests (264–301 → 155–160 ms). Request counts are identical; absolute latency varies with public RPC load.

## Production API latency

Median of 7 sequential requests from this environment to `https://cambio-five.vercel.app`, warm, measured with `curl`:

| Endpoint | Median | Min–max | What it does |
| --- | --- | --- | --- |
| `GET /` (SPA shell, CDN) | 237 ms | 227–268 | `x-vercel-cache: HIT` |
| `GET /api/health` | 394 ms | 383–676 | Firestore ping |
| `GET /api/invoices/:recipient/:id` (404 case) | 603 ms | 548–683 | One Firestore read |
| `GET /api/identity/address/:address` | 712 ms | 664–814 | Two Firestore reads |

These numbers include network distance from this container to Vercel. They are not end-user figures.

## Frontend bundle (`vite build`)

| Chunk | Production (deployed build) | This branch | Change |
| --- | --- | --- | --- |
| `index` (landing entry) | 4.87 kB raw · 2.37 kB gzip | 4.87 kB · 2.39 kB gzip | none |
| `appEntry` (app shell incl. wallet SDKs) | 1,285.2 kB · 339.3 kB gzip | 1,322.1 kB · 349.4 kB gzip | **+10.1 kB gzip (+3.0%)** for the stepper, proof viewer, Merchant Pro, share channels and journey logic |
| All JS/CSS assets | — | 4,717,524 B | — |

The app shell is dominated by Reown AppKit, wagmi and viem. They already load lazily behind the landing page. A further reduction would mean trimming or replacing AppKit. That is out of scope, and a risk to wallet compatibility.

## Caching and correctness

- The Mezo card refreshes every 30 s, only while the tab is visible. Fund & Pay quotes refresh every 15 s and pause while a swap is in flight. Quotes expire after 30 s and are re-quoted and simulated before the wallet prompt.
- **Settlement status is never cached as paid.** Every proof view and every server settlement re-reads the transaction, receipt and block. A registry "paid" is only a hint for which hash to verify.
- A pending payment is re-checked every 5 s for up to 36 attempts (about 3 minutes). After that the page asks the payer to check the explorer and reload, and it never says "failed".

## Reliability under the inconsistent public RPC

- Not-found and transport errors are retried. The in-app schedule is 300/800/1500 ms. The evidence and CI schedule is 0.4/1/2/3.5/5/8 s.
- A genuinely missing transaction in the browser is reported after about 2.6 s as "not found yet (pending)", never as failed.

## Test suite timings (this container, Node 24)

| Suite | Count | Duration |
| --- | --- | --- |
| `npm test` (unit/integration/API/UI) | 305 | about 21 s |
| `npm run test:rules` (Firestore emulator) | 26 | about 45 s |
| `npm run test:e2e` (production build, Chromium desktop + Pixel 7) | 26 (+3 opt-in screenshot specs, skipped by default) | about 1.5 min |
| `npm run test:live` (read-only live chain) | 7 | about 6 s |

## Not measured (and not claimed)

- Real-device mobile load time, Lighthouse scores and wallet-connection time. No physical device or throttled lab run was available. Run Lighthouse against the deployed URL before citing a figure.
- Throughput under load.
