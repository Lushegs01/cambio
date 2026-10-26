import { describe, expect, it } from 'vitest';
import { parseExplorerTransfers, mergeActivity, fetchExplorerActivity } from '../src/lib/activity';
import { ledgerKey, readLedger, reconcileLedger, upsertLedgerEntry, type LedgerEntry } from '../src/lib/transactions';
import { MEZO_TESTNET } from '../src/config/chains';
import { createDemoActivity } from '../src/data/mockData';
import { ALICE, BOB, HASH, MemoryStorage } from './helpers';

const MUSD = MEZO_TESTNET.tokens.MUSD.address;
const POOL = MEZO_TESTNET.pools[0].address;
const row = (over: Record<string, unknown> = {}) => ({
  transaction_hash: HASH,
  log_index: 3,
  token: { address: MUSD, symbol: 'MUSD' },
  from: { hash: ALICE },
  to: { hash: BOB, name: null },
  total: { decimals: '18', value: '5000000000000000000' },
  timestamp: '2026-10-22T21:06:46.000000Z',
  ...over,
});

describe('explorer-derived history', () => {
  it('parses MUSD transfers for the owner with direction and counterparty', () => {
    const [sent] = parseExplorerTransfers({ items: [row()] }, ALICE, MEZO_TESTNET);
    expect(sent).toMatchObject({ mode: 'real', kind: 'send', status: 'confirmed', amount: 5n * 10n ** 18n, counterparty: BOB, hash: HASH, source: 'explorer' });
    const [received] = parseExplorerTransfers({ items: [row()] }, BOB, MEZO_TESTNET);
    expect(received.kind).toBe('receive');
  });

  it('labels transfers to Mezo pools as swaps', () => {
    const [s] = parseExplorerTransfers({ items: [row({ to: { hash: POOL, name: 'Volatile AMM - MUSD/BTC' } })] }, ALICE, MEZO_TESTNET);
    expect(s).toMatchObject({ kind: 'swap', counterpartyName: 'Volatile AMM - MUSD/BTC' });
  });

  it('drops malformed rows and other tokens instead of guessing', () => {
    const items = [
      row({ token: { address: MEZO_TESTNET.tokens.BTC.address } }),
      row({ transaction_hash: '0x1234' }),
      row({ total: { value: '1.5' } }),
      row({ from: { hash: 'nope' } }),
      row({ from: { hash: BOB }, to: { hash: BOB } }), // not the owner's transfer
    ];
    expect(parseExplorerTransfers({ items }, ALICE, MEZO_TESTNET)).toEqual([]);
    expect(parseExplorerTransfers({ nope: true }, ALICE, MEZO_TESTNET)).toEqual([]);
  });

  it('surfaces explorer outages as errors (not as an empty history)', async () => {
    const down = (async () => new Response('bad gateway', { status: 502 })) as typeof fetch;
    await expect(fetchExplorerActivity(MEZO_TESTNET, ALICE, down)).rejects.toThrow(/502/);
  });
  it('rejects malformed explorer responses and deduplicates indexed events', async () => {
    const malformed = (async () => Response.json({ unavailable: true })) as typeof fetch;
    await expect(fetchExplorerActivity(MEZO_TESTNET, ALICE, malformed)).rejects.toThrow(/Malformed/);
    expect(parseExplorerTransfers({ items: [row(), row()] }, ALICE, MEZO_TESTNET)).toHaveLength(1);
  });
});

describe('local ledger', () => {
  const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
    mode: 'real', kind: 'transfer', chainId: 31611, hash: HASH, from: ALICE, to: BOB, token: MUSD, symbol: 'MUSD', decimals: 18,
    amount: '5000000000000000000', status: 'pending', submittedAt: 1000, ...over,
  });

  it('stores and reads entries per chain and account', () => {
    const s = new MemoryStorage();
    upsertLedgerEntry(entry(), s);
    expect(readLedger(31611, ALICE, s)).toHaveLength(1);
    expect(readLedger(31612, ALICE, s)).toHaveLength(0);
    expect(readLedger(31611, BOB, s)).toHaveLength(0);
  });

  it('ignores simulated or forged records planted in storage', () => {
    const s = new MemoryStorage();
    s.setItem(ledgerKey(31611, ALICE), JSON.stringify([
      { ...entry(), mode: 'demo' },
      { ...entry(), hash: '0xfake' },
      { ...entry(), amount: '12.5' },
      { ...entry(), status: 'completed' },
      { ...entry(), decimals: -1 },
      { ...entry(), decimals: 1000000 },
      { ...entry(), symbol: null },
      { ...entry(), memo: { untrusted: true } },
      { ...entry(), kind: 'swap', swap: { tokenOut: MUSD } },
    ]));
    expect(readLedger(31611, ALICE, s)).toEqual([]);
  });

  it('reconciles pending entries only from receipts, keeping status when the RPC fails', async () => {
    const updates: string[] = [];
    await reconcileLedger(
      [entry({ hash: HASH }), entry({ hash: ('0x' + 'cd'.repeat(32)) as never }), entry({ hash: ('0x' + 'ef'.repeat(32)) as never })],
      async (h) => {
        if (h === HASH) return { status: 'reverted', blockNumber: 1n, gasUsed: 1n };
        if (h.startsWith('0xcd')) return null; // not mined yet
        throw new Error('rpc down');
      },
      (hash, status) => updates.push(`${hash.slice(0, 4)}:${status}`)
    );
    expect(updates).toEqual(['0xab:reverted']);
  });

  it('merges chain history with the ledger: chain wins, memo is kept, unseen pending items are shown', () => {
    const chainItems = parseExplorerTransfers({ items: [row()] }, ALICE, MEZO_TESTNET);
    const pendingHash = ('0x' + '77'.repeat(32)) as `0x${string}`;
    const merged = mergeActivity(chainItems, [entry({ status: 'confirmed', memo: 'Lunch' }), entry({ hash: pendingHash, submittedAt: Date.now() })]);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.hash === HASH)).toMatchObject({ status: 'confirmed', source: 'explorer', memo: 'Lunch' });
    expect(merged.find((m) => m.hash === pendingHash)).toMatchObject({ status: 'pending', source: 'this-device' });
  });

  it('demo fixtures are simulated, hashless and cannot pass as settlements', () => {
    for (const d of createDemoActivity()) {
      expect(d).toMatchObject({ mode: 'demo', status: 'simulated', hash: null, source: 'demo' });
    }
  });
});
