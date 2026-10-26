/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { X, Copy, Check, ArrowDownLeft, Share2, Wallet, Download, QrCode, Link as LinkIcon, Eye, ExternalLink, AtSign } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import type { WalletState } from '../types';
import { copyToClipboard, getExplorerAddressUrl } from '../utils/format';
import { HalftonePattern } from './HalftonePattern';
import { useCurrency } from '../context/CurrencyContext';
import { NetworkGuard } from './NetworkGuard';
import { formatUnitsExact, parseTokenAmount, toDisplayNumber } from '../lib/amounts';

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: WalletState;
  onOpenConnectWallet: () => void;
  onOpenCreateUsername?: () => void;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({ isOpen, onClose, wallet, onOpenConnectWallet, onOpenCreateUsername }) => {
  const { preferredCurrency, formatTokenFiat } = useCurrency();
  const [copied, setCopied] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [qrMode, setQrMode] = useState<'wallet' | 'link'>('link');
  const [showPayload, setShowPayload] = useState(false);

  const chain = wallet.chain;
  const musd = chain?.tokens.MUSD;
  const parsed = useMemo(() => (amountInput ? parseTokenAmount(amountInput, musd?.decimals ?? 18) : null), [amountInput, musd]);
  const amount = parsed?.ok ? parsed.value : null;

  if (!isOpen) return null;

  const flash = async (key: string, text: string) => {
    if (await copyToClipboard(text)) {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    }
  };

  const address = wallet.isConnected ? wallet.address : null;
  // Web link: opens Cambio's payment page. Unsigned, so the payer is told to check the address.
  const paymentLink =
    address && chain
      ? `${window.location.origin}/#pay?to=${address}&chain=${chain.chainId}${amount ? `&amt=${formatUnitsExact(amount, musd!.decimals)}` : ''}`
      : '';
  // EIP-681 ERC-20 transfer URI: ethereum:<token>@<chainId>/transfer?address=<recipient>&uint256=<base units>
  const walletUri =
    address && chain && musd ? `ethereum:${musd.address}@${chain.chainId}/transfer?address=${address}${amount ? `&uint256=${amount.toString()}` : ''}` : '';
  const qrValue = qrMode === 'link' ? paymentLink : walletUri;
  const fiat = amount && musd ? formatTokenFiat(toDisplayNumber(amount, musd.decimals), 'MUSD') : null;
  const explorer = getExplorerAddressUrl(address, wallet.chainId);

  const handleDownloadQr = () => {
    const canvas = document.getElementById('cambio-receive-qr-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `cambio-receive-${(wallet.username || address || '').slice(0, 10)}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShare = async () => {
    if (!paymentLink) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Pay me in MUSD on Cambio', url: paymentLink });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    flash('link', paymentLink);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center sm:justify-end bg-black/60 dark:bg-black/80 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="receive-modal-title"
    >
      <div
        className="relative bg-[#FFFFFF] dark:bg-[#141416] w-full max-w-lg h-full sm:h-auto sm:max-h-[92vh] sm:rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] flex flex-col shadow-2xl overflow-y-auto font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        <HalftonePattern variant="corner" className="absolute right-0 top-0 w-36 h-36 opacity-10 dark:opacity-15 pointer-events-none" />

        <div className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-[#E2E2E0] dark:border-[#26262B]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] flex items-center justify-center shadow-xs">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
            <h2 id="receive-modal-title" className="text-base font-bold text-[#111111] dark:text-[#FFFFFF] tracking-tight">
              Receive MUSD
            </h2>
          </div>
          <button onClick={onClose} className="p-2 text-[#777777] dark:text-[#A0A0A0] hover:text-[#111111] dark:hover:text-[#FFFFFF] rounded-xl hover:bg-[#F0F0EE] dark:hover:bg-[#1C1C1F]" aria-label="Close dialog">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative z-10 p-6 flex-1 space-y-5">
          {!address ? (
            <div className="p-6 rounded-2xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] text-center space-y-3">
              <Wallet className="w-6 h-6 mx-auto text-[#777777]" />
              <p className="text-sm font-semibold text-[#111111] dark:text-[#FFFFFF]">Connect a wallet to get your receiving address</p>
              <p className="text-xs text-[#777777] dark:text-[#A0A0A0]">Cambio only ever shows your own connected address here.</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenConnectWallet();
                }}
                className="px-4 py-2 rounded-xl bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111] text-xs font-semibold"
              >
                Connect wallet
              </button>
            </div>
          ) : (
            <>
              <NetworkGuard wallet={wallet} purpose="to create an MUSD payment QR code" />

              {wallet.username ? (
                <div className="p-4 rounded-2xl bg-[#F5F5F3] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B] flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#777777] dark:text-[#A0A0A0] block">Your verified username</span>
                    <span className="text-xl font-bold tracking-tight text-[#111111] dark:text-[#FFFFFF]">@{wallet.username}</span>
                  </div>
                  <button type="button" onClick={() => flash('username', `@${wallet.username}`)} className="px-3 py-1.5 rounded-xl bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] text-xs font-semibold flex items-center gap-1.5">
                    {copied === 'username' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied === 'username' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ) : (
                onOpenCreateUsername && (
                  <button type="button" onClick={onOpenCreateUsername} className="w-full p-3 rounded-2xl border border-dashed border-[#C8C8C5] dark:border-[#3A3A40] text-xs text-[#555555] dark:text-[#A0A0A0] flex items-center justify-center gap-1.5 hover:border-[#111111] dark:hover:border-[#FFFFFF]">
                    <AtSign className="w-3.5 h-3.5" /> Claim a @username so people can pay you without copying an address
                  </button>
                )
              )}

              {chain && musd && (
                <div className="flex flex-col items-center p-5 bg-[#F0F0EE] dark:bg-[#1A1A1D] rounded-2xl border border-[#E2E2E0] dark:border-[#26262B] space-y-4">
                  <div className="flex items-center gap-1 p-1 rounded-xl bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] text-xs" role="tablist">
                    {([
                      ['link', 'Cambio link', LinkIcon],
                      ['wallet', 'Wallet app (EIP-681)', QrCode],
                    ] as const).map(([key, label, Icon]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={qrMode === key}
                        onClick={() => setQrMode(key)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${qrMode === key ? 'bg-[#111111] dark:bg-[#FFFFFF] text-white dark:text-[#111111]' : 'text-[#777777] dark:text-[#A0A0A0]'}`}
                      >
                        <Icon className="w-3.5 h-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                  <div className="p-4 bg-white rounded-2xl shadow-sm border border-[#E2E2E0]">
                    <QRCodeCanvas id="cambio-receive-qr-canvas" value={qrValue} size={200} level="M" marginSize={2} fgColor="#000000" bgColor="#FFFFFF" />
                  </div>
                  <p className="text-xs text-center text-[#777777] dark:text-[#A0A0A0] max-w-xs">
                    {qrMode === 'link'
                      ? 'Opens Cambio’s payment page with your address prefilled. For a link the payer can verify, create a signed request on the Request page.'
                      : `MUSD transfer on ${chain.name} (chain ${chain.chainId}) for wallets that support EIP-681. Support varies by wallet.`}
                  </p>
                  {amount && (
                    <div className="font-mono text-sm font-semibold text-[#111111] dark:text-[#FFFFFF]">
                      Requesting {formatUnitsExact(amount, musd.decimals)} MUSD{' '}
                      <span className="text-xs font-normal text-[#777777]">≈ {fiat ? `${fiat.formatted} ${preferredCurrency}` : 'price unavailable'}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-center gap-2">
                    <SmallButton onClick={handleDownloadQr} icon={<Download className="w-3.5 h-3.5" />}>Download QR</SmallButton>
                    <SmallButton onClick={() => setShowPayload((v) => !v)} icon={<Eye className="w-3.5 h-3.5" />}>{showPayload ? 'Hide QR contents' : 'Show QR contents'}</SmallButton>
                  </div>
                  {showPayload && (
                    <div className="w-full p-3 rounded-xl bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] space-y-2">
                      <code className="block text-[11px] font-mono break-all text-[#111111] dark:text-[#FFFFFF]">{qrValue}</code>
                      <div className="flex gap-3 text-[11px]">
                        <button type="button" onClick={() => flash('payload', qrValue)} className="font-semibold hover:underline">
                          {copied === 'payload' ? 'Copied' : 'Copy'}
                        </button>
                        {qrMode === 'link' && (
                          <a href={paymentLink} className="font-semibold hover:underline inline-flex items-center gap-1" onClick={onClose}>
                            Preview payment page <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF]">Your wallet address</span>
                  {explorer && (
                    <a href={explorer} target="_blank" rel="noopener noreferrer" className="text-[#777777] hover:underline inline-flex items-center gap-1">
                      Explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] border border-[#E2E2E0] dark:border-[#26262B]">
                  <span className="font-mono text-xs text-[#111111] dark:text-[#FFFFFF] break-all flex-1">{address}</span>
                  <button onClick={() => flash('address', address)} className="shrink-0 p-2 rounded-lg bg-white dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] text-xs font-medium flex items-center gap-1.5">
                    {copied === 'address' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied === 'address' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-[11px] text-[#777777] dark:text-[#A0A0A0]">Only send MUSD on {chain ? chain.name : 'a supported Mezo network'} to this address.</p>
              </div>

              {chain && (
                <div className="pt-2 border-t border-[#E2E2E0] dark:border-[#26262B] space-y-3">
                  <label htmlFor="receive-amount" className="text-xs font-semibold uppercase tracking-wider text-[#111111] dark:text-[#FFFFFF]">
                    Amount <span className="font-normal normal-case text-[#777777]">(optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      id="receive-amount"
                      type="text"
                      inputMode="decimal"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value.replace(',', '.'))}
                      placeholder="0.00"
                      aria-invalid={!!parsed && !parsed.ok}
                      className="w-full px-4 py-2.5 text-sm rounded-xl bg-[#F0F0EE] dark:bg-[#1A1A1D] focus:bg-white dark:focus:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] focus:border-[#111111] dark:focus:border-[#FFFFFF] text-[#111111] dark:text-[#FFFFFF] tabular-nums outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#777777]">MUSD</span>
                  </div>
                  {parsed && !parsed.ok && <p className="text-[11px] text-red-600 dark:text-red-400">{parsed.error}</p>}
                  <button
                    onClick={handleShare}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#111111] hover:bg-[#262626] dark:bg-[#FFFFFF] dark:text-[#111111] text-white text-xs font-semibold uppercase tracking-wider"
                  >
                    {copied === 'link' ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                    {copied === 'link' ? 'Payment link copied' : 'Share payment link'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function SmallButton({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#141416] hover:bg-[#F0F0EE] dark:hover:bg-[#202024] border border-[#E2E2E0] dark:border-[#26262B] text-xs font-semibold text-[#111111] dark:text-[#FFFFFF]">
      {icon}
      {children}
    </button>
  );
}
