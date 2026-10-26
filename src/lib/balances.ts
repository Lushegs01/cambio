/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Typed balance states. Native BTC and the MUSD ERC-20 are separate assets read through separate
 * RPC methods; the `asset` literal makes it a type error to render one where the other is expected.
 */

export type BalanceSource = 'native-rpc' | 'erc20-balanceOf' | 'demo';

export type BalanceState<A extends string> =
  | { asset: A; status: 'disconnected' }
  | { asset: A; status: 'unsupported_chain' }
  | { asset: A; status: 'loading' }
  | { asset: A; status: 'error'; error: string }
  | {
      asset: A;
      status: 'ready';
      value: bigint;
      decimals: number;
      /** When the value was read (ms since epoch). */
      updatedAt: number;
      source: BalanceSource;
      /** True only in demo mode. A simulated balance must never be used for a real transaction. */
      simulated: boolean;
      /** Set when the latest refresh failed and `value` is the last successful read. */
      refreshError?: string;
    };

export type BtcBalance = BalanceState<'BTC'>;
export type MusdBalance = BalanceState<'MUSD'>;

export interface WalletBalances {
  btc: BtcBalance;
  musd: MusdBalance;
}

/** The subset of a react-query/wagmi result that the mapper needs. */
export interface QueryLike<T> {
  data: T | undefined;
  status: 'pending' | 'error' | 'success';
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  error: unknown;
  dataUpdatedAt: number;
}

function errorText(err: unknown): string {
  if (!err) return 'Balance unavailable';
  const e = err as { shortMessage?: string; message?: string };
  return (e.shortMessage || e.message || 'Balance unavailable').split('\n')[0];
}

export function toBalanceState<A extends string>(
  asset: A,
  ctx: { connected: boolean; supportedChain: boolean; decimals: number; source: BalanceSource },
  query: QueryLike<bigint>
): BalanceState<A> {
  if (!ctx.connected) return { asset, status: 'disconnected' };
  if (!ctx.supportedChain) return { asset, status: 'unsupported_chain' };

  // A previous successful read survives a failed refresh, but is flagged so the UI can say so.
  if (query.data !== undefined && typeof query.data === 'bigint') {
    return {
      asset,
      status: 'ready',
      value: query.data,
      decimals: ctx.decimals,
      updatedAt: query.dataUpdatedAt || Date.now(),
      source: ctx.source,
      simulated: false,
      refreshError: query.status === 'error' ? errorText(query.error) : undefined,
    };
  }
  if (query.status === 'error') return { asset, status: 'error', error: errorText(query.error) };
  return { asset, status: 'loading' };
}

export function demoBalance<A extends string>(asset: A, value: bigint, decimals = 18): BalanceState<A> {
  return { asset, status: 'ready', value, decimals, updatedAt: Date.now(), source: 'demo', simulated: true };
}

/** Spendable on-chain value, or null when the balance is not known to be real and current. */
export function spendable<A extends string>(b: BalanceState<A>): bigint | null {
  if (b.status !== 'ready' || b.simulated) return null;
  return b.value;
}
