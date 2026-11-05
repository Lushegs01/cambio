/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merchant invoice view model: merges this device's requests with the server registry and derives each
 * invoice's status. "Paid" comes only from on-chain verification (by the server, or by this browser's own
 * RPC check); "unknown" is shown whenever that verification could not be completed.
 */

import type { Hex } from 'viem';
import { csvCell } from './csv';
import { formatUnitsExact } from './amounts';
import type { SignedPaymentRequest, StoredRequest } from './paymentRequest';
import type { ServerInvoice } from '../services/invoiceClient';

export type InvoiceStatus = 'paid' | 'paid_late' | 'pending' | 'expired' | 'unknown';

export interface LocalCheck {
  state: 'checking' | 'paid' | 'unpaid' | 'unknown';
  hash?: Hex;
  late?: boolean;
  message?: string;
}

export interface InvoiceRow {
  request: SignedPaymentRequest;
  signature: Hex;
  /** Verified settlement tx, from the server registry or this browser's on-chain check. */
  settlementTx: Hex | null;
  late: boolean;
  payer: string | null;
  paidAt: number | null;
  duplicatePayments: Hex[];
  /** Where the record lives. */
  synced: boolean;
  onDevice: boolean;
  status: InvoiceStatus;
  statusNote: string | null;
}

export function deriveStatus(row: Pick<InvoiceRow, 'settlementTx' | 'late'>, expiresAt: number, nowSeconds: number, check?: LocalCheck): { status: InvoiceStatus; note: string | null } {
  if (row.settlementTx) return { status: row.late ? 'paid_late' : 'paid', note: null };
  if (check?.state === 'paid' && check.hash) return { status: check.late ? 'paid_late' : 'paid', note: null };
  if (check?.state === 'unknown') return { status: 'unknown', note: check.message ?? 'Payment status could not be verified.' };
  if (nowSeconds >= expiresAt) return { status: 'expired', note: check?.state === 'unpaid' ? 'No payment found before or after expiry.' : null };
  return { status: 'pending', note: null };
}

/** Server records win for settlement (they are chain-verified); local records add device-only requests. */
export function mergeInvoices(local: StoredRequest[], server: ServerInvoice[], checks: Record<string, LocalCheck>, nowSeconds: number): InvoiceRow[] {
  const rows = new Map<string, InvoiceRow>();
  for (const s of server) {
    const key = s.request.id.toLowerCase();
    rows.set(key, {
      request: s.request,
      signature: s.signature,
      settlementTx: s.settlement?.txHash ?? null,
      late: s.settlement?.late ?? false,
      payer: s.settlement?.payer ?? null,
      paidAt: s.settlement?.paidAt ?? null,
      duplicatePayments: s.duplicatePayments ?? [],
      synced: true,
      onDevice: false,
      status: 'pending',
      statusNote: null,
    });
  }
  for (const l of local) {
    const key = l.request.id.toLowerCase();
    const existing = rows.get(key);
    if (existing) {
      // Only adopt a local settlement if it is for the same signed request.
      if (JSON.stringify(existing.request) === JSON.stringify(l.request)) {
        existing.onDevice = true;
        if (!existing.settlementTx && l.settlementTx) existing.settlementTx = l.settlementTx;
      }
      continue;
    }
    rows.set(key, { request: l.request, signature: l.signature, settlementTx: l.settlementTx ?? null, late: false, payer: null, paidAt: null, duplicatePayments: [], synced: false, onDevice: true, status: 'pending', statusNote: null });
  }
  return [...rows.values()]
    .map((r) => {
      const check = checks[r.request.id.toLowerCase()];
      if (!r.settlementTx && check?.state === 'paid' && check.hash) {
        r.settlementTx = check.hash;
        r.late = !!check.late;
      }
      const { status, note } = deriveStatus(r, r.request.expiresAt, nowSeconds, check);
      return { ...r, status, statusNote: note };
    })
    .sort((a, b) => b.request.createdAt - a.request.createdAt || (a.request.id < b.request.id ? 1 : -1));
}

export type InvoiceFilter = 'all' | 'pending' | 'paid' | 'expired' | 'unknown';

export function filterInvoices(rows: InvoiceRow[], filter: InvoiceFilter, query: string): InvoiceRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === 'paid' && r.status !== 'paid' && r.status !== 'paid_late') return false;
    if (filter !== 'all' && filter !== 'paid' && r.status !== filter) return false;
    if (!q) return true;
    const amount = formatUnitsExact(BigInt(r.request.amount), 18);
    return r.request.memo.toLowerCase().includes(q) || r.request.id.toLowerCase().includes(q) || amount.startsWith(q) || (r.settlementTx ?? '').toLowerCase().includes(q);
  });
}

export interface InvoiceTotals {
  count: number;
  paidCount: number;
  /** Sum of amounts of invoices with a verified settlement (on time or late), MUSD wei. */
  paidAmount: bigint;
  pendingCount: number;
  pendingAmount: bigint;
  expiredCount: number;
  unknownCount: number;
  duplicateCount: number;
}

export function invoiceTotals(rows: InvoiceRow[]): InvoiceTotals {
  const t: InvoiceTotals = { count: rows.length, paidCount: 0, paidAmount: 0n, pendingCount: 0, pendingAmount: 0n, expiredCount: 0, unknownCount: 0, duplicateCount: 0 };
  for (const r of rows) {
    const amount = BigInt(r.request.amount);
    if (r.status === 'paid' || r.status === 'paid_late') {
      t.paidCount++;
      t.paidAmount += amount;
    } else if (r.status === 'pending') {
      t.pendingCount++;
      t.pendingAmount += amount;
    } else if (r.status === 'expired') t.expiredCount++;
    else t.unknownCount++;
    if (r.duplicatePayments.length) t.duplicateCount++;
  }
  return t;
}

export function invoicesCsv(rows: InvoiceRow[], explorerTx: (hash: string) => string): string {
  const header = ['request_id', 'created_utc', 'expires_utc', 'amount_musd', 'note', 'status', 'settlement_tx', 'payer', 'paid_utc', 'explorer_url', 'duplicate_payments'];
  const iso = (sec: number | null) => (sec ? new Date(sec).toISOString() : '');
  const lines = rows.map((r) =>
    [
      r.request.id,
      iso(r.request.createdAt * 1000),
      iso(r.request.expiresAt * 1000),
      formatUnitsExact(BigInt(r.request.amount), 18),
      r.request.memo,
      r.status,
      r.settlementTx ?? '',
      r.payer ?? '',
      iso(r.paidAt),
      r.settlementTx ? explorerTx(r.settlementTx) : '',
      r.duplicatePayments.join(' '),
    ]
      .map((v) => csvCell(String(v)))
      .join(',')
  );
  return [header.join(','), ...lines].join('\r\n');
}

// ---------------------------------------------------------------------------------------------
// Merchant session token (per wallet, this browser). It authorizes listing invoices only.

const sessionKey = (address: string) => `cambio.merchantSession.v1:${address.toLowerCase()}`;

export function readMerchantSession(address: string, now = Date.now()): string | null {
  try {
    const raw = JSON.parse(localStorage.getItem(sessionKey(address)) || 'null') as { token?: unknown; expiresAt?: unknown } | null;
    if (!raw || typeof raw.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw.token) || typeof raw.expiresAt !== 'number' || raw.expiresAt <= now + 60_000) return null;
    return raw.token;
  } catch {
    return null;
  }
}

export function writeMerchantSession(address: string, token: string, expiresAt: number) {
  try {
    localStorage.setItem(sessionKey(address), JSON.stringify({ token, expiresAt }));
  } catch {
    // Session-only: the user signs in again next time.
  }
}

export function clearMerchantSession(address: string) {
  try {
    localStorage.removeItem(sessionKey(address));
  } catch {
    // ignore
  }
}
