import React from 'react';
import { Wallet, ArrowRight, Loader2 } from 'lucide-react';
import { WalletConnectionStatus } from '../types';
import { HalftonePattern } from './HalftonePattern';

interface FirstTimeNoticeProps {
  onConnectWallet: () => void;
  status?: WalletConnectionStatus;
}

export const FirstTimeNotice: React.FC<FirstTimeNoticeProps> = ({ onConnectWallet, status }) => {
  const isConnecting = status === 'connecting';

  return (
    <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] hover:border-[#C8C8C5] dark:hover:border-[#3A3A40] rounded-2xl p-5 sm:p-6 transition-all duration-300 shadow-xs">
      {/* Background Halftone accent */}
      <HalftonePattern variant="fade-right" className="absolute -left-4 -bottom-6 w-56 h-28 opacity-10 dark:opacity-15 pointer-events-none" />

      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-center shrink-0 text-[#111111] dark:text-[#FFFFFF] transition-all duration-200 shadow-2xs">
            <Wallet className="w-5 h-5 text-[#111111] dark:text-[#FFFFFF]" />
          </div>
          <div>
            <div className="text-xs font-sans font-medium uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">
              WalletConnect Protocol
            </div>
            <h2 className="text-base font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight mt-0.5 font-sans">
              Connect your wallet to start transfers
            </h2>
            <p className="text-sm text-[#777777] dark:text-[#A0A0A0] mt-0.5 leading-relaxed font-sans">
              Scan from any mobile wallet or use your browser extension. This build runs on Mezo Testnet, so you can try every flow with free test funds from the{' '}
              <a href="https://faucet.test.mezo.org" target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                Mezo faucet
              </a>
              . No wallet yet? Turn on demo mode in Settings to explore with simulated data.
            </p>
          </div>
        </div>

        <button
          onClick={onConnectWallet}
          disabled={isConnecting}
          className="group inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] hover:bg-[#262626] dark:hover:bg-white/90 text-sm font-semibold text-white dark:text-[#111111] transition-all duration-200 shrink-0 shadow-xs hover:shadow-sm hover:scale-[1.01] active:scale-[0.98] disabled:opacity-50 cursor-pointer font-sans"
        >
          {isConnecting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-white dark:text-[#111111]" />
              <span className="font-sans text-xs font-semibold uppercase tracking-wider">Connecting...</span>
            </>
          ) : (
            <>
              <span className="font-sans text-xs uppercase tracking-wider font-semibold">Connect Wallet</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-1" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
