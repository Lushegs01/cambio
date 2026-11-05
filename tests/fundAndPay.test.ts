/**
 * Fund & Pay sizing and funding decisions.
 */
import { describe, expect, it } from 'vitest';
import { MEZO_TESTNET } from '../src/config/chains';
import { checkFunding, guaranteedOutput, inputForOutput, outputForInput, planFunding, poolVsOracleBps, shortfall } from '../src/lib/fundAndPay';
import type { QuoteClient } from '../src/lib/swap';

const chain = MEZO_TESTNET;
const ONE = 10n ** 18n;
// Roughly the live testnet MUSD/BTC pool on 2026-11-05.
const R_BTC = 54n * ONE;
const R_MUSD = 4_250_000n * ONE;
const FEE = 4n;

function poolClient(opts: { btcIsToken0?: boolean; skewRouter?: bigint } = {}): QuoteClient & { quotes: bigint[] } {
  const quotes: bigint[] = [];
  return {
    quotes,
    getBlockNumber: async () => 1n,
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (functionName === 'token0') return opts.btcIsToken0 === false ? chain.tokens.MUSD.address : chain.tokens.BTC.address;
      if (functionName === 'getReserves') return opts.btcIsToken0 === false ? [R_MUSD, R_BTC, 0n] : [R_BTC, R_MUSD, 0n];
      if (functionName === 'getFee') return FEE;
      if (functionName === 'getAmountsOut') {
        const amountIn = args![0] as bigint;
        quotes.push(amountIn);
        const out = outputForInput(amountIn, R_BTC, R_MUSD, FEE) - (opts.skewRouter ?? 0n);
        return [amountIn, out > 0n ? out : 0n];
      }
      throw new Error(`unexpected ${functionName}`);
    },
  };
}

describe('pool arithmetic', () => {
  it('inputForOutput always covers the target and is minimal within 0.02%', () => {
    for (const out of [1n, ONE, 25n * ONE, 12_345n * ONE + 678n]) {
      const input = inputForOutput(out, R_BTC, R_MUSD, FEE)!;
      expect(outputForInput(input, R_BTC, R_MUSD, FEE)).toBeGreaterThanOrEqual(out);
      // The pool floors its fee, so adjacent inputs can give the same output; check minimality with a tolerance.
      if (out > ONE / 1000n) expect(outputForInput(input - input / 5_000n, R_BTC, R_MUSD, FEE)).toBeLessThan(out);
    }
  });

  it('refuses outputs the pool cannot provide', () => {
    expect(inputForOutput(R_MUSD, R_BTC, R_MUSD, FEE)).toBeNull();
    expect(inputForOutput(ONE, 0n, R_MUSD, FEE)).toBeNull();
    expect(inputForOutput(0n, R_BTC, R_MUSD, FEE)).toBe(0n);
  });

  it('computes the shortfall without negative values', () => {
    expect(shortfall(10n, 3n)).toBe(7n);
    expect(shortfall(10n, 10n)).toBe(0n);
    expect(shortfall(10n, 30n)).toBe(0n);
  });
});

describe('planFunding', () => {
  it('returns a router quote whose slippage-protected minimum covers the shortfall', async () => {
    const c = poolClient();
    const plan = await planFunding(c, chain, 25n * ONE, 50, 1_000);
    expect(plan.quote.minAmountOut).toBeGreaterThanOrEqual(25n * ONE);
    expect(guaranteedOutput(plan)).toBe(plan.quote.minAmountOut);
    expect(plan.quote.tokenIn.symbol).toBe('BTC');
    expect(plan.quote.tokenOut.symbol).toBe('MUSD');
    expect(plan.quote.amountOut).toBeLessThan((25n * ONE * 1006n) / 1000n);
  });

  it('works regardless of the pool token order', async () => {
    const plan = await planFunding(poolClient({ btcIsToken0: false }), chain, 5n * ONE);
    expect(plan.quote.minAmountOut).toBeGreaterThanOrEqual(5n * ONE);
  });

  it('nudges the input up when the router quotes below the reserve estimate', async () => {
    const c = poolClient({ skewRouter: ONE / 10n });
    const plan = await planFunding(c, chain, 25n * ONE);
    expect(c.quotes.length).toBeGreaterThan(1);
    expect(plan.quote.minAmountOut).toBeGreaterThanOrEqual(25n * ONE);
  });

  it('refuses when no quote can cover the need, and when nothing is needed', async () => {
    await expect(planFunding(poolClient({ skewRouter: 10_000n * ONE }), chain, 25n * ONE)).rejects.toThrow();
    await expect(planFunding(poolClient(), chain, R_MUSD)).rejects.toThrow(/liquidity/);
    await expect(planFunding(poolClient(), chain, 0n)).rejects.toThrow();
  });
});

describe('checkFunding', () => {
  const plan = { shortfall: 5n * ONE, btcIn: ONE / 1000n, quote: {} as never };

  it('lets a wallet with enough MUSD pay directly', () => {
    expect(checkFunding({ amount: 5n * ONE, musdBalance: 5n * ONE, btcBalance: 0n, gasReserve: 0n }).status).toBe('enough_musd');
  });

  it('offers a swap for the exact shortfall', () => {
    expect(checkFunding({ amount: 10n * ONE, musdBalance: 5n * ONE, btcBalance: ONE, plan, gasReserve: 1n })).toEqual({ status: 'needs_swap', shortfall: 5n * ONE });
  });

  it('says so when BTC cannot cover the swap plus fees', () => {
    const r = checkFunding({ amount: 10n * ONE, musdBalance: 5n * ONE, btcBalance: ONE / 1000n, plan, gasReserve: 1n });
    expect(r.status).toBe('insufficient_btc');
  });

  it('is unknown until balances have been read', () => {
    expect(checkFunding({ amount: 1n, musdBalance: null, btcBalance: ONE, gasReserve: 0n }).status).toBe('unknown');
  });
});

describe('pool vs Mezo oracle', () => {
  it('reports how much less MUSD the pool pays than the oracle value', () => {
    expect(poolVsOracleBps(ONE / 100n, 786n * ONE, 80_300n * ONE)).toBe(211); // 803 oracle vs 786 pool
    expect(poolVsOracleBps(ONE, 1n, null)).toBeNull();
  });
});
