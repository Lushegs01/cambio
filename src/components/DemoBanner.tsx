import React from 'react';
import { FlaskConical } from 'lucide-react';

/** Visible on every screen while demo mode is on. Demo state is simulated and never touches the chain. */
export const DemoBanner: React.FC<{ onExit?: () => void; className?: string }> = ({ onExit, className = '' }) => (
  <div
    role="status"
    className={`p-3 rounded-2xl bg-violet-500/10 border border-violet-500/30 text-violet-800 dark:text-violet-300 text-xs flex items-center justify-between gap-3 ${className}`}
  >
    <div className="flex items-center gap-2">
      <FlaskConical className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>
        <strong>Demo mode.</strong> Balances and transactions here are simulated. Nothing is sent on-chain, and none of it appears in your real history.
      </span>
    </div>
    {onExit && (
      <button type="button" onClick={onExit} className="shrink-0 font-semibold underline hover:no-underline">
        Use real data
      </button>
    )}
  </div>
);
