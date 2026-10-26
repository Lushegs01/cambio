import { describe, expect, it, vi } from 'vitest';
import { UserRejectedRequestError, type Hex } from 'viem';
import { executeSwap, fetchSwapQuote, priceImpactBps, receivedFromReceipt, routeFor, QUOTE_TTL_MS, type QuoteClient, type SwapDeps } from '../src/lib/swap';
import { MEZO_TESTNET } from '../src/config/chains';
import { ALICE, HASH, receipt, transferLog } from './helpers';

const C = MEZO_TESTNET;
const ONE = 10n ** 18n;

/** Fake router: constant-price pool with a 4 bps fee and ~0.5% impact on large trades. */
function quoteClient(outPerIn = 12_700n * 10n ** 9n, opts: { zero?: boolean } = {}): QuoteClient {
  return {
    getBlockNumber: async () => 16_300_000n,
    readContract: vi.fn(async ({ functionName, args }: any) => {
      if (functionName === 'getFee') return 4n;
      const amountIn = args[0] as bigint;
      if (opts.zero) return [amountIn, 0n];
      const ideal = (amountIn * outPerIn) / ONE;
      const impact = amountIn >= 1000n * ONE ? (ideal * 50n) / 10_000n : 0n;
      return [amountIn, ideal - impact];
    }),
  };
}

describe('swap quotes come from the router, not price ratios', () => {
  it('only offers verified direct pools', () => {
    expect(routeFor(C, 'MUSD', 'BTC')?.pool).toBe(C.pools[0].address);
    expect(routeFor(C, 'BTC', 'mUSDC')).toBeNull();
    expect(routeFor(C, 'MUSD', 'MUSD')).toBeNull();
  });

  it('computes minimum received from the router output and the on-chain fee', async () => {
    const q = await fetchSwapQuote(quoteClient(), C, 'MUSD', 'BTC', 100n * ONE, 50, 1_000);
    expect(q.amountOut).toBe(1_270_000_000_000_000n);
    expect(q.minAmountOut).toBe((q.amountOut * 9950n) / 10_000n);
    expect(q).toMatchObject({ feeBps: 4, slippageBps: 50, fetchedAt: 1_000, blockNumber: 16_300_000n, route: { stable: false, factory: C.poolFactory } });
    expect(q.priceImpactBps).toBe(0);
  });

  it('measures price impact against a probe quote on the same pool', async () => {
    const q = await fetchSwapQuote(quoteClient(), C, 'MUSD', 'BTC', 2000n * ONE, 50);
    expect(q.priceImpactBps).toBe(50);
    expect(priceImpactBps(100n, 90n, 1n, 1n)).toBe(1000);
    expect(priceImpactBps(100n, 100n, 1n, 1n)).toBe(0);
  });

  it('refuses empty pools, unsupported pairs and unsafe slippage', async () => {
    await expect(fetchSwapQuote(quoteClient(1n, { zero: true }), C, 'MUSD', 'mUSDT', ONE, 50)).rejects.toThrow(/insufficient liquidity/);
    await expect(fetchSwapQuote(quoteClient(), C, 'BTC', 'mUSDT', ONE, 50)).rejects.toThrow(/No verified/);
    await expect(fetchSwapQuote(quoteClient(), C, 'MUSD', 'BTC', ONE, 501)).rejects.toThrow(/Slippage/);
    await expect(fetchSwapQuote(quoteClient(), C, 'MUSD', 'BTC', ONE, 0)).rejects.toThrow(/Slippage/);
  });
});

describe('executeSwap', () => {
  const BTC = C.tokens.BTC.address;
  async function setup(over: Partial<SwapDeps> = {}, clientOutPerIn?: bigint) {
    const quote = await fetchSwapQuote(quoteClient(), C, 'MUSD', 'BTC', 100n * ONE, 50, Date.now());
    const deps: SwapDeps = {
      getConnection: () => ({ address: ALICE, chainId: C.chainId }),
      quoteClient: quoteClient(clientOutPerIn),
      readAllowance: async () => 0n,
      readTokenBalance: async () => 1000n * ONE,
      readNativeBalance: async () => 10n ** 15n,
      sendApprove: vi.fn(async () => ('0x' + '0a'.repeat(32)) as Hex),
      simulateSwap: vi.fn(async () => undefined),
      sendSwap: vi.fn(async () => HASH),
      waitForReceipt: vi.fn(async ({ hash }) => (hash === HASH ? receipt('success', [transferLog(C.tokens.MUSD.address, ALICE, C.pools[0].address, 100n * ONE), transferLog(BTC, C.router, ALICE, 1_268_000_000_000_000n)]) : receipt('success'))),
      getBlockTimestamp: async () => 1,
      ...over,
    };
    return { deps, quote };
  }

  it('approves the exact amount, re-quotes, simulates, swaps and reports the amount actually received', async () => {
    const { deps, quote } = await setup();
    const phases: string[] = [];
    const out = await executeSwap(deps, C, ALICE, quote, (p) => phases.push(p.phase));
    expect(deps.sendApprove).toHaveBeenCalledWith(expect.objectContaining({ spender: C.router, amount: 100n * ONE }));
    expect(deps.simulateSwap).toHaveBeenCalledBefore(deps.sendSwap as never);
    expect(out.phase.phase).toBe('confirmed');
    expect(out.received).toBe(1_268_000_000_000_000n);
    expect(phases.at(-1)).toBe('confirmed');
  });

  it('skips approval when the allowance already covers the amount', async () => {
    const { deps, quote } = await setup({ readAllowance: async () => 100n * ONE });
    await executeSwap(deps, C, ALICE, quote, () => undefined);
    expect(deps.sendApprove).not.toHaveBeenCalled();
  });

  it('aborts before signing if the fresh quote falls below the minimum', async () => {
    const { deps, quote } = await setup({}, 12_000n * 10n ** 9n); // price moved ~5.5%
    const out = await executeSwap(deps, C, ALICE, quote, () => undefined);
    expect(out.phase).toMatchObject({ phase: 'failed', message: expect.stringMatching(/slippage/) });
    expect(deps.sendSwap).not.toHaveBeenCalled();
  });

  it('aborts if the on-chain simulation reverts', async () => {
    const { deps, quote } = await setup({ simulateSwap: vi.fn(async () => { throw new Error('execution reverted: INSUFFICIENT_OUTPUT_AMOUNT'); }) });
    const out = await executeSwap(deps, C, ALICE, quote, () => undefined);
    expect(out.phase.phase).toBe('failed');
    expect(deps.sendSwap).not.toHaveBeenCalled();
  });

  it('refuses an expired quote', async () => {
    const { deps, quote } = await setup();
    const out = await executeSwap(deps, C, ALICE, { ...quote, fetchedAt: Date.now() - QUOTE_TTL_MS - 1 }, () => undefined);
    expect(out.phase).toMatchObject({ phase: 'failed', message: expect.stringMatching(/expired/) });
  });

  it('reports rejection, revert and wrong network truthfully', async () => {
    const rej = await setup({ sendSwap: vi.fn(async () => { throw new UserRejectedRequestError(new Error('no')); }) });
    expect((await executeSwap(rej.deps, C, ALICE, rej.quote, () => undefined)).phase.phase).toBe('rejected');
    const rev = await setup({ waitForReceipt: vi.fn(async () => receipt('reverted')) });
    rev.deps.readAllowance = async () => 100n * ONE;
    const r = await executeSwap(rev.deps, C, ALICE, rev.quote, () => undefined);
    expect(r.phase.phase).toBe('reverted');
    expect(r.received).toBeNull();
    const wrong = await setup({ getConnection: () => ({ address: ALICE, chainId: 31612 }) });
    expect((await executeSwap(wrong.deps, C, ALICE, wrong.quote, () => undefined)).phase).toMatchObject({ phase: 'failed', code: 'wrong_chain' });
  });

  it('sums only Transfer events of the output token to the user', () => {
    const r = receipt('success', [transferLog(BTC, C.router, ALICE, 5n), transferLog(BTC, C.router, C.router, 7n), transferLog(C.tokens.MUSD.address, ALICE, C.router, 9n)]);
    expect(receivedFromReceipt(r, BTC, ALICE)).toBe(5n);
  });
});
