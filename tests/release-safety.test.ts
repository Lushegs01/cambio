import { describe, expect, it, vi } from 'vitest';
import { MEZO_TESTNET, toChainIdNumber } from '../src/config/chains';
import { reconcileLedger, type LedgerEntry } from '../src/lib/transactions';
import { ledgerReceiptStatus } from '../src/lib/receiptEvidence';
import { executeSwap, type SwapDeps, type SwapQuote } from '../src/lib/swap';
import { buildPaymentRequest, expectedPaymentCalldata, parsePaymentLink, verifySettlement } from '../src/lib/paymentRequest';
import { verifyPaymentTx } from '../src/lib/requestSettlement';
import { ALICE, BOB, HASH, receipt, transferLog } from './helpers';
import { csvCell } from '../src/lib/csv';
import { validateUsername } from '../shared/username';

const C = MEZO_TESTNET;
const entry: LedgerEntry = { mode: 'real', kind: 'transfer', chainId: C.chainId, hash: HASH, from: ALICE, to: BOB, token: C.tokens.MUSD.address, amount: '5', symbol: 'MUSD', decimals: 18, status: 'unknown', submittedAt: 1 };

it('neutralizes CSV formulas including whitespace and control prefixes without breaking quotes', () => {
  for (const cell of ['=1+1', ' =1+1', '\t=1+1', '\n=1+1', '\uFEFF@SUM(1)', '-1', '+1']) expect(csvCell(cell).startsWith('"\'')).toBe(true);
  expect(csvCell('Invoice "42", paid')).toBe('"Invoice ""42"", paid"');
});

it('reserves common digit-lookalike spellings of Cambio, Mezo and support identities', () => {
  for (const name of ['camb10', 'mez0', 'm3zo_team', 'supp0rt', 'adm1n', '0fficial']) expect(validateUsername(name).valid, name).toBe(false);
  expect(validateUsername('bankole').valid).toBe(true);
});

describe('financial receipt evidence survives recovery paths', () => {
  it('never upgrades a successful receipt with missing or mismatched payment evidence', async () => {
    for (const r of [receipt('success'), receipt('success', [transferLog(entry.token, ALICE, BOB, 4n)]), { status: 'success' as const, blockNumber: 1n, gasUsed: 1n }]) {
      const update = vi.fn();
      await reconcileLedger([entry], async () => r, update);
      expect(update).toHaveBeenCalledWith(HASH, 'unknown', r);
    }
    expect(ledgerReceiptStatus(entry, receipt('success', [transferLog(entry.token, ALICE, BOB, 5n)]))).toBe('confirmed');
  });

  it('requires both swap input and minimum output; a successful approval is insufficient', () => {
    const swap: LedgerEntry = { ...entry, kind: 'swap', swap: { tokenOut: C.tokens.BTC.address, symbolOut: 'BTC', decimalsOut: 18, minAmountOut: '10' } };
    const input = transferLog(entry.token, ALICE, C.pools[0].address, 5n);
    expect(ledgerReceiptStatus(swap, receipt('success', [input]))).toBe('unknown');
    expect(ledgerReceiptStatus(swap, receipt('success', [input, transferLog(C.tokens.BTC.address, C.pools[0].address, ALICE, 9n)]))).toBe('unknown');
    expect(ledgerReceiptStatus(swap, receipt('success', [input, transferLog(C.tokens.BTC.address, C.pools[0].address, ALICE, 10n)]))).toBe('confirmed');
  });
  it('revalidates a cached confirmation and demotes it when its receipt disappears', async () => {
    const update = vi.fn();
    await reconcileLedger([{ ...entry, status: 'confirmed' }], async () => null, update);
    expect(update).toHaveBeenCalledWith(HASH, 'unknown', null);
  });
});

describe('settlement fails closed', () => {
  const request = buildPaymentRequest({ chain: C, recipient: BOB, amount: 5n, memo: '', lifetimeSeconds: 60, nowSeconds: 1000 });
  const tx = { hash: HASH, from: ALICE, to: request.token, input: expectedPaymentCalldata(request), chainId: C.chainId };
  const r = receipt('success', [transferLog(request.token, ALICE, BOB, 5n)]);
  it('requires known chain and block time and rejects a payment predating the request', () => {
    expect(verifySettlement(request, { ...tx, chainId: undefined }, r, 1001000).status).toBe('mismatch');
    expect(verifySettlement(request, tx, r, null).status).toBe('mismatch');
    expect(verifySettlement(request, tx, r, 999000).status).toBe('mismatch');
    expect(verifySettlement(request, tx, r, 1060000).status).toBe('settled_after_expiry');
  });
  it('does not declare settlement when the block cannot be read or the RPC hash differs', async () => {
    const client = { getTransaction: async () => tx, getTransactionReceipt: async () => r, getBlock: async () => { throw new Error('RPC unavailable'); } };
    expect((await verifyPaymentTx(client, request, HASH)).state).toBe('error');
    client.getTransaction = async () => ({ ...tx, hash: `0x${'cc'.repeat(32)}` });
    expect((await verifyPaymentTx(client, request, HASH)).state).toBe('error');
  });
  it('rejects ambiguous URLs and signed payload removal instead of downgrading to unsigned', () => {
    expect(parsePaymentLink(`https://cambio.example/#pay?to=${BOB}&to=${ALICE}`)?.kind).toBe('invalid');
    expect(parsePaymentLink(`https://cambio.example/#pay?to=${BOB}&s=0x1234`)?.kind).toBe('invalid');
  });
  it('refuses unpayable request creation and malformed chain identifiers', () => {
    expect(() => buildPaymentRequest({ chain: C, recipient: `0x${'0'.repeat(40)}`, amount: 5n, memo: '', lifetimeSeconds: 60 })).toThrow();
    for (const id of ['31611garbage', '0x7b7bzz', '31611.5', '-31611', 'eip155:31611oops']) expect(toChainIdNumber(id)).toBeNull();
  });
});

describe('swap execution enforces safety beyond its UI', () => {
  const quote: SwapQuote = { chainId: C.chainId, tokenIn: C.tokens.MUSD, tokenOut: C.tokens.BTC, amountIn: 1000n, amountOut: 100n, minAmountOut: 99n, slippageBps: 100, feeBps: 4, priceImpactBps: 0, route: { from: C.tokens.MUSD.address, to: C.tokens.BTC.address, stable: false, factory: C.poolFactory }, pool: C.pools[0].address, fetchedAt: Date.now(), blockNumber: 1n };
  function deps() {
    let account = ALICE;
    const d: SwapDeps = {
      getConnection: () => ({ address: account, chainId: C.chainId }),
      readTokenBalance: async () => 10000n, readNativeBalance: async () => 10000n, readAllowance: async () => 10000n,
      sendApprove: vi.fn(async () => HASH), sendSwap: vi.fn(async () => HASH),
      simulateSwap: vi.fn(async () => undefined), waitForReceipt: async () => receipt('success'), getBlockTimestamp: async () => 1,
      quoteClient: { getBlockNumber: async () => 1n, readContract: async ({ functionName, args }: any) => functionName === 'getFee' ? 4n : [args[0], args[0] / 10n] },
    };
    return { d, switchAccount: () => { account = BOB; } };
  }
  it('blocks unknown or excessive impact before approvals', async () => {
    for (const impact of [null, 1501]) {
      const { d } = deps();
      const result = await executeSwap(d, C, ALICE, { ...quote, fetchedAt: Date.now(), priceImpactBps: impact }, () => {});
      expect(result.phase.phase).toBe('failed');
      expect(d.sendApprove).not.toHaveBeenCalled(); expect(d.sendSwap).not.toHaveBeenCalled();
    }
  });
  it('rechecks the account after asynchronous simulation', async () => {
    const { d, switchAccount } = deps(); d.simulateSwap = async () => switchAccount();
    expect((await executeSwap(d, C, ALICE, { ...quote, fetchedAt: Date.now() }, () => {})).phase.phase).toBe('failed');
    expect(d.sendSwap).not.toHaveBeenCalled();
  });
  it('keeps a receipt without swap evidence unknown', async () => {
    const { d } = deps();
    expect((await executeSwap(d, C, ALICE, { ...quote, fetchedAt: Date.now() }, () => {})).phase.phase).toBe('unknown');
  });
});
