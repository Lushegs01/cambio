import React, { useState } from 'react';
import { 
  Menu, 
  Wallet, 
  Check, 
  Copy, 
  ExternalLink, 
  LogOut, 
  ChevronDown, 
  Loader2, 
  RefreshCw,
  Bell
} from 'lucide-react';
import { NavItemKey, WalletState, NotificationItem } from '../types';
import { shortenAddress, getExplorerAddressUrl } from '../utils/format';
import { ThemeToggle } from './ThemeToggle';
import { HalftonePattern } from './HalftonePattern';
import { useCurrency } from '../context/CurrencyContext';
import { BalanceValue } from './BalanceValue';
import { toDisplayNumber } from '../lib/amounts';

interface TopBarProps {
  activeView: NavItemKey;
  wallet: WalletState;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onOpenNetworks: () => void;
  onOpenMobileMenu: () => void;
  notifications: NotificationItem[];
  onMarkNotificationsRead: () => void;
  onNavigateHome?: () => void;
  onNavigate?: (view: NavItemKey) => void;
  onOpenCreateUsername?: () => void;
  dataMode?: 'real' | 'demo';
  onToggleDataMode?: () => void;
  onOpenProfile?: () => void;
  isProfileOpen?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
  wallet,
  onConnectWallet,
  onDisconnectWallet,
  onOpenNetworks,
  onOpenMobileMenu,
  notifications,
  onMarkNotificationsRead,
  onNavigateHome,
  onNavigate,
  onOpenCreateUsername,
  dataMode = 'real',
  onToggleDataMode,
  onOpenProfile,
  isProfileOpen = false,
}) => {
  const { formatTokenFiat } = useCurrency();
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);

  const musd = wallet.balances.musd;
  const fiatEstimate = musd.status === 'ready' ? formatTokenFiat(toDisplayNumber(musd.value, musd.decimals), 'MUSD') : null;

  const handleCopyUsername = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wallet.username) {
      navigator.clipboard.writeText(`@${wallet.username}`);
      setCopiedUsername(true);
      setTimeout(() => setCopiedUsername(false), 2000);
    }
  };

  const viewTitles: Record<NavItemKey, { title: string; subtitle: string }> = {
    overview: { title: 'Overview', subtitle: 'PORTFOLIO & TRANSFERS' },
    send: { title: 'Send MUSD', subtitle: 'DIRECT SETTLEMENT ON MEZO' },
    receive: { title: 'Receive MUSD', subtitle: 'ADDRESS & PAYMENT REQUESTS' },
    request: { title: 'Request MUSD', subtitle: 'SHAREABLE PAYMENT LINKS' },
    swap: { title: 'Swap Tokens', subtitle: 'EXCHANGE ASSETS ON MEZO' },
    activity: { title: 'Activity', subtitle: 'SETTLEMENT HISTORY' },
    notifications: { title: 'Notifications', subtitle: 'SYSTEM & PAYMENT UPDATES' },
    settings: { title: 'Settings', subtitle: 'SPECIFICATIONS & PREFERENCES' },
  };

  const currentMeta = viewTitles[activeView] || { title: 'Dashboard', subtitle: 'CAMBIO FINANCIAL' };

  const handleCopyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wallet.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-20 px-6 sm:px-8 bg-[#F5F5F3]/90 dark:bg-[#0C0C0D]/90 backdrop-blur-md border-b border-[#E2E2E0] dark:border-[#26262B] transition-colors">
      {/* Left: Mobile toggle & Editorial Title */}
      <div className="flex items-center gap-4">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 -ml-2 text-[#777777] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-[#FFFFFF] rounded-xl hover:bg-white dark:hover:bg-[#141416] border border-transparent hover:border-[#E2E2E0] dark:hover:border-[#26262B] transition-all duration-200"
          aria-label="Open sidebar menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex flex-col">
          <h1 className="font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight text-lg sm:text-xl font-sans leading-tight">
            {currentMeta.title}
          </h1>
        </div>
      </div>

      {/* Right: Controls & Wallet */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        {/* Network status pill */}
        {wallet.isConnected && (
          <button
            onClick={onOpenNetworks}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] text-xs font-medium text-[#111111] dark:text-[#F5F5F7] transition-all duration-150"
            title="Click to switch network"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${wallet.isSupportedNetwork ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className="font-mono text-[11px] uppercase tracking-wider">
              {wallet.isSupportedNetwork ? wallet.networkName : `Unsupported network${wallet.chainId ? ` (${wallet.chainId})` : ''}`}
            </span>
          </button>
        )}

        {/* Theme Toggle Button */}
        <ThemeToggle />

        {/* Wallet Connection Button / Dropdown */}
        {wallet.isConnected ? (
          <div className="relative">
            <button
              onClick={() => {
                if (onOpenProfile) {
                  onOpenProfile();
                } else {
                  setShowAccountDropdown(!showAccountDropdown);
                }
              }}
              className="group flex items-center gap-2 px-3 py-2 bg-white dark:bg-[#141416] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#C8C8C5] dark:hover:border-[#3A3A40] rounded-xl transition-all duration-150 shadow-xs text-xs font-semibold text-[#111111] dark:text-[#FFFFFF] cursor-pointer"
              aria-label="Connected wallet menu"
            >
              {wallet.username ? (
                <span className="font-mono text-xs font-bold text-[#111111] dark:text-[#FFFFFF]">
                  @{wallet.username}
                </span>
              ) : (
                <span className="font-mono text-xs tabular-nums">
                  {shortenAddress(wallet.address)}
                </span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 text-[#777777] dark:text-[#A0A0A0] transition-transform duration-200 ${isProfileOpen || showAccountDropdown ? 'rotate-180' : 'group-hover:translate-y-0.5'}`} />
            </button>

            {/* Account Popover Menu Backdrop Blur */}
            {showAccountDropdown && (
              <div 
                className="fixed inset-0 z-40 bg-black/40 dark:bg-black/60 backdrop-blur-md transition-opacity duration-200"
                onClick={() => setShowAccountDropdown(false)}
                aria-hidden="true"
              />
            )}

            {/* Account Popover Menu */}
            {showAccountDropdown && (
              <div className="absolute right-0 mt-2 w-80 bg-[#FFFFFF] dark:bg-[#141416] rounded-2xl shadow-xl border border-[#E2E2E0] dark:border-[#26262B] p-3.5 text-xs z-50 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                <div className="relative overflow-hidden p-3.5 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-3">
                  {/* Cambio Username Section (Section 3 & 7) */}
                  {wallet.username ? (
                    <div className="space-y-1.5 pb-2.5 border-b border-[#E2E2E0] dark:border-[#26262B]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
                          Cambio Username
                        </span>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          Verified
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-base font-bold text-[#111111] dark:text-[#FFFFFF] truncate">
                          @{wallet.username}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleCopyUsername}
                            className="p-1.5 rounded-lg bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] text-[#111111] dark:text-[#FFFFFF] hover:border-[#111111] dark:hover:border-[#FFFFFF] transition-all cursor-pointer"
                            title="Copy username"
                          >
                            {copiedUsername ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-[#777777] dark:text-[#A0A0A0]" />}
                          </button>
                          {onOpenCreateUsername && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowAccountDropdown(false);
                                onOpenCreateUsername();
                              }}
                              className="text-[10px] font-mono font-semibold text-[#111111] dark:text-[#FFFFFF] hover:underline px-1.5 py-1 cursor-pointer"
                            >
                              Change
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 pb-2.5 border-b border-[#E2E2E0] dark:border-[#26262B]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
                          Cambio Username
                        </span>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400 font-bold">
                          None Set
                        </span>
                      </div>
                      {onOpenCreateUsername && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowAccountDropdown(false);
                            onOpenCreateUsername();
                          }}
                          className="w-full py-1.5 px-2.5 rounded-lg bg-[#111111] hover:bg-[#262626] dark:bg-[#FFFFFF] dark:text-[#111111] dark:hover:bg-white/90 text-white text-[11px] font-mono font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <span>Choose your username</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Wallet details */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
                        Connected Wallet
                      </span>
                      <span className="text-[10px] font-mono text-[#777777] dark:text-[#A0A0A0]">
                        {shortenAddress(wallet.address)}
                      </span>
                    </div>
                    
                    {/* Full address */}
                    <div className="font-mono font-medium text-[#111111] dark:text-[#FFFFFF] break-all text-[11px] bg-white dark:bg-[#141416] p-2 rounded-lg border border-[#E2E2E0] dark:border-[#26262B]">
                      {wallet.address}
                    </div>

                    {/* Actions row: Copy & Explorer */}
                    <div className="pt-1 flex items-center gap-2">
                      <button
                        onClick={handleCopyAddress}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#111111] dark:hover:border-[#FFFFFF] text-[11px] font-medium text-[#111111] dark:text-[#FFFFFF] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] transition-all cursor-pointer"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3 h-3 text-[#111111] dark:text-[#FFFFFF]" />
                            <span className="font-mono">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-[#777777] dark:text-[#A0A0A0]" />
                            <span className="font-mono">Copy Address</span>
                          </>
                        )}
                      </button>

                      <a
                        href={getExplorerAddressUrl(wallet.address, wallet.chainId) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#111111] dark:hover:border-[#FFFFFF] text-[11px] font-mono text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] transition-all"
                      >
                        <span>Explorer</span>
                        <ExternalLink className="w-3 h-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </a>
                    </div>
                  </div>
                  <HalftonePattern variant="corner" className="absolute right-0 bottom-0 w-20 h-20 opacity-10 dark:opacity-15 pointer-events-none" />
                </div>

                {/* Network & demo details */}
                <div className="space-y-1.5 px-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">Network</span>
                    <button
                      onClick={() => {
                        setShowAccountDropdown(false);
                        onOpenNetworks();
                      }}
                      className="group flex items-center gap-1 font-mono font-medium text-[#111111] dark:text-[#FFFFFF] hover:underline transition-colors"
                    >
                      <span>{wallet.networkName || 'Mezo Network'}</span>
                      <RefreshCw className="w-3 h-3 transition-transform duration-300 group-hover:rotate-180" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
                      {wallet.dataMode === 'demo' ? 'Demo MUSD (simulated)' : 'MUSD Balance'}
                    </span>
                    <div className="text-right">
                      <BalanceValue balance={musd} compact className="font-mono font-semibold text-[#111111] dark:text-[#FFFFFF] tabular-nums block" />
                      {fiatEstimate && (
                        <span className="font-mono text-[10px] text-[#777777] dark:text-[#A0A0A0] tabular-nums block">
                          ≈ {fiatEstimate.formatted}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Disconnect Action */}
                <div className="pt-2 border-t border-[#E2E2E0] dark:border-[#26262B]">
                  <button
                    onClick={() => {
                      onDisconnectWallet();
                      setShowAccountDropdown(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-mono font-semibold text-[#777777] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-[#FFFFFF] hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all duration-150"
                  >
                    <LogOut className="w-3.5 h-3.5 transition-transform duration-150 hover:-translate-x-0.5" />
                    <span>Disconnect Wallet</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : wallet.status === 'connecting' ? (
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-xs cursor-wait"
          >
            <Loader2 className="w-4 h-4 animate-spin text-white dark:text-[#111111]" />
            <span className="whitespace-nowrap font-mono text-xs">CONNECTING...</span>
          </button>
        ) : (
          <button
            onClick={onConnectWallet}
            className="group flex items-center gap-2 px-4 py-2 bg-[#111111] dark:bg-[#FFFFFF] hover:bg-[#262626] dark:hover:bg-white/90 text-white dark:text-[#111111] rounded-xl text-xs sm:text-sm font-semibold transition-all duration-150 shadow-xs active:scale-[0.98]"
          >
            <Wallet className="w-4 h-4 transition-transform duration-200 group-hover:scale-110" />
            <span className="whitespace-nowrap font-mono tracking-tight text-xs uppercase">Connect Wallet</span>
          </button>
        )}
      </div>
    </header>
  );
};
