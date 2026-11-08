/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-process billing store for tests and local development. Not durable.
 */

import { extendSubscription, type ActivateResult, type BillingOrder, type BillingPayment, type BillingStore, type Subscription } from './store.js';

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryBillingStore implements BillingStore {
  readonly kind = 'memory' as const;
  private orders = new Map<string, BillingOrder>();
  private subs = new Map<string, Subscription>();
  private usedTx = new Map<string, string>();

  async saveOrder(order: BillingOrder) {
    if (!this.orders.has(order.id)) this.orders.set(order.id, clone(order));
  }

  async getOrder(id: string) {
    const o = this.orders.get(id);
    return o ? clone(o) : null;
  }

  async listOrders(merchant: string, limit: number) {
    return [...this.orders.values()].filter((o) => o.merchant === merchant).sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)).slice(0, limit).map(clone);
  }

  async getSubscription(merchant: string) {
    const s = this.subs.get(merchant);
    return s ? clone(s) : null;
  }

  // No awaits between reads and writes: requests cannot interleave.
  async activateOrder(id: string, payment: BillingPayment, now: number): Promise<ActivateResult> {
    const order = this.orders.get(id);
    if (!order) return { status: 'missing' };
    const tx = payment.txHash.toLowerCase();
    if (order.status === 'paid') {
      return { status: 'already_paid', order: clone(order), subscription: clone(this.subs.get(order.merchant) ?? extendSubscription(null, order, now)) };
    }
    const usedBy = this.usedTx.get(tx);
    if (usedBy && usedBy !== id) return { status: 'tx_used', order: clone(order) };
    const paid: BillingOrder = { ...order, status: 'paid', payment: { ...payment, txHash: tx } };
    const sub = extendSubscription(this.subs.get(order.merchant) ?? null, paid, now);
    this.orders.set(id, paid);
    this.subs.set(order.merchant, sub);
    this.usedTx.set(tx, id);
    return { status: 'activated', order: clone(paid), subscription: clone(sub) };
  }
}
