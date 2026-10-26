import React, { useState } from 'react';
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Trash2, 
  ArrowUpRight, 
  Wallet, 
  ShieldCheck, 
  Filter, 
  Clock,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { NotificationItem, NavItemKey } from '../types';
import { HalftonePattern } from './HalftonePattern';

interface NotificationsViewProps {
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
  onClearAll?: () => void;
  onMarkSingleRead?: (id: string) => void;
  onNavigate?: (view: NavItemKey) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  notifications,
  onMarkAllRead,
  onClearAll,
  onMarkSingleRead,
  onNavigate,
}) => {
  const [filter, setFilter] = useState<'all' | 'unread' | 'payment' | 'wallet' | 'system'>('all');

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredNotifications = notifications.filter((n) => {
    if (filter === 'unread') return !n.read;
    if (filter === 'payment') return n.type === 'payment';
    if (filter === 'wallet') return n.type === 'wallet';
    if (filter === 'system') return n.type === 'system';
    return true;
  });

  const getIconForType = (type: string) => {
    switch (type) {
      case 'payment':
        return <ArrowUpRight className="w-4 h-4 text-[#111111] dark:text-[#FFFFFF]" />;
      case 'wallet':
        return <Wallet className="w-4 h-4 text-[#111111] dark:text-[#FFFFFF]" />;
      case 'system':
      default:
        return <Bell className="w-4 h-4 text-[#111111] dark:text-[#FFFFFF]" />;
    }
  };

  const getBadgeForType = (type: string) => {
    switch (type) {
      case 'payment':
        return 'PAYMENT';
      case 'wallet':
        return 'WALLET';
      case 'system':
      default:
        return 'SYSTEM';
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#E2E2E0] dark:border-[#26262B]">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111111] dark:text-[#FFFFFF] font-sans">
              Notifications
            </h1>
            {unreadCount > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-xs font-mono font-semibold">
                {unreadCount} new
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-[#555555] dark:text-[#A0A0A0] font-sans">
            System alerts, wallet events, and transaction activity updates on Mezo.
          </p>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-2.5">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416] hover:bg-[#F0F0EE] dark:hover:bg-[#1E1E22] text-[#111111] dark:text-[#FFFFFF] transition-all duration-150 hover:border-[#111111] dark:hover:border-[#FFFFFF]"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all read</span>
            </button>
          )}

          {onClearAll && notifications.length > 0 && (
            <button
              onClick={onClearAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl border border-transparent hover:border-[#E2E2E0] dark:hover:border-[#26262B] text-[#777777] hover:text-red-600 dark:text-[#A0A0A0] dark:hover:text-red-400 hover:bg-[#F0F0EE] dark:hover:bg-[#1E1E22] transition-all duration-150"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {[
          { key: 'all', label: 'All', count: notifications.length },
          { key: 'unread', label: 'Unread', count: unreadCount },
          { key: 'payment', label: 'Payments', count: notifications.filter((n) => n.type === 'payment').length },
          { key: 'wallet', label: 'Wallet', count: notifications.filter((n) => n.type === 'wallet').length },
          { key: 'system', label: 'System', count: notifications.filter((n) => n.type === 'system').length },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key as any)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all duration-150 shrink-0 border ${
              filter === tab.key
                ? 'bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] border-[#111111] dark:border-[#FFFFFF] shadow-xs'
                : 'bg-white dark:bg-[#141416] text-[#777777] dark:text-[#A0A0A0] border-[#E2E2E0] dark:border-[#26262B] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]'
            }`}
          >
            <span>{tab.label}</span>
            <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-md ${
              filter === tab.key
                ? 'bg-white/20 dark:bg-black/20 text-white dark:text-[#111111]'
                : 'bg-[#F0F0EE] dark:bg-[#1A1A1D] text-[#777777] dark:text-[#A0A0A0]'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Notifications Feed */}
      {filteredNotifications.length > 0 ? (
        <div className="space-y-3">
          {filteredNotifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => onMarkSingleRead && onMarkSingleRead(notif.id)}
              className={`relative overflow-hidden group p-4 sm:p-5 rounded-2xl border transition-all duration-200 ${
                notif.read
                  ? 'bg-white dark:bg-[#141416] border-[#E2E2E0] dark:border-[#26262B] opacity-85 hover:opacity-100 hover:border-[#C8C8C5] dark:hover:border-[#3A3A40]'
                  : 'bg-[#FFFFFF] dark:bg-[#161619] border-[#111111]/30 dark:border-white/30 shadow-xs hover:border-[#111111] dark:hover:border-white'
              }`}
            >
              {/* Halftone ambient corner pattern */}
              <div className="absolute right-0 top-0 w-32 h-32 pointer-events-none opacity-5 dark:opacity-10">
                <HalftonePattern variant="corner" className="w-full h-full" />
              </div>

              <div className="relative z-10 flex items-start gap-3.5 sm:gap-4">
                {/* Icon Box */}
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                  notif.read
                    ? 'bg-[#F5F5F3] dark:bg-[#1A1A1D] border-[#E2E2E0] dark:border-[#26262B]'
                    : 'bg-[#F0F0EE] dark:bg-[#202024] border-[#111111]/20 dark:border-white/20'
                }`}>
                  {getIconForType(notif.type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm sm:text-base text-[#111111] dark:text-[#FFFFFF] tracking-tight">
                        {notif.title}
                      </span>
                      {!notif.read && (
                        <span className="w-2 h-2 rounded-full bg-[#111111] dark:bg-[#FFFFFF] animate-pulse" title="Unread" />
                      )}
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[10px] sm:text-[11px] text-[#777777] dark:text-[#A0A0A0]">
                      <span className="px-2 py-0.5 rounded-md bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] uppercase">
                        {getBadgeForType(notif.type)}
                      </span>
                      <span>{notif.timestamp}</span>
                    </div>
                  </div>

                  <p className="mt-1 text-xs sm:text-sm text-[#555555] dark:text-[#A0A0A0] leading-relaxed">
                    {notif.message}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="py-16 sm:py-24 text-center rounded-3xl border border-dashed border-[#E2E2E0] dark:border-[#26262B] bg-white/50 dark:bg-[#141416]/50 p-8 space-y-4">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-center text-[#777777] dark:text-[#A0A0A0]">
            <Bell className="w-6 h-6 opacity-60" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-[#111111] dark:text-[#FFFFFF]">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
            </h3>
            <p className="text-xs sm:text-sm text-[#777777] dark:text-[#A0A0A0] max-w-sm mx-auto">
              {filter === 'unread' 
                ? 'You are all caught up! There are no unread alerts at this time.' 
                : 'Activity, transfers, and wallet events will appear here in real time.'}
            </p>
          </div>

          {filter !== 'all' && (
            <button
              onClick={() => setFilter('all')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#111111] dark:text-[#FFFFFF] underline pt-2"
            >
              <span>View all notifications</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
