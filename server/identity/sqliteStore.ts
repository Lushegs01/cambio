import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { isAddress } from 'viem';
import { validateUsername } from '../../shared/username.js';
import { decideClaim, StoreUnavailableError, type ChallengeRecord, type CommitResult, type IdentityStore, type UsernameRecord } from './store.js';
import type { SharedRateLimitStore } from '../rateLimit.js';

type Row = Record<string, string | number | bigint | Uint8Array | null>;
const APPLICATION_ID = 1128353090; // CAMB: refuse unrelated databases and unsupported schema versions.

function record(row: Row | undefined): UsernameRecord | null {
  if (!row || row.proof !== 'siwe' || typeof row.username !== 'string' || !validateUsername(row.username).valid ||
      typeof row.address !== 'string' || row.address !== row.address.toLowerCase() || !isAddress(row.address, { strict: false }) ||
      !Number.isSafeInteger(row.chain_id) || !Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(row.updated_at)) return null;
  return { username: row.username, address: row.address, proof: 'siwe', chainId: Number(row.chain_id), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}

function challenge(row: Row | undefined): ChallengeRecord | null {
  if (!row) return null;
  return { nonce: String(row.nonce), address: String(row.address), action: row.action as ChallengeRecord['action'], username: String(row.username),
    chainId: Number(row.chain_id), message: String(row.message), issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at), usedAt: row.used_at === null ? null : Number(row.used_at) };
}

/** One durable local file on one host. Never use a network filesystem or independent replica volumes. */
export class SqliteIdentityStore implements IdentityStore, SharedRateLimitStore {
  readonly kind = 'sqlite' as const;
  readonly durable = true;
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    if (!path.isAbsolute(filename)) throw new Error('IDENTITY_DATABASE_PATH must be an absolute persistent file path.');
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    try {
      chmodSync(filename, 0o600);
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
      this.transaction(() => {
        const id = Number(this.db.prepare('PRAGMA application_id').get()!.application_id);
        const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
        const tables = Number(this.db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()!.count);
        if (id === APPLICATION_ID && version === 1) {
          // Never silently turn a damaged existing registry into an empty namespace.
          this.db.prepare('SELECT username,address,created_at,updated_at,proof,chain_id FROM usernames LIMIT 0').all();
          this.db.prepare('SELECT nonce,address,action,username,chain_id,message,issued_at,expires_at,used_at FROM challenges LIMIT 0').all();
          this.db.prepare('SELECT key,count,reset_at FROM rate_limits LIMIT 0').all();
          return;
        }
        if (id !== 0 || tables > 0 || version !== 0) throw new Error('Unsupported identity database.');
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS usernames (
            username TEXT PRIMARY KEY, address TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            proof TEXT NOT NULL CHECK(proof='siwe'), chain_id INTEGER NOT NULL
          ) STRICT;
          CREATE TABLE IF NOT EXISTS challenges (
            nonce TEXT PRIMARY KEY, address TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('register','change')),
            username TEXT NOT NULL, chain_id INTEGER NOT NULL, message TEXT NOT NULL,
            issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
          ) STRICT;
          CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires_at);
          CREATE TABLE IF NOT EXISTS rate_limits (
            key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(reset_at);
          PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;
        `);
      });
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() { this.db.close(); }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch { /* Preserve the original failure. */ } throw error; }
  }

  private guard<T>(operation: () => T): T {
    try { return operation(); } catch { throw new StoreUnavailableError(); }
  }

  async ping() { this.guard(() => this.db.prepare('SELECT 1').get()); }

  async saveChallenge(c: ChallengeRecord) {
    this.guard(() => this.transaction(() => {
      this.db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(c.issuedAt - 86_400_000);
      this.db.prepare('INSERT INTO challenges VALUES (?,?,?,?,?,?,?,?,?)').run(c.nonce, c.address, c.action, c.username, c.chainId, c.message, c.issuedAt, c.expiresAt, c.usedAt);
    }));
  }

  async getChallenge(nonce: string) {
    return this.guard(() => challenge(this.db.prepare('SELECT * FROM challenges WHERE nonce=?').get(nonce)));
  }
  async getByUsername(username: string) {
    return this.guard(() => record(this.db.prepare('SELECT * FROM usernames WHERE username=?').get(username)));
  }
  async getByAddress(address: string) {
    return this.guard(() => record(this.db.prepare('SELECT * FROM usernames WHERE address=?').get(address)));
  }

  async commitClaim(args: { nonce: string; address: string; action: 'register' | 'change'; username: string; now: number }): Promise<CommitResult> {
    return this.guard(() => this.transaction(() => {
      const c = challenge(this.db.prepare('SELECT * FROM challenges WHERE nonce=?').get(args.nonce));
      const forName = record(this.db.prepare('SELECT * FROM usernames WHERE username=?').get(args.username));
      const forWallet = record(this.db.prepare('SELECT * FROM usernames WHERE address=?').get(args.address));
      const decision = decideClaim(args, c, forName, forWallet);
      if (c && (decision.ok || decision.markUsed)) this.db.prepare('UPDATE challenges SET used_at=? WHERE nonce=?').run(args.now, args.nonce);
      if (!decision.ok) return { ok: false, reason: decision.reason };
      const saved = forName ? { ...decision.record, createdAt: forName.createdAt } : decision.record;
      if (decision.release) this.db.prepare('DELETE FROM usernames WHERE username=? AND address=?').run(decision.release, args.address);
      this.db.prepare(`INSERT INTO usernames VALUES (?,?,?,?,?,?)
        ON CONFLICT(username) DO UPDATE SET address=excluded.address, created_at=excluded.created_at,
        updated_at=excluded.updated_at, proof=excluded.proof, chain_id=excluded.chain_id`)
        .run(saved.username, saved.address, saved.createdAt, saved.updatedAt, saved.proof, saved.chainId);
      return { ok: true, record: saved, previousUsername: decision.release };
    }));
  }

  async consume(key: string, max: number, windowMs: number, now: number) {
    return this.guard(() => this.transaction(() => {
      this.db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(now);
      const hashed = createHash('sha256').update(key).digest('hex');
      const saved = this.db.prepare('SELECT * FROM rate_limits WHERE key=?').get(hashed);
      const count = saved ? Number(saved.count) + 1 : 1;
      const resetAt = saved ? Number(saved.reset_at) : now + windowMs;
      if (count <= max) this.db.prepare('INSERT INTO rate_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, reset_at=excluded.reset_at').run(hashed, count, resetAt);
      return { allowed: count <= max, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    }));
  }
}
