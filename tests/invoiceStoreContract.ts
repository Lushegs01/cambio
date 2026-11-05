/**
 * Behaviour every InvoiceStore must share. Imported by the memory/SQLite suite and the Firestore emulator suite.
 */
import { expect, it } from 'vitest';
import type { InvoiceRecord, InvoiceStore } from '../server/invoices/store';

const recipient = '0x00000000000000000000000000000000000000aa';
const other = '0x00000000000000000000000000000000000000bb';
const id = (n: number) => `0x${n.toString(16).padStart(32, '0')}`;

export function invoice(n: number, over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const createdAt = 1_793_000_000 + n;
  return {
    id: id(n),
    chainId: 31611,
    recipient,
    request: { v: 2, id: id(n) as `0x${string}`, chainId: 31611, token: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503', recipient: '0x00000000000000000000000000000000000000AA', amount: String(1000 + n), memo: `#${n}`, createdAt, expiresAt: createdAt + 3600 },
    signature: `0x${'11'.repeat(65)}`,
    createdAt,
    expiresAt: createdAt + 3600,
    storedAt: 1,
    settlement: null,
    duplicatePayments: [],
    ...over,
  };
}

export function invoiceStoreContract(make: () => Promise<InvoiceStore> | InvoiceStore) {
  it('inserts once, recognises identical re-inserts, refuses changed content and enforces the cap atomically', async () => {
    const store = await make();
    expect(await store.insertInvoice(invoice(1), 5)).toBe('created');
    expect(await store.insertInvoice(invoice(1), 5)).toBe('exists');
    expect(await store.insertInvoice(invoice(1, { signature: `0x${'22'.repeat(65)}` }), 5)).toBe('conflict');
    expect(await store.insertInvoice(invoice(1, { recipient: other }), 5)).toBe('created');
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.insertInvoice(invoice(100 + i), 5)));
    expect(results.filter((r) => r === 'created')).toHaveLength(4);
    expect(results.filter((r) => r === 'limit')).toHaveLength(4);
  });

  it('lists newest first, scoped to the recipient, with a stable cursor', async () => {
    const store = await make();
    for (const n of [3, 1, 2]) await store.insertInvoice(invoice(n), 100);
    await store.insertInvoice(invoice(9, { recipient: other }), 100);
    const first = await store.listInvoices(recipient, 2);
    expect(first.map((r) => r.id)).toEqual([id(3), id(2)]);
    const rest = await store.listInvoices(recipient, 2, { createdAt: first[1].createdAt, id: first[1].id });
    expect(rest.map((r) => r.id)).toEqual([id(1)]);
    expect((await store.getInvoice(recipient, id(2)))?.request.memo).toBe('#2');
    expect(await store.getInvoice(other, id(2))).toBeNull();
  });

  it('records settlements without losing concurrent verified payments', async () => {
    const store = await make();
    await store.insertInvoice(invoice(7), 100);
    const s = (hash: string, block: string) => ({ txHash: hash, payer: '0x1', blockNumber: block, paidAt: 1, late: false, verifiedAt: 1 });
    await Promise.all([store.recordSettlement(recipient, id(7), s('0xa', '10')), store.recordSettlement(recipient, id(7), s('0xb', '11'))]);
    const r = (await store.getInvoice(recipient, id(7)))!;
    expect(r.settlement?.txHash).toBe('0xa');
    expect(r.duplicatePayments).toEqual(['0xb']);
    expect(await store.recordSettlement(recipient, id(99), s('0xc', '1'))).toBeNull();
  });

  it('consumes a session challenge exactly once and stores sessions by hash', async () => {
    const store = await make();
    const now = 1_000_000;
    await store.saveChallenge({ nonce: 'abcdef123456', address: recipient, chainId: 31611, message: 'm', issuedAt: now, expiresAt: now + 300_000, usedAt: null });
    const results = await Promise.all(Array.from({ length: 5 }, () => store.consumeChallenge('abcdef123456', now + 1)));
    expect(results.filter(Boolean)).toHaveLength(1);
    await store.saveChallenge({ nonce: 'expired12345', address: recipient, chainId: 31611, message: 'm', issuedAt: now, expiresAt: now + 10, usedAt: null });
    expect(await store.consumeChallenge('expired12345', now + 10)).toBe(false);
    await store.saveSession({ tokenHash: 'f'.repeat(64), address: recipient, createdAt: now, expiresAt: now + 1000 });
    expect(await store.getSession('f'.repeat(64))).toMatchObject({ address: recipient, expiresAt: now + 1000 });
    expect(await store.getSession('e'.repeat(64))).toBeNull();
  });
}
