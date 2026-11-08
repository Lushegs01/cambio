/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merchant Pro billing on Cloud Firestore (Admin SDK). Browser clients have no access (firestore.rules).
 *
 *   billing_orders/{orderId}               BillingOrder
 *   billing_subscriptions/{merchant}       Subscription
 *   billing_payments/{txHash}              { orderId } — one transaction credits at most one order
 *
 * Listing orders needs the composite index (merchant ASC, createdAt DESC) in firestore.indexes.json.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { StoreUnavailableError } from '../identity/store.js';
import { extendSubscription, type ActivateResult, type BillingOrder, type BillingPayment, type BillingStore, type Subscription } from './store.js';

export const BILLING_COLLECTIONS = {
  orders: 'billing_orders',
  subscriptions: 'billing_subscriptions',
  payments: 'billing_payments',
} as const;

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if ([4, 7, 14, 16, 'unavailable', 'permission-denied', 'unauthenticated'].includes(code as never)) throw new StoreUnavailableError(String((err as Error).message || err));
    throw err;
  }
}

const asOrder = (d: FirebaseFirestore.DocumentData | undefined): BillingOrder | null =>
  d && typeof d.id === 'string' && typeof d.merchant === 'string' ? ({ ...d, payment: d.payment ?? null } as BillingOrder) : null;
const asSub = (d: FirebaseFirestore.DocumentData | undefined): Subscription | null =>
  d && typeof d.merchant === 'string' ? { merchant: d.merchant, proUntil: Number(d.proUntil), orders: Array.isArray(d.orders) ? d.orders : [], updatedAt: Number(d.updatedAt) } : null;

export class FirestoreBillingStore implements BillingStore {
  readonly kind = 'firestore' as const;
  constructor(private readonly db: Firestore) {}

  async saveOrder(o: BillingOrder) {
    await guard(() => this.db.collection(BILLING_COLLECTIONS.orders).doc(o.id).create({ ...o }));
  }

  async getOrder(id: string) {
    return guard(async () => asOrder((await this.db.collection(BILLING_COLLECTIONS.orders).doc(id).get()).data()));
  }

  async listOrders(merchant: string, limit: number) {
    return guard(async () => {
      const snap = await this.db.collection(BILLING_COLLECTIONS.orders).where('merchant', '==', merchant).orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map((d) => asOrder(d.data())).filter((o): o is BillingOrder => o !== null);
    });
  }

  async getSubscription(merchant: string) {
    return guard(async () => asSub((await this.db.collection(BILLING_COLLECTIONS.subscriptions).doc(merchant).get()).data()));
  }

  async activateOrder(id: string, payment: BillingPayment, now: number): Promise<ActivateResult> {
    return guard(() =>
      this.db.runTransaction(async (t) => {
        const orderRef = this.db.collection(BILLING_COLLECTIONS.orders).doc(id);
        const order = asOrder((await t.get(orderRef)).data());
        if (!order) return { status: 'missing' } as const;
        const subRef = this.db.collection(BILLING_COLLECTIONS.subscriptions).doc(order.merchant);
        const txHash = payment.txHash.toLowerCase();
        const payRef = this.db.collection(BILLING_COLLECTIONS.payments).doc(txHash);
        const [subSnap, paySnap] = await Promise.all([t.get(subRef), t.get(payRef)]);
        const current = asSub(subSnap.data());
        if (order.status === 'paid') return { status: 'already_paid', order, subscription: current ?? extendSubscription(null, order, now) } as const;
        const usedBy = paySnap.data()?.orderId;
        if (usedBy && usedBy !== id) return { status: 'tx_used', order } as const;
        const paid: BillingOrder = { ...order, status: 'paid', payment: { ...payment, txHash } };
        const sub = extendSubscription(current, paid, now);
        t.update(orderRef, { status: 'paid', payment: paid.payment });
        t.set(subRef, sub);
        t.set(payRef, { orderId: id, at: now });
        return { status: 'activated', order: paid, subscription: sub } as const;
      })
    );
  }
}
