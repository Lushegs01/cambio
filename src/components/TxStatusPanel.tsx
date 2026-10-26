import React, { useState } from 'react';
import { AlertCircle, Check, CircleSlash, Clock, Copy, ExternalLink, HelpCircle, Loader2, XCircle } from 'lucide-react';
import type { MezoChainConfig } from '../config/chains';
import { explorerTxUrl } from '../config/chains';
import type { TxPhase } from '../lib/transactions';
import { copyToClipboard, formatDateTime } from '../utils/format';

interface TxStatusPanelProps {
  phase: TxPhase;
  chain: MezoChainConfig;
  /** Rows shown in the receipt (recipient, amount, ...). */
  details?: { label: string; value: React.ReactNode }[];
  onRecheck?: () => void;
}

function HashRow({ hash, chain }: { hash: string; chain: MezoChainConfig }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">Transaction hash</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[11px] font-mono break-all text-[#111111] dark:text-[#FFFFFF] bg-white dark:bg-[#141416] p-2 rounded-lg border border-[#E2E2E0] dark:border-[#26262B]">
          {hash}
        </code>
        <button
          type="button"
          onClick={async () => {
            if (await copyToClipboard(hash)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
          className="p-2 rounded-lg border border-[#E2E2E0] dark:border-[#26262B] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F]"
          aria-label="Copy transaction hash"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
      <a
        href={explorerTxUrl(chain, hash)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#315EF7] hover:underline"
      >
        View on {chain.name} explorer <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

const TONE = {
  info: 'bg-[#F0F0EE] dark:bg-[#1A1A1D] border-[#E2E2E0] dark:border-[#26262B] text-[#111111] dark:text-[#FFFFFF]',
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300',
  warn: 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300',
  error: 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300',
};

/** One renderer for every transaction outcome, so no screen can present an unconfirmed transfer as settled. */
export const TxStatusPanel: React.FC<TxStatusPanelProps> = ({ phase, chain, details, onRecheck }) => {
  let tone: keyof typeof TONE = 'info';
  let icon: React.ReactNode = null;
  let title = '';
  let body: React.ReactNode = null;

  switch (phase.phase) {
    case 'idle':
      return null;
    case 'preparing':
      icon = <Loader2 className="w-5 h-5 animate-spin" />;
      title = 'Preparing';
      body = phase.step;
      break;
    case 'awaiting_signature':
      icon = <Loader2 className="w-5 h-5 animate-spin" />;
      title = 'Waiting for your wallet';
      body = phase.step ?? 'Review and confirm in your wallet. Nothing is sent until you approve.';
      break;
    case 'pending':
      icon = <Clock className="w-5 h-5 animate-pulse" />;
      title = 'Submitted — waiting for confirmation';
      body = 'Broadcast to the network. Not final until it is included in a block.';
      break;
    case 'confirmed':
      tone = 'success';
      icon = <Check className="w-5 h-5" />;
      title = 'Confirmed on-chain';
      body = `Included in block ${phase.receipt.blockNumber}${phase.receipt.blockTimestamp ? ` · ${formatDateTime(phase.receipt.blockTimestamp)}` : ''}.`;
      break;
    case 'reverted':
      tone = 'error';
      icon = <XCircle className="w-5 h-5" />;
      title = 'Reverted — no funds moved';
      body = `The transaction was mined in block ${phase.receipt.blockNumber} but failed. Only the network fee was spent.`;
      break;
    case 'rejected':
      tone = 'warn';
      icon = <CircleSlash className="w-5 h-5" />;
      title = 'Cancelled in wallet';
      body = phase.message;
      break;
    case 'failed':
      tone = 'error';
      icon = <AlertCircle className="w-5 h-5" />;
      title = 'Not sent';
      body = phase.message;
      break;
    case 'unknown':
      tone = 'warn';
      icon = <HelpCircle className="w-5 h-5" />;
      title = 'Outcome not confirmed yet';
      body = phase.message;
      break;
  }

  const hash = 'hash' in phase ? phase.hash : null;

  return (
    <div className="space-y-3" aria-live="polite">
      <div className={`p-4 rounded-2xl border flex items-start gap-3 ${TONE[tone]}`}>
        <div className="shrink-0 mt-0.5">{icon}</div>
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-bold">{title}</p>
          {body && <p className="text-xs leading-relaxed opacity-90">{body}</p>}
        </div>
      </div>
      {(details?.length || hash) && (
        <div className="p-4 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-2.5 text-xs">
          {details?.map((d) => (
            <div key={d.label} className="flex justify-between gap-4">
              <span className="font-mono uppercase text-[10px] tracking-wider text-[#777777] dark:text-[#A0A0A0] shrink-0">{d.label}</span>
              <span className="text-right text-[#111111] dark:text-[#FFFFFF] break-all">{d.value}</span>
            </div>
          ))}
          <div className="flex justify-between gap-4">
            <span className="font-mono uppercase text-[10px] tracking-wider text-[#777777] dark:text-[#A0A0A0]">Network</span>
            <span className="text-right text-[#111111] dark:text-[#FFFFFF]">
              {chain.name} (chain {chain.chainId})
            </span>
          </div>
          {hash && <HashRow hash={hash} chain={chain} />}
        </div>
      )}
      {phase.phase === 'unknown' && onRecheck && (
        <button
          type="button"
          onClick={onRecheck}
          className="w-full py-2.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] text-xs font-semibold hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F]"
        >
          Check status again
        </button>
      )}
    </div>
  );
};
