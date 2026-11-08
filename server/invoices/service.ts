/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merchant invoice registry.
 *
 *  - Create: anyone may store a signed payment request, but only under the recipient address whose
 *    EIP-712 signature the server verifies (EOA, or ERC-1271 via RPC). No login is needed: the signature
 *    is the authorization.
 *  - Read one: public by (recipient, request id). The 16-byte random id makes it a capability URL, and
 *    the same data is already in the shared payment link.
 *  - List: requires a merchant session (SIWE sign-in, 24 h bearer token stored only as a hash), so a
 *    merchant's amounts and notes are not enumerable by address.
 *  - Settlement: callers submit only a transaction hash. The server re-reads the transaction, receipt
 *    and block from the RPC and records a settlement only when verifySettlement() binds the exact
 *    calldata (recipient, amount, request id), receipt status, Transfer event and block time, with the
 *    configured number of confirmations. A client can never set a status.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createPublicClient, getAddress, http, isAddress, type Hex } from 'viem';
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { MEZO_TESTNET, getKnownChainConfig } from '../../src/config/chains.js';
import { ecdsaTypedDataVerifier, validateSignedRequestShape, verifyRequestSignature, type SignedPaymentRequest } from '../../src/lib/paymentRequest.js';
import { verifyPaymentTx, type SettlementCheck, type SettlementClient } from '../../src/lib/requestSettlement.js';
import { verifyWalletSignature } from '../../shared/signatureVerification.js';
import { defaultSignatureVerifier, type OriginContext, type SignatureVerifier } from '../identity/service.js';
import type { InvoiceRecord, InvoiceStore, ListCursor } from './store.js';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_INVOICES_PER_RECIPIENT = 1000;
const ID_RE = /^0x[0-9a-f]{32}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const SESSION_STATEMENT = 'Sign in to view and sync your Cambio invoices. Signing is free and does not send a transaction.';

export class InvoiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'InvoiceError';
  }
}

export type RequestSignatureVerifier = (req: SignedPaymentRequest, signature: Hex) => Promise<boolean>;
export type ChainReader = SettlementClient & { getBlockNumber(): Promise<bigint> };

export interface InvoiceServiceOptions {
  store: InvoiceStore;
  allowedChainIds?: number[];
  verifyRequest?: RequestSignatureVerifier;
  verifyMessage?: SignatureVerifier;
  chainReader?: (chainId: number) => ChainReader;
  now?: () => number;
  /** Blocks including the payment's own block. Mezo uses single-slot BFT finality; 1 is the default. */
  minConfirmations?: number;
  maxPerRecipient?: number;
  /** Delays between "not found" retries when reading a claimed payment (the public RPC's nodes can disagree). */
  retryDelays?: readonly number[];
}

export function defaultChainReader(): (chainId: number) => ChainReader {
  const clients = new Map<number, ChainReader>();
  return (chainId) => {
    const chain = getKnownChainConfig(chainId);
    if (!chain) throw new InvoiceError(400, 'unsupported_chain', 'Unsupported network.');
    if (!clients.has(chainId)) clients.set(chainId, createPublicClient({ transport: http(chain.rpcUrls[0], { timeout: 10_000, retryCount: 1 }) }) as unknown as ChainReader);
    return clients.get(chainId)!;
  };
}

function defaultRequestVerifier(reader: (chainId: number) => ChainReader): RequestSignatureVerifier {
  return (req, signature) =>
    verifyRequestSignature(req, signature, (args) =>
      verifyWalletSignature({
        signature: args.signature,
        verifyEoa: () => ecdsaTypedDataVerifier(args),
        getCode: () => (reader(req.chainId) as unknown as { getCode(a: { address: Hex }): Promise<Hex | undefined> }).getCode({ address: args.address }),
        verifyContract: () => (reader(req.chainId) as unknown as { verifyTypedData(a: typeof args): Promise<boolean> }).verifyTypedData(args),
      })
    );
}

export interface PublicInvoice {
  id: string;
  chainId: number;
  recipient: string;
  request: SignedPaymentRequest;
  signature: Hex;
  createdAt: number;
  expiresAt: number;
  storedAt: number;
  settlement: InvoiceRecord['settlement'];
  duplicatePayments: string[];
}

const toPublic = (r: InvoiceRecord): PublicInvoice => ({ ...r, recipient: getAddress(r.recipient) });

export class InvoiceService {
  readonly store: InvoiceStore;
  private readonly allowed: number[];
  private readonly verifyRequest: RequestSignatureVerifier;
  private readonly verifyMessage: SignatureVerifier;
  private readonly reader: (chainId: number) => ChainReader;
  private readonly now: () => number;
  private readonly minConfirmations: bigint;
  private readonly maxPerRecipient: number;
  private readonly retryDelays: readonly number[] | undefined;

  constructor(opts: InvoiceServiceOptions) {
    this.store = opts.store;
    this.allowed = opts.allowedChainIds ?? [MEZO_TESTNET.chainId];
    this.reader = opts.chainReader ?? defaultChainReader();
    this.verifyRequest = opts.verifyRequest ?? defaultRequestVerifier(this.reader);
    this.verifyMessage = opts.verifyMessage ?? defaultSignatureVerifier();
    this.now = opts.now ?? Date.now;
    this.minConfirmations = BigInt(Math.max(1, opts.minConfirmations ?? 1));
    this.maxPerRecipient = opts.maxPerRecipient ?? MAX_INVOICES_PER_RECIPIENT;
    this.retryDelays = opts.retryDelays;
  }

  get storeInfo() {
    return { kind: this.store.kind, durable: this.store.durable };
  }

  private parseAddress(raw: unknown): string {
    if (typeof raw !== 'string' || !isAddress(raw, { strict: false })) throw new InvoiceError(400, 'invalid_address', 'A valid wallet address is required.');
    return raw.toLowerCase();
  }

  private parseId(raw: unknown): string {
    if (typeof raw !== 'string' || !ID_RE.test(raw.toLowerCase())) throw new InvoiceError(400, 'invalid_id', 'Invalid request id.');
    return raw.toLowerCase();
  }

  async createInvoice(body: { request?: unknown; signature?: unknown }): Promise<{ created: boolean; invoice: PublicInvoice }> {
    const shapeError = validateSignedRequestShape(body.request);
    if (shapeError) throw new InvoiceError(400, 'invalid_request', shapeError);
    const raw = body.request as SignedPaymentRequest;
    const request: SignedPaymentRequest = { ...raw, recipient: getAddress(raw.recipient), token: getAddress(raw.token) };
    if (!this.allowed.includes(request.chainId)) throw new InvoiceError(400, 'unsupported_chain', 'Invoices are only stored for the networks this deployment supports.');
    if (typeof body.signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){1,2048}$/.test(body.signature)) throw new InvoiceError(400, 'invalid_signature', 'Signature is malformed.');
    const signature = body.signature as Hex;
    let valid: boolean;
    try {
      valid = await this.verifyRequest(request, signature);
    } catch {
      valid = false;
    }
    if (!valid) throw new InvoiceError(401, 'invalid_signature', 'The request is not signed by its recipient.');

    const record: InvoiceRecord = {
      id: request.id.toLowerCase(),
      chainId: request.chainId,
      recipient: request.recipient.toLowerCase(),
      request,
      signature,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      storedAt: this.now(),
      settlement: null,
      duplicatePayments: [],
    };
    const result = await this.store.insertInvoice(record, this.maxPerRecipient);
    if (result === 'conflict') throw new InvoiceError(409, 'id_conflict', 'A different request with this id is already stored for this recipient.');
    if (result === 'limit') throw new InvoiceError(429, 'invoice_limit', `This recipient already has ${this.maxPerRecipient} stored invoices.`);
    const stored = await this.store.getInvoice(record.recipient, record.id);
    return { created: result === 'created', invoice: toPublic(stored ?? record) };
  }

  async getInvoice(rawRecipient: unknown, rawId: unknown): Promise<PublicInvoice> {
    const r = await this.store.getInvoice(this.parseAddress(rawRecipient), this.parseId(rawId));
    if (!r) throw new InvoiceError(404, 'not_found', 'This invoice is not stored on the server.');
    return toPublic(r);
  }

  async listInvoices(address: string, query: { limit?: unknown; cursor?: unknown }): Promise<{ items: PublicInvoice[]; nextCursor: string | null }> {
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    let cursor: ListCursor | undefined;
    if (query.cursor !== undefined && query.cursor !== '') {
      const m = typeof query.cursor === 'string' ? /^(\d{1,12}):(0x[0-9a-f]{32})$/.exec(query.cursor) : null;
      if (!m) throw new InvoiceError(400, 'invalid_cursor', 'Invalid page cursor.');
      cursor = { createdAt: Number(m[1]), id: m[2] };
    }
    const rows = await this.store.listInvoices(address, limit + 1, cursor);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: page.map(toPublic), nextCursor: rows.length > limit && last ? `${last.createdAt}:${last.id}` : null };
  }

  /** Every stored invoice for a merchant, newest first (bounded by the per-recipient cap). */
  async allInvoices(address: string): Promise<InvoiceRecord[]> {
    const out: InvoiceRecord[] = [];
    let cursor: ListCursor | undefined;
    for (let page = 0; page < Math.ceil(this.maxPerRecipient / 200) + 1; page++) {
      const rows = await this.store.listInvoices(address, 200, cursor);
      out.push(...rows);
      if (rows.length < 200) break;
      const last = rows[rows.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    return out;
  }

  /** Verifies a claimed payment on-chain and records it. Never trusts anything but the hash. */
  async submitSettlement(rawRecipient: unknown, rawId: unknown, body: { txHash?: unknown }): Promise<{ invoice: PublicInvoice; check: SettlementCheck['state'] }> {
    const recipient = this.parseAddress(rawRecipient);
    const id = this.parseId(rawId);
    if (typeof body.txHash !== 'string' || !HASH_RE.test(body.txHash)) throw new InvoiceError(400, 'invalid_tx', 'A 32-byte transaction hash is required.');
    const txHash = body.txHash.toLowerCase() as Hex;
    const record = await this.store.getInvoice(recipient, id);
    if (!record) throw new InvoiceError(404, 'not_found', 'This invoice is not stored on the server.');
    if (record.settlement?.txHash === txHash || record.duplicatePayments.includes(txHash)) return { invoice: toPublic(record), check: 'settled' };

    const reader = this.reader(record.chainId);
    const check = await verifyPaymentTx(reader, record.request, txHash, this.retryDelays);
    if (check.state === 'not_found') throw new InvoiceError(404, 'tx_not_found', 'The transaction was not found on the network yet. It may still be pending.');
    if (check.state === 'error') throw new InvoiceError(503, 'rpc_unavailable', 'The network could not be read. Try again shortly.');
    if (check.state === 'invalid') {
      const reason = check.result.status === 'reverted' ? 'The transaction reverted.' : check.result.status === 'mismatch' ? check.result.reason : 'Not a settlement.';
      throw new InvoiceError(422, 'not_a_settlement', reason);
    }
    let head: bigint;
    try {
      head = await reader.getBlockNumber();
    } catch {
      throw new InvoiceError(503, 'rpc_unavailable', 'The network could not be read. Try again shortly.');
    }
    const confirmations = head - BigInt(check.result.blockNumber) + 1n;
    if (confirmations < this.minConfirmations) throw new InvoiceError(409, 'awaiting_confirmations', `The payment has ${confirmations} of ${this.minConfirmations} confirmations. Try again shortly.`);

    const updated = await this.store.recordSettlement(recipient, id, {
      txHash,
      payer: check.result.payer.toLowerCase(),
      blockNumber: check.result.blockNumber,
      paidAt: check.result.paidAt ?? 0,
      late: check.result.status === 'settled_after_expiry',
      verifiedAt: this.now(),
    });
    if (!updated) throw new InvoiceError(404, 'not_found', 'This invoice is not stored on the server.');
    return { invoice: toPublic(updated), check: 'settled' };
  }

  async createChallenge(body: { address?: unknown; chainId?: unknown }, origin: OriginContext) {
    const address = this.parseAddress(body.address);
    const chainId = Number(body.chainId);
    if (!this.allowed.includes(chainId)) throw new InvoiceError(400, 'unsupported_chain', 'Unsupported network.');
    const issuedAt = this.now();
    const expiresAt = issuedAt + CHALLENGE_TTL_MS;
    const nonce = generateSiweNonce();
    const message = createSiweMessage({
      domain: origin.domain,
      address: getAddress(address),
      statement: SESSION_STATEMENT,
      uri: origin.uri,
      version: '1',
      chainId,
      nonce,
      issuedAt: new Date(issuedAt),
      expirationTime: new Date(expiresAt),
    });
    await this.store.saveChallenge({ nonce, address, chainId, message, issuedAt, expiresAt, usedAt: null });
    return { nonce, message, expiresAt };
  }

  async createSession(body: { nonce?: unknown; signature?: unknown }, origin: OriginContext) {
    if (typeof body.nonce !== 'string' || !/^[a-zA-Z0-9]{8,128}$/.test(body.nonce)) throw new InvoiceError(400, 'invalid_challenge', 'This sign-in request is not recognised. Start again.');
    if (typeof body.signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){1,2048}$/.test(body.signature)) throw new InvoiceError(400, 'invalid_signature', 'Signature is malformed.');
    const c = await this.store.getChallenge(body.nonce);
    const now = this.now();
    if (!c) throw new InvoiceError(400, 'invalid_challenge', 'This sign-in request is not recognised. Start again.');
    if (c.usedAt !== null) throw new InvoiceError(409, 'challenge_used', 'This signature was already used. Start again.');
    if (now >= c.expiresAt) throw new InvoiceError(410, 'challenge_expired', 'This sign-in request expired. Start again.');
    const parsed = parseSiweMessage(c.message);
    if (parsed.statement !== SESSION_STATEMENT || parsed.uri !== origin.uri || parsed.chainId !== c.chainId ||
        !validateSiweMessage({ message: parsed, domain: origin.domain, nonce: c.nonce, address: getAddress(c.address), time: new Date(now) })) {
      throw new InvoiceError(400, 'invalid_challenge', 'This sign-in request is not valid for this site.');
    }
    // An invalid signature does not consume the challenge, so a third party cannot burn it.
    const ok = await this.verifyMessage({ address: getAddress(c.address), message: c.message, signature: body.signature as Hex, chainId: c.chainId });
    if (!ok) throw new InvoiceError(401, 'invalid_signature', 'The signature was not produced by this wallet.');
    if (!(await this.store.consumeChallenge(c.nonce, now))) throw new InvoiceError(409, 'challenge_used', 'This signature was already used. Start again.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + SESSION_TTL_MS;
    await this.store.saveSession({ tokenHash: hashToken(token), address: c.address, createdAt: now, expiresAt });
    return { token, address: getAddress(c.address), expiresAt };
  }

  /** Resolves "Bearer <token>" to the session's lowercase address, or throws 401. */
  async authenticate(header: unknown): Promise<string> {
    const m = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]+)$/.exec(header) : null;
    if (!m || !TOKEN_RE.test(m[1])) throw new InvoiceError(401, 'unauthenticated', 'Sign in with your wallet to see your invoices.');
    const s = await this.store.getSession(hashToken(m[1]));
    if (!s || s.expiresAt <= this.now()) throw new InvoiceError(401, 'unauthenticated', 'Your sign-in expired. Sign in with your wallet again.');
    return s.address;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
