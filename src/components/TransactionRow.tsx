import React from 'react';
import { ArrowUpRight, ArrowDownLeft, ArrowLeftRight } from 'lucide-react';
import type { ActivityItem, ActivityStatus } from '../lib/activity';
import { formatTokenDisplay, toDisplayNumber } from '../lib/amounts';
import { useCurrency } from '../context/CurrencyContext';
import { formatDateTime, shortenAddress } from '../utils/format';

const STATUS_STYLE: Record<ActivityStatus, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  pending: { label: 'Pending', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  reverted: { label: 'Reverted', cls: 'bg-red-500/10 text-red-700 dark:text-red-400' },
  unknown: { label: 'Unconfirmed', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  simulated: { label: 'Simulated', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-400' },
};

export const StatusBadge: React.FC<{ status: ActivityStatus; source?: ActivityItem['source'] }> = ({ status, source }) => (
  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${STATUS_STYLE[status].cls}`}>
    {status === 'confirmed' && source === 'explorer' ? 'Indexed' : STATUS_STYLE[status].label}
  </span>
);

export function counterpartyLabel(item: ActivityItem): string {
  return item.counterpartyName || (item.counterparty ? shortenAddress(item.counterparty) : 'Unknown');
}

interface TransactionRowProps {
  item: ActivityItem;
  onClick?: () => void;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({ item, onClick }) => {
  const { formatTokenFiat } = useCurrency();
  const isReceive = item.kind === 'receive';
  const isSwap = item.kind === 'swap';
  const fiat = item.symbol === 'MUSD' ? formatTokenFiat(toDisplayNumber(item.amount, item.decimals), 'MUSD') : null;
  const sign = isSwap ? '⇄ ' : isReceive ? '+' : '−';

  return (
    <div
      onClick={onClick}
      className="group flex items-center justify-between p-4 sm:px-5 hover:bg-[#F0F0EE] dark:hover:bg-[#1A1A1D] rounded-2xl cursor-pointer transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#315EF7]"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick?.()}
      aria-label={`${item.kind} ${formatTokenDisplay(item.amount, item.decimals)} ${item.symbol}, ${STATUS_STYLE[item.status].label}, with ${counterpartyLabel(item)}`}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
            isReceive
              ? 'bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] border-[#111111] dark:border-[#FFFFFF]'
              : 'bg-[#F0F0EE] dark:bg-[#1E1E22] border-[#E2E2E0] dark:border-[#26262B] text-[#111111] dark:text-[#F5F5F7]'
          }`}
        >
          {isSwap ? <ArrowLeftRight className="w-4 h-4" /> : isReceive ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm sm:text-base text-[#111111] dark:text-[#FFFFFF] tracking-tight truncate">{counterpartyLabel(item)}</span>
            {item.memo && <span className="hidden sm:inline text-xs text-[#777777] dark:text-[#A0A0A0] truncate max-w-[180px]">· {item.memo}</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
            <span className="font-mono">{formatDateTime(item.timestamp)}</span>
            <StatusBadge status={item.status} source={item.source} />
          </div>
        </div>
      </div>
      <div className="text-right shrink-0 ml-4">
        <div className="font-bold font-mono text-base sm:text-lg tabular-nums text-[#111111] dark:text-[#FFFFFF]">
          {sign}
          {formatTokenDisplay(item.amount, item.decimals, { maxFractionDigits: 4 })}{' '}
          <span className="text-xs font-normal text-[#777777] dark:text-[#A0A0A0]">{item.symbol}</span>
        </div>
        {fiat && <div className="text-[11px] font-mono text-[#777777] dark:text-[#A0A0A0] tabular-nums mt-0.5">≈ {fiat.formatted}</div>}
      </div>
    </div>
  );
};
