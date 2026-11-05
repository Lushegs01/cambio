/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser client for the merchant invoice API. The server stores signed requests and records a
 * settlement only after verifying it on-chain itself; this client never sends a "paid" status.
 */

import type { Address, Hex } from 'viem';
import type { SignedPaymentRequest } from '../lib/paymentRequest';

export interface InvoiceSettlement {
  txHash: Hex;
  payer: string;
  blockNumber: string;
  paidAt: number;
  late: boolean;
  verifiedAt: number;
}

export interface ServerInvoice {
  id: Hex;
  chainId: number;
  recipient: Address;
  request: SignedPaymentRequest;
  signature: Hex;
  createdAt: number;
  expiresAt: number;
  storedAt: number;
  settlement: InvoiceSettlement | null;
  duplicatePayments: Hex[];
}

export class InvoiceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'InvoiceApiError';
  }
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  } catch {
    throw new InvoiceApiError(0, 'network', 'The invoice service could not be reached.');
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new InvoiceApiError(res.status, body?.error || 'error', body?.message || 'Request failed.');
  return body as T;
}

export function saveInvoice(request: SignedPaymentRequest, signature: Hex) {
  return call<{ invoice: ServerInvoice }>('/api/invoices', { method: 'POST', body: JSON.stringify({ request, signature }) }).then((r) => r.invoice);
}

export function getInvoice(recipient: string, id: string) {
  return call<{ invoice: ServerInvoice }>(`/api/invoices/${recipient}/${id}`).then((r) => r.invoice);
}

/** Asks the server to verify a payment hash on-chain. The server decides; the client only supplies the hash. */
export function submitSettlement(recipient: string, id: string, txHash: Hex) {
  return call<{ invoice: ServerInvoice; check: string }>(`/api/invoices/${recipient}/${id}/settlement`, { method: 'POST', body: JSON.stringify({ txHash }) }, 45_000).then((r) => r.invoice);
}

export function listInvoices(token: string, cursor?: string | null) {
  const q = new URLSearchParams({ limit: '100' });
  if (cursor) q.set('cursor', cursor);
  return call<{ items: ServerInvoice[]; nextCursor: string | null }>(`/api/invoices?${q.toString()}`, { headers: { authorization: `Bearer ${token}` } });
}

export async function listAllInvoices(token: string, maxPages = 10): Promise<{ items: ServerInvoice[]; truncated: boolean }> {
  const items: ServerInvoice[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page: { items: ServerInvoice[]; nextCursor: string | null } = await listInvoices(token, cursor);
    items.push(...page.items);
    if (!page.nextCursor) return { items, truncated: false };
    cursor = page.nextCursor;
  }
  return { items, truncated: true };
}

export function startMerchantSession(address: string, chainId: number) {
  return call<{ nonce: string; message: string; expiresAt: number }>('/api/merchant/challenge', { method: 'POST', body: JSON.stringify({ address, chainId }) });
}

export function completeMerchantSession(nonce: string, signature: Hex) {
  return call<{ token: string; address: Address; expiresAt: number }>('/api/merchant/session', { method: 'POST', body: JSON.stringify({ nonce, signature }) });
}
