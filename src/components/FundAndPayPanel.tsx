/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shown on a verified payment request when the payer's wallet holds too little MUSD. It sizes a
 * BTC → MUSD swap for exactly the shortfall, explains it, and runs it only after explicit wallet
 * approvals (exact-amount approve, then swap). The request itself never leaves the page, so the payer
 * returns straight to reviewing the same signed payment.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, ExternalLink, Loader2, RefreshCw, Zap } from 'lucide-react';
import type { MezoChainConfig } from '../config/chains';
import type { WalletState } from '../types';
import { formatTokenDisplay } from '../lib/amounts';
import { checkFunding, poolVsOracleBps } from '../lib/fundAndPay';
import { isQuoteExpired, QUOTE_TTL_MS } from '../lib/swap';
import { isTerminal } from '../lib/transactions';
import { useFundingPlan } from '../hooks/useFundingPlan';
import { useSwapExecution } from '../hooks/useSwap';
import { useMezoProtocol } from '../hooks/useMezoProtocol';
import { TxStatusPanel } from './TxStatusPanel';

const fmt = (v: bigint, d = 2, max = 4) => formatTokenDisplay(v, 18, { maxFractionDigits: max, minFractionDigits: d });

interface Props {
  chain: MezoChainConfig;
  wallet: WalletState;
  amount: bigint;
  musdBalance: bigint;
  btcBalance: bigint;
  /** Called after a swap reaches a final state, so balances are re-read from the chain. */
  onSwapSettled: () => void;
}

export const FundAndPayPanel: React.FC<Props> = ({ chain, wallet, amount, musdBalance, btcBalance, onSwapSettled }) => {
  const need = amount > musdBalance ? amount - musdBalance : 0n;
  const exec = useSwapExecution();
  const running = exec.busy;
  const { plan, gasReserve, error, loading, refresh } = useFundingPlan(chain, need, need > 0n, running || exec.phase.phase === 'confirmed');
  const oracle = useMezoProtocol(chain, null);
  const oraclePrice = oracle.data?.oracle.status === 'ok' ? oracle.data.oracle.price : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const notified = useRef<string | null>(null);

  useEffect(() => {
    const key = exec.phase.phase + ('hash' in exec.phase ? exec.phase.hash : '');
    if (!isTerminal(exec.phase) || notified.current === key) return;
    notified.current = key;
    if (exec.phase.phase !== 'rejected' && exec.phase.phase !== 'failed') onSwapSettled();
  }, [exec.phase, onSwapSettled]);

  const check = checkFunding({ amount, musdBalance, btcBalance, plan, gasReserve: gasReserve ?? 0n });
  const expired = plan ? isQuoteExpired(plan.quote, now) : false;
  const vsOracle = plan ? poolVsOracleBps(plan.btcIn, plan.quote.amountOut, oraclePrice) : null;

  if (exec.phase.phase !== 'idle') {
    return (
      <div className="relative z-10 p-4 rounded-2xl border border-[#E2E2E0] dark:border-[#26262B] space-y-3">
        <p className="text-xs font-semibold flex items-center gap-2"><ArrowDownUp className="w-4 h-4" aria-hidden="true" /> Funding this payment with BTC</p>
        <TxStatusPanel
          phase={exec.phase}
          chain={chain}
          details={exec.received !== null ? [{ label: 'MUSD received (from receipt)', value: `${fmt(exec.received)} MUSD` }] : undefined}
        />
        {exec.phase.phase === 'confirmed' && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400" role="status">
            Swap confirmed. Your balance is being re-read from the chain; the payment below unlocks once it covers {fmt(amount)} MUSD.
          </p>
        )}
        {(exec.phase.phase === 'rejected' || exec.phase.phase === 'failed' || exec.phase.phase === 'reverted' || exec.phase.phase === 'unknown') && (
          <button type="button" onClick={() => { exec.reset(); refresh(); }} className="text-xs font-semibold underline">
            Back to the funding quote
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative z-10 p-4 sm:p-5 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-3" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold flex items-center gap-2"><Zap className="w-4 h-4" aria-hidden="true" /> Fund this payment with BTC</p>
          <p className="text-xs text-[#555555] dark:text-[#A0A0A0] mt-1">
            You have {fmt(musdBalance)} MUSD; this request needs {fmt(amount)}. Swap BTC for the <strong>{fmt(need)} MUSD</strong> difference on Mezo&rsquo;s MUSD/BTC pool, then pay.
          </p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="p-1.5 rounded-lg hover:bg-[#E2E2E0] dark:hover:bg-[#26262B] disabled:opacity-50" aria-label="Refresh funding quote">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">{error}</p>
      ) : !plan ? (
        <p className="text-xs text-[#777777] flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Getting a live quote from the Mezo router…</p>
      ) : (
        <>
          <dl className="text-xs space-y-1.5">
            <Row term="You swap">{fmt(plan.btcIn, 6, 8)} BTC</Row>
            <Row term="You receive at least">{fmt(plan.quote.minAmountOut)} MUSD <span className="text-[#777777]">(router-enforced; expected {fmt(plan.quote.amountOut)})</span></Row>
            <Row term="Pool fee · price impact">
              {(plan.quote.feeBps / 100).toFixed(2)}% · {plan.quote.priceImpactBps === null ? 'unknown' : plan.quote.priceImpactBps < 1 ? '< 0.01%' : `${(plan.quote.priceImpactBps / 100).toFixed(2)}%`} · slippage limit {(plan.quote.slippageBps / 100).toFixed(2)}%
            </Row>
            {oraclePrice && (
              <Row term="Mezo oracle value of this BTC">
                ${fmt((plan.btcIn * oraclePrice) / 10n ** 18n)}
                {vsOracle !== null && vsOracle !== 0 && <span className="text-[#777777]"> · pool pays {Math.abs(vsOracle / 100).toFixed(2)}% {vsOracle > 0 ? 'below' : 'above'} the oracle</span>}
              </Row>
            )}
            <Row term="Network fees">Paid in BTC; Cambio keeps {gasReserve !== null ? `${fmt(gasReserve, 2, 10)} BTC` : 'a little BTC'} aside for approve, swap and payment</Row>
          </dl>
          {chain.isTestnet && <p className="text-[11px] text-[#777777]">Testnet pool prices come from test liquidity, not a market.</p>}

          {check.status === 'insufficient_btc' ? (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              Not enough BTC: this needs about {fmt(check.btcNeeded, 6, 8)} BTC including fees; the wallet has {fmt(check.btcBalance, 6, 8)} BTC.
              {chain.faucetUrl && (
                <> <a className="underline inline-flex items-center gap-0.5" href={chain.faucetUrl} target="_blank" rel="noopener noreferrer">Get test BTC <ExternalLink className="w-3 h-3" /></a></>
              )}
            </p>
          ) : (
            <>
              <button
                type="button"
                disabled={expired || running || !wallet.address}
                onClick={() => wallet.address && exec.execute(chain, wallet.address, plan.quote)}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold disabled:opacity-50"
              >
                <ArrowDownUp className="w-4 h-4" aria-hidden="true" />
                {expired ? 'Quote expired — refreshing' : `Swap ${fmt(plan.btcIn, 6, 8)} BTC for MUSD`}
              </button>
              <p className="text-[11px] text-[#777777] text-center">
                Your wallet asks twice: an exact-amount BTC approval, then the swap. The price is re-checked on-chain and simulated before each prompt. Quotes last {QUOTE_TTL_MS / 1000}s.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
};

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-3">
      <dt className="text-[#777777] dark:text-[#A0A0A0] shrink-0">{term}</dt>
      <dd className="font-mono text-[#111111] dark:text-[#FFFFFF] sm:text-right">{children}</dd>
    </div>
  );
}
