import React, { useEffect, useRef, useState } from 'react';
import { X, Check, Loader2, AlertCircle, ShieldCheck, ServerCrash } from 'lucide-react';
import { signMessage } from 'wagmi/actions';
import type { Address } from 'viem';
import { shortenAddress } from '../utils/format';
import { wagmiConfig } from '../config/walletConnect';
import { normalizeUsername, validateUsername } from '../../shared/username';
import { checkAvailability, IdentityApiError, notifyUsernameChanged, requestChallenge, submitClaim, type IdentityHealth } from '../services/identityClient';
import { classifyTxError } from '../lib/txErrors';

interface UsernameModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: Address;
  chainId: number | null;
  currentUsername?: string | null;
  mode?: 'create' | 'change';
  identityHealth: IdentityHealth | null;
  onSuccess: (newUsername: string) => void;
}

type Availability = { state: 'idle' } | { state: 'checking' } | { state: 'available' } | { state: 'unavailable'; reason: string } | { state: 'error'; reason: string };

/**
 * Claim or change a username. Ownership is proven by signing a server-issued, single-use EIP-4361
 * message; the server verifies the signature before writing anything. No signature, no username.
 */
export const UsernameModal: React.FC<UsernameModalProps> = ({ isOpen, onClose, walletAddress, chainId, currentUsername, mode = 'create', identityHealth, onSuccess }) => {
  const [input, setInput] = useState('');
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [step, setStep] = useState<'form' | 'challenge' | 'signing' | 'verifying' | 'done'>('form');
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  // Reset only when the dialog opens. (Resetting on currentUsername changes would wipe the success
  // confirmation the moment the app learns about the newly verified name.)
  useEffect(() => {
    if (!isOpen) return;
    setInput(currentUsername ?? '');
    setAvailability({ state: 'idle' });
    setStep('form');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const normalized = normalizeUsername(input);
  const isSame = mode === 'change' && !!currentUsername && normalized === currentUsername;

  useEffect(() => {
    if (!isOpen || !normalized || isSame) {
      setAvailability({ state: 'idle' });
      return;
    }
    const v = validateUsername(normalized);
    if (!v.valid) {
      setAvailability({ state: 'unavailable', reason: v.error });
      return;
    }
    setAvailability({ state: 'checking' });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await checkAvailability(v.username, walletAddress);
        if (cancelled) return;
        setAvailability(res.available ? { state: 'available' } : { state: 'unavailable', reason: res.ownedByCaller ? 'You already own this name.' : 'Already registered to another wallet.' });
      } catch (err) {
        if (!cancelled) setAvailability({ state: 'error', reason: err instanceof IdentityApiError ? err.message : 'Could not check availability.' });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [normalized, isOpen, isSame, walletAddress]);

  if (!isOpen) return null;

  const busy = step === 'challenge' || step === 'signing' || step === 'verifying';
  const serviceDown = identityHealth !== null && !identityHealth.available;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    const v = validateUsername(normalized);
    if (!v.valid) return setError(v.error);
    if (isSame) return onClose();
    if (!chainId) return setError('Connect to a supported network first.');

    try {
      submitting.current = true;
      setStep('challenge');
      const challenge = await requestChallenge({ address: walletAddress, chainId, action: mode === 'change' ? 'change' : 'register', username: v.username });
      setStep('signing');
      const signature = await signMessage(wagmiConfig, { account: walletAddress, message: challenge.message });
      setStep('verifying');
      const { record } = await submitClaim({ nonce: challenge.nonce, signature });
      notifyUsernameChanged(record.address, record.username);
      if (!active.current) return;
      setStep('done');
      setTimeout(() => {
        if (!active.current) return;
        onSuccess(record.username);
        onClose();
      }, 900);
    } catch (err) {
      setStep('form');
      if (err instanceof IdentityApiError) return setError(err.message);
      const c = classifyTxError(err);
      setError(c.code === 'rejected' ? 'Signature request was declined. Your username was not changed.' : 'Something went wrong. Your username was not changed.');
    } finally {
      submitting.current = false;
    }
  };

  const status = (() => {
    switch (availability.state) {
      case 'checking':
        return <span className="text-[#777777]">Checking availability…</span>;
      case 'available':
        return <span className="text-emerald-600 dark:text-emerald-400 font-medium">Available</span>;
      case 'unavailable':
        return <span className="text-red-600 dark:text-red-400">{availability.reason}</span>;
      case 'error':
        return <span className="text-amber-600">{availability.reason}</span>;
      default:
        return <span className="text-[#777777] dark:text-[#A0A0A0]">3–20 characters: letters, numbers and single underscores.</span>;
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="username-title" onKeyDown={(e) => e.key === 'Escape' && !busy && onClose()}>
      <div className="fixed inset-0 bg-black/50 dark:bg-black/75 backdrop-blur-xs" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-md bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl shadow-2xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 z-10 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 id="username-title" className="text-xl sm:text-2xl font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight">
              {mode === 'change' ? 'Change your username' : 'Choose your username'}
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[#777777] dark:text-[#A0A0A0]">People can pay @you instead of copying a 42-character address.</p>
          </div>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded-xl text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] disabled:opacity-40" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-between text-xs font-mono">
          <span className="text-[#777777]">Wallet</span>
          <span className="font-semibold text-[#111111] dark:text-[#FFFFFF]">{shortenAddress(walletAddress)}</span>
        </div>

        {serviceDown && (
          <div role="alert" className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
            <ServerCrash className="w-4 h-4 shrink-0" />
            <span>The username registry is unavailable right now, so names cannot be claimed or changed. Payments by wallet address still work.</span>
          </div>
        )}
        {identityHealth?.available && !identityHealth.durable && (
          <div role="status" className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-[11px]">
            Development registry: this server keeps usernames in memory only. They are signature-verified but will be lost on restart.
          </div>
        )}

        {step === 'done' ? (
          <div className="p-4 rounded-2xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold text-sm">@{normalized} is now verified for this wallet.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <label htmlFor="username-input" className="block text-xs font-semibold text-[#111111] dark:text-[#FFFFFF] uppercase tracking-wider font-mono">Username</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-[#777777]" aria-hidden="true">@</span>
                <input
                  id="username-input"
                  type="text"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy || serviceDown}
                  maxLength={21}
                  placeholder="e.g. jomi"
                  value={input.replace(/^@+/, '')}
                  onChange={(e) => { setInput(e.target.value); setError(null); }}
                  aria-describedby="username-status"
                  className="w-full pl-9 pr-10 py-3.5 rounded-2xl bg-white dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-base font-mono font-semibold text-[#111111] dark:text-[#FFFFFF] focus:outline-none focus:border-[#111111] dark:focus:border-[#FFFFFF] disabled:opacity-50"
                />
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {availability.state === 'checking' ? <Loader2 className="w-4 h-4 animate-spin text-[#777777]" /> : availability.state === 'available' ? <Check className="w-4 h-4 text-emerald-600" /> : availability.state === 'unavailable' ? <AlertCircle className="w-4 h-4 text-red-500" /> : null}
                </div>
              </div>
              <div id="username-status" className="min-h-[20px] text-[11px] font-mono" aria-live="polite">{status}</div>
            </div>

            {error && (
              <div role="alert" className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}
            {busy && (
              <div className="p-3.5 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-xs text-[#555555] dark:text-[#A0A0A0] flex items-center gap-2" aria-live="polite">
                <ShieldCheck className="w-4 h-4 shrink-0 animate-pulse" />
                {step === 'challenge' ? 'Preparing a one-time sign-in message…' : step === 'signing' ? 'Sign the message in your wallet. It is free and sends no transaction.' : 'Verifying your signature…'}
              </div>
            )}

            <div className="pt-2 flex flex-col gap-2">
              <button
                type="submit"
                disabled={busy || serviceDown || !normalized || availability.state === 'unavailable' || availability.state === 'checking'}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {mode === 'change' ? 'Sign & change username' : 'Sign & claim username'}
              </button>
              {mode === 'create' && (
                <button type="button" onClick={onClose} disabled={busy} className="w-full py-2.5 text-xs text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF] font-mono">
                  I’ll do this later
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
