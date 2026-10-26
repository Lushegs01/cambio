import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { BalanceState } from '../lib/balances';
import { formatTokenDisplay } from '../lib/amounts';

interface BalanceValueProps<A extends string> {
  balance: BalanceState<A>;
  /** Unit label shown after the number. Defaults to the asset symbol. */
  unit?: string;
  maxFractionDigits?: number;
  masked?: boolean;
  className?: string;
  unitClassName?: string;
  /** Compact: single line, no explanatory text for error states. */
  compact?: boolean;
}

/**
 * Renders a typed balance. Loading, unsupported-network and RPC-error states are shown as such —
 * never as "0.00", which would be a fabricated balance.
 */
export function BalanceValue<A extends string>({
  balance,
  unit,
  maxFractionDigits,
  masked,
  className = '',
  unitClassName = '',
  compact,
}: BalanceValueProps<A>) {
  const label = unit ?? balance.asset;
  if (masked) return <span className={className}>••••••</span>;

  switch (balance.status) {
    case 'disconnected':
      return <span className={`${className} opacity-60`}>—</span>;
    case 'unsupported_chain':
      return <span className={`${className} opacity-60`} title="Switch to a supported Mezo network">—</span>;
    case 'loading':
      return (
        <span className={`${className} inline-flex items-center gap-1.5 opacity-70`} aria-live="polite">
          <Loader2 className="w-[0.8em] h-[0.8em] animate-spin" aria-hidden="true" />
          {!compact && <span className="text-[0.6em] font-sans">Loading</span>}
          <span className="sr-only">Loading {label} balance</span>
        </span>
      );
    case 'error':
      return (
        <span className={`${className} inline-flex items-center gap-1 text-amber-700 dark:text-amber-400`} title={balance.error} role="status">
          <AlertTriangle className="w-[0.8em] h-[0.8em]" aria-hidden="true" />
          <span className={compact ? 'text-[0.75em]' : 'text-[0.55em] font-sans'}>Unavailable</span>
        </span>
      );
    case 'ready': {
      const digits = maxFractionDigits ?? (balance.asset === 'BTC' ? 6 : 2);
      return (
        <span className={className} title={balance.refreshError ? `Last refresh failed: ${balance.refreshError}` : undefined}>
          {formatTokenDisplay(balance.value, balance.decimals, { maxFractionDigits: digits, minFractionDigits: Math.min(2, digits) })}
          <span className={unitClassName}> {label}</span>
        </span>
      );
    }
  }
}
