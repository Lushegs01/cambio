/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merchant Pro billing in the self-hosted SQLite registry file (opened after the identity store has
 * validated the schema). Tables are created idempotently.
 */

import { DatabaseSync } from 'node:sqlite';
import { StoreUnavailableError } from '../identity/store.js';
import { extendSubscription, type ActivateResult, type BillingOrder, type BillingPayment, type BillingStore, type Subscription } from './store.js';

const APPLICATION_ID = 1128353090;

const parse = <T>(raw: unknown): T | null => {
  try {
    return raw === null || raw === undefined ? null : (JSON.parse(String(raw)) as T);
  } catch {
    return null;
  }
};

export class SqliteBillingStore implements BillingStore {
  readonly kind = 'sqlite' as const;
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
      const id = Number(this.db.prepare('PRAGMA application_id').get()!.application_id);
      if (id !== APPLICATION_ID) throw new Error('Open the identity store first: this is not a Cambio registry database.');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS billing_orders (
          id TEXT PRIMARY KEY, merchant TEXT NOT NULL, created_at INTEGER NOT NULL, order_json TEXT NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS billing_orders_by_merchant ON billing_orders(merchant, created_at DESC);
        CREATE TABLE IF NOT EXISTS billing_subscriptions (merchant TEXT PRIMARY KEY, sub_json TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS billing_payments (tx_hash TEXT PRIMARY KEY, order_id TEXT NOT NULL) STRICT;
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  private tx<T>(operation: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* keep the original error */ }
        throw error;
      }
    } catch {
      throw new StoreUnavailableError();
    }
  }

  private read<T>(operation: () => T): T {
    try { return operation(); } catch { throw new StoreUnavailableError(); }
  }

  async saveOrder(o: BillingOrder) {
    this.tx(() => this.db.prepare('INSERT OR IGNORE INTO billing_orders VALUES (?,?,?,?)').run(o.id, o.merchant, o.createdAt, JSON.stringify(o)));
  }

  async getOrder(id: string) {
    return this.read(() => parse<BillingOrder>(this.db.prepare('SELECT order_json FROM billing_orders WHERE id=?').get(id)?.order_json));
  }

  async listOrders(merchant: string, limit: number) {
    return this.read(() =>
      this.db.prepare('SELECT order_json FROM billing_orders WHERE merchant=? ORDER BY created_at DESC, id DESC LIMIT ?').all(merchant, limit)
        .map((r) => parse<BillingOrder>(r.order_json)).filter((o): o is BillingOrder => o !== null)
    );
  }

  async getSubscription(merchant: string) {
    return this.read(() => parse<Subscription>(this.db.prepare('SELECT sub_json FROM billing_subscriptions WHERE merchant=?').get(merchant)?.sub_json));
  }

  async activateOrder(id: string, payment: BillingPayment, now: number): Promise<ActivateResult> {
    return this.tx(() => {
      const order = parse<BillingOrder>(this.db.prepare('SELECT order_json FROM billing_orders WHERE id=?').get(id)?.order_json);
      if (!order) return { status: 'missing' } as const;
      const current = parse<Subscription>(this.db.prepare('SELECT sub_json FROM billing_subscriptions WHERE merchant=?').get(order.merchant)?.sub_json);
      if (order.status === 'paid') return { status: 'already_paid', order, subscription: current ?? extendSubscription(null, order, now) } as const;
      const tx = payment.txHash.toLowerCase();
      const used = this.db.prepare('SELECT order_id FROM billing_payments WHERE tx_hash=?').get(tx);
      if (used && String(used.order_id) !== id) return { status: 'tx_used', order } as const;
      const paid: BillingOrder = { ...order, status: 'paid', payment: { ...payment, txHash: tx } };
      const sub = extendSubscription(current, paid, now);
      this.db.prepare('UPDATE billing_orders SET order_json=? WHERE id=?').run(JSON.stringify(paid), id);
      this.db.prepare('INSERT INTO billing_subscriptions VALUES (?,?) ON CONFLICT(merchant) DO UPDATE SET sub_json=excluded.sub_json').run(order.merchant, JSON.stringify(sub));
      this.db.prepare('INSERT OR IGNORE INTO billing_payments VALUES (?,?)').run(tx, id);
      return { status: 'activated', order: paid, subscription: sub } as const;
    });
  }
}
