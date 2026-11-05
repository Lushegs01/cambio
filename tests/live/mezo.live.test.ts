/**
 * LIVE, read-only checks against Mezo Testnet. Run with `npm run test:live` (needs network access).
 * Excluded from `npm test`, which uses no network. Nothing here signs or broadcasts.
 */
import { describe, expect, it } from 'vitest';
import { createPublicClient, http, type Hex } from 'viem';
import { MEZO_TESTNET } from '../../src/config/chains';
import { computeCR, readOraclePrice, readProtocolParams, readTrove, type ReadClient } from '../../src/lib/mezoProtocol';
import { checkBtcToMusdSwap, checkMusdTransfer, fetchEvidence, type EvidenceClient } from '../../src/lib/evidence';
import { fetchSwapQuote } from '../../src/lib/swap';

const chain = MEZO_TESTNET;
const client = createPublicClient({ transport: http(chain.rpcUrls[0], { timeout: 20_000, retryCount: 2 }) });
const read = client as unknown as ReadClient;

describe('live Mezo Testnet (read-only)', () => {
  it('PriceFeed returns a fresh 18-decimal BTC price', async () => {
    const r = await readOraclePrice(read, chain);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.price).toBeGreaterThan(1_000n * 10n ** 18n);
    expect(r.price).toBeLessThan(10_000_000n * 10n ** 18n);
    if (r.updatedAt) expect(Math.abs(Date.now() / 1000 - r.updatedAt)).toBeLessThan(600);
  });

  it('protocol parameters match the documented MUSD rules', async () => {
    const r = await readOraclePrice(read, chain);
    if (r.status !== 'ok') throw new Error(`oracle ${r.status}`);
    const p = await readProtocolParams(read, chain, r.price);
    expect(p.mcr).toBe(11n * 10n ** 17n);
    expect(p.ccr).toBe(15n * 10n ** 17n);
    expect(p.recoveryMode).toBe(p.tcr < p.ccr);
    expect(p.minNetDebt).toBeGreaterThan(0n);
    expect(computeCR(p.systemColl, p.systemDebt, r.price)).toBe(p.tcr);
  });

  it('reads a wallet without a trove as "none"', async () => {
    const r = await readOraclePrice(read, chain);
    if (r.status !== 'ok') throw new Error(`oracle ${r.status}`);
    const t = await readTrove(read, chain, '0x000000000000000000000000000000000000dEaD', r.price);
    expect(t.status).toBe('none');
  });

  it('the Router quotes BTC → MUSD from the verified pool', async () => {
    const q = await fetchSwapQuote(client as never, chain, 'BTC', 'MUSD', 10n ** 15n, 50);
    expect(q.amountOut).toBeGreaterThan(0n);
    expect(q.feeBps).toBeGreaterThan(0);
  });

  it('recorded evidence transactions still verify', async () => {
    const transfer = '0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e' as Hex;
    const swap = '0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e' as Hex;
    const t = await fetchEvidence(client as unknown as EvidenceClient, transfer);
    const s = await fetchEvidence(client as unknown as EvidenceClient, swap);
    if (!t.ok || !s.ok) throw new Error('RPC did not return the evidence transactions');
    expect(checkMusdTransfer(chain, transfer, t.tx, t.receipt, t.blockTimestampMs).verdict).toBe('PASS');
    expect(checkBtcToMusdSwap(chain, swap, s.tx, s.receipt, s.blockTimestampMs).verdict).toBe('PASS');
  });
});

describe('live Fund & Pay sizing (read-only)', () => {
  it('sizes a BTC swap whose router-enforced minimum covers a MUSD shortfall', async () => {
    const { planFunding } = await import('../../src/lib/fundAndPay');
    for (const need of [1n * 10n ** 18n, 25n * 10n ** 18n, 500n * 10n ** 18n]) {
      const plan = await planFunding(client as never, chain, need);
      expect(plan.quote.minAmountOut).toBeGreaterThanOrEqual(need);
      // Not wildly oversized: the expected output stays within 1.5% of the need (0.5% slippage + fee + rounding).
      expect(plan.quote.amountOut).toBeLessThan((need * 1015n) / 1000n);
      console.log(`need ${need / 10n ** 18n} MUSD -> ${plan.btcIn} wei BTC, expected ${plan.quote.amountOut}, min ${plan.quote.minAmountOut}, impact ${plan.quote.priceImpactBps}bps`);
    }
  });
});

describe('live Multicall3 batching (read-only)', () => {
  it('returns the same protocol state as unbatched reads', async () => {
    const { batchedReadClient } = await import('../../src/lib/readClient');
    const batched = batchedReadClient(chain) as unknown as ReadClient;
    const price = await readOraclePrice(batched, chain);
    if (price.status !== 'ok') throw new Error(`oracle ${price.status}`);
    const [a, b] = await Promise.all([readProtocolParams(batched, chain, price.price), readProtocolParams(read, chain, price.price)]);
    expect(a.mcr).toBe(b.mcr);
    expect(a.ccr).toBe(b.ccr);
    expect(a.minNetDebt).toBe(b.minNetDebt);
    expect(a.tcr).toBe(b.tcr);
  });
});
