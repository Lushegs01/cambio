import React, { useState } from 'react';
import { 
  Eye, 
  EyeOff, 
  Check,
  RefreshCw,
  LogOut,
  ExternalLink,
  Wallet,
  Sun,
  Moon,
  Laptop,
  Copy,
  AtSign,
  Coins,
  ChevronRight,
  Globe
} from 'lucide-react';
import { WalletState } from '../types';
import { getExplorerAddressUrl, shortenAddress } from '../utils/format';
import { MEZO_MAINNET, MEZO_TESTNET, explorerTokenUrl, getEnabledChains } from '../config/chains';
import { useTheme, ThemePreference } from '../context/ThemeContext';
import { useCurrency } from '../context/CurrencyContext';
import { HalftonePattern } from './HalftonePattern';
import { CurrencyModal } from './CurrencyModal';

interface SettingsViewProps {
  wallet: WalletState;
  isMasked: boolean;
  onToggleMask: () => void;
  onOpenNetworks: () => void;
  onDisconnectWallet: () => void;
  onConnectWallet: () => void;
  onResetSimulation: () => void;
  onOpenCreateUsername?: () => void;
  dataMode?: 'real' | 'demo';
  onToggleDataMode?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  wallet,
  isMasked,
  onToggleMask,
  onOpenNetworks,
  onDisconnectWallet,
  onConnectWallet,
  onResetSimulation,
  onOpenCreateUsername,
  dataMode = 'real',
  onToggleDataMode,
}) => {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const {
    preferredCurrency,
    activeCurrencyMeta,
    rateStatus,
    lastUpdated,
    rateSource,
    refreshRates,
    isRefreshing,
    errorMessage,
  } = useCurrency();
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);

  const formattedLastUpdated = lastUpdated
    ? Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000)) < 60
      ? `${Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000))}s ago`
      : `${Math.floor((Date.now() - lastUpdated) / 60000)}m ago`
    : 'Pending update';

  const handleCopyUsername = () => {
    if (wallet.username) {
      navigator.clipboard.writeText(`@${wallet.username}`);
      setCopiedUsername(true);
      setTimeout(() => setCopiedUsername(false), 2000);
    }
  };

  const themeOptions: { key: ThemePreference; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: 'light', label: 'Light', icon: <Sun className="w-4 h-4" />, desc: 'High-contrast paper & cream surfaces' },
    { key: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" />, desc: 'Deep obsidian & monochrome black' },
    { key: 'system', label: 'System', icon: <Laptop className="w-4 h-4" />, desc: 'Synchronizes with device OS' },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Username Profile Section (Section 7) */}
      <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-5 transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
        <HalftonePattern variant="corner" className="absolute right-0 top-0 w-36 h-36 opacity-10 dark:opacity-15 pointer-events-none" />

        <div className="relative z-10">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
            Cambio Identity
          </div>
          <h2 className="text-base sm:text-lg font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans mt-0.5">
            Username Profile
          </h2>
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
            Your unique username allows other users to send and request MUSD without needing to type long hex addresses.
          </p>
        </div>

        <div className="relative z-10">
          {wallet.isConnected ? (
            wallet.username ? (
              <div className="p-4 sm:p-5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0] block">
                      Registered Username
                    </span>
                    <span className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-[#111111] dark:text-[#FFFFFF] mt-0.5 block">
                      @{wallet.username}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyUsername}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#111111] dark:hover:border-[#FFFFFF] text-xs font-mono font-medium text-[#111111] dark:text-[#FFFFFF] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] transition-all cursor-pointer"
                    >
                      {copiedUsername ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#777777] dark:text-[#A0A0A0]" />
                          <span>Copy username</span>
                        </>
                      )}
                    </button>

                    {onOpenCreateUsername && (
                      <button
                        type="button"
                        onClick={onOpenCreateUsername}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#111111] hover:bg-[#262626] dark:bg-[#FFFFFF] dark:text-[#111111] dark:hover:bg-white/90 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
                      >
                        Change username
                      </button>
                    )}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[#E2E2E0] dark:border-[#26262B] flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs font-mono text-[#777777] dark:text-[#A0A0A0]">
                  <span>Linked Wallet:</span>
                  <span className="font-semibold text-[#111111] dark:text-[#FFFFFF] break-all">
                    {shortenAddress(wallet.address)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-4 sm:p-5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0] block">
                    No Username Claimed
                  </span>
                  <p className="text-xs text-[#555555] dark:text-[#A0A0A0] mt-0.5">
                    Create a username to send and receive MUSD easily.
                  </p>
                </div>
                {onOpenCreateUsername && (
                  <button
                    type="button"
                    onClick={onOpenCreateUsername}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#111111] hover:bg-[#262626] dark:bg-[#FFFFFF] dark:text-[#111111] dark:hover:bg-white/90 text-white text-xs font-semibold shadow-xs transition-all shrink-0 cursor-pointer"
                  >
                    Create username
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="p-4 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-xs text-[#777777] dark:text-[#A0A0A0]">
              Connect your wallet via WalletConnect to claim or manage your unique Cambio username.
            </div>
          )}
        </div>
      </div>



      {/* Appearance & Theme Section */}
      <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-5 transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
        <HalftonePattern variant="fade-right" className="absolute right-0 top-0 h-full w-40 opacity-10 dark:opacity-15 pointer-events-none" />

        <div className="relative z-10">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
            Display Configuration
          </div>
          <h2 className="text-base sm:text-lg font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans mt-0.5">
            Appearance
          </h2>
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
            Configure the visual aesthetic across monochromatic high-contrast themes.
          </p>
        </div>

        {/* 3-way Segmented Theme Cards */}
        <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {themeOptions.map((opt) => {
            const isSelected = theme === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTheme(opt.key)}
                className={`group p-4 rounded-2xl border text-left transition-all duration-150 relative ${
                  isSelected
                    ? 'bg-[#F0F0EE] dark:bg-[#1A1A1D] border-[#111111] dark:border-[#FFFFFF] shadow-xs'
                    : 'bg-white dark:bg-[#141416] border-[#E2E2E0] dark:border-[#26262B] hover:border-[#C8C8C5] dark:hover:border-[#3A3A40] hover:bg-[#F0F0EE]/60 dark:hover:bg-[#18181B]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`p-2 rounded-xl transition-all duration-150 ${
                    isSelected
                      ? 'bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111]'
                      : 'bg-[#F0F0EE] dark:bg-[#1E1E22] text-[#777777] dark:text-[#A0A0A0] group-hover:text-[#111111] dark:group-hover:text-[#FFFFFF]'
                  }`}>
                    {opt.icon}
                  </div>
                  {isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#111111] dark:bg-[#FFFFFF]" />
                  )}
                </div>
                <div className="font-bold text-xs uppercase tracking-wider font-mono text-[#111111] dark:text-[#FFFFFF]">
                  {opt.label}
                </div>
                <div className="text-[11px] text-[#777777] dark:text-[#A0A0A0] mt-1 leading-snug">
                  {opt.desc}
                </div>
              </button>
            );
          })}
        </div>

        <div className="relative z-10 text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0] flex items-center justify-between pt-1">
          <span>Active Interface</span>
          <span className="font-semibold text-[#111111] dark:text-[#FFFFFF]">
            {resolvedTheme} MODE {theme === 'system' && '(AUTOMATIC)'}
          </span>
        </div>
      </div>

      {/* Preferred Currency & Regional Valuation */}
      <div className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-5 transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
            Regional & Valuation
          </div>
          <h2 className="text-base sm:text-lg font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans mt-0.5">
            Currency Preferences
          </h2>
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
            Choose the fiat currency used to display estimated values for MUSD, BTC, and supported assets.
          </p>
        </div>

        {/* Currency Row */}
        <div className="divide-y divide-[#E2E2E0] dark:divide-[#26262B] text-xs">
          <button
            type="button"
            onClick={() => setIsCurrencyModalOpen(true)}
            className="w-full py-4 flex items-center justify-between text-left group hover:bg-[#F0F0EE]/50 dark:hover:bg-[#1A1A1D]/50 -mx-2 px-2 rounded-2xl transition-all cursor-pointer"
          >
            <div className="flex items-center gap-3.5 min-w-0 pr-4">
              <div className="w-10 h-10 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-center text-[#111111] dark:text-[#FFFFFF] group-hover:border-[#111111] dark:group-hover:border-[#FFFFFF] transition-colors shrink-0">
                <Coins className="w-5 h-5" />
              </div>
              <div className="truncate">
                <span className="font-bold text-[#111111] dark:text-[#FFFFFF] block font-sans text-sm">
                  Preferred currency
                </span>
                <span className="text-[#777777] dark:text-[#A0A0A0] text-xs mt-0.5 block truncate">
                  Display real-time fiat approximations alongside native token balances.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] group-hover:border-[#111111] dark:group-hover:border-[#FFFFFF] transition-all">
                <span className="text-base leading-none" aria-hidden="true">
                  {activeCurrencyMeta.flag}
                </span>
                <span className="font-bold font-mono text-xs text-[#111111] dark:text-[#FFFFFF]">
                  {activeCurrencyMeta.code}
                </span>
                <span className="text-[#777777] dark:text-[#A0A0A0] font-mono text-xs">
                  ({activeCurrencyMeta.symbol})
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-[#777777] dark:text-[#A0A0A0] group-hover:text-[#111111] dark:group-hover:text-[#FFFFFF] group-hover:translate-x-0.5 transition-all" />
            </div>
          </button>
        </div>

        {/* Live FX Rates Status Bar */}
        <div className="p-3.5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs font-mono">
          <div className="flex items-center gap-2 truncate">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                rateStatus === 'live'
                  ? 'bg-emerald-500'
                  : rateStatus === 'stale'
                  ? 'bg-amber-500'
                  : rateStatus === 'loading'
                  ? 'bg-blue-500 animate-pulse'
                  : 'bg-rose-500'
              }`}
            />
            <span className="text-[#777777] dark:text-[#A0A0A0] truncate text-[11px]">
              {rateStatus === 'live' && `Rates live · Updated ${formattedLastUpdated} via ${rateSource}`}
              {rateStatus === 'stale' && `Cached rates · Updated ${formattedLastUpdated}`}
              {rateStatus === 'loading' && 'Retrieving live FX exchange rates...'}
              {rateStatus === 'error' && (errorMessage || 'FX rate provider offline')}
            </span>
          </div>

          <button
            type="button"
            onClick={refreshRates}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416] hover:bg-[#EAEAEA] dark:hover:bg-[#202024] text-[#111111] dark:text-[#FFFFFF] text-[11px] font-medium transition-all duration-150 cursor-pointer self-start sm:self-auto disabled:opacity-50"
            title="Refresh foreign exchange rates"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Updating...' : 'Refresh Rates'}</span>
          </button>
        </div>
      </div>

      {/* WalletConnect & Session State */}
      <div className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-5 transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
              Connection Provider
            </div>
            <h2 className="text-base sm:text-lg font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans mt-0.5">
              Wallet Connection
            </h2>
            <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
              Authorizations governed via Reown AppKit & WalletConnect v2.
            </p>
          </div>

          {wallet.isConnected ? (
            <button
              onClick={onDisconnectWallet}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-[#F0F0EE] dark:bg-[#1A1A1D] hover:bg-[#111111] dark:hover:bg-[#FFFFFF] text-[#111111] dark:text-[#FFFFFF] hover:text-white dark:hover:text-[#111111] text-xs font-mono uppercase tracking-wider transition-all duration-150 self-start sm:self-auto"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              onClick={onConnectWallet}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#111111] hover:bg-[#262626] dark:bg-[#FFFFFF] dark:text-[#111111] dark:hover:bg-white/90 text-white text-xs font-mono font-bold uppercase tracking-wider transition-all duration-150 self-start sm:self-auto"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Connect Wallet</span>
            </button>
          )}
        </div>

        {wallet.isConnected ? (
          <div className="space-y-3 text-xs font-mono">
            <div className="p-3.5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-1.5">
              <div className="flex justify-between text-[#777777] dark:text-[#A0A0A0] text-[10px] uppercase tracking-wider">
                <span>Account Provider</span>
                <span className="font-semibold text-[#111111] dark:text-[#FFFFFF]">{wallet.walletName || 'WalletConnect'}</span>
              </div>
              <div className="text-xs text-[#111111] dark:text-[#FFFFFF] break-all">
                {wallet.address}
              </div>
              <div className="pt-1 flex items-center gap-2">
                <a
                  href={getExplorerAddressUrl(wallet.address, wallet.chainId) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-[#111111] dark:text-[#FFFFFF] hover:underline"
                >
                  <span>View in Block Explorer</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">Network Rail</span>
                  <button
                    onClick={onOpenNetworks}
                    className="text-[11px] font-bold text-[#111111] dark:text-[#FFFFFF] hover:underline flex items-center gap-1"
                  >
                    <span>Switch</span>
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
                <div className="font-bold text-[#111111] dark:text-[#FFFFFF] mt-1 flex items-center gap-1.5 uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#111111] dark:bg-[#FFFFFF]" />
                  <span>{wallet.networkName || 'Unknown Network'}</span>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B]">
                <span className="text-[10px] uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0] block">Chain ID</span>
                <span className="font-bold text-[#111111] dark:text-[#FFFFFF] mt-1 block">
                  {wallet.chainId ? `${wallet.chainId}` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-xs text-[#777777] dark:text-[#A0A0A0] space-y-1">
            <span className="font-bold text-[#111111] dark:text-[#FFFFFF] block font-mono text-[11px] uppercase tracking-wider">No Active Session</span>
            <p>
              Connect your wallet using mobile QR code scanning or your desktop browser extension to link your account.
            </p>
          </div>
        )}
      </div>

      {/* Network Specifications */}
      <div className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-5 transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
            Protocol Parameters
          </div>
          <h2 className="text-base sm:text-lg font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans mt-0.5">
            Mezo Specifications
          </h2>
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
            Default EVM network parameters for MUSD settlement.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
          {[MEZO_TESTNET, MEZO_MAINNET].map((c) => {
            const enabled = getEnabledChains().some((e) => e.chainId === c.chainId);
            return (
              <div key={c.chainId} className="p-3.5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">{c.name}</span>
                  <span className={`text-[10px] uppercase ${enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-[#777777]'}`}>{enabled ? 'Enabled' : 'Disabled in this build'}</span>
                </div>
                <span className="font-bold text-[#111111] dark:text-[#FFFFFF] block">
                  Chain {c.chainId} (0x{c.chainId.toString(16).toUpperCase()})
                </span>
                <span className="block text-[11px] text-[#555555] dark:text-[#A0A0A0] break-all">RPC: {c.rpcUrls[0]}</span>
                <a href={explorerTokenUrl(c, c.tokens.MUSD.address)} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-[#111111] dark:text-[#FFFFFF] hover:underline break-all">
                  MUSD: {c.tokens.MUSD.address}
                </a>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-[#777777] dark:text-[#A0A0A0]">
          Addresses verified against the official Mezo documentation and on-chain (token symbol and decimals). Native BTC pays network fees; MUSD is an ERC-20 token.
        </p>
      </div>

      {/* Privacy Preferences */}
      <div className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-5 transition-all duration-300 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
            Privacy & Masking
          </div>
          <h2 className="text-base sm:text-lg font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans mt-0.5">
            Display Preferences
          </h2>
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5">
            Configure balance obfuscation and numeric formatting.
          </p>
        </div>

        <div className="divide-y divide-[#E2E2E0] dark:divide-[#26262B] text-xs">
          <div className="py-3.5 flex items-center justify-between">
            <div>
              <span className="font-bold text-[#111111] dark:text-[#FFFFFF] block">
                Mask Balance by Default
              </span>
              <span className="text-[#777777] dark:text-[#A0A0A0] text-[11px]">
                Hides your total MUSD balance from view until toggled.
              </span>
            </div>
            <button
              onClick={onToggleMask}
              className={`p-2 rounded-xl border transition-all duration-150 ${
                isMasked
                  ? 'bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] border-[#111111] dark:border-[#FFFFFF]'
                  : 'bg-[#F0F0EE] dark:bg-[#1A1A1D] text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] border-[#E2E2E0] dark:border-[#26262B]'
              }`}
              aria-label="Toggle balance privacy"
            >
              {isMasked ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="py-3.5 flex items-center justify-between">
            <div>
              <span className="font-bold text-[#111111] dark:text-[#FFFFFF] block">
                Number Precision
              </span>
              <span className="text-[#777777] dark:text-[#A0A0A0] text-[11px]">
                Enforce standard two-decimal tabular financial formatting.
              </span>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[#111111] dark:text-[#FFFFFF] bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] px-2 py-0.5 rounded-md flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              <span>Enforced</span>
            </span>
          </div>
        </div>
      </div>



      {/* Demo mode */}
      <div className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs space-y-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">Data source</div>
          <h2 className="text-base sm:text-lg font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight mt-0.5">Demo mode</h2>
          <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-0.5 max-w-xl">
            Demo mode replaces your balances and history with simulated data so you can explore Cambio without a funded wallet.
            Nothing in demo mode is sent on-chain, and simulated records never appear in real history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={dataMode === 'demo'}
            onClick={onToggleDataMode}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border ${dataMode === 'demo' ? 'bg-violet-600 text-white border-violet-600' : 'bg-[#F0F0EE] dark:bg-[#1A1A1D] text-[#111111] dark:text-[#FFFFFF] border-[#E2E2E0] dark:border-[#26262B]'}`}
          >
            {dataMode === 'demo' ? 'Demo mode on — switch to real data' : 'Turn on demo mode'}
          </button>
          {dataMode === 'demo' && (
            <button type="button" onClick={onResetSimulation} className="px-4 py-2 rounded-xl text-xs font-semibold border border-[#E2E2E0] dark:border-[#26262B]">
              Reset demo data
            </button>
          )}
        </div>
      </div>

      <CurrencyModal
        isOpen={isCurrencyModalOpen}
        onClose={() => setIsCurrencyModalOpen(false)}
      />
    </div>
  );
};
