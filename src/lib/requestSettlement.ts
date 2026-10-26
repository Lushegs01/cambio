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
import { fetchExplorerActivity } from './activity';
import { verifySettlement, type SettlementResult, type SignedPaymentRequest } from './paymentRequest';
import type { ReceiptWithLogs } from './musdTransfer';

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
export async function verifyPaymentTx(client: SettlementClient, req: SignedPaymentRequest, hash: Hex): Promise<SettlementCheck> {
  try {
    const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
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

/** Scans the recipient's indexed incoming MUSD transfers for one that settles this request. */
export async function findRequestSettlement(
  chain: MezoChainConfig,
  client: SettlementClient,
  req: SignedPaymentRequest,
  fetchImpl: typeof fetch = fetch
): Promise<SettlementCheck> {
  let items;
  try {
    items = await fetchExplorerActivity(chain, req.recipient, fetchImpl);
  } catch {
    return { state: 'error', message: 'The explorer index is unavailable, so payments cannot be searched right now.' };
  }
  const amount = BigInt(req.amount);
  const candidates = items
    .filter((i) => i.kind === 'receive' && i.amount === amount && i.hash && (i.timestamp === null || i.timestamp >= req.createdAt * 1000 - 60_000))
    .slice(0, 10);
  for (const c of candidates) {
    const check = await verifyPaymentTx(client, req, c.hash!);
    if (check.state === 'settled') return check;
    if (check.state === 'error' || check.state === 'not_found') return { state: 'error', message: 'Some indexed payments could not be verified by RPC. Try again shortly.' };
  }
  return { state: 'not_found' };
}
