/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fund & Pay: when a payer opens a signed MUSD request without enough MUSD, Cambio can size a
 * BTC → MUSD swap on Mezo's MUSD/BTC pool that covers exactly the shortfall, so the request can then
 * be paid. Every transaction still needs its own wallet approval; nothing here signs or sends.
 *
 * Sizing: the pool is an Aerodrome-style volatile pool (x·y = k) whose fee is taken from the input:
 *   out = (in − in·fee/10 000) · reserveOut / (reserveIn + in − in·fee/10 000)
 * The inverse gives the input for a target output. The Router's own getAmountsOut is then the
 * authority: the BTC amount is only offered once a live router quote's slippage-protected minimum
 * covers the shortfall.
 */

import type { Address } from 'viem';
import { poolAbi, poolFactoryAbi } from '../config/abis';
import { findPool, type MezoChainConfig } from '../config/chains';
import { applySlippage } from './amounts';
import { fetchSwapQuote, type QuoteClient, type SwapQuote } from './swap';
import { TxPreflightError } from './txErrors';

export const FUNDING_SLIPPAGE_BPS = 50;
/** Gas units kept aside for approve + swap + the MUSD payment (≈26k + 250k + 60k measured on testnet, ×2 margin). */
export const FUNDING_GAS_UNITS = 700_000n;

export function shortfall(amount: bigint, musdBalance: bigint): bigint {
  return amount > musdBalance ? amount - musdBalance : 0n;
}

/** Smallest input whose output (after the pool fee) is at least `out`. Null when the pool cannot provide it. */
export function inputForOutput(out: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint): bigint | null {
  if (out <= 0n) return 0n;
  if (reserveIn <= 0n || reserveOut <= 0n || out >= reserveOut || feeBps < 0n || feeBps >= 10_000n) return null;
  const afterFee = (out * reserveIn + (reserveOut - out) - 1n) / (reserveOut - out); // ceil
  return (afterFee * 10_000n + (10_000n - feeBps) - 1n) / (10_000n - feeBps) + 1n; // ceil, +1 wei for rounding inside the pool
}

/** The pool's own formula for a volatile pair (used to check inputForOutput). */
export function outputForInput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint): bigint {
  const net = amountIn - (amountIn * feeBps) / 10_000n;
  return (net * reserveOut) / (reserveIn + net);
}

export interface FundingPlan {
  shortfall: bigint;
  btcIn: bigint;
  quote: SwapQuote;
}

/**
 * Sizes a BTC → MUSD swap whose router-enforced minimum output covers `need`, using live reserves and a
 * live router quote. Throws TxPreflightError when the pool cannot cover it.
 */
export async function planFunding(client: QuoteClient, chain: MezoChainConfig, need: bigint, slippageBps = FUNDING_SLIPPAGE_BPS, now = Date.now()): Promise<FundingPlan> {
  if (need <= 0n) throw new TxPreflightError('invalid_input', 'No funding is needed.');
  const pool = findPool(chain, 'MUSD', 'BTC');
  if (!pool) throw new TxPreflightError('invalid_input', `No verified MUSD/BTC pool on ${chain.name}.`);
  const [token0, reserves, fee] = await Promise.all([
    client.readContract({ address: pool.address, abi: poolAbi, functionName: 'token0' }) as Promise<Address>,
    client.readContract({ address: pool.address, abi: poolAbi, functionName: 'getReserves' }) as Promise<readonly [bigint, bigint, bigint]>,
    client.readContract({ address: chain.poolFactory, abi: poolFactoryAbi, functionName: 'getFee', args: [pool.address, pool.stable] }) as Promise<bigint>,
  ]);
  const btcIs0 = token0.toLowerCase() === chain.tokens.BTC.address.toLowerCase();
  const [reserveBtc, reserveMusd] = btcIs0 ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
  // Ask for enough gross output that the slippage-protected minimum still covers the need.
  const grossTarget = (need * 10_000n + (10_000n - BigInt(slippageBps)) - 1n) / (10_000n - BigInt(slippageBps));
  let btcIn = inputForOutput(grossTarget, reserveBtc, reserveMusd, BigInt(fee));
  if (btcIn === null) throw new TxPreflightError('invalid_input', 'The MUSD/BTC pool does not have enough liquidity to fund this payment.');

  // The router quote is authoritative; nudge up in 0.5% steps if reserves moved between reads.
  for (let attempt = 0; attempt < 4; attempt++) {
    const quote = await fetchSwapQuote(client, chain, 'BTC', 'MUSD', btcIn, slippageBps, now);
    if (quote.minAmountOut >= need) return { shortfall: need, btcIn, quote };
    btcIn += btcIn / 200n + 1n;
  }
  throw new TxPreflightError('invalid_input', 'Could not size a swap that covers this payment. Refresh and try again.');
}

export type FundingCheck =
  | { status: 'enough_musd' }
  | { status: 'needs_swap'; shortfall: bigint }
  | { status: 'insufficient_btc'; shortfall: bigint; btcNeeded: bigint; btcBalance: bigint }
  | { status: 'unknown'; reason: string };

/** Decides whether a payment can proceed, needs a BTC swap first, or cannot be funded from this wallet. */
export function checkFunding(input: { amount: bigint; musdBalance: bigint | null; btcBalance: bigint | null; plan?: FundingPlan | null; gasReserve: bigint }): FundingCheck {
  if (input.musdBalance === null || input.btcBalance === null) return { status: 'unknown', reason: 'Balances have not loaded from the network yet.' };
  const need = shortfall(input.amount, input.musdBalance);
  if (need === 0n) return { status: 'enough_musd' };
  if (input.plan && input.plan.btcIn + input.gasReserve > input.btcBalance) {
    return { status: 'insufficient_btc', shortfall: need, btcNeeded: input.plan.btcIn + input.gasReserve, btcBalance: input.btcBalance };
  }
  return { status: 'needs_swap', shortfall: need };
}

/** Minimum MUSD the plan guarantees on-chain (router-enforced), for display. */
export function guaranteedOutput(plan: FundingPlan): bigint {
  return applySlippage(plan.quote.amountOut, plan.quote.slippageBps);
}

/**
 * How far the pool's execution price is from Mezo's oracle price, in basis points (positive = the pool
 * pays less MUSD per BTC than the oracle). Null without a usable oracle price.
 */
export function poolVsOracleBps(btcIn: bigint, musdOut: bigint, oraclePrice: bigint | null): number | null {
  if (!oraclePrice || oraclePrice <= 0n || btcIn <= 0n) return null;
  const oracleValue = (btcIn * oraclePrice) / 10n ** 18n;
  if (oracleValue <= 0n) return null;
  return Number(((oracleValue - musdOut) * 10_000n) / oracleValue);
}
