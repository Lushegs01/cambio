/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppKit, useAppKitAccount, useDisconnect, useWalletInfo } from '@reown/appkit/react';
import { useConnection } from 'wagmi';
import { AlertTriangle } from 'lucide-react';
import type { NavItemKey, WalletState, NotificationItem, WalletConnectionStatus } from './types';
import { INITIAL_NOTIFICATIONS, DEMO_MUSD_BALANCE, DEMO_BTC_BALANCE, createDemoActivity } from './data/mockData';
import { shortenAddress } from './utils/format';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { BalanceCard } from './components/BalanceCard';
import { FirstTimeNotice } from './components/FirstTimeNotice';
import { RecentActivity } from './components/RecentActivity';
import { SendModal, type DemoSend } from './components/SendModal';
import { ReceiveModal } from './components/ReceiveModal';
import { ActivityView } from './components/ActivityView';
import { SettingsView } from './components/SettingsView';
import { RequestView } from './components/RequestView';
import { PaymentRequestPage } from './components/PaymentRequestPage';
import { NotificationsView } from './components/NotificationsView';
import { SwapView } from './components/SwapView';
import { LandingPage } from './components/LandingPage';
import { UsernameModal } from './components/UsernameModal';
import { ProfileModal } from './components/ProfileModal';
import { DemoBanner } from './components/DemoBanner';
import { getChainConfig } from './config/chains';
import { useWalletBalances } from './hooks/useWalletBalances';
import { useActivity } from './hooks/useActivity';
import { demoBalance, type WalletBalances } from './lib/balances';
import type { ActivityItem } from './lib/activity';
import type { TxPhase } from './lib/transactions';
import { formatTokenDisplay } from './lib/amounts';
import { parsePaymentLink, type ParsedPaymentLink } from './lib/paymentRequest';
import { getIdentityHealth, lookupAddress, type IdentityHealth } from './services/identityClient';

const VIEWS: NavItemKey[] = ['overview', 'activity', 'request', 'swap', 'notifications', 'settings'];

function routeFromLocation(): { route: 'landing' | 'app' | 'pay'; view: NavItemKey; link: ParsedPaymentLink | null } {
  const link = parsePaymentLink(window.location.href);
  if (link) return { route: 'pay', view: 'overview', link };
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const view = VIEWS.find((v) => path.includes(`/${v}`) || hash.includes(v)) ?? 'overview';
  if (path.startsWith('/app') || hash.includes('/app') || VIEWS.some((v) => hash.includes(v))) return { route: 'app', view, link: null };
  return { route: 'landing', view, link: null };
}

let notifSeq = 0;
const notif = (title: string, message: string, type: NotificationItem['type']): NotificationItem => ({
  id: `notif-${Date.now()}-${notifSeq++}`,
  title,
  message,
  timestamp: new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  read: false,
  type,
});

export default function App() {
  const { open } = useAppKit();
  const { status: appKitStatus } = useAppKitAccount();
  const connection = useConnection();
  const { disconnect } = useDisconnect();
  const { walletInfo } = useWalletInfo();

  const address = connection.address ?? null;
  const chainId = connection.chainId ?? null;
  const isConnected = connection.isConnected && !!address;
  const chain = getChainConfig(chainId);

  const initial = useMemo(routeFromLocation, []);
  const [currentRoute, setCurrentRoute] = useState(initial.route);
  const [activeView, setActiveView] = useState<NavItemKey>(initial.view);
  const [paymentLink, setPaymentLink] = useState<ParsedPaymentLink | null>(initial.link);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isBalanceMasked, setIsBalanceMasked] = useState(false);
  const [dataMode, setDataMode] = useState<'real' | 'demo'>('real');
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [activeModal, setActiveModal] = useState<'none' | 'send' | 'receive'>('none');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Identity
  const [identityHealth, setIdentityHealth] = useState<IdentityHealth | null>(null);
  const [connectedUsername, setConnectedUsername] = useState<string | null>(null);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const [usernameModalMode, setUsernameModalMode] = useState<'create' | 'change'>('create');

  // Real data: read from the chain.
  const real = useWalletBalances(address, chainId);
  const activity = useActivity(address, chain, dataMode === 'real' && isConnected);

  // Demo data: simulated, kept entirely separate.
  const [demoMusd, setDemoMusd] = useState<bigint>(DEMO_MUSD_BALANCE);
  const [demoActivity, setDemoActivity] = useState<ActivityItem[]>(createDemoActivity);

  const push = useCallback((n: NotificationItem) => setNotifications((prev) => [n, ...prev].slice(0, 50)), []);

  const balances: WalletBalances =
    dataMode === 'demo' && isConnected && chain
      ? { btc: demoBalance('BTC', DEMO_BTC_BALANCE), musd: demoBalance('MUSD', demoMusd) }
      : real.balances;

  const wallet: WalletState = {
    isConnected,
    status: (isConnected ? 'connected' : ((appKitStatus as WalletConnectionStatus) || 'disconnected')) as WalletConnectionStatus,
    address,
    walletName: walletInfo?.name && !/https?:|localhost|\.app/.test(walletInfo.name) ? walletInfo.name : isConnected ? 'Wallet' : null,
    chainId,
    networkName: chain?.name ?? (chainId ? `Chain ${chainId}` : null),
    chain,
    isSupportedNetwork: !!chain,
    balances,
    username: connectedUsername,
    dataMode,
  };

  // Identity service health, once.
  useEffect(() => {
    getIdentityHealth().then(setIdentityHealth);
  }, []);

  // Verified username for the connected wallet (reverse lookup through the API only).
  useEffect(() => {
    let cancelled = false;
    setConnectedUsername(null);
    if (!address) {
      setIsUsernameModalOpen(false);
      return;
    }
    lookupAddress(address)
      .then((rec) => {
        if (cancelled) return;
        setConnectedUsername(rec?.username ?? null);
        const dismissedKey = `cambio_username_prompt_dismissed_${address.toLowerCase()}`;
        let dismissed = false;
        try {
          dismissed = !!sessionStorage.getItem(dismissedKey);
        } catch {
          dismissed = true;
        }
        if (!rec && !dismissed && currentRoute === 'app') {
          setUsernameModalMode('create');
          setIsUsernameModalOpen(true);
        }
      })
      .catch(() => {
        // Identity service unavailable: no username is shown rather than a stale or guessed one.
        if (!cancelled) setConnectedUsername(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && address && d.walletAddress?.toLowerCase() === address.toLowerCase()) setConnectedUsername(d.username);
    };
    window.addEventListener('cambio_username_updated', onUpdated);
    return () => window.removeEventListener('cambio_username_updated', onUpdated);
  }, [address]);

  // Connection notifications.
  const prevConnected = useRef(false);
  useEffect(() => {
    if (isConnected && !prevConnected.current) {
      push(notif('Wallet connected', `${shortenAddress(address)} connected${chain ? ` on ${chain.name}` : ''}.`, 'wallet'));
    } else if (!isConnected && prevConnected.current) {
      push(notif('Wallet disconnected', 'Your wallet session ended.', 'wallet'));
      setActiveModal('none');
    }
    prevConnected.current = isConnected;
  }, [isConnected, address, chain, push]);

  // Wallet-provider rejections that escape as unhandled promises (e.g. "no accounts").
  useEffect(() => {
    const handle = (event: PromiseRejectionEvent) => {
      const r = event.reason;
      const msg = typeof r?.message === 'string' ? r.message : '';
      if (r?.code === 4001 || /user rejected|user denied/i.test(msg)) {
        event.preventDefault();
        return;
      }
      if (/at least one account|must has at least one account/i.test(msg)) {
        event.preventDefault();
        setConnectionError('Your wallet reported no available accounts. Unlock it or create an account, then connect again.');
      }
    };
    window.addEventListener('unhandledrejection', handle);
    return () => window.removeEventListener('unhandledrejection', handle);
  }, []);

  // Back/forward and in-page link navigation.
  useEffect(() => {
    const onNav = () => {
      const r = routeFromLocation();
      setCurrentRoute(r.route);
      setPaymentLink(r.link);
      if (r.route === 'app') setActiveView(r.view);
    };
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener('hashchange', onNav);
    };
  }, []);

  const handleOpenWalletModal = () => {
    setConnectionError(null);
    open().catch(() => undefined);
  };
  const handleOpenNetworksModal = () => {
    open({ view: 'Networks' }).catch(() => undefined);
  };
  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (err) {
      console.error('Failed to disconnect wallet:', err);
    }
  };

  const goApp = (view: NavItemKey = activeView) => {
    setCurrentRoute('app');
    setActiveView(view);
    setPaymentLink(null);
    try {
      window.history.pushState(null, '', view === 'overview' ? '/app' : `/app/${view}`);
    } catch {
      window.location.hash = '/app';
    }
  };
  const handleNavigateHome = () => {
    setCurrentRoute('landing');
    try {
      window.history.pushState(null, '', '/');
    } catch {
      window.location.hash = '/';
    }
  };
  const handleNavigate = (view: NavItemKey) => {
    if (view === 'send') setActiveModal('send');
    else if (view === 'receive') setActiveModal('receive');
    else goApp(view);
  };

  const handleToggleDataMode = () => {
    const next = dataMode === 'real' ? 'demo' : 'real';
    setDataMode(next);
    push(
      next === 'demo'
        ? notif('Demo mode on', 'Balances and history are now simulated. Nothing you do in demo mode is sent on-chain.', 'system')
        : notif('Real data', 'Showing on-chain balances and history for your wallet.', 'system')
    );
  };

  /** Real transfers: refresh chain state and notify only on outcomes the chain has decided. */
  const handleTransferSettled = useCallback(
    (phase: TxPhase, summary: { recipientLabel: string; amount: bigint }) => {
      const amt = `${formatTokenDisplay(summary.amount, 18)} MUSD`;
      if (phase.phase === 'confirmed') push(notif('Payment confirmed', `${amt} to ${summary.recipientLabel} was confirmed on-chain.`, 'payment'));
      else if (phase.phase === 'reverted') push(notif('Transfer reverted', `${amt} to ${summary.recipientLabel} failed on-chain. No MUSD moved.`, 'payment'));
      else if (phase.phase === 'unknown') push(notif('Transfer awaiting confirmation', `${amt} to ${summary.recipientLabel} was broadcast; its outcome is not confirmed yet.`, 'payment'));
      if (phase.phase === 'confirmed' || phase.phase === 'reverted' || phase.phase === 'unknown') {
        real.refetch();
        activity.refresh();
      }
    },
    [push, real, activity]
  );

  const handleDemoSend = (s: DemoSend) => {
    setDemoMusd((b) => (b >= s.amount ? b - s.amount : b));
    setDemoActivity((prev) => [
      {
        key: `demo-${Date.now()}`,
        mode: 'demo',
        kind: 'send',
        status: 'simulated',
        amount: s.amount,
        decimals: 18,
        symbol: 'MUSD',
        counterparty: s.recipient,
        counterpartyName: s.recipientLabel,
        hash: null,
        chainId: null,
        timestamp: Date.now(),
        memo: s.memo || undefined,
        source: 'demo',
      },
      ...prev,
    ]);
    push(notif('Simulated transfer (demo)', `${formatTokenDisplay(s.amount, 18)} MUSD to ${s.recipientLabel}. Nothing was sent on-chain.`, 'payment'));
  };

  const handleResetDemoData = () => {
    setDemoMusd(DEMO_MUSD_BALANCE);
    setDemoActivity(createDemoActivity());
  };

  const handleUsernameSuccess = (name: string) => {
    setConnectedUsername(name);
    if (address) {
      try {
        sessionStorage.setItem(`cambio_username_prompt_dismissed_${address.toLowerCase()}`, 'true');
      } catch {
        // ignore
      }
    }
    push(notif('Username verified', `@${name} is now linked to ${shortenAddress(address)}.`, 'wallet'));
  };
  const handleOpenUsernameModal = (mode?: 'create' | 'change') => {
    setUsernameModalMode(mode || (connectedUsername ? 'change' : 'create'));
    setIsUsernameModalOpen(true);
  };
  const handleCloseUsernameModal = () => {
    if (address) {
      try {
        sessionStorage.setItem(`cambio_username_prompt_dismissed_${address.toLowerCase()}`, 'true');
      } catch {
        // ignore
      }
    }
    setIsUsernameModalOpen(false);
  };

  const markAllRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  const transactions = dataMode === 'demo' ? demoActivity : activity.items;

  const sendModal = (
    <SendModal
      isOpen={activeModal === 'send'}
      onClose={() => setActiveModal('none')}
      wallet={wallet}
      onOpenConnectWallet={handleOpenWalletModal}
      onTransferSettled={handleTransferSettled}
      onDemoSend={handleDemoSend}
    />
  );

  if (currentRoute === 'pay' && paymentLink) {
    return (
      <PaymentRequestPage
        key={JSON.stringify(paymentLink)}
        link={paymentLink}
        wallet={wallet}
        onConnectWallet={handleOpenWalletModal}
        onGoToDashboard={() => goApp('overview')}
        onTransferSettled={handleTransferSettled}
      />
    );
  }

  if (currentRoute === 'landing') {
    return (
      <>
        <LandingPage
          wallet={wallet}
          onConnectWallet={handleOpenWalletModal}
          onDisconnectWallet={handleDisconnect}
          onExplore={() => goApp('overview')}
          connectionError={connectionError}
          onDismissError={() => setConnectionError(null)}
        />
        {sendModal}
        <ReceiveModal isOpen={activeModal === 'receive'} onClose={() => setActiveModal('none')} wallet={wallet} onOpenConnectWallet={handleOpenWalletModal} />
      </>
    );
  }

  const sidebarProps = {
    activeView,
    onNavigate: handleNavigate,
    wallet,
    notifications,
    onMarkNotificationsRead: markAllRead,
  };

  return (
    <div className="min-h-screen bg-[#F5F5F3] dark:bg-[#0C0C0D] text-[#111111] dark:text-[#F5F5F7] flex flex-col lg:flex-row antialiased font-sans transition-colors duration-200">
      <div className={`hidden lg:block h-screen sticky top-0 shrink-0 transition-all duration-300 ${isProfileModalOpen ? 'filter blur-[2px] pointer-events-none' : ''}`}>
        <Sidebar
          {...sidebarProps}
          onNavigateHome={handleNavigateHome}
          onConnectWallet={handleOpenWalletModal}
          onDisconnectWallet={handleDisconnect}
          onOpenCreateUsername={() => handleOpenUsernameModal()}
          onOpenProfile={() => setIsProfileModalOpen(true)}
        />
      </div>

      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex" role="dialog" aria-modal="true" aria-label="Navigation" onKeyDown={(e) => e.key === 'Escape' && setIsMobileMenuOpen(false)}>
          <div className="fixed inset-0 bg-black/40 dark:bg-black/75 backdrop-blur-xs" onClick={() => setIsMobileMenuOpen(false)} />
          <div className="relative w-4/5 max-w-xs bg-white dark:bg-[#111113] h-full z-10 shadow-2xl animate-in slide-in-from-left duration-200">
            <Sidebar
              {...sidebarProps}
              onNavigate={(v) => {
                setIsMobileMenuOpen(false);
                handleNavigate(v);
              }}
              onNavigateHome={() => {
                setIsMobileMenuOpen(false);
                handleNavigateHome();
              }}
              onConnectWallet={() => {
                setIsMobileMenuOpen(false);
                handleOpenWalletModal();
              }}
              onDisconnectWallet={() => {
                setIsMobileMenuOpen(false);
                handleDisconnect();
              }}
              onCloseMobile={() => setIsMobileMenuOpen(false)}
              isMobile
              onOpenCreateUsername={() => {
                setIsMobileMenuOpen(false);
                handleOpenUsernameModal();
              }}
              onOpenProfile={() => {
                setIsMobileMenuOpen(false);
                setIsProfileModalOpen(true);
              }}
            />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeView={activeView}
          wallet={wallet}
          onConnectWallet={handleOpenWalletModal}
          onDisconnectWallet={handleDisconnect}
          onOpenNetworks={handleOpenNetworksModal}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          notifications={notifications}
          onMarkNotificationsRead={markAllRead}
          onNavigateHome={handleNavigateHome}
          onNavigate={handleNavigate}
          onOpenCreateUsername={() => handleOpenUsernameModal()}
          dataMode={dataMode}
          onToggleDataMode={handleToggleDataMode}
          onOpenProfile={() => setIsProfileModalOpen(true)}
          isProfileOpen={isProfileModalOpen}
        />

        <main className={`flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-5xl w-full mx-auto space-y-6 sm:space-y-8 transition-all duration-300 ${isProfileModalOpen ? 'filter blur-[3px] pointer-events-none select-none' : ''}`}>
          {dataMode === 'demo' && <DemoBanner onExit={handleToggleDataMode} />}

          {connectionError && (
            <div role="alert" className="p-4 rounded-2xl bg-[#FFFBEB] dark:bg-[#2C210E] border border-[#FDE68A] dark:border-[#78350F] text-[#B45309] dark:text-[#FBBF24] text-xs flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{connectionError}</span>
              </div>
              <button onClick={() => setConnectionError(null)} className="text-[11px] font-semibold hover:underline py-1 px-2.5 rounded-lg shrink-0 ml-3">
                Dismiss
              </button>
            </div>
          )}

          {activeView === 'overview' && (
            <>
              {!wallet.isConnected && <FirstTimeNotice onConnectWallet={handleOpenWalletModal} status={wallet.status} />}
              <BalanceCard
                wallet={wallet}
                isMasked={isBalanceMasked}
                onToggleMask={() => setIsBalanceMasked(!isBalanceMasked)}
                onSend={() => setActiveModal('send')}
                onReceive={() => setActiveModal('receive')}
                onConnectWallet={handleOpenWalletModal}
                onRefresh={() => {
                  real.refetch();
                  activity.refresh();
                }}
                isRefreshing={real.isRefreshing}
              />
              {wallet.isConnected && (
                <RecentActivity
                  transactions={transactions}
                  loading={dataMode === 'real' && activity.loading}
                  coverage={dataMode === 'real' ? activity.coverage : 'Simulated demo records'}
                  onViewAll={() => goApp('activity')}
                  onSend={() => setActiveModal('send')}
                  onReceive={() => setActiveModal('receive')}
                />
              )}
            </>
          )}

          {activeView === 'activity' && (
            <ActivityView
              transactions={transactions}
              mode={dataMode}
              loading={dataMode === 'real' && activity.loading}
              coverage={dataMode === 'real' ? (wallet.isConnected ? activity.coverage : 'Connect a wallet to see its on-chain history.') : 'Simulated demo records — not on-chain.'}
              error={dataMode === 'real' ? activity.error : null}
              onRefresh={dataMode === 'real' && wallet.isConnected ? activity.refresh : undefined}
              onOpenSend={() => setActiveModal('send')}
              onOpenReceive={() => setActiveModal('receive')}
            />
          )}

          {activeView === 'swap' && (
            <SwapView
              wallet={wallet}
              onConnectWallet={handleOpenWalletModal}
              onSwapSettled={(phase, label) => {
                if (phase.phase === 'confirmed') push(notif('Swap confirmed', `${label} was confirmed on-chain.`, 'payment'));
                else if (phase.phase === 'reverted') push(notif('Swap reverted', `${label} failed on-chain.`, 'payment'));
                real.refetch();
                activity.refresh();
              }}
            />
          )}

          {activeView === 'request' && (
            <RequestView
              wallet={wallet}
              onConnectWallet={handleOpenWalletModal}
              onOpenPaymentRequestPage={(url) => {
                try {
                  window.history.pushState(null, '', url);
                } catch {
                  window.location.href = url;
                }
                setPaymentLink(parsePaymentLink(url));
                setCurrentRoute('pay');
              }}
            />
          )}

          {activeView === 'notifications' && (
            <NotificationsView
              notifications={notifications}
              onMarkAllRead={markAllRead}
              onClearAll={() => setNotifications([])}
              onMarkSingleRead={(id) => setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))}
              onNavigate={handleNavigate}
            />
          )}

          {activeView === 'settings' && (
            <SettingsView
              wallet={wallet}
              isMasked={isBalanceMasked}
              onToggleMask={() => setIsBalanceMasked(!isBalanceMasked)}
              onOpenNetworks={handleOpenNetworksModal}
              onDisconnectWallet={handleDisconnect}
              onConnectWallet={handleOpenWalletModal}
              onResetSimulation={handleResetDemoData}
              onOpenCreateUsername={() => handleOpenUsernameModal(connectedUsername ? 'change' : 'create')}
              dataMode={dataMode}
              onToggleDataMode={handleToggleDataMode}
            />
          )}
        </main>
      </div>

      {sendModal}
      <ReceiveModal
        isOpen={activeModal === 'receive'}
        onClose={() => setActiveModal('none')}
        wallet={wallet}
        onOpenConnectWallet={handleOpenWalletModal}
        onOpenCreateUsername={() => handleOpenUsernameModal('create')}
      />

      {wallet.address && (
        <UsernameModal
          key={wallet.address}
          isOpen={isUsernameModalOpen}
          onClose={handleCloseUsernameModal}
          walletAddress={wallet.address}
          chainId={chain?.chainId ?? null}
          currentUsername={connectedUsername}
          mode={usernameModalMode}
          identityHealth={identityHealth}
          onSuccess={handleUsernameSuccess}
        />
      )}

      {wallet.address && (
        <ProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
          wallet={wallet}
          dataMode={dataMode}
          onToggleDataMode={handleToggleDataMode}
          onDisconnectWallet={handleDisconnect}
          onOpenNetworks={handleOpenNetworksModal}
          onOpenCreateUsername={() => {
            setIsProfileModalOpen(false);
            handleOpenUsernameModal(connectedUsername ? 'change' : 'create');
          }}
          transactionCount={transactions.length}
        />
      )}
    </div>
  );
}
