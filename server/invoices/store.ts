/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistence contract for merchant invoices (signed payment requests) and merchant sessions.
 *
 * Invariants every implementation must keep:
 *  - Invoices are keyed by (recipient, request id). A request can only be stored under the address
 *    whose EIP-712 signature it carries, so nobody can occupy another merchant's request id.
 *  - The signed request and signature are immutable once stored.
 *  - A settlement is written only by InvoiceService after it re-read the transaction from the chain.
 *    The first verified settlement wins; further verified payments are kept as duplicates.
 *  - Session tokens are stored only as SHA-256 hashes.
 */

import type { Hex } from 'viem';
import type { SignedPaymentRequest } from '../../src/lib/paymentRequest.js';

export interface InvoiceSettlement {
  txHash: string;
  payer: string;
  blockNumber: string;
  /** Block time, ms. */
  paidAt: number;
  late: boolean;
  /** When the server verified it, ms. */
  verifiedAt: number;
}

export interface InvoiceRecord {
  /** Lowercase 0x-prefixed 16-byte request id. */
  id: string;
  chainId: number;
  /** Lowercase recipient address. */
  recipient: string;
  request: SignedPaymentRequest;
  signature: Hex;
  /** Request creation / expiry, unix seconds (copied from the signed request). */
  createdAt: number;
  expiresAt: number;
  /** When the server stored it, ms. */
  storedAt: number;
  settlement: InvoiceSettlement | null;
  /** Further transactions that also verified as paying this request (possible double payments). */
  duplicatePayments: string[];
}

export interface ListCursor {
  createdAt: number;
  id: string;
}

export type InsertResult = 'created' | 'exists' | 'conflict' | 'limit';

export interface SessionChallenge {
  nonce: string;
  address: string;
  chainId: number;
  message: string;
  issuedAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export interface MerchantSession {
  tokenHash: string;
  address: string;
  createdAt: number;
  expiresAt: number;
}

export interface InvoiceStore {
  readonly kind: 'firestore' | 'sqlite' | 'memory';
  readonly durable: boolean;
  /** Atomic: store unless present; 'exists' when identical, 'conflict' when the stored copy differs, 'limit' at maxPerRecipient. */
  insertInvoice(record: InvoiceRecord, maxPerRecipient: number): Promise<InsertResult>;
  getInvoice(recipient: string, id: string): Promise<InvoiceRecord | null>;
  /** Newest first by (createdAt, id), strictly after the cursor. */
  listInvoices(recipient: string, limit: number, before?: ListCursor): Promise<InvoiceRecord[]>;
  /** Atomic read-modify-write through applySettlement(). Null when the invoice does not exist. */
  recordSettlement(recipient: string, id: string, settlement: InvoiceSettlement): Promise<InvoiceRecord | null>;
  saveChallenge(c: SessionChallenge): Promise<void>;
  getChallenge(nonce: string): Promise<SessionChallenge | null>;
  /** Atomic: marks an unused, unexpired challenge used. False if it was already used, expired or missing. */
  consumeChallenge(nonce: string, now: number): Promise<boolean>;
  saveSession(s: MerchantSession): Promise<void>;
  getSession(tokenHash: string): Promise<MerchantSession | null>;
}

export const MAX_DUPLICATES = 10;

/** Pure settlement merge shared by every store. */
export function applySettlement(current: InvoiceRecord, s: InvoiceSettlement): InvoiceRecord {
  if (!current.settlement) return { ...current, settlement: s };
  if (current.settlement.txHash.toLowerCase() === s.txHash.toLowerCase()) return current;
  if (current.duplicatePayments.some((h) => h.toLowerCase() === s.txHash.toLowerCase())) return current;
  // Keep the earliest payment as the settlement; later ones are duplicates.
  const earlier = BigInt(s.blockNumber) < BigInt(current.settlement.blockNumber);
  const settlement = earlier ? s : current.settlement;
  const duplicate = earlier ? current.settlement.txHash : s.txHash;
  return { ...current, settlement, duplicatePayments: [...current.duplicatePayments, duplicate].slice(0, MAX_DUPLICATES) };
}

/** Same signed content (request + signature)? */
export function sameSignedContent(a: InvoiceRecord, b: InvoiceRecord): boolean {
  return a.signature.toLowerCase() === b.signature.toLowerCase() && JSON.stringify(a.request) === JSON.stringify(b.request);
}

export function compareNewestFirst(a: InvoiceRecord, b: InvoiceRecord): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export function isBefore(r: InvoiceRecord, cursor?: ListCursor): boolean {
  if (!cursor) return true;
  return r.createdAt < cursor.createdAt || (r.createdAt === cursor.createdAt && r.id < cursor.id);
}
