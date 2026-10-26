/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import type { MezoChainConfig } from '../config/chains';
import { executeSwap, fetchSwapQuote, type SwapOutcome, type SwapQuote, type SwapSymbol } from '../lib/swap';
import { classifyTxError } from '../lib/txErrors';
import { isBusy, type TxPhase } from '../lib/transactions';
import { createSwapDeps, publicClientFor } from '../lib/wagmiDeps';

const REFRESH_MS = 15_000;

/** Live router quote for (tokenIn, tokenOut, amountIn), refreshed every 15s while inputs are stable. */
export function useSwapQuote(chain: MezoChainConfig | null, inSym: SwapSymbol, outSym: SwapSymbol, amountIn: bigint | null, slippageBps: number) {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const run = ++seq.current;
    if (!chain || !amountIn || amountIn <= 0n) {
      setLoading(false);
      setQuote(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const q = await fetchSwapQuote(publicClientFor(chain.chainId) as never, chain, inSym, outSym, amountIn, slippageBps);
      if (run === seq.current) {
        setQuote(q);
        setError(null);
      }
    } catch (err) {
      if (run === seq.current) {
        setQuote(null);
        const c = classifyTxError(err);
        setError(c.code === 'invalid_input' || c.code === 'reverted' ? (err as Error).message.split('\n')[0] : 'Could not get a quote from the Mezo router. Try again.');
      }
    } finally {
      if (run === seq.current) setLoading(false);
    }
  }, [chain, inSym, outSym, amountIn, slippageBps]);

  useEffect(() => {
    setQuote(null);
    setError(null);
    const t = setTimeout(refresh, 400);
    const i = setInterval(() => document.visibilityState === 'visible' && refresh(), REFRESH_MS);
    return () => {
      ++seq.current;
      clearTimeout(t);
      clearInterval(i);
    };
  }, [refresh]);

  const currentQuote = quote && chain && quote.chainId === chain.chainId && quote.tokenIn.symbol === inSym && quote.tokenOut.symbol === outSym && quote.amountIn === amountIn && quote.slippageBps === slippageBps ? quote : null;
  return { quote: currentQuote, error, loading, refresh };
}

export function useSwapExecution() {
  const [phase, setPhase] = useState<TxPhase>({ phase: 'idle' });
  const [received, setReceived] = useState<bigint | null>(null);
  const lock = useRef(false);

  const execute = useCallback(async (chain: MezoChainConfig, from: Address, quote: SwapQuote): Promise<SwapOutcome | null> => {
    if (lock.current) return null;
    lock.current = true;
    setReceived(null);
    try {
      const outcome = await executeSwap(createSwapDeps(chain.chainId), chain, from, quote, setPhase);
      setReceived(outcome.received);
      return outcome;
    } finally {
      lock.current = false;
    }
  }, []);

  const reset = useCallback(() => {
    if (lock.current) return;
    setPhase({ phase: 'idle' });
    setReceived(null);
  }, []);

  return { phase, received, busy: isBusy(phase) || lock.current, execute, reset };
}
