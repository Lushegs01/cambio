/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merchant Pro (testnet proof of concept). Shows the plan, the merchant's server-verified entitlement,
 * and lets them pay a subscription order from their own wallet. Nothing is charged automatically.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Download, Loader2, Sparkles } from 'lucide-react';
import { getAddress, type Hex } from 'viem';
import type { MezoChainConfig } from '../config/chains';
import type { WalletState } from '../types';
import { REQUEST_VERSION, type SignedPaymentRequest } from '../lib/paymentRequest';
import { syncSettlementToRegistry } from '../lib/paymentJourney';
import { shortenAddress } from '../utils/format';
import { createBillingOrder, downloadReconciliationReport, getBillingStatus, InvoiceApiError, submitBillingPayment, type BillingOrder, type BillingStatus } from '../services/invoiceClient';
import { SendModal } from './SendModal';

/** The order as the payment the wallet sends: MUSD.transfer(treasury, price) ‖ CMB2 ‖ orderId. */
function orderAsRequest(o: BillingOrder): SignedPaymentRequest {
  return { v: REQUEST_VERSION, id: o.id, chainId: o.chainId, token: getAddress(o.token), recipient: getAddress(o.treasury), amount: o.amount, memo: '', createdAt: o.createdAt, expiresAt: o.expiresAt };
}

interface Props {
  token: string;
  wallet: WalletState;
  chain: MezoChainConfig;
  onOpenConnectWallet?: () => void;
}

export const MerchantProCard: React.FC<Props> = ({ token, wallet, chain, onOpenConnectWallet }) => {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<BillingOrder | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState<'order' | 'verify' | 'report' | null>(null);
  const [verifyNote, setVerifyNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getBillingStatus(token));
      setError(null);
    } catch (err) {
      setError(err instanceof InvoiceApiError && err.status === 503 ? null : 'Could not load Merchant Pro status.');
      if (err instanceof InvoiceApiError && err.status === 503) setStatus(null);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subscribe = async () => {
    setBusy('order');
    setError(null);
    try {
      setOrder(await createBillingOrder(token));
      setPayOpen(true);
    } catch (err) {
      setError(err instanceof InvoiceApiError ? err.message : 'Could not create an order.');
    } finally {
      setBusy(null);
    }
  };

  const onPaid = async (hash: Hex) => {
    if (!order) return;
    setBusy('verify');
    setVerifyNote('Verifying your payment on-chain…');
    const result = await syncSettlementToRegistry({
      save: async () => undefined,
      submit: () => submitBillingPayment(token, order.id, hash).then((s) => setStatus(s)),
    });
    setBusy(null);
    setVerifyNote(
      result.state === 'recorded'
        ? 'Payment verified on-chain. Merchant Pro is active.'
        : result.state === 'rejected'
          ? `Not accepted: ${result.message}`
          : `${result.state === 'unavailable' ? result.message : ''} Your MUSD payment is on-chain; reload this page to retry verification. Do not pay again.`
    );
    refresh();
  };

  const report = async () => {
    setBusy('report');
    setError(null);
    try {
      const blob = await downloadReconciliationReport(token);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cambio-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      setError(err instanceof InvoiceApiError ? err.message : 'Could not download the report.');
    } finally {
      setBusy(null);
    }
  };

  // Stable identity: SendModal re-initialises its form whenever lockedRequest changes.
  const periodDays = status?.periodDays;
  const locked = useMemo(
    () =>
      order
        ? {
            request: orderAsRequest(order),
            recipientLabel: `Cambio treasury ${shortenAddress(order.treasury)}`,
            notice: `Merchant Pro subscription order ${order.id.slice(0, 10)}… issued by the Cambio server for ${periodDays} days. Recipient, amount and order id are fixed by the server and verified on-chain after you pay.`,
          }
        : null,
    [order, periodDays]
  );

  if (!status) return null;
  const pendingOrder = status.orders.find((o) => o.status === 'open' && o.expiresAt > Date.now() / 1000);
  const reportLocked = status.enabled && !status.active;

  return (
    <div className="p-4 rounded-2xl border border-[#E2E2E0] dark:border-[#26262B] bg-[#F5F5F3] dark:bg-[#1A1A1D] space-y-3" data-testid="merchant-pro">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold flex items-center gap-2">
            {status.active ? <BadgeCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />} Merchant Pro
            {status.isTestnet && <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-300">Testnet pilot</span>}
          </p>
          <p className="text-xs text-[#555555] dark:text-[#A0A0A0] mt-1">
            {!status.enabled
              ? 'Billing is not enabled on this deployment, so every merchant feature is free during the pilot.'
              : status.active
                ? `Active until ${new Date(status.proUntil!).toLocaleDateString(undefined, { dateStyle: 'medium' })}. Verified from your on-chain MUSD payment.`
                : `${status.priceMusd} MUSD per ${status.periodDays} days, paid from your wallet to ${shortenAddress(status.treasury!)}. Unlocks the server-verified reconciliation report.`}
          </p>
        </div>
        <div className="flex flex-col sm:items-end gap-2 shrink-0">
          {status.enabled && !status.active && (
            <button type="button" onClick={subscribe} disabled={!!busy || wallet.dataMode === 'demo'} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#111111] text-white dark:bg-[#FFFFFF] dark:text-[#111111] text-xs font-semibold disabled:opacity-50">
              {busy === 'order' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} {pendingOrder ? 'Resume subscription payment' : `Subscribe · ${status.priceMusd} MUSD`}
            </button>
          )}
          {status.enabled && status.active && (
            <button type="button" onClick={subscribe} disabled={!!busy} className="text-[11px] font-semibold underline">Renew (adds {status.periodDays} days)</button>
          )}
          <button type="button" onClick={report} disabled={!!busy || reportLocked} title={reportLocked ? 'Part of Merchant Pro' : undefined} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] text-xs font-semibold disabled:opacity-50">
            {busy === 'report' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Reconciliation report{reportLocked ? ' (Pro)' : ''}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-[#777777] dark:text-[#A0A0A0]">
        No fee is ever taken from your invoice payments. A subscription is a separate MUSD transfer you approve in your wallet; it carries the order id in its calldata so the server can verify exactly that payment.
        {status.isTestnet ? ' Testnet MUSD has no monetary value: this tests the mechanism, not revenue.' : ''}
      </p>
      {verifyNote && <p className="text-xs" role="status" aria-live="polite">{busy === 'verify' && <Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1" />}{verifyNote}</p>}
      {error && <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">{error}</p>}

      {order && (
        <SendModal
          isOpen={payOpen}
          onClose={() => setPayOpen(false)}
          wallet={wallet}
          onOpenConnectWallet={onOpenConnectWallet ?? (() => undefined)}
          lockedRequest={locked}
          onRequestPaid={onPaid}
        />
      )}
      {chain.chainId !== status.chainId && <p className="text-xs text-amber-700">Switch to chain {status.chainId} to subscribe.</p>}
    </div>
  );
};
