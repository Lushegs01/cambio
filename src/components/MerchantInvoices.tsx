/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merchant invoice workspace: every signed request from this device and (after a free wallet sign-in)
 * from the server registry, with on-chain-verified status, totals, search, filters and CSV export.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CloudCheck, CloudOff, Download, ExternalLink, Loader2, LogIn, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { signMessage } from 'wagmi/actions';
import type { Hex } from 'viem';
import type { MezoChainConfig } from '../config/chains';
import { explorerTxUrl } from '../config/chains';
import { wagmiConfig } from '../config/walletConnect';
import type { WalletState } from '../types';
import { formatTokenDisplay } from '../lib/amounts';
import { deleteStoredRequest, formatTimeRemaining, type StoredRequest } from '../lib/paymentRequest';
import { findRequestSettlement } from '../lib/requestSettlement';
import { publicClientFor } from '../lib/wagmiDeps';
import { classifyTxError } from '../lib/txErrors';
import {
  clearMerchantSession,
  filterInvoices,
  invoicesCsv,
  invoiceTotals,
  mergeInvoices,
  readMerchantSession,
  writeMerchantSession,
  type InvoiceFilter,
  type InvoiceRow,
  type LocalCheck,
} from '../lib/invoices';
import { MerchantProCard } from './MerchantProCard';
import { completeMerchantSession, InvoiceApiError, listAllInvoices, saveInvoice, startMerchantSession, submitSettlement, type ServerInvoice } from '../services/invoiceClient';

const musd = (v: bigint) => formatTokenDisplay(v, 18, { maxFractionDigits: 2, minFractionDigits: 2 });

const STATUS: Record<InvoiceRow['status'], { label: string; cls: string }> = {
  paid: { label: 'Paid · verified', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  paid_late: { label: 'Paid late', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  pending: { label: 'Awaiting payment', cls: 'bg-[#F0F0EE] dark:bg-[#1A1A1D] text-[#555555] dark:text-[#A0A0A0] border-[#E2E2E0] dark:border-[#26262B]' },
  expired: { label: 'Expired', cls: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30' },
  unknown: { label: 'Unknown', cls: 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30' },
};

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'paid', label: 'Paid' },
  { key: 'late', label: 'Late' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'expired', label: 'Expired' },
  { key: 'unknown', label: 'Unknown' },
];

interface Props {
  wallet: WalletState;
  chain: MezoChainConfig;
  local: StoredRequest[];
  onLocalChanged: () => void;
  onOpen: (row: InvoiceRow) => void;
}

export const MerchantInvoices: React.FC<Props> = ({ wallet, chain, local, onLocalChanged, onOpen }) => {
  const address = wallet.address!;
  const [token, setToken] = useState<string | null>(() => readMerchantSession(address));
  const [server, setServer] = useState<ServerInvoice[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'signing' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, LocalCheck>>({});
  const [filter, setFilter] = useState<InvoiceFilter>('all');
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setToken(readMerchantSession(address));
    setServer([]);
    setChecks({});
  }, [address]);

  const load = useCallback(async (t: string) => {
    setSyncState('loading');
    setSyncError(null);
    try {
      const { items, truncated: more } = await listAllInvoices(t);
      setServer(items);
      setTruncated(more);
      setSyncState('idle');
    } catch (err) {
      if (err instanceof InvoiceApiError && err.status === 401) {
        clearMerchantSession(address);
        setToken(null);
        setSyncState('idle');
        return;
      }
      setSyncState('error');
      setSyncError(err instanceof InvoiceApiError ? err.message : 'Could not load invoices.');
    }
  }, [address]);

  useEffect(() => {
    if (token) load(token);
  }, [token, load]);

  const signIn = async () => {
    setSyncState('signing');
    setSyncError(null);
    try {
      const ch = await startMerchantSession(address, chain.chainId);
      const signature = await signMessage(wagmiConfig, { account: address, message: ch.message });
      const s = await completeMerchantSession(ch.nonce, signature);
      writeMerchantSession(address, s.token, s.expiresAt);
      // Upload this device's requests so they become available on other devices.
      await Promise.allSettled(local.map((l) => saveInvoice(l.request, l.signature)));
      setToken(s.token);
    } catch (err) {
      setSyncState('error');
      setSyncError(classifyTxError(err).code === 'rejected' ? 'Sign-in was cancelled in your wallet.' : err instanceof InvoiceApiError ? err.message : 'Sign-in failed.');
    }
  };

  const rows = useMemo(() => mergeInvoices(local, server, checks, now), [local, server, checks, now]);
  const visible = useMemo(() => filterInvoices(rows, filter, query), [rows, filter, query]);
  const totals = useMemo(() => invoiceTotals(rows), [rows]);

  const check = async (row: InvoiceRow) => {
    const key = row.request.id.toLowerCase();
    setChecks((c) => ({ ...c, [key]: { state: 'checking' } }));
    const res = await findRequestSettlement(chain, publicClientFor(chain.chainId) as never, row.request);
    if (res.state === 'settled') {
      setChecks((c) => ({ ...c, [key]: { state: 'paid', hash: res.hash, late: res.result.status === 'settled_after_expiry' } }));
      // Let the server verify and record it too (it re-reads the chain; it does not trust this browser).
      try {
        if (!row.synced) await saveInvoice(row.request, row.signature);
        const updated = await submitSettlement(row.request.recipient, row.request.id, res.hash);
        setServer((s) => [updated, ...s.filter((x) => x.id.toLowerCase() !== updated.id.toLowerCase())]);
      } catch {
        // Server registry unavailable: the on-chain verification above still stands for this browser.
      }
    } else if (res.state === 'not_found') {
      setChecks((c) => ({ ...c, [key]: { state: 'unpaid' } }));
    } else {
      setChecks((c) => ({ ...c, [key]: { state: 'unknown', message: 'message' in res ? res.message : 'Could not verify payment status.' } }));
    }
  };

  const checkAllOpen = async () => {
    for (const r of rows.filter((x) => x.status === 'pending' || x.status === 'unknown' || x.status === 'expired').slice(0, 20)) await check(r);
  };

  const exportCsv = () => {
    const blob = new Blob([invoicesCsv(visible, (h) => explorerTxUrl(chain, h))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cambio-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section aria-labelledby="invoices-heading" className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-5 sm:p-7 space-y-5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 id="invoices-heading" className="text-base font-bold text-[#111111] dark:text-[#FFFFFF]">Invoices</h2>
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
            Paid status comes only from on-chain verification. Totals count verified payments only.
          </p>
        </div>
        {token ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
            {syncState === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudCheck className="w-3.5 h-3.5" />} Synced with the invoice registry
            <button type="button" onClick={() => load(token)} className="p-1 rounded hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F]" aria-label="Reload invoices">
              <RefreshCw className="w-3 h-3" />
            </button>
          </span>
        ) : (
          <button type="button" onClick={signIn} disabled={syncState === 'signing' || wallet.dataMode === 'demo'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] text-xs font-semibold disabled:opacity-50">
            {syncState === 'signing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />} Sign in to sync across devices
          </button>
        )}
      </div>
      {!token && <p className="text-[11px] text-[#777777] -mt-2 flex items-center gap-1.5"><CloudOff className="w-3.5 h-3.5" /> Showing requests saved on this device. Signing in is a free wallet signature (no transaction).</p>}
      {token && <MerchantProCard token={token} wallet={wallet} chain={chain} />}
      {syncError && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">{syncError}</p>}
      {truncated && <p className="text-xs text-amber-700 dark:text-amber-400">Showing the newest 1,000 invoices.</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Tile label="Paid (verified)" value={`${musd(totals.paidAmount)} MUSD`} sub={`${totals.paidCount} invoice${totals.paidCount === 1 ? '' : 's'}`} />
        <Tile label="Awaiting payment" value={`${musd(totals.pendingAmount)} MUSD`} sub={`${totals.pendingCount} open`} />
        <Tile label="Expired" value={String(totals.expiredCount)} sub="unpaid at expiry" />
        <Tile label="Unknown" value={String(totals.unknownCount)} sub="could not be verified" />
      </div>
      {totals.duplicateCount > 0 && (
        <p role="alert" className="text-xs text-amber-800 dark:text-amber-300 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {totals.duplicateCount} invoice{totals.duplicateCount === 1 ? ' was' : 's were'} paid more than once on-chain. See the rows marked “duplicate payment”.</p>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter invoices">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} className={`px-2.5 py-1 rounded-lg text-xs border ${filter === f.key ? 'bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] border-[#111111]' : 'border-[#E2E2E0] dark:border-[#26262B] text-[#555555] dark:text-[#A0A0A0]'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="relative flex-1 sm:max-w-xs sm:ml-auto">
          <span className="sr-only">Search invoices</span>
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#999999]" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Note, amount, id or tx" className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-white dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B]" />
        </label>
        <div className="flex gap-1.5">
          <button type="button" onClick={checkAllOpen} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-[#E2E2E0] dark:border-[#26262B]"><RefreshCw className="w-3 h-3" /> Check open</button>
          <button type="button" onClick={exportCsv} disabled={!visible.length} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-[#E2E2E0] dark:border-[#26262B] disabled:opacity-50"><Download className="w-3 h-3" /> CSV</button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-[#777777] py-6 text-center">{rows.length === 0 ? 'No invoices yet. Create a signed request above to get paid in MUSD.' : 'No invoices match this filter.'}</p>
      ) : (
        <ul className="divide-y divide-[#E2E2E0] dark:divide-[#26262B]">
          {visible.map((r) => {
            const c = checks[r.request.id.toLowerCase()];
            return (
              <li key={r.request.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <button type="button" onClick={() => onOpen(r)} className="flex-1 min-w-0 text-left">
                  <span className="text-sm font-bold font-mono text-[#111111] dark:text-[#FFFFFF]">{musd(BigInt(r.request.amount))} MUSD</span>
                  <span className="ml-2 text-[11px] text-[#777777]">{new Date(r.request.createdAt * 1000).toLocaleDateString()} · {r.status === 'pending' ? formatTimeRemaining(r.request.expiresAt, now) : `#${r.request.id.slice(2, 10)}`}</span>
                  {r.request.memo && <span className="block text-xs text-[#555555] dark:text-[#A0A0A0] truncate">{r.request.memo}</span>}
                  {r.statusNote && <span className="block text-[11px] text-amber-700 dark:text-amber-400">{r.statusNote}</span>}
                  {r.duplicatePayments.length > 0 && <span className="block text-[11px] text-amber-700 dark:text-amber-400">Duplicate payment: {r.duplicatePayments.length} extra transaction{r.duplicatePayments.length === 1 ? '' : 's'}</span>}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  {r.settlementTx && r.synced && (
                    <a href={`#proof/${r.request.recipient}/${r.request.id}`} className="p-1 text-emerald-700 hover:text-emerald-900 dark:text-emerald-400" aria-label="Open the public settlement proof" title="Public proof anyone can verify without a wallet">
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {r.settlementTx && (
                    <a href={explorerTxUrl(chain, r.settlementTx)} target="_blank" rel="noopener noreferrer" className="p-1 text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF]" aria-label="View settlement transaction">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {!r.settlementTx && (
                    <button type="button" onClick={() => check(r)} disabled={c?.state === 'checking'} className="p-1 text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF] disabled:opacity-50" aria-label="Check on-chain whether this invoice was paid">
                      <RefreshCw className={`w-3.5 h-3.5 ${c?.state === 'checking' ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  {r.onDevice && !r.synced && (
                    <button
                      type="button"
                      onClick={() => {
                        deleteStoredRequest(r.request.recipient, r.request.id as Hex);
                        onLocalChanged();
                      }}
                      className="p-1 text-[#999999] hover:text-red-500"
                      aria-label="Remove from this device"
                      title="Removes it from this device only. The link stays valid until it expires."
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <span className="text-[10px] text-[#999999] w-14 text-right">{r.synced ? 'synced' : 'this device'}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="p-3 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B]">
      <span className="block text-[10px] uppercase tracking-wider text-[#777777]">{label}</span>
      <span className="block mt-0.5 text-sm font-bold font-mono text-[#111111] dark:text-[#FFFFFF] tabular-nums">{value}</span>
      <span className="block text-[10px] text-[#777777]">{sub}</span>
    </div>
  );
}
