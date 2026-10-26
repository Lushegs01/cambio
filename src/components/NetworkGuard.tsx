import React, { useState } from 'react';
import { AlertTriangle, Loader2, Repeat } from 'lucide-react';
import { useSwitchChain } from 'wagmi';
import { getDefaultChain, getEnabledChains } from '../config/chains';
import type { WalletState } from '../types';
import { classifyTxError } from '../lib/txErrors';

interface NetworkGuardProps {
  wallet: WalletState;
  /** Shown before the switch button, e.g. "to send MUSD". */
  purpose?: string;
  className?: string;
}

/**
 * Shown whenever a wallet is connected to a network Cambio does not support. Offers a one-click switch
 * to the default (testnet) network through the wallet. Renders nothing on a supported network.
 */
export const NetworkGuard: React.FC<NetworkGuardProps> = ({ wallet, purpose, className = '' }) => {
  const { switchChainAsync } = useSwitchChain();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!wallet.isConnected || wallet.isSupportedNetwork) return null;
  const target = getDefaultChain();
  const supported = getEnabledChains().map((c) => c.name).join(' or ');

  const handleSwitch = async () => {
    setError(null);
    setSwitching(true);
    try {
      await switchChainAsync({ chainId: target.chainId });
    } catch (err) {
      const c = classifyTxError(err);
      setError(c.code === 'rejected' ? 'Network switch was declined in your wallet.' : 'Your wallet could not switch networks. Switch manually in the wallet.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div role="alert" className={`p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs space-y-2 ${className}`}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">Unsupported network{wallet.chainId ? ` (chain ${wallet.chainId})` : ''}</p>
          <p>
            Cambio works on {supported}. Switch networks {purpose ?? 'to continue'}. Balances and payments are hidden until you do.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleSwitch}
        disabled={switching}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-60 transition-colors"
      >
        {switching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Repeat className="w-3.5 h-3.5" />}
        <span>Switch to {target.name}</span>
      </button>
      {error && <p className="text-[11px]">{error}</p>}
    </div>
  );
};
