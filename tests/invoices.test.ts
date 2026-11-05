/**
 * Merchant invoice view model: status derivation, merging device and registry records, totals and CSV.
 */
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { MEZO_TESTNET } from '../src/config/chains';
import { buildPaymentRequest, type StoredRequest } from '../src/lib/paymentRequest';
import { deriveStatus, filterInvoices, invoicesCsv, invoiceTotals, mergeInvoices } from '../src/lib/invoices';
import type { ServerInvoice } from '../src/services/invoiceClient';

const NOW = 1_793_000_000;
const ONE = 10n ** 18n;
const SIG = `0x${'11'.repeat(65)}` as Hex;
const TX = (n: number) => (`0x${n.toString(16).padStart(64, '0')}`) as Hex;
const recipient = '0x00000000000000000000000000000000000000aA';

function req(n: number, amount: bigint, memo = `Invoice ${n}`, lifetime = 86_400) {
  return buildPaymentRequest({ chain: MEZO_TESTNET, recipient, amount, memo, lifetimeSeconds: lifetime, nowSeconds: NOW - 1000 + n, id: (`0x${n.toString(16).padStart(32, '0')}`) as Hex });
}
const local = (r: ReturnType<typeof req>, settlementTx?: Hex): StoredRequest => ({ request: r, signature: SIG, settlementTx });
function server(r: ReturnType<typeof req>, tx?: Hex, extra: Partial<ServerInvoice> = {}): ServerInvoice {
  return { id: r.id, chainId: r.chainId, recipient: r.recipient, request: r, signature: SIG, createdAt: r.createdAt, expiresAt: r.expiresAt, storedAt: 1, settlement: tx ? { txHash: tx, payer: '0xp', blockNumber: '5', paidAt: (NOW - 10) * 1000, late: false, verifiedAt: 1 } : null, duplicatePayments: [], ...extra };
}

describe('deriveStatus', () => {
  it('is paid only with a verified settlement, unknown when verification failed, expired after expiry', () => {
    expect(deriveStatus({ settlementTx: TX(1), late: false }, NOW + 10, NOW).status).toBe('paid');
    expect(deriveStatus({ settlementTx: TX(1), late: true }, NOW - 10, NOW).status).toBe('paid_late');
    expect(deriveStatus({ settlementTx: null, late: false }, NOW + 10, NOW, { state: 'unknown', message: 'x' })).toEqual({ status: 'unknown', note: 'x' });
    expect(deriveStatus({ settlementTx: null, late: false }, NOW - 1, NOW).status).toBe('expired');
    expect(deriveStatus({ settlementTx: null, late: false }, NOW + 10, NOW, { state: 'unpaid' }).status).toBe('pending');
  });
});

describe('mergeInvoices', () => {
  it('combines device-only and registry invoices without duplicates, newest first', () => {
    const a = req(1, 5n * ONE);
    const b = req(2, 7n * ONE);
    const c = req(3, 9n * ONE);
    const rows = mergeInvoices([local(a), local(b)], [server(b, TX(9)), server(c)], {}, NOW);
    expect(rows.map((r) => [r.request.id, r.synced, r.onDevice, r.status])).toEqual([
      [c.id, true, false, 'pending'],
      [b.id, true, true, 'paid'],
      [a.id, false, true, 'pending'],
    ]);
  });

  it('never adopts a device settlement for a registry record with different signed content', () => {
    const r = req(4, 5n * ONE);
    const tampered = { ...r, amount: '1' };
    const rows = mergeInvoices([local(tampered, TX(3))], [server(r)], {}, NOW);
    expect(rows[0].settlementTx).toBeNull();
  });

  it('uses this browser’s on-chain check result when the registry has none', () => {
    const r = req(5, 5n * ONE);
    expect(mergeInvoices([local(r)], [], { [r.id]: { state: 'paid', hash: TX(4) } }, NOW)[0]).toMatchObject({ status: 'paid', settlementTx: TX(4) });
  });
});

describe('totals, filters and export', () => {
  const paid = req(10, 5n * ONE, 'Logo design');
  const open = req(11, 7n * ONE, 'Website');
  const expired = req(12, 9n * ONE, 'Old', 60);
  const rows = mergeInvoices([], [server(paid, TX(1), { duplicatePayments: [TX(2)] }), server(open), server(expired)], {}, NOW);

  it('counts only verified payments as paid', () => {
    expect(invoiceTotals(rows)).toEqual({ count: 3, paidCount: 1, paidAmount: 5n * ONE, pendingCount: 1, pendingAmount: 7n * ONE, expiredCount: 1, unknownCount: 0, duplicateCount: 1 });
  });

  it('filters by status and searches note, amount, id and transaction', () => {
    expect(filterInvoices(rows, 'paid', '').map((r) => r.request.memo)).toEqual(['Logo design']);
    expect(filterInvoices(rows, 'all', 'web').map((r) => r.request.memo)).toEqual(['Website']);
    expect(filterInvoices(rows, 'all', '9').map((r) => r.request.memo)).toEqual(['Old']);
    expect(filterInvoices(rows, 'all', TX(1))).toHaveLength(1);
  });

  it('exports CSV with neutralised formulas and explorer links', () => {
    const evil = mergeInvoices([], [server(req(13, ONE, '=HYPERLINK("x")'))], {}, NOW);
    const csv = invoicesCsv([...rows, ...evil], (h) => `https://explorer.test.mezo.org/tx/${h}`);
    expect(csv.split('\r\n')[0]).toContain('settlement_tx');
    expect(csv).toContain(`"https://explorer.test.mezo.org/tx/${TX(1)}"`);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
