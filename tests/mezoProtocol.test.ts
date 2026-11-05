/**
 * Mezo protocol reads (PriceFeed, TroveManager, BorrowerOperations) with response shapes taken from
 * the live contracts, and the pure trove arithmetic checked against a value the live contract returned.
 */
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { MEZO_TESTNET } from '../src/config/chains';
import {
  borrowPreview,
  classifyTrove,
  computeCR,
  formatRatioPercent,
  liquidationPrice,
  MAX_UINT256,
  maxBorrowable,
  ONE,
  readOraclePrice,
  readProtocolParams,
  readTrove,
  safetyBuffer,
  type ProtocolParams,
  type ReadClient,
} from '../src/lib/mezoProtocol';

const chain = MEZO_TESTNET;
const P = chain.musdProtocol;
const PRICE = 80_300_315_080_000_000_000_000n; // PriceFeed.fetchPrice() on testnet, 2026-11-05
const ORACLE = '0x7b7c000000000000000000000000000000000015' as Address;
const OWNER = '0xd0d433B348a4874d395d12CA0b7841e24E5a8dCd' as Address;

// A real testnet trove read on 2026-11-05 (TroveManager.getEntireDebtAndColl / getCurrentICR at PRICE).
const LIVE_TROVE = { coll: 46_427_500_556_162_767n, principal: 2_402_200_000_000_000_000_000n, interest: 35_489_107_964_165_867_475n, icr: 1_529_375_879_334_465_682n };

const PARAMS: ProtocolParams = {
  mcr: 11n * 10n ** 17n,
  ccr: 15n * 10n ** 17n,
  tcr: 2_883_533_089_595_324_733n,
  recoveryMode: false,
  minNetDebt: 1800n * ONE,
  gasCompensation: 200n * ONE,
  borrowingRate: 10n ** 15n,
  interestRateBps: 100,
  systemColl: 15_420n * ONE,
  systemDebt: 429_415_335n * ONE,
};

type Handler = (fn: string, args: readonly unknown[] | undefined, address: Address) => unknown;
function client(handler: Handler): ReadClient {
  return {
    readContract: async ({ address, functionName, args }) => {
      const out = handler(functionName, args, address);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

describe('PriceFeed', () => {
  it('reads the 18-decimal BTC price and the oracle round time', async () => {
    const c = client((fn, _a, addr) => {
      if (fn === 'oracle') return ORACLE;
      if (fn === 'latestRoundData') { expect(addr).toBe(ORACLE); return [15_492_174n, PRICE, 1_793_875_274n, 1_793_875_274n, 0n]; }
      if (fn === 'fetchPrice') { expect(addr).toBe(P.priceFeed); return PRICE; }
      throw new Error(fn);
    });
    const r = await readOraclePrice(c, chain, 1);
    expect(r).toEqual({ status: 'ok', price: PRICE, updatedAt: 1_793_875_274, oracle: ORACLE, readAt: 1 });
  });

  it('reports a stale-oracle revert as stale and never substitutes a price', async () => {
    const revert = Object.assign(new Error('The contract function "fetchPrice" reverted.'), { cause: { reason: 'PriceFeed: Oracle is stale.' } });
    const r = await readOraclePrice(client((fn) => (fn === 'fetchPrice' ? revert : fn === 'oracle' ? ORACLE : [1n, PRICE, 1n, 1n, 1n])), chain);
    expect(r.status).toBe('stale');
    expect('price' in r).toBe(false);
  });

  it('reports RPC failure and zero prices as unavailable', async () => {
    expect((await readOraclePrice(client(() => new Error('fetch failed')), chain)).status).toBe('unavailable');
    expect((await readOraclePrice(client((fn) => (fn === 'fetchPrice' ? 0n : new Error('x'))), chain)).status).toBe('unavailable');
  });
});

describe('TroveManager reads', () => {
  it('reports wallets without a trove as having none, without further reads', async () => {
    const seen: string[] = [];
    const t = await readTrove(client((fn) => { seen.push(fn); return 0; }), chain, OWNER, PRICE);
    expect(t.status).toBe('none');
    expect(seen).toEqual(['getTroveStatus']);
  });

  it('includes pending redistributions in collateral and debt', async () => {
    const c = client((fn, args) => {
      if (fn === 'getTroveStatus') return 1;
      if (fn === 'getEntireDebtAndColl') { expect(args).toEqual([OWNER]); return [LIVE_TROVE.coll, LIVE_TROVE.principal, LIVE_TROVE.interest, 5n, 7n, 11n]; }
      if (fn === 'getCurrentICR') { expect(args).toEqual([OWNER, PRICE]); return LIVE_TROVE.icr; }
      if (fn === 'getTroveInterestRate') return 100;
      throw new Error(fn);
    });
    const t = await readTrove(c, chain, OWNER, PRICE);
    expect(t).toMatchObject({ status: 'active', coll: LIVE_TROVE.coll + 5n, principal: LIVE_TROVE.principal + 7n, interest: LIVE_TROVE.interest + 11n, icr: LIVE_TROVE.icr, interestRateBps: 100 });
    expect(t.debt).toBe(LIVE_TROVE.principal + LIVE_TROVE.interest + 18n);
  });

  it('maps closed statuses and refuses to guess unknown ones', async () => {
    for (const [code, status] of [[2, 'closed_by_owner'], [3, 'closed_by_liquidation'], [4, 'closed_by_redemption'], [9, 'unknown']] as const) {
      expect((await readTrove(client(() => code), chain, OWNER, PRICE)).status).toBe(status);
    }
  });

  it('reads protocol parameters from TroveManager, BorrowerOperations and InterestRateManager', async () => {
    const values: Record<string, unknown> = {
      MCR: PARAMS.mcr, CCR: PARAMS.ccr, getTCR: PARAMS.tcr, checkRecoveryMode: false, minNetDebt: PARAMS.minNetDebt,
      MUSD_GAS_COMPENSATION: PARAMS.gasCompensation, borrowingRate: PARAMS.borrowingRate, interestRate: 100,
      getEntireSystemColl: PARAMS.systemColl, getEntireSystemDebt: PARAMS.systemDebt,
    };
    const where: Record<string, Address> = {};
    const p = await readProtocolParams(client((fn, args, addr) => { where[fn] = addr; if (fn === 'getTCR' || fn === 'checkRecoveryMode') expect(args).toEqual([PRICE]); return values[fn]; }), chain, PRICE);
    expect(p).toEqual(PARAMS);
    expect(where.MCR).toBe(P.troveManager);
    expect(where.minNetDebt).toBe(P.borrowerOperations);
    expect(where.interestRate).toBe(P.interestRateManager);
  });
});

describe('trove arithmetic', () => {
  it('matches the ICR the live TroveManager returned, to the wei', () => {
    expect(computeCR(LIVE_TROVE.coll, LIVE_TROVE.principal + LIVE_TROVE.interest, PRICE)).toBe(LIVE_TROVE.icr);
    expect(computeCR(ONE, 0n, PRICE)).toBe(MAX_UINT256);
  });

  it('puts the liquidation price exactly where ICR reaches MCR', () => {
    const debt = LIVE_TROVE.principal + LIVE_TROVE.interest;
    const lp = liquidationPrice(LIVE_TROVE.coll, debt, PARAMS.mcr)!;
    expect(computeCR(LIVE_TROVE.coll, debt, lp)).toBeGreaterThanOrEqual(PARAMS.mcr);
    expect(computeCR(LIVE_TROVE.coll, debt, lp - 1n)).toBeLessThan(PARAMS.mcr);
    expect(liquidationPrice(0n, debt, PARAMS.mcr)).toBeNull();
  });

  it('classifies risk with MCR as the only liquidation rule', () => {
    const d = ONE;
    expect(classifyTrove(MAX_UINT256, PARAMS.mcr, PARAMS.ccr, 0n)).toBe('no_debt');
    expect(classifyTrove(PARAMS.mcr - 1n, PARAMS.mcr, PARAMS.ccr, d)).toBe('liquidatable');
    expect(classifyTrove(PARAMS.mcr, PARAMS.mcr, PARAMS.ccr, d)).toBe('at_risk');
    expect(classifyTrove(LIVE_TROVE.icr, PARAMS.mcr, PARAMS.ccr, d)).toBe('watch');
    expect(classifyTrove(3n * ONE, PARAMS.mcr, PARAMS.ccr, d)).toBe('healthy');
    expect(formatRatioPercent(safetyBuffer(LIVE_TROVE.icr, PARAMS.mcr))).toBe('42.93');
    expect(formatRatioPercent(LIVE_TROVE.icr)).toBe('152.93');
    expect(formatRatioPercent(MAX_UINT256)).toBe('∞');
  });
});

describe('borrow preview (read-only)', () => {
  it('applies the fee, minimum debt, gas compensation and MCR like openTrove', () => {
    const p = borrowPreview(ONE / 10n, 2000n * ONE, PRICE, PARAMS);
    expect(p.fee).toBe(2n * ONE); // 0.1% of 2000
    expect(p.netDebt).toBe(2002n * ONE);
    expect(p.compositeDebt).toBe(2202n * ONE);
    expect(p.icr).toBe(computeCR(ONE / 10n, 2202n * ONE, PRICE));
    expect(p.ok).toBe(true);
    expect(p.yearlyInterest).toBe((2202n * ONE) / 100n);
  });

  it('refuses debt below the minimum and ratios below MCR', () => {
    expect(borrowPreview(ONE, 1000n * ONE, PRICE, PARAMS).problems.join(' ')).toMatch(/minimum/);
    expect(borrowPreview(ONE / 40n, 1900n * ONE, PRICE, PARAMS).problems.join(' ')).toMatch(/110%/);
  });

  it('in Recovery Mode waives the fee but requires 150%', () => {
    const rm = { ...PARAMS, recoveryMode: true };
    const p = borrowPreview(ONE / 20n, 2000n * ONE, PRICE, rm); // ≈ 4015 / 2200 ≈ 182%
    expect(p.fee).toBe(0n);
    expect(p.ok).toBe(true);
    expect(borrowPreview(ONE / 30n, 2000n * ONE, PRICE, rm).problems.join(' ')).toMatch(/150%/);
  });

  it('maxBorrowable never produces a preview below the target ratio', () => {
    const coll = ONE / 10n;
    const amount = maxBorrowable(coll, PRICE, PARAMS.ccr, PARAMS);
    expect(amount).toBeGreaterThan(0n);
    expect(borrowPreview(coll, amount, PRICE, PARAMS).icr).toBeGreaterThanOrEqual(PARAMS.ccr);
    expect(maxBorrowable(1n, PRICE, PARAMS.ccr, PARAMS)).toBe(0n);
  });
});
