/**
 * Payment requests with real EIP-712 signatures from real secp256k1 keys.
 */
import { describe, expect, it } from 'vitest';
import { encodeFunctionData, getAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  buildPaymentRequest,
  encodePaymentLink,
  expectedPaymentCalldata,
  isExpired,
  parsePaymentLink,
  requestIdSuffix,
  typedDataFor,
  verifyRequestSignature,
  verifySettlement,
  type SignedPaymentRequest,
} from '../src/lib/paymentRequest';
import { erc20Abi } from '../src/config/abis';
import { MEZO_MAINNET, MEZO_TESTNET } from '../src/config/chains';
import { HASH, receipt, transferLog } from './helpers';

const ORIGIN = 'https://cambio.example';
const recipient = privateKeyToAccount(generatePrivateKey());
const payer = privateKeyToAccount(generatePrivateKey());
const NOW = 1_792_000_000;

async function signed(over: Partial<Parameters<typeof buildPaymentRequest>[0]> = {}) {
  const req = buildPaymentRequest({ chain: MEZO_TESTNET, recipient: recipient.address, amount: 25n * 10n ** 18n, memo: 'Invoice #42', lifetimeSeconds: 7 * 86400, nowSeconds: NOW, ...over });
  const signature = await recipient.signTypedData(typedDataFor(req));
  return { req, signature, url: encodePaymentLink(ORIGIN, req, signature) };
}

/** Rewrites the base64url payload of a link, as an attacker editing it would. */
function tamper(url: string, edit: (r: SignedPaymentRequest) => void): string {
  const u = new URL(url);
  const params = new URLSearchParams(u.hash.slice(u.hash.indexOf('?') + 1));
  const b64 = params.get('r')!.replace(/-/g, '+').replace(/_/g, '/');
  const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  edit(json);
  params.set('r', Buffer.from(JSON.stringify(json)).toString('base64url'));
  return `${ORIGIN}/#pay?${params.toString()}`;
}

describe('signed payment links', () => {
  it('round-trip through a URL string (a separate browser session needs nothing but the link)', async () => {
    const { req, url } = await signed();
    const parsed = parsePaymentLink(url);
    expect(parsed?.kind).toBe('signed');
    if (parsed?.kind !== 'signed') return;
    expect(parsed.request).toEqual(req);
    expect(await verifyRequestSignature(parsed.request, parsed.signature)).toBe(true);
  });

  for (const [field, edit] of [
    ['recipient', (r: SignedPaymentRequest) => (r.recipient = payer.address)],
    ['amount', (r: SignedPaymentRequest) => (r.amount = '2500000000000000000000')],
    ['memo', (r: SignedPaymentRequest) => (r.memo = 'Pay a different invoice')],
    ['expiry', (r: SignedPaymentRequest) => (r.expiresAt = r.expiresAt + 86400)],
    ['id', (r: SignedPaymentRequest) => (r.id = ('0x' + '11'.repeat(16)) as Hex)],
  ] as const) {
    it(`fails verification when the ${field} is tampered with`, async () => {
      const { url } = await signed();
      const parsed = parsePaymentLink(tamper(url, edit));
      expect(parsed?.kind).toBe('signed'); // structurally valid…
      if (parsed?.kind !== 'signed') return;
      expect(await verifyRequestSignature(parsed.request, parsed.signature)).toBe(false); // …but not authentic
    });
  }

  it('fails when signed by someone other than the recipient', async () => {
    const req = buildPaymentRequest({ chain: MEZO_TESTNET, recipient: recipient.address, amount: 1n, memo: '', lifetimeSeconds: 3600, nowSeconds: NOW });
    const forged = await payer.signTypedData(typedDataFor(req));
    expect(await verifyRequestSignature(req, forged)).toBe(false);
  });

  it('binds the chain: a signature for testnet does not verify for another chain id', async () => {
    const { req, signature } = await signed();
    expect(await verifyRequestSignature({ ...req, chainId: MEZO_MAINNET.chainId, token: MEZO_MAINNET.tokens.MUSD.address }, signature)).toBe(false);
  });

  it('marks expired requests as not payable', async () => {
    const { req } = await signed({ lifetimeSeconds: 3600 });
    expect(isExpired(req.expiresAt, NOW + 3599)).toBe(false);
    expect(isExpired(req.expiresAt, NOW + 3600)).toBe(true);
  });

  it('rejects unsupported chains and tokens', async () => {
    const { url } = await signed();
    expect(parsePaymentLink(tamper(url, (r) => (r.chainId = 1)))).toMatchObject({ kind: 'invalid', error: expect.stringMatching(/unsupported network/) });
    // Mainnet is disabled in this (default) build.
    expect(parsePaymentLink(tamper(url, (r) => (r.chainId = 31612)))).toMatchObject({ kind: 'invalid' });
    expect(parsePaymentLink(tamper(url, (r) => (r.token = MEZO_TESTNET.tokens.mUSDC.address)))).toMatchObject({ kind: 'invalid', error: expect.stringMatching(/other than MUSD/) });
  });

  it('fails safely on malformed links', async () => {
    const { url } = await signed();
    const bad = [
      `${ORIGIN}/#pay?r=%%%&s=0x00`,
      `${ORIGIN}/#pay?r=${Buffer.from('not json').toString('base64url')}&s=0x${'00'.repeat(65)}`,
      url.replace(/&s=0x[0-9a-f]+/, ''),
      url.replace(/&s=0x[0-9a-f]+/, '&s=0x123'),
      tamper(url, (r) => ((r as unknown as Record<string, unknown>).extra = 1)),
      tamper(url, (r) => (r.amount = '-5')),
      tamper(url, (r) => (r.amount = '0')),
      tamper(url, (r) => (r.amount = '1.5')),
      tamper(url, (r) => (r.recipient = '0x0000000000000000000000000000000000000000' as never)),
      tamper(url, (r) => (r.memo = 'x'.repeat(141))),
      tamper(url, (r) => (r.expiresAt = r.createdAt + 365 * 86400)),
      `${url}&tx=0xnothex`,
      `${ORIGIN}/#pay?r=${'A'.repeat(5000)}&s=0x00`,
    ];
    for (const b of bad) expect(parsePaymentLink(b)?.kind, b.slice(0, 80)).toBe('invalid');
  });
});

describe('unsigned links', () => {
  it('parse the simple receive format with exact amounts', () => {
    const p = parsePaymentLink(`${ORIGIN}/#pay?to=${recipient.address.toLowerCase()}&chain=31611&amt=12.34`);
    expect(p).toMatchObject({ kind: 'unsigned', recipient: recipient.address, amount: 12_340_000_000_000_000_000n, chainId: 31611 });
  });

  it('reject invalid addresses and amounts', () => {
    for (const q of ['to=0x123', 'to=0x0000000000000000000000000000000000000000', `to=${recipient.address}&amt=-1`, `to=${recipient.address}&amt=1e3`, `to=${recipient.address}&amt=0`, 'to=bad name!', `to=${recipient.address}&chain=1`]) {
      expect(parsePaymentLink(`${ORIGIN}/#pay?${q}`)?.kind, q).toBe('invalid');
    }
  });

  it('accept a @username, which must then be resolved through the verified registry', () => {
    expect(parsePaymentLink(`${ORIGIN}/#pay?to=@Alice_01`)).toMatchObject({ kind: 'unsigned', recipient: null, recipientUsername: 'alice_01' });
  });

  it('treat legacy v1 links as unsigned and ignore their client-supplied username', () => {
    const legacy = encodeURIComponent(JSON.stringify({ id: 'req_1', to: recipient.address, u: '@mezo_treasury', amt: 10, note: 'hi', exp: 24, cat: Date.now() }));
    const p = parsePaymentLink(`${ORIGIN}/#pay?req=${legacy}`);
    expect(p).toMatchObject({ kind: 'unsigned', source: 'legacy-v1', recipient: recipient.address, recipientUsername: null, amount: 10n * 10n ** 18n });
  });

  it('do not treat ordinary app URLs as payment links', () => {
    expect(parsePaymentLink(`${ORIGIN}/app/activity`)).toBeNull();
  });
});

describe('verifySettlement: a request is paid only by matching on-chain evidence', () => {
  const MUSD = MEZO_TESTNET.tokens.MUSD.address;
  const setup = async () => {
    const { req } = await signed();
    const tx = { hash: HASH, from: getAddress(payer.address), to: MUSD, input: expectedPaymentCalldata(req), chainId: 31611 };
    const ok = receipt('success', [transferLog(MUSD, payer.address, req.recipient, BigInt(req.amount))]);
    return { req, tx, ok };
  };

  it('accepts the exact transfer with the request id suffix', async () => {
    const { req, tx, ok } = await setup();
    expect(verifySettlement(req, tx, ok, (NOW + 60) * 1000)).toMatchObject({ status: 'settled', payer: getAddress(payer.address) });
    expect(tx.input.endsWith(requestIdSuffix(req.id).slice(2))).toBe(true);
  });

  it('rejects a transfer without the request id (an unrelated payment of the same amount)', async () => {
    const { req, tx, ok } = await setup();
    const plain = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [req.recipient, BigInt(req.amount)] });
    expect(verifySettlement(req, { ...tx, input: plain }, ok, null).status).toBe('mismatch');
  });

  it('rejects the wrong amount, token, chain, a reverted receipt and a missing Transfer event', async () => {
    const { req, tx, ok } = await setup();
    const wrongAmount = { ...req, amount: (BigInt(req.amount) - 1n).toString() };
    expect(verifySettlement(wrongAmount, tx, ok, null).status).toBe('mismatch');
    expect(verifySettlement(req, { ...tx, to: MEZO_TESTNET.tokens.mUSDC.address }, ok, null).status).toBe('mismatch');
    expect(verifySettlement(req, { ...tx, chainId: 31612 }, ok, null).status).toBe('mismatch');
    expect(verifySettlement(req, tx, receipt('reverted'), null).status).toBe('reverted');
    expect(verifySettlement(req, tx, receipt('success', []), null).status).toBe('mismatch');
  });

  it('flags payment after expiry', async () => {
    const { req, tx, ok } = await setup();
    expect(verifySettlement(req, tx, ok, (req.expiresAt + 1) * 1000).status).toBe('settled_after_expiry');
  });
});
