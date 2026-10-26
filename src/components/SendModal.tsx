/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowUpRight, AlertCircle, Wallet, AtSign, Loader2, ShieldCheck, ArrowLeft, Check, ExternalLink, FlaskConical } from 'lucide-react';
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import type { WalletState } from '../types';
import { shortenAddress } from '../utils/format';
import { HalftonePattern } from './HalftonePattern';
import { useCurrency } from '../context/CurrencyContext';
import { BalanceValue } from './BalanceValue';
import { NetworkGuard } from './NetworkGuard';
import { TxStatusPanel } from './TxStatusPanel';
import { useMusdTransfer } from '../hooks/useMusdTransfer';
import { bpsOf, formatTokenDisplay, formatUnitsExact, parseTokenAmount, toDisplayNumber } from '../lib/amounts';
import { spendable } from '../lib/balances';
import { isTerminal, type TxPhase } from '../lib/transactions';
import { explorerTokenUrl } from '../config/chains';
import { lookupAddress, resolveUsername, IdentityApiError } from '../services/identityClient';
import { validateUsername } from '../../shared/username';
import { isExpired, requestIdSuffix, type SignedPaymentRequest } from '../lib/paymentRequest';

export interface DemoSend {
  recipient: Address;
  recipientLabel: string;
  amount: bigint;
  memo: string;
}

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: WalletState;
  onOpenConnectWallet: () => void;
  /** Called once a real transfer reaches a terminal phase (refresh balances, history, notifications). */
  onTransferSettled?: (phase: TxPhase, summary: { recipientLabel: string; amount: bigint }) => void;
  /** Demo mode only: records a simulated transfer. */
  onDemoSend?: (send: DemoSend) => void;
  initialRecipient?: string;
  initialAmount?: string;
  initialMemo?: string;
  /** Paying a verified, signed request: recipient and amount are locked and the request id is bound into the calldata. */
  lockedRequest?: { request: SignedPaymentRequest; recipientLabel: string } | null;
  onRequestPaid?: (hash: Hex) => void;
}

type Resolved = { address: Address; label: string; verifiedName: boolean; viaUsername: boolean };

const MEMO_MAX = 140;

export const SendModal: React.FC<SendModalProps> = ({
  isOpen,
  onClose,
  wallet,
  onOpenConnectWallet,
  onTransferSettled,
  onDemoSend,
  initialRecipient,
  initialAmount,
  initialMemo,
  lockedRequest,
  onRequestPaid,
}) => {
  const { preferredCurrency, formatTokenFiat } = useCurrency();
  const transfer = useMusdTransfer();
  const chain = wallet.chain;
  const musd = chain?.tokens.MUSD;
  const decimals = musd?.decimals ?? 18;
  const isDemo = wallet.dataMode === 'demo';

  const [recipientInput, setRecipientInput] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [memo, setMemo] = useState('');
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'review' | 'result'>('form');
  const [formError, setFormError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  const settledNotified = useRef<string | null>(null);
  // Synchronous guard: a double click must never start two transfers (the hook has its own lock too).
  const confirming = useRef(false);
  const reviewed = useRef<ReturnType<typeof buildParams>>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset when (re)opened.
  useEffect(() => {
    if (!isOpen) return;
    if (lockedRequest) {
      setRecipientInput(lockedRequest.request.recipient);
      setAmountInput(formatUnitsExact(BigInt(lockedRequest.request.amount), decimals));
      setMemo(lockedRequest.request.memo);
    } else {
      setRecipientInput(initialRecipient ?? '');
      setAmountInput(initialAmount ?? '');
      setMemo(initialMemo ?? '');
    }
    setStep('form');
    setFormError(null);
    setResolved(null);
    setResolutionError(null);
    setDemoDone(false);
    settledNotified.current = null;
    transfer.reset();
    // Focus the dialog for keyboard and screen-reader users.
    setTimeout(() => dialogRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lockedRequest, initialRecipient, initialAmount, initialMemo]);

  // Resolve the recipient through the verified registry.
  useEffect(() => {
    if (!isOpen) return;
    const input = recipientInput.trim();
    setResolved(null);
    setResolutionError(null);
    if (!input) return;

    let cancelled = false;
    // A well-formed address needs no network round-trip: accept it immediately, then look up its name.
    if (isAddress(input, { strict: false })) {
      const address = getAddress(input);
      setResolved({ address, label: shortenAddress(address), verifiedName: false, viaUsername: false });
      lookupAddress(address)
        .then((rec) => {
          if (!cancelled && rec) setResolved({ address, label: rec.display, verifiedName: true, viaUsername: false });
        })
        .catch(() => {
          // Name lookup is cosmetic for a raw address; the address itself is what gets paid.
        });
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(async () => {
      if (input.startsWith('0x')) {
        setResolutionError('That is not a complete 0x address (40 hex characters).');
        return;
      }
      const v = validateUsername(input);
      if (!v.valid) {
        setResolutionError('Enter a @username or a 0x wallet address.');
        return;
      }
      setResolving(true);
      try {
        const rec = await resolveUsername(v.username);
        if (cancelled) return;
        if (rec) setResolved({ address: rec.address, label: rec.display, verifiedName: true, viaUsername: true });
        else setResolutionError(`No verified wallet is registered as @${v.username}.`);
      } catch (err) {
        if (!cancelled) {
          setResolutionError(
            err instanceof IdentityApiError && (err.status === 503 || err.status === 0)
              ? 'The username service is unavailable. Paste the recipient’s wallet address instead.'
              : 'Could not resolve that username.'
          );
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recipientInput, isOpen]);

  const parsed = useMemo(() => parseTokenAmount(amountInput, decimals), [amountInput, decimals]);
  const balance = wallet.balances.musd;
  const available = isDemo ? (balance.status === 'ready' ? balance.value : null) : spendable(balance);
  const fiat = parsed.ok ? formatTokenFiat(toDisplayNumber(parsed.value, decimals), 'MUSD') : null;

  // Notify the parent exactly once per terminal outcome.
  useEffect(() => {
    const outcome = transfer.phase.phase + ('hash' in transfer.phase ? transfer.phase.hash : '');
    if (step !== 'result' || settledNotified.current === outcome || !isTerminal(transfer.phase)) return;
    settledNotified.current = outcome;
    if (parsed.ok && resolved) onTransferSettled?.(transfer.phase, { recipientLabel: resolved.label, amount: parsed.value });
    if (transfer.phase.phase === 'confirmed' && lockedRequest) onRequestPaid?.(transfer.phase.hash);
  }, [step, transfer.phase, parsed, resolved, onTransferSettled, lockedRequest, onRequestPaid]);

  if (!isOpen) return null;

  const busy = transfer.busy || preparing;

  const buildParams = () => {
    if (!resolved || !parsed.ok || !chain || !wallet.address) return null;
    return {
      chain,
      from: wallet.address,
      recipient: resolved.address,
      amount: parsed.value,
      memo: memo.trim() || undefined,
      requestId: lockedRequest?.request.id,
      requestCreatedAt: lockedRequest?.request.createdAt,
      requestExpiresAt: lockedRequest?.request.expiresAt,
      dataSuffix: lockedRequest ? requestIdSuffix(lockedRequest.request.id) : undefined,
    };
  };

  const handleReview = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!wallet.isConnected) return onOpenConnectWallet();
    if (!chain) return setFormError('Switch to a supported Mezo network first.');
    if (lockedRequest && lockedRequest.request.chainId !== chain.chainId) return setFormError('This request is for a different network. Switch networks first.');
    if (lockedRequest && isExpired(lockedRequest.request.expiresAt)) return setFormError('This request has expired.');
    if (!recipientInput.trim()) return setFormError('Enter a @username or wallet address.');
    if (!resolved) return setFormError(resolutionError || 'Wait for the recipient to resolve.');
    if (!parsed.ok) return setFormError(parsed.error);
    if (available === null) return setFormError('Your MUSD balance has not loaded yet. Try again in a moment.');
    if (parsed.value > available) return setFormError(`Amount exceeds your ${isDemo ? 'demo ' : ''}balance of ${formatTokenDisplay(available, decimals)} MUSD.`);
    if (memo.length > MEMO_MAX) return setFormError(`Keep the note under ${MEMO_MAX} characters.`);

    if (isDemo) return setStep('review');
    const params = buildParams();
    if (!params) return;
    setPreparing(true);
    const preview = await transfer.prepare(params);
    setPreparing(false);
    if (preview) { reviewed.current = params; setStep('review'); }
  };

  const handleConfirm = async () => {
    if (confirming.current) return;
    if (lockedRequest && isExpired(lockedRequest.request.expiresAt)) {
      setFormError('This request expired before it was paid.');
      return;
    }
    if (isDemo) {
      if (resolved && parsed.ok) onDemoSend?.({ recipient: resolved.address, recipientLabel: resolved.label, amount: parsed.value, memo: memo.trim() });
      setDemoDone(true);
      setStep('result');
      return;
    }
    const params = reviewed.current;
    if (!params) return;
    if (params.from.toLowerCase() !== wallet.address?.toLowerCase() || params.chain.chainId !== wallet.chainId) {
      setFormError('Your account or network changed. Review the transfer again.');
      setStep('form');
      return;
    }
    confirming.current = true;
    setStep('result');
    try {
      await transfer.send(params);
    } finally {
      confirming.current = false;
    }
  };

  const handleClose = () => {
    if (busy) return; // never hide an in-flight transaction
    onClose();
  };

  const setFraction = (bps: number) => {
    if (available === null) return;
    setAmountInput(formatUnitsExact(bpsOf(available, bps), decimals));
    setFormError(null);
  };

  const phase = transfer.phase;
  const canRetry = phase.phase === 'rejected' || phase.phase === 'failed';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center sm:justify-end bg-black/60 dark:bg-black/80 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={handleClose}
      onKeyDown={(e) => e.key === 'Escape' && handleClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-modal-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative bg-[#FFFFFF] dark:bg-[#141416] w-full max-w-lg h-full sm:h-auto sm:max-h-[92vh] sm:rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] flex flex-col shadow-2xl overflow-y-auto outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <HalftonePattern variant="corner" className="absolute right-0 top-0 w-36 h-36 opacity-10 dark:opacity-15 pointer-events-none" />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-[#E2E2E0] dark:border-[#26262B]">
          <div className="flex items-center gap-3">
            {step === 'review' ? (
              <button
                type="button"
                onClick={() => setStep('form')}
                disabled={busy}
                className="p-1.5 rounded-lg border border-[#E2E2E0] dark:border-[#26262B] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] text-[#111111] dark:text-[#FFFFFF] transition-all"
                aria-label="Back to edit"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] flex items-center justify-center shadow-xs">
                <ArrowUpRight className="w-4 h-4" />
              </div>
            )}
            <h2 id="send-modal-title" className="text-base font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight font-sans">
              {step === 'review' ? 'Review transfer' : step === 'result' ? 'Transfer status' : lockedRequest ? 'Pay request' : 'Send MUSD'}
            </h2>
            {isDemo && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300">
                <FlaskConical className="w-3 h-3" /> Demo
              </span>
            )}
          </div>
          <button
            onClick={handleClose}
            disabled={busy}
            className="p-2 text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] rounded-xl hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] transition-all duration-150 disabled:opacity-40"
            aria-label="Close dialog"
            title={busy ? 'A transaction is in progress' : 'Close'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative z-10 p-6 flex-1 space-y-5">
          {/* RESULT */}
          {step === 'result' && chain && (
            <div className="space-y-4">
              {isDemo && demoDone ? (
                <div className="p-4 rounded-2xl border bg-violet-500/10 border-violet-500/30 text-violet-800 dark:text-violet-300 text-xs space-y-1">
                  <p className="text-sm font-bold">Simulated transfer recorded</p>
                  <p>
                    Demo mode: {parsed.ok ? formatTokenDisplay(parsed.value, decimals) : ''} MUSD to {resolved?.label}. No transaction was created and no
                    funds moved.
                  </p>
                </div>
              ) : (
                <TxStatusPanel
                  phase={phase}
                  chain={chain}
                  onRecheck={'hash' in phase ? () => transfer.recheck(chain.chainId, phase.hash) : undefined}
                  details={[
                    { label: 'Recipient', value: resolved ? `${resolved.label}` : '' },
                    { label: 'Address', value: <span className="font-mono text-[11px]">{resolved?.address}</span> },
                    { label: 'Amount', value: parsed.ok ? `${formatTokenDisplay(parsed.value, decimals, { maxFractionDigits: 6 })} MUSD` : '' },
                    ...(lockedRequest ? [{ label: 'Request', value: <span className="font-mono text-[11px]">{lockedRequest.request.id.slice(0, 12)}…</span> }] : []),
                  ]}
                />
              )}

              {canRetry && (
                <button
                  type="button"
                  onClick={() => {
                    transfer.reset();
                    setStep('review');
                    settledNotified.current = null;
                  }}
                  className="w-full py-3 rounded-2xl border border-[#E2E2E0] dark:border-[#26262B] text-xs font-semibold hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F]"
                >
                  Back to review
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                disabled={busy}
                className="w-full py-3.5 rounded-2xl bg-[#111111] hover:bg-[#262626] dark:bg-[#FFFFFF] dark:text-[#111111] text-white text-xs font-semibold disabled:opacity-50"
              >
                {busy ? 'Waiting for the network…' : 'Done'}
              </button>
            </div>
          )}

          {/* REVIEW */}
          {step === 'review' && resolved && parsed.ok && chain && musd && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="p-5 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-3">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#777777] dark:text-[#A0A0A0]">Recipient</div>
                <div className="text-base font-bold text-[#111111] dark:text-[#FFFFFF]">{resolved.label}</div>
                <div className="font-mono text-xs text-[#555555] dark:text-[#A0A0A0] break-all bg-white dark:bg-[#141416] p-2.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B]">
                  {resolved.address}
                </div>
                {resolved.verifiedName ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {resolved.label} is registered to this address (ownership proven by wallet signature).
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Entered as a raw address. Check every character — transfers cannot be reversed.</span>
                  </div>
                )}
              </div>

              <div className="p-4 rounded-2xl bg-[#F0F0EE]/80 dark:bg-[#1A1A1D]/80 border border-[#E2E2E0] dark:border-[#26262B] space-y-2 text-xs">
                <Row label="Amount">
                  <span className="text-lg font-bold font-mono">{formatTokenDisplay(parsed.value, decimals, { maxFractionDigits: 6 })} MUSD</span>
                  <span className="block text-[11px] text-[#777777] dark:text-[#A0A0A0]">≈ {fiat ? `${fiat.formatted} ${preferredCurrency}` : 'Price unavailable'}</span>
                </Row>
                <Row label="Token">
                  <a href={explorerTokenUrl(chain, musd.address)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono hover:underline">
                    MUSD · {shortenAddress(musd.address)} <ExternalLink className="w-3 h-3" />
                  </a>
                </Row>
                <Row label="Network">
                  {chain.name} (chain {chain.chainId}){!chain.isTestnet && <span className="ml-1 text-red-600 dark:text-red-400 font-semibold">· real funds</span>}
                </Row>
                <Row label="Network fee">
                  {isDemo ? 'None (simulated)' : transfer.preview ? `≈ ${formatTokenDisplay(transfer.preview.estimatedFee, 18, { maxFractionDigits: 18, minFractionDigits: 0 })} BTC (estimate)` : '—'}
                </Row>
                {memo && <Row label="Note (this device)"><span className="truncate max-w-[220px] inline-block align-bottom">{memo}</span></Row>}
                {lockedRequest && <Row label="Request id"><span className="font-mono text-[11px]">{lockedRequest.request.id}</span></Row>}
              </div>

              {formError && <ErrorBox message={formError} />}

              <div className="pt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  disabled={busy}
                  className="flex-1 py-3.5 px-4 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416] hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F] text-xs font-semibold"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={busy}
                  className="flex-1 py-3.5 px-4 rounded-xl bg-[#111111] hover:bg-[#262626] dark:bg-[#FFFFFF] dark:text-[#111111] text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                  <span>{isDemo ? 'Simulate transfer' : 'Confirm in wallet'}</span>
                </button>
              </div>
              {!isDemo && (
                <p className="text-[11px] text-center text-[#777777] dark:text-[#A0A0A0]">
                  Your wallet will show the exact transaction. Cambio never holds your keys or funds.
                </p>
              )}
            </div>
          )}

          {/* FORM */}
          {step === 'form' && (
            <form onSubmit={handleReview} className="space-y-5" noValidate>
              {!wallet.isConnected ? (
                <div className="p-4 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-start gap-3 text-xs text-[#777777] dark:text-[#A0A0A0]">
                  <Wallet className="w-4 h-4 text-[#111111] dark:text-[#FFFFFF] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-[#111111] dark:text-[#FFFFFF] font-mono text-[11px] uppercase">Wallet disconnected</span>
                    <p className="mt-0.5">Connect a wallet to send MUSD. You approve every transfer in your own wallet.</p>
                    <button type="button" onClick={() => { onClose(); onOpenConnectWallet(); }} className="mt-2 text-[#111111] dark:text-[#FFFFFF] font-mono text-[11px] font-bold uppercase underline">
                      Connect wallet →
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <NetworkGuard wallet={wallet} purpose="to send MUSD" />
                  <div className="p-3 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-between text-xs">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">From</span>
                    <span className="font-mono font-semibold text-[#111111] dark:text-[#FFFFFF]">
                      {wallet.username ? `@${wallet.username}` : shortenAddress(wallet.address)}
                      {chain && <span className="ml-2 font-normal text-[#777777] dark:text-[#A0A0A0]">on {chain.name}</span>}
                    </span>
                  </div>
                </>
              )}

              {lockedRequest && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Paying a request signed by the recipient’s wallet. Recipient and amount are locked to what they signed.</span>
                </div>
              )}

              {/* Recipient */}
              <div className="space-y-1.5">
                <label htmlFor="send-recipient" className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF]">
                  Recipient
                </label>
                <div className="relative">
                  <input
                    id="send-recipient"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={recipientInput}
                    readOnly={!!lockedRequest}
                    onChange={(e) => { setRecipientInput(e.target.value); setFormError(null); }}
                    placeholder="@username or 0x wallet address"
                    aria-describedby="send-recipient-status"
                    className="w-full pl-4 pr-10 py-3 text-sm rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] focus:bg-white dark:focus:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] focus:border-[#111111] dark:focus:border-[#FFFFFF] text-[#111111] dark:text-[#FFFFFF] placeholder-[#777777]/70 outline-none font-mono read-only:opacity-80"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    {resolving ? <Loader2 className="w-4 h-4 animate-spin text-[#777777]" /> : resolved ? <Check className="w-4 h-4 text-emerald-500" /> : recipientInput.trim() ? <AtSign className="w-4 h-4 text-[#777777]" /> : null}
                  </span>
                </div>
                <div id="send-recipient-status" aria-live="polite">
                  {resolved ? (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono space-y-1">
                      <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 font-semibold text-[11px]">
                        <span>{resolved.label}</span>
                        <span>{resolved.verifiedName ? 'Verified username' : 'Valid address'}</span>
                      </div>
                      <div className="text-[11px] text-[#555555] dark:text-[#A0A0A0] break-all">{resolved.address}</div>
                    </div>
                  ) : resolutionError ? (
                    <p className="text-[11px] font-mono text-red-600 dark:text-red-400 flex items-center gap-1 pt-0.5">
                      <AlertCircle className="w-3 h-3 shrink-0" /> {resolutionError}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="send-amount" className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF]">
                    Amount (MUSD)
                  </label>
                  <span className="text-[11px] font-mono text-[#777777] dark:text-[#A0A0A0]">
                    Available: <BalanceValue balance={balance} compact className="font-semibold text-[#111111] dark:text-[#FFFFFF] tabular-nums" />
                  </span>
                </div>
                <div className="relative">
                  <input
                    id="send-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amountInput}
                    readOnly={!!lockedRequest}
                    onChange={(e) => { setAmountInput(e.target.value.replace(',', '.')); setFormError(null); }}
                    placeholder="0.00"
                    aria-invalid={!!amountInput && !parsed.ok}
                    className="w-full px-4 py-3.5 pr-20 text-2xl font-mono font-bold rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] focus:bg-white dark:focus:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] focus:border-[#111111] dark:focus:border-[#FFFFFF] text-[#111111] dark:text-[#FFFFFF] tabular-nums outline-none read-only:opacity-80"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono font-bold uppercase text-[#111111] dark:text-[#FFFFFF] bg-white dark:bg-[#26262B] border border-[#E2E2E0] dark:border-[#3A3A40] px-2 py-1 rounded-md">
                    MUSD
                  </span>
                </div>
                {amountInput && !parsed.ok ? (
                  <p className="text-[11px] font-mono text-red-600 dark:text-red-400 px-1">{parsed.error}</p>
                ) : parsed.ok ? (
                  <p className="flex items-center justify-between text-[11px] font-mono text-[#777777] dark:text-[#A0A0A0] px-1">
                    <span>Estimated value</span>
                    <span className="font-semibold text-[#111111] dark:text-[#FFFFFF]">≈ {fiat ? `${fiat.formatted} ${preferredCurrency}` : 'Price unavailable'}</span>
                  </p>
                ) : null}
                {wallet.isConnected && !lockedRequest && available !== null && (
                  <div className="flex items-center gap-2 pt-1">
                    {[{ label: '25%', bps: 2500 }, { label: '50%', bps: 5000 }, { label: 'Max', bps: 10_000 }].map((b) => (
                      <button
                        type="button"
                        key={b.label}
                        onClick={() => setFraction(b.bps)}
                        className="px-3 py-1 text-[10px] font-mono font-semibold uppercase rounded-lg bg-white dark:bg-[#1C1C1F] hover:bg-[#111111] dark:hover:bg-[#FFFFFF] border border-[#E2E2E0] dark:border-[#26262B] text-[#111111] dark:text-[#FFFFFF] hover:text-white dark:hover:text-[#111111] transition-all"
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Memo */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="send-memo" className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF]">
                    Private note <span className="font-normal normal-case text-[#777777] dark:text-[#A0A0A0]">(optional, this device only)</span>
                  </label>
                  <span className="text-[10px] font-mono text-[#777777]">{memo.length}/{MEMO_MAX}</span>
                </div>
                <input
                  id="send-memo"
                  type="text"
                  maxLength={MEMO_MAX}
                  value={memo}
                  readOnly={!!lockedRequest}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="e.g. Dinner split"
                  className="w-full px-4 py-2.5 text-sm rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] focus:bg-white dark:focus:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] focus:border-[#111111] dark:focus:border-[#FFFFFF] text-[#111111] dark:text-[#FFFFFF] outline-none read-only:opacity-80"
                />
                <p className="text-[10px] text-[#777777] dark:text-[#A0A0A0]">ERC-20 transfers carry no message on-chain. This note is stored only in this browser.</p>
              </div>

              {(formError || transfer.previewError) && <ErrorBox message={formError || transfer.previewError!} />}

              <button
                type="submit"
                disabled={preparing || (wallet.isConnected && (!wallet.isSupportedNetwork || available === null))}
                className="group w-full py-3.5 rounded-2xl bg-[#111111] hover:bg-[#262626] dark:bg-[#FFFFFF] dark:text-[#111111] text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {!wallet.isConnected ? (
                  'Connect wallet to send'
                ) : preparing ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking balance and fee…</>
                ) : (
                  <>Review transfer <ArrowUpRight className="w-4 h-4" /></>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0] shrink-0">{label}</span>
      <span className="text-right text-[#111111] dark:text-[#FFFFFF]">{children}</span>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
      <AlertCircle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
