import { describe, expect, it } from 'vitest';
import { demoBalance, spendable, toBalanceState, type BtcBalance, type MusdBalance } from '../src/lib/balances';

const q = (over: Partial<{ data: bigint; status: 'pending' | 'error' | 'success'; error: unknown; dataUpdatedAt: number }>) => ({
  data: undefined,
  status: 'pending' as const,
  error: null,
  dataUpdatedAt: 0,
  ...over,
});
const ctx = { connected: true, supportedChain: true, decimals: 18, source: 'erc20-balanceOf' as const };

describe('typed balances', () => {
  it('never turns an RPC failure into a zero balance', () => {
    const b = toBalanceState('MUSD', ctx, q({ status: 'error', error: new Error('fetch failed') }));
    expect(b.status).toBe('error');
    expect(spendable(b)).toBeNull();
    expect('value' in b).toBe(false);
  });

  it('reports loading, disconnected and unsupported network distinctly', () => {
    expect(toBalanceState('MUSD', ctx, q({})).status).toBe('loading');
    expect(toBalanceState('MUSD', { ...ctx, connected: false }, q({ data: 5n, status: 'success' })).status).toBe('disconnected');
    expect(toBalanceState('MUSD', { ...ctx, supportedChain: false }, q({ data: 5n, status: 'success' })).status).toBe('unsupported_chain');
  });

  it('keeps the last good value but flags a failed refresh', () => {
    const b = toBalanceState('MUSD', ctx, q({ data: 7n, status: 'error', error: { shortMessage: 'timeout' }, dataUpdatedAt: 99 }));
    expect(b).toMatchObject({ status: 'ready', value: 7n, refreshError: 'timeout', updatedAt: 99 });
  });

  it('keeps native BTC and MUSD as different types', () => {
    const btc: BtcBalance = toBalanceState('BTC', { ...ctx, source: 'native-rpc' }, q({ data: 1n, status: 'success' }));
    // @ts-expect-error — a native BTC balance cannot be used where an MUSD balance is required
    const wrong: MusdBalance = btc;
    expect(wrong.asset).toBe('BTC');
    expect(btc.status === 'ready' && btc.source).toBe('native-rpc');
  });

  it('demo balances are marked simulated and are never spendable on-chain', () => {
    const d = demoBalance('MUSD', 100n);
    expect(d).toMatchObject({ status: 'ready', simulated: true, source: 'demo' });
    expect(spendable(d)).toBeNull();
  });
});
