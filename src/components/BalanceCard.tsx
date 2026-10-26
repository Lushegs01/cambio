import React from 'react';
import { Eye, EyeOff, Wallet, Loader2, RefreshCw, ExternalLink, Fuel } from 'lucide-react';
import type { WalletState } from '../types';
import { shortenAddress } from '../utils/format';
import { HalftonePattern } from './HalftonePattern';
import { SendPlaneIcon } from './SendPlaneIcon';
import { ReceivePlaneIcon } from './ReceivePlaneIcon';
import { useCurrency } from '../context/CurrencyContext';
import { BalanceValue } from './BalanceValue';
import { NetworkGuard } from './NetworkGuard';
import { toDisplayNumber } from '../lib/amounts';
import { explorerTokenUrl } from '../config/chains';

interface BalanceCardProps {
  wallet: WalletState;
  isMasked: boolean;
  onToggleMask: () => void;
  onSend: () => void;
  onReceive: () => void;
  onConnectWallet: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const BalanceCard: React.FC<BalanceCardProps> = ({
  wallet,
  isMasked,
  onToggleMask,
  onSend,
  onReceive,
  onConnectWallet,
  onRefresh,
  isRefreshing,
}) => {
  const { preferredCurrency, formatTokenFiat, rateStatus } = useCurrency();
  const { musd, btc } = wallet.balances;
  const fiat = musd.status === 'ready' ? formatTokenFiat(toDisplayNumber(musd.value, musd.decimals), 'MUSD') : null;
  const chain = wallet.chain;
  const isDemo = wallet.dataMode === 'demo';
  const needsGas = !isDemo && btc.status === 'ready' && btc.value === 0n;

  return (
    <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-9 shadow-xs transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
      <div className="absolute -right-12 -top-12 w-64 h-64 sm:w-80 sm:h-80 pointer-events-none opacity-[0.14] dark:opacity-[0.18]">
        <HalftonePattern variant="sphere" className="w-full h-full" />
      </div>

      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-sans font-medium uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
            {isDemo ? 'Demo MUSD balance (simulated)' : 'MUSD balance'}
          </span>
          {chain && (
            <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border ${chain.isTestnet ? 'border-sky-500/30 text-sky-700 dark:text-sky-300 bg-sky-500/10' : 'border-red-500/30 text-red-700 dark:text-red-300 bg-red-500/10'}`}>
              {chain.isTestnet ? 'Testnet' : 'Mainnet · real funds'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {wallet.isConnected && onRefresh && !isDemo && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 text-[#777777] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-[#FFFFFF] rounded-xl hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] disabled:opacity-50"
              aria-label="Refresh balances"
              title="Refresh balances from the chain"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            onClick={onToggleMask}
            className="p-1.5 text-[#777777] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-[#FFFFFF] rounded-xl hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F]"
            aria-label={isMasked ? 'Reveal balance' : 'Hide balance'}
          >
            {isMasked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="relative z-10 mt-5 min-h-[88px]">
        <div className="flex items-baseline gap-2">
          <BalanceValue
            balance={musd}
            masked={isMasked}
            maxFractionDigits={2}
            className="text-5xl sm:text-6xl font-bold tracking-tight text-[#111111] dark:text-[#FFFFFF] font-mono tabular-nums leading-none"
            unitClassName="text-base sm:text-lg font-sans font-bold text-[#777777] dark:text-[#A0A0A0] ml-1 tracking-wider uppercase"
          />
        </div>
        {musd.status === 'ready' && !isMasked && (
          <div className="mt-2.5 flex items-center gap-1.5 text-xs sm:text-sm font-mono text-[#777777] dark:text-[#A0A0A0]">
            <span>≈</span>
            <span className="font-semibold text-[#111111] dark:text-[#FFFFFF] tabular-nums">{fiat ? fiat.formatted : 'Price unavailable'}</span>
            <span className="text-[10px] uppercase tracking-wider">{preferredCurrency}</span>
            {rateStatus === 'stale' && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-sans ml-1">(cached FX rate)</span>}
            {musd.refreshError && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-sans ml-1">(last refresh failed)</span>}
          </div>
        )}
        {musd.status === 'error' && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Could not read your MUSD balance from the network. It is not shown as zero because it is unknown. Try refreshing.</p>
        )}

        {/* Native BTC: a separate asset, used to pay network fees. */}
        {wallet.isConnected && wallet.isSupportedNetwork && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-xs font-mono text-[#555555] dark:text-[#A0A0A0]">
            <Fuel className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isDemo ? 'Demo BTC' : 'BTC for fees'}:</span>
            <BalanceValue balance={btc} masked={isMasked} compact className="font-semibold text-[#111111] dark:text-[#FFFFFF]" />
          </div>
        )}
        {needsGas && chain?.faucetUrl && (
          <p className="mt-2 text-xs text-[#555555] dark:text-[#A0A0A0]">
            You need a little testnet BTC to pay network fees.{' '}
            <a href={chain.faucetUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#315EF7] hover:underline inline-flex items-center gap-0.5">
              Get some from the Mezo faucet <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        )}
      </div>

      <NetworkGuard wallet={wallet} purpose="to see balances and send MUSD" className="relative z-10 mt-4" />

      <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[#777777] dark:text-[#A0A0A0] font-sans">
        <span className={`w-1.5 h-1.5 rounded-full ${wallet.isConnected ? 'bg-[#111111] dark:bg-[#FFFFFF]' : 'bg-[#A0A0A0]'}`} />
        {wallet.isConnected ? (
          <span>
            <strong className="text-[#111111] dark:text-[#FFFFFF] font-mono">{shortenAddress(wallet.address)}</strong>
            {chain && <> on {chain.name}</>}
            {chain && !isDemo && (
              <>
                {' · '}
                <a href={explorerTokenUrl(chain, chain.tokens.MUSD.address)} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
                  MUSD contract
                </a>
              </>
            )}
            {isDemo && ' · demo mode, simulated'}
          </span>
        ) : wallet.status === 'connecting' ? (
          <span className="flex items-center gap-1.5 text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#111111] dark:text-[#FFFFFF]" />
            Awaiting wallet approval…
          </span>
        ) : (
          <span className="text-xs">No wallet connected. Connect one to see your balance on Mezo.</span>
        )}
      </div>

      <div className="relative z-10 mt-8 pt-6 border-t border-[#E2E2E0] dark:border-[#26262B] flex flex-wrap items-center gap-3 sm:gap-4">
        <button
          onClick={onSend}
          className="group flex-1 min-w-[140px] flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-[#111111] dark:bg-[#FFFFFF] hover:bg-[#262626] dark:hover:bg-white/90 text-white dark:text-[#111111] text-sm font-semibold tracking-wide transition-all duration-200 shadow-xs active:scale-[0.98] cursor-pointer"
        >
          <SendPlaneIcon className="w-4 h-4" />
          <span>Send MUSD</span>
        </button>
        <button
          onClick={onReceive}
          className="group flex-1 min-w-[140px] flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1A1A1D] hover:bg-[#F0F0EE] dark:hover:bg-[#242428] text-[#111111] dark:text-[#FFFFFF] border border-[#E2E2E0] dark:border-[#26262B] text-sm font-semibold tracking-wide transition-all duration-200 shadow-xs active:scale-[0.98] cursor-pointer"
        >
          <ReceivePlaneIcon className="w-4 h-4" />
          <span>Receive</span>
        </button>
        {!wallet.isConnected && (
          <button
            onClick={onConnectWallet}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] hover:bg-[#E2E2E0] dark:hover:bg-[#26262B] text-[#111111] dark:text-[#FFFFFF] text-sm font-semibold border border-[#E2E2E0] dark:border-[#26262B] cursor-pointer"
          >
            <Wallet className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-semibold">Connect</span>
          </button>
        )}
      </div>
    </div>
  );
};
