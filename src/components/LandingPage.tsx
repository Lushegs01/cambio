import { ArrowRight } from 'lucide-react';
import { WalletState } from '../types';
import { shortenAddress } from '../utils/format';
import { ThemeToggle } from './ThemeToggle';
import { ParticleAmoeba } from './ParticleAmoeba';
import mockupImage from '@/mockup.png';
import logoImage from '@/logo.png';

interface LandingPageProps {
  wallet: WalletState;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onExplore: () => void;
  connectionError?: string | null;
  onDismissError?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  wallet,
  onConnectWallet,
  onDisconnectWallet,
  onExplore,
  connectionError,
  onDismissError,
}) => {
  return (
    <div className="relative min-h-screen lg:h-screen lg:max-h-screen lg:overflow-hidden bg-[#F5F5F3] dark:bg-[#0C0C0D] text-[#111111] dark:text-[#F5F5F7] flex flex-col justify-between antialiased selection:bg-[#111111] selection:text-white dark:selection:bg-white dark:selection:text-black transition-colors duration-200 overflow-x-hidden">
      {/* Bottom Left Corner Fluid Particle Orb Feature */}
      <div className="absolute bottom-0 left-0 w-72 h-72 sm:w-96 sm:h-96 md:w-[480px] md:h-[480px] lg:w-[560px] lg:h-[560px] -translate-x-12 translate-y-20 sm:-translate-x-16 sm:translate-y-28 lg:-translate-x-20 lg:translate-y-36 pointer-events-auto z-0 select-none">
        <ParticleAmoeba className="w-full h-full" />
      </div>
      {/* Top Editorial Navigation */}
      <header className="w-full shrink-0 border-b border-[#E2E2E0] dark:border-[#26262B] bg-[#FFFFFF]/80 dark:bg-[#111113]/80 backdrop-blur-md sticky top-0 z-40 transition-colors duration-200 animate-fade-in-down">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-18 lg:h-20 flex items-center justify-between">
          {/* Brand Mark */}
          <div className="flex items-center gap-3 select-none">
            <img
              src={logoImage}
              alt="Cambio Logo"
              className="w-[41.4px] h-[41.4px] object-contain dark:invert select-none"
            />

            <div className="flex flex-col">
              <span className="text-[16px] font-bold tracking-[0.12em] text-[#111111] dark:text-[#FFFFFF] uppercase leading-none font-sans">
                Cambio
              </span>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Quick dashboard entry in header */}
            <button
              onClick={onExplore}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-[#FFFFFF] dark:bg-[#141416] hover:bg-[#F0F0EE] dark:hover:bg-[#1E1E22] text-[#111111] dark:text-[#FFFFFF] transition-all duration-180 hover:border-[#111111] dark:hover:border-[#FFFFFF]"
            >
              <span>Dashboard</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area: Fits desktop viewport without vertical scrolling */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 pt-6 pb-0 lg:py-0 flex flex-col justify-center lg:justify-end min-h-0">
        {/* Optional Connection Error Banner */}
        {connectionError && (
          <div className="mb-4 lg:mb-6 p-4 rounded-xl bg-[#FFFBEB] dark:bg-[#2C210E] border border-[#FDE68A] dark:border-[#78350F] text-[#B45309] dark:text-[#FBBF24] text-xs flex items-center justify-between shrink-0">
            <span>{connectionError}</span>
            {onDismissError && (
              <button
                onClick={onDismissError}
                className="font-semibold underline ml-4 hover:opacity-80"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 xl:gap-14 items-center lg:items-end my-auto lg:my-0 lg:h-full lg:flex-1 w-full">
          {/* Left Column: Texts & Actions */}
          <div className="lg:col-span-7 flex flex-col justify-center space-y-5 lg:space-y-6 order-1 relative z-10 self-center my-auto">
            {/* Main Headline */}
            <div className="animate-fade-in-up">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-[54px] font-bold tracking-tight text-[#111111] dark:text-[#FFFFFF] leading-[1.09] font-sans">
                Money moves simpler.
                <br />
                <span className="text-[#777777] dark:text-[#A0A0A0]">
                  Mezo payments reimagined.
                </span>
              </h1>
            </div>

            {/* Supporting Description */}
            <p className="text-sm sm:text-base lg:text-lg text-black dark:text-[#A0A0A0] leading-relaxed font-sans max-w-xl animate-fade-in-up animation-delay-150">
              Meet a better way to move MUSD. Cambio brings sending, receiving, and payment tracking together in one clean, effortless interface built for Mezo.
            </p>

            {/* Both Call-To-Action Buttons */}
            <div className="pt-1 sm:pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 animate-fade-in-up animation-delay-300">
              {/* Primary CTA: Connect Wallet */}
              {wallet.isConnected ? (
                <button
                  onClick={onConnectWallet}
                  className="group inline-flex items-center justify-center px-6 py-3.5 lg:py-4 rounded-xl bg-[#111111] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold tracking-wide shadow-sm hover:bg-[#262626] dark:hover:bg-[#EAEAEA] hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/15 dark:hover:shadow-white/10 active:scale-[0.98] active:translate-y-0 transition-all duration-200 cursor-pointer"
                  aria-label="Manage Connected Wallet"
                >
                  <span>Connected · {shortenAddress(wallet.address)}</span>
                </button>
              ) : (
                <button
                  onClick={onConnectWallet}
                  className="group inline-flex items-center justify-center px-6 py-3.5 lg:py-4 rounded-xl bg-[#111111] text-[#FFFFFF] dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold tracking-wide shadow-sm hover:bg-[#262626] dark:hover:bg-[#EAEAEA] hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/15 dark:hover:shadow-white/10 active:scale-[0.98] active:translate-y-0 transition-all duration-200 cursor-pointer"
                  aria-label="Connect Wallet"
                >
                  <span>Connect Wallet</span>
                </button>
              )}

              {/* Secondary CTA: Explore Cambio */}
              <button
                onClick={onExplore}
                className="group inline-flex items-center justify-center gap-2.5 px-6 py-3.5 lg:py-4 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-[#FFFFFF] dark:bg-[#141416] hover:bg-[#F0F0EE] dark:hover:bg-[#1E1E22] hover:border-[#111111] dark:hover:border-[#FFFFFF] hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-md hover:shadow-black/5 dark:hover:shadow-black/30 text-[#111111] dark:text-[#FFFFFF] text-sm font-semibold tracking-wide active:scale-[0.98] active:translate-y-0 transition-all duration-200 shadow-xs cursor-pointer"
                aria-label="Explore Cambio Dashboard"
              >
                <span>Explore Cambio</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>

          {/* Right Column: Mockup Image */}
          <div className="lg:col-span-5 flex items-end justify-center lg:justify-end order-2 self-end pt-4 pb-0 lg:py-0">
            <div className="relative group w-full flex items-end justify-center lg:justify-end">
              {/* Subtle ambient blur glow matching theme */}
              <div className="absolute -inset-4 bg-gradient-to-tr from-[#E2E2E0] to-[#FFFFFF] dark:from-[#1E1E22] dark:to-[#111113] rounded-[48px] blur-2xl opacity-60 dark:opacity-40 pointer-events-none animate-glow-fade-in" />

              <img
                src={mockupImage}
                alt="Cambio Mobile App Mockup"
                className="relative z-10 w-auto max-w-[364px] sm:max-w-[416px] lg:max-w-[494px] max-h-[494px] sm:max-h-[572px] lg:max-h-[min(702px,calc(100vh-80px))] h-auto object-contain object-bottom drop-shadow-[0_20px_40px_rgba(0,0,0,0.14)] dark:drop-shadow-[0_25px_50px_rgba(0,0,0,0.55)] select-none transition-transform duration-300 hover:scale-[1.01] origin-bottom block mb-0 animate-slide-in-right"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
