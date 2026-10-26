/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-process store for tests and explicit local development (IDENTITY_STORE=memory).
 * It verifies signatures exactly like production, but data lives only as long as the process and is
 * not shared between instances, so /api/health reports durable: false and the UI says so.
 */

import { decideClaim, type ChallengeRecord, type IdentityStore, type UsernameRecord, type CommitResult } from './store.js';

export class MemoryIdentityStore implements IdentityStore {
  readonly kind = 'memory' as const;
  readonly durable = false;
  private challenges = new Map<string, ChallengeRecord>();
  private byName = new Map<string, UsernameRecord>();
  private byWallet = new Map<string, string>();

  async ping() {}

  async saveChallenge(c: ChallengeRecord) {
    this.challenges.set(c.nonce, { ...c });
    // Bound memory: drop expired challenges opportunistically.
    if (this.challenges.size > 10_000) {
      const now = Date.now();
      for (const [k, v] of this.challenges) if (v.expiresAt < now) this.challenges.delete(k);
    }
  }

  async getChallenge(nonce: string) {
    const c = this.challenges.get(nonce);
    return c ? { ...c } : null;
  }

  async getByUsername(username: string) {
    const r = this.byName.get(username);
    return r ? { ...r } : null;
  }

  async getByAddress(address: string) {
    const name = this.byWallet.get(address);
    return name ? this.getByUsername(name) : null;
  }

  // No awaits inside: the read-check-write sequence cannot interleave with another request.
  async commitClaim(args: { nonce: string; address: string; action: 'register' | 'change'; username: string; now: number }): Promise<CommitResult> {
    const challenge = this.challenges.get(args.nonce) ?? null;
    const forName = this.byName.get(args.username) ?? null;
    const walletName = this.byWallet.get(args.address);
    const forWallet = walletName ? this.byName.get(walletName) ?? null : null;
    const d = decideClaim(args, challenge, forName, forWallet);
    if (challenge && (d.ok || d.markUsed)) this.challenges.set(args.nonce, { ...challenge, usedAt: args.now });
    if (!d.ok) return { ok: false, reason: d.reason };

    const record = forName ? { ...d.record, createdAt: forName.createdAt } : d.record;
    if (d.release) this.byName.delete(d.release);
    this.byName.set(record.username, record);
    this.byWallet.set(record.address, record.username);
    return { ok: true, record: { ...record }, previousUsername: d.release };
  }
}
