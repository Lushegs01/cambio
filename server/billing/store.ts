/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistence contract for Merchant Pro billing (testnet proof of concept).
 *
 * Invariants every implementation must keep:
 *  - An order is created by the server for one merchant, with a server-chosen random id, price,
 *    treasury and period. Clients never choose any of these.
 *  - activateOrder() is atomic: an order is credited at most once, and crediting it extends the
 *    merchant's proUntil by exactly one period from max(now, current proUntil).
 *  - A payment transaction can credit at most one order (also enforced by the id bound into its calldata).
 */

export interface BillingOrder {
  /** Lowercase 0x-prefixed 16-byte id; bound into the payment calldata as the CMB2 request id. */
  id: string;
  /** Lowercase merchant address that will receive the entitlement. */
  merchant: string;
  chainId: number;
  token: string;
  /** Lowercase treasury address the MUSD goes to (configured by the operator). */
  treasury: string;
  /** Base units, decimal string. */
  amount: string;
  periodDays: number;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds; the quote's validity. */
  expiresAt: number;
  status: 'open' | 'paid';
  payment: BillingPayment | null;
}

export interface BillingPayment {
  txHash: string;
  payer: string;
  blockNumber: string;
  /** Block time, ms. */
  paidAt: number;
  verifiedAt: number;
  late: boolean;
}

export interface Subscription {
  merchant: string;
  /** ms; 0 when never subscribed. */
  proUntil: number;
  /** Paid order ids, newest first (capped). */
  orders: string[];
  updatedAt: number;
}

export type ActivateResult =
  | { status: 'activated'; order: BillingOrder; subscription: Subscription }
  | { status: 'already_paid'; order: BillingOrder; subscription: Subscription }
  | { status: 'tx_used'; order: BillingOrder }
  | { status: 'missing' };

export interface BillingStore {
  readonly kind: 'firestore' | 'sqlite' | 'memory';
  saveOrder(order: BillingOrder): Promise<void>;
  getOrder(id: string): Promise<BillingOrder | null>;
  /** Open orders and recent paid ones for a merchant, newest first. */
  listOrders(merchant: string, limit: number): Promise<BillingOrder[]>;
  getSubscription(merchant: string): Promise<Subscription | null>;
  /** Atomic: credit `id` once with `payment`, extending the merchant's period from max(now, proUntil). */
  activateOrder(id: string, payment: BillingPayment, now: number): Promise<ActivateResult>;
}

export const MAX_SUBSCRIPTION_ORDERS = 50;
export const DAY_MS = 86_400_000;

/** Pure entitlement arithmetic shared by every store. */
export function extendSubscription(current: Subscription | null, order: BillingOrder, now: number): Subscription {
  const from = Math.max(now, current?.proUntil ?? 0);
  return {
    merchant: order.merchant,
    proUntil: from + order.periodDays * DAY_MS,
    orders: [order.id, ...(current?.orders ?? []).filter((o) => o !== order.id)].slice(0, MAX_SUBSCRIPTION_ORDERS),
    updatedAt: now,
  };
}
