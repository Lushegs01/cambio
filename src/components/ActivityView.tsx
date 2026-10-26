import React, { useState } from 'react';
import { Search, ArrowUpRight, ArrowDownLeft, Download, Receipt, RefreshCw, AlertTriangle } from 'lucide-react';
import type { ActivityItem } from '../lib/activity';
import { formatUnitsExact } from '../lib/amounts';
import { getKnownChainConfig, explorerTxUrl } from '../config/chains';
import { TransactionRow } from './TransactionRow';
import { TransactionDetailModal } from './TransactionDetailModal';
import { HalftonePattern } from './HalftonePattern';
import { csvCell } from '../lib/csv';

interface ActivityViewProps {
  transactions: ActivityItem[];
  mode: 'real' | 'demo';
  loading?: boolean;
  coverage?: string;
  error?: string | null;
  onRefresh?: () => void;
  onOpenSend: () => void;
  onOpenReceive: () => void;
}

export const ActivityView: React.FC<ActivityViewProps> = ({
  transactions,
  mode,
  loading,
  coverage,
  error,
  onRefresh,
  onOpenSend,
  onOpenReceive,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'send' | 'receive' | 'swap'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selected, setSelected] = useState<ActivityItem | null>(null);

  const filteredTransactions = transactions.filter((tx) => {
    if (filterType !== 'all' && tx.kind !== filterType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return [tx.counterpartyName, tx.counterparty, tx.memo, tx.hash].some((f) => f?.toLowerCase().includes(q));
    }
    return true;
  });

  const handleExportCSV = () => {
    if (transactions.length === 0) return;
    const header = ['mode', 'type', 'status', 'counterparty', 'amount', 'token', 'time_utc', 'chain_id', 'tx_hash', 'explorer_url', 'note'];
    const rows = transactions.map((t) => {
      const chain = getKnownChainConfig(t.chainId);
      return [
        t.mode,
        t.kind,
        t.status,
        t.counterparty ?? '',
        formatUnitsExact(t.amount, t.decimals),
        t.symbol,
        t.timestamp ? new Date(t.timestamp).toISOString() : '',
        t.chainId ? String(t.chainId) : '',
        t.hash ?? '',
        chain && t.hash ? explorerTxUrl(chain, t.hash) : '',
        t.memo ?? '',
      ].map(csvCell).join(',');
    });
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = mode === 'demo' ? 'cambio_demo_activity.csv' : 'cambio_activity.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header controls with halftone accent */}
      <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-7 shadow-xs space-y-4 transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
        <HalftonePattern variant="fade-right" className="absolute right-0 top-0 h-full w-48 opacity-10 dark:opacity-15 pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
              {mode === 'demo' ? 'Simulated (demo mode)' : 'On-chain history'}
            </div>
            <h2 className="text-xl font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans mt-0.5">
              Transaction History
            </h2>
            <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
              {coverage || 'MUSD transfers for the connected wallet. Every confirmed row links to the explorer.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {transactions.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="group flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1C1C1F] hover:bg-[#F0F0EE] dark:hover:bg-[#242428] border border-[#E2E2E0] dark:border-[#26262B] text-xs font-mono font-semibold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF] transition-all duration-150 hover:shadow-xs active:scale-[0.98]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            )}

            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={loading}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1C1C1F] border border-[#E2E2E0] dark:border-[#26262B] text-xs font-mono font-semibold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF] disabled:opacity-50"
                aria-label="Refresh activity"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>{loading ? 'Loading' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="relative z-10 flex flex-col sm:flex-row gap-3 pt-2">
          {/* Search Input */}
          <div className="relative flex-1 group">
            <Search className="w-4 h-4 text-[#777777] dark:text-[#A0A0A0] group-hover:text-[#111111] dark:group-hover:text-[#FFFFFF] absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-150" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by counterparty, 0x address, hash or note…"
              aria-label="Filter activity"
              className="w-full pl-10 pr-4 py-2.5 text-xs rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] hover:bg-[#EAEAEA] dark:hover:bg-[#202024] focus:bg-white dark:focus:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#C8C8C5] dark:hover:border-[#3A3A40] focus:border-[#111111] dark:focus:border-[#FFFFFF] text-[#111111] dark:text-[#FFFFFF] placeholder-[#777777]/70 dark:placeholder-[#A0A0A0]/60 transition-all duration-200 outline-none font-mono"
            />
          </div>

          {/* Segmented Filter Control */}
          <div className="flex items-center p-1 bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] rounded-xl self-start sm:self-auto shadow-2xs">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold uppercase tracking-wider rounded-lg transition-all duration-150 ${
                filterType === 'all'
                  ? 'bg-white dark:bg-[#26262B] text-[#111111] dark:text-[#FFFFFF] shadow-xs'
                  : 'text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] active:scale-95'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterType('receive')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold uppercase tracking-wider rounded-lg transition-all duration-150 ${
                filterType === 'receive'
                  ? 'bg-white dark:bg-[#26262B] text-[#111111] dark:text-[#FFFFFF] shadow-xs'
                  : 'text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] active:scale-95'
              }`}
            >
              Received
            </button>
            <button
              onClick={() => setFilterType('send')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold uppercase tracking-wider rounded-lg transition-all duration-150 ${
                filterType === 'send'
                  ? 'bg-white dark:bg-[#26262B] text-[#111111] dark:text-[#FFFFFF] shadow-xs'
                  : 'text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] active:scale-95'
              }`}
            >
              Sent
            </button>
            <button
              onClick={() => setFilterType('swap')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold uppercase tracking-wider rounded-lg transition-all duration-150 ${
                filterType === 'swap'
                  ? 'bg-white dark:bg-[#26262B] text-[#111111] dark:text-[#FFFFFF] shadow-xs'
                  : 'text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] active:scale-95'
              }`}
            >
              Swapped
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div role="status" className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {coverage}
        </div>
      )}

      {/* List Container */}
      <div className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 shadow-xs transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
        {filteredTransactions.length === 0 ? (
          <div className="relative overflow-hidden py-16 text-center flex flex-col items-center justify-center">
            <div className="relative mb-3">
              <div className="w-14 h-14 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-center text-[#111111] dark:text-[#FFFFFF] relative z-10">
                <Receipt className="w-6 h-6 text-[#111111] dark:text-[#FFFFFF]" />
              </div>
              <HalftonePattern variant="sphere" className="absolute -inset-6 w-28 h-28 opacity-20 pointer-events-none" />
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
              Query Result
            </div>
            <h3 className="text-sm font-bold text-[#111111] dark:text-[#FFFFFF] mt-1 font-sans">
              {loading ? 'Loading…' : searchQuery ? 'No matching records' : 'No MUSD activity yet'}
            </h3>
            <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-1 max-w-sm">
              {searchQuery
                ? 'Try adjusting your search query or reset the filter selection.'
                : 'Transfers appear here once they are on-chain.'}
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={onOpenSend}
                className="group inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] text-xs font-semibold tracking-tight transition-all duration-150 active:scale-[0.98]"
              >
                <ArrowUpRight className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                <span>Send MUSD</span>
              </button>
              <button
                onClick={onOpenReceive}
                className="group inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#111111] dark:hover:border-[#FFFFFF] text-xs font-semibold text-[#111111] dark:text-[#FFFFFF] transition-all duration-150 active:scale-[0.98]"
              >
                <ArrowDownLeft className="w-3.5 h-3.5 transition-transform duration-150 group-hover:-translate-x-0.5 group-hover:translate-y-0.5" />
                <span>Receive</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#E2E2E0] dark:divide-[#26262B] -mx-2 sm:-mx-3">
            {filteredTransactions.map((tx) => (
              <TransactionRow key={tx.key} item={tx} onClick={() => setSelected(tx)} />
            ))}
          </div>
        )}
      </div>
      <TransactionDetailModal item={selected} onClose={() => setSelected(null)} />
    </div>
  );
};
