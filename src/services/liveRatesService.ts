/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * USD reference prices for display-only fiat estimates. Never used for transaction amounts
 * (swap quotes come from the on-chain router).
 *
 *  - BTC: fetched from CoinGecko, then Coinbase as a fallback. Each value keeps the time it was
 *    actually fetched; if every source fails, the last real value is kept and marked stale, or the
 *    price is reported unavailable. No baseline or synthetic prices are ever substituted.
 *  - MUSD, mUSDC, mUSDT: valued at their $1 peg, labelled as such.
 */

export type PriceSource = 'CoinGecko' | 'Coinbase' | 'USD peg';

export interface UsdPrice {
  symbol: string;
  priceUsd: number;
  /** When the price was fetched from its source (ms). */
  fetchedAt: number;
  source: PriceSource;
  stale: boolean;
}

const CACHE_KEY = 'cambio.btcusd.v2';
const STALE_AFTER_MS = 10 * 60 * 1000;
const PEGGED = new Set(['MUSD', 'MUSDC', 'MUSDT', 'USDC', 'USDT']);

let btcCache: { priceUsd: number; fetchedAt: number; source: PriceSource } | null = null;
try {
  const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (raw && typeof raw.priceUsd === 'number' && raw.priceUsd > 0 && typeof raw.fetchedAt === 'number' && (raw.source === 'CoinGecko' || raw.source === 'Coinbase')) {
    btcCache = raw;
  }
} catch {
  btcCache = null;
}

async function fetchJson(url: string, timeoutMs = 4000): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const SOURCES: { source: PriceSource; read: () => Promise<number> }[] = [
  {
    source: 'CoinGecko',
    read: async () => (await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'))?.bitcoin?.usd,
  },
  {
    source: 'Coinbase',
    read: async () => parseFloat((await fetchJson('https://api.coinbase.com/v2/prices/BTC-USD/spot'))?.data?.amount),
  },
];

/** Tries each source in order. Resolves with the fresh price, or rejects if none responded with a sane value. */
export async function refreshBtcUsd(now = Date.now): Promise<UsdPrice> {
  for (const s of SOURCES) {
    try {
      const price = await s.read();
      if (typeof price === 'number' && Number.isFinite(price) && price > 1000 && price < 10_000_000) {
        btcCache = { priceUsd: price, fetchedAt: now(), source: s.source };
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(btcCache));
        } catch {
          // cache is optional
        }
        return { symbol: 'BTC', ...btcCache, stale: false };
      }
    } catch {
      // try the next source
    }
  }
  throw new Error('BTC price unavailable from all sources');
}

/** Current best-known USD price, or null when no real price has ever been obtained. */
export function getUsdPrice(symbol: string, now = Date.now()): UsdPrice | null {
  const s = symbol.toUpperCase();
  if (PEGGED.has(s)) return { symbol: s, priceUsd: 1, fetchedAt: now, source: 'USD peg', stale: false };
  if (s === 'BTC' && btcCache) return { symbol: 'BTC', ...btcCache, stale: now - btcCache.fetchedAt > STALE_AFTER_MS };
  return null;
}
