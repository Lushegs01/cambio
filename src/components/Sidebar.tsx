import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  Clock, 
  Settings, 
  Wallet, 
  X, 
  Loader2,
  QrCode,
  Bell,
  ArrowLeftRight
} from 'lucide-react';
import { NavItemKey, WalletState, NotificationItem } from '../types';
import { shortenAddress } from '../utils/format';
import { BalanceValue } from './BalanceValue';
import { toDisplayNumber } from '../lib/amounts';
import { HalftonePattern } from './HalftonePattern';
import { SendPlaneIcon } from './SendPlaneIcon';
import { ReceivePlaneIcon } from './ReceivePlaneIcon';
import logoImage from '@/logo.png';
import { useCurrency } from '../context/CurrencyContext';

interface SidebarProps {
  activeView: NavItemKey;
  onNavigate: (view: NavItemKey) => void;
  onNavigateHome?: () => void;
  wallet: WalletState;
  onConnectWallet: () => void;
  onDisconnectWallet?: () => void;
  onCloseMobile?: () => void;
  isMobile?: boolean;
  notifications?: NotificationItem[];
  onMarkNotificationsRead?: () => void;
  onOpenCreateUsername?: () => void;
  onOpenProfile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onNavigate,
  onNavigateHome,
  wallet,
  onConnectWallet,
  onDisconnectWallet,
  onCloseMobile,
  isMobile = false,
  notifications = [],
  onMarkNotificationsRead,
  onOpenCreateUsername,
  onOpenProfile,
}) => {
  const { formatTokenFiat } = useCurrency();
  const unreadCount = notifications.filter((n) => !n.read).length;

  const musd = wallet.balances.musd;
  const fiatEstimate = musd.status === 'ready' ? formatTokenFiat(toDisplayNumber(musd.value, musd.decimals), 'MUSD') : null;

  const navItems: { key: NavItemKey; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'send', label: 'Send MUSD', icon: <SendPlaneIcon className="w-4 h-4" /> },
    { key: 'receive', label: 'Receive MUSD', icon: <ReceivePlaneIcon className="w-4 h-4" /> },
    { key: 'request', label: 'Request', icon: <QrCode className="w-4 h-4" /> },
    { key: 'swap', label: 'Swap', icon: <ArrowLeftRight className="w-4 h-4" /> },
    { key: 'activity', label: 'Activity', icon: <Clock className="w-4 h-4" /> },
    { key: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
    { key: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <aside
      className={`relative flex flex-col h-full bg-[#FFFFFF] dark:bg-[#111113] border-r border-[#E2E2E0] dark:border-[#26262B] select-none transition-colors ${
        isMobile ? 'w-full' : 'w-64 shrink-0'
      }`}
    >
      {/* Brand Header */}
      <div className="relative flex items-center justify-between px-6 h-20 border-b border-[#E2E2E0] dark:border-[#26262B]">
        <div 
          onClick={() => {
            if (onNavigateHome) onNavigateHome();
            else onNavigate('overview');
          }}
          className="flex items-center gap-3 cursor-pointer group py-1 -my-1 rounded-xl transition-all duration-200"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && (onNavigateHome ? onNavigateHome() : onNavigate('overview'))}
          aria-label="Return to Cambio Home"
          title="Return to Landing Page"
        >
          {/* Brand Mark with logo.png */}
          <img
            src={logoImage}
            alt="Cambio Logo"
            className="w-9 h-9 object-contain dark:invert select-none transition-transform duration-200 group-hover:scale-105"
          />

          <div className="flex flex-col">
            <span className="text-[16px] font-bold tracking-[0.12em] text-[#111111] dark:text-[#FFFFFF] uppercase leading-none font-sans">
              Cambio
            </span>
          </div>
        </div>

        {isMobile && onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="p-2 -mr-2 text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] rounded-xl transition-all duration-200 hover:rotate-90"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Primary Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto" aria-label="Main Navigation">
        <div className="px-3 pb-2 text-xs font-sans font-medium uppercase tracking-wider text-[#A0A0A0] dark:text-[#707070]">
          Navigation
        </div>
        {navItems.map((item) => {
          const isActive = activeView === item.key;
          return (
            <button
              key={item.key}
              onClick={() => {
                onNavigate(item.key);
                if (isMobile && onCloseMobile) onCloseMobile();
              }}
              className={`group w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium font-sans transition-all duration-200 ease-out border cursor-pointer ${
                isActive
                  ? 'bg-[#111111] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#111111] border-[#111111] dark:border-[#FFFFFF] shadow-xs hover:shadow-sm hover:scale-[1.01] active:scale-[0.98]'
                  : 'text-[#777777] dark:text-[#A0A0A0] border-transparent hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#F0F0EE] dark:hover:bg-[#1A1A1D] hover:border-[#E2E2E0] dark:border-[#26262B] hover:translate-x-1 hover:shadow-xs active:scale-[0.98]'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className={`transition-all duration-200 group-hover:scale-110 group-hover:rotate-[-2deg] ${isActive ? 'text-white dark:text-[#111111]' : 'text-[#777777] dark:text-[#A0A0A0] group-hover:text-[#111111] dark:group-hover:text-[#FFFFFF]'}`}>
                {item.icon}
              </span>
              <span className="truncate tracking-tight transition-transform duration-200 group-hover:translate-x-0.5">{item.label}</span>
              {item.key === 'notifications' && unreadCount > 0 && (
                <span className={`ml-auto px-2 py-0.5 text-xs font-sans font-semibold rounded-full ${
                  isActive 
                    ? 'bg-white text-black dark:bg-black dark:text-white' 
                    : 'bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111]'
                }`}>
                  {unreadCount}
                </span>
              )}
            </button>
          );
        })}

        {onNavigateHome && (
          <div className="pt-2 border-t border-[#E2E2E0]/60 dark:border-[#26262B]/60 mt-3">
            <button
              onClick={() => {
                onNavigateHome();
                if (isMobile && onCloseMobile) onCloseMobile();
              }}
              className="group w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium font-sans text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#F0F0EE] dark:hover:bg-[#1A1A1D] border border-transparent hover:border-[#E2E2E0] dark:hover:border-[#26262B] hover:translate-x-1 hover:shadow-xs transition-all duration-200 ease-out cursor-pointer active:scale-[0.98]"
            >
              <span className="text-xs transition-transform duration-200 group-hover:-translate-x-1 font-mono">←</span>
              <span className="truncate tracking-tight transition-transform duration-200 group-hover:translate-x-0.5">Landing Page</span>
            </button>
          </div>
        )}
      </nav>

      {/* Network & Real Wallet Status Area */}
      <div className="p-4 border-t border-[#E2E2E0] dark:border-[#26262B] space-y-3 font-sans">
        {/* Network indicator with subtle halftone accent */}
        <div className="relative overflow-hidden px-3 py-2.5 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-between text-xs sm:text-sm transition-all duration-200 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40] cursor-default">
          <div className="relative z-10 flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full border border-black/10 dark:border-white/10 ${
                wallet.isConnected
                  ? wallet.isSupportedNetwork
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                  : 'bg-[#A0A0A0]'
              }`}
              aria-hidden="true"
            />
            <span className="font-semibold text-[#111111] dark:text-[#F5F5F7] tracking-tight truncate max-w-[120px]">
              {wallet.isConnected ? (wallet.isSupportedNetwork ? wallet.networkName : 'Unsupported network') : 'Not connected'}
            </span>
          </div>
          <HalftonePattern variant="fade-right" className="absolute right-0 top-0 h-full w-28 opacity-15 dark:opacity-20" />
        </div>

        {/* Real wallet status card at bottom */}
        {wallet.isConnected ? (
          <div 
            onClick={onOpenProfile}
            className={`p-3 rounded-xl bg-[#FFFFFF] dark:bg-[#161619] border border-[#E2E2E0] dark:border-[#26262B] space-y-2 transition-all duration-200 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40] ${onOpenProfile ? 'cursor-pointer hover:shadow-xs' : ''}`}
            title="Click to view full wallet profile and stats"
          >

            <div className="flex items-center justify-between text-xs sm:text-sm text-[#777777] dark:text-[#A0A0A0]">
              <span className="text-xs font-sans font-medium uppercase tracking-wider">Address</span>
              <span className="font-mono text-xs text-[#555555] dark:text-[#A0A0A0]">
                {shortenAddress(wallet.address)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs sm:text-sm pt-1.5 border-t border-[#E2E2E0]/80 dark:border-[#26262B]">
              <span className="text-xs font-sans font-medium uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
                {wallet.dataMode === 'demo' ? 'Demo MUSD' : 'MUSD'}
              </span>
              <div className="text-right">
                <BalanceValue balance={musd} compact className="font-semibold font-mono text-sm text-[#111111] dark:text-[#F5F5F7] tabular-nums block" />
                {fiatEstimate && (
                  <span className="text-[10px] font-mono text-[#777777] dark:text-[#A0A0A0] tabular-nums block">
                    ≈ {fiatEstimate.formatted}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : wallet.status === 'connecting' ? (
          <div className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-[#F0F0EE] dark:bg-[#1A1A1D] text-sm font-medium text-[#777777] dark:text-[#A0A0A0]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#111111] dark:text-[#FFFFFF]" />
            <span>Connecting...</span>
          </div>
        ) : (
          <button
            onClick={onConnectWallet}
            className="group w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#111111] dark:border-[#FFFFFF] bg-transparent hover:bg-[#111111] dark:hover:bg-[#FFFFFF] text-sm font-semibold text-[#111111] dark:text-[#FFFFFF] hover:text-white dark:hover:text-[#111111] hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-md hover:shadow-black/15 dark:hover:shadow-white/10 transition-all duration-200 ease-out active:scale-[0.98] active:translate-y-0 cursor-pointer font-sans"
          >
            <Wallet className="w-4 h-4 transition-transform duration-200 group-hover:scale-115 group-hover:rotate-[-6deg]" />
            <span className="tracking-tight">Connect Wallet</span>
          </button>
        )}

        <div className="text-xs font-sans uppercase tracking-wider text-center text-[#A0A0A0] dark:text-[#707070] pt-0.5">
          Non-custodial · Mezo
        </div>
      </div>
    </aside>
  );
};
