/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Payment requests.
 *
 * A signed request is an EIP-712 message, signed by the wallet that will receive the payment, that
 * binds: request id, recipient, MUSD token address, amount (base units), memo, chain and expiry.
 * The payer's browser verifies the signature before showing a "Pay" button, so a link whose
 * recipient or amount was edited after sharing fails verification.
 *
 * Settlement is proven only by the chain: the payment transaction carries the request id as a
 * calldata suffix, and verifySettlement() checks the transaction input, receipt status and the
 * MUSD Transfer event. Opening, scanning or "marking" a request never makes it paid.
 */

import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { erc20Abi } from '../config/abis';
import { getChainConfig, getDefaultChain, type MezoChainConfig } from '../config/chains';
import { parseTokenAmount } from './amounts';
import { receiptHasTransfer, type ReceiptWithLogs } from './musdTransfer';
import { normalizeUsername, validateUsername } from '../../shared/username';

export const REQUEST_VERSION = 2 as const;
export const MAX_MEMO_LENGTH = 140;
export const MAX_REQUEST_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
/** Suffix appended to the transfer calldata: 4-byte magic "CMB2" + 16-byte request id. */
export const REQUEST_SUFFIX_MAGIC = '0x434d4232' as const;

export interface SignedPaymentRequest {
  v: typeof REQUEST_VERSION;
  /** 16 random bytes, hex encoded. */
  id: Hex;
  chainId: number;
  token: Address;
  recipient: Address;
  /** Amount in token base units, decimal string. */
  amount: string;
  memo: string;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds. Always set: signed requests cannot be open-ended. */
  expiresAt: number;
}

export type ParsedPaymentLink =
  | { kind: 'signed'; request: SignedPaymentRequest; signature: Hex; proofTx: Hex | null }
  | {
      kind: 'unsigned';
      source: 'simple' | 'legacy-v1';
      chainId: number;
      recipient: Address | null;
      recipientUsername: string | null;
      amount: bigint | null;
      memo: string;
      expiresAt: number | null;
    }
  | { kind: 'invalid'; error: string };

export const paymentRequestTypes = {
  PaymentRequest: [
    { name: 'id', type: 'bytes16' },
    { name: 'recipient', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'memo', type: 'string' },
    { name: 'createdAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
} as const;

export function paymentRequestDomain(chainId: number) {
  return { name: 'Cambio', version: String(REQUEST_VERSION), chainId } as const;
}

export function typedDataFor(req: SignedPaymentRequest) {
  return {
    domain: paymentRequestDomain(req.chainId),
    types: paymentRequestTypes,
    primaryType: 'PaymentRequest' as const,
    message: {
      id: req.id,
      recipient: req.recipient,
      token: req.token,
      amount: BigInt(req.amount),
      memo: req.memo,
      createdAt: BigInt(req.createdAt),
      expiresAt: BigInt(req.expiresAt),
    },
  };
}

export function randomRequestId(): Hex {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

export function requestIdSuffix(id: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{32}$/.test(id)) throw new Error('Invalid request id');
  return `${REQUEST_SUFFIX_MAGIC}${id.slice(2).toLowerCase()}` as Hex;
}

export function sanitizeMemo(memo: string): string {
  // Strip control characters; the memo is displayed to the payer and signed verbatim.
  return (memo ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

/** Builds an unsigned request object for the recipient to sign. Throws on invalid input. */
export function buildPaymentRequest(input: {
  chain: MezoChainConfig;
  recipient: string;
  amount: bigint;
  memo: string;
  lifetimeSeconds: number;
  nowSeconds?: number;
  id?: Hex;
}): SignedPaymentRequest {
  if (!isAddress(input.recipient, { strict: false })) throw new Error('Recipient address is invalid.');
  if (input.amount <= 0n) throw new Error('Amount must be greater than zero.');
  const memo = sanitizeMemo(input.memo);
  if (memo.length > MAX_MEMO_LENGTH) throw new Error(`Note must be ${MAX_MEMO_LENGTH} characters or fewer.`);
  if (!Number.isInteger(input.lifetimeSeconds) || input.lifetimeSeconds <= 0 || input.lifetimeSeconds > MAX_REQUEST_LIFETIME_SECONDS) {
    throw new Error('Unsupported expiry.');
  }
  const createdAt = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const request: SignedPaymentRequest = {
    v: REQUEST_VERSION,
    id: input.id ?? randomRequestId(),
    chainId: input.chain.chainId,
    token: input.chain.tokens.MUSD.address,
    recipient: getAddress(input.recipient),
    amount: input.amount.toString(),
    memo,
    createdAt,
    expiresAt: createdAt + input.lifetimeSeconds,
  };
  const error = validateSignedRequestShape(request);
  if (error) throw new Error(error);
  return request;
}

// ---------------------------------------------------------------------------------------------
// Encoding

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodePaymentLink(origin: string, req: SignedPaymentRequest, signature: Hex, proofTx?: Hex): string {
  const r = toBase64Url(JSON.stringify(req));
  const tx = proofTx ? `&tx=${proofTx}` : '';
  return `${origin.replace(/\/+$/, '')}/#pay?r=${r}&s=${signature}${tx}`;
}

// ---------------------------------------------------------------------------------------------
// Validation and parsing

const MAX_LINK_PARAM_LENGTH = 4096;
const REQUEST_KEYS = ['v', 'id', 'chainId', 'token', 'recipient', 'amount', 'memo', 'createdAt', 'expiresAt'];

/** Structural + semantic validation of a decoded request. Returns an error string or null. */
export function validateSignedRequestShape(x: unknown): string | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 'Request payload is not an object.';
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.some((k) => !REQUEST_KEYS.includes(k)) || REQUEST_KEYS.some((k) => !(k in o))) return 'Request payload has unexpected fields.';
  if (o.v !== REQUEST_VERSION) return 'Unsupported request version.';
  if (typeof o.id !== 'string' || !/^0x[0-9a-fA-F]{32}$/.test(o.id)) return 'Request id is invalid.';
  if (typeof o.chainId !== 'number') return 'Chain is invalid.';
  const chain = getChainConfig(o.chainId);
  if (!chain) return `This request is for an unsupported network (chain ${String(o.chainId)}).`;
  if (typeof o.token !== 'string' || !isAddress(o.token, { strict: false })) return 'Token address is invalid.';
  if (o.token.toLowerCase() !== chain.tokens.MUSD.address.toLowerCase()) return 'This request is for a token other than MUSD on this network.';
  if (typeof o.recipient !== 'string' || !isAddress(o.recipient, { strict: false })) return 'Recipient address is invalid.';
  if (/^0x0{40}$/i.test(o.recipient)) return 'Recipient address is invalid.';
  if (typeof o.amount !== 'string' || !/^[1-9]\d{0,40}$/.test(o.amount)) return 'Amount is invalid.';
  if (typeof o.memo !== 'string' || o.memo.length > MAX_MEMO_LENGTH || sanitizeMemo(o.memo) !== o.memo) return 'Note is invalid.';
  if (!Number.isSafeInteger(o.createdAt) || (o.createdAt as number) <= 0) return 'Creation time is invalid.';
  if (!Number.isSafeInteger(o.expiresAt)) return 'Expiry is invalid.';
  const lifetime = (o.expiresAt as number) - (o.createdAt as number);
  if (lifetime <= 0 || lifetime > MAX_REQUEST_LIFETIME_SECONDS) return 'Expiry is outside the allowed range.';
  return null;
}

function paramsFrom(href: string): URLSearchParams | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hash = url.hash.replace(/^#\/?/, '');
  if (hash.startsWith('pay')) {
    const q = hash.indexOf('?');
    return new URLSearchParams(q === -1 ? '' : hash.slice(q + 1));
  }
  if (/\/pay\/?$/.test(url.pathname) || url.searchParams.has('r') || url.searchParams.has('req') || url.searchParams.has('to')) {
    return url.searchParams;
  }
  return null;
}

export function isPaymentLink(href: string): boolean {
  const p = paramsFrom(href);
  return !!p && (p.has('r') || p.has('req') || p.has('to'));
}

/** Parses any supported payment-link format. Never throws; malformed links become kind: 'invalid'. */
export function parsePaymentLink(href: string): ParsedPaymentLink | null {
  const params = paramsFrom(href);
  if (!params || !(params.has('r') || params.has('req') || params.has('to'))) return null;

  if (href.length > 12_000 || [...params.keys()].some((key) => params.getAll(key).length !== 1)) return { kind: 'invalid', error: 'Ambiguous or oversized payment link.' };
  if (params.has('s') && !params.has('r')) return { kind: 'invalid', error: 'Signed request payload is missing.' };

  for (const [, value] of params) {
    if (value.length > MAX_LINK_PARAM_LENGTH) return { kind: 'invalid', error: 'This payment link is too long to be valid.' };
  }

  if (params.has('r')) {
    if (!/^[A-Za-z0-9_-]+$/.test(params.get('r') || '')) return { kind: 'invalid', error: 'This payment link is corrupted.' };
    let decoded: unknown;
    try {
      decoded = JSON.parse(fromBase64Url(params.get('r') || ''));
    } catch {
      return { kind: 'invalid', error: 'This payment link is corrupted.' };
    }
    const shapeError = validateSignedRequestShape(decoded);
    if (shapeError) return { kind: 'invalid', error: shapeError };
    const signature = params.get('s') || '';
    if (!/^0x(?:[0-9a-fA-F]{2}){0,2048}$/.test(signature)) return { kind: 'invalid', error: 'This payment link is missing a valid signature.' };
    const tx = params.get('tx');
    if (tx && !/^0x[0-9a-fA-F]{64}$/.test(tx)) return { kind: 'invalid', error: 'The attached payment proof is not a valid transaction hash.' };
    const req = decoded as SignedPaymentRequest;
    return {
      kind: 'signed',
      request: { ...req, token: getAddress(req.token), recipient: getAddress(req.recipient) },
      signature: signature as Hex,
      proofTx: (tx as Hex) || null,
    };
  }

  if (params.has('req')) return parseLegacyV1(params.get('req') || '');
  return parseSimple(params);
}

function parseRecipient(raw: string): { recipient: Address | null; username: string | null; error?: string } {
  const value = raw.trim();
  if (isAddress(value, { strict: false })) {
    if (/^0x0{40}$/i.test(value)) return { recipient: null, username: null, error: 'Recipient address is invalid.' };
    return { recipient: getAddress(value), username: null };
  }
  if (value.startsWith('0x')) return { recipient: null, username: null, error: 'Recipient address is invalid.' };
  const v = validateUsername(value);
  if (!v.valid) return { recipient: null, username: null, error: 'Recipient is not a valid address or @username.' };
  return { recipient: null, username: normalizeUsername(value) };
}

function parseSimple(params: URLSearchParams): ParsedPaymentLink {
  const chainRaw = params.get('chain');
  const chain = chainRaw ? getChainConfig(Number(chainRaw)) : getDefaultChain();
  if (!chain) return { kind: 'invalid', error: `This link is for an unsupported network (chain ${chainRaw}).` };
  const r = parseRecipient(params.get('to') || '');
  if (r.error) return { kind: 'invalid', error: r.error };

  let amount: bigint | null = null;
  const amt = params.get('amt');
  if (amt !== null && amt !== '') {
    const parsed = parseTokenAmount(amt, chain.tokens.MUSD.decimals);
    if (!parsed.ok) return { kind: 'invalid', error: `Requested amount is invalid: ${parsed.error}` };
    amount = parsed.value;
  }
  const memo = sanitizeMemo(params.get('note') || params.get('memo') || '').slice(0, MAX_MEMO_LENGTH);
  return { kind: 'unsigned', source: 'simple', chainId: chain.chainId, recipient: r.recipient, recipientUsername: r.username, amount, memo, expiresAt: null };
}

/** v1 links (`#pay?req=<json>`) predate signing. They are shown as unsigned and their `u` (username) field is ignored. */
function parseLegacyV1(raw: string): ParsedPaymentLink {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', error: 'This payment link is corrupted.' };
  }
  if (!data || typeof data !== 'object') return { kind: 'invalid', error: 'This payment link is corrupted.' };
  const chain = getDefaultChain();
  if (typeof data.to !== 'string') return { kind: 'invalid', error: 'Recipient is missing.' };
  const r = parseRecipient(data.to);
  if (r.error || !r.recipient) return { kind: 'invalid', error: r.error || 'Recipient is missing.' };
  let amount: bigint | null = null;
  if (data.amt !== undefined) {
    const parsed = parseTokenAmount(String(data.amt), chain.tokens.MUSD.decimals);
    if (!parsed.ok) return { kind: 'invalid', error: `Requested amount is invalid: ${parsed.error}` };
    amount = parsed.value;
  }
  const createdMs = typeof data.cat === 'number' ? data.cat : null;
  const expHours = typeof data.exp === 'number' && data.exp > 0 ? data.exp : null;
  const expiresAt = createdMs && expHours ? Math.floor(createdMs / 1000 + expHours * 3600) : null;
  const memo = sanitizeMemo(typeof data.note === 'string' ? data.note : '').slice(0, MAX_MEMO_LENGTH);
  return { kind: 'unsigned', source: 'legacy-v1', chainId: chain.chainId, recipient: r.recipient, recipientUsername: null, amount, memo, expiresAt };
}

export function isExpired(expiresAt: number | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return expiresAt !== null && nowSeconds >= expiresAt;
}

export function formatTimeRemaining(expiresAt: number | null, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (expiresAt === null) return 'No expiry';
  const diff = expiresAt - nowSeconds;
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3600);
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60))} min remaining`;
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
  const days = Math.floor(hours / 24);
  return `${days} days remaining`;
}

// ---------------------------------------------------------------------------------------------
// Signature verification

export type TypedDataVerifier = (args: ReturnType<typeof typedDataFor> & { address: Address; signature: Hex }) => Promise<boolean>;

/** Default verifier: pure ECDSA recovery (EOA wallets). Pass publicClient.verifyTypedData to also accept ERC-1271 wallets. */
export const ecdsaTypedDataVerifier: TypedDataVerifier = (args) => verifyTypedData(args);

export async function verifyRequestSignature(
  req: SignedPaymentRequest,
  signature: Hex,
  verifier: TypedDataVerifier = ecdsaTypedDataVerifier
): Promise<boolean> {
  if (validateSignedRequestShape(req)) return false;
  try {
    return await verifier({ ...typedDataFor(req), address: req.recipient, signature });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Settlement verification

export interface SettlementTx {
  hash: Hex;
  from: Address;
  to: Address | null;
  input: Hex;
  chainId?: number;
}

export type SettlementResult =
  | { status: 'settled'; paidAt: number | null; payer: Address; blockNumber: string }
  | { status: 'settled_after_expiry'; paidAt: number; payer: Address; blockNumber: string }
  | { status: 'reverted' }
  | { status: 'mismatch'; reason: string };

export function expectedPaymentCalldata(req: SignedPaymentRequest): Hex {
  const base = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [req.recipient, BigInt(req.amount)] });
  return `${base}${requestIdSuffix(req.id).slice(2)}` as Hex;
}

/** Pure check of a fetched transaction + receipt against a request. */
export function verifySettlement(
  req: SignedPaymentRequest,
  tx: SettlementTx,
  receipt: ReceiptWithLogs,
  blockTimestampMs: number | null
): SettlementResult {
  if (validateSignedRequestShape(req)) return { status: 'mismatch', reason: 'Invalid payment request.' };
  if (tx.chainId !== req.chainId) return { status: 'mismatch', reason: 'Transaction network is unknown or different.' };
  if (!tx.to || tx.to.toLowerCase() !== req.token.toLowerCase()) return { status: 'mismatch', reason: 'Transaction is not an MUSD transfer.' };
  if (tx.input.toLowerCase() !== expectedPaymentCalldata(req).toLowerCase()) {
    return { status: 'mismatch', reason: 'Transaction does not pay this request (recipient, amount or request id differ).' };
  }
  if (receipt.status !== 'success') return { status: 'reverted' };
  if (!receiptHasTransfer(receipt, req.token, tx.from, req.recipient, BigInt(req.amount))) {
    return { status: 'mismatch', reason: 'Receipt has no matching MUSD Transfer event.' };
  }
  const blockNumber = receipt.blockNumber.toString();
  if (blockTimestampMs === null || !Number.isSafeInteger(blockTimestampMs) || blockTimestampMs < req.createdAt * 1000) return { status: 'mismatch', reason: 'Payment time is unavailable or predates the signed request.' };
  if (blockTimestampMs / 1000 >= req.expiresAt) {
    return { status: 'settled_after_expiry', paidAt: blockTimestampMs, payer: getAddress(tx.from), blockNumber };
  }
  return { status: 'settled', paidAt: blockTimestampMs, payer: getAddress(tx.from), blockNumber };
}

// ---------------------------------------------------------------------------------------------
// Recipient-side storage (this device only)

export interface StoredRequest {
  request: SignedPaymentRequest;
  signature: Hex;
  /** Settlement tx found on-chain, if any. */
  settlementTx?: Hex;
}

const storeKey = (recipient: string) => `cambio.requests.v2:${recipient.toLowerCase()}`;

export function loadStoredRequests(recipient: string): StoredRequest[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(recipient)) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (s: StoredRequest) =>
        s && !validateSignedRequestShape(s.request) && isHex(s.signature) && s.request.recipient.toLowerCase() === recipient.toLowerCase()
    );
  } catch {
    return [];
  }
}

export function saveStoredRequest(entry: StoredRequest): void {
  try {
    const list = loadStoredRequests(entry.request.recipient);
    const next = [entry, ...list.filter((s) => s.request.id !== entry.request.id)].slice(0, 50);
    localStorage.setItem(storeKey(entry.request.recipient), JSON.stringify(next));
  } catch {
    // Local history is a convenience; the request link itself remains valid.
  }
}

export function deleteStoredRequest(recipient: string, id: Hex): void {
  try {
    const list = loadStoredRequests(recipient).filter((s) => s.request.id !== id);
    localStorage.setItem(storeKey(recipient), JSON.stringify(list));
  } catch {
    // ignore
  }
}
