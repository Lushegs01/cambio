/**
 * The invoice store contract against the in-memory store and (on Node >= 24) self-hosted SQLite.
 */
import { afterAll, describe } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryInvoiceStore } from '../server/invoices/memoryStore';
import { invoiceStoreContract } from './invoiceStoreContract';

describe('MemoryInvoiceStore', () => invoiceStoreContract(() => new MemoryInvoiceStore()));

const nodeMajor = Number(process.versions.node.split('.')[0]);
describe.skipIf(nodeMajor < 24)('SqliteInvoiceStore (shares the identity database file)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cambio-invoices-'));
  const closers: Array<() => void> = [];
  afterAll(() => { closers.forEach((c) => c()); rmSync(dir, { recursive: true, force: true }); });
  let n = 0;
  invoiceStoreContract(async () => {
    const file = path.join(dir, `registry-${n++}.sqlite`);
    const { SqliteIdentityStore } = await import('../server/identity/sqliteStore');
    const { SqliteInvoiceStore } = await import('../server/invoices/sqliteStore');
    const identity = new SqliteIdentityStore(file);
    const store = new SqliteInvoiceStore(file);
    closers.push(() => { store.close(); identity.close(); });
    return store;
  });
});
