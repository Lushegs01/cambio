import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Settings2, Wallet, RefreshCw, AlertTriangle, ExternalLink, Loader2, X, Info } from 'lucide-react';
import { useReadContract } from 'wagmi';
import type { Address } from 'viem';
import type { WalletState } from '../types';
import { erc20Abi } from '../config/abis';
import { explorerAddressUrl, findPool, type MezoChainConfig } from '../config/chains';
import { formatTokenDisplay, formatUnitsExact, parseTokenAmount, bpsOf } from '../lib/amounts';
import { isQuoteExpired, QUOTE_TTL_MS, type SwapQuote, type SwapSymbol } from '../lib/swap';
import { isTerminal, type TxPhase } from '../lib/transactions';
import { useSwapExecution, useSwapQuote } from '../hooks/useSwap';
import { NetworkGuard } from './NetworkGuard';
import { TxStatusPanel } from './TxStatusPanel';
import { HalftonePattern } from './HalftonePattern';
import { shortenAddress } from '../utils/format';
import btcLogo from '@/btc.png';
import mezoLogo from '@/mezo.png';
import usdcLogo from '@/usdc.png';

const ICONS: Record<SwapSymbol, string> = { MUSD: mezoLogo, BTC: btcLogo, mUSDC: usdcLogo, mUSDT: usdcLogo };
const SYMBOLS: SwapSymbol[] = ['MUSD', 'BTC', 'mUSDC', 'mUSDT'];
const SLIPPAGE_OPTIONS = [10, 50, 100];

interface SwapViewProps {
  wallet: WalletState;
  onConnectWallet: () => void;
  onSwapSettled?: (phase: TxPhase, label: string) => void;
}

function useTokenBalance(chain: MezoChainConfig | null, owner: Address | null, sym: SwapSymbol) {
  const token = chain?.tokens[sym];
  return useReadContract({
    address: token?.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: owner ? [owner] : undefined,
    chainId: chain?.chainId,
    query: { enabled: !!token && !!owner, refetchInterval: 30_000 },
  });
}

function TokenPicker({ value, options, disabledReason, onChange, label }: { value: SwapSymbol; options: SwapSymbol[]; disabledReason: (s: SwapSymbol) => string | null; onChange: (s: SwapSymbol) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((s) => {
        const reason = disabledReason(s);
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value === s}
            disabled={!!reason}
            title={reason ?? undefined}
            onClick={() => onChange(s)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all disabled:opacity-35 disabled:cursor-not-allowed ${
              value === s ? 'bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] border-[#111111] dark:border-[#FFFFFF]' : 'bg-white dark:bg-[#1A1A1D] border-[#E2E2E0] dark:border-[#26262B] text-[#111111] dark:text-[#FFFFFF]'
            }`}
          >
            <img src={ICONS[s]} alt="" className="w-4 h-4 rounded-full object-cover" />
            {s}
          </button>
        );
      })}
    </div>
  );
}

export const SwapView: React.FC<SwapViewProps> = ({ wallet, onConnectWallet, onSwapSettled }) => {
  const chain = wallet.chain;
  const isDemo = wallet.dataMode === 'demo';
  const [tokenIn, setTokenIn] = useState<SwapSymbol>('MUSD');
  const [tokenOut, setTokenOut] = useState<SwapSymbol>('BTC');
  const [amountInput, setAmountInput] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [showSlippage, setShowSlippage] = useState(false);
  const [reviewing, setReviewing] = useState<SwapQuote | null>(null);
  const [now, setNow] = useState(Date.now());
  const exec = useSwapExecution();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const decimalsIn = chain?.tokens[tokenIn].decimals ?? 18;
  const parsed = useMemo(() => (amountInput ? parseTokenAmount(amountInput, decimalsIn) : null), [amountInput, decimalsIn]);
  const amountIn = parsed?.ok ? parsed.value : null;
  const { quote, error: quoteError, loading: quoteLoading, refresh } = useSwapQuote(chain, tokenIn, tokenOut, amountIn, slippageBps);
  const balIn = useTokenBalance(chain, wallet.address, tokenIn);
  const balOut = useTokenBalance(chain, wallet.address, tokenOut);
  const balanceIn = !balIn.isError && typeof balIn.data === 'bigint' ? balIn.data : null;

  // Keep tokenOut valid for the selected input.
  useEffect(() => {
    if (chain && !findPool(chain, tokenIn, tokenOut)) {
      const firstPair = SYMBOLS.find((s) => s !== tokenIn && findPool(chain, tokenIn, s));
      if (firstPair) setTokenOut(firstPair);
    }
  }, [chain, tokenIn, tokenOut]);

  // Report settled swaps once.
  useEffect(() => {
    if (reviewing && isTerminal(exec.phase) && exec.phase.phase !== 'rejected' && exec.phase.phase !== 'failed') {
      onSwapSettled?.(exec.phase, `${formatTokenDisplay(reviewing.amountIn, reviewing.tokenIn.decimals)} ${reviewing.tokenIn.symbol} → ${reviewing.tokenOut.symbol}`);
      if (exec.phase.phase === 'confirmed') {
        balIn.refetch();
        balOut.refetch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec.phase]);

  const insufficient = amountIn !== null && balanceIn !== null && amountIn > balanceIn;
  const expired = quote ? isQuoteExpired(quote, now) : false;
  const ageSec = quote ? Math.max(0, Math.floor((now - quote.fetchedAt) / 1000)) : 0;
  const highImpact = quote?.priceImpactBps != null && quote.priceImpactBps > 300;
  const severeImpact = !!quote && (quote.priceImpactBps === null || quote.priceImpactBps > 1500);

  const rateLabel = (q: SwapQuote) => {
    // 1 tokenIn = X tokenOut, exact bigint ratio scaled to tokenOut decimals.
    const oneIn = 10n ** BigInt(q.tokenIn.decimals);
    const perUnit = (q.amountOut * oneIn) / q.amountIn;
    return `1 ${q.tokenIn.symbol} ≈ ${formatTokenDisplay(perUnit, q.tokenOut.decimals, { maxFractionDigits: q.tokenOut.symbol === 'BTC' ? 8 : 4 })} ${q.tokenOut.symbol}`;
  };

  useEffect(() => { if (!exec.busy) { setReviewing(null); exec.reset(); } }, [wallet.address, wallet.chainId]);

  const canReview =
    !isDemo && wallet.isConnected && !!chain && !!quote && !expired && !insufficient && !severeImpact && !quoteLoading && !!wallet.address;

  const disabledOut = (s: SwapSymbol) => (s === tokenIn ? 'Same token' : chain && !findPool(chain, tokenIn, s) ? `No verified ${tokenIn}/${s} pool` : null);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {chain?.isTestnet && <p role="note" className="p-3 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs">Testnet pool quotes are experimental liquidity, not market rates. Pools may be off-peg or have no liquidity.</p>}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#E2E2E0] dark:border-[#26262B]">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111111] dark:text-[#FFFFFF]">Swap</h1>
          <p className="mt-1.5 text-sm text-[#555555] dark:text-[#A0A0A0]">Quotes and execution through Mezo’s official router and pools. You sign every step in your wallet.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={quoteLoading || !amountIn}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416] disabled:opacity-50"
            aria-label="Refresh quote"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${quoteLoading ? 'animate-spin' : ''}`} />
            {quote ? `${ageSec}s old` : 'Refresh'}
          </button>
          <div className="relative">
            <button type="button" onClick={() => setShowSlippage((v) => !v)} aria-expanded={showSlippage} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416]">
              <Settings2 className="w-3.5 h-3.5" /> {(slippageBps / 100).toFixed(2)}% slippage
            </button>
            {showSlippage && (
              <div className="absolute right-0 mt-2 w-52 bg-white dark:bg-[#141416] rounded-2xl shadow-xl border border-[#E2E2E0] dark:border-[#26262B] p-3 text-xs z-30 space-y-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] block">Max price movement</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {SLIPPAGE_OPTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => { setSlippageBps(s); setShowSlippage(false); }} className={`py-1.5 rounded-lg font-mono border ${slippageBps === s ? 'bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111]' : 'bg-[#F5F5F3] dark:bg-[#1A1A1D] border-transparent'}`}>
                      {(s / 100).toFixed(1)}%
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[#777777]">The router reverts the swap if you would receive less than the minimum.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {isDemo && (
        <div role="status" className="p-3 rounded-2xl bg-violet-500/10 border border-violet-500/30 text-violet-800 dark:text-violet-300 text-xs">
          Demo mode does not simulate swaps. Quotes below are real (read-only) router quotes; switch to real data to execute.
        </div>
      )}

      <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 relative overflow-hidden bg-white dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-5 sm:p-7 shadow-xs space-y-4">
          <HalftonePattern variant="corner" className="absolute right-0 top-0 w-32 h-32 opacity-10 pointer-events-none" />
          {!wallet.isConnected && (
            <button type="button" onClick={onConnectWallet} className="relative z-10 w-full p-3 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-xs flex items-center justify-center gap-2 font-semibold">
              <Wallet className="w-4 h-4" /> Connect a wallet to swap
            </button>
          )}
          <NetworkGuard wallet={wallet} purpose="to swap on Mezo" className="relative z-10" />

          {chain && (
            <>
              <div className="relative z-10 p-4 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="swap-amount" className="font-mono uppercase tracking-wider text-[#777777] text-[10px]">You pay</label>
                  <span className="font-mono text-[11px] text-[#777777]">
                    Balance: {balanceIn !== null ? `${formatTokenDisplay(balanceIn, decimalsIn, { maxFractionDigits: 6 })} ${tokenIn}` : wallet.isConnected ? (balIn.isError ? 'unavailable' : '…') : '—'}
                    {balanceIn !== null && balanceIn > 0n && (
                      <button
                        type="button"
                        onClick={() => setAmountInput(formatUnitsExact(chain.tokens[tokenIn].isNative ? balanceIn - bpsOf(balanceIn, 100) : balanceIn, decimalsIn))}
                        className="ml-2 font-bold text-[#111111] dark:text-[#FFFFFF] hover:underline"
                        title={chain.tokens[tokenIn].isNative ? 'Keeps 1% of your BTC for network fees' : undefined}
                      >
                        Max
                      </button>
                    )}
                  </span>
                </div>
                <input
                  id="swap-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.0"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value.replace(',', '.'))}
                  aria-invalid={!!parsed && !parsed.ok}
                  className="w-full bg-transparent text-3xl font-bold font-mono text-[#111111] dark:text-[#FFFFFF] outline-none tabular-nums"
                />
                {parsed && !parsed.ok && <p className="text-[11px] text-red-600">{parsed.error}</p>}
                {insufficient && <p className="text-[11px] text-red-600">Exceeds your {tokenIn} balance.</p>}
                <TokenPicker label="Token to pay" value={tokenIn} options={SYMBOLS} disabledReason={() => null} onChange={(s) => { setTokenIn(s); setAmountInput(''); }} />
              </div>

              <div className="relative z-10 flex justify-center -my-2">
                <button
                  type="button"
                  onClick={() => { setTokenIn(tokenOut); setTokenOut(tokenIn); setAmountInput(''); }}
                  className="p-2.5 rounded-xl bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] shadow-xs hover:rotate-180 transition-transform duration-300"
                  aria-label="Swap direction"
                >
                  <ArrowUpDown className="w-4 h-4" />
                </button>
              </div>

              <div className="relative z-10 p-4 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono uppercase tracking-wider text-[#777777] text-[10px]">You receive (estimated)</span>
                  <span className="font-mono text-[11px] text-[#777777]">
                    Balance: {typeof balOut.data === 'bigint' ? `${formatTokenDisplay(balOut.data, chain.tokens[tokenOut].decimals, { maxFractionDigits: 6 })} ${tokenOut}` : '—'}
                  </span>
                </div>
                <div className="text-3xl font-bold font-mono text-[#111111] dark:text-[#FFFFFF] tabular-nums min-h-[40px]" aria-live="polite">
                  {quoteLoading && !quote ? <Loader2 className="w-6 h-6 animate-spin opacity-50" /> : quote ? formatTokenDisplay(quote.amountOut, quote.tokenOut.decimals, { maxFractionDigits: quote.tokenOut.symbol === 'BTC' ? 8 : 6 }) : '0.0'}
                </div>
                <TokenPicker label="Token to receive" value={tokenOut} options={SYMBOLS} disabledReason={disabledOut} onChange={setTokenOut} />
              </div>

              {quoteError && (
                <div role="alert" className="relative z-10 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {quoteError}
                </div>
              )}

              {quote && (
                <div className="relative z-10 p-4 rounded-2xl border border-[#E2E2E0] dark:border-[#26262B] text-xs space-y-1.5">
                  <Row label="Rate">{rateLabel(quote)}</Row>
                  <Row label="Minimum received">{formatTokenDisplay(quote.minAmountOut, quote.tokenOut.decimals, { maxFractionDigits: 8 })} {quote.tokenOut.symbol}</Row>
                  <Row label="Pool fee (on-chain)">{(quote.feeBps / 100).toFixed(2)}%</Row>
                  <Row label="Price impact">
                    <span className={severeImpact ? 'text-red-600 font-bold' : highImpact ? 'text-amber-600 font-semibold' : ''}>
                      {quote.priceImpactBps === null ? 'Unknown' : quote.priceImpactBps < 1 ? '< 0.01%' : `${(quote.priceImpactBps / 100).toFixed(2)}%`}
                    </span>
                  </Row>
                  <Row label="Quote source">
                    Router.getAmountsOut · block {quote.blockNumber.toString()} · {expired ? <span className="text-amber-600">expired</span> : `${Math.max(0, Math.ceil((QUOTE_TTL_MS - (now - quote.fetchedAt)) / 1000))}s left`}
                  </Row>
                  <Row label="Router">
                    <a href={explorerAddressUrl(chain, chain.router)} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline inline-flex items-center gap-1">
                      {shortenAddress(chain.router)} <ExternalLink className="w-3 h-3" />
                    </a>
                  </Row>
                  {severeImpact && <p className="pt-1 text-red-600">Price impact is unavailable or above 15%; swapping is disabled.</p>}
                  {highImpact && !severeImpact && <p className="pt-1 text-amber-600">High price impact. You would receive noticeably less than the pool’s current price.</p>}
                </div>
              )}

              <button
                type="button"
                disabled={!canReview}
                onClick={() => { exec.reset(); setReviewing(quote); }}
                className="relative z-10 w-full py-4 rounded-2xl bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDemo ? 'Swaps are disabled in demo mode' : !wallet.isConnected ? 'Connect a wallet' : !amountIn ? 'Enter an amount' : insufficient ? `Insufficient ${tokenIn}` : expired ? 'Quote expired — refresh' : quoteLoading && !quote ? 'Fetching quote…' : 'Review swap'}
              </button>
            </>
          )}
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 space-y-3 text-xs text-[#555555] dark:text-[#A0A0A0]">
          <h2 className="text-sm font-bold text-[#111111] dark:text-[#FFFFFF] flex items-center gap-2"><Info className="w-4 h-4" /> What this swap does</h2>
          <ul className="space-y-2 list-disc list-inside">
            <li>Routes through a single verified Mezo pool (MUSD/BTC, MUSD/mUSDC or MUSD/mUSDT).</li>
            <li>If needed, first asks you to approve exactly the amount you are swapping — never an unlimited allowance.</li>
            <li>Re-quotes and simulates on-chain right before you sign; aborts if the price moved past your slippage.</li>
            <li>The confirmation shows what you actually received, read from the transaction receipt.</li>
          </ul>
          {chain?.isTestnet && <p className="pt-2 text-[11px]">Testnet pools hold test liquidity and their prices may not track real markets.</p>}
        </div>
      </div>

      {reviewing && chain && wallet.address && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" role="dialog" aria-modal="true" aria-labelledby="swap-review-title" onClick={() => !exec.busy && setReviewing(null)}>
          <div className="relative w-full max-w-md bg-white dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 space-y-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 id="swap-review-title" className="text-base font-bold">{exec.phase.phase === 'idle' ? 'Review swap' : 'Swap status'}</h2>
              <button type="button" onClick={() => setReviewing(null)} disabled={exec.busy} className="p-1.5 rounded-xl hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] disabled:opacity-40" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            {exec.phase.phase === 'idle' ? (
              <>
                <div className="p-4 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] text-xs space-y-1.5">
                  <Row label="You pay">{formatTokenDisplay(reviewing.amountIn, reviewing.tokenIn.decimals, { maxFractionDigits: 8 })} {reviewing.tokenIn.symbol}</Row>
                  <Row label="Expected">{formatTokenDisplay(reviewing.amountOut, reviewing.tokenOut.decimals, { maxFractionDigits: 8 })} {reviewing.tokenOut.symbol}</Row>
                  <Row label="Minimum">{formatTokenDisplay(reviewing.minAmountOut, reviewing.tokenOut.decimals, { maxFractionDigits: 8 })} {reviewing.tokenOut.symbol}</Row>
                  <Row label="Slippage">{(reviewing.slippageBps / 100).toFixed(2)}%</Row>
                  <Row label="Pool fee">{(reviewing.feeBps / 100).toFixed(2)}%</Row>
                  <Row label="Network">{chain.name} (chain {chain.chainId}){!chain.isTestnet && <span className="text-red-600 font-semibold"> · real funds</span>}</Row>
                </div>
                {isQuoteExpired(reviewing, now) ? (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-600">This quote is older than 30 seconds. Review the latest on-chain quote before signing.</p>
                    <button
                      type="button"
                      onClick={() => quote && !isQuoteExpired(quote, now) && setReviewing(quote)}
                      disabled={!quote || isQuoteExpired(quote, now)}
                      className="w-full py-3.5 rounded-2xl border border-[#E2E2E0] dark:border-[#26262B] text-sm font-semibold disabled:opacity-50"
                    >
                      {quote && !isQuoteExpired(quote, now) ? 'Load latest quote' : 'Waiting for a fresh quote…'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => exec.execute(chain, wallet.address!, reviewing)}
                    disabled={exec.busy}
                    className="w-full py-3.5 rounded-2xl bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold disabled:opacity-50"
                  >
                    Confirm in wallet
                  </button>
                )}
              </>
            ) : (
              <>
                <TxStatusPanel
                  phase={exec.phase}
                  chain={chain}
                  details={[
                    { label: 'Paid', value: `${formatTokenDisplay(reviewing.amountIn, reviewing.tokenIn.decimals, { maxFractionDigits: 8 })} ${reviewing.tokenIn.symbol}` },
                    ...(exec.phase.phase === 'confirmed' && exec.received !== null
                      ? [{ label: 'Received', value: `${formatTokenDisplay(exec.received, reviewing.tokenOut.decimals, { maxFractionDigits: 8 })} ${reviewing.tokenOut.symbol} (from receipt)` }]
                      : [{ label: 'Minimum', value: `${formatTokenDisplay(reviewing.minAmountOut, reviewing.tokenOut.decimals, { maxFractionDigits: 8 })} ${reviewing.tokenOut.symbol}` }]),
                  ]}
                />
                {isTerminal(exec.phase) && (
                  <button type="button" onClick={() => { setReviewing(null); exec.reset(); }} className="w-full py-3 rounded-2xl border border-[#E2E2E0] dark:border-[#26262B] text-xs font-semibold">
                    Done
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#777777] dark:text-[#A0A0A0] shrink-0">{label}</span>
      <span className="text-right text-[#111111] dark:text-[#FFFFFF]">{children}</span>
    </div>
  );
}
