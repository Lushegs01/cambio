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

// ---------------------------------------------------------------------------------------------
// Merchant Pro billing (testnet). The server fixes price, treasury and period, and grants entitlement
// only after verifying the MUSD payment on-chain; the client supplies nothing but the hash.

export interface BillingOrder {
  id: Hex;
  merchant: string;
  chainId: number;
  token: Address;
  treasury: Address;
  amount: string;
  periodDays: number;
  createdAt: number;
  expiresAt: number;
  status: 'open' | 'paid';
  payment: { txHash: Hex; payer: string; blockNumber: string; paidAt: number; verifiedAt: number; late: boolean } | null;
}

export interface BillingStatus {
  enabled: boolean;
  chainId: number;
  isTestnet: boolean;
  priceMusd: string;
  amount: string;
  periodDays: number;
  treasury: Address | null;
  active: boolean;
  proUntil: number | null;
  orders: BillingOrder[];
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export function getBillingStatus(token: string) {
  return call<BillingStatus>('/api/billing/status', { headers: bearer(token) });
}

export function createBillingOrder(token: string) {
  return call<{ order: BillingOrder }>('/api/billing/orders', { method: 'POST', body: '{}', headers: bearer(token) }).then((r) => r.order);
}

export function submitBillingPayment(token: string, orderId: string, txHash: Hex) {
  return call<BillingStatus>(`/api/billing/orders/${orderId}/payment`, { method: 'POST', body: JSON.stringify({ txHash }), headers: bearer(token) }, 45_000);
}

/** Pro: the server-verified reconciliation report. Throws InvoiceApiError(402) without an active subscription. */
export async function downloadReconciliationReport(token: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch('/api/invoices/report.csv', { headers: bearer(token) });
  } catch {
    throw new InvoiceApiError(0, 'network', 'The invoice service could not be reached.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new InvoiceApiError(res.status, body?.error || 'error', body?.message || 'Request failed.');
  }
  return res.blob();
}
