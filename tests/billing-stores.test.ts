/**
 * The billing store contract against the in-memory store and (on Node >= 24) self-hosted SQLite.
 */
import { afterAll, describe } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MemoryBillingStore } from '../server/billing/memoryStore';
import { billingStoreContract } from './billingStoreContract';

describe('MemoryBillingStore', () => billingStoreContract(() => new MemoryBillingStore()));

const nodeMajor = Number(process.versions.node.split('.')[0]);
describe.skipIf(nodeMajor < 24)('SqliteBillingStore (shares the identity database file)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cambio-billing-'));
  const closers: Array<() => void> = [];
  afterAll(() => { closers.forEach((c) => c()); rmSync(dir, { recursive: true, force: true }); });
  let n = 0;
  billingStoreContract(async () => {
    const file = path.join(dir, `registry-${n++}.sqlite`);
    const { SqliteIdentityStore } = await import('../server/identity/sqliteStore');
    const { SqliteBillingStore } = await import('../server/billing/sqliteStore');
    const identity = new SqliteIdentityStore(file);
    const store = new SqliteBillingStore(file);
    closers.push(() => { store.close(); identity.close(); });
    return store;
  });
});
