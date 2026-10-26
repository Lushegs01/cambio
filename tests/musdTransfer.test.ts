/**
 * The real transfer executor, driven by deterministic test doubles for the wallet and RPC.
 * These tests prove state handling; they do not (and cannot) prove a live transaction succeeded.
 */
import { describe, expect, it, vi } from 'vitest';
import { UserRejectedRequestError, WaitForTransactionReceiptTimeoutError, type Address, type Hex } from 'viem';
import { executeMusdTransfer, previewTransfer, receiptHasTransfer, type TransferDeps, type TransferParams } from '../src/lib/musdTransfer';
import { MEZO_TESTNET } from '../src/config/chains';
import type { LedgerEntry, TxPhase } from '../src/lib/transactions';
import { ALICE, BOB, HASH, receipt, transferLog } from './helpers';

const MUSD = MEZO_TESTNET.tokens.MUSD.address;
const ONE = 10n ** 18n;

function makeDeps(over: Partial<TransferDeps> = {}) {
  const ledger: LedgerEntry[] = [];
  const updates: Array<[Hex, unknown]> = [];
  const deps: TransferDeps = {
    getConnection: () => ({ address: ALICE, chainId: MEZO_TESTNET.chainId }),
    readTokenBalance: async () => 100n * ONE,
    readNativeBalance: async () => 10n ** 15n,
    estimateFee: async () => ({ gas: 35_000n, fee: 35_000n * 150n }),
    sendTransfer: vi.fn(async () => HASH),
    waitForReceipt: async () => receipt('success', [transferLog(MUSD, ALICE, BOB, 5n * ONE)]),
    getBlockTimestamp: async () => 1_792_700_000_000,
    recordLedger: (e) => ledger.push(e),
    updateLedger: (_c, _f, hash, patch) => updates.push([hash, patch]),
    now: () => 1_000,
    ...over,
  };
  return { deps, ledger, updates };
}

const params = (over: Partial<TransferParams> = {}): TransferParams => ({ chain: MEZO_TESTNET, from: ALICE, recipient: BOB, amount: 5n * ONE, ...over });

async function run(deps: TransferDeps, p = params()) {
  const phases: TxPhase[] = [];
  const final = await executeMusdTransfer(deps, p, (ph) => phases.push(ph));
  return { final, phases: phases.map((x) => x.phase) };
}

describe('executeMusdTransfer — happy path', () => {
  it('goes preparing → signature → pending → confirmed, using only the hash the wallet returned', async () => {
    const { deps, ledger, updates } = makeDeps();
    const { final, phases } = await run(deps);
    expect(phases).toEqual(['preparing', 'awaiting_signature', 'pending', 'confirmed']);
    expect(final).toMatchObject({ phase: 'confirmed', hash: HASH, receipt: { status: 'success', blockNumber: '1234' } });
    expect(deps.sendTransfer).toHaveBeenCalledWith({ chainId: 31611, from: ALICE, token: MUSD, to: BOB, amount: 5n * ONE, dataSuffix: undefined });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ mode: 'real', hash: HASH, status: 'pending', amount: (5n * ONE).toString(), token: MUSD });
    expect(updates.at(-1)).toEqual([HASH, expect.objectContaining({ status: 'confirmed' })]);
  });

  it('forwards the payment-request calldata suffix', async () => {
    const { deps } = makeDeps();
    await run(deps, params({ dataSuffix: '0x434d4232aabb' as Hex }));
    expect(deps.sendTransfer).toHaveBeenCalledWith(expect.objectContaining({ dataSuffix: '0x434d4232aabb' }));
  });
});

describe('executeMusdTransfer — nothing is sent when preflight fails', () => {
  const cases: Array<[string, Partial<TransferDeps>, Partial<TransferParams>, string]> = [
    ['wrong chain', { getConnection: () => ({ address: ALICE, chainId: 1 }) }, {}, 'wrong_chain'],
    ['disconnected', { getConnection: () => ({}) }, {}, 'not_connected'],
    ['insufficient MUSD', { readTokenBalance: async () => ONE }, {}, 'insufficient_token'],
    ['insufficient BTC for gas', { readNativeBalance: async () => 0n }, {}, 'insufficient_gas'],
    ['zero amount', {}, { amount: 0n }, 'invalid_input'],
    ['negative amount', {}, { amount: -1n }, 'invalid_input'],
    ['amount over uint256', {}, { amount: 1n << 256n }, 'invalid_input'],
    ['invalid recipient', {}, { recipient: '0x1234' }, 'invalid_input'],
    ['zero address', {}, { recipient: '0x0000000000000000000000000000000000000000' }, 'invalid_input'],
    ['sending to the token contract', {}, { recipient: MUSD }, 'invalid_input'],
    ['sending to yourself', {}, { recipient: ALICE }, 'invalid_input'],
    ['call would revert', { estimateFee: async () => { throw new Error('execution reverted'); } }, {}, 'reverted'],
  ];
  for (const [name, depOver, paramOver, code] of cases) {
    it(name, async () => {
      const { deps, ledger } = makeDeps(depOver);
      const { final } = await run(deps, params(paramOver));
      expect(final).toMatchObject({ phase: 'failed', code });
      expect(deps.sendTransfer).not.toHaveBeenCalled();
      expect(ledger).toHaveLength(0);
    });
  }

  it('re-checks the chain immediately before the wallet prompt', async () => {
    let calls = 0;
    const { deps } = makeDeps({ getConnection: () => ({ address: ALICE, chainId: calls++ === 0 ? 31611 : 31612 }) });
    const { final } = await run(deps);
    expect(final).toMatchObject({ phase: 'failed', code: 'wrong_chain' });
    expect(deps.sendTransfer).not.toHaveBeenCalled();
  });
  it('rechecks signed-request expiry after preflight before opening the wallet', async () => {
    let time = 1000;
    const { deps } = makeDeps({ now: () => time, estimateFee: async () => { time = 3000; return { gas: 1n, fee: 1n }; } });
    const { final } = await run(deps, params({ requestCreatedAt: 1, requestExpiresAt: 2 }));
    expect(final).toMatchObject({ phase: 'failed', code: 'invalid_input', message: expect.stringMatching(/expired/) });
    expect(deps.sendTransfer).not.toHaveBeenCalled();
  });
});

describe('executeMusdTransfer — outcomes after the wallet', () => {
  it('a wallet rejection is "rejected", not an error, and records nothing', async () => {
    const { deps, ledger } = makeDeps({ sendTransfer: vi.fn(async () => { throw new UserRejectedRequestError(new Error('User rejected')); }) });
    const { final } = await run(deps);
    expect(final.phase).toBe('rejected');
    expect(ledger).toHaveLength(0);
  });

  it('a reverted receipt is never reported as success', async () => {
    const { deps, updates } = makeDeps({ waitForReceipt: async () => receipt('reverted') });
    const { final, phases } = await run(deps);
    expect(final.phase).toBe('reverted');
    expect(phases).not.toContain('confirmed');
    expect(updates.at(-1)?.[1]).toMatchObject({ status: 'reverted' });
  });

  it('a receipt timeout is "unknown" — neither success nor failure — and stays reconcilable', async () => {
    const { deps, updates } = makeDeps({ waitForReceipt: async () => { throw new WaitForTransactionReceiptTimeoutError({ hash: HASH }); } });
    const { final, phases } = await run(deps);
    expect(final).toMatchObject({ phase: 'unknown', hash: HASH });
    expect(phases).toEqual(['preparing', 'awaiting_signature', 'pending', 'unknown']);
    expect(updates.at(-1)?.[1]).toEqual({ status: 'unknown' });
  });

  it('a pending transaction is not marked completed before its receipt arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: string[] = [];
    const { deps } = makeDeps({ waitForReceipt: async () => { await gate; return receipt('success', [transferLog(MUSD, ALICE, BOB, 5n * ONE)]); } });
    const done = executeMusdTransfer(deps, params(), (p) => seen.push(p.phase));
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.at(-1)).toBe('pending');
    release();
    expect((await done).phase).toBe('confirmed');
  });

  it('a "success" receipt without the expected Transfer event is treated as unverified', async () => {
    const { deps } = makeDeps({ waitForReceipt: async () => receipt('success', [transferLog(MUSD, ALICE, BOB, 4n * ONE)]) });
    expect((await run(deps)).final.phase).toBe('unknown');
  });
});

describe('receipt evidence', () => {
  it('matches only the exact token, sender, recipient and amount', () => {
    const r = receipt('success', [transferLog(MUSD, ALICE, BOB, 5n)]);
    expect(receiptHasTransfer(r, MUSD, ALICE, BOB, 5n)).toBe(true);
    expect(receiptHasTransfer(r, MUSD, ALICE, BOB, 6n)).toBe(false);
    expect(receiptHasTransfer(r, MUSD, BOB, ALICE, 5n)).toBe(false);
    expect(receiptHasTransfer(r, MEZO_TESTNET.tokens.BTC.address as Address, ALICE, BOB, 5n)).toBe(false);
  });

  it('previewTransfer reports the estimated fee from the RPC, not a hard-coded value', async () => {
    const { deps } = makeDeps({ estimateFee: async () => ({ gas: 40_000n, fee: 6_000_000n }) });
    expect(await previewTransfer(deps, params())).toMatchObject({ gas: 40_000n, estimatedFee: 6_000_000n });
  });
});
