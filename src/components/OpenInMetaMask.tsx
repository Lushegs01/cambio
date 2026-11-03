import React from 'react';
import { ExternalLink } from 'lucide-react';
import { currentBrowserEnvironment, currentPageHref, openInMetaMaskHref } from '../lib/openInWallet';

interface OpenInMetaMaskProps {
  className?: string;
}

/**
 * Shown under Connect Wallet in phone browsers that have no wallet built in. Tapping it opens the current
 * page inside the MetaMask app, for when the WalletConnect hand-off from the browser does not open MetaMask
 * (see src/lib/openInWallet.ts). Renders nothing on desktops and inside wallet browsers.
 */
export const OpenInMetaMask: React.FC<OpenInMetaMaskProps> = ({ className = '' }) => {
  const href = openInMetaMaskHref(currentBrowserEnvironment(), currentPageHref());
  if (!href) return null;

  return (
    <div className={`flex flex-col items-stretch gap-1.5 ${className}`}>
      <a
        href={href}
        onClick={(e) => {
          // In-app navigation can change the address after render; link to the page the user is on now.
          const latest = openInMetaMaskHref(currentBrowserEnvironment(), currentPageHref());
          if (latest) e.currentTarget.href = latest;
        }}
        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-[#FFFFFF] dark:bg-[#141416] hover:bg-[#F0F0EE] dark:hover:bg-[#1E1E22] text-[#111111] dark:text-[#FFFFFF] text-sm font-semibold font-sans transition-colors duration-200"
      >
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
        <span>Open in MetaMask app</span>
      </a>
      <p className="text-[11px] leading-snug text-center text-[#777777] dark:text-[#A0A0A0] font-sans">
        Use this if MetaMask doesn't open from Connect Wallet. It opens Cambio inside the MetaMask app.
      </p>
    </div>
  );
};
