/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Invoices on Cloud Firestore via the Admin SDK. Browser clients cannot read or write any of these
 * collections (firestore.rules denies everything not explicitly allowed).
 *
 *   invoices/{recipient}_{id}          InvoiceRecord (kept; not subject to TTL)
 *   invoice_owners/{recipient}         { count } — enforces the per-recipient cap inside transactions
 *   merchant_challenges/{nonce}        SessionChallenge (+ ttl: Date for a Firestore TTL policy)
 *   merchant_sessions/{sha256(token)}  MerchantSession  (+ ttl: Date for a Firestore TTL policy)
 *
 * Listing needs the composite index in firestore.indexes.json (recipient ASC, createdAt DESC, id DESC).
 */

import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { StoreUnavailableError } from '../identity/store.js';
import { applySettlement, sameSignedContent, type InsertResult, type InvoiceRecord, type InvoiceSettlement, type InvoiceStore, type ListCursor, type MerchantSession, type SessionChallenge } from './store.js';

export const INVOICE_COLLECTIONS = {
  invoices: 'invoices',
  owners: 'invoice_owners',
  challenges: 'merchant_challenges',
  sessions: 'merchant_sessions',
} as const;

function asRecord(d: DocumentData | undefined): InvoiceRecord | null {
  if (!d || typeof d.id !== 'string' || typeof d.recipient !== 'string' || !d.request || typeof d.signature !== 'string') return null;
  return {
    id: d.id,
    chainId: Number(d.chainId),
    recipient: d.recipient,
    request: d.request,
    signature: d.signature as InvoiceRecord['signature'],
    createdAt: Number(d.createdAt),
    expiresAt: Number(d.expiresAt),
    storedAt: Number(d.storedAt),
    settlement: d.settlement ?? null,
    duplicatePayments: Array.isArray(d.duplicatePayments) ? d.duplicatePayments : [],
  };
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if ([4, 7, 14, 16, 'unavailable', 'permission-denied', 'unauthenticated'].includes(code as never)) throw new StoreUnavailableError(String((err as Error).message || err));
    throw err;
  }
}

export class FirestoreInvoiceStore implements InvoiceStore {
  readonly kind = 'firestore' as const;
  constructor(private readonly db: Firestore, readonly durable = true) {}

  private ref(recipient: string, id: string) {
    return this.db.collection(INVOICE_COLLECTIONS.invoices).doc(`${recipient}_${id}`);
  }

  async insertInvoice(r: InvoiceRecord, maxPerRecipient: number): Promise<InsertResult> {
    return guard(() =>
      this.db.runTransaction(async (tx) => {
        const ref = this.ref(r.recipient, r.id);
        const ownerRef = this.db.collection(INVOICE_COLLECTIONS.owners).doc(r.recipient);
        const [snap, owner] = await Promise.all([tx.get(ref), tx.get(ownerRef)]);
        const existing = asRecord(snap.data());
        if (existing) return sameSignedContent(existing, r) ? 'exists' : 'conflict';
        const count = Number(owner.data()?.count ?? 0);
        if (count >= maxPerRecipient) return 'limit';
        tx.create(ref, { ...r });
        tx.set(ownerRef, { count: count + 1 });
        return 'created' as const;
      })
    );
  }

  async getInvoice(recipient: string, id: string) {
    return guard(async () => {
      const r = asRecord((await this.ref(recipient, id).get()).data());
      return r && r.recipient === recipient && r.id === id ? r : null;
    });
  }

  async listInvoices(recipient: string, limit: number, before?: ListCursor) {
    return guard(async () => {
      let q = this.db.collection(INVOICE_COLLECTIONS.invoices).where('recipient', '==', recipient).orderBy('createdAt', 'desc').orderBy('id', 'desc');
      if (before) q = q.startAfter(before.createdAt, before.id);
      const snap = await q.limit(limit).get();
      return snap.docs.map((d) => asRecord(d.data())).filter((r): r is InvoiceRecord => r !== null);
    });
  }

  async recordSettlement(recipient: string, id: string, s: InvoiceSettlement) {
    return guard(() =>
      this.db.runTransaction(async (tx) => {
        const ref = this.ref(recipient, id);
        const current = asRecord((await tx.get(ref)).data());
        if (!current) return null;
        const next = applySettlement(current, s);
        tx.update(ref, { settlement: next.settlement, duplicatePayments: next.duplicatePayments });
        return next;
      })
    );
  }

  async saveChallenge(c: SessionChallenge) {
    await guard(() => this.db.collection(INVOICE_COLLECTIONS.challenges).doc(c.nonce).create({ ...c, ttl: new Date(c.expiresAt + 86_400_000) }));
  }

  async getChallenge(nonce: string) {
    return guard(async () => {
      const d = (await this.db.collection(INVOICE_COLLECTIONS.challenges).doc(nonce).get()).data();
      if (!d || typeof d.nonce !== 'string') return null;
      return { nonce: d.nonce, address: d.address, chainId: Number(d.chainId), message: d.message, issuedAt: Number(d.issuedAt), expiresAt: Number(d.expiresAt), usedAt: d.usedAt === null || d.usedAt === undefined ? null : Number(d.usedAt) };
    });
  }

  async consumeChallenge(nonce: string, now: number) {
    return guard(() =>
      this.db.runTransaction(async (tx) => {
        const ref = this.db.collection(INVOICE_COLLECTIONS.challenges).doc(nonce);
        const d = (await tx.get(ref)).data();
        if (!d || (d.usedAt !== null && d.usedAt !== undefined) || now >= Number(d.expiresAt)) return false;
        tx.update(ref, { usedAt: now });
        return true;
      })
    );
  }

  async saveSession(s: MerchantSession) {
    await guard(() => this.db.collection(INVOICE_COLLECTIONS.sessions).doc(s.tokenHash).create({ ...s, ttl: new Date(s.expiresAt) }));
  }

  async getSession(tokenHash: string) {
    return guard(async () => {
      const d = (await this.db.collection(INVOICE_COLLECTIONS.sessions).doc(tokenHash).get()).data();
      if (!d || typeof d.address !== 'string') return null;
      return { tokenHash, address: d.address, createdAt: Number(d.createdAt), expiresAt: Number(d.expiresAt) };
    });
  }
}
