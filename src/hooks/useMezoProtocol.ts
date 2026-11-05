/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { MezoChainConfig } from '../config/chains';
import { readOraclePrice, readProtocolParams, readTrove, type OracleReading, type ProtocolParams, type ReadClient, type TroveState } from '../lib/mezoProtocol';
import { publicClientFor } from '../lib/wagmiDeps';

export interface MezoProtocolSnapshot {
  oracle: OracleReading;
  /** Null when the oracle price is not usable (TCR and Recovery Mode depend on it). */
  params: ProtocolParams | null;
  /** Null without a wallet, or when the oracle price is not usable. */
  trove: TroveState | null;
}

/** PriceFeed refuses rounds older than 60 s, so 30 s keeps the reading usable without hammering the RPC. */
export const MEZO_PROTOCOL_REFRESH_MS = 30_000;

export async function loadMezoProtocol(client: ReadClient, chain: MezoChainConfig, owner: Address | null): Promise<MezoProtocolSnapshot> {
  const oracle = await readOraclePrice(client, chain);
  if (oracle.status !== 'ok') return { oracle, params: null, trove: null };
  const [params, trove] = await Promise.all([readProtocolParams(client, chain, oracle.price), owner ? readTrove(client, chain, owner, oracle.price) : Promise.resolve(null)]);
  return { oracle, params, trove };
}

/** Live Mezo oracle price, system health and (when a wallet is given) its trove. Read-only. */
export function useMezoProtocol(chain: MezoChainConfig | null, owner: Address | null, enabled = true) {
  return useQuery({
    queryKey: ['mezo-protocol', chain?.chainId ?? null, owner?.toLowerCase() ?? null],
    enabled: enabled && !!chain,
    queryFn: () => loadMezoProtocol(publicClientFor(chain!.chainId) as unknown as ReadClient, chain!, owner),
    refetchInterval: () => (typeof document === 'undefined' || document.visibilityState === 'visible' ? MEZO_PROTOCOL_REFRESH_MS : false),
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
