/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo } from 'react';
import { useBalance, useReadContract } from 'wagmi';
import type { Address } from 'viem';
import { erc20Abi } from '../config/abis';
import { getChainConfig } from '../config/chains';
import { toBalanceState, type WalletBalances } from '../lib/balances';

const REFRESH_MS = 30_000;

/**
 * Reads the connected wallet's native BTC (eth_getBalance) and MUSD (balanceOf on the verified
 * MUSD contract for the connected chain). Both are scoped by chain and address, so switching
 * either refetches automatically.
 */
export function useWalletBalances(address: string | null | undefined, chainId: number | null | undefined) {
  const chain = getChainConfig(chainId);
  const connected = !!address;
  const enabled = connected && !!chain;
  const owner = (address ?? undefined) as Address | undefined;

  const native = useBalance({
    address: owner,
    chainId: chain?.chainId,
    query: { enabled, refetchInterval: REFRESH_MS, select: (d) => d.value },
  });

  const musd = useReadContract({
    address: chain?.tokens.MUSD.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: chain?.chainId,
    query: { enabled, refetchInterval: REFRESH_MS },
  });

  const balances: WalletBalances = useMemo(
    () => ({
      btc: toBalanceState(
        'BTC',
        { connected, supportedChain: !!chain, decimals: 18, source: 'native-rpc' },
        native as Parameters<typeof toBalanceState>[2]
      ),
      musd: toBalanceState(
        'MUSD',
        { connected, supportedChain: !!chain, decimals: chain?.tokens.MUSD.decimals ?? 18, source: 'erc20-balanceOf' },
        musd as Parameters<typeof toBalanceState>[2]
      ),
    }),
    [connected, chain, native.data, native.status, native.error, native.dataUpdatedAt, musd.data, musd.status, musd.error, musd.dataUpdatedAt]
  );

  const { refetch: refetchNative } = native;
  const { refetch: refetchMusd } = musd;
  const refetch = useCallback(async () => {
    if (!enabled) return;
    await Promise.allSettled([refetchNative(), refetchMusd()]);
  }, [enabled, refetchNative, refetchMusd]);

  return { balances, refetch, isRefreshing: native.isFetching || musd.isFetching };
}
