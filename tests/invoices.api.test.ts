/**
 * Merchant invoice API: real EIP-712 request signatures, real SIWE session signatures, the real Express
 * app and InvoiceService. Only the clock, the store and the chain reader are test doubles.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { encodeFunctionData, getAddress, verifyMessage, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApiApp } from '../server/app';
import { InvoiceService, type ChainReader } from '../server/invoices/service';
import { MemoryInvoiceStore } from '../server/invoices/memoryStore';
import { applySettlement, type InvoiceRecord } from '../server/invoices/store';
import { erc20Abi } from '../src/config/abis';
import { MEZO_TESTNET } from '../src/config/chains';
import { buildPaymentRequest, expectedPaymentCalldata, typedDataFor, type SignedPaymentRequest } from '../src/lib/paymentRequest';
import { receipt, transferLog } from './helpers';

const chain = MEZO_TESTNET;
const MUSD = chain.tokens.MUSD.address;
let clock = Date.UTC(2026, 10, 5, 12, 0, 0);
const wallet = () => privateKeyToAccount(generatePrivateKey());

// Fake chain: transactions registered by hash.
interface FakeTx { from: Hex; input: Hex; status: 'success' | 'reverted'; block: bigint; ts: number; logs: ReturnType<typeof transferLog>[] }
const txs = new Map<string, FakeTx>();
let head = 1000n;
let rpcDown = false;
const reader: ChainReader = {
  getTransaction: async ({ hash }) => {
    if (rpcDown) throw new Error('fetch failed');
    const t = txs.get(hash.toLowerCase());
    if (!t) throw Object.assign(new Error('nf'), { name: 'TransactionNotFoundError' });
    return { hash, from: t.from, to: MUSD, input: t.input, chainId: chain.chainId };
  },
  getTransactionReceipt: async ({ hash }) => {
    const t = txs.get(hash.toLowerCase());
    if (!t) throw Object.assign(new Error('nf'), { name: 'TransactionReceiptNotFoundError' });
    return { ...receipt(t.status, t.logs), blockNumber: t.block };
  },
  getBlock: async ({ blockNumber }) => ({ timestamp: BigInt([...txs.values()].find((t) => t.block === blockNumber)?.ts ?? 0) }),
  getBlockNumber: async () => head,
};

let server: Server;
let base: string;
let store: MemoryInvoiceStore;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function signedRequest(signer = wallet(), over: Partial<Parameters<typeof buildPaymentRequest>[0]> = {}) {
  const request = buildPaymentRequest({ chain, recipient: signer.address, amount: 5n * 10n ** 18n, memo: 'Invoice', lifetimeSeconds: 86_400, nowSeconds: Math.floor(clock / 1000), ...over });
  return { signer, request, signature: await signer.signTypedData(typedDataFor(request)) };
}

async function signIn(signer: ReturnType<typeof wallet>) {
  const ch = await call('POST', '/api/merchant/challenge', { address: signer.address, chainId: chain.chainId });
  expect(ch.status).toBe(200);
  const s = await call('POST', '/api/merchant/session', { nonce: ch.body.nonce, signature: await signer.signMessage({ message: ch.body.message }) });
  expect(s.status).toBe(200);
  return s.body.token as string;
}

function pay(request: SignedPaymentRequest, payer: Hex, opts: { hash: Hex; input?: Hex; block?: bigint; status?: 'success' | 'reverted' }) {
  txs.set(opts.hash.toLowerCase(), {
    from: payer,
    input: opts.input ?? expectedPaymentCalldata(request),
    status: opts.status ?? 'success',
    block: opts.block ?? 900n,
    ts: request.createdAt + 60,
    logs: [transferLog(MUSD, payer, request.recipient, BigInt(request.amount))],
  });
}
const h = (n: number) => (`0x${n.toString(16).padStart(64, '0')}`) as Hex;

beforeAll(async () => {
  store = new MemoryInvoiceStore();
  const invoices = new InvoiceService({
    store,
    now: () => clock,
    chainReader: () => reader,
    verifyMessage: ({ address, message, signature }) => verifyMessage({ address, message, signature }),
    retryDelays: [0],
    maxPerRecipient: 3,
  });
  const app = createApiApp({ identity: null, invoices, rateLimits: { mutatePerMinute: 1000, lookupPerMinute: 1000, invoicePerMinute: 1000 } });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(() => server.close());
beforeEach(() => {
  clock += 60 * 60 * 1000;
  rpcDown = false;
});

describe('storing signed invoices', () => {
  it('stores a request only under the wallet that signed it, idempotently', async () => {
    const { request, signature } = await signedRequest();
    const first = await call('POST', '/api/invoices', { request, signature });
    expect(first.status).toBe(201);
    expect(first.body.invoice.settlement).toBeNull();
    expect((await call('POST', '/api/invoices', { request, signature })).status).toBe(200);
    const read = await call('GET', `/api/invoices/${request.recipient}/${request.id}`);
    expect(read.status).toBe(200);
    expect(read.body.invoice.request).toEqual(request);
  });

  it('refuses tampered requests, foreign signatures and unsupported shapes', async () => {
    const { request, signature } = await signedRequest();
    expect((await call('POST', '/api/invoices', { request: { ...request, amount: '1' }, signature })).status).toBe(401);
    const other = await signedRequest();
    expect((await call('POST', '/api/invoices', { request, signature: other.signature })).status).toBe(401);
    expect((await call('POST', '/api/invoices', { request: { ...request, extra: 1 }, signature })).status).toBe(400);
    expect((await call('POST', '/api/invoices', { request, signature: '0xzz' })).status).toBe(400);
  });

  it('cannot hijack another merchant’s request id, and refuses a different request reusing an id', async () => {
    const victim = await signedRequest();
    expect((await call('POST', '/api/invoices', victim)).status).toBe(201);
    // An attacker re-uses the id with themselves as recipient: stored under the attacker only.
    const attacker = await signedRequest(wallet(), { id: victim.request.id });
    expect((await call('POST', '/api/invoices', { request: attacker.request, signature: attacker.signature })).status).toBe(201);
    expect((await call('GET', `/api/invoices/${victim.request.recipient}/${victim.request.id}`)).body.invoice.request).toEqual(victim.request);
    // The same merchant cannot replace the stored content under the same id.
    const changed = await signedRequest(victim.signer, { id: victim.request.id, amount: 9n * 10n ** 18n });
    expect((await call('POST', '/api/invoices', { request: changed.request, signature: changed.signature })).status).toBe(409);
  });

  it('enforces the per-recipient cap', async () => {
    const signer = wallet();
    for (let i = 0; i < 3; i++) expect((await call('POST', '/api/invoices', await signedRequest(signer).then(({ request, signature }) => ({ request, signature })))).status).toBe(201);
    const fourth = await signedRequest(signer);
    expect((await call('POST', '/api/invoices', { request: fourth.request, signature: fourth.signature })).status).toBe(429);
  });
});

describe('merchant sessions and listing', () => {
  it('lists only the signed-in wallet’s invoices, newest first, with a cursor', async () => {
    const merchant = wallet();
    const created: SignedPaymentRequest[] = [];
    for (let i = 0; i < 3; i++) {
      clock += 1000;
      const r = await signedRequest(merchant);
      created.push(r.request);
      await call('POST', '/api/invoices', { request: r.request, signature: r.signature });
    }
    const stranger = await signedRequest();
    await call('POST', '/api/invoices', { request: stranger.request, signature: stranger.signature });

    expect((await call('GET', '/api/invoices')).status).toBe(401);
    expect((await call('GET', '/api/invoices', undefined, { authorization: 'Bearer nope' })).status).toBe(401);
    const token = await signIn(merchant);
    const auth = { authorization: `Bearer ${token}` };
    const page1 = await call('GET', '/api/invoices?limit=2', undefined, auth);
    expect(page1.status).toBe(200);
    expect(page1.body.items.map((i: InvoiceRecord) => i.id)).toEqual([created[2].id, created[1].id]);
    const page2 = await call('GET', `/api/invoices?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`, undefined, auth);
    expect(page2.body.items.map((i: InvoiceRecord) => i.id)).toEqual([created[0].id]);
    expect(page2.body.nextCursor).toBeNull();
    expect((await call('GET', '/api/invoices?cursor=garbage', undefined, auth)).status).toBe(400);
  });

  it('rejects wrong signers without burning the challenge, replays, expiry and expired tokens', async () => {
    const merchant = wallet();
    const ch = await call('POST', '/api/merchant/challenge', { address: merchant.address, chainId: chain.chainId });
    const wrong = await call('POST', '/api/merchant/session', { nonce: ch.body.nonce, signature: await wallet().signMessage({ message: ch.body.message }) });
    expect(wrong.status).toBe(401);
    const signature = await merchant.signMessage({ message: ch.body.message });
    const ok = await call('POST', '/api/merchant/session', { nonce: ch.body.nonce, signature });
    expect(ok.status).toBe(200);
    expect(ok.body.address).toBe(getAddress(merchant.address));
    expect((await call('POST', '/api/merchant/session', { nonce: ch.body.nonce, signature })).status).toBe(409);

    const late = await call('POST', '/api/merchant/challenge', { address: merchant.address, chainId: chain.chainId });
    clock += 6 * 60 * 1000;
    expect((await call('POST', '/api/merchant/session', { nonce: late.body.nonce, signature: await merchant.signMessage({ message: late.body.message }) })).status).toBe(410);

    const auth = { authorization: `Bearer ${ok.body.token}` };
    expect((await call('GET', '/api/invoices', undefined, auth)).status).toBe(200);
    clock += 25 * 60 * 60 * 1000;
    expect((await call('GET', '/api/invoices', undefined, auth)).status).toBe(401);
    expect((await call('POST', '/api/merchant/challenge', { address: merchant.address, chainId: 31612 })).status).toBe(400);
  });
});

describe('server-verified settlement', () => {
  it('records a settlement only after reading the exact calldata, receipt and block from the chain', async () => {
    const { request, signature } = await signedRequest();
    await call('POST', '/api/invoices', { request, signature });
    const payer = wallet().address;
    const path = `/api/invoices/${request.recipient}/${request.id}/settlement`;

    // A client cannot set a status: only a hash is accepted, and it must verify.
    expect((await call('POST', path, { status: 'paid' })).status).toBe(400);
    expect((await call('POST', path, { txHash: h(1) })).status).toBe(404);
    const plain = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [request.recipient, BigInt(request.amount)] });
    pay(request, payer, { hash: h(2), input: plain });
    const mismatch = await call('POST', path, { txHash: h(2) });
    expect(mismatch.status).toBe(422);
    pay(request, payer, { hash: h(3), status: 'reverted' });
    expect((await call('POST', path, { txHash: h(3) })).status).toBe(422);
    expect((await call('GET', `/api/invoices/${request.recipient}/${request.id}`)).body.invoice.settlement).toBeNull();

    pay(request, payer, { hash: h(4), block: 950n });
    const settled = await call('POST', path, { txHash: h(4) });
    expect(settled.status).toBe(200);
    expect(settled.body.invoice.settlement).toMatchObject({ txHash: h(4), payer: payer.toLowerCase(), blockNumber: '950', late: false });
    // Idempotent.
    expect((await call('POST', path, { txHash: h(4) })).body.invoice.settlement.txHash).toBe(h(4));

    // A second verified payment is kept as a duplicate; an earlier-block one becomes the settlement.
    pay(request, payer, { hash: h(5), block: 960n });
    expect((await call('POST', path, { txHash: h(5) })).body.invoice.duplicatePayments).toEqual([h(5)]);
    pay(request, payer, { hash: h(6), block: 940n });
    const reordered = await call('POST', path, { txHash: h(6) });
    expect(reordered.body.invoice.settlement.txHash).toBe(h(6));
    expect(reordered.body.invoice.duplicatePayments).toEqual([h(5), h(4)]);
  });

  it('reports RPC failure as unavailable, never as paid or unpaid', async () => {
    const { request, signature } = await signedRequest();
    await call('POST', '/api/invoices', { request, signature });
    pay(request, wallet().address, { hash: h(7) });
    rpcDown = true;
    const r = await call('POST', `/api/invoices/${request.recipient}/${request.id}/settlement`, { txHash: h(7) });
    expect(r.status).toBe(503);
    expect((await call('GET', `/api/invoices/${request.recipient}/${request.id}`)).body.invoice.settlement).toBeNull();
  });

  it('applies the confirmation policy', async () => {
    const strict = new InvoiceService({ store: new MemoryInvoiceStore(), now: () => clock, chainReader: () => reader, minConfirmations: 3, verifyMessage: async () => false, retryDelays: [0] });
    const { request, signature } = await signedRequest();
    await strict.createInvoice({ request, signature });
    pay(request, wallet().address, { hash: h(8), block: head });
    await expect(strict.submitSettlement(request.recipient, request.id, { txHash: h(8) })).rejects.toMatchObject({ code: 'awaiting_confirmations' });
    head += 2n;
    expect((await strict.submitSettlement(request.recipient, request.id, { txHash: h(8) })).check).toBe('settled');
  });
});

describe('settlement merge', () => {
  it('never drops a verified payment', () => {
    const base = { settlement: null, duplicatePayments: [] } as unknown as InvoiceRecord;
    const s = (hash: string, block: string) => ({ txHash: hash, payer: '0x1', blockNumber: block, paidAt: 1, late: false, verifiedAt: 1 });
    const a = applySettlement(base, s('0xa', '10'));
    const b = applySettlement(a, s('0xb', '5'));
    expect(b.settlement?.txHash).toBe('0xb');
    expect(b.duplicatePayments).toEqual(['0xa']);
    expect(applySettlement(b, s('0xa', '10'))).toBe(b);
  });
});
