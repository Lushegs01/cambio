import React, { useState } from 'react';
import { ChevronRight, Receipt, Loader2 } from 'lucide-react';
import type { ActivityItem } from '../lib/activity';
import { TransactionRow } from './TransactionRow';
import { TransactionDetailModal } from './TransactionDetailModal';
import { HalftonePattern } from './HalftonePattern';
import { SendPlaneIcon } from './SendPlaneIcon';
import { ReceivePlaneIcon } from './ReceivePlaneIcon';

interface RecentActivityProps {
  transactions: ActivityItem[];
  loading?: boolean;
  coverage?: string;
  onViewAll: () => void;
  onSend: () => void;
  onReceive: () => void;
}

export const RecentActivity: React.FC<RecentActivityProps> = ({
  transactions,
  loading,
  coverage,
  onViewAll,
  onSend,
  onReceive,
}) => {
  const [selectedTx, setSelectedTx] = useState<ActivityItem | null>(null);

  return (
    <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-6 transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-sans font-medium uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
            Audit & History
          </div>
          <div className="flex items-center gap-2.5 mt-0.5">
            <h2 className="text-lg sm:text-xl font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans">
              Recent Activity
            </h2>
            {transactions.length > 0 && (
              <span className="text-xs font-mono tabular-nums font-semibold text-[#111111] dark:text-[#FFFFFF] bg-[#F0F0EE] dark:bg-[#1A1A1D] px-2 py-0.5 rounded-md border border-[#E2E2E0] dark:border-[#26262B]">
                {transactions.length} RECORDS
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onViewAll}
          className="group flex items-center gap-1.5 text-xs font-sans font-semibold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF] hover:underline transition-all duration-150 py-2 px-3.5 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] cursor-pointer"
        >
          <span>View all</span>
          <ChevronRight className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </button>
      </div>

      {/* Content: Empty State vs Populated Rows */}
      {coverage && <p className="-mt-3 text-[11px] text-[#777777] dark:text-[#A0A0A0]">{coverage}</p>}

      {loading && transactions.length === 0 ? (
        <div className="py-14 flex items-center justify-center gap-2 text-sm text-[#777777] dark:text-[#A0A0A0]" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading on-chain activity…
        </div>
      ) : transactions.length === 0 ? (
        <div className="relative overflow-hidden py-14 sm:py-16 text-center flex flex-col items-center justify-center border border-[#E2E2E0] dark:border-[#26262B] rounded-2xl bg-[#F5F5F3]/50 dark:bg-[#111113]/50 p-6">
          {/* Halftone Sphere behind the empty state icon */}
          <div className="relative mb-4">
            <div className="w-16 h-16 rounded-2xl bg-white dark:bg-[#161619] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-center text-[#111111] dark:text-[#FFFFFF] shadow-xs relative z-10">
              <Receipt className="w-7 h-7 text-[#111111] dark:text-[#FFFFFF]" />
            </div>
            <HalftonePattern variant="sphere" className="absolute -inset-8 w-32 h-32 opacity-25 dark:opacity-30 pointer-events-none" />
          </div>

          <div className="text-xs font-sans font-medium uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
            No MUSD activity found
          </div>
          <h3 className="text-base sm:text-lg font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight mt-1 font-sans">
            No transactions recorded yet
          </h3>
          <p className="text-sm text-[#777777] dark:text-[#A0A0A0] mt-1 max-w-sm leading-relaxed font-sans">
            Transfers to or from this wallet appear here once they are on-chain.
          </p>

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={onSend}
              className="group inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] text-sm font-semibold tracking-wide shadow-xs hover:shadow-sm hover:scale-[1.01] active:scale-[0.98] transition-all duration-150 cursor-pointer"
            >
              <SendPlaneIcon className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              <span>Send MUSD</span>
            </button>
            <button
              onClick={onReceive}
              className="group inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#111111] dark:hover:border-[#FFFFFF] text-sm font-semibold text-[#111111] dark:text-[#FFFFFF] shadow-xs hover:shadow-sm hover:scale-[1.01] active:scale-[0.98] transition-all duration-150 cursor-pointer"
            >
              <ReceivePlaneIcon className="w-3.5 h-3.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:translate-y-0.5" />
              <span>Receive</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[#E2E2E0] dark:divide-[#26262B] -mx-2 sm:-mx-3">
          {transactions.slice(0, 5).map((tx) => (
            <TransactionRow key={tx.key} item={tx} onClick={() => setSelectedTx(tx)} />
          ))}
        </div>
      )}

      <TransactionDetailModal item={selectedTx} onClose={() => setSelectedTx(null)} />
    </div>
  );
};
