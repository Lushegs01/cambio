import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  AtSign,
  BadgeCheck,
  Bitcoin,
  Check,
  FileSignature,
  Plus,
  Send,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import { WalletState } from '../types';
import { shortenAddress } from '../utils/format';
import { ThemeToggle } from './ThemeToggle';
import { OpenInMetaMask } from './OpenInMetaMask';
import { GlassRibbons } from './landing/GlassRibbons';
import { GlassBubbles, GlassStar } from './landing/GlassShapes';
import { MEZO_TESTNET, explorerAddressUrl, explorerTxUrl } from '../config/chains';
import logoImage from '@/logo.png';

interface LandingPageProps {
  wallet: WalletState;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onExplore: () => void;
  connectionError?: string | null;
  onDismissError?: () => void;
}

const REPO_URL = 'https://github.com/Lushegs01/cambio';
/** The recorded signed-invoice settlement (README, "Verified on-chain evidence"). */
const PROOF_PATH = '/#proof/0x4AC25baC45C06362Cd1a90A61588dA73AB058f21/0x8cabe0bfc705e7808dcedb7a9ecaa594';

const EVIDENCE = [
  { label: 'MUSD transfer', detail: '10 MUSD · @solo → @lushegs', tx: '0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e' },
  { label: 'BTC → MUSD swap', detail: '0.01 BTC → 786.15 MUSD', tx: '0x4af2b0f08f7e7494dfda8e3dafb36c03316c9dcd616c9a26a5222d0f78a33f6e' },
  { label: 'Signed invoice settled', detail: '5 MUSD · @irebami → @cambomerchant', tx: '0x7256e1e29b05c2cfaa0784b4d11504d586590bc075df4eebee08bbcf99a35caa' },
];

const FEATURES = [
  { icon: FileSignature, title: 'Signed invoices', body: 'Every request is EIP-712 signed by your wallet. The payer’s browser checks the signature before it ever shows Pay.' },
  { icon: AtSign, title: 'Verified @usernames', body: 'Pay @lushegs, not a 42-character address. Names are bound to wallets by a server-verified Sign-In with Ethereum.' },
  { icon: Bitcoin, title: 'Fund & Pay with BTC', body: 'Short on MUSD? Cambio sizes a BTC → MUSD swap on Mezo for the exact shortfall, then returns to the same invoice.' },
  { icon: ShieldCheck, title: 'Public settlement proof', body: 'A proof page re-checks the signature, calldata, receipt and Transfer event in any browser, no wallet needed.' },
  { icon: Table2, title: 'Merchant invoice registry', body: 'Paid, pending, late and expired filters, search, CSV export and a proof link for every paid invoice.' },
  { icon: Send, title: 'Share anywhere', body: 'Copy, QR, WhatsApp, Telegram, email or an embeddable “Pay with Cambio” button, all carrying the exact signed link.' },
];

const STEPS = [
  { who: 'Merchant', title: 'Sign a request', body: 'Enter an amount and a note, then sign once. Signing is free and moves no funds.', points: ['EIP-712 typed data', 'Saved to your invoice registry'] },
  { who: 'Merchant', title: 'Share the link', body: 'Send it however your customer talks to you. The signature travels with the link.', points: ['QR, WhatsApp, Telegram, email', 'Embeddable pay button'] },
  { who: 'Customer', title: 'Open & verify', body: 'The page shows “Signed by the recipient’s wallet” and checks the request hasn’t been paid already.', points: ['Tamper-evident amount & payee', 'Double-pay protection'] },
  { who: 'Customer', title: 'Fund with BTC if short', body: 'See the exact BTC in, guaranteed MUSD out, fee, impact and the Mezo oracle price before you swap.', points: ['Exact approvals only', 'Mezo MUSD/BTC pool'] },
  { who: 'Customer', title: 'Confirm in wallet', body: 'A stepper walks Review → Connect → Fund → Confirm → Verify, and resumes after a refresh.', points: ['Request ID in calldata', 'Waits for the Transfer event'] },
  { who: 'Anyone', title: 'Check the proof', body: 'The merchant sees Paid · verified. Anyone can open the public proof page and watch every check pass.', points: ['No wallet required', 'Re-verified from the chain'] },
];

const FAQS = [
  { q: 'What is Cambio?', a: 'Cambio is a non-custodial MUSD payment app on Mezo. Merchants send invoices signed by their wallet, customers pay from any EVM wallet, and every payment ends with a settlement proof anyone can check against the chain.' },
  { q: 'Does Cambio ever hold my funds?', a: 'No. Payments go straight from the payer’s wallet to the merchant’s wallet. Cambio has no custom smart contracts; it composes Mezo’s own MUSD token, Router and pools.' },
  { q: 'What if the payer doesn’t have enough MUSD?', a: 'Fund & Pay quotes a BTC → MUSD swap on Mezo’s MUSD/BTC pool for exactly the shortfall, shows the guaranteed output and the Mezo oracle price, and then returns to the same invoice to pay it.' },
  { q: 'How can someone check that a payment really happened?', a: 'Each payment carries its request ID in the transaction calldata. The public proof page re-verifies the merchant’s signature, the calldata, the receipt and the MUSD Transfer event straight from the Mezo RPC.' },
  { q: 'Does Cambio take a fee?', a: 'No fee is taken from payments. Merchant Pro is an optional subscription (on testnet) paid from the merchant’s own wallet and verified on-chain.' },
  { q: 'Is Cambio live on mainnet?', a: 'Not yet. Cambio runs on Mezo Testnet (chain 31611). Mainnet is configured but disabled, and the app has not been audited.' },
];

/** Adds `is-visible` to `.landing-reveal` elements as they scroll into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const targets = Array.from(el.querySelectorAll<HTMLElement>('.landing-reveal'));
    if (typeof IntersectionObserver === 'undefined') {
      targets.forEach((t) => t.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [root]);
}

const PillButton: React.FC<{
  onClick?: () => void;
  href?: string;
  external?: boolean;
  variant?: 'dark' | 'outline';
  size?: 'sm' | 'lg';
  ariaLabel?: string;
  children: React.ReactNode;
}> = ({ onClick, href, external, variant = 'dark', size = 'lg', ariaLabel, children }) => {
  const dark = variant === 'dark';
  const pill = `${size === 'lg' ? 'h-12 px-6 text-[15px]' : 'h-9 px-4 text-[13px]'} inline-flex items-center rounded-full font-medium whitespace-nowrap transition-all duration-300 ${
    dark
      ? 'bg-[#16161D] text-white dark:bg-white dark:text-[#16161D] group-hover:bg-[#2A2A35] dark:group-hover:bg-[#EDEDF3]'
      : 'border border-[#16161D]/80 text-[#16161D] dark:border-white/70 dark:text-white group-hover:bg-[#16161D] group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-[#16161D]'
  }`;
  const circle = `${size === 'lg' ? 'w-12 h-12' : 'w-9 h-9'} inline-flex items-center justify-center rounded-full -ml-px transition-all duration-300 group-hover:rotate-45 ${
    dark
      ? 'bg-[#16161D] text-white dark:bg-white dark:text-[#16161D]'
      : 'border border-[#16161D]/80 text-[#16161D] dark:border-white/70 dark:text-white'
  }`;
  const inner = (
    <>
      <span className={pill}>{children}</span>
      <span className={circle}>
        <ArrowUpRight className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />
      </span>
    </>
  );
  const cls = 'group inline-flex items-center cursor-pointer active:scale-[0.98] transition-transform';
  if (href) {
    return (
      <a href={href} className={cls} aria-label={ariaLabel} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={ariaLabel}>
      {inner}
    </button>
  );
};

const SectionTag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#E6E8F2] dark:bg-white/10 text-[13px] text-[#3A3B48] dark:text-[#C9CAD6]">
    <span className="w-1.5 h-1.5 rounded-full landing-dot" />
    {children}
  </span>
);

const CONTRACTS = [
  { label: 'MUSD token', address: MEZO_TESTNET.tokens.MUSD.address },
  { label: 'Router', address: MEZO_TESTNET.router },
  { label: 'MUSD/BTC pool', address: MEZO_TESTNET.pools[0].address },
  { label: 'PriceFeed', address: MEZO_TESTNET.musdProtocol.priceFeed },
  { label: 'TroveManager', address: MEZO_TESTNET.musdProtocol.troveManager },
];

type NetworkTab = 'network' | 'contracts' | 'evidence';

const NetworkPanel: React.FC<{ onExplore: () => void }> = ({ onExplore }) => {
  const [tab, setTab] = useState<NetworkTab>('network');
  const tabs: { key: NetworkTab; label: string }[] = [
    { key: 'network', label: 'Network' },
    { key: 'contracts', label: 'Contracts' },
    { key: 'evidence', label: 'Evidence' },
  ];
  const row = 'flex items-center justify-between gap-4 py-2.5 text-[13px] sm:text-sm';
  const k = 'text-[#5A5B68] dark:text-[#9C9DAB]';
  const v = 'text-[#16161D] dark:text-white font-medium text-right tabular-nums';

  return (
    <div className="landing-glass rounded-[24px] p-3 sm:p-4 w-full max-w-md mx-auto">
      <div role="tablist" aria-label="Cambio on Mezo" className="grid grid-cols-3 gap-1 p-1 rounded-full border border-[#16161D]/10 dark:border-white/10 bg-white/50 dark:bg-white/5">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`net-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`net-panel-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`h-9 rounded-full text-[13px] transition-all duration-300 ${
              tab === t.key ? 'bg-[#16161D] text-white dark:bg-white dark:text-[#16161D] shadow-sm' : 'text-[#3A3B48] dark:text-[#C9CAD6] hover:bg-white/70 dark:hover:bg-white/10'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`net-panel-${tab}`} aria-labelledby={`net-tab-${tab}`} className="px-3 sm:px-4 pt-4 pb-2 min-h-[230px]">
        {tab === 'network' && (
          <div className="divide-y divide-[#16161D]/6 dark:divide-white/6">
            <div className={row}><span className={k}>Network</span><span className={v}>{MEZO_TESTNET.name}</span></div>
            <div className={row}><span className={k}>Chain ID</span><span className={v}>{MEZO_TESTNET.chainId}</span></div>
            <div className={row}><span className={k}>Settlement token</span><span className={v}>MUSD · Mezo USD</span></div>
            <div className={row}><span className={k}>Custody</span><span className={v}>Non-custodial</span></div>
            <div className={row}><span className={k}>Fee on payments</span><span className={v}>None</span></div>
          </div>
        )}
        {tab === 'contracts' && (
          <div className="divide-y divide-[#16161D]/6 dark:divide-white/6">
            {CONTRACTS.map((c) => (
              <div key={c.label} className={row}>
                <span className={k}>{c.label}</span>
                <a href={explorerAddressUrl(MEZO_TESTNET, c.address)} target="_blank" rel="noopener noreferrer" className={`${v} font-mono text-[12px] sm:text-[13px] hover:underline underline-offset-4 inline-flex items-center gap-1`}>
                  {shortenAddress(c.address)}
                  <ArrowUpRight className="w-3 h-3 opacity-60" />
                </a>
              </div>
            ))}
          </div>
        )}
        {tab === 'evidence' && (
          <div className="divide-y divide-[#16161D]/6 dark:divide-white/6">
            {EVIDENCE.map((e) => (
              <a key={e.tx} href={explorerTxUrl(MEZO_TESTNET, e.tx)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-3 py-3 group/ev">
                <span className="min-w-0">
                  <span className="block text-sm text-[#16161D] dark:text-white font-medium">{e.label}</span>
                  <span className="block text-xs text-[#5A5B68] dark:text-[#9C9DAB] truncate">{e.detail}</span>
                </span>
                <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
                  <Check className="w-3 h-3" /> PASS
                </span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="px-2 pb-2 pt-2">
        {tab === 'evidence' ? (
          <a href={PROOF_PATH} className="flex items-center justify-center w-full h-11 rounded-full bg-[#16161D] text-white dark:bg-white dark:text-[#16161D] text-sm font-medium hover:opacity-90 transition-opacity">
            Open the public proof page
          </a>
        ) : tab === 'contracts' ? (
          <a href={`${REPO_URL}/blob/main/src/config/chains.ts`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-full h-11 rounded-full bg-[#16161D] text-white dark:bg-white dark:text-[#16161D] text-sm font-medium hover:opacity-90 transition-opacity">
            See every address in the source
          </a>
        ) : (
          <button onClick={onExplore} className="flex items-center justify-center w-full h-11 rounded-full bg-[#16161D] text-white dark:bg-white dark:text-[#16161D] text-sm font-medium hover:opacity-90 transition-opacity">
            Open the Cambio dashboard
          </button>
        )}
        <p className="mt-3 text-center text-[11px] text-[#7A7B88] dark:text-[#7E7F8C]">Addresses verified on-chain with <code>npm run verify:chain</code></p>
      </div>
    </div>
  );
};

const InvoicePreview: React.FC = () => (
  <div className="relative w-full max-w-[460px] mx-auto h-[540px]">
    {/* Back card: settlement proof */}
    <div className="absolute left-0 top-0 w-[80%] landing-glass rounded-[22px] p-5 sm:p-6 rotate-[-3deg]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[#7A7B88] dark:text-[#8D8E9C]">Settlement proof</p>
      <p className="mt-1 font-display text-2xl text-[#16161D] dark:text-white">Paid · verified</p>
      <ul className="mt-4 space-y-2.5">
        {['Merchant signature', 'Request ID in calldata', 'Transaction receipt', 'MUSD Transfer event'].map((c) => (
          <li key={c} className="flex items-center gap-2.5 text-[13px] text-[#3A3B48] dark:text-[#C9CAD6]">
            <span className="w-5 h-5 rounded-full landing-iridescent flex items-center justify-center shrink-0">
              <Check className="w-3 h-3 text-white" strokeWidth={3} />
            </span>
            {c}
          </li>
        ))}
      </ul>
    </div>

    {/* Front card: the invoice */}
    <div className="absolute right-0 bottom-0 w-[82%] landing-glass rounded-[22px] p-5 sm:p-6 rotate-[2deg] !bg-white/85 dark:!bg-[#181824]/85">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.14em] text-[#7A7B88] dark:text-[#8D8E9C]">Payment request</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
          <BadgeCheck className="w-3.5 h-3.5" /> Signed
        </span>
      </div>
      <p className="mt-3 font-display text-[40px] leading-none tracking-tight text-[#16161D] dark:text-white tabular-nums">
        250.00 <span className="text-xl text-[#7A7B88] dark:text-[#8D8E9C]">MUSD</span>
      </p>
      <p className="mt-2 text-[13px] text-[#5A5B68] dark:text-[#9C9DAB]">to <span className="text-[#16161D] dark:text-white font-medium">@studio.nia</span> · Logo design, invoice #014</p>
      <div className="mt-5 rounded-2xl bg-[#F3F4FA] dark:bg-white/5 p-3.5 text-[12px] text-[#5A5B68] dark:text-[#9C9DAB] flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-[#5B6CF5] shrink-0 mt-px" />
        Signed by the recipient’s wallet. Amount and payee can’t be changed without breaking the signature.
      </div>
      <div className="mt-4 h-11 rounded-full bg-[#16161D] dark:bg-white text-white dark:text-[#16161D] text-sm font-medium flex items-center justify-center">
        Pay 250.00 MUSD
      </div>
    </div>
    <p className="sr-only">Illustration of a signed Cambio payment request and its settlement proof. Example values.</p>
  </div>
);

const FaqItem: React.FC<{ q: string; a: string; id: string }> = ({ q, a, id }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#16161D]/25 dark:border-white/15">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-btn`}
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-6 py-5 sm:py-6 text-left font-display text-lg sm:text-[22px] text-[#16161D] dark:text-white hover:opacity-80"
        >
          {q}
          <Plus className={`w-5 h-5 shrink-0 transition-transform duration-300 ${open ? 'rotate-45' : ''}`} strokeWidth={1.5} />
        </button>
      </h3>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-btn`}
        className={`grid transition-all duration-400 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <p className="pb-6 pr-10 text-[15px] leading-relaxed text-[#4A4B58] dark:text-[#A9AAB8] max-w-3xl">{a}</p>
        </div>
      </div>
    </div>
  );
};

export const LandingPage: React.FC<LandingPageProps> = ({
  wallet,
  onConnectWallet,
  onExplore,
  connectionError,
  onDismissError,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const nav = [
    { id: 'features', label: 'Features' },
    { id: 'how-it-works', label: 'How it works' },
    { id: 'on-mezo', label: 'On Mezo' },
    { id: 'faq', label: 'FAQ' },
  ];

  const walletCta = wallet.isConnected ? (
    <PillButton onClick={onConnectWallet} ariaLabel="Manage Connected Wallet">
      Connected · {shortenAddress(wallet.address)}
    </PillButton>
  ) : (
    <PillButton onClick={onConnectWallet} ariaLabel="Connect Wallet">
      Connect Wallet
    </PillButton>
  );

  return (
    <div ref={rootRef} className="relative min-h-screen bg-[#F6F7FB] dark:bg-[#09090E] text-[#16161D] dark:text-[#F3F3F7] antialiased overflow-x-hidden selection:bg-[#8E8CFF]/30">
      {/* ---------------- Hero ---------------- */}
      <div className="p-2 sm:p-3">
        <section className="landing-mesh relative rounded-[24px] sm:rounded-[32px] overflow-hidden min-h-[700px] sm:min-h-[820px] lg:min-h-[920px] flex flex-col">
          <header className="relative z-20 animate-fade-in-down">
            <div className="max-w-7xl mx-auto px-5 sm:px-10 h-20 sm:h-24 flex items-center justify-between gap-4">
              <a href="/" className="flex items-center gap-2.5 select-none" aria-label="Cambio home">
                <img src={logoImage} alt="" className="w-9 h-9 object-contain dark:invert" />
                <span className="font-display text-[26px] font-medium tracking-tight leading-none">cambio</span>
              </a>

              <nav aria-label="Landing sections" className="hidden md:flex items-center gap-8 text-sm text-[#2A2B36] dark:text-[#D4D5E0]">
                {nav.map((n) => (
                  <button key={n.id} onClick={() => scrollTo(n.id)} className="relative hover:text-black dark:hover:text-white after:absolute after:left-0 after:-bottom-1 after:h-px after:w-0 after:bg-current after:transition-all hover:after:w-full">
                    {n.label}
                  </button>
                ))}
              </nav>

              <div className="flex items-center gap-2 sm:gap-3">
                <ThemeToggle className="!rounded-full !bg-white/60 dark:!bg-white/10 !border-white/70 dark:!border-white/10 backdrop-blur" />
                <span className="hidden sm:inline-flex">
                  <PillButton variant="outline" size="sm" onClick={onExplore} ariaLabel="Launch app">
                    Launch app
                  </PillButton>
                </span>
              </div>
            </div>
          </header>

          <div className="relative z-10 flex-1 flex flex-col items-center text-center px-5 pt-6 sm:pt-12">
            {connectionError && (
              <div role="alert" className="mb-6 max-w-xl w-full p-3.5 rounded-2xl bg-[#FFFBEB]/90 dark:bg-[#2C210E]/90 border border-[#FDE68A] dark:border-[#78350F] text-[#B45309] dark:text-[#FBBF24] text-xs flex items-center justify-between text-left">
                <span>{connectionError}</span>
                {onDismissError && (
                  <button onClick={onDismissError} className="font-semibold underline ml-4 hover:opacity-80">
                    Dismiss
                  </button>
                )}
              </div>
            )}

            <span className="animate-fade-in-up inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/55 dark:bg-white/10 border border-white/80 dark:border-white/10 backdrop-blur text-[12px] sm:text-[13px] text-[#2A2B36] dark:text-[#D4D5E0]">
              <span className="relative flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
                <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
              </span>
              Live on Mezo Testnet · non-custodial
            </span>

            <h1 className="animate-fade-in-up animation-delay-100 mt-6 font-display font-normal tracking-[-0.035em] leading-[1.02] text-[38px] sm:text-[72px] lg:text-[92px] max-w-5xl">
              Get paid in MUSD.
              <br />
              Prove it on-chain.
            </h1>

            <p className="animate-fade-in-up animation-delay-200 mt-6 max-w-xl text-[15px] sm:text-[17px] leading-relaxed text-[#2E2F3A] dark:text-[#C3C4D0]">
              Send an invoice signed by your wallet. Your customer pays from any EVM wallet, swapping BTC for MUSD on Mezo if they’re short, and you get a settlement proof anyone can check.
            </p>

            <div className="animate-fade-in-up animation-delay-300 mt-9 flex flex-col sm:flex-row items-center gap-3 sm:gap-5">
              {walletCta}
              <button onClick={onExplore} className="group inline-flex items-center gap-1.5 h-12 px-3 text-[15px] font-medium text-[#16161D] dark:text-white" aria-label="Explore Cambio Dashboard">
                <span className="border-b border-current/40 group-hover:border-current transition-colors">Explore Cambio</span>
                <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
            </div>
            {!wallet.isConnected && <OpenInMetaMask className="mt-4 max-w-sm animate-fade-in-up animation-delay-300" />}
          </div>

          {/* Glass hoops rise out of the bottom edge */}
          <GlassRibbons className="pointer-events-none absolute inset-x-0 bottom-0 h-[30%] sm:h-[46%] z-0 animate-glow-fade-in" />
          <GlassBubbles className="hidden lg:block absolute left-[6%] top-[22%] w-28 animate-float opacity-90 pointer-events-none" />
        </section>
      </div>

      {/* ---------------- Glass highlight strip (overlaps hero) ---------------- */}
      <section aria-label="Highlights" className="relative z-20 -mt-20 sm:-mt-28 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto landing-glass rounded-[24px] grid grid-cols-1 md:grid-cols-3 md:divide-x divide-y md:divide-y-0 divide-[#16161D]/8 dark:divide-white/8">
          {[
            { title: 'Signed invoices', sub: 'EIP-712, checked in the payer’s browser', cta: 'Create a request', action: onExplore },
            { title: 'Fund & Pay', sub: 'BTC → MUSD for the exact shortfall', cta: 'Open the swap', action: onExplore },
            { title: 'Public proof', sub: 'Anyone can verify, no wallet needed', cta: 'View a real proof', href: PROOF_PATH },
          ].map((c) => {
            const body = (
              <>
                <span className="block font-display text-xl text-[#16161D] dark:text-white">{c.title}</span>
                <span className="block mt-1 text-[13px] text-[#5A5B68] dark:text-[#9C9DAB]">{c.sub}</span>
                <span className="mt-8 flex items-center justify-between text-sm text-[#16161D] dark:text-white">
                  {c.cta}
                  <span className="w-7 h-7 rounded-full bg-[#16161D]/6 dark:bg-white/10 flex items-center justify-center transition-all duration-300 group-hover:bg-[#16161D] group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-[#16161D] group-hover:rotate-45">
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </span>
                </span>
              </>
            );
            const cls = 'group block text-left p-6 sm:p-8 hover:bg-white/40 dark:hover:bg-white/[0.03] transition-colors first:rounded-t-[24px] last:rounded-b-[24px] md:first:rounded-l-[24px] md:first:rounded-tr-none md:last:rounded-r-[24px] md:last:rounded-bl-none';
            return c.href ? (
              <a key={c.title} href={c.href} className={cls}>{body}</a>
            ) : (
              <button key={c.title} onClick={c.action} className={cls}>{body}</button>
            );
          })}
        </div>
      </section>

      <div className="relative">
        <div className="landing-glow absolute inset-0 pointer-events-none [mask-image:linear-gradient(to_bottom,black_80%,transparent)]" aria-hidden="true" />

        {/* ---------------- Split: invoice + proof ---------------- */}
        <section className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-24 sm:pt-36 grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
          <div className="landing-reveal order-2 lg:order-1">
            <InvoicePreview />
          </div>
          <div className="landing-reveal order-1 lg:order-2">
            <h2 className="font-display font-normal text-[36px] sm:text-[52px] leading-[1.06] tracking-[-0.03em]">
              Invoices nobody can edit. Payments anyone can <span className="landing-text-iridescent">verify.</span>
            </h2>
            <p className="mt-6 text-[15px] sm:text-[17px] leading-relaxed text-[#4A4B58] dark:text-[#A9AAB8] max-w-lg">
              No more pasted addresses, edited links or screenshots as proof. The payment carries its request ID on-chain, so you and your customer can both point to the same record.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <PillButton variant="outline" href={PROOF_PATH} ariaLabel="See a verified payment">
                See a verified payment
              </PillButton>
            </div>
          </div>
        </section>

        {/* ---------------- Features ---------------- */}
        <section id="features" className="relative scroll-mt-8 max-w-6xl mx-auto px-5 sm:px-8 pt-28 sm:pt-40">
          <div className="landing-reveal grid md:grid-cols-[1.1fr_1fr] gap-6 md:gap-16 items-end">
            <h2 className="font-display font-normal text-[44px] sm:text-[68px] leading-[0.98] tracking-[-0.035em]">
              Everything
              <br />
              you need to get paid
            </h2>
            <p className="text-[16px] sm:text-[19px] leading-relaxed text-[#3A3B48] dark:text-[#B4B5C2] md:pb-3">
              Built on Mezo’s own MUSD token, Router, pools and price oracle. No custom smart contracts holding your money.
            </p>
          </div>

          <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {FEATURES.map((f, i) => (
              <article
                key={f.title}
                className="landing-reveal group landing-glass rounded-[22px] p-6 sm:p-7 flex flex-col hover:-translate-y-1 transition-transform duration-500"
                style={{ transitionDelay: `${(i % 3) * 80}ms` }}
              >
                <span className="w-14 h-14 rounded-2xl landing-iridescent flex items-center justify-center transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-105">
                  <f.icon className="w-6 h-6 text-white drop-shadow-[0_1px_2px_rgba(40,40,120,0.35)]" strokeWidth={2} />
                </span>
                <h3 className="mt-7 font-display text-[21px] text-[#16161D] dark:text-white">{f.title}</h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-[#4A4B58] dark:text-[#A9AAB8]">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------- On Mezo (glass frame + tabbed card) ---------------- */}
        <section id="on-mezo" className="relative scroll-mt-8 px-5 sm:px-8 pt-28 sm:pt-40">
          <div className="landing-reveal relative max-w-4xl mx-auto rounded-[32px] border border-white/90 dark:border-white/10 bg-white/25 dark:bg-white/[0.02] backdrop-blur-sm px-5 sm:px-12 pt-14 sm:pt-20 pb-12 sm:pb-16 text-center">
            <GlassBubbles className="absolute -left-8 sm:-left-16 -top-10 w-24 sm:w-36 animate-float pointer-events-none" />
            <GlassBubbles className="absolute -right-6 sm:-right-14 -bottom-10 w-24 sm:w-32 animate-float pointer-events-none [animation-delay:-4s] [--float-rot:160deg]" />
            <h2 className="font-display font-normal text-[44px] sm:text-[76px] leading-none tracking-[-0.04em]">
              Built on <span className="landing-text-iridescent">Mezo</span>
            </h2>
            <p className="mt-5 max-w-lg mx-auto text-[14px] sm:text-[15px] leading-relaxed text-[#4A4B58] dark:text-[#A9AAB8]">
              Bitcoin-backed MUSD for settlement, Mezo’s Router and MUSD/BTC pool for Fund & Pay, and the Mezo PriceFeed and TroveManager for live protocol context.
            </p>
            <div className="mt-10">
              <NetworkPanel onExplore={onExplore} />
            </div>
          </div>
        </section>

        {/* ---------------- How it works ---------------- */}
        <section id="how-it-works" className="relative scroll-mt-8 max-w-6xl mx-auto px-5 sm:px-8 pt-28 sm:pt-40">
          <GlassStar className="hidden md:block absolute left-0 lg:-left-6 top-[300px] w-36 lg:w-44 animate-float pointer-events-none [--float-rot:-12deg]" />
          <div className="landing-reveal">
            <h2 className="font-display font-normal text-[44px] sm:text-[76px] leading-none tracking-[-0.04em]">How a payment works</h2>
            <p className="mt-6 md:ml-[30%] max-w-xl text-[16px] sm:text-[20px] leading-relaxed text-[#3A3B48] dark:text-[#B4B5C2]">
              Six steps from “you owe me” to a proof anyone can open, and the customer never leaves the invoice.
            </p>
          </div>

          <ol className="mt-14 md:ml-[24%] grid sm:grid-cols-2 lg:grid-cols-3 gap-px rounded-[22px] overflow-hidden bg-[#16161D]/6 dark:bg-white/6">
            {STEPS.map((s, i) => (
              <li key={s.title} className="landing-reveal bg-[#F6F7FB]/92 dark:bg-[#0E0E15]/92 backdrop-blur p-6 sm:p-7 hover:bg-white dark:hover:bg-[#14141D] transition-colors" style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm text-[#9A9BA8] tabular-nums">0{i + 1}</span>
                  <span className="px-3 py-0.5 rounded-full bg-[#E6E8F2] dark:bg-white/10 text-[12px] text-[#3A3B48] dark:text-[#C9CAD6]">{s.who}</span>
                </div>
                <h3 className="mt-4 font-display text-[21px] text-[#16161D] dark:text-white">{s.title}</h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-[#4A4B58] dark:text-[#A9AAB8]">{s.body}</p>
                <ul className="mt-4 space-y-2">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-center gap-2.5 text-[13px] text-[#2A2B36] dark:text-[#C9CAD6]">
                      <span className="w-2.5 h-2.5 rounded-full landing-dot shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <div className="landing-reveal mt-10">
            <PillButton variant="outline" onClick={onExplore} ariaLabel="Try it on testnet">
              Try it on testnet
            </PillButton>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section id="faq" className="relative scroll-mt-8 max-w-4xl mx-auto px-5 sm:px-8 pt-28 sm:pt-40 pb-24 sm:pb-32">
          <div className="landing-reveal text-center">
            <SectionTag>FAQs</SectionTag>
            <h2 className="mt-4 font-display font-normal text-[44px] sm:text-[76px] leading-none tracking-[-0.04em]">Have a question?</h2>
          </div>
          <div className="landing-reveal mt-12 sm:mt-16">
            {FAQS.map((f, i) => (
              <FaqItem key={f.q} q={f.q} a={f.a} id={`faq-${i}`} />
            ))}
          </div>
        </section>
      </div>

      {/* ---------------- Footer ---------------- */}
      <footer className="p-2 sm:p-3">
        <div className="landing-mesh rounded-[24px] sm:rounded-[32px] px-6 sm:px-12 py-12 sm:py-14 [animation-duration:30s]">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.2fr_1fr] gap-12">
            <div>
              <p className="font-display text-[28px] sm:text-[36px] leading-tight tracking-[-0.02em] max-w-md">Start getting paid in MUSD today.</p>
              <div className="mt-7 flex flex-wrap items-center gap-4">
                {walletCta}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
              <div>
                <p className="font-display font-medium text-[#16161D] dark:text-white">Product</p>
                <ul className="mt-4 space-y-2.5 text-[#4A4B58] dark:text-[#A9AAB8]">
                  <li><button onClick={onExplore} className="hover:text-[#16161D] dark:hover:text-white">Dashboard</button></li>
                  <li><button onClick={() => scrollTo('features')} className="hover:text-[#16161D] dark:hover:text-white">Features</button></li>
                  <li><button onClick={() => scrollTo('how-it-works')} className="hover:text-[#16161D] dark:hover:text-white">How it works</button></li>
                </ul>
              </div>
              <div>
                <p className="font-display font-medium text-[#16161D] dark:text-white">Proof</p>
                <ul className="mt-4 space-y-2.5 text-[#4A4B58] dark:text-[#A9AAB8]">
                  <li><a href={PROOF_PATH} className="hover:text-[#16161D] dark:hover:text-white">Verified settlement</a></li>
                  <li><a href={MEZO_TESTNET.explorerUrl} target="_blank" rel="noopener noreferrer" className="hover:text-[#16161D] dark:hover:text-white">Mezo explorer</a></li>
                  {MEZO_TESTNET.faucetUrl && (
                    <li><a href={MEZO_TESTNET.faucetUrl} target="_blank" rel="noopener noreferrer" className="hover:text-[#16161D] dark:hover:text-white">Testnet faucet</a></li>
                  )}
                </ul>
              </div>
              <div>
                <p className="font-display font-medium text-[#16161D] dark:text-white">Open source</p>
                <ul className="mt-4 space-y-2.5 text-[#4A4B58] dark:text-[#A9AAB8]">
                  <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#16161D] dark:hover:text-white">Source code</a></li>
                  <li><a href={`${REPO_URL}/blob/main/docs/KNOWN_LIMITATIONS.md`} target="_blank" rel="noopener noreferrer" className="hover:text-[#16161D] dark:hover:text-white">Known limitations</a></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="max-w-6xl mx-auto mt-14 pt-8 border-t border-[#16161D]/10 dark:border-white/10 flex flex-col sm:flex-row sm:items-end justify-between gap-6">
            <div>
              <div className="flex items-center gap-2.5">
                <img src={logoImage} alt="" className="w-8 h-8 object-contain dark:invert" />
                <span className="font-display text-[24px] font-medium tracking-tight leading-none">cambio</span>
              </div>
              <p className="mt-3 text-[12px] text-[#4A4B58] dark:text-[#A9AAB8]">Non-custodial MUSD payments on Mezo. Testnet only, not audited.</p>
            </div>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Cambio on GitHub" className="w-10 h-10 rounded-xl border border-[#16161D]/15 dark:border-white/15 bg-white/60 dark:bg-white/5 flex items-center justify-center hover:bg-white dark:hover:bg-white/10 transition-colors">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};
