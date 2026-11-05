/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MezoChainConfig } from '../config/chains';
import { FUNDING_GAS_UNITS, planFunding, type FundingPlan } from '../lib/fundAndPay';
import { classifyTxError } from '../lib/txErrors';
import { publicClientFor } from '../lib/wagmiDeps';

const REFRESH_MS = 15_000;

/** Live BTC → MUSD funding plan for a shortfall; refreshes while visible and pauses while `paused`. */
export function useFundingPlan(chain: MezoChainConfig | null, need: bigint, enabled: boolean, paused: boolean) {
  const [plan, setPlan] = useState<FundingPlan | null>(null);
  const [gasReserve, setGasReserve] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const run = ++seq.current;
    if (!enabled || !chain || need <= 0n) {
      setPlan(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const client = publicClientFor(chain.chainId);
      const [p, gasPrice] = await Promise.all([planFunding(client as never, chain, need), client.getGasPrice()]);
      if (run !== seq.current) return;
      setPlan(p);
      setGasReserve(FUNDING_GAS_UNITS * gasPrice);
      setError(null);
    } catch (err) {
      if (run !== seq.current) return;
      setPlan(null);
      const c = classifyTxError(err);
      setError(c.code === 'invalid_input' ? (err as Error).message : 'Could not get a live quote from the Mezo router. Try again.');
    } finally {
      if (run === seq.current) setLoading(false);
    }
  }, [chain, need, enabled]);

  useEffect(() => {
    if (paused) return;
    refresh();
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), REFRESH_MS);
    return () => {
      ++seq.current;
      clearInterval(timer);
    };
  }, [refresh, paused]);

  return { plan, gasReserve, error, loading, refresh };
}
