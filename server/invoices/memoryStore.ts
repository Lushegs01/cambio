/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-process invoice store for tests and local development. Not durable, not shared between instances.
 */

import { applySettlement, compareNewestFirst, isBefore, sameSignedContent, type InsertResult, type InvoiceRecord, type InvoiceSettlement, type InvoiceStore, type ListCursor, type MerchantSession, type SessionChallenge } from './store.js';

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryInvoiceStore implements InvoiceStore {
  readonly kind = 'memory' as const;
  readonly durable = false;
  private invoices = new Map<string, InvoiceRecord>();
  private challenges = new Map<string, SessionChallenge>();
  private sessions = new Map<string, MerchantSession>();

  private key(recipient: string, id: string) {
    return `${recipient}:${id}`;
  }

  // No awaits between read and write: these cannot interleave with another request.
  async insertInvoice(record: InvoiceRecord, maxPerRecipient: number): Promise<InsertResult> {
    const existing = this.invoices.get(this.key(record.recipient, record.id));
    if (existing) return sameSignedContent(existing, record) ? 'exists' : 'conflict';
    let count = 0;
    for (const r of this.invoices.values()) if (r.recipient === record.recipient) count++;
    if (count >= maxPerRecipient) return 'limit';
    this.invoices.set(this.key(record.recipient, record.id), clone(record));
    return 'created';
  }

  async getInvoice(recipient: string, id: string) {
    const r = this.invoices.get(this.key(recipient, id));
    return r ? clone(r) : null;
  }

  async listInvoices(recipient: string, limit: number, before?: ListCursor) {
    return [...this.invoices.values()].filter((r) => r.recipient === recipient && isBefore(r, before)).sort(compareNewestFirst).slice(0, limit).map(clone);
  }

  async recordSettlement(recipient: string, id: string, s: InvoiceSettlement) {
    const current = this.invoices.get(this.key(recipient, id));
    if (!current) return null;
    const next = applySettlement(current, s);
    this.invoices.set(this.key(recipient, id), clone(next));
    return clone(next);
  }

  async saveChallenge(c: SessionChallenge) {
    this.challenges.set(c.nonce, clone(c));
    if (this.challenges.size > 10_000) {
      const now = Date.now();
      for (const [k, v] of this.challenges) if (v.expiresAt < now) this.challenges.delete(k);
    }
  }

  async getChallenge(nonce: string) {
    const c = this.challenges.get(nonce);
    return c ? clone(c) : null;
  }

  async consumeChallenge(nonce: string, now: number) {
    const c = this.challenges.get(nonce);
    if (!c || c.usedAt !== null || now >= c.expiresAt) return false;
    this.challenges.set(nonce, { ...c, usedAt: now });
    return true;
  }

  async saveSession(s: MerchantSession) {
    this.sessions.set(s.tokenHash, clone(s));
  }

  async getSession(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    return s ? clone(s) : null;
  }
}
