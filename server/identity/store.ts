/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistence contract for the username registry. Implementations must make commitClaim atomic:
 * consuming the challenge, checking uniqueness and writing both directions of the mapping happen
 * together or not at all.
 */

export type ClaimAction = 'register' | 'change';

export interface UsernameRecord {
  username: string;
  /** Lowercase 0x address. */
  address: string;
  createdAt: number;
  updatedAt: number;
  /** How ownership was proven. Only 'siwe' (EIP-4361 signature verified server-side) exists. */
  proof: 'siwe';
  chainId: number;
}

export interface ChallengeRecord {
  nonce: string;
  address: string;
  action: ClaimAction;
  username: string;
  chainId: number;
  /** The exact EIP-4361 text the wallet must sign. */
  message: string;
  issuedAt: number;
  expiresAt: number;
  usedAt: number | null;
}

export type CommitResult =
  | { ok: true; record: UsernameRecord; previousUsername: string | null }
  | {
      ok: false;
      reason:
        | 'challenge_not_found'
        | 'challenge_used'
        | 'challenge_expired'
        | 'challenge_mismatch'
        | 'username_taken'
        | 'already_registered'
        | 'nothing_to_change';
    };

export interface IdentityStore {
  readonly kind: 'firestore' | 'sqlite' | 'memory';
  /** Whether data survives process restarts. SQLite instances must share the same local disk file. */
  readonly durable: boolean;
  /** Cheap connectivity probe used by /api/health. */
  ping(): Promise<void>;
  saveChallenge(c: ChallengeRecord): Promise<void>;
  getChallenge(nonce: string): Promise<ChallengeRecord | null>;
  getByUsername(username: string): Promise<UsernameRecord | null>;
  getByAddress(address: string): Promise<UsernameRecord | null>;
  /**
   * Atomically: verify the challenge is unused/unexpired/matching, mark it used, enforce uniqueness,
   * release the wallet's previous name (for 'change') and write both mappings.
   * The challenge is marked used even when the claim is refused, so a signature can never be replayed.
   */
  commitClaim(args: { nonce: string; address: string; action: ClaimAction; username: string; now: number }): Promise<CommitResult>;
}

export class StoreUnavailableError extends Error {
  constructor(message = 'Identity store unavailable') {
    super(message);
    this.name = 'StoreUnavailableError';
  }
}

/**
 * Pure decision logic shared by every store, so the rules cannot drift between implementations.
 * Given the current state, returns what commitClaim must write.
 */
export function decideClaim(
  args: { address: string; action: ClaimAction; username: string; now: number },
  challenge: ChallengeRecord | null,
  existingForName: UsernameRecord | null,
  existingForWallet: UsernameRecord | null
):
  | { ok: false; reason: Exclude<CommitResult, { ok: true }>['reason']; markUsed: boolean }
  | { ok: true; record: UsernameRecord; release: string | null } {
  if (!challenge) return { ok: false, reason: 'challenge_not_found', markUsed: false };
  if (challenge.usedAt !== null) return { ok: false, reason: 'challenge_used', markUsed: false };
  if (args.now >= challenge.expiresAt) return { ok: false, reason: 'challenge_expired', markUsed: true };
  if (
    challenge.address !== args.address ||
    challenge.action !== args.action ||
    challenge.username !== args.username
  ) {
    return { ok: false, reason: 'challenge_mismatch', markUsed: true };
  }
  if (existingForName && existingForName.address !== args.address) {
    return { ok: false, reason: 'username_taken', markUsed: true };
  }
  if (args.action === 'register' && existingForWallet) {
    return { ok: false, reason: 'already_registered', markUsed: true };
  }
  if (args.action === 'change') {
    if (!existingForWallet) return { ok: false, reason: 'nothing_to_change', markUsed: true };
    if (existingForWallet.username === args.username) return { ok: false, reason: 'nothing_to_change', markUsed: true };
  }
  const record: UsernameRecord = {
    username: args.username,
    address: args.address,
    createdAt: args.now,
    updatedAt: args.now,
    proof: 'siwe',
    chainId: challenge.chainId,
  };
  return { ok: true, record, release: args.action === 'change' ? existingForWallet!.username : null };
}
