/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Swaps through Mezo's official Aerodrome-style Router, on the verified direct pools in config/chains.ts.
 *
 *  - Quotes come from Router.getAmountsOut on-chain (never from price-feed ratios).
 *  - The pool fee comes from PoolFactory.getFee on-chain (it differs between testnet and mainnet).
 *  - Price impact compares the quote against a small probe quote on the same pool.
 *  - minAmountOut = amountOut × (1 − slippage), enforced by the router; a fresh re-quote below it aborts.
 */

import { type Address, type Hex } from 'viem';
import { erc20Abi, poolFactoryAbi, routerAbi } from '../config/abis';
import { findPool, type MezoChainConfig, type TokenConfig } from '../config/chains';
import { applySlippage } from './amounts';
import { classifyTxError, TxPreflightError } from './txErrors';
import { summarizeReceipt, phaseFromReceipt, type LedgerEntry, type LedgerPatch, type TxPhase } from './transactions';
import type { ReceiptWithLogs } from './musdTransfer';

export type SwapSymbol = TokenConfig['symbol'];
export const QUOTE_TTL_MS = 30_000;
export const SWAP_DEADLINE_SECONDS = 20 * 60;
export const MAX_SLIPPAGE_BPS = 500;
export const MAX_PRICE_IMPACT_BPS = 1500;

export interface Route {
  from: Address;
  to: Address;
  stable: boolean;
  factory: Address;
}

export interface SwapQuote {
  chainId: number;
  tokenIn: TokenConfig;
  tokenOut: TokenConfig;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  slippageBps: number;
  /** On-chain pool fee in basis points. */
  feeBps: number;
  /** Execution price vs. the pool's marginal price, in basis points. Null if it could not be measured. */
  priceImpactBps: number | null;
  route: Route;
  pool: Address;
  fetchedAt: number;
  blockNumber: bigint;
}

export interface QuoteClient {
  readContract(args: any): Promise<any>;
  getBlockNumber(): Promise<bigint>;
}

export function routeFor(chain: MezoChainConfig, inSym: SwapSymbol, outSym: SwapSymbol): { route: Route; pool: Address } | null {
  if (inSym === outSym) return null;
  const pool = findPool(chain, inSym, outSym);
  if (!pool) return null;
  return {
    route: { from: chain.tokens[inSym].address, to: chain.tokens[outSym].address, stable: pool.stable, factory: chain.poolFactory },
    pool: pool.address,
  };
}

export function supportedPairs(chain: MezoChainConfig): [SwapSymbol, SwapSymbol][] {
  return chain.pools.map((p) => [p.tokenA, p.tokenB]);
}

/** 1 − (out/in) / (probeOut/probeIn), in basis points, rounded down; 0 if the quote is not worse than the probe. */
export function priceImpactBps(amountIn: bigint, amountOut: bigint, probeIn: bigint, probeOut: bigint): number | null {
  if (amountIn <= 0n || probeIn <= 0n || probeOut <= 0n) return null;
  // Compare out*probeIn against probeOut*in with 1e6 precision.
  const actual = amountOut * probeIn * 1_000_000n;
  const marginal = probeOut * amountIn;
  const ratio = actual / marginal; // 1e6 = parity
  if (ratio >= 1_000_000n) return 0;
  return Number((1_000_000n - ratio) / 100n);
}

export function isQuoteExpired(q: SwapQuote, now = Date.now()): boolean {
  return now < q.fetchedAt || now - q.fetchedAt >= QUOTE_TTL_MS;
}

export async function fetchSwapQuote(
  client: QuoteClient,
  chain: MezoChainConfig,
  inSym: SwapSymbol,
  outSym: SwapSymbol,
  amountIn: bigint,
  slippageBps: number,
  now = Date.now()
): Promise<SwapQuote> {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) throw new TxPreflightError('invalid_input', 'Slippage must be between 0.01% and 5%.');
  const r = routeFor(chain, inSym, outSym);
  if (!r) throw new TxPreflightError('invalid_input', `No verified ${inSym}/${outSym} pool on ${chain.name}.`);
  if (amountIn <= 0n) throw new TxPreflightError('invalid_input', 'Amount must be greater than zero.');

  const tokenIn = chain.tokens[inSym];
  // Probe: a tiny trade on the same pool approximates the marginal price.
  const minProbe = 10n ** BigInt(Math.max(0, tokenIn.decimals - 6));
  const probeIn = amountIn / 1000n > minProbe ? amountIn / 1000n : minProbe < amountIn ? minProbe : amountIn;

  const [amounts, probeAmounts, fee, blockNumber] = await Promise.all([
    client.readContract({ address: chain.router, abi: routerAbi, functionName: 'getAmountsOut', args: [amountIn, [r.route]] }),
    client.readContract({ address: chain.router, abi: routerAbi, functionName: 'getAmountsOut', args: [probeIn, [r.route]] }).catch(() => null),
    client.readContract({ address: chain.poolFactory, abi: poolFactoryAbi, functionName: 'getFee', args: [r.pool, r.route.stable] }),
    client.getBlockNumber(),
  ]);
  const amountOut = (amounts as bigint[])[1];
  if (!amountOut || amountOut <= 0n) throw new TxPreflightError('invalid_input', 'The pool returned no output for this amount (insufficient liquidity).');
  const probeOut = probeAmounts ? (probeAmounts as bigint[])[1] : 0n;

  return {
    chainId: chain.chainId,
    tokenIn,
    tokenOut: chain.tokens[outSym],
    amountIn,
    amountOut,
    minAmountOut: applySlippage(amountOut, slippageBps),
    slippageBps,
    feeBps: Number(fee),
    priceImpactBps: probeOut > 0n ? priceImpactBps(amountIn, amountOut, probeIn, probeOut) : null,
    route: r.route,
    pool: r.pool,
    fetchedAt: now,
    blockNumber,
  };
}

// ---------------------------------------------------------------------------------------------
// Execution

export interface SwapDeps {
  getConnection(): { address?: Address; chainId?: number };
  quoteClient: QuoteClient;
  readAllowance(a: { chainId: number; token: Address; owner: Address; spender: Address }): Promise<bigint>;
  readTokenBalance(a: { chainId: number; token: Address; owner: Address }): Promise<bigint>;
  readNativeBalance(a: { chainId: number; owner: Address }): Promise<bigint>;
  sendApprove(a: { chainId: number; from: Address; token: Address; spender: Address; amount: bigint }): Promise<Hex>;
  simulateSwap(a: { chainId: number; from: Address; quote: SwapQuote; deadline: bigint }): Promise<void>;
  sendSwap(a: { chainId: number; from: Address; quote: SwapQuote; deadline: bigint }): Promise<Hex>;
  waitForReceipt(a: { chainId: number; hash: Hex; timeoutMs: number }): Promise<ReceiptWithLogs>;
  getBlockTimestamp(a: { chainId: number; blockNumber: bigint }): Promise<number>;
  recordLedger?(entry: LedgerEntry): void;
  updateLedger?(chainId: number, from: Address, hash: Hex, patch: LedgerPatch): void;
  now?(): number;
}

export { receivedFromReceipt } from './receiptEvidence';
import { ledgerReceiptStatus, receivedFromReceipt } from './receiptEvidence';

export interface SwapOutcome {
  phase: TxPhase;
  received: bigint | null;
}

export async function executeSwap(deps: SwapDeps, chain: MezoChainConfig, from: Address, quote: SwapQuote, onPhase: (p: TxPhase) => void): Promise<SwapOutcome> {
  const now = deps.now ?? Date.now;
  const finish = (phase: TxPhase, received: bigint | null = null): SwapOutcome => {
    onPhase(phase);
    return { phase, received };
  };
  const fail = (err: unknown): SwapOutcome => {
    const c = classifyTxError(err);
    return finish(c.code === 'rejected' ? { phase: 'rejected', message: c.message } : { phase: 'failed', code: c.code, message: c.message });
  };
  const assertConn = () => {
    const c = deps.getConnection();
    if (!c.address || c.address.toLowerCase() !== from.toLowerCase()) throw new TxPreflightError('not_connected', 'The connected account changed. Review the swap again.');
    if (c.chainId !== chain.chainId || quote.chainId !== chain.chainId) throw new TxPreflightError('wrong_chain', `Your wallet must be on ${chain.name}.`);
  };

  try {
    onPhase({ phase: 'preparing', step: 'Checking balances and quote' });
    assertConn();
    if (quote.priceImpactBps === null || quote.priceImpactBps > MAX_PRICE_IMPACT_BPS) throw new TxPreflightError('invalid_input', 'Price impact is unavailable or above 15%. Refresh and reduce the amount.');
    if (quote.minAmountOut <= 0n) throw new TxPreflightError('invalid_input', 'Minimum output must be greater than zero.');
    if (isQuoteExpired(quote, now())) throw new TxPreflightError('invalid_input', 'This quote expired. Refresh it and review again.');
    const [balance, native] = await Promise.all([
      deps.readTokenBalance({ chainId: chain.chainId, token: quote.tokenIn.address, owner: from }),
      deps.readNativeBalance({ chainId: chain.chainId, owner: from }),
    ]);
    if (balance < quote.amountIn) throw new TxPreflightError('insufficient_token', `Insufficient ${quote.tokenIn.symbol} balance.`);
    if (native === 0n || (quote.tokenIn.isNative && native - quote.amountIn <= 0n)) {
      throw new TxPreflightError('insufficient_gas', 'Keep some BTC to pay network fees.');
    }
  } catch (err) {
    return fail(err);
  }

  // 1. Approval (exact amount, never unlimited).
  try {
    const allowance = await deps.readAllowance({ chainId: chain.chainId, token: quote.tokenIn.address, owner: from, spender: chain.router });
    if (allowance < quote.amountIn) {
      onPhase({ phase: 'awaiting_signature', step: `Step 1 of 2: approve ${quote.tokenIn.symbol} for the Mezo router` });
      assertConn();
      const approveHash = await deps.sendApprove({ chainId: chain.chainId, from, token: quote.tokenIn.address, spender: chain.router, amount: quote.amountIn });
      onPhase({ phase: 'pending', hash: approveHash, submittedAt: now(), step: 'Waiting for the approval to confirm' });
      let r: ReceiptWithLogs;
      try {
        r = await deps.waitForReceipt({ chainId: chain.chainId, hash: approveHash, timeoutMs: 120_000 });
      } catch {
        return finish({ phase: 'unknown', hash: approveHash, message: 'The approval was broadcast but not confirmed yet. No swap was sent. Try again once it confirms.' });
      }
      if (r.status !== 'success') return finish({ phase: 'failed', code: 'reverted', message: 'The approval transaction reverted. No swap was sent.' });
    }
  } catch (err) {
    return fail(err);
  }

  // 2. Fresh quote: never execute against a stale price.
  const deadline = BigInt(Math.floor(now() / 1000) + SWAP_DEADLINE_SECONDS);
  try {
    onPhase({ phase: 'preparing', step: 'Re-checking the price on-chain' });
    const fresh = await fetchSwapQuote(deps.quoteClient, chain, quote.tokenIn.symbol, quote.tokenOut.symbol, quote.amountIn, quote.slippageBps, now());
    if (fresh.priceImpactBps === null || fresh.priceImpactBps > MAX_PRICE_IMPACT_BPS) throw new TxPreflightError('invalid_input', 'Fresh price impact is unavailable or above 15%.');
    if (fresh.amountOut < quote.minAmountOut) {
      throw new TxPreflightError('invalid_input', 'The price moved beyond your slippage tolerance. Review the updated quote.');
    }
    assertConn();
    await deps.simulateSwap({ chainId: chain.chainId, from, quote, deadline });
    assertConn();
  } catch (err) {
    return fail(err);
  }

  // 3. Swap.
  let hash: Hex;
  try {
    onPhase({ phase: 'awaiting_signature', step: 'Confirm the swap in your wallet' });
    hash = await deps.sendSwap({ chainId: chain.chainId, from, quote, deadline });
  } catch (err) {
    return fail(err);
  }
  deps.recordLedger?.({
    mode: 'real',
    kind: 'swap',
    chainId: chain.chainId,
    hash,
    from,
    to: chain.router,
    token: quote.tokenIn.address,
    symbol: quote.tokenIn.symbol,
    decimals: quote.tokenIn.decimals,
    amount: quote.amountIn.toString(),
    status: 'pending',
    submittedAt: now(),
    swap: { tokenOut: quote.tokenOut.address, symbolOut: quote.tokenOut.symbol, decimalsOut: quote.tokenOut.decimals, minAmountOut: quote.minAmountOut.toString() },
  });
  onPhase({ phase: 'pending', hash, submittedAt: now(), step: 'Waiting for the swap to confirm' });

  let receipt: ReceiptWithLogs;
  try {
    receipt = await deps.waitForReceipt({ chainId: chain.chainId, hash, timeoutMs: 120_000 });
  } catch {
    deps.updateLedger?.(chain.chainId, from, hash, { status: 'unknown' });
    return finish({ phase: 'unknown', hash, message: 'The swap was broadcast but its outcome is not confirmed yet. Check the explorer.' });
  }
  let ts: number | null = null;
  try {
    ts = await deps.getBlockTimestamp({ chainId: chain.chainId, blockNumber: receipt.blockNumber });
  } catch {
    ts = null;
  }
  const summary = summarizeReceipt(receipt, ts);
  const status = ledgerReceiptStatus({ kind: 'swap', token: quote.tokenIn.address, from, amount: quote.amountIn.toString(), swap: { tokenOut: quote.tokenOut.address, minAmountOut: quote.minAmountOut.toString() } } as LedgerEntry, receipt);
  const received = status === 'confirmed' ? receivedFromReceipt(receipt, quote.tokenOut.address, from) : null;
  deps.updateLedger?.(chain.chainId, from, hash, {
    status,
    blockNumber: summary.blockNumber,
    blockTimestamp: ts,
    swap: { tokenOut: quote.tokenOut.address, symbolOut: quote.tokenOut.symbol, decimalsOut: quote.tokenOut.decimals, minAmountOut: quote.minAmountOut.toString(), amountOut: received?.toString() },
  });
  if (status === 'unknown') return finish({ phase: 'unknown', hash, message: 'The receipt does not prove the expected swap input and minimum output. Verify on the explorer before relying on it.' });
  return finish(phaseFromReceipt(hash, summary), received);
}
