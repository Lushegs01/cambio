/**
 * Evidence verification: PASS only when every fact is read and matches; unreadable data is INCONCLUSIVE.
 */
import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { erc20Abi, routerAbi } from '../src/config/abis';
import { MEZO_TESTNET } from '../src/config/chains';
import {
  checkBtcToMusdSwap,
  checkMusdTransfer,
  checkSignedSettlement,
  fetchEvidence,
  findSuffixedPayments,
  requestIdFromSuffix,
  splitTransferCalldata,
  verdictOf,
  type EvidenceClient,
  type EvidenceTx,
} from '../src/lib/evidence';
import { buildPaymentRequest, expectedPaymentCalldata, requestIdSuffix, typedDataFor, verifyRequestSignature } from '../src/lib/paymentRequest';
import { retryNotFound, retryNull } from '../src/lib/rpcRetry';
import { ALICE, BOB, HASH, receipt, transferLog } from './helpers';

const chain = MEZO_TESTNET;
const MUSD = chain.tokens.MUSD.address;
const BTC = chain.tokens.BTC.address;
const POOL = chain.pools.find((p) => p.tokenB === 'BTC')!.address;
const TEN = 10n * 10n ** 18n;
const TS = Date.UTC(2026, 9, 26, 23, 45, 36);

function transferTx(input: Hex, over: Partial<EvidenceTx> = {}): EvidenceTx {
  return { hash: HASH, from: ALICE, to: MUSD, input, chainId: chain.chainId, ...over };
}
const plainTransfer = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [BOB, TEN] });

describe('verdicts', () => {
  it('needs every check to be read and true for PASS', () => {
    expect(verdictOf([{ name: 'a', ok: true, detail: '' }])).toBe('PASS');
    expect(verdictOf([{ name: 'a', ok: true, detail: '' }, { name: 'b', ok: null, detail: '' }])).toBe('INCONCLUSIVE');
    expect(verdictOf([{ name: 'a', ok: null, detail: '' }, { name: 'b', ok: false, detail: '' }])).toBe('FAIL');
    expect(verdictOf([])).toBe('INCONCLUSIVE');
  });
});

describe('MUSD transfer evidence', () => {
  it('passes for a successful transfer with the matching Transfer event', () => {
    const r = checkMusdTransfer(chain, HASH, transferTx(plainTransfer), receipt('success', [transferLog(MUSD, ALICE, BOB, TEN)]), TS, { from: ALICE, to: BOB, amount: TEN.toString() });
    expect(r.verdict).toBe('PASS');
    expect(r.facts.amount).toBe(TEN.toString());
    expect(r.facts.calldataSuffix).toBe('none');
  });

  it('fails when the receipt reverted, the event is missing or differs, or the target is not MUSD', () => {
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer), receipt('reverted'), TS).verdict).toBe('FAIL');
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer), receipt('success', []), TS).verdict).toBe('FAIL');
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer), receipt('success', [transferLog(MUSD, ALICE, BOB, TEN - 1n)]), TS).verdict).toBe('FAIL');
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer, { to: BTC }), receipt('success', [transferLog(MUSD, ALICE, BOB, TEN)]), TS).verdict).toBe('FAIL');
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer, { chainId: 31612 }), receipt('success', [transferLog(MUSD, ALICE, BOB, TEN)]), TS).verdict).toBe('FAIL');
  });

  it('fails when the claimed recipient or amount does not match', () => {
    const ok = receipt('success', [transferLog(MUSD, ALICE, BOB, TEN)]);
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer), ok, TS, { to: ALICE }).verdict).toBe('FAIL');
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer), ok, TS, { amount: '1' }).verdict).toBe('FAIL');
  });

  it('is inconclusive when the block timestamp or chain id could not be read', () => {
    const ok = receipt('success', [transferLog(MUSD, ALICE, BOB, TEN)]);
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer), ok, null).verdict).toBe('INCONCLUSIVE');
    expect(checkMusdTransfer(chain, HASH, transferTx(plainTransfer, { chainId: undefined }), ok, TS).verdict).toBe('INCONCLUSIVE');
  });

  it('decodes the Cambio request-id suffix without treating it as settlement', () => {
    const id = ('0x' + '42'.repeat(16)) as Hex;
    const input = `${plainTransfer}${requestIdSuffix(id).slice(2)}` as Hex;
    const split = splitTransferCalldata(input)!;
    expect(split.to).toBe(BOB);
    expect(requestIdFromSuffix(split.suffix)).toBe(id);
    expect(requestIdFromSuffix('0xdeadbeef' as Hex)).toBeNull();
    expect(splitTransferCalldata('0x095ea7b3' as Hex)).toBeNull();
  });
});

describe('BTC → MUSD swap evidence', () => {
  const amountIn = 10n ** 16n;
  const minOut = 782n * 10n ** 18n;
  const swapInput = (over: { from?: Address; to?: Address; factory?: Address } = {}) =>
    encodeFunctionData({
      abi: routerAbi,
      functionName: 'swapExactTokensForTokens',
      args: [amountIn, minOut, [{ from: over.from ?? BTC, to: over.to ?? MUSD, stable: false, factory: over.factory ?? chain.poolFactory }], ALICE, 1_793_023_511n],
    });
  const tx = (input: Hex): EvidenceTx => ({ hash: HASH, from: ALICE, to: chain.router, input, chainId: chain.chainId });
  const logs = (out: bigint) => [transferLog(BTC, ALICE, POOL, amountIn), transferLog(MUSD, POOL, ALICE, out)];

  it('passes when BTC went into the pool and at least amountOutMin MUSD came back', () => {
    const r = checkBtcToMusdSwap(chain, HASH, tx(swapInput()), receipt('success', logs(786n * 10n ** 18n)), TS, { trader: ALICE });
    expect(r.verdict).toBe('PASS');
    expect(r.facts.amountOut).toBe((786n * 10n ** 18n).toString());
  });

  it('fails when the output is below the router minimum, the route is not BTC→MUSD, or the factory is foreign', () => {
    expect(checkBtcToMusdSwap(chain, HASH, tx(swapInput()), receipt('success', logs(minOut - 1n)), TS).verdict).toBe('FAIL');
    expect(checkBtcToMusdSwap(chain, HASH, tx(swapInput({ from: chain.tokens.mUSDC.address })), receipt('success', logs(minOut)), TS).verdict).toBe('FAIL');
    expect(checkBtcToMusdSwap(chain, HASH, tx(swapInput({ factory: BOB })), receipt('success', logs(minOut)), TS).verdict).toBe('FAIL');
    expect(checkBtcToMusdSwap(chain, HASH, { ...tx(swapInput()), to: BOB }, receipt('success', logs(minOut)), TS).verdict).toBe('FAIL');
  });
});

describe('signed-request settlement evidence', () => {
  it('passes only for the exact calldata of a correctly signed request', async () => {
    const merchant = privateKeyToAccount(generatePrivateKey());
    const req = buildPaymentRequest({ chain, recipient: merchant.address, amount: TEN, memo: 'Invoice 7', lifetimeSeconds: 86_400, nowSeconds: Math.floor(TS / 1000) - 60 });
    const signature = await merchant.signTypedData(typedDataFor(req));
    const valid = await verifyRequestSignature(req, signature);
    const logs = [transferLog(MUSD, ALICE, merchant.address, TEN)];
    const good = checkSignedSettlement(chain, HASH, req, valid, transferTx(expectedPaymentCalldata(req)), receipt('success', logs), TS);
    expect(good.verdict).toBe('PASS');
    expect(good.facts.requestId).toBe(req.id);

    // A plain transfer of the same amount to the same merchant does not settle the request.
    const plain = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [merchant.address, TEN] });
    expect(checkSignedSettlement(chain, HASH, req, valid, transferTx(plain), receipt('success', logs), TS).verdict).toBe('FAIL');
    // A forged signature fails even with the right calldata.
    expect(checkSignedSettlement(chain, HASH, req, false, transferTx(expectedPaymentCalldata(req)), receipt('success', logs), TS).verdict).toBe('FAIL');
    // An unreadable block time is not a pass.
    expect(checkSignedSettlement(chain, HASH, req, valid, transferTx(expectedPaymentCalldata(req)), receipt('success', logs), null).verdict).toBe('INCONCLUSIVE');
  });
});

describe('fetching evidence from an inconsistent RPC', () => {
  const notFound = () => Object.assign(new Error('not found'), { name: 'TransactionReceiptNotFoundError' });

  it('retries "not found" before concluding, and accepts the first real receipt', async () => {
    let calls = 0;
    const client: EvidenceClient = {
      getTransaction: async () => transferTx(plainTransfer),
      getTransactionReceipt: async () => {
        calls++;
        if (calls < 3) throw notFound();
        return receipt('success', [transferLog(MUSD, ALICE, BOB, TEN)]);
      },
      getBlock: async () => ({ timestamp: BigInt(TS / 1000) }),
    };
    const f = await fetchEvidence(client, HASH, [0, 0, 0]);
    expect(f.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it('reports persistent absence and RPC failures as unavailable, never as evidence', async () => {
    const absent: EvidenceClient = {
      getTransaction: async () => transferTx(plainTransfer),
      getTransactionReceipt: async () => { throw notFound(); },
      getBlock: async () => ({ timestamp: 0n }),
    };
    expect(await fetchEvidence(absent, HASH, [0, 0])).toEqual({ ok: false, reason: expect.stringMatching(/not found/i) });
    const down: EvidenceClient = { ...absent, getTransactionReceipt: async () => { throw new Error('fetch failed'); } };
    expect(await fetchEvidence(down, HASH, [0])).toEqual({ ok: false, reason: expect.stringMatching(/RPC/) });
    expect(await fetchEvidence(absent, '0x1234' as Hex)).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('retry helpers stop at the first success and never retry other errors', async () => {
    const sleep = vi.fn(async () => undefined);
    let n = 0;
    expect(await retryNull(async () => (++n < 2 ? null : 'x'), [5, 5, 5], sleep)).toBe('x');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(await retryNull(async () => null, [1, 1], sleep)).toBeNull();
    const boom = vi.fn(async () => { throw new Error('boom'); });
    await expect(retryNotFound(boom, [1, 1], sleep)).rejects.toThrow('boom');
    expect(boom).toHaveBeenCalledTimes(1);
  });
});

describe('scanning explorer rows for Cambio payments', () => {
  it('returns only MUSD transfers with a well-formed request-id suffix', () => {
    const id = ('0x' + 'ab'.repeat(16)) as Hex;
    const rows = [
      { hash: HASH, to: { hash: MUSD }, from: { hash: ALICE }, raw_input: `${plainTransfer}${requestIdSuffix(id).slice(2)}` },
      { hash: ('0x' + 'cd'.repeat(32)) as Hex, to: { hash: MUSD }, from: { hash: ALICE }, raw_input: plainTransfer },
      { hash: ('0x' + 'ef'.repeat(32)) as Hex, to: { hash: BTC }, from: { hash: ALICE }, raw_input: `${plainTransfer}${requestIdSuffix(id).slice(2)}` },
      { hash: 'bad', to: { hash: MUSD }, from: { hash: ALICE }, raw_input: plainTransfer },
    ];
    expect(findSuffixedPayments(chain, rows)).toEqual([{ hash: HASH, from: getAddress(ALICE), recipient: BOB, amount: TEN, requestId: id }]);
  });
});
