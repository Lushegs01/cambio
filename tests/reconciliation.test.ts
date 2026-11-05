/**
 * Settlement discovery: a paid request must not be reported unpaid just because its payment is not on
 * the explorer's first page; incomplete coverage is "incomplete", never "not_found".
 */
import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import { MEZO_TESTNET } from '../src/config/chains';
import { buildPaymentRequest, expectedPaymentCalldata } from '../src/lib/paymentRequest';
import { findRequestSettlement } from '../src/lib/requestSettlement';
import { receipt, transferLog } from './helpers';

const chain = MEZO_TESTNET;
const MUSD = chain.tokens.MUSD.address;
const merchant = privateKeyToAccount(generatePrivateKey()).address;
const payer = privateKeyToAccount(generatePrivateKey()).address;
const CREATED = 1_793_000_000;
const req = buildPaymentRequest({ chain, recipient: merchant, amount: 7n * 10n ** 18n, memo: '', lifetimeSeconds: 7 * 86400, nowSeconds: CREATED });
const PAID = ('0x' + 'aa'.repeat(32)) as Hex;
const h = (n: number) => (`0x${n.toString(16).padStart(64, '0')}`) as Hex;

/** Explorer rows newest first: `count` unrelated transfers, with the payment at `paidIndex` (or none). */
function explorerRows(count: number, paidIndex: number | null) {
  return Array.from({ length: count }, (_, i) => {
    const isPaid = i === paidIndex;
    return {
      transaction_hash: isPaid ? PAID : h(i + 1),
      log_index: 0,
      token: { address_hash: MUSD },
      from: { hash: payer },
      to: { hash: merchant },
      total: { value: isPaid ? req.amount : String(10n ** 18n + BigInt(i)) },
      timestamp: new Date((CREATED + 10 * 86400 - i * 60) * 1000).toISOString(),
    };
  });
}

function pagedFetch(rows: ReturnType<typeof explorerRows>, pageSize = 50, failAll = false) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    if (failAll) return new Response('down', { status: 502 });
    const u = new URL(url);
    const offset = Number(u.searchParams.get('index') ?? 0);
    const items = rows.slice(offset, offset + pageSize);
    const next = offset + pageSize < rows.length ? { index: offset + pageSize, block_number: 1 } : null;
    return new Response(JSON.stringify({ items, next_page_params: next }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const client = {
  getTransaction: async ({ hash }: { hash: Hex }) => ({ hash, from: payer as Address, to: MUSD, input: hash === PAID ? expectedPaymentCalldata(req) : '0x', chainId: chain.chainId }),
  getTransactionReceipt: async () => ({ ...receipt('success', [transferLog(MUSD, payer, merchant, BigInt(req.amount))]), blockNumber: 500n }),
  getBlock: async () => ({ timestamp: BigInt(CREATED + 600) }),
};

describe('findRequestSettlement', () => {
  it('finds a payment on the third explorer page (previously reported unpaid)', async () => {
    const { fn, calls } = pagedFetch(explorerRows(140, 120));
    const r = await findRequestSettlement(chain, client, req, fn, { retryDelays: [0] });
    expect(r.state).toBe('settled');
    expect(calls).toHaveLength(3);
  });

  it('reports not_found only after covering the whole window since creation', async () => {
    const { fn } = pagedFetch(explorerRows(40, null));
    expect((await findRequestSettlement(chain, client, req, fn)).state).toBe('not_found');
  });

  it('reports incomplete, not unpaid, when the page limit runs out first', async () => {
    const { fn } = pagedFetch(explorerRows(400, 380));
    const r = await findRequestSettlement(chain, client, req, fn, { maxPages: 2 });
    expect(r.state).toBe('incomplete');
  });

  it('stops paging once transfers predate the request', async () => {
    const rows = explorerRows(300, null).map((row, i) => ({ ...row, timestamp: new Date((CREATED + 3600 - i * 3600) * 1000).toISOString() }));
    const { fn, calls } = pagedFetch(rows);
    expect((await findRequestSettlement(chain, client, req, fn)).state).toBe('not_found');
    expect(calls).toHaveLength(1);
  });

  it('falls back to bounded RPC log scans when the explorer is down', async () => {
    const { fn } = pagedFetch([], 50, true);
    let chunks = 0;
    const logsClient = {
      ...client,
      getBlockNumber: async () => 100_000n,
      getLogs: async () => (++chunks === 2 ? [{ args: { value: BigInt(req.amount) }, transactionHash: PAID }] : []),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber < 70_000n && blockNumber !== 500n ? BigInt(CREATED - 86400) : BigInt(CREATED + 600) }),
    };
    expect((await findRequestSettlement(chain, logsClient, req, fn, { retryDelays: [0] })).state).toBe('settled');

    const empty = { ...logsClient, getLogs: async () => [], getBlock: async () => ({ timestamp: BigInt(CREATED + 600) }) };
    expect((await findRequestSettlement(chain, empty, req, fn, { maxLogChunks: 2 })).state).toBe('incomplete');
    expect((await findRequestSettlement(chain, client, req, fn)).state).toBe('error');
  });
});
