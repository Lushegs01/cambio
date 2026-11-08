/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public payment receipt and settlement proof. No wallet needed. Every fact shown as verified was
 * re-read from the Mezo RPC in this browser by the same checks as `npm run verify:evidence`.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CircleHelp, Copy, ExternalLink, Eye, EyeOff, Loader2, Printer, Share2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { Address } from 'viem';
import { getChainConfig, getDefaultChain, explorerTxUrl } from '../config/chains';
import { formatTokenDisplay } from '../lib/amounts';
import { ecdsaTypedDataVerifier, verifyRequestSignature } from '../lib/paymentRequest';
import { verifyWalletSignature } from '../../shared/signatureVerification';
import { CHECK_LABELS, proofUrl, verifyPublicProof, type ProofOutcome, type ProofRoute } from '../lib/proofViewer';
import { findRequestSettlement } from '../lib/requestSettlement';
import { publicClientFor } from '../lib/wagmiDeps';
import { getInvoice } from '../services/invoiceClient';
import { lookupAddress } from '../services/identityClient';
import { copyToClipboard, shortenAddress } from '../utils/format';
import type { EvidenceClient } from '../lib/evidence';
import { ThemeToggle } from './ThemeToggle';
import logoImage from '@/logo.png';

interface Props {
  route: ProofRoute;
  onGoToDashboard: () => void;
}

export const ProofPage: React.FC<Props> = ({ route, onGoToDashboard }) => {
  const chain = getChainConfig(getDefaultChain().chainId) ?? getDefaultChain();
  const [outcome, setOutcome] = useState<ProofOutcome | null>(null);
  const [run, setRun] = useState(0);
  const [merchantName, setMerchantName] = useState<string | null>(null);
  const [payerName, setPayerName] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOutcome(null);
    const client = publicClientFor(chain.chainId);
    verifyPublicProof(chain, route, {
      getInvoice: async (recipient, id) => {
        const inv = await getInvoice(recipient, id);
        return { request: inv.request, signature: inv.signature, settlement: inv.settlement ? { txHash: inv.settlement.txHash, verifiedAt: inv.settlement.verifiedAt } : null, duplicatePayments: inv.duplicatePayments };
      },
      verifySignature: (request, signature) =>
        verifyRequestSignature(request, signature, (args) =>
          verifyWalletSignature({
            signature: args.signature,
            verifyEoa: () => ecdsaTypedDataVerifier(args),
            getCode: () => client.getCode({ address: args.address }),
            verifyContract: () => client.verifyTypedData(args),
          })
        ),
      searchChain: async (request) => {
        const r = await findRequestSettlement(chain, client as never, request);
        return r.state === 'settled' ? r.hash : r.state === 'not_found' ? 'none' : 'unknown';
      },
      evidenceClient: client as unknown as EvidenceClient,
    }).then((o) => !cancelled && setOutcome(o));
    return () => {
      cancelled = true;
    };
  }, [chain, route, run]);

  const payer = outcome && 'result' in outcome ? (outcome.result.facts.from as Address | undefined) : undefined;
  useEffect(() => {
    let cancelled = false;
    lookupAddress(route.recipient).then((r) => !cancelled && setMerchantName(r?.display ?? null)).catch(() => undefined);
    if (payer) lookupAddress(payer).then((r) => !cancelled && setPayerName(r?.display ?? null)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [route.recipient, payer]);

  const shareUrl = useMemo(() => proofUrl(window.location.origin, route.recipient, route.id, route.tx), [route]);
  const invoice = outcome && 'invoice' in outcome ? outcome.invoice : null;
  const amount = invoice ? formatTokenDisplay(BigInt(invoice.request.amount), chain.tokens.MUSD.decimals, { maxFractionDigits: 6 }) : null;
  const facts = outcome && 'result' in outcome ? outcome.result.facts : {};
  const paidAt = facts.blockTime ? new Date(facts.blockTime) : null;
  const late = facts.late === 'true';

  const copy = async () => {
    if (await copyToClipboard(shareUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string; url: string }) => Promise<void> };
    if (nav.share) await nav.share({ title: 'Cambio payment proof', text: `MUSD payment proof for invoice ${route.id.slice(2, 10)}`, url: shareUrl }).catch(() => undefined);
    else await copy();
  };

  const verdict = !outcome ? 'loading' : outcome.state;

  return (
    <div className="min-h-screen bg-[#F5F5F3] dark:bg-[#0C0C0D] text-[#111111] dark:text-[#F5F5F7] antialiased print:bg-white">
      <header className="border-b border-[#E2E2E0] dark:border-[#26262B] bg-[#FFFFFF]/80 dark:bg-[#111113]/80 backdrop-blur-md print:hidden">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <button type="button" onClick={onGoToDashboard} className="flex items-center gap-2.5" aria-label="Open Cambio">
            <img src={logoImage} alt="" className="w-8 h-8 object-contain dark:invert" />
            <span className="text-[15px] font-bold tracking-[0.12em] uppercase">Cambio</span>
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">Payment receipt &amp; proof</h1>
          <span className="text-[11px] text-[#777777] dark:text-[#A0A0A0]">No wallet needed · verified in your browser</span>
        </div>

        {/* Verdict */}
        <section aria-live="polite" data-testid="proof-verdict" data-verdict={verdict}>
          {verdict === 'loading' ? (
            <Panel tone="info" icon={<Loader2 className="w-5 h-5 animate-spin" />} title="Verifying on Mezo…">
              Reading the signed invoice, then the transaction, receipt and block from the Mezo RPC.
            </Panel>
          ) : outcome!.state === 'verified' ? (
            <Panel tone="ok" icon={<ShieldCheck className="w-5 h-5" />} title={late ? 'Paid after expiry — verified on-chain' : 'Paid — verified on-chain'}>
              This transaction pays exactly this signed invoice: right merchant, right amount, and it carries the invoice&rsquo;s request ID in its calldata.
            </Panel>
          ) : outcome!.state === 'failed' ? (
            <Panel tone="bad" icon={<ShieldAlert className="w-5 h-5" />} title="Proof failed — this transaction does not settle this invoice">
              At least one check below contradicts the claim. Do not treat this invoice as paid by this transaction.
            </Panel>
          ) : outcome!.state === 'unpaid' ? (
            <Panel tone="warn" icon={<CircleHelp className="w-5 h-5" />} title={outcome!.searchComplete ? 'No settlement found' : 'Payment status unknown'}>
              {outcome!.searchComplete
                ? 'No transaction settling this invoice was found on-chain since it was created.'
                : 'Cambio could not search every payment to this merchant right now, so it cannot say this invoice is unpaid.'}
            </Panel>
          ) : outcome!.state === 'inconclusive' ? (
            <Panel tone="warn" icon={<CircleHelp className="w-5 h-5" />} title="Could not complete verification">
              Some facts could not be read from the network. This is not a failure of the payment; try again shortly.
            </Panel>
          ) : (
            <Panel tone="bad" icon={<X className="w-5 h-5" />} title={outcome!.state === 'no_invoice' ? 'Invoice not found' : outcome!.state === 'invalid_request' ? 'Invalid invoice' : 'Registry unavailable'}>
              {'reason' in outcome! ? outcome!.reason : ''}
            </Panel>
          )}
        </section>

        {/* Receipt */}
        {invoice && (
          <section className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-5 sm:p-7 space-y-4" aria-label="Receipt">
            <div className="text-center space-y-1">
              <div className="text-4xl font-bold font-mono tracking-tight" data-testid="proof-amount">{amount} <span className="text-base font-medium text-[#777777]">MUSD</span></div>
              <p className="text-xs text-[#777777] dark:text-[#A0A0A0]">{chain.name} · chain {chain.chainId}{chain.isTestnet ? ' · test funds, no monetary value' : ''}</p>
            </div>
            <dl className="text-xs divide-y divide-[#F0F0EE] dark:divide-[#1E1E22]">
              <Row term="Merchant">{merchantName ? <><strong>{merchantName}</strong> <span className="text-emerald-600">verified username</span><br /></> : null}<span className="font-mono break-all">{invoice.request.recipient}</span></Row>
              {payer && <Row term="Payer">{payerName ? <><strong>{payerName}</strong><br /></> : null}<span className="font-mono break-all">{payer}</span></Row>}
              <Row term="Date paid">{paidAt ? paidAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</Row>
              <Row term="Invoice created">{new Date(invoice.request.createdAt * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Row>
              <Row term="Invoice expires">{new Date(invoice.request.expiresAt * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Row>
              <Row term="Request reference"><span className="font-mono break-all">{invoice.request.id}</span></Row>
              {'hash' in outcome! && outcome!.hash && (
                <Row term="Transaction">
                  <a className="font-mono underline break-all inline-flex items-center gap-1" href={explorerTxUrl(chain, outcome!.hash)} target="_blank" rel="noopener noreferrer">
                    {shortenAddress(outcome!.hash, 12, 8)} <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                  </a>
                  {'source' in outcome! && outcome!.source && <span className="block text-[11px] text-[#777777]">Found via {outcome!.source === 'link' ? 'this link' : outcome!.source === 'registry' ? 'the merchant’s registry' : 'a chain search'} — re-verified here</span>}
                </Row>
              )}
              {facts.blockNumber && <Row term="Block">{facts.blockNumber}</Row>}
              {invoice.request.memo && (
                <Row term="Signed note">
                  {showNote ? <span className="break-words">“{invoice.request.memo}”</span> : <span className="text-[#777777]">Hidden</span>}{' '}
                  <button type="button" onClick={() => setShowNote((v) => !v)} className="ml-1 inline-flex items-center gap-1 underline print:hidden" aria-pressed={showNote}>
                    {showNote ? <EyeOff className="w-3 h-3" aria-hidden="true" /> : <Eye className="w-3 h-3" aria-hidden="true" />} {showNote ? 'Hide' : 'Show'}
                  </button>
                </Row>
              )}
              {invoice.duplicatePayments.length > 0 && <Row term="Other payments">{invoice.duplicatePayments.length} further transaction(s) also paid this invoice (recorded by the merchant&rsquo;s registry).</Row>}
            </dl>
          </section>
        )}

        {/* Checks */}
        {outcome && 'result' in outcome && (
          <section className="bg-[#FFFFFF] dark:bg-[#141416] rounded-3xl border border-[#E2E2E0] dark:border-[#26262B] p-5 sm:p-7 space-y-3" aria-label="Verification checks">
            <h2 className="text-sm font-bold">What was checked ({outcome.result.checks.filter((c) => c.ok === true).length}/{outcome.result.checks.length} passed)</h2>
            <ul className="space-y-2" data-testid="proof-checks">
              {outcome.result.checks.map((c) => (
                <li key={c.name} className="flex gap-2.5 text-xs" data-ok={String(c.ok)}>
                  <span className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${c.ok === true ? 'bg-emerald-500 text-white' : c.ok === false ? 'bg-red-500 text-white' : 'bg-amber-400 text-white'}`} aria-hidden="true">
                    {c.ok === true ? <Check className="w-3 h-3" /> : c.ok === false ? <X className="w-3 h-3" /> : '?'}
                  </span>
                  <span>
                    <span className="font-semibold">{CHECK_LABELS[c.name] ?? c.name}</span>
                    <span className="sr-only">{c.ok === true ? ' passed' : c.ok === false ? ' failed' : ' could not be checked'}</span>
                    <span className="block text-[11px] text-[#777777] dark:text-[#A0A0A0] font-mono break-all">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-[#777777] dark:text-[#A0A0A0]">
              Reproduce from a terminal: <code className="font-mono break-all">npm run verify:evidence -- --discover {route.recipient}</code>
            </p>
          </section>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 print:hidden">
          <button type="button" onClick={copy} className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416] text-xs font-semibold">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Link copied' : 'Copy proof link'}
          </button>
          <button type="button" onClick={share} className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416] text-xs font-semibold">
            <Share2 className="w-3.5 h-3.5" /> Share
          </button>
          <button type="button" onClick={() => window.print()} className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-[#E2E2E0] dark:border-[#26262B] bg-white dark:bg-[#141416] text-xs font-semibold">
            <Printer className="w-3.5 h-3.5" /> Print / save PDF
          </button>
        </div>
        <div className="flex items-center justify-between print:hidden">
          <button type="button" onClick={onGoToDashboard} className="inline-flex items-center gap-1.5 py-2 text-xs text-[#777777] hover:text-[#111111] dark:hover:text-white">
            <ArrowLeft className="w-3.5 h-3.5" /> Open Cambio
          </button>
          {outcome && outcome.state !== 'verified' && (
            <button type="button" onClick={() => setRun((n) => n + 1)} className="text-xs font-semibold underline">Verify again</button>
          )}
        </div>
      </main>
    </div>
  );
};

function Panel({ tone, icon, title, children }: { tone: 'ok' | 'warn' | 'bad' | 'info'; icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  const cls = {
    ok: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200',
    warn: 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200',
    bad: 'bg-red-500/10 border-red-500/30 text-red-800 dark:text-red-200',
    info: 'bg-white dark:bg-[#141416] border-[#E2E2E0] dark:border-[#26262B] text-[#555555] dark:text-[#A0A0A0]',
  }[tone];
  return (
    <div className={`p-4 rounded-2xl border ${cls}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <p className="font-bold text-sm flex items-center gap-2">{icon} {title}</p>
      {children && <p className="mt-1 text-xs leading-relaxed">{children}</p>}
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 grid grid-cols-[110px_1fr] sm:grid-cols-[150px_1fr] gap-3">
      <dt className="text-[#777777] dark:text-[#A0A0A0]">{term}</dt>
      <dd className="text-[#111111] dark:text-[#FFFFFF] min-w-0">{children}</dd>
    </div>
  );
}

