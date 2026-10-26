import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Wallet, Copy, Check, Clock, AlertCircle, ExternalLink, ShieldCheck, ShieldAlert, Send, ArrowLeft, Loader2, Link2 } from 'lucide-react';
import type { Address, Hex } from 'viem';
import { useSwitchChain } from 'wagmi';
import type { WalletState } from '../types';
import { copyToClipboard, getExplorerAddressUrl, getExplorerTxUrl, shortenAddress } from '../utils/format';
import { formatTimeRemaining, isExpired, verifyRequestSignature, ecdsaTypedDataVerifier, encodePaymentLink, type ParsedPaymentLink } from '../lib/paymentRequest';
import { verifyWalletSignature } from '../../shared/signatureVerification';
import { formatTokenDisplay, formatUnitsExact } from '../lib/amounts';
import { getChainConfig } from '../config/chains';
import { lookupAddress, resolveUsername } from '../services/identityClient';
import { publicClientFor } from '../lib/wagmiDeps';
import { verifyPaymentTx, type SettlementCheck } from '../lib/requestSettlement';
import type { TxPhase } from '../lib/transactions';
import { ThemeToggle } from './ThemeToggle';
import { HalftonePattern } from './HalftonePattern';
import { SendModal } from './SendModal';
import logoImage from '@/logo.png';

interface PaymentRequestPageProps {
  link: ParsedPaymentLink;
  wallet: WalletState;
  onConnectWallet: () => void;
  onGoToDashboard: () => void;
  onTransferSettled?: (phase: TxPhase, summary: { recipientLabel: string; amount: bigint }) => void;
}

type SigState = 'verifying' | 'valid' | 'invalid' | 'unsigned';

export const PaymentRequestPage: React.FC<PaymentRequestPageProps> = ({ link, wallet, onConnectWallet, onGoToDashboard, onTransferSettled }) => {
  const { switchChainAsync } = useSwitchChain();
  const [sig, setSig] = useState<SigState>(link.kind === 'signed' ? 'verifying' : 'unsigned');
  const [recipient, setRecipient] = useState<Address | null>(link.kind === 'signed' ? link.request.recipient : link.kind === 'unsigned' ? link.recipient : null);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [proof, setProof] = useState<SettlementCheck | null>(null);
  const [paidHash, setPaidHash] = useState<Hex | null>(link.kind === 'signed' ? link.proofTx : null);
  const [copied, setCopied] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(timer); }, []);

  const chain = link.kind === 'signed' ? getChainConfig(link.request.chainId) : link.kind === 'unsigned' ? getChainConfig(link.chainId) : null;
  const amount = link.kind === 'signed' ? BigInt(link.request.amount) : link.kind === 'unsigned' ? link.amount : null;
  const memo = link.kind === 'signed' ? link.request.memo : link.kind === 'unsigned' ? link.memo : '';
  const expiresAt = link.kind === 'signed' ? link.request.expiresAt : link.kind === 'unsigned' ? link.expiresAt : null;
  const expired = isExpired(expiresAt, now);
  const notActive = link.kind === 'signed' && now < link.request.createdAt;

  // 1. Verify the request signature (EOA or ERC-1271) before anything else.
  useEffect(() => {
    if (link.kind !== 'signed' || !chain) return;
    let cancelled = false;
    setSig('verifying');
    verifyRequestSignature(link.request, link.signature, (args) => verifyWalletSignature({
      signature: args.signature,
      verifyEoa: () => ecdsaTypedDataVerifier(args),
      getCode: () => publicClientFor(chain.chainId).getCode({ address: args.address }),
      verifyContract: () => publicClientFor(chain.chainId).verifyTypedData(args),
    }))
      .then((ok) => !cancelled && setSig(ok ? 'valid' : 'invalid'))
      .catch(() => !cancelled && setSig('invalid'));
    return () => {
      cancelled = true;
    };
  }, [link, chain]);

  // 2. Display name comes from the verified registry, never from the link.
  useEffect(() => {
    let cancelled = false;
    setResolveError(null);
    if (link.kind === 'unsigned' && !link.recipient && link.recipientUsername) {
      resolveUsername(link.recipientUsername)
        .then((rec) => {
          if (cancelled) return;
          if (rec) {
            setRecipient(rec.address);
            setVerifiedName(rec.display);
          } else setResolveError(`@${link.recipientUsername} is not a registered Cambio username.`);
        })
        .catch(() => !cancelled && setResolveError('The username service is unavailable, so @' + link.recipientUsername + ' cannot be resolved right now.'));
    } else if (recipient) {
      lookupAddress(recipient)
        .then((rec) => !cancelled && setVerifiedName(rec?.display ?? null))
        .catch(() => !cancelled && setVerifiedName(null));
    }
    return () => {
      cancelled = true;
    };
  }, [link, recipient]);

  // 3. A payment proof (tx hash) is checked against the chain, never trusted.
  useEffect(() => {
    if (link.kind !== 'signed' || sig !== 'valid' || !paidHash || !chain) return;
    let cancelled = false;
    setProof(null);
    verifyPaymentTx(publicClientFor(chain.chainId) as never, link.request, paidHash).then((res) => !cancelled && setProof(res));
    return () => {
      cancelled = true;
    };
  }, [link, paidHash, chain, sig]);

  const lockedRequest = useMemo(
    () => (link.kind === 'signed' && sig === 'valid' ? { request: link.request, recipientLabel: verifiedName ?? shortenAddress(link.request.recipient) } : null),
    [link, sig, verifiedName]
  );

  const flash = async (key: string, text: string) => {
    if (await copyToClipboard(text)) {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    }
  };

  const isOwn = !!(wallet.address && recipient && wallet.address.toLowerCase() === recipient.toLowerCase());
  const wrongChain = wallet.isConnected && chain && wallet.chainId !== chain.chainId;
  const payable = !!chain && !!recipient && !expired && !notActive && (link.kind === 'unsigned' || sig === 'valid') && !(proof?.state === 'settled');
  const proofLink = link.kind === 'signed' && paidHash ? encodePaymentLink(window.location.origin, link.request, link.signature, paidHash) : null;

  const handleSwitch = async () => {
    if (!chain) return;
    setSwitchError(null);
    try {
      await switchChainAsync({ chainId: chain.chainId });
    } catch {
      setSwitchError(`Switch your wallet to ${chain.name} to pay.`);
    }
  };

  if (link.kind === 'invalid') {
    return (
      <Shell onGoToDashboard={onGoToDashboard}>
        <div className="p-5 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 space-y-2" role="alert">
          <div className="flex items-center gap-2 font-bold text-sm"><ShieldAlert className="w-5 h-5" /> This payment link is not valid</div>
          <p className="text-xs">{link.error}</p>
          <p className="text-xs">Do not pay from this link. Ask the recipient to send a new one.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onGoToDashboard={onGoToDashboard}>
      <div className="relative z-10 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">MUSD payment request</span>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-semibold uppercase tracking-wider border ${expired ? 'bg-red-500/10 text-red-600 border-red-500/20' : proof?.state === 'settled' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-[#F0F0EE] dark:bg-[#1A1A1D] text-[#555555] dark:text-[#A0A0A0] border-[#E2E2E0] dark:border-[#26262B]'}`}>
          {expired ? 'Expired' : proof?.state === 'settled' ? 'Paid' : 'Awaiting payment'}
        </span>
      </div>

      {/* Authenticity */}
      {link.kind === 'signed' ? (
        sig === 'verifying' ? (
          <Banner tone="info" icon={<Loader2 className="w-4 h-4 animate-spin" />} title="Verifying the recipient’s signature…" />
        ) : sig === 'valid' ? (
          <Banner tone="ok" icon={<ShieldCheck className="w-4 h-4" />} title="Signed by the recipient’s wallet">
            The address, amount, note and expiry below were signed by {shortenAddress(link.request.recipient)} and have not been changed.
          </Banner>
        ) : (
          <Banner tone="bad" icon={<ShieldAlert className="w-4 h-4" />} title="Signature check failed — do not pay">
            This link was modified after it was signed, or was not signed by the address it pays. Ask the recipient for a new link.
          </Banner>
        )
      ) : (
        <Banner tone="warn" icon={<AlertCircle className="w-4 h-4" />} title="Unsigned link">
          Cambio cannot confirm who created this link. Only pay if you trust where it came from, and check the address below.
        </Banner>
      )}

      <div className="relative z-10 text-center py-2 space-y-2">
        <span className="text-xs sm:text-sm text-[#777777] dark:text-[#A0A0A0] block">
          {verifiedName ? (
            <>Paying <strong className="text-[#111111] dark:text-[#FFFFFF]">{verifiedName}</strong> <span className="text-emerald-600 text-[11px]">(verified username)</span></>
          ) : recipient ? (
            <>Paying <strong className="text-[#111111] dark:text-[#FFFFFF] font-mono">{shortenAddress(recipient)}</strong></>
          ) : (
            'Resolving recipient…'
          )}
        </span>
        <div className="text-4xl sm:text-5xl font-bold font-mono tracking-tight text-[#111111] dark:text-[#FFFFFF]">
          {amount !== null ? formatTokenDisplay(amount, chain?.tokens.MUSD.decimals ?? 18, { maxFractionDigits: 6 }) : '—'} <span className="text-lg font-medium text-[#777777]">MUSD</span>
        </div>
        {amount === null && <p className="text-xs text-[#777777]">The payer chooses the amount.</p>}
        <p className="text-xs text-[#777777] dark:text-[#A0A0A0]">{chain ? `${chain.name} · chain ${chain.chainId}${chain.isTestnet ? ' · test funds' : ' · real funds'}` : 'Unsupported network'}</p>
      </div>

      {memo && (
        <div className="relative z-10 p-4 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#777777]">Note{link.kind === 'signed' ? ' (signed)' : ''}</span>
          <p className="text-sm text-[#111111] dark:text-[#FFFFFF] break-words">“{memo}”</p>
        </div>
      )}

      <div className="relative z-10 p-4 rounded-2xl bg-[#F0F0EE]/70 dark:bg-[#1A1A1D]/70 border border-[#E2E2E0] dark:border-[#26262B] space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-[#777777]">Recipient address</span>
          {recipient && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => flash('addr', recipient)} className="inline-flex items-center gap-1 font-semibold text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF]">
                {copied === 'addr' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />} {copied === 'addr' ? 'Copied' : 'Copy'}
              </button>
              {chain && getExplorerAddressUrl(recipient, chain.chainId) && (
                <a href={getExplorerAddressUrl(recipient, chain.chainId)!} target="_blank" rel="noopener noreferrer" className="text-[#777777] hover:text-[#111111]" aria-label="View recipient on explorer">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}
        </div>
        {recipient ? <div className="font-mono text-xs font-semibold text-[#111111] dark:text-[#FFFFFF] break-all select-all">{recipient}</div> : resolveError ? <p className="text-xs text-red-600">{resolveError}</p> : <Loader2 className="w-4 h-4 animate-spin" />}
      </div>

      {expiresAt !== null && (
        <div className="relative z-10 flex items-center justify-between text-xs text-[#777777] px-1">
          <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {formatTimeRemaining(expiresAt)}</span>
          {link.kind === 'signed' && <span className="font-mono">ID {link.request.id.slice(2, 10)}</span>}
        </div>
      )}

      {/* Settlement proof */}
      {paidHash && chain && (
        <div className="relative z-10">
          {proof === null ? (
            <Banner tone="info" icon={<Loader2 className="w-4 h-4 animate-spin" />} title="Checking the payment on-chain…" />
          ) : proof.state === 'settled' ? (
            <Banner tone="ok" icon={<ShieldCheck className="w-4 h-4" />} title={`Paid — verified on ${chain.name}${proof.result.status === 'settled_after_expiry' ? ' (after expiry)' : ''}`}>
              Transaction{' '}
              <a href={getExplorerTxUrl(paidHash, chain.chainId)!} target="_blank" rel="noopener noreferrer" className="underline font-mono">{shortenAddress(paidHash, 10, 6)}</a>{' '}
              transferred exactly this amount to this address and references this request, in block {proof.result.blockNumber}.
            </Banner>
          ) : proof.state === 'invalid' ? (
            <Banner tone="bad" icon={<ShieldAlert className="w-4 h-4" />} title="This transaction does not pay this request">
              {proof.result.status === 'reverted' ? 'The transaction reverted.' : proof.result.status === 'mismatch' ? proof.result.reason : ''}
            </Banner>
          ) : proof.state === 'not_found' ? (
            <Banner tone="warn" icon={<Clock className="w-4 h-4" />} title="Transaction not found yet">It may still be pending. Refresh in a moment.</Banner>
          ) : (
            <Banner tone="warn" icon={<AlertCircle className="w-4 h-4" />} title="Could not verify right now">{proof.message}</Banner>
          )}
          {proofLink && proof?.state === 'settled' && (
            <button type="button" onClick={() => flash('proof', proofLink)} className="mt-2 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] text-xs font-semibold">
              {copied === 'proof' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Link2 className="w-3.5 h-3.5" />} {copied === 'proof' ? 'Proof link copied' : 'Copy payment proof link for the recipient'}
            </button>
          )}
        </div>
      )}

      <div className="relative z-10 pt-2 space-y-3">
        {proof?.state === 'settled' ? null : expired ? (
          <p className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-xs text-center">This request has expired. Ask the recipient for a new one.</p>
        ) : notActive ? (
          <p role="alert" className="p-3 text-xs text-amber-700">This request has a future creation time and is not active yet. Check your clock or ask for a new request.</p>
        ) : !chain ? (
          <p className="p-3.5 rounded-2xl bg-red-500/10 text-red-600 text-xs text-center">This request is for a network Cambio does not support.</p>
        ) : !wallet.isConnected ? (
          <button type="button" onClick={onConnectWallet} className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold">
            <Wallet className="w-4 h-4" /> Connect wallet to pay
          </button>
        ) : wrongChain ? (
          <div className="space-y-2">
            <button type="button" onClick={handleSwitch} className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-amber-600 text-white text-sm font-semibold">
              Switch wallet to {chain.name}
            </button>
            {switchError && <p className="text-xs text-center text-amber-700">{switchError}</p>}
          </div>
        ) : isOwn ? (
          <p className="p-3.5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] text-xs text-center text-[#777777]">This request pays your own connected wallet. Open it in the payer’s browser or wallet.</p>
        ) : wallet.dataMode === 'demo' ? (
          <p className="p-3.5 rounded-2xl bg-violet-500/10 text-xs text-center text-violet-700 dark:text-violet-300">Demo mode is on. Switch to real data in the dashboard to pay a real request.</p>
        ) : (
          <button
            type="button"
            disabled={!payable}
            onClick={() => setPayOpen(true)}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
            {link.kind === 'signed' && sig !== 'valid' ? 'Waiting for signature check' : amount !== null ? `Review payment of ${formatTokenDisplay(amount, chain.tokens.MUSD.decimals)} MUSD` : 'Choose amount and pay'}
          </button>
        )}
        <button type="button" onClick={onGoToDashboard} className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF]">
          <ArrowLeft className="w-3.5 h-3.5" /> Open Cambio dashboard
        </button>
      </div>

      <SendModal
        isOpen={payOpen}
        onClose={() => setPayOpen(false)}
        wallet={wallet}
        onOpenConnectWallet={onConnectWallet}
        onTransferSettled={onTransferSettled}
        lockedRequest={lockedRequest}
        initialRecipient={lockedRequest ? undefined : recipient ?? undefined}
        initialAmount={lockedRequest || amount === null ? undefined : formatUnitsExact(amount, chain?.tokens.MUSD.decimals ?? 18)}
        initialMemo={lockedRequest ? undefined : memo}
        onRequestPaid={(hash) => setPaidHash(hash)}
      />
    </Shell>
  );
};

function Shell({ children, onGoToDashboard }: { children: React.ReactNode; onGoToDashboard: () => void }) {
  return (
    <div className="min-h-screen bg-[#F5F5F3] dark:bg-[#0C0C0D] text-[#111111] dark:text-[#F5F5F7] flex flex-col justify-between antialiased">
      <header className="w-full shrink-0 border-b border-[#E2E2E0] dark:border-[#26262B] bg-[#FFFFFF]/80 dark:bg-[#111113]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 sm:px-8 h-20 flex items-center justify-between">
          <button type="button" onClick={onGoToDashboard} className="flex items-center gap-3 group" aria-label="Open Cambio dashboard">
            <img src={logoImage} alt="" className="w-9 h-9 object-contain dark:invert" />
            <span className="text-[16px] font-bold tracking-[0.12em] uppercase">Cambio</span>
          </button>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button onClick={onGoToDashboard} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416]">
              Dashboard <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-lg w-full mx-auto px-4 py-8 sm:py-14 flex flex-col justify-center">
        <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-9 shadow-sm space-y-5">
          <div className="absolute -right-10 -top-10 w-44 h-44 pointer-events-none opacity-[0.08] dark:opacity-[0.12]">
            <HalftonePattern variant="sphere" className="w-full h-full" />
          </div>
          {children}
        </div>
      </main>
      <footer className="w-full py-4 text-center text-xs text-[#A0A0A0] dark:text-[#707070]">Cambio · non-custodial MUSD payments on Mezo</footer>
    </div>
  );
}

function Banner({ tone, icon, title, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  const cls = {
    ok: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300',
    warn: 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300',
    bad: 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300',
    info: 'bg-[#F0F0EE] dark:bg-[#1A1A1D] border-[#E2E2E0] dark:border-[#26262B] text-[#555555] dark:text-[#A0A0A0]',
  }[tone];
  return (
    <div className={`relative z-10 p-3.5 rounded-2xl border text-xs space-y-1 ${cls}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <p className="font-bold flex items-center gap-2">{icon} {title}</p>
      {children && <p className="leading-relaxed">{children}</p>}
    </div>
  );
}
