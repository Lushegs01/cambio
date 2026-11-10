/**
 * Merchant Pro billing API: real SIWE session signatures, the real Express app, InvoiceService and
 * BillingService. Only the clock, the stores and the chain reader are test doubles. Entitlement must come
 * only from a payment the server verified on-chain.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { encodeFunctionData, getAddress, verifyMessage, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApiApp } from '../server/app';
import { InvoiceService, type ChainReader } from '../server/invoices/service';
import { MemoryInvoiceStore } from '../server/invoices/memoryStore';
import { BillingService, billingConfigFromEnv } from '../server/billing/service';
import { MemoryBillingStore } from '../server/billing/memoryStore';
import { DAY_MS, type BillingOrder } from '../server/billing/store';
import { erc20Abi } from '../src/config/abis';
import { MEZO_TESTNET } from '../src/config/chains';
import { buildPaymentRequest, expectedPaymentCalldata, typedDataFor } from '../src/lib/paymentRequest';
import { receipt, transferLog } from './helpers';

const chain = MEZO_TESTNET;
const MUSD = chain.tokens.MUSD.address;
const TREASURY = privateKeyToAccount(generatePrivateKey()).address;
let clock = Date.UTC(2026, 10, 8, 12, 0, 0);
const wallet = () => privateKeyToAccount(generatePrivateKey());

interface FakeTx { from: Hex; to: Hex; input: Hex; status: 'success' | 'reverted'; block: bigint; ts: number; logs: ReturnType<typeof transferLog>[] }
const txs = new Map<string, FakeTx>();
let head = 1000n;
const reader: ChainReader = {
  getTransaction: async ({ hash }) => {
    const t = txs.get(hash.toLowerCase());
    if (!t) throw Object.assign(new Error('nf'), { name: 'TransactionNotFoundError' });
    return { hash, from: t.from, to: t.to, input: t.input, chainId: chain.chainId };
  },
  getTransactionReceipt: async ({ hash }) => {
    const t = txs.get(hash.toLowerCase());
    if (!t) throw Object.assign(new Error('nf'), { name: 'TransactionReceiptNotFoundError' });
    return { ...receipt(t.status, t.logs), blockNumber: t.block };
  },
  getBlock: async ({ blockNumber }) => ({ timestamp: BigInt([...txs.values()].find((t) => t.block === blockNumber)?.ts ?? 0) }),
  getBlockNumber: async () => head,
};

const servers: Server[] = [];
async function start(env: Record<string, string>) {
  const invoices = new InvoiceService({ store: new MemoryInvoiceStore(), now: () => clock, chainReader: () => reader, verifyMessage: ({ address, message, signature }) => verifyMessage({ address, message, signature }), retryDelays: [0] });
  const billing = new BillingService(new MemoryBillingStore(), billingConfigFromEnv(env), () => reader, { now: () => clock, retryDelays: [0] });
  const app = createApiApp({ identity: null, invoices, billing, rateLimits: { mutatePerMinute: 1000, lookupPerMinute: 1000, invoicePerMinute: 1000 } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const signIn = async (signer: ReturnType<typeof wallet>) => {
    const ch = await call('POST', '/api/merchant/challenge', { address: signer.address, chainId: chain.chainId });
    const s = await call('POST', '/api/merchant/session', { nonce: ch.body.nonce, signature: await signer.signMessage({ message: ch.body.message }) });
    return { authorization: `Bearer ${s.body.token as string}` };
  };
  return { call, signIn, invoices };
}

const h = (n: number) => (`0x${n.toString(16).padStart(64, '0')}`) as Hex;
function payOrder(order: BillingOrder, payer: Hex, hash: Hex, over: Partial<FakeTx> = {}) {
  const request = BillingService.paymentRequestFor(order);
  txs.set(hash.toLowerCase(), {
    from: payer, to: MUSD, input: expectedPaymentCalldata(request), status: 'success', block: 900n, ts: order.createdAt + 30,
    logs: [transferLog(MUSD, payer, getAddress(order.treasury), BigInt(order.amount))], ...over,
  });
}

afterAll(() => servers.forEach((s) => s.close()));
beforeEach(() => { txs.clear(); head = 1000n; clock = Date.UTC(2026, 10, 8, 12, 0, 0); });

describe('billing configuration', () => {
  it('defaults to 9 MUSD / 30 days and is disabled without a treasury', () => {
    expect(billingConfigFromEnv({})).toMatchObject({ treasury: null, amount: 9n * 10n ** 18n, periodDays: 30 });
  });
  it('rejects an invalid treasury, price or period instead of guessing', () => {
    expect(() => billingConfigFromEnv({ PRO_TREASURY_ADDRESS: '0x1234' })).toThrow(/PRO_TREASURY_ADDRESS/);
    expect(() => billingConfigFromEnv({ PRO_TREASURY_ADDRESS: `0x${'0'.repeat(40)}` })).toThrow(/non-zero/);
    expect(() => billingConfigFromEnv({ PRO_PRICE_MUSD: '-1' })).toThrow(/PRO_PRICE_MUSD/);
    expect(() => billingConfigFromEnv({ PRO_PERIOD_DAYS: '0' })).toThrow(/PRO_PERIOD_DAYS/);
  });
});

describe('billing disabled (no treasury configured)', () => {
  it('reports disabled, refuses orders, and keeps the reconciliation report free', async () => {
    const { call, signIn } = await start({});
    const auth = await signIn(wallet());
    const st = await call('GET', '/api/billing/status', undefined, auth);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ enabled: false, active: false, treasury: null, priceMusd: '9' });
    expect((await call('POST', '/api/billing/orders', {}, auth)).body.error).toBe('billing_disabled');
    const report = await call('GET', '/api/invoices/report.csv', undefined, auth);
    expect(report.status).toBe(200);
    expect(report.text.split('\r\n')[0]).toContain('request_id');
  });
});

describe('billing enabled', () => {
  it('requires a merchant session for every billing route', async () => {
    const { call } = await start({ PRO_TREASURY_ADDRESS: TREASURY });
    expect((await call('GET', '/api/billing/status')).status).toBe(401);
    expect((await call('POST', '/api/billing/orders', {})).status).toBe(401);
    expect((await call('POST', `/api/billing/orders/0x${'1'.repeat(32)}/payment`, { txHash: h(1) })).status).toBe(401);
    expect((await call('GET', '/api/invoices/report.csv')).status).toBe(401);
  });

  it('a verified on-chain payment activates Pro for exactly one period, idempotently', async () => {
    const { call, signIn } = await start({ PRO_TREASURY_ADDRESS: TREASURY });
    const merchant = wallet();
    const auth = await signIn(merchant);
    expect((await call('GET', '/api/invoices/report.csv', undefined, auth)).status).toBe(402);

    const created = await call('POST', '/api/billing/orders', {}, auth);
    expect(created.status).toBe(201);
    const order = created.body.order as BillingOrder;
    expect(order).toMatchObject({ treasury: TREASURY.toLowerCase(), amount: (9n * 10n ** 18n).toString(), status: 'open', periodDays: 30 });
    // Asking again reuses the open order instead of creating another.
    expect((await call('POST', '/api/billing/orders', {}, auth)).body.order.id).toBe(order.id);

    payOrder(order, merchant.address, h(1));
    const paid = await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: h(1) }, auth);
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ enabled: true, active: true, proUntil: clock + 30 * DAY_MS });
    // Re-submitting the same hash changes nothing.
    expect((await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: h(1) }, auth)).body.proUntil).toBe(clock + 30 * DAY_MS);
    // Pro unlocks the server-verified report.
    const report = await call('GET', '/api/invoices/report.csv', undefined, auth);
    expect(report.status).toBe(200);
    expect(report.headers.get('content-type')).toMatch(/text\/csv/);
    // And it expires.
    clock += 31 * DAY_MS;
    // (The 24 h merchant session has expired too; sign in again.)
    expect((await call('GET', '/api/billing/status', undefined, auth)).status).toBe(401);
    const fresh = await signIn(merchant);
    expect((await call('GET', '/api/billing/status', undefined, fresh)).body.active).toBe(false);
    expect((await call('GET', '/api/invoices/report.csv', undefined, fresh)).status).toBe(402);
  });

  it('never grants Pro for a plain transfer, the wrong amount or treasury, a revert, or an older transaction', async () => {
    const { call, signIn } = await start({ PRO_TREASURY_ADDRESS: TREASURY });
    const merchant = wallet();
    const auth = await signIn(merchant);
    const order = (await call('POST', '/api/billing/orders', {}, auth)).body.order as BillingOrder;
    const plain = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [TREASURY, BigInt(order.amount)] });
    payOrder(order, merchant.address, h(10), { input: plain });
    payOrder(order, merchant.address, h(11), { input: expectedPaymentCalldata({ ...BillingService.paymentRequestFor(order), amount: '1' }) });
    payOrder(order, merchant.address, h(12), { input: expectedPaymentCalldata({ ...BillingService.paymentRequestFor(order), recipient: merchant.address }) });
    payOrder(order, merchant.address, h(13), { status: 'reverted' });
    payOrder(order, merchant.address, h(14), { ts: order.createdAt - 600, block: 899n });
    for (const n of [10, 11, 12, 13, 14]) {
      const r = await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: h(n) }, auth);
      expect(r.status, `tx ${n}`).toBe(422);
    }
    expect((await call('GET', '/api/billing/status', undefined, auth)).body.active).toBe(false);
  });

  it('distinguishes pending, unconfirmed and unknown orders from failures', async () => {
    const { call, signIn } = await start({ PRO_TREASURY_ADDRESS: TREASURY, INVOICE_MIN_CONFIRMATIONS: '1' });
    const merchant = wallet();
    const auth = await signIn(merchant);
    const order = (await call('POST', '/api/billing/orders', {}, auth)).body.order as BillingOrder;
    expect((await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: h(20) }, auth)).body.error).toBe('tx_not_found');
    payOrder(order, merchant.address, h(20), { block: 2000n });
    expect((await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: h(20) }, auth)).body.error).toBe('awaiting_confirmations');
    expect((await call('POST', `/api/billing/orders/0x${'9'.repeat(32)}/payment`, { txHash: h(20) }, auth)).status).toBe(404);
    expect((await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: '0x12' }, auth)).status).toBe(400);
  });

  it("one merchant cannot submit or see another merchant's order", async () => {
    const { call, signIn } = await start({ PRO_TREASURY_ADDRESS: TREASURY });
    const a = wallet();
    const b = wallet();
    const authA = await signIn(a);
    const authB = await signIn(b);
    const order = (await call('POST', '/api/billing/orders', {}, authA)).body.order as BillingOrder;
    payOrder(order, a.address, h(30));
    expect((await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: h(30) }, authB)).status).toBe(404);
    expect((await call('GET', '/api/billing/status', undefined, authB)).body.orders).toEqual([]);
    // A gift is fine: anyone may pay the order, but the entitlement goes to the merchant who created it.
    payOrder(order, b.address, h(31));
    expect((await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: h(31) }, authA)).body.active).toBe(true);
    expect((await call('GET', '/api/billing/status', undefined, authB)).body.active).toBe(false);
  });

  it('the report lists only server-verified settlements and neutralises spreadsheet formulas', async () => {
    const { call, signIn, invoices } = await start({ PRO_TREASURY_ADDRESS: TREASURY });
    const merchant = wallet();
    const auth = await signIn(merchant);
    const order = (await call('POST', '/api/billing/orders', {}, auth)).body.order as BillingOrder;
    payOrder(order, merchant.address, h(40));
    await call('POST', `/api/billing/orders/${order.id}/payment`, { txHash: h(40) }, auth);

    const req = buildPaymentRequest({ chain, recipient: merchant.address, amount: 5n * 10n ** 18n, memo: '=HYPERLINK("x")', lifetimeSeconds: 86_400, nowSeconds: Math.floor(clock / 1000) });
    await invoices.createInvoice({ request: req, signature: await merchant.signTypedData(typedDataFor(req)) });
    const csv = (await call('GET', '/api/invoices/report.csv', undefined, auth)).text;
    const [header, row] = csv.trim().split('\r\n');
    expect(header).toContain('server_verified_at');
    expect(row).toContain('"awaiting_payment"');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain(`/#proof/${merchant.address}/${req.id}`);
  });

  it('the treasury wallet cannot subscribe itself', async () => {
    const w = wallet();
    const srv = await start({ PRO_TREASURY_ADDRESS: w.address });
    const auth = await srv.signIn(w);
    expect((await srv.call('POST', '/api/billing/orders', {}, auth)).body.error).toBe('treasury_is_merchant');
  });
});
