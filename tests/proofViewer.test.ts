/**
 * Public proof viewer: route parsing and verification against an untrusted registry.
 */
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { MEZO_TESTNET } from '../src/config/chains';
import type { EvidenceClient, EvidenceTx } from '../src/lib/evidence';
import { buildPaymentRequest, expectedPaymentCalldata, typedDataFor, verifyRequestSignature } from '../src/lib/paymentRequest';
import { parseProofRoute, proofUrl, verifyPublicProof, type ProofDeps, type RegistryInvoice } from '../src/lib/proofViewer';
import { HASH, receipt, transferLog } from './helpers';

const chain = MEZO_TESTNET;
const MUSD = chain.tokens.MUSD.address;
const NOW_S = 1_800_000_000;

async function fixture() {
  const merchant = privateKeyToAccount(generatePrivateKey());
  const payer = privateKeyToAccount(generatePrivateKey());
  const request = buildPaymentRequest({ chain, recipient: merchant.address, amount: 25n * 10n ** 18n, memo: 'Website sprint', lifetimeSeconds: 7 * 86_400, nowSeconds: NOW_S });
  const signature = await merchant.signTypedData(typedDataFor(request));
  const tx: EvidenceTx = { hash: HASH, from: payer.address, to: MUSD, input: expectedPaymentCalldata(request), chainId: chain.chainId };
  const rcpt = receipt('success', [transferLog(MUSD, payer.address, merchant.address, BigInt(request.amount))]);
  const client: EvidenceClient = {
    getTransaction: async () => tx,
    getTransactionReceipt: async () => rcpt,
    getBlock: async () => ({ timestamp: BigInt(NOW_S + 120) }),
  };
  return { merchant, payer, request, signature, tx, client };
}

function deps(over: Partial<ProofDeps> & { invoice: RegistryInvoice; client: EvidenceClient }): ProofDeps {
  return {
    getInvoice: async () => over.invoice,
    verifySignature: (r, s) => verifyRequestSignature(r, s),
    searchChain: async () => 'none',
    evidenceClient: over.client,
    ...over,
  };
}

describe('parseProofRoute', () => {
  it('parses recipient, request id and an optional tx', () => {
    const r = parseProofRoute(`https://cambio.test/#proof/0x${'ab'.repeat(20)}/0x${'cd'.repeat(16)}?tx=0x${'ef'.repeat(32)}`);
    expect(r).toMatchObject({ id: `0x${'cd'.repeat(16)}`, tx: `0x${'ef'.repeat(32)}` });
    expect(parseProofRoute(`https://cambio.test/#proof/0x${'ab'.repeat(20)}/0x${'cd'.repeat(16)}`)?.tx).toBeNull();
  });
  it('rejects anything malformed', () => {
    expect(parseProofRoute('https://cambio.test/#proof/0x12/0x34')).toBeNull();
    expect(parseProofRoute(`https://cambio.test/#proof/0x${'ab'.repeat(20)}/0x${'cd'.repeat(16)}?tx=0x12`)).toBeNull();
    expect(parseProofRoute(`https://cambio.test/#proof/0x${'ab'.repeat(20)}/0x${'cd'.repeat(16)}&token=secret`)).toBeNull();
    expect(parseProofRoute('not a url')).toBeNull();
  });
  it('round-trips with proofUrl and never carries anything but public ids', () => {
    const url = proofUrl('https://cambio.test/', `0x${'ab'.repeat(20)}`, `0x${'CD'.repeat(16)}`);
    expect(url).toMatch(/^https:\/\/cambio\.test\/#proof\/0x[0-9a-fA-F]{40}\/0x[0-9a-f]{32}$/);
    expect(parseProofRoute(url)).not.toBeNull();
  });
});

describe('verifyPublicProof', () => {
  it('verifies a recorded settlement end to end', async () => {
    const f = await fixture();
    const invoice: RegistryInvoice = { request: f.request, signature: f.signature, settlement: { txHash: HASH, verifiedAt: 1 }, duplicatePayments: [] };
    const out = await verifyPublicProof(chain, { recipient: f.merchant.address, id: f.request.id, tx: null }, deps({ invoice, client: f.client }));
    expect(out.state).toBe('verified');
    if (out.state === 'verified') {
      expect(out.source).toBe('registry');
      expect(out.result.checks.every((c) => c.ok === true)).toBe(true);
    }
  });

  it('fails when the registry altered the amount (signature no longer verifies)', async () => {
    const f = await fixture();
    const forged = { ...f.request, amount: '1' };
    const invoice: RegistryInvoice = { request: forged, signature: f.signature, settlement: { txHash: HASH, verifiedAt: 1 }, duplicatePayments: [] };
    const out = await verifyPublicProof(chain, { recipient: f.merchant.address, id: f.request.id, tx: null }, deps({ invoice, client: f.client }));
    expect(out.state).toBe('failed');
  });

  it('fails a plain transfer to the merchant that does not carry the request id', async () => {
    const f = await fixture();
    const plain = { ...f.tx, input: expectedPaymentCalldata(f.request).slice(0, 2 + 136) as Hex };
    const client = { ...f.client, getTransaction: async () => plain };
    const invoice: RegistryInvoice = { request: f.request, signature: f.signature, settlement: null, duplicatePayments: [] };
    const out = await verifyPublicProof(chain, { recipient: f.merchant.address, id: f.request.id, tx: HASH }, deps({ invoice, client }));
    expect(out.state).toBe('failed');
    if (out.state === 'failed') expect(out.source).toBe('link');
  });

  it('refuses a registry answer for a different request', async () => {
    const f = await fixture();
    const other = await fixture();
    const invoice: RegistryInvoice = { request: other.request, signature: other.signature, settlement: null, duplicatePayments: [] };
    const out = await verifyPublicProof(chain, { recipient: f.merchant.address, id: f.request.id, tx: null }, deps({ invoice, client: f.client }));
    expect(out.state).toBe('invalid_request');
  });

  it('distinguishes "no settlement found" from "could not search"', async () => {
    const f = await fixture();
    const invoice: RegistryInvoice = { request: f.request, signature: f.signature, settlement: null, duplicatePayments: [] };
    const route = { recipient: f.merchant.address, id: f.request.id, tx: null };
    expect(await verifyPublicProof(chain, route, deps({ invoice, client: f.client, searchChain: async () => 'none' }))).toMatchObject({ state: 'unpaid', searchComplete: true });
    expect(await verifyPublicProof(chain, route, deps({ invoice, client: f.client, searchChain: async () => 'unknown' }))).toMatchObject({ state: 'unpaid', searchComplete: false });
    expect(await verifyPublicProof(chain, route, deps({ invoice, client: f.client, searchChain: async () => HASH }))).toMatchObject({ state: 'verified', source: 'chain_search' });
  });

  it('is inconclusive, never verified, when the RPC cannot return the transaction', async () => {
    const f = await fixture();
    const down: EvidenceClient = { ...f.client, getTransactionReceipt: async () => { throw Object.assign(new Error('x'), { name: 'TransactionReceiptNotFoundError' }); } };
    const invoice: RegistryInvoice = { request: f.request, signature: f.signature, settlement: { txHash: HASH, verifiedAt: 1 }, duplicatePayments: [] };
    // Use the injected client with no retries by pre-failing every call quickly.
    const out = await verifyPublicProof(chain, { recipient: f.merchant.address, id: f.request.id, tx: null }, deps({ invoice, client: down }));
    expect(out.state).toBe('inconclusive');
  }, 60_000);

  it('maps registry errors to not-found vs unavailable', async () => {
    const f = await fixture();
    const route = { recipient: f.merchant.address, id: f.request.id, tx: null };
    const base = { invoice: null as never, client: f.client };
    expect((await verifyPublicProof(chain, route, deps({ ...base, getInvoice: async () => { throw { status: 404 }; } }))).state).toBe('no_invoice');
    expect((await verifyPublicProof(chain, route, deps({ ...base, getInvoice: async () => { throw { status: 0 }; } }))).state).toBe('registry_unavailable');
  });
});
