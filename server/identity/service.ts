/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Username registration with server-verified wallet ownership.
 *
 *  1. POST /challenge: the server builds an EIP-4361 (Sign-In with Ethereum) message bound to the
 *     wallet, the action (register/change), the username, the chain, this domain, a single-use nonce
 *     and a 5-minute expiry, and stores it.
 *  2. The wallet signs that exact text (free, no transaction).
 *  3. POST /claim: the server verifies the signature against the stored message and address, then
 *     atomically consumes the nonce and writes the mapping. Replays, expired or mismatched challenges
 *     and signatures from any other key are refused.
 */

import { createPublicClient, getAddress, http, isAddress, verifyMessage, type Hex } from 'viem';
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { MEZO_MAINNET, MEZO_TESTNET } from '../../src/config/chains.js';
import { formatUsername, validateUsername } from '../../shared/username.js';
import { verifyWalletSignature } from '../../shared/signatureVerification.js';
import { StoreUnavailableError, type ClaimAction, type IdentityStore, type UsernameRecord } from './store.js';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type SignatureVerifier = (a: { address: Hex; message: string; signature: Hex; chainId: number }) => Promise<boolean>;

/** EOA signatures are checked by pure ECDSA recovery. If that fails, ERC-1271 smart-account signatures are checked on-chain. */
export function defaultSignatureVerifier(): SignatureVerifier {
  const rpcByChain = new Map([MEZO_TESTNET, MEZO_MAINNET].map((c) => [c.chainId, c.rpcUrls[0]]));
  return async ({ address, message, signature, chainId }) => {
    try {
      const rpc = rpcByChain.get(chainId);
      if (!rpc) return false;
      const client = createPublicClient({ transport: http(rpc, { timeout: 3000, retryCount: 0 }) });
      return await verifyWalletSignature({
        signature,
        verifyEoa: () => verifyMessage({ address, message, signature }),
        getCode: () => client.getCode({ address }),
        verifyContract: () => client.verifyMessage({ address, message, signature }),
      });
    } catch {
      return false;
    }
  };
}

export interface IdentityServiceOptions {
  store: IdentityStore;
  allowedChainIds?: number[];
  verifySignature?: SignatureVerifier;
  now?: () => number;
  challengeTtlMs?: number;
}

/** The site the user is signing in to: host for the SIWE `domain`, origin for its `uri`. */
export interface OriginContext {
  domain: string;
  uri: string;
}

export class IdentityError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

const REASON_TO_ERROR: Record<string, [number, string]> = {
  challenge_not_found: [400, 'This sign-in request is not recognised. Start again.'],
  challenge_used: [409, 'This signature was already used. Start again to get a fresh request.'],
  challenge_expired: [410, 'This sign-in request expired. Start again.'],
  challenge_mismatch: [400, 'The signed request does not match this action.'],
  username_taken: [409, 'That username is already registered to another wallet.'],
  already_registered: [409, 'This wallet already has a username. Use “Change username” instead.'],
  nothing_to_change: [400, 'There is no different username to change to.'],
};

export interface PublicUsernameRecord {
  username: string;
  display: string;
  address: string;
  createdAt: number;
  updatedAt: number;
  verified: true;
}

export function toPublic(r: UsernameRecord): PublicUsernameRecord {
  return { username: r.username, display: formatUsername(r.username), address: getAddress(r.address), createdAt: r.createdAt, updatedAt: r.updatedAt, verified: true };
}

export class IdentityService {
  private readonly store: IdentityStore;
  private readonly verify: SignatureVerifier;
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly allowedChainIds: number[];

  constructor(opts: IdentityServiceOptions) {
    this.store = opts.store;
    this.verify = opts.verifySignature ?? defaultSignatureVerifier();
    this.now = opts.now ?? Date.now;
    this.ttl = opts.challengeTtlMs ?? CHALLENGE_TTL_MS;
    this.allowedChainIds = opts.allowedChainIds ?? [MEZO_TESTNET.chainId];
  }

  get storeInfo() {
    return { kind: this.store.kind, durable: this.store.durable };
  }

  async ping() {
    await this.store.ping();
  }

  private parseAddress(raw: unknown): string {
    if (typeof raw !== 'string' || !isAddress(raw, { strict: false })) throw new IdentityError(400, 'invalid_address', 'A valid wallet address is required.');
    return raw.toLowerCase();
  }

  async lookupUsername(raw: unknown): Promise<PublicUsernameRecord | null> {
    const v = validateUsername(typeof raw === 'string' ? raw : '');
    if (!v.valid) return null;
    const r = await this.store.getByUsername(v.username);
    return r && this.allowedChainIds.includes(r.chainId) ? toPublic(r) : null;
  }

  async lookupAddress(raw: unknown): Promise<PublicUsernameRecord | null> {
    const address = this.parseAddress(raw);
    const r = await this.store.getByAddress(address);
    return r && this.allowedChainIds.includes(r.chainId) ? toPublic(r) : null;
  }

  async checkAvailability(rawUsername: unknown, rawAddress?: unknown) {
    const v = validateUsername(typeof rawUsername === 'string' ? rawUsername : '');
    if (!v.valid) return { username: v.username, available: false, reason: v.error };
    const existing = await this.store.getByUsername(v.username);
    if (!existing) return { username: v.username, available: true };
    const caller = typeof rawAddress === 'string' && isAddress(rawAddress, { strict: false }) ? rawAddress.toLowerCase() : null;
    return { username: v.username, available: false, ownedByCaller: existing.address === caller, reason: 'Already registered.' };
  }

  async createChallenge(body: { address?: unknown; chainId?: unknown; action?: unknown; username?: unknown }, origin: OriginContext) {
    const address = this.parseAddress(body.address);
    const chainId = Number(body.chainId);
    if (!this.allowedChainIds.includes(chainId)) throw new IdentityError(400, 'unsupported_chain', 'Unsupported network.');
    const action = body.action;
    if (action !== 'register' && action !== 'change') throw new IdentityError(400, 'invalid_action', 'Unknown action.');
    const v = validateUsername(typeof body.username === 'string' ? body.username : '');
    if (!v.valid) throw new IdentityError(400, 'invalid_username', v.error);

    // Fast-fail checks for a better UX. They are repeated atomically at commit time.
    const [forName, forWallet] = await Promise.all([this.store.getByUsername(v.username), this.store.getByAddress(address)]);
    if (forName && forName.address !== address) throw new IdentityError(409, 'username_taken', REASON_TO_ERROR.username_taken[1]);
    if (action === 'register' && forWallet) throw new IdentityError(409, 'already_registered', REASON_TO_ERROR.already_registered[1]);
    if (action === 'change' && (!forWallet || forWallet.username === v.username)) {
      throw new IdentityError(400, 'nothing_to_change', REASON_TO_ERROR.nothing_to_change[1]);
    }

    const issuedAt = this.now();
    const expiresAt = issuedAt + this.ttl;
    const nonce = generateSiweNonce();
    const statement =
      action === 'register'
        ? `Register the Cambio username ${formatUsername(v.username)} to this wallet. Signing is free and does not send a transaction.`
        : `Change this wallet's Cambio username from ${formatUsername(forWallet!.username)} to ${formatUsername(v.username)}. Signing is free and does not send a transaction.`;
    const message = createSiweMessage({
      domain: origin.domain,
      address: getAddress(address),
      statement,
      uri: origin.uri,
      version: '1',
      chainId,
      nonce,
      issuedAt: new Date(issuedAt),
      expirationTime: new Date(expiresAt),
    });
    await this.store.saveChallenge({ nonce, address, action: action as ClaimAction, username: v.username, chainId, message, issuedAt, expiresAt, usedAt: null });
    return { nonce, message, expiresAt };
  }

  async claim(body: { nonce?: unknown; signature?: unknown }, origin: OriginContext) {
    if (typeof body.nonce !== 'string' || !/^[a-zA-Z0-9]{8,128}$/.test(body.nonce)) throw new IdentityError(400, 'invalid_challenge', REASON_TO_ERROR.challenge_not_found[1]);
    if (typeof body.signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){0,2048}$/.test(body.signature)) throw new IdentityError(400, 'invalid_signature', 'Signature is malformed.');

    const challenge = await this.store.getChallenge(body.nonce);
    if (!challenge) throw new IdentityError(...this.err('challenge_not_found'));
    if (!this.allowedChainIds.includes(challenge.chainId) || !['register', 'change'].includes(challenge.action)) throw new IdentityError(400, 'invalid_challenge', 'Unsupported sign-in authorization.');
    if (challenge.usedAt !== null) throw new IdentityError(...this.err('challenge_used'));
    const now = this.now();
    if (now >= challenge.expiresAt) throw new IdentityError(...this.err('challenge_expired'));

    // Defence in depth: the stored text must still parse as a SIWE message for this domain and nonce.
    const parsed = parseSiweMessage(challenge.message);
    const statement = challenge.action === 'register'
      ? `Register the Cambio username ${formatUsername(challenge.username)} to this wallet. Signing is free and does not send a transaction.`
      : null;
    if (parsed.uri !== origin.uri || parsed.version !== '1' || parsed.chainId !== challenge.chainId ||
        parsed.issuedAt?.getTime() !== challenge.issuedAt || parsed.expirationTime?.getTime() !== challenge.expiresAt ||
        (statement !== null && parsed.statement !== statement) ||
        (challenge.action === 'change' && (!parsed.statement?.startsWith("Change this wallet's Cambio username from @") || !parsed.statement.endsWith(` to ${formatUsername(challenge.username)}. Signing is free and does not send a transaction.`)))) {
      throw new IdentityError(400, 'invalid_challenge', 'The stored sign-in message does not match the requested action.');
    }
    if (!validateSiweMessage({ message: parsed, domain: origin.domain, nonce: challenge.nonce, address: getAddress(challenge.address), time: new Date(now) })) {
      throw new IdentityError(400, 'invalid_challenge', 'This sign-in request is not valid for this site.');
    }

    // An invalid signature does not consume the nonce, so a third party cannot burn a user's challenge.
    const ok = await this.verify({ address: getAddress(challenge.address), message: challenge.message, signature: body.signature as Hex, chainId: challenge.chainId });
    if (!ok) throw new IdentityError(401, 'invalid_signature', 'The signature was not produced by this wallet.');

    const result = await this.store.commitClaim({ nonce: challenge.nonce, address: challenge.address, action: challenge.action, username: challenge.username, now: this.now() });
    if (!result.ok) throw new IdentityError(...this.err(result.reason));
    return { record: toPublic(result.record), previousUsername: result.previousUsername };
  }

  private err(reason: string): [number, string, string] {
    const [status, message] = REASON_TO_ERROR[reason] ?? [400, 'Request refused.'];
    return [status, reason, message];
  }
}

export { StoreUnavailableError };
