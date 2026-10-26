/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Activity history derived from the chain, not from client-written records.
 *
 * Sources, in order of preference:
 *  1. The Mezo Blockscout explorer index (MUSD token transfers for the address). Every row links to a
 *     transaction any reader can verify independently.
 *  2. Fallback: eth_getLogs over the most recent 10,000 blocks (~11 hours) straight from the RPC.
 *  3. This device's ledger of transactions it submitted, for pending/unknown/reverted items the
 *     indexer has not shown yet. Ledger entries never upgrade their own status.
 */

import { getAddress, isAddress, parseAbiItem, type Address, type Hex } from 'viem';
import type { MezoChainConfig } from '../config/chains';
import type { LedgerEntry } from './transactions';

export type ActivityStatus = 'confirmed' | 'pending' | 'reverted' | 'unknown' | 'simulated';
export type ActivitySource = 'explorer' | 'rpc-logs' | 'this-device' | 'demo';

export interface ActivityItem {
  key: string;
  mode: 'real' | 'demo';
  kind: 'send' | 'receive' | 'swap';
  status: ActivityStatus;
  amount: bigint;
  decimals: number;
  symbol: string;
  counterparty: Address | null;
  /** Label from the explorer (e.g. a verified contract name) or the username registry. */
  counterpartyName: string | null;
  hash: Hex | null;
  chainId: number | null;
  /** ms since epoch, or null when unknown. */
  timestamp: number | null;
  memo?: string;
  source: ActivitySource;
}

export interface ActivityResult {
  items: ActivityItem[];
  source: 'explorer' | 'rpc-logs' | 'none';
  /** Human-readable note about coverage, shown in the UI. */
  coverage: string;
  fetchedAt: number;
  error: string | null;
}

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const sameAddr = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function isSwapCounterparty(chain: MezoChainConfig, addr: string): boolean {
  return sameAddr(addr, chain.router) || chain.pools.some((p) => sameAddr(p.address, addr));
}

/** Parses a Blockscout /api/v2/addresses/{a}/token-transfers response. Malformed rows are dropped, not guessed. */
export function parseExplorerTransfers(json: unknown, owner: Address, chain: MezoChainConfig): ActivityItem[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const musd = chain.tokens.MUSD;
  const out: ActivityItem[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const it = raw as Record<string, any>;
    const hash = it?.transaction_hash ?? it?.tx_hash;
    const token = it?.token?.address ?? it?.token?.address_hash;
    const from = it?.from?.hash;
    const to = it?.to?.hash;
    const value = it?.total?.value;
    if (typeof hash !== 'string' || !HASH_RE.test(hash)) continue;
    if (!sameAddr(token, musd.address)) continue;
    if (typeof from !== 'string' || !isAddress(from, { strict: false }) || typeof to !== 'string' || !isAddress(to, { strict: false })) continue;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) continue;
    const outgoing = sameAddr(from, owner);
    const incoming = sameAddr(to, owner);
    if (!outgoing && !incoming) continue;
    const key = `${hash.toLowerCase()}:${it.log_index ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const counterparty = getAddress(outgoing ? to : from);
    const ts = typeof it.timestamp === 'string' ? Date.parse(it.timestamp) : NaN;
    const party = outgoing ? it.to : it.from;
    out.push({
      key,
      mode: 'real',
      kind: isSwapCounterparty(chain, counterparty) ? 'swap' : outgoing ? 'send' : 'receive',
      status: 'confirmed',
      amount: BigInt(value),
      decimals: musd.decimals,
      symbol: musd.symbol,
      counterparty,
      counterpartyName: typeof party?.name === 'string' && party.name ? party.name : null,
      hash: hash as Hex,
      chainId: chain.chainId,
      timestamp: Number.isFinite(ts) ? ts : null,
      source: 'explorer',
    });
  }
  return out;
}

export async function fetchExplorerActivity(
  chain: MezoChainConfig,
  owner: Address,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000
): Promise<ActivityItem[]> {
  const url = `${chain.explorerApiUrl}/api/v2/addresses/${owner}/token-transfers?type=ERC-20&token=${chain.tokens.MUSD.address}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (res.status === 404) return []; // address never seen by the indexer
    if (!res.ok) throw new Error(`Explorer responded ${res.status}`);
    const body = await res.json();
    if (!body || !Array.isArray(body.items)) throw new Error('Malformed explorer response');
    return parseExplorerTransfers(body, owner, chain);
  } finally {
    clearTimeout(timer);
  }
}

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
export const RPC_LOG_WINDOW = 9_999n;

export interface LogsClient {
  getBlockNumber(): Promise<bigint>;
  getLogs(args: any): Promise<any[]>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
}

export async function fetchRpcActivity(client: LogsClient, chain: MezoChainConfig, owner: Address): Promise<ActivityItem[]> {
  const head = await client.getBlockNumber();
  const fromBlock = head > RPC_LOG_WINDOW ? head - RPC_LOG_WINDOW : 0n;
  const base = { address: chain.tokens.MUSD.address, event: transferEvent, fromBlock, toBlock: head };
  const [sent, received] = await Promise.all([
    client.getLogs({ ...base, args: { from: owner } }),
    client.getLogs({ ...base, args: { to: owner } }),
  ]);
  const blocks = [...new Set([...sent, ...received].map((l) => l.blockNumber as bigint))].slice(0, 25);
  const times = new Map<bigint, number>();
  await Promise.all(
    blocks.map(async (bn) => {
      try {
        times.set(bn, Number((await client.getBlock({ blockNumber: bn })).timestamp) * 1000);
      } catch {
        // timestamp unknown; the row still links to the transaction
      }
    })
  );
  const seen = new Set<string>();
  const out: ActivityItem[] = [];
  for (const log of [...sent, ...received]) {
    const key = `${log.transactionHash}:${log.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const outgoing = sameAddr(log.args.from, owner);
    const counterparty = getAddress(outgoing ? log.args.to : log.args.from);
    out.push({
      key,
      mode: 'real',
      kind: isSwapCounterparty(chain, counterparty) ? 'swap' : outgoing ? 'send' : 'receive',
      status: 'confirmed',
      amount: log.args.value as bigint,
      decimals: chain.tokens.MUSD.decimals,
      symbol: 'MUSD',
      counterparty,
      counterpartyName: null,
      hash: log.transactionHash,
      chainId: chain.chainId,
      timestamp: times.get(log.blockNumber) ?? null,
      source: 'rpc-logs',
    });
  }
  return out.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

function ledgerToItem(e: LedgerEntry): ActivityItem {
  const status: ActivityStatus = e.status;
  return {
    key: `ledger:${e.hash}`,
    mode: 'real',
    kind: e.kind === 'swap' ? 'swap' : 'send',
    status,
    amount: BigInt(e.amount),
    decimals: e.decimals,
    symbol: e.kind === 'swap' && e.swap ? `${e.symbol} → ${e.swap.symbolOut}` : e.symbol,
    counterparty: e.to,
    counterpartyName: null,
    hash: e.hash,
    chainId: e.chainId,
    timestamp: e.blockTimestamp ?? e.submittedAt,
    memo: e.memo,
    source: 'this-device',
  };
}

/**
 * Chain-derived items are authoritative. Ledger entries contribute their private memo, and appear on
 * their own only while the chain index does not yet show them (pending, unknown, reverted, or non-MUSD swaps).
 */
export function mergeActivity(chainItems: ActivityItem[], ledger: LedgerEntry[]): ActivityItem[] {
  const byHash = new Map(ledger.filter((l) => l.kind !== 'approval').map((l) => [l.hash.toLowerCase(), l]));
  const merged = chainItems.map((item) => {
    const l = item.hash ? byHash.get(item.hash.toLowerCase()) : undefined;
    return l?.memo ? { ...item, memo: l.memo } : item;
  });
  const chainHashes = new Set(chainItems.map((i) => i.hash?.toLowerCase()));
  for (const l of byHash.values()) {
    if (!chainHashes.has(l.hash.toLowerCase())) merged.push(ledgerToItem(l));
  }
  return merged.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}
