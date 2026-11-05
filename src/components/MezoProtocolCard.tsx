/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mezo-native view of the connected wallet: the BTC price from Mezo's own PriceFeed oracle, the MUSD
 * system's health, the wallet's trove (BTC collateral / MUSD debt) and a read-only borrowing preview.
 * Everything is read from the chain; Cambio sends no borrowing transactions.
 */

import React, { useMemo, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, ExternalLink, Landmark, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { WalletState } from '../types';
import { explorerAddressUrl, type MezoChainConfig } from '../config/chains';
import { useMezoProtocol } from '../hooks/useMezoProtocol';
import { formatTokenDisplay, parseTokenAmount } from '../lib/amounts';
import {
  borrowPreview,
  classifyTrove,
  formatRatioPercent,
  liquidationPrice,
  maxBorrowable,
  safetyBuffer,
  type ProtocolParams,
  type TroveRisk,
  type TroveState,
} from '../lib/mezoProtocol';

const usd = (v: bigint) => `$${formatTokenDisplay(v, 18, { maxFractionDigits: 2, minFractionDigits: 2 })}`;
const btc = (v: bigint) => formatTokenDisplay(v, 18, { maxFractionDigits: 6, minFractionDigits: 2 });
const musd = (v: bigint) => formatTokenDisplay(v, 18, { maxFractionDigits: 2, minFractionDigits: 2 });

const RISK_LABEL: Record<TroveRisk, { text: string; cls: string }> = {
  no_debt: { text: 'No debt', cls: 'bg-[#F0F0EE] dark:bg-[#1A1A1D] text-[#555555] dark:text-[#A0A0A0] border-[#E2E2E0] dark:border-[#26262B]' },
  healthy: { text: 'Healthy', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  watch: { text: 'Watch', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  at_risk: { text: 'Near liquidation', cls: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30' },
  liquidatable: { text: 'Liquidatable', cls: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30' },
};

function secondsAgo(ts: number | null): string {
  if (!ts) return 'round time unavailable';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  return s < 90 ? `updated ${s}s ago` : `updated ${Math.floor(s / 60)} min ago`;
}

export const MezoProtocolCard: React.FC<{ wallet: WalletState; chain: MezoChainConfig }> = ({ wallet, chain }) => {
  const q = useMezoProtocol(chain, wallet.isConnected ? wallet.address : null, wallet.dataMode === 'real');
  const snap = q.data;
  const oracle = snap?.oracle;
  const params = snap?.params ?? null;
  const price = oracle?.status === 'ok' ? oracle.price : null;

  return (
    <section aria-labelledby="mezo-protocol-heading" className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="mezo-protocol-heading" className="text-base font-bold text-[#111111] dark:text-[#FFFFFF] flex items-center gap-2">
            <Landmark className="w-4 h-4" aria-hidden="true" /> Mezo position
          </h2>
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-1">Read live from Mezo&rsquo;s MUSD protocol contracts on {chain.name}.</p>
        </div>
        <button
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="p-1.5 text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF] rounded-xl hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] disabled:opacity-50"
          aria-label="Refresh Mezo protocol data"
        >
          <RefreshCw className={`w-4 h-4 ${q.isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Oracle and system */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="BTC price · Mezo oracle">
          {q.isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-label="Loading" />
          ) : oracle?.status === 'ok' ? (
            <>
              <span className="text-lg font-bold font-mono tabular-nums">{usd(oracle.price)}</span>
              <span className="block text-[10px] text-[#777777]">{secondsAgo(oracle.updatedAt)} · PriceFeed</span>
            </>
          ) : (
            <span className="text-xs text-amber-700 dark:text-amber-400">{oracle?.message ?? (q.isError ? 'Could not read the Mezo PriceFeed.' : '—')}</span>
          )}
        </Stat>
        <Stat label="System collateral ratio">
          {params ? (
            <>
              <span className="text-lg font-bold font-mono tabular-nums">{formatRatioPercent(params.tcr)}%</span>
              <span className="block text-[10px] text-[#777777]">Recovery Mode below {formatRatioPercent(params.ccr, 0)}%</span>
            </>
          ) : (
            <span className="text-xs text-[#777777]">{q.isLoading ? '…' : 'Needs a fresh oracle price'}</span>
          )}
        </Stat>
        <Stat label="New-loan terms">
          {params ? (
            <span className="text-xs text-[#111111] dark:text-[#FFFFFF] leading-relaxed">
              {(params.interestRateBps / 100).toFixed(2)}% APR · {params.recoveryMode ? 'no' : formatRatioPercent(params.borrowingRate, 2) + '%'} fee · min {musd(params.minNetDebt)} MUSD
            </span>
          ) : (
            <span className="text-xs text-[#777777]">—</span>
          )}
        </Stat>
      </div>

      {params?.recoveryMode && (
        <div role="alert" className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            Mezo is in <strong>Recovery Mode</strong> (system ratio below {formatRatioPercent(params.ccr, 0)}%). Collateral cannot be withdrawn, new debt needs a {formatRatioPercent(params.ccr, 0)}% ratio, and troves below {formatRatioPercent(params.mcr, 0)}% can be liquidated.
          </span>
        </div>
      )}

      {/* The wallet's own trove */}
      {!wallet.isConnected ? (
        <p className="text-xs text-[#777777] dark:text-[#A0A0A0]">Connect a wallet to see whether it has a BTC-backed MUSD position.</p>
      ) : q.isError ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">Mezo protocol data could not be read from the network. Nothing is shown rather than a guess.</p>
      ) : snap?.trove && params && price ? (
        <TroveView trove={snap.trove} params={params} price={price} />
      ) : snap && oracle?.status !== 'ok' ? (
        <p className="text-xs text-[#777777]">Trove health needs a fresh oracle price; it will refresh automatically.</p>
      ) : null}

      {params && price && wallet.isConnected && <BorrowPreview params={params} price={price} />}

      <p className="text-[10px] text-[#999999] dark:text-[#707070] leading-relaxed">
        Contracts:{' '}
        <a className="underline" href={explorerAddressUrl(chain, chain.musdProtocol.priceFeed)} target="_blank" rel="noopener noreferrer">PriceFeed</a>
        {' · '}
        <a className="underline" href={explorerAddressUrl(chain, chain.musdProtocol.troveManager)} target="_blank" rel="noopener noreferrer">TroveManager</a>
        {' · '}
        <a className="underline" href={explorerAddressUrl(chain, chain.musdProtocol.borrowerOperations)} target="_blank" rel="noopener noreferrer">BorrowerOperations</a>
        . The oracle price is Mezo&rsquo;s on-chain value and can differ from the display FX rate used elsewhere.
      </p>
    </section>
  );
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-3.5 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] min-h-[72px]">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0] mb-1">{label}</span>
      <div className="text-[#111111] dark:text-[#FFFFFF]">{children}</div>
    </div>
  );
}

function TroveView({ trove, params, price }: { trove: TroveState; params: ProtocolParams; price: bigint }) {
  if (trove.status === 'none') {
    return (
      <div className="p-4 rounded-2xl border border-dashed border-[#E2E2E0] dark:border-[#26262B] text-xs text-[#555555] dark:text-[#A0A0A0] flex gap-2">
        <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>This wallet has no trove: it has not borrowed MUSD against BTC on Mezo. Its MUSD balance carries no liquidation risk.</span>
      </div>
    );
  }
  if (trove.status !== 'active') {
    const label = { closed_by_owner: 'closed by its owner', closed_by_liquidation: 'closed by liquidation', closed_by_redemption: 'closed by redemption', unknown: 'in an unrecognised state', none: '' }[trove.status];
    return <p className="text-xs text-[#555555] dark:text-[#A0A0A0]">This wallet&rsquo;s trove was {label}. It has no open debt.</p>;
  }
  const risk = classifyTrove(trove.icr, params.mcr, params.ccr, trove.debt);
  const lp = liquidationPrice(trove.coll, trove.debt, params.mcr);
  const buffer = safetyBuffer(trove.icr, params.mcr);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#777777]">Your trove</span>
        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${RISK_LABEL[risk].cls}`}>{RISK_LABEL[risk].text}</span>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Fact term="Collateral" value={`${btc(trove.coll)} BTC`} />
        <Fact term="Debt (principal + interest)" value={`${musd(trove.debt)} MUSD`} />
        <Fact term="Collateral ratio" value={`${formatRatioPercent(trove.icr)}%`} hint={`${buffer >= 0n ? '+' : ''}${formatRatioPercent(buffer)} pts above the ${formatRatioPercent(params.mcr, 0)}% minimum`} />
        <Fact term="Liquidation price (estimate)" value={lp ? usd(lp) : '—'} hint={`BTC price where the ratio reaches ${formatRatioPercent(params.mcr, 0)}%`} />
      </dl>
      <p className="text-[11px] text-[#777777] dark:text-[#A0A0A0] leading-relaxed">
        Interest ({(trove.interestRateBps / 100).toFixed(2)}% APR) accrues continuously, which lowers the ratio and raises the liquidation price over time. MUSD holders can also redeem against the lowest-ratio troves. The liquidation price is derived arithmetic, not a protocol guarantee.
      </p>
    </div>
  );
}

function Fact({ term, value, hint }: { term: string; value: string; hint?: string }) {
  return (
    <div className="p-3 rounded-xl bg-[#F5F5F3] dark:bg-[#1A1A1D]">
      <dt className="text-[10px] uppercase tracking-wider text-[#777777]">{term}</dt>
      <dd className="mt-0.5 font-mono font-semibold text-[#111111] dark:text-[#FFFFFF] tabular-nums">{value}</dd>
      {hint && <dd className="text-[10px] text-[#777777] mt-0.5">{hint}</dd>}
    </div>
  );
}

function BorrowPreview({ params, price }: { params: ProtocolParams; price: bigint }) {
  const [open, setOpen] = useState(false);
  const [coll, setColl] = useState('');
  const [amount, setAmount] = useState('');
  const c = parseTokenAmount(coll, 18);
  const a = parseTokenAmount(amount, 18);
  const preview = useMemo(() => (c.ok && a.ok ? borrowPreview(c.value, a.value, price, params) : null), [c, a, price, params]);
  // Suggest the critical ratio (150%) as a conservative target, in either mode.
  const target = params.ccr;
  const suggest = c.ok ? maxBorrowable(c.value, price, target, params) : 0n;

  return (
    <div className="rounded-2xl border border-[#E2E2E0] dark:border-[#26262B]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-[#111111] dark:text-[#FFFFFF]">
        <span className="flex items-center gap-2"><Activity className="w-4 h-4" aria-hidden="true" /> Preview borrowing MUSD against BTC</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[11px] text-[#777777] dark:text-[#A0A0A0] leading-relaxed">
            Preview only. It applies BorrowerOperations&rsquo; rules to live protocol values. Cambio does not open troves or move collateral.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-[11px] font-semibold text-[#555555] dark:text-[#A0A0A0] space-y-1">
              <span>BTC collateral</span>
              <input inputMode="decimal" value={coll} onChange={(e) => setColl(e.target.value.replace(',', '.'))} placeholder="0.05" className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] font-mono text-sm text-[#111111] dark:text-[#FFFFFF]" />
            </label>
            <label className="text-[11px] font-semibold text-[#555555] dark:text-[#A0A0A0] space-y-1">
              <span>MUSD to borrow</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} placeholder={musd(params.minNetDebt)} className="w-full px-3 py-2 rounded-xl bg-white dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] font-mono text-sm text-[#111111] dark:text-[#FFFFFF]" />
            </label>
          </div>
          {c.ok && suggest > 0n && (
            <button type="button" onClick={() => setAmount(formatTokenDisplay(suggest, 18, { maxFractionDigits: 2, minFractionDigits: 0 }).replace(/,/g, ''))} className="text-[11px] underline text-[#555555] dark:text-[#A0A0A0]">
              Use {musd(suggest)} MUSD (keeps the ratio at {formatRatioPercent(target, 0)}%)
            </button>
          )}
          {preview && (
            <div className="space-y-2" aria-live="polite">
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Fact term="Borrowing fee" value={`${musd(preview.fee)} MUSD`} />
                <Fact term="Total debt" value={`${musd(preview.compositeDebt)} MUSD`} hint={`incl. ${musd(params.gasCompensation)} refundable reserve`} />
                <Fact term="Collateral ratio" value={`${formatRatioPercent(preview.icr)}%`} />
                <Fact term="Liquidation price" value={preview.liquidationPrice ? usd(preview.liquidationPrice) : '—'} />
              </dl>
              {preview.ok ? (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">The protocol&rsquo;s opening checks would pass at the current price. About {musd(preview.yearlyInterest)} MUSD interest per year.</p>
              ) : (
                <ul className="text-[11px] text-amber-700 dark:text-amber-400 list-disc list-inside">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              )}
            </div>
          )}
          <p className="text-[11px] text-[#777777] dark:text-[#A0A0A0] leading-relaxed">
            Borrowing locks BTC and creates debt that accrues interest. If the ratio falls below {formatRatioPercent(params.mcr, 0)}% the trove can be liquidated and the collateral lost. To borrow, use the official{' '}
            <a className="underline inline-flex items-center gap-0.5" href="https://mezo.org" target="_blank" rel="noopener noreferrer">Mezo app <ExternalLink className="w-3 h-3" /></a>.
          </p>
        </div>
      )}
    </div>
  );
}
