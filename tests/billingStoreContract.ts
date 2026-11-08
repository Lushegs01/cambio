/**
 * Behaviour every BillingStore must share. Imported by the memory/SQLite suite and the Firestore emulator suite.
 */
import { expect, it } from 'vitest';
import { DAY_MS, type BillingOrder, type BillingPayment, type BillingStore } from '../server/billing/store';

const merchant = '0x00000000000000000000000000000000000000aa';
const oid = (n: number) => `0x${n.toString(16).padStart(32, '0')}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const NOW = 1_800_000_000_000;

export function order(n: number, over: Partial<BillingOrder> = {}): BillingOrder {
  return {
    id: oid(n), merchant, chainId: 31611, token: '0x118917a40faf1cd7a13db0ef56c86de7973ac503', treasury: '0x00000000000000000000000000000000000000cc',
    amount: '9000000000000000000', periodDays: 30, createdAt: 1_800_000_000 + n, expiresAt: 1_800_003_600 + n, status: 'open', payment: null, ...over,
  };
}
const payment = (n: number): BillingPayment => ({ txHash: tx(n), payer: merchant, blockNumber: String(100 + n), paidAt: NOW, verifiedAt: NOW, late: false });

export function billingStoreContract(make: () => Promise<BillingStore> | BillingStore) {
  it('stores orders immutably and lists them newest first per merchant', async () => {
    const s = await make();
    await s.saveOrder(order(1));
    await s.saveOrder(order(2));
    await s.saveOrder(order(3, { merchant: '0x00000000000000000000000000000000000000bb' }));
    expect((await s.getOrder(oid(1)))?.amount).toBe('9000000000000000000');
    expect((await s.listOrders(merchant, 10)).map((o) => o.id)).toEqual([oid(2), oid(1)]);
    expect(await s.getOrder(oid(99))).toBeNull();
    expect(await s.getSubscription(merchant)).toBeNull();
  });

  it('activates an order once and extends the period from max(now, proUntil)', async () => {
    const s = await make();
    await s.saveOrder(order(1));
    await s.saveOrder(order(2));
    const a = await s.activateOrder(oid(1), payment(1), NOW);
    expect(a.status).toBe('activated');
    expect((await s.getSubscription(merchant))?.proUntil).toBe(NOW + 30 * DAY_MS);
    // Paying the same order again (same tx) is idempotent: no extra time.
    expect((await s.activateOrder(oid(1), payment(1), NOW + 1)).status).toBe('already_paid');
    expect((await s.getSubscription(merchant))?.proUntil).toBe(NOW + 30 * DAY_MS);
    // A second order renews on top of the remaining period.
    expect((await s.activateOrder(oid(2), payment(2), NOW + DAY_MS)).status).toBe('activated');
    const sub = await s.getSubscription(merchant);
    expect(sub?.proUntil).toBe(NOW + 60 * DAY_MS);
    expect(sub?.orders).toEqual([oid(2), oid(1)]);
    expect((await s.getOrder(oid(2)))?.payment?.txHash).toBe(tx(2));
  });

  it('refuses to credit a second order with a transaction that already paid one', async () => {
    const s = await make();
    await s.saveOrder(order(1));
    await s.saveOrder(order(2));
    expect((await s.activateOrder(oid(1), payment(7), NOW)).status).toBe('activated');
    expect((await s.activateOrder(oid(2), payment(7), NOW)).status).toBe('tx_used');
    expect((await s.getOrder(oid(2)))?.status).toBe('open');
  });

  it('is atomic under concurrent activation of the same order', async () => {
    const s = await make();
    await s.saveOrder(order(1));
    const results = await Promise.all([s.activateOrder(oid(1), payment(1), NOW), s.activateOrder(oid(1), payment(1), NOW), s.activateOrder(oid(1), payment(1), NOW)]);
    expect(results.filter((r) => r.status === 'activated')).toHaveLength(1);
    expect((await s.getSubscription(merchant))?.proUntil).toBe(NOW + 30 * DAY_MS);
  });

  it('a renewal after expiry starts from now, not from the old end', async () => {
    const s = await make();
    await s.saveOrder(order(1));
    await s.saveOrder(order(2));
    await s.activateOrder(oid(1), payment(1), NOW);
    const later = NOW + 90 * DAY_MS;
    await s.activateOrder(oid(2), payment(2), later);
    expect((await s.getSubscription(merchant))?.proUntil).toBe(later + 30 * DAY_MS);
  });

  it('reports a missing order', async () => {
    const s = await make();
    expect((await s.activateOrder(oid(5), payment(5), NOW)).status).toBe('missing');
  });
}
