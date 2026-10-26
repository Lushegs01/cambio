/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  X, 
  Check, 
  Copy, 
  ExternalLink, 
  LogOut, 
  ShieldCheck, 
  ArrowRight
} from 'lucide-react';
import { WalletState } from '../types';
import { shortenAddress, getExplorerAddressUrl } from '../utils/format';
import { HalftonePattern } from './HalftonePattern';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: WalletState;
  dataMode: 'real' | 'demo';
  onToggleDataMode: () => void;
  onDisconnectWallet: () => void;
  onOpenNetworks: () => void;
  onOpenCreateUsername?: () => void;
  transactionCount?: number;
  paymentRequestCount?: number;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  wallet,
  dataMode,
  onToggleDataMode,
  onDisconnectWallet,
  onOpenNetworks,
  onOpenCreateUsername,
  transactionCount = 0,
  paymentRequestCount = 0,
}) => {
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedUsername, setCopiedUsername] = useState(false);

  if (!isOpen) return null;

  const handleCopyAddress = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wallet.address) {
      navigator.clipboard.writeText(wallet.address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const handleCopyUsername = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (wallet.username) {
      navigator.clipboard.writeText(`@${wallet.username}`);
      setCopiedUsername(true);
      setTimeout(() => setCopiedUsername(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:justify-end p-2 sm:p-4 md:p-6 overflow-y-auto">
      {/* Full Viewport Backdrop with Deep Blur */}
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/75 backdrop-blur-md transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Profile Card Dialog */}
      <div 
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        className="relative z-10 w-full max-w-sm sm:max-w-[400px] bg-white dark:bg-[#141416] rounded-3xl shadow-2xl border border-[#E2E2E0] dark:border-[#26262B] p-5 sm:p-6 space-y-4 sm:space-y-5 animate-in fade-in slide-in-from-right-6 duration-200 overflow-hidden"
      >
        {/* Subtle decorative Halftone Sphere watermark */}
        <div className="absolute -right-10 -bottom-10 w-52 h-52 pointer-events-none opacity-10 dark:opacity-15">
          <HalftonePattern variant="sphere" className="w-full h-full" />
        </div>

        {/* Top Header Row: Close Button */}
        <div className="relative z-10 flex items-center justify-end pb-1 border-b border-[#E2E2E0] dark:border-[#26262B]">
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[#777777] hover:text-[#111111] dark:text-[#A0A0A0] dark:hover:text-[#FFFFFF] bg-[#F0F0EE] dark:bg-[#1A1A1D] hover:bg-[#E2E2E0] dark:hover:bg-[#26262B] transition-all cursor-pointer"
            aria-label="Close profile modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Cambio Username Section */}
        <div className="relative z-10 p-4 sm:p-5 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
              Cambio Identity
            </span>
            {wallet.username ? (
              <span className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-emerald-600 dark:text-emerald-400 font-bold bg-emerald-500/10 dark:bg-emerald-500/20 px-2 py-0.5 rounded-md border border-emerald-500/20">
                <ShieldCheck className="w-3 h-3" />
                <span>Verified Owner</span>
              </span>
            ) : null}
          </div>

          {wallet.username ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="font-mono text-2xl font-bold tracking-tight text-[#111111] dark:text-[#FFFFFF] truncate">
                @{wallet.username}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyUsername}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#111111] dark:hover:border-[#FFFFFF] text-xs font-mono font-medium text-[#111111] dark:text-[#FFFFFF] transition-all cursor-pointer shadow-xs"
                  title="Copy username"
                >
                  {copiedUsername ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-[#777777] dark:text-[#A0A0A0]" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                {onOpenCreateUsername && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenCreateUsername();
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] text-xs font-mono font-semibold transition-all hover:bg-[#262626] dark:hover:bg-white/90 cursor-pointer shadow-xs"
                  >
                    <span>Change</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 pt-0.5">
              <div>
                <div className="font-mono text-base font-semibold text-[#111111] dark:text-[#FFFFFF]">
                  {shortenAddress(wallet.address)}
                </div>
                <p className="text-xs text-[#777777] dark:text-[#A0A0A0] mt-1 leading-relaxed">
                  Claim a unique @username to send and receive MUSD easily.
                </p>
              </div>

              {onOpenCreateUsername && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenCreateUsername();
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] text-xs font-mono font-semibold transition-all hover:bg-[#262626] dark:hover:bg-white/90 cursor-pointer shadow-xs whitespace-nowrap active:scale-[0.99]"
                  >
                    <span className="whitespace-nowrap">Choose your username</span>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>


        {/* Connected Wallet Address Block */}
        <div className="relative z-10 p-3.5 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">
            <span>Connected Address</span>
            <span>EVM Compatible</span>
          </div>

          <div className="font-mono text-xs text-[#111111] dark:text-[#FFFFFF] break-all bg-white dark:bg-[#141416] p-2.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B]">
            {wallet.address}
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={handleCopyAddress}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#111111] dark:hover:border-[#FFFFFF] text-xs font-mono font-medium text-[#111111] dark:text-[#FFFFFF] transition-all cursor-pointer shadow-xs"
            >
              {copiedAddress ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Address Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#777777] dark:text-[#A0A0A0]" />
                  <span>Copy Address</span>
                </>
              )}
            </button>

            <a
              href={getExplorerAddressUrl(wallet.address, wallet.chainId) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#111111] dark:hover:border-[#FFFFFF] text-xs font-mono font-medium text-[#111111] dark:text-[#FFFFFF] transition-all shadow-xs"
            >
              <span>Mezo Explorer</span>
              <ExternalLink className="w-3 h-3 text-[#777777] dark:text-[#A0A0A0]" />
            </a>
          </div>
        </div>

        {/* Footer: Disconnect Wallet */}
        <div className="relative z-10 pt-2 border-t border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              onClose();
              onDisconnectWallet();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-mono font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50 transition-all cursor-pointer active:scale-95"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Disconnect Wallet</span>
          </button>
        </div>
      </div>
    </div>
  );
};
