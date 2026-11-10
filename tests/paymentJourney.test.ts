/**
 * Payer journey: step derivation, refresh-safe recovery of a submitted payment, and registry sync.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { MEZO_TESTNET } from '../src/config/chains';
import { buildPaymentRequest } from '../src/lib/paymentRequest';
import { findSubmittedPayment, journeySteps, syncSettlementToRegistry, type JourneyInput } from '../src/lib/paymentJourney';
import type { LedgerEntry } from '../src/lib/transactions';
import { ALICE, BOB } from './helpers';

const chain = MEZO_TESTNET;
const base: JourneyInput = { signature: 'valid', closed: false, walletConnected: false, rightChain: false, needsFunding: null, fundingUsed: false, paymentSubmitted: false, settled: false };
const statuses = (i: JourneyInput) => journeySteps(i).map((s) => `${s.key}:${s.status}`);

describe('journeySteps', () => {
  it('starts at Connect once the signature is valid, without a funding step', () => {
    expect(statuses(base)).toEqual(['review:done', 'connect:current', 'confirm:upcoming', 'verify:upcoming']);
  });
  it('shows Fund only when the wallet is short of MUSD, and keeps it once used', () => {
    const short = { ...base, walletConnected: true, rightChain: true, needsFunding: true };
    expect(statuses(short)).toEqual(['review:done', 'connect:done', 'fund:current', 'confirm:upcoming', 'verify:upcoming']);
    expect(statuses({ ...short, needsFunding: false, fundingUsed: true })).toEqual(['review:done', 'connect:done', 'fund:done', 'confirm:current', 'verify:upcoming']);
  });
  it('treats the wrong network as an unfinished Connect step', () => {
    expect(statuses({ ...base, walletConnected: true, rightChain: false })[1]).toBe('connect:current');
  });
  it('blocks at Review for an invalid signature or a closed (expired) request', () => {
    expect(statuses({ ...base, signature: 'invalid' })[0]).toBe('review:blocked');
    expect(statuses({ ...base, closed: true })[0]).toBe('review:blocked');
    expect(statuses({ ...base, signature: 'invalid' }).slice(1).every((s) => s.endsWith('upcoming'))).toBe(true);
  });
  it('waits on Verify after submission and completes only when the chain confirms', () => {
    expect(statuses({ ...base, paymentSubmitted: true }).at(-1)).toBe('verify:current');
    expect(statuses({ ...base, paymentSubmitted: true, settled: true }).every((s) => s.endsWith('done'))).toBe(true);
  });
});

describe('findSubmittedPayment', () => {
  const req = buildPaymentRequest({ chain, recipient: BOB, amount: 5n * 10n ** 18n, memo: '', lifetimeSeconds: 3600, nowSeconds: 1_800_000_000 });
  const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
    mode: 'real', kind: 'transfer', chainId: chain.chainId, hash: ('0x' + '1'.repeat(64)) as Hex, from: ALICE, to: BOB as Address,
    token: chain.tokens.MUSD.address, symbol: 'MUSD', decimals: 18, amount: req.amount, status: 'pending', submittedAt: 1, requestId: req.id, ...over,
  });
  it('returns the newest non-reverted submission for exactly this request', () => {
    const newer = entry({ hash: ('0x' + '2'.repeat(64)) as Hex, submittedAt: 5 });
    expect(findSubmittedPayment([entry(), newer], req)?.hash).toBe(newer.hash);
  });
  it('ignores reverted payments and anything with a different id, recipient, token or amount', () => {
    expect(findSubmittedPayment([entry({ status: 'reverted' })], req)).toBeNull();
    expect(findSubmittedPayment([entry({ requestId: '0x' + 'f'.repeat(32) })], req)).toBeNull();
    expect(findSubmittedPayment([entry({ to: ALICE })], req)).toBeNull();
    expect(findSubmittedPayment([entry({ amount: '1' })], req)).toBeNull();
    expect(findSubmittedPayment([entry({ token: chain.tokens.BTC.address })], req)).toBeNull();
    expect(findSubmittedPayment([entry({ requestId: undefined })], req)).toBeNull();
  });
});

describe('syncSettlementToRegistry', () => {
  const apiErr = (status: number, code: string, message = code) => Object.assign(new Error(message), { status, code, message });
  const noSleep = async () => undefined;

  it('records on the first try', async () => {
    expect(await syncSettlementToRegistry({ save: vi.fn(), submit: async () => ({}), sleep: noSleep })).toEqual({ state: 'recorded' });
  });
  it('stores the signed request when the registry does not have it, then records', async () => {
    const save = vi.fn(async () => ({}));
    const submit = vi.fn().mockRejectedValueOnce(apiErr(404, 'not_found')).mockResolvedValueOnce({});
    expect(await syncSettlementToRegistry({ save, submit, sleep: noSleep }, [1])).toEqual({ state: 'recorded' });
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('waits out "not visible yet", confirmations and 503s', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(apiErr(404, 'tx_not_found'))
      .mockRejectedValueOnce(apiErr(409, 'awaiting_confirmations'))
      .mockRejectedValueOnce(apiErr(503, 'rpc_unavailable'))
      .mockResolvedValueOnce({});
    const sleep = vi.fn(noSleep);
    expect(await syncSettlementToRegistry({ save: vi.fn(), submit, sleep }, [1, 1, 1])).toEqual({ state: 'recorded' });
    expect(sleep).toHaveBeenCalledTimes(3);
  });
  it('stops immediately when the server says it is not a settlement', async () => {
    const submit = vi.fn().mockRejectedValue(apiErr(422, 'not_a_settlement', 'Transaction does not pay this request.'));
    expect(await syncSettlementToRegistry({ save: vi.fn(), submit, sleep: noSleep }, [1, 1])).toEqual({ state: 'rejected', message: 'Transaction does not pay this request.' });
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('reports unavailable after the schedule, or when the network is down', async () => {
    const submit = vi.fn().mockRejectedValue(apiErr(503, 'rpc_unavailable'));
    expect((await syncSettlementToRegistry({ save: vi.fn(), submit, sleep: noSleep }, [1, 1])).state).toBe('unavailable');
    expect(submit).toHaveBeenCalledTimes(3);
    expect((await syncSettlementToRegistry({ save: vi.fn(), submit: async () => { throw new TypeError('fetch failed'); }, sleep: noSleep })).state).toBe('unavailable');
  });
  it('treats a refused signature on save as rejected, never recorded', async () => {
    const submit = vi.fn().mockRejectedValue(apiErr(404, 'not_found'));
    const save = vi.fn().mockRejectedValue(apiErr(401, 'invalid_signature'));
    expect((await syncSettlementToRegistry({ save, submit, sleep: noSleep }, [1])).state).toBe('rejected');
  });
});
