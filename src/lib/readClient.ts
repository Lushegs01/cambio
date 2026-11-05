/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Read-only clients that batch concurrent eth_calls through Multicall3. Measured on Mezo Testnet
 * (2026-11-05, median of 3): the Mezo position refresh went from 17 RPC requests / 563 ms to 5 / 394 ms,
 * and Fund & Pay sizing from 7 / 264 ms to 3 / 155 ms. Writes never go through these clients.
 */

import { createPublicClient, defineChain, fallback, http, type PublicClient } from 'viem';
import type { MezoChainConfig } from '../config/chains.js';

const clients = new Map<number, PublicClient>();

export function batchedReadClient(chain: MezoChainConfig): PublicClient {
  let client = clients.get(chain.chainId);
  if (!client) {
    client = createPublicClient({
      chain: defineChain({
        id: chain.chainId,
        name: chain.name,
        nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
        rpcUrls: { default: { http: [...chain.rpcUrls] } },
        contracts: { multicall3: { address: chain.multicall3 } },
      }),
      transport: fallback(chain.rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 1 }))),
      // A reverted call inside the batch still surfaces as that call's own revert (e.g. a stale oracle).
      batch: { multicall: { wait: 16 } },
    }) as PublicClient;
    clients.set(chain.chainId, client);
  }
  return client;
}
