/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Invoices in the same self-hosted SQLite file as the identity registry (opened after
 * SqliteIdentityStore has validated or created the schema). Tables are added idempotently, so existing
 * registries gain invoice storage without a migration step. Backups (scripts/backup-identity.mjs) copy
 * the whole file, including these tables.
 */

import { DatabaseSync } from 'node:sqlite';
import { StoreUnavailableError } from '../identity/store.js';
import { applySettlement, sameSignedContent, type InsertResult, type InvoiceRecord, type InvoiceSettlement, type InvoiceStore, type ListCursor, type MerchantSession, type SessionChallenge } from './store.js';

const APPLICATION_ID = 1128353090;
type Row = Record<string, string | number | bigint | Uint8Array | null>;

function toRecord(row: Row | undefined): InvoiceRecord | null {
  if (!row) return null;
  try {
    return {
      id: String(row.id),
      chainId: Number(row.chain_id),
      recipient: String(row.recipient),
      request: JSON.parse(String(row.request_json)),
      signature: String(row.signature) as InvoiceRecord['signature'],
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      storedAt: Number(row.stored_at),
      settlement: row.settlement_json === null ? null : JSON.parse(String(row.settlement_json)),
      duplicatePayments: JSON.parse(String(row.duplicates_json)),
    };
  } catch {
    return null;
  }
}

export class SqliteInvoiceStore implements InvoiceStore {
  readonly kind = 'sqlite' as const;
  readonly durable = true;
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
      const id = Number(this.db.prepare('PRAGMA application_id').get()!.application_id);
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (id !== APPLICATION_ID || version !== 1) throw new Error('Open the identity store first: this is not a Cambio registry database.');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS invoices (
          recipient TEXT NOT NULL, id TEXT NOT NULL, chain_id INTEGER NOT NULL,
          request_json TEXT NOT NULL, signature TEXT NOT NULL,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, stored_at INTEGER NOT NULL,
          settlement_json TEXT, duplicates_json TEXT NOT NULL DEFAULT '[]',
          PRIMARY KEY (recipient, id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS invoices_by_recipient ON invoices(recipient, created_at DESC, id DESC);
        CREATE TABLE IF NOT EXISTS merchant_challenges (
          nonce TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL, message TEXT NOT NULL,
          issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
        ) STRICT;
        CREATE TABLE IF NOT EXISTS merchant_sessions (
          token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS merchant_sessions_expiry ON merchant_sessions(expires_at);
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close() {
    this.db.close();
  }

  private tx<T>(operation: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = operation();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch { /* keep the original error */ }
        throw error;
      }
    } catch {
      throw new StoreUnavailableError();
    }
  }

  private read<T>(operation: () => T): T {
    try { return operation(); } catch { throw new StoreUnavailableError(); }
  }

  async insertInvoice(r: InvoiceRecord, maxPerRecipient: number): Promise<InsertResult> {
    return this.tx(() => {
      const existing = toRecord(this.db.prepare('SELECT * FROM invoices WHERE recipient=? AND id=?').get(r.recipient, r.id));
      if (existing) return sameSignedContent(existing, r) ? 'exists' : 'conflict';
      const count = Number(this.db.prepare('SELECT count(*) AS n FROM invoices WHERE recipient=?').get(r.recipient)!.n);
      if (count >= maxPerRecipient) return 'limit';
      this.db.prepare('INSERT INTO invoices VALUES (?,?,?,?,?,?,?,?,?,?)').run(
        r.recipient, r.id, r.chainId, JSON.stringify(r.request), r.signature, r.createdAt, r.expiresAt, r.storedAt,
        r.settlement ? JSON.stringify(r.settlement) : null, JSON.stringify(r.duplicatePayments)
      );
      return 'created';
    });
  }

  async getInvoice(recipient: string, id: string) {
    return this.read(() => toRecord(this.db.prepare('SELECT * FROM invoices WHERE recipient=? AND id=?').get(recipient, id)));
  }

  async listInvoices(recipient: string, limit: number, before?: ListCursor) {
    return this.read(() => {
      const rows = before
        ? this.db.prepare('SELECT * FROM invoices WHERE recipient=? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?').all(recipient, before.createdAt, before.createdAt, before.id, limit)
        : this.db.prepare('SELECT * FROM invoices WHERE recipient=? ORDER BY created_at DESC, id DESC LIMIT ?').all(recipient, limit);
      return rows.map((row) => toRecord(row as Row)).filter((r): r is InvoiceRecord => r !== null);
    });
  }

  async recordSettlement(recipient: string, id: string, s: InvoiceSettlement) {
    return this.tx(() => {
      const current = toRecord(this.db.prepare('SELECT * FROM invoices WHERE recipient=? AND id=?').get(recipient, id));
      if (!current) return null;
      const next = applySettlement(current, s);
      this.db.prepare('UPDATE invoices SET settlement_json=?, duplicates_json=? WHERE recipient=? AND id=?').run(
        next.settlement ? JSON.stringify(next.settlement) : null, JSON.stringify(next.duplicatePayments), recipient, id
      );
      return next;
    });
  }

  async saveChallenge(c: SessionChallenge) {
    this.tx(() => {
      this.db.prepare('DELETE FROM merchant_challenges WHERE expires_at < ?').run(c.issuedAt - 86_400_000);
      this.db.prepare('INSERT INTO merchant_challenges VALUES (?,?,?,?,?,?,?)').run(c.nonce, c.address, c.chainId, c.message, c.issuedAt, c.expiresAt, c.usedAt);
    });
  }

  async getChallenge(nonce: string) {
    return this.read(() => {
      const row = this.db.prepare('SELECT * FROM merchant_challenges WHERE nonce=?').get(nonce);
      if (!row) return null;
      return { nonce: String(row.nonce), address: String(row.address), chainId: Number(row.chain_id), message: String(row.message), issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at), usedAt: row.used_at === null ? null : Number(row.used_at) };
    });
  }

  async consumeChallenge(nonce: string, now: number) {
    return this.tx(() => Number(this.db.prepare('UPDATE merchant_challenges SET used_at=? WHERE nonce=? AND used_at IS NULL AND expires_at > ?').run(now, nonce, now).changes) === 1);
  }

  async saveSession(s: MerchantSession) {
    this.tx(() => {
      this.db.prepare('DELETE FROM merchant_sessions WHERE expires_at <= ?').run(s.createdAt);
      this.db.prepare('INSERT INTO merchant_sessions VALUES (?,?,?,?)').run(s.tokenHash, s.address, s.createdAt, s.expiresAt);
    });
  }

  async getSession(tokenHash: string) {
    return this.read(() => {
      const row = this.db.prepare('SELECT * FROM merchant_sessions WHERE token_hash=?').get(tokenHash);
      return row ? { tokenHash: String(row.token_hash), address: String(row.address), createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) } : null;
    });
  }
}
