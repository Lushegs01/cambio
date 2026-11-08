/**
 * Automatic discovery of a signed-request settlement and transient-RPC retries.
 * The registry is treated as untrusted: only an EIP-712-valid request whose settlement verifies passes.
 */
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { MEZO_TESTNET } from '../src/config/chains';
import { checkSignedSettlement, discoverSignedSettlements, type EvidenceTx } from '../src/lib/evidence';
import { buildPaymentRequest, encodePaymentLink, expectedPaymentCalldata, parsePaymentLink, typedDataFor, verifyRequestSignature, type SignedPaymentRequest } from '../src/lib/paymentRequest';
import { isTransientRpcError, retryRead } from '../src/lib/rpcRetry';
import { HASH, receipt, transferLog } from './helpers';

const chain = MEZO_TESTNET;
const MUSD = chain.tokens.MUSD.address;
const TS = Date.UTC(2026, 10, 8, 12);

async function signedFixture() {
  const merchant = privateKeyToAccount(generatePrivateKey());
  const payer = privateKeyToAccount(generatePrivateKey());
  const request = buildPaymentRequest({ chain, recipient: merchant.address, amount: 9n * 10n ** 18n, memo: 'Logo design', lifetimeSeconds: 86_400, nowSeconds: TS / 1000 - 60 });
  const signature = await merchant.signTypedData(typedDataFor(request));
  return { merchant, payer, request, signature };
}

/** Builds a verifier with a fake chain whose only transaction is `tx`. */
function verifierFor(tx: EvidenceTx, payer: Hex, request: SignedPaymentRequest) {
  return async (hash: Hex, link: string) => {
    const parsed = parsePaymentLink(link);
    if (!parsed || parsed.kind !== 'signed') throw new Error('bad link');
    const valid = await verifyRequestSignature(parsed.request, parsed.signature);
    const logs = [transferLog(MUSD, payer, request.recipient, BigInt(request.amount))];
    return checkSignedSettlement(chain, hash, parsed.request, valid, tx, receipt('success', logs), TS);
  };
}

describe('discoverSignedSettlements', () => {
  it('recovers the signed request by on-chain request id and verifies it end to end', async () => {
    const { merchant, payer, request, signature } = await signedFixture();
    const tx: EvidenceTx = { hash: HASH, from: payer.address, to: MUSD, input: expectedPaymentCalldata(request), chainId: chain.chainId };
    const out = await discoverSignedSettlements(
      [{ hash: HASH, from: payer.address, recipient: merchant.address, requestId: request.id }],
      merchant.address,
      async () => ({ request, signature }),
      (r, s) => encodePaymentLink('https://cambio.test', r, s),
      verifierFor(tx, payer.address, request)
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('verified');
    if (out[0].status === 'verified') expect(out[0].result.verdict).toBe('PASS');
  });

  it('rejects a registry entry whose amount was altered after signing', async () => {
    const { merchant, payer, request, signature } = await signedFixture();
    const forged = { ...request, amount: (BigInt(request.amount) / 2n).toString() };
    const tx: EvidenceTx = { hash: HASH, from: payer.address, to: MUSD, input: expectedPaymentCalldata(forged), chainId: chain.chainId };
    const out = await discoverSignedSettlements(
      [{ hash: HASH, from: payer.address, recipient: merchant.address, requestId: request.id }],
      merchant.address,
      async () => ({ request: forged, signature }),
      (r, s) => encodePaymentLink('https://cambio.test', r, s),
      verifierFor(tx, payer.address, forged)
    );
    expect(out[0].status).toBe('rejected');
  });

  it('rejects a registry answer for a different request id, and skips payments to other recipients', async () => {
    const { merchant, payer, request, signature } = await signedFixture();
    const other = await signedFixture();
    let verified = 0;
    const out = await discoverSignedSettlements(
      [
        { hash: HASH, from: payer.address, recipient: merchant.address, requestId: '0x' + 'ab'.repeat(16) as Hex },
        { hash: ('0x' + '11'.repeat(32)) as Hex, from: payer.address, recipient: other.merchant.address, requestId: other.request.id },
      ],
      merchant.address,
      async () => ({ request, signature }),
      (r, s) => encodePaymentLink('https://cambio.test', r, s),
      async () => {
        verified++;
        throw new Error('must not verify');
      }
    );
    expect(verified).toBe(0);
    expect(out).toEqual([expect.objectContaining({ status: 'no_signed_request' })]);
  });

  it('reports a request missing from the registry instead of guessing', async () => {
    const { merchant, payer, request } = await signedFixture();
    const out = await discoverSignedSettlements(
      [{ hash: HASH, from: payer.address, recipient: merchant.address, requestId: request.id }],
      merchant.address,
      async () => ({ error: 'not stored' }),
      () => '',
      async () => {
        throw new Error('unreachable');
      }
    );
    expect(out).toEqual([{ hash: HASH, requestId: request.id, status: 'no_signed_request', reason: 'not stored' }]);
  });
});

describe('retryRead', () => {
  const noSleep = async () => undefined;
  it('retries timeouts, HTTP 5xx/429 and not-found, then returns the first real answer', async () => {
    const errors = [Object.assign(new Error('t'), { name: 'TimeoutError' }), Object.assign(new Error('h'), { name: 'HttpRequestError', status: 503 }), Object.assign(new Error('n'), { name: 'TransactionReceiptNotFoundError' })];
    let i = 0;
    const value = await retryRead(async () => {
      if (i < errors.length) throw errors[i++];
      return 'receipt';
    }, [1, 1, 1], noSleep);
    expect(value).toBe('receipt');
  });

  it('does not retry a contract revert or a malformed request', async () => {
    let calls = 0;
    await expect(retryRead(async () => {
      calls++;
      throw Object.assign(new Error('reverted'), { name: 'ContractFunctionRevertedError' });
    }, [1, 1], noSleep)).rejects.toThrow('reverted');
    expect(calls).toBe(1);
  });

  it('gives up after the schedule and surfaces the last error', async () => {
    let calls = 0;
    await expect(retryRead(async () => {
      calls++;
      throw Object.assign(new Error('down'), { name: 'HttpRequestError' });
    }, [1, 1], noSleep)).rejects.toThrow('down');
    expect(calls).toBe(3);
  });

  it('classifies wrapped transport causes as transient', () => {
    expect(isTransientRpcError({ name: 'CallExecutionError', cause: { name: 'HttpRequestError' } })).toBe(true);
    expect(isTransientRpcError({ name: 'X', details: 'Too Many Requests' })).toBe(true);
    expect(isTransientRpcError({ name: 'ContractFunctionRevertedError' })).toBe(false);
    expect(isTransientRpcError(null)).toBe(false);
  });
});
