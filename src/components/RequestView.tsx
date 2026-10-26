import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QrCode, Copy, Check, Share2, Download, ArrowRight, AlertCircle, Wallet, ExternalLink, Trash2, ShieldCheck, Loader2, RefreshCw, PenLine } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { signTypedData } from 'wagmi/actions';
import type { Hex } from 'viem';
import type { WalletState } from '../types';
import { copyToClipboard, getExplorerAddressUrl, getExplorerTxUrl, shortenAddress } from '../utils/format';
import { HalftonePattern } from './HalftonePattern';
import { NetworkGuard } from './NetworkGuard';
import { wagmiConfig } from '../config/walletConnect';
import { formatTokenDisplay, parseTokenAmount } from '../lib/amounts';
import {
  buildPaymentRequest,
  deleteStoredRequest,
  encodePaymentLink,
  formatTimeRemaining,
  isExpired,
  loadStoredRequests,
  MAX_MEMO_LENGTH,
  saveStoredRequest,
  typedDataFor,
  verifyRequestSignature,
  type StoredRequest,
} from '../lib/paymentRequest';
import { classifyTxError } from '../lib/txErrors';
import { findRequestSettlement, type SettlementCheck } from '../lib/requestSettlement';
import { publicClientFor } from '../lib/wagmiDeps';
import { getChainConfig } from '../config/chains';

interface RequestViewProps {
  wallet: WalletState;
  onConnectWallet: () => void;
  onOpenPaymentRequestPage?: (url: string) => void;
}

const EXPIRY_OPTIONS = [
  { key: '24h', label: '24 hours', seconds: 24 * 3600 },
  { key: '7d', label: '7 days', seconds: 7 * 24 * 3600 },
  { key: '30d', label: '30 days', seconds: 30 * 24 * 3600 },
  { key: '90d', label: '90 days', seconds: 90 * 24 * 3600 },
] as const;

type Status = { kind: 'checking' } | { kind: 'paid'; hash: Hex; late: boolean } | { kind: 'unpaid' } | { kind: 'unknown'; message: string };

export const RequestView: React.FC<RequestViewProps> = ({ wallet, onConnectWallet, onOpenPaymentRequestPage }) => {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [expiry, setExpiry] = useState<(typeof EXPIRY_OPTIONS)[number]['key']>('7d');
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [current, setCurrent] = useState<StoredRequest | null>(null);
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<StoredRequest[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  const chain = wallet.chain;
  const decimals = chain?.tokens.MUSD.decimals ?? 18;
  const isDemo = wallet.dataMode === 'demo';
  const currentWallet = useRef('');
  currentWallet.current = `${wallet.address}:${wallet.chainId}`;
  const signLock = useRef(false);

  useEffect(() => {
    setRecent(wallet.address ? loadStoredRequests(wallet.address) : []);
    setCurrent(null);
  }, [wallet.address]);

  const url = useMemo(
    () => (current ? encodePaymentLink(window.location.origin, current.request, current.signature, current.settlementTx) : ''),
    [current]
  );

  const checkStatus = async (entry: StoredRequest) => {
    const reqChain = getChainConfig(entry.request.chainId);
    if (!reqChain) return;
    setStatuses((s) => ({ ...s, [entry.request.id]: { kind: 'checking' } }));
    const res: SettlementCheck = await findRequestSettlement(reqChain, publicClientFor(reqChain.chainId) as never, entry.request);
    setStatuses((s) => ({
      ...s,
      [entry.request.id]:
        res.state === 'settled'
          ? { kind: 'paid', hash: res.hash, late: res.result.status === 'settled_after_expiry' }
          : res.state === 'error'
          ? { kind: 'unknown', message: res.message }
          : { kind: 'unpaid' },
    }));
    if (res.state === 'settled') {
      const updated = { ...entry, settlementTx: res.hash };
      saveStoredRequest(updated);
      setRecent(loadStoredRequests(entry.request.recipient));
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signLock.current) return;
    setError(null);
    if (isDemo) return setError('Signed requests use your real wallet. Switch to real data to create one.');
    if (!wallet.isConnected || !wallet.address) return setError('Connect your wallet first. Requests pay out to your connected address.');
    if (!chain) return setError('Switch to a supported Mezo network first.');
    const parsed = parseTokenAmount(amount, decimals);
    if (!parsed.ok) return setError(parsed.error);
    if (note.length > MAX_MEMO_LENGTH) return setError(`Keep the note under ${MAX_MEMO_LENGTH} characters.`);

    let req;
    try {
      req = buildPaymentRequest({
        chain,
        recipient: wallet.address,
        amount: parsed.value,
        memo: note,
        lifetimeSeconds: EXPIRY_OPTIONS.find((o) => o.key === expiry)!.seconds,
      });
    } catch (err) {
      return setError((err as Error).message);
    }

    setSigning(true);
    signLock.current = true;
    const signingWallet = currentWallet.current;
    try {
      const signature = await signTypedData(wagmiConfig, { account: wallet.address, ...typedDataFor(req) });
      // Never share a link we could not verify ourselves.
      const ok = await verifyRequestSignature(req, signature, (args) => publicClientFor(chain.chainId).verifyTypedData(args));
      if (!ok) throw new Error('The wallet returned a signature that does not verify for this address.');
      if (signingWallet !== currentWallet.current) throw new Error('The connected account or network changed. Create a new request.');
      const entry: StoredRequest = { request: req, signature };
      saveStoredRequest(entry);
      setRecent(loadStoredRequests(wallet.address));
      setCurrent(entry);
      setStatuses((s) => ({ ...s, [req.id]: { kind: 'unpaid' } }));
    } catch (err) {
      const c = classifyTxError(err);
      setError(c.code === 'rejected' ? 'Signing was cancelled in your wallet. No request was created.' : (err as Error).message || c.message);
    } finally {
      signLock.current = false;
      setSigning(false);
    }
  };

  const handleCopy = async () => {
    if (url && (await copyToClipboard(url))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const handleShare = async () => {
    if (!url || !current) return;
    const text = `Payment request: ${formatTokenDisplay(BigInt(current.request.amount), decimals)} MUSD${current.request.memo ? ` · ${current.request.memo}` : ''}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Cambio payment request', text, url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    handleCopy();
  };

  const handleDownloadQr = () => {
    const canvas = document.getElementById('cambio-request-qr-canvas') as HTMLCanvasElement | null;
    if (!canvas || !current) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `cambio-request-${current.request.id.slice(2, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const status = current ? statuses[current.request.id] : undefined;
  const explorer = getExplorerAddressUrl(wallet.address, wallet.chainId);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      <div className="border-b border-[#E2E2E0] dark:border-[#26262B] pb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111111] dark:text-[#FFFFFF]">Request MUSD</h1>
        <p className="mt-1.5 text-sm text-[#555555] dark:text-[#A0A0A0] max-w-2xl">
          Create a payment request signed by your wallet. Anyone opening the link can verify it came from you, and that the amount and address were not changed.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
        <div className="lg:col-span-7 space-y-6">
          <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 shadow-xs">
            <div className="absolute -right-8 -top-8 w-48 h-48 pointer-events-none opacity-[0.08] dark:opacity-[0.12]">
              <HalftonePattern variant="sphere" className="w-full h-full" />
            </div>
            <form onSubmit={handleGenerate} className="relative z-10 space-y-5" noValidate>
              <div className="p-3.5 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0]">Paid to</span>
                  {chain && <span className="text-[11px] font-mono text-[#777777]">{chain.name}</span>}
                </div>
                {wallet.isConnected && wallet.address ? (
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-mono text-xs sm:text-sm font-semibold text-[#111111] dark:text-[#FFFFFF] truncate">
                      {wallet.username ? `@${wallet.username} · ` : ''}
                      {shortenAddress(wallet.address)}
                    </span>
                    {explorer && (
                      <a href={explorer} target="_blank" rel="noopener noreferrer" className="text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF] p-1" aria-label="View your address on the explorer">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <span className="text-xs text-[#777777] dark:text-[#A0A0A0]">Connect your wallet to receive MUSD.</span>
                    <button type="button" onClick={onConnectWallet} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] text-xs font-semibold shrink-0">
                      <Wallet className="w-3.5 h-3.5" /> Connect wallet
                    </button>
                  </div>
                )}
              </div>

              <NetworkGuard wallet={wallet} purpose="to create a request" />

              <div className="space-y-2">
                <label htmlFor="request-amount" className="block text-xs font-semibold text-[#111111] dark:text-[#FFFFFF] uppercase tracking-wider font-mono">
                  Amount *
                </label>
                <div className="relative">
                  <input
                    id="request-amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value.replace(',', '.')); setError(null); }}
                    className="w-full pl-4 pr-20 py-3.5 rounded-2xl bg-white dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-xl sm:text-2xl font-bold font-mono text-[#111111] dark:text-[#FFFFFF] focus:outline-none focus:border-[#111111] dark:focus:border-[#FFFFFF]"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono font-semibold text-[#777777] bg-[#F0F0EE] dark:bg-[#141416] px-2 py-1 rounded-md">MUSD</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {[10, 25, 50, 100, 250].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmount(String(v))}
                      className={`px-2.5 py-1 text-xs font-mono rounded-lg border ${amount === String(v) ? 'bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] border-[#111111]' : 'bg-white dark:bg-[#1A1A1D] text-[#555555] dark:text-[#A0A0A0] border-[#E2E2E0] dark:border-[#26262B]'}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="request-note" className="block text-xs font-semibold text-[#111111] dark:text-[#FFFFFF] uppercase tracking-wider font-mono">
                    Note <span className="font-normal lowercase text-[#777777]">(optional, visible to the payer)</span>
                  </label>
                  <span className="text-[10px] font-mono text-[#777777]">{note.length}/{MAX_MEMO_LENGTH}</span>
                </div>
                <input
                  id="request-note"
                  type="text"
                  maxLength={MAX_MEMO_LENGTH}
                  placeholder="e.g. Invoice #42 — logo design"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl bg-white dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-sm text-[#111111] dark:text-[#FFFFFF] focus:outline-none focus:border-[#111111] dark:focus:border-[#FFFFFF]"
                />
              </div>

              <fieldset className="space-y-1.5">
                <legend className="block text-xs font-semibold text-[#111111] dark:text-[#FFFFFF] uppercase tracking-wider font-mono">Expires after</legend>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {EXPIRY_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      aria-pressed={expiry === o.key}
                      onClick={() => setExpiry(o.key)}
                      className={`px-3 py-2 text-xs font-mono rounded-xl border ${expiry === o.key ? 'bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] border-[#111111] font-semibold' : 'bg-white dark:bg-[#1A1A1D] text-[#777777] border-[#E2E2E0] dark:border-[#26262B]'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              {error && (
                <div role="alert" className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!wallet.isConnected || !wallet.isSupportedNetwork || signing}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-sm font-semibold shadow-sm hover:bg-[#262626] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {signing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />}
                <span>{signing ? 'Sign in your wallet…' : 'Sign & create request'}</span>
              </button>
              <p className="text-[11px] text-[#777777] dark:text-[#A0A0A0] text-center">Signing is free and sends no transaction. It proves the request came from your wallet.</p>
            </form>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-6">
          {current && url ? (
            <div className="relative overflow-hidden bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-7 shadow-sm space-y-5">
              <div className="flex items-center justify-between pb-4 border-b border-[#E2E2E0] dark:border-[#26262B]">
                <span className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF]">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" /> Signed request
                </span>
                <button onClick={() => setCurrent(null)} className="text-[11px] font-mono text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF] underline">
                  New request
                </button>
              </div>
              <div className="text-center space-y-1">
                <div className="text-3xl sm:text-4xl font-bold font-mono tracking-tight text-[#111111] dark:text-[#FFFFFF]">
                  {formatTokenDisplay(BigInt(current.request.amount), decimals, { maxFractionDigits: 6 })} <span className="text-sm font-normal text-[#777777]">MUSD</span>
                </div>
                {current.request.memo && <p className="text-xs text-[#555555] dark:text-[#A0A0A0] italic truncate">“{current.request.memo}”</p>}
                <div className="text-[11px] font-mono text-[#777777]">{formatTimeRemaining(current.request.expiresAt)}</div>
                <RequestStatusLine status={status} chainId={current.request.chainId} />
              </div>
              <div className="flex flex-col items-center p-5 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] space-y-3">
                <div className="p-3 bg-white rounded-xl border border-[#E2E2E0]">
                  <QRCodeCanvas id="cambio-request-qr-canvas" value={url} size={196} level="L" marginSize={1} fgColor="#111111" bgColor="#FFFFFF" />
                </div>
                <button type="button" onClick={handleDownloadQr} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#111111] dark:text-[#FFFFFF] hover:underline">
                  <Download className="w-3 h-3" /> Download QR code
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="text" readOnly value={url} aria-label="Payment link" className="flex-1 px-3 py-2 text-xs font-mono rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-[#555555] truncate" />
                <button type="button" onClick={handleCopy} className={`px-3 py-2 text-xs font-medium rounded-xl border flex items-center gap-1.5 ${copied ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111]'}`}>
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={handleShare} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] text-xs font-medium">
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
                <button type="button" onClick={() => checkStatus(current)} disabled={status?.kind === 'checking'} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] text-xs font-medium disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${status?.kind === 'checking' ? 'animate-spin' : ''}`} /> Check paid
                </button>
                <button type="button" onClick={() => onOpenPaymentRequestPage?.(url)} className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] text-xs font-semibold">
                  Preview <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-6 sm:p-8 space-y-4 shadow-xs">
              <div className="w-10 h-10 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-center">
                <QrCode className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-[#111111] dark:text-[#FFFFFF]">How signed requests work</h2>
              <ol className="space-y-2 text-xs text-[#555555] dark:text-[#A0A0A0] list-decimal list-inside">
                <li>You sign the amount, note, expiry, network and your address with your wallet (EIP-712, no gas).</li>
                <li>The payer opens the link. Cambio checks the signature before showing a Pay button.</li>
                <li>The payment carries the request id in its calldata, so you can verify settlement on-chain.</li>
              </ol>
            </div>
          )}

          {recent.length > 0 && (
            <div className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-5 sm:p-6 space-y-3.5 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-[#E2E2E0] dark:border-[#26262B]">
                <span className="text-[11px] font-mono uppercase tracking-wider font-bold text-[#111111] dark:text-[#FFFFFF]">Your requests ({recent.length})</span>
                <span className="text-[10px] font-mono text-[#777777]">Saved on this device</span>
              </div>
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {recent.map((r) => {
                  const st = r.settlementTx ? ({ kind: 'paid', hash: r.settlementTx, late: false } as Status) : statuses[r.request.id];
                  return (
                    <li key={r.request.id} className="p-3 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] flex items-center justify-between gap-3 group">
                      <button type="button" onClick={() => setCurrent(r)} className="min-w-0 text-left flex-1">
                        <span className="text-sm font-bold font-mono text-[#111111] dark:text-[#FFFFFF]">{formatTokenDisplay(BigInt(r.request.amount), decimals)} MUSD</span>
                        <span className="ml-2 text-[10px] font-mono text-[#777777]">
                          {st?.kind === 'paid' ? 'Paid' : isExpired(r.request.expiresAt) ? 'Expired' : formatTimeRemaining(r.request.expiresAt)}
                        </span>
                        {r.request.memo && <span className="block text-[11px] text-[#777777] truncate max-w-[200px]">{r.request.memo}</span>}
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {st?.kind !== 'paid' && (
                          <button type="button" onClick={() => checkStatus(r)} className="p-1 text-[#777777] hover:text-[#111111] dark:hover:text-[#FFFFFF]" aria-label="Check if paid">
                            <RefreshCw className={`w-3.5 h-3.5 ${st?.kind === 'checking' ? 'animate-spin' : ''}`} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            deleteStoredRequest(r.request.recipient, r.request.id);
                            setRecent(loadStoredRequests(r.request.recipient));
                            if (current?.request.id === r.request.id) setCurrent(null);
                          }}
                          className="p-1 text-[#999999] hover:text-red-500"
                          aria-label="Remove from this device"
                          title="Removes it from this device only. The link stays valid until it expires."
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function RequestStatusLine({ status, chainId }: { status?: Status; chainId: number }) {
  if (!status) return null;
  if (status.kind === 'checking') return <p className="text-[11px] text-[#777777] inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking the chain…</p>;
  if (status.kind === 'unpaid') return <p className="text-[11px] text-[#777777]">No matching payment found on-chain yet.</p>;
  if (status.kind === 'unknown') return <p className="text-[11px] text-amber-600">{status.message}</p>;
  const href = getExplorerTxUrl(status.hash, chainId);
  return (
    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
      Paid — verified on-chain{status.late ? ' (after expiry)' : ''}.{' '}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
          View transaction
        </a>
      )}
    </p>
  );
}
