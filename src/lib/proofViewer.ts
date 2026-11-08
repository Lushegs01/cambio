/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public settlement proof: `#proof/<recipient>/<requestId>` (optionally `?tx=<hash>`).
 *
 * Anyone can open it without a wallet. The page runs the same checks as `npm run verify:evidence`
 * (checkSignedSettlement), in the browser, against the Mezo RPC:
 *   1. load the signed request from the invoice registry (untrusted: it is only the payload source);
 *   2. verify the EIP-712 signature against the recipient (EOA or ERC-1271);
 *   3. take the payment hash (explicit ?tx, else the registry's recorded settlement, else a chain search);
 *   4. re-read transaction, receipt and block, and check calldata, receipt status, Transfer event, timing.
 * A registry that lies can only make the proof fail or stay inconclusive, never pass.
 *
 * The link carries only public identifiers (recipient address and the random request id). It never
 * carries a session token.
 */

import { getAddress, isAddress, type Address, type Hex } from 'viem';
import type { MezoChainConfig } from '../config/chains';
import { checkSignedSettlement, fetchEvidence, inconclusive, type EvidenceClient, type EvidenceResult } from './evidence';
import { validateSignedRequestShape, type SignedPaymentRequest } from './paymentRequest';

const ROUTE_RE = /^#\/?proof\/(0x[0-9a-fA-F]{40})\/(0x[0-9a-fA-F]{32})(?:\?tx=(0x[0-9a-fA-F]{64}))?$/;

export interface ProofRoute {
  recipient: Address;
  id: Hex;
  tx: Hex | null;
}

export function parseProofRoute(href: string): ProofRoute | null {
  let hash: string;
  try {
    hash = new URL(href).hash;
  } catch {
    return null;
  }
  const m = ROUTE_RE.exec(hash);
  if (!m || !isAddress(m[1], { strict: false })) return null;
  return { recipient: getAddress(m[1]), id: m[2].toLowerCase() as Hex, tx: m[3] ? (m[3].toLowerCase() as Hex) : null };
}

export function proofUrl(origin: string, recipient: string, id: string, tx?: string | null): string {
  return `${origin.replace(/\/+$/, '')}/#proof/${getAddress(recipient)}/${id.toLowerCase()}${tx ? `?tx=${tx.toLowerCase()}` : ''}`;
}

export interface RegistryInvoice {
  request: SignedPaymentRequest;
  signature: Hex;
  settlement: { txHash: Hex; verifiedAt: number } | null;
  duplicatePayments: Hex[];
}

export type ProofOutcome =
  | { state: 'no_invoice'; reason: string }
  | { state: 'registry_unavailable'; reason: string }
  | { state: 'invalid_request'; reason: string }
  | { state: 'unpaid'; invoice: RegistryInvoice; signatureValid: boolean | null; searchComplete: boolean }
  | { state: 'verified'; invoice: RegistryInvoice; hash: Hex; source: HashSource; result: EvidenceResult }
  | { state: 'failed'; invoice: RegistryInvoice; hash: Hex; source: HashSource; result: EvidenceResult }
  | { state: 'inconclusive'; invoice: RegistryInvoice; hash: Hex | null; source: HashSource | null; result: EvidenceResult };

export type HashSource = 'link' | 'registry' | 'chain_search';

export interface ProofDeps {
  /** Throws an object with numeric `status` on HTTP errors (404 = not stored). */
  getInvoice: (recipient: Address, id: Hex) => Promise<RegistryInvoice>;
  verifySignature: (request: SignedPaymentRequest, signature: Hex) => Promise<boolean>;
  /** Chain search for a settlement when none is recorded: a hash, 'none' (complete search, nothing found) or 'unknown'. */
  searchChain: (request: SignedPaymentRequest) => Promise<Hex | 'none' | 'unknown'>;
  evidenceClient: EvidenceClient;
}

export async function verifyPublicProof(chain: MezoChainConfig, route: ProofRoute, deps: ProofDeps): Promise<ProofOutcome> {
  let invoice: RegistryInvoice;
  try {
    invoice = await deps.getInvoice(route.recipient, route.id);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return { state: 'no_invoice', reason: 'This invoice is not stored in the Cambio registry. Ask the merchant for the full signed payment link instead.' };
    return { state: 'registry_unavailable', reason: 'The invoice registry could not be reached. Try again shortly.' };
  }
  // The registry is untrusted. Its payload must be a well-formed request for exactly this route.
  const shapeError = validateSignedRequestShape(invoice.request);
  if (shapeError) return { state: 'invalid_request', reason: shapeError };
  if (invoice.request.id.toLowerCase() !== route.id || invoice.request.recipient.toLowerCase() !== route.recipient.toLowerCase()) {
    return { state: 'invalid_request', reason: 'The registry returned a different request than this link names.' };
  }
  if (invoice.request.chainId !== chain.chainId) return { state: 'invalid_request', reason: `This request is for chain ${invoice.request.chainId}.` };

  let signatureValid: boolean | null;
  try {
    signatureValid = await deps.verifySignature(invoice.request, invoice.signature);
  } catch {
    signatureValid = null;
  }

  let hash: Hex | null = route.tx;
  let source: HashSource | null = route.tx ? 'link' : null;
  if (!hash && invoice.settlement?.txHash) {
    hash = invoice.settlement.txHash;
    source = 'registry';
  }
  if (!hash) {
    const found = await deps.searchChain(invoice.request).catch(() => 'unknown' as const);
    if (found === 'none' || found === 'unknown') return { state: 'unpaid', invoice, signatureValid, searchComplete: found === 'none' };
    hash = found;
    source = 'chain_search';
  }

  const fetched = await fetchEvidence(deps.evidenceClient, hash);
  if (!fetched.ok) return { state: 'inconclusive', invoice, hash, source, result: inconclusive('signed_request_settlement', hash, fetched.reason) };
  const result = checkSignedSettlement(chain, hash, invoice.request, signatureValid, fetched.tx, fetched.receipt, fetched.blockTimestampMs);
  if (result.verdict === 'PASS') return { state: 'verified', invoice, hash, source: source!, result };
  if (result.verdict === 'FAIL') return { state: 'failed', invoice, hash, source: source!, result };
  return { state: 'inconclusive', invoice, hash, source, result };
}

/** Plain-language labels for the verifier's check names, in the order a reader cares about. */
export const CHECK_LABELS: Record<string, string> = {
  'request signed by recipient (EIP-712)': 'Invoice signed by the merchant’s wallet',
  'request chain': 'Invoice is for this network',
  'hash matches': 'Transaction exists on Mezo',
  network: 'Transaction is on Mezo Testnet',
  'receipt status': 'Transaction succeeded',
  'block timestamp': 'Block time read from the chain',
  'target is MUSD': 'Paid in the official MUSD contract',
  'calldata is transfer(to, amount)': 'Call is an MUSD transfer',
  'Transfer event matches calldata': 'MUSD Transfer event emitted',
  'expected recipient': 'Paid to the merchant',
  'expected amount': 'Exact invoice amount',
  'calldata binds request id, recipient and amount': 'Payment carries this invoice’s request ID',
};
