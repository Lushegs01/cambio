# Performance report

> **Superseded on 2026-11-08 by [`docs/WAVE2_PERFORMANCE_REPORT.md`](/docs/WAVE2_PERFORMANCE_REPORT.md).** Kept for history; where the two differ, the newer document is current.


All numbers below were measured in this environment on 2026-11-05. Nothing is estimated unless marked.

## RPC load and latency (live Mezo Testnet; two separate runs, each the median of 3)

| Operation | Before | After | Change |
| --- | --- | --- | --- |
| Mezo position refresh (oracle + 10 protocol params + trove) | 17 requests · 454–563 ms | **5 requests · 387–394 ms** | Concurrent reads batched through Multicall3 (`src/lib/readClient.ts`) |
| Fund & Pay sizing (pool reserves, fee, two router quotes, block) | 7 requests · 264–301 ms | **3 requests · 155–160 ms** | same |

Method: viem `http` transport with an `onFetchRequest` counter, run against `https://rpc.test.mezo.org` and the real trove `0xd0d4…8dCd`. The script is reproduced in the commit message of `3318c4c`; `tests/live/mezo.live.test.ts` checks that batched and unbatched reads agree.

The Mezo card refreshes every 30 s, and only while the tab is visible. Fund & Pay quotes refresh every 15 s and pause while a swap is in flight.

## Reliability under the inconsistent public RPC

- 8/12 and 9/12 receipt reads for mined transactions succeeded on a single attempt.
- With 3 retries (300/800/1500 ms), five consecutive `verify:evidence` runs produced the same verdicts.
- Worst case for a genuinely missing transaction: about 2.6 s before "not found".

## Frontend bundle (`vite build`)

| Chunk | Baseline `0961046` | Now | Change |
| --- | --- | --- | --- |
| `appEntry` JS | 1,237.36 kB (329.90 kB gzip) | 1,284.71 kB (343.58 kB gzip) | +13.7 kB gzip (+4.1%) for the Mezo card, Fund & Pay, invoices and evidence code |
| `appEntry` CSS | 71.83 kB (12.78 kB gzip) | 72.42 kB (12.86 kB gzip) | +0.08 kB gzip |
| All assets | 4,681,677 B, 127 JS files | 4,678,313 B, 127 JS files | ~0 (dependency updates offset the new code) |

The app entry is dominated by the wallet SDKs (Reown AppKit, wagmi, viem). Those already load lazily behind the landing page's `index` chunk (4.87 kB). Further reduction requires replacing or trimming AppKit, which is out of scope.

## Settlement search cost

Reconciliation now reads up to 10 explorer pages (500 transfers) and stops as soon as transfers predate the request. It verifies at most 25 candidates. For a typical request (a few days old, a quiet merchant address) that is **1 explorer call plus 1 RPC verification per matching candidate**. RPC fallback scans at most 5 × 10,000 blocks (about 57 hours at the measured ~4.1 s block time). Anything beyond that is reported as *unknown*.

## Test suite timings (this container)

| Suite | Count | Duration |
| --- | --- | --- |
| Unit / integration / UI (`npm test`, Node 24) | 250 | ~10 s |
| Firestore emulator (`npm run test:rules`) | 19 | ~41 s |
| Browser e2e (`npm run test:e2e`, production build) | 20 | ~1.4 min |
| Live read-only (`npm run test:live`) | 7 | ~4 s |

## Not measured

- Real-device mobile load time and Lighthouse scores. No physical device or throttled lab run was available here. Run Lighthouse against the deployed URL before citing any figure.
- Server API latency under load. The registry endpoints were tested for correctness, not throughput.
