/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Read-only integration with Mezo's MUSD protocol: the BTC price oracle (PriceFeed), trove health
 * (TroveManager) and borrowing parameters (BorrowerOperations, InterestRateManager).
 *
 * Rules taken from the official contracts (mezo-org/musd @ da7888a), not from Liquity v1 defaults:
 *  - PriceFeed.fetchPrice() returns BTC/USD with 18 decimals and REVERTS when the oracle round is
 *    older than 60 seconds. A revert is reported as "stale", never replaced by another price.
 *  - ICR = collateral × price / (principal + interest), 18-decimal fixed point (LiquityMath._computeCR).
 *  - A trove can be liquidated when ICR < MCR (110%). This applies in normal and in Recovery Mode
 *    (TroveManager._getTotalsFromBatchLiquidate only liquidates ICR < MCR).
 *  - Recovery Mode is TCR < CCR (150%). In it: no collateral withdrawal, new debt needs ICR ≥ CCR and
 *    must improve ICR, opening a trove needs ICR ≥ CCR, and no borrowing fee is charged.
 *  - Opening: net debt = amount + fee must be ≥ minNetDebt; ICR uses composite debt = net debt + gas compensation.
 *  - MUSD can also be redeemed against the lowest-ICR troves; redemption closes or reduces a trove at face value.
 *
 * Cambio never sends BorrowerOperations transactions. borrowPreview() is arithmetic for display only.
 */

import type { Address } from 'viem';
import { aggregatorV3Abi, borrowerOperationsAbi, interestRateManagerAbi, priceFeedAbi, troveManagerAbi } from '../config/abis';
import type { MezoChainConfig } from '../config/chains';

export const ONE = 10n ** 18n;
/** ICR reported by the contract for a trove with zero debt (type(uint256).max). */
export const MAX_UINT256 = (1n << 256n) - 1n;
export const ORACLE_MAX_AGE_SECONDS = 60;

export interface ReadClient {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }): Promise<unknown>;
  getBlockNumber?(): Promise<bigint>;
}

export type OracleReading =
  | { status: 'ok'; price: bigint; updatedAt: number | null; oracle: Address | null; readAt: number }
  | { status: 'stale'; updatedAt: number | null; readAt: number; message: string }
  | { status: 'unavailable'; readAt: number; message: string };

function revertText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && typeof e === 'object' && i < 6; i++) {
    const x = e as { shortMessage?: string; message?: string; reason?: string; cause?: unknown };
    parts.push(x.reason ?? '', x.shortMessage ?? '', x.message ?? '');
    e = x.cause;
  }
  return parts.join(' ');
}

/**
 * Reads the Mezo oracle price. A stale oracle is reported as stale (PriceFeed refuses it on-chain too),
 * and an RPC failure as unavailable. Neither ever falls back to an off-chain price.
 */
export async function readOraclePrice(client: ReadClient, chain: MezoChainConfig, now = Date.now()): Promise<OracleReading> {
  const p = chain.musdProtocol;
  let oracle: Address | null = null;
  let updatedAt: number | null = null;
  try {
    oracle = (await client.readContract({ address: p.priceFeed, abi: priceFeedAbi, functionName: 'oracle' })) as Address;
    const round = (await client.readContract({ address: oracle, abi: aggregatorV3Abi, functionName: 'latestRoundData' })) as readonly [bigint, bigint, bigint, bigint, bigint];
    const ts = Number(round[3]);
    updatedAt = Number.isSafeInteger(ts) && ts > 0 ? ts : null;
  } catch {
    // The round timestamp is informational; PriceFeed.fetchPrice() below enforces freshness itself.
  }
  try {
    const price = (await client.readContract({ address: p.priceFeed, abi: priceFeedAbi, functionName: 'fetchPrice' })) as bigint;
    if (typeof price !== 'bigint' || price <= 0n) return { status: 'unavailable', readAt: now, message: 'The Mezo oracle returned no price.' };
    return { status: 'ok', price, updatedAt, oracle, readAt: now };
  } catch (err) {
    if (/stale/i.test(revertText(err))) {
      return { status: 'stale', updatedAt, readAt: now, message: 'The Mezo oracle price is older than 60 seconds, so the protocol refuses it. Try again shortly.' };
    }
    return { status: 'unavailable', readAt: now, message: 'The Mezo PriceFeed could not be read from the network.' };
  }
}

export interface ProtocolParams {
  mcr: bigint;
  ccr: bigint;
  tcr: bigint;
  recoveryMode: boolean;
  minNetDebt: bigint;
  gasCompensation: bigint;
  /** 18-decimal fraction, e.g. 1e15 = 0.1%. */
  borrowingRate: bigint;
  /** Annual interest for new troves, basis points. */
  interestRateBps: number;
  systemColl: bigint;
  systemDebt: bigint;
}

export async function readProtocolParams(client: ReadClient, chain: MezoChainConfig, price: bigint): Promise<ProtocolParams> {
  const p = chain.musdProtocol;
  const tm = (functionName: string, args?: readonly unknown[]) => client.readContract({ address: p.troveManager, abi: troveManagerAbi, functionName, args });
  const bo = (functionName: string) => client.readContract({ address: p.borrowerOperations, abi: borrowerOperationsAbi, functionName });
  const [mcr, ccr, tcr, recoveryMode, minNetDebt, gasCompensation, borrowingRate, interestRate, systemColl, systemDebt] = await Promise.all([
    tm('MCR'),
    tm('CCR'),
    tm('getTCR', [price]),
    tm('checkRecoveryMode', [price]),
    bo('minNetDebt'),
    bo('MUSD_GAS_COMPENSATION'),
    bo('borrowingRate'),
    client.readContract({ address: p.interestRateManager, abi: interestRateManagerAbi, functionName: 'interestRate' }),
    tm('getEntireSystemColl'),
    tm('getEntireSystemDebt'),
  ]);
  return {
    mcr: mcr as bigint,
    ccr: ccr as bigint,
    tcr: tcr as bigint,
    recoveryMode: recoveryMode as boolean,
    minNetDebt: minNetDebt as bigint,
    gasCompensation: gasCompensation as bigint,
    borrowingRate: borrowingRate as bigint,
    interestRateBps: Number(interestRate),
    systemColl: systemColl as bigint,
    systemDebt: systemDebt as bigint,
  };
}

export const TROVE_STATUS = ['none', 'active', 'closed_by_owner', 'closed_by_liquidation', 'closed_by_redemption'] as const;
export type TroveStatus = (typeof TROVE_STATUS)[number] | 'unknown';

export interface TroveState {
  status: TroveStatus;
  /** Collateral including pending redistribution rewards, BTC wei. */
  coll: bigint;
  principal: bigint;
  interest: bigint;
  /** principal + interest including pending redistributions, MUSD wei. This is the debt ICR is computed on. */
  debt: bigint;
  /** ICR as reported by TroveManager.getCurrentICR, 18 decimals. MAX_UINT256 when debt is zero. */
  icr: bigint;
  interestRateBps: number;
}

export async function readTrove(client: ReadClient, chain: MezoChainConfig, owner: Address, price: bigint): Promise<TroveState> {
  const tmAddress = chain.musdProtocol.troveManager;
  const statusRaw = Number(await client.readContract({ address: tmAddress, abi: troveManagerAbi, functionName: 'getTroveStatus', args: [owner] }));
  const status: TroveStatus = TROVE_STATUS[statusRaw] ?? 'unknown';
  if (status !== 'active') return { status, coll: 0n, principal: 0n, interest: 0n, debt: 0n, icr: 0n, interestRateBps: 0 };
  const [dc, icr, rate] = await Promise.all([
    client.readContract({ address: tmAddress, abi: troveManagerAbi, functionName: 'getEntireDebtAndColl', args: [owner] }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint]>,
    client.readContract({ address: tmAddress, abi: troveManagerAbi, functionName: 'getCurrentICR', args: [owner, price] }) as Promise<bigint>,
    client.readContract({ address: tmAddress, abi: troveManagerAbi, functionName: 'getTroveInterestRate', args: [owner] }),
  ]);
  const [coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest] = dc;
  return {
    status,
    coll: coll + pendingColl,
    principal: principal + pendingPrincipal,
    interest: interest + pendingInterest,
    debt: principal + interest + pendingPrincipal + pendingInterest,
    icr,
    interestRateBps: Number(rate),
  };
}

// ---------------------------------------------------------------------------------------------
// Pure arithmetic (same formulas as the contracts)

/** LiquityMath._computeCR: coll × price / debt, 18 decimals; MAX_UINT256 for zero debt. */
export function computeCR(coll: bigint, debt: bigint, price: bigint): bigint {
  return debt > 0n ? (coll * price) / debt : MAX_UINT256;
}

/**
 * BTC price (18 decimals) at which ICR would equal MCR for the current coll and debt, rounded up.
 * Interest accrues continuously, so this moves upward over time; it is an estimate, not a protocol value.
 */
export function liquidationPrice(coll: bigint, debt: bigint, mcr: bigint): bigint | null {
  if (coll <= 0n || debt <= 0n) return null;
  return (mcr * debt + coll - 1n) / coll;
}

export type TroveRisk = 'no_debt' | 'healthy' | 'watch' | 'at_risk' | 'liquidatable';

/**
 * liquidatable  ICR < MCR (110%), in any mode.
 * at_risk       ICR < CCR (150%): close to liquidation; in Recovery Mode this trove cannot add debt.
 * watch         ICR < CCR + 50 percentage points (200%).
 * healthy       otherwise.
 * Thresholds other than MCR are Cambio's display bands, not protocol rules.
 */
export function classifyTrove(icr: bigint, mcr: bigint, ccr: bigint, debt: bigint): TroveRisk {
  if (debt === 0n || icr === MAX_UINT256) return 'no_debt';
  if (icr < mcr) return 'liquidatable';
  if (icr < ccr) return 'at_risk';
  if (icr < ccr + ONE / 2n) return 'watch';
  return 'healthy';
}

/** Percentage points above MCR, 18 decimals (e.g. 0.428e18 = 42.8 points). Negative when liquidatable. */
export function safetyBuffer(icr: bigint, mcr: bigint): bigint {
  return icr - mcr;
}

export interface BorrowPreview {
  ok: boolean;
  problems: string[];
  fee: bigint;
  netDebt: bigint;
  compositeDebt: bigint;
  icr: bigint;
  liquidationPrice: bigint | null;
  newTcr: bigint | null;
  /** Annual interest on the composite debt at the current rate, MUSD wei (simple interest estimate). */
  yearlyInterest: bigint;
}

/**
 * Mirrors BorrowerOperations.openTrove's checks for display: fee (waived in Recovery Mode), minimum net
 * debt, composite debt with gas compensation, ICR ≥ MCR (≥ CCR in Recovery Mode) and the new TCR ≥ CCR.
 * Fee-exempt accounts and interest accrued between preview and execution are not modelled.
 */
export function borrowPreview(collateral: bigint, amount: bigint, price: bigint, params: ProtocolParams): BorrowPreview {
  const problems: string[] = [];
  const fee = params.recoveryMode ? 0n : (amount * params.borrowingRate) / ONE;
  const netDebt = amount + fee;
  const compositeDebt = netDebt + params.gasCompensation;
  const icr = computeCR(collateral, compositeDebt, price);
  if (collateral <= 0n) problems.push('Enter the BTC collateral to lock.');
  if (amount <= 0n) problems.push('Enter the MUSD amount to borrow.');
  if (netDebt < params.minNetDebt) problems.push(`Debt including the fee must be at least the protocol minimum.`);
  const required = params.recoveryMode ? params.ccr : params.mcr;
  if (collateral > 0n && amount > 0n && icr < required) {
    problems.push(params.recoveryMode ? 'In Recovery Mode a new trove needs a collateral ratio of at least 150%.' : 'Collateral ratio would be below the 110% minimum.');
  }
  let newTcr: bigint | null = null;
  if (!params.recoveryMode) {
    newTcr = computeCR(params.systemColl + collateral, params.systemDebt + compositeDebt, price);
    if (newTcr < params.ccr) problems.push('This trove would push the whole system below 150% and is refused by the protocol.');
  }
  return {
    ok: problems.length === 0,
    problems,
    fee,
    netDebt,
    compositeDebt,
    icr,
    liquidationPrice: liquidationPrice(collateral, compositeDebt, params.mcr),
    newTcr,
    yearlyInterest: (compositeDebt * BigInt(params.interestRateBps)) / 10_000n,
  };
}

/** Largest MUSD amount (before fee) whose composite debt keeps ICR ≥ targetCR. 0 when none fits. */
export function maxBorrowable(collateral: bigint, price: bigint, targetCR: bigint, params: ProtocolParams): bigint {
  if (collateral <= 0n || targetCR <= 0n) return 0n;
  const maxComposite = (collateral * price) / targetCR;
  const maxNet = maxComposite - params.gasCompensation;
  if (maxNet <= 0n) return 0n;
  const feeRate = params.recoveryMode ? 0n : params.borrowingRate;
  // netDebt = amount × (1 + rate)  →  amount = netDebt / (1 + rate), rounded down.
  return (maxNet * ONE) / (ONE + feeRate);
}

/** 18-decimal ratio → percentage string with `digits` decimals, truncated (e.g. 1.529e18 → "152.93"). */
export function formatRatioPercent(ratio: bigint, digits = 2): string {
  if (ratio === MAX_UINT256) return '∞';
  const scaled = (ratio * 100n * 10n ** BigInt(digits)) / ONE;
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const whole = abs / 10n ** BigInt(digits);
  const frac = (abs % 10n ** BigInt(digits)).toString().padStart(digits, '0');
  return `${neg ? '-' : ''}${whole}${digits ? `.${frac}` : ''}`;
}
