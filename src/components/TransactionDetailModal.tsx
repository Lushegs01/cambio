import React, { useEffect, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { ActivityItem } from '../lib/activity';
import { formatTokenDisplay, toDisplayNumber } from '../lib/amounts';
import { getKnownChainConfig, explorerTxUrl, explorerAddressUrl } from '../config/chains';
import { useCurrency } from '../context/CurrencyContext';
import { formatDateTime } from '../utils/format';
import { HalftonePattern } from './HalftonePattern';
import { StatusBadge, counterpartyLabel } from './TransactionRow';

const SOURCE_LABEL: Record<ActivityItem['source'], string> = {
  explorer: 'Mezo explorer index',
  'rpc-logs': 'RPC event logs',
  'this-device': 'Submitted from this device (status checked against the chain)',
  demo: 'Demo mode — simulated, not on-chain',
};

export const TransactionDetailModal: React.FC<{ item: ActivityItem | null; onClose: () => void }> = ({ item, onClose }) => {
  const { preferredCurrency, formatTokenFiat } = useCurrency();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (item) closeRef.current?.focus();
  }, [item]);
  if (!item) return null;

  const chain = getKnownChainConfig(item.chainId);
  const fiat = item.symbol === 'MUSD' ? formatTokenFiat(toDisplayNumber(item.amount, item.decimals), 'MUSD') : null;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Status', value: <StatusBadge status={item.status} source={item.source} /> },
    { label: 'Time', value: formatDateTime(item.timestamp) },
    { label: item.kind === 'receive' ? 'From' : 'To', value: <span className="font-mono text-[11px] break-all">{item.counterparty ?? '—'}</span> },
    ...(item.memo ? [{ label: 'Note (this device)', value: item.memo }] : []),
    { label: 'Network', value: chain ? `${chain.name} (chain ${chain.chainId})` : item.mode === 'demo' ? 'Simulated' : '—' },
    { label: 'Source', value: SOURCE_LABEL[item.source] },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-detail-title"
    >
      <div
        className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 max-w-md w-full shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <HalftonePattern variant="corner" className="absolute right-0 top-0 w-32 h-32 opacity-15 dark:opacity-20 pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between pb-3 border-b border-[#E2E2E0] dark:border-[#26262B]">
          <span id="tx-detail-title" className="text-xs font-mono font-bold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF]">
            {item.mode === 'demo' ? 'Simulated record' : 'Transaction receipt'}
          </span>
          <button ref={closeRef} onClick={onClose} className="p-1.5 text-[#777777] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-[#FFFFFF] rounded-xl hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F]" aria-label="Close details">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative z-10 text-center py-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
            {item.kind === 'receive' ? 'Received' : item.kind === 'swap' ? 'Swap leg' : 'Sent'}
          </div>
          <div className="font-mono text-3xl font-bold tabular-nums text-[#111111] dark:text-[#FFFFFF] mt-1">
            {formatTokenDisplay(item.amount, item.decimals, { maxFractionDigits: 6 })} <span className="text-xs font-normal text-[#777777]">{item.symbol}</span>
          </div>
          {fiat && <div className="text-xs font-mono text-[#777777] dark:text-[#A0A0A0] mt-1">≈ {fiat.formatted} {preferredCurrency}</div>}
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-1">
            {item.kind === 'receive' ? 'From' : 'With'} <span className="font-semibold text-[#111111] dark:text-[#FFFFFF]">{counterpartyLabel(item)}</span>
          </p>
        </div>

        <div className="relative z-10 space-y-2 text-xs bg-[#F0F0EE] dark:bg-[#1A1A1D] p-4 rounded-2xl border border-[#E2E2E0] dark:border-[#26262B]">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-4 py-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0] shrink-0">{r.label}</span>
              <span className="text-right text-[#111111] dark:text-[#FFFFFF]">{r.value}</span>
            </div>
          ))}
          {item.hash ? (
            <div className="pt-1 space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">Hash</span>
              <code className="block text-[11px] font-mono break-all text-[#111111] dark:text-[#FFFFFF]">{item.hash}</code>
            </div>
          ) : (
            <p className="pt-1 text-[11px] text-violet-700 dark:text-violet-300">No transaction hash: this record was simulated in demo mode.</p>
          )}
        </div>

        {chain && item.hash && (
          <div className="relative z-10 flex flex-wrap gap-3 text-xs">
            <a href={explorerTxUrl(chain, item.hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#315EF7] hover:underline">
              Verify on explorer <ExternalLink className="w-3 h-3" />
            </a>
            {item.counterparty && (
              <a href={explorerAddressUrl(chain, item.counterparty)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#777777] hover:underline">
                Counterparty <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
