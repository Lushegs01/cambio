/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Finds and verifies on-chain settlement of a signed payment request.
 * A request is "paid" only when a transaction's calldata, receipt status and MUSD Transfer event all
 * match the signed request (see verifySettlement). Nothing here trusts a client-side "paid" flag.
 */

import type { Address, Hex } from 'viem';
import type { MezoChainConfig } from '../config/chains';
import { parseAbiItem } from 'viem';
import { fetchExplorerTransfersPage, RPC_LOG_WINDOW, type ExplorerPageParams, type LogsClient } from './activity';
import { verifySettlement, type SettlementResult, type SignedPaymentRequest } from './paymentRequest';
import type { ReceiptWithLogs } from './musdTransfer';
import { NOT_FOUND_RETRY_DELAYS_MS, retryNotFound } from './rpcRetry';

export interface SettlementClient {
  getTransaction(a: { hash: Hex }): Promise<{ hash: Hex; from: Address; to: Address | null; input: Hex; chainId?: number }>;
  getTransactionReceipt(a: { hash: Hex }): Promise<ReceiptWithLogs>;
  getBlock(a: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
}

export type SettlementCheck =
  | { state: 'settled'; hash: Hex; result: Extract<SettlementResult, { status: 'settled' | 'settled_after_expiry' }> }
  | { state: 'not_found' }
  | { state: 'invalid'; hash: Hex; result: Exclude<SettlementResult, { status: 'settled' | 'settled_after_expiry' }> }
  | { state: 'error'; message: string };

/** Verifies one specific transaction hash against a request (used for payment-proof links). */
export async function verifyPaymentTx(client: SettlementClient, req: SignedPaymentRequest, hash: Hex, retryDelays: readonly number[] = NOT_FOUND_RETRY_DELAYS_MS): Promise<SettlementCheck> {
  try {
    // A lagging RPC node can answer "not found" for a mined transaction; retry before concluding.
    const [tx, receipt] = await Promise.all([
      retryNotFound(() => client.getTransaction({ hash }), retryDelays),
      retryNotFound(() => client.getTransactionReceipt({ hash }), retryDelays),
    ]);
    if (tx.hash.toLowerCase() !== hash.toLowerCase()) return { state: 'error', message: 'RPC returned a different transaction hash.' };
    let ts: number | null = null;
    try {
      ts = Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp) * 1000;
    } catch {
      return { state: 'error', message: 'Could not verify the payment block timestamp.' };
    }
    const result = verifySettlement(req, tx, receipt, ts);
    return result.status === 'settled' || result.status === 'settled_after_expiry'
      ? { state: 'settled', hash, result }
      : { state: 'invalid', hash, result };
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    if (/NotFound/i.test(name)) return { state: 'not_found' };
    return { state: 'error', message: 'Could not read the transaction from the network.' };
  }
}

export type SettlementSearch =
  | SettlementCheck
  /** The search could not cover the whole period since the request was created: payment status is unknown. */
  | { state: 'incomplete'; message: string };

export interface SearchOptions {
  /** Explorer pages of 50 transfers to read, newest first. */
  maxPages?: number;
  /** Candidate transactions (right amount, right time) to verify by RPC. */
  maxCandidates?: number;
  /** RPC log-scan fallback: chunks of RPC_LOG_WINDOW blocks, newest first. */
  maxLogChunks?: number;
  retryDelays?: readonly number[];
}

const SLACK_MS = 60_000;

/**
 * Finds the transaction that settles a request, by scanning the recipient's incoming MUSD transfers back
 * to the request's creation time and verifying each matching candidate on-chain.
 *
 * "not_found" is returned only when the whole window since the request was created was covered. If the
 * explorer pagination limit, the candidate limit or the RPC log window runs out first, the result is
 * "incomplete" (unknown), never "unpaid". A missing index entry is not evidence of non-payment.
 */
export async function findRequestSettlement(
  chain: MezoChainConfig,
  client: SettlementClient & Partial<LogsClient>,
  req: SignedPaymentRequest,
  fetchImpl: typeof fetch = fetch,
  opts: SearchOptions = {}
): Promise<SettlementSearch> {
  const maxPages = opts.maxPages ?? 10;
  const maxCandidates = opts.maxCandidates ?? 25;
  const amount = BigInt(req.amount);
  const since = req.createdAt * 1000 - SLACK_MS;

  let candidates: Hex[] = [];
  let complete = false;
  let explorerFailed = false;
  try {
    let params: ExplorerPageParams | null = null;
    for (let page = 0; page < maxPages; page++) {
      const p = await fetchExplorerTransfersPage(chain, req.recipient, params, fetchImpl);
      for (const i of p.items) {
        if (i.kind === 'receive' && i.amount === amount && i.hash && (i.timestamp === null || i.timestamp >= since)) candidates.push(i.hash);
      }
      if (!p.next || (p.oldest !== null && p.oldest < since)) {
        complete = true;
        break;
      }
      params = p.next;
    }
  } catch {
    explorerFailed = true;
  }

  if (explorerFailed) {
    if (!client.getLogs || !client.getBlockNumber) return { state: 'error', message: 'The explorer index is unavailable, so payments cannot be searched right now.' };
    const logs = await scanTransferLogs(client as LogsClient & SettlementClient, chain, req, opts.maxLogChunks ?? 5).catch(() => null);
    if (!logs) return { state: 'error', message: 'Neither the explorer nor the RPC could be searched right now.' };
    candidates = logs.hashes;
    complete = logs.complete;
  }

  candidates = [...new Set(candidates.map((h) => h.toLowerCase() as Hex))];
  if (candidates.length > maxCandidates) complete = false;
  let unverifiable = false;
  for (const hash of candidates.slice(0, maxCandidates)) {
    const check = await verifyPaymentTx(client, req, hash, opts.retryDelays);
    if (check.state === 'settled') return check;
    if (check.state === 'error' || check.state === 'not_found') unverifiable = true;
  }
  if (unverifiable) return { state: 'incomplete', message: 'Some matching transfers could not be verified by RPC. Try again shortly.' };
  if (!complete) {
    return {
      state: 'incomplete',
      message: explorerFailed
        ? 'The explorer is unavailable and the RPC fallback only covers recent blocks. Payment status is unknown; try again later.'
        : 'This request is older than the history Cambio searched. Payment status is unknown; open the payer’s proof link or check the explorer.',
    };
  }
  return { state: 'not_found' };
}

const transferToEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/** RPC fallback: MUSD Transfer logs to the recipient of exactly the amount, newest chunks first. */
export async function scanTransferLogs(
  client: LogsClient,
  chain: MezoChainConfig,
  req: SignedPaymentRequest,
  maxChunks: number
): Promise<{ hashes: Hex[]; complete: boolean }> {
  const head = await client.getBlockNumber();
  const amount = BigInt(req.amount);
  const hashes: Hex[] = [];
  let to = head;
  for (let i = 0; i < maxChunks && to >= 0n; i++) {
    const from = to > RPC_LOG_WINDOW ? to - RPC_LOG_WINDOW : 0n;
    const logs = await client.getLogs({ address: chain.tokens.MUSD.address, event: transferToEvent, args: { to: req.recipient }, fromBlock: from, toBlock: to });
    for (const l of logs) if (l.args?.value === amount && l.transactionHash) hashes.push(l.transactionHash as Hex);
    if (from === 0n) return { hashes, complete: true };
    const ts = Number((await client.getBlock({ blockNumber: from })).timestamp) * 1000;
    if (ts < req.createdAt * 1000 - SLACK_MS) return { hashes, complete: true };
    to = from - 1n;
  }
  return { hashes, complete: false };
}
