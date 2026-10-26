import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SqliteIdentityStore } from '../server/identity/sqliteStore';
import { IdentityService } from '../server/identity/service';
import { bootstrapIdentity } from '../server/bootstrap';
import type { ChallengeRecord } from '../server/identity/store';
import { backupIdentity } from '../scripts/backup-identity.mjs';

const cache = path.resolve('node_modules/.cache'); mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(path.join(cache, 'cambio-sqlite-test-'));
const opened: SqliteIdentityStore[] = [];
let filename: string;
let store: SqliteIdentityStore;
let counter = 0;
const now = Date.UTC(2026, 9, 26);
const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const challenge = (nonce: string, addr: string, username: string, action: 'register' | 'change' = 'register'): ChallengeRecord =>
  ({ nonce, address: addr, username, action, chainId: 31611, message: 'internal store test', issuedAt: now, expiresAt: now + 300_000, usedAt: null });
function open(file = filename) { const result = new SqliteIdentityStore(file); opened.push(result); return result; }
beforeEach(() => { filename = path.join(directory, `registry-${counter++}.sqlite`); store = open(); });
afterEach(() => { for (const item of opened.splice(0)) { try { item.close(); } catch { /* Some tests explicitly close and reopen. */ } } });
afterAll(() => { if (!directory.startsWith(cache + path.sep)) throw new Error('Unexpected test directory'); rmSync(directory, { recursive: true, force: true }); });

async function register(nonce: string, addr = address(1), username = 'first_name') {
  await store.saveChallenge(challenge(nonce, addr, username));
  return store.commitClaim({ nonce, address: addr, action: 'register', username, now });
}

describe('durable SQLite identity', () => {
  it('preserves verified records, consumed challenges and quotas across close/reopen', async () => {
    expect((await register('persist_nonce')).ok).toBe(true);
    expect((await store.consume('claim:127.0.0.1', 1, 60000, now)).allowed).toBe(true);
    store.close(); const reopened = open();
    expect(await reopened.getByAddress(address(1))).toMatchObject({ username: 'first_name', proof: 'siwe' });
    expect(await reopened.getByUsername('first_name')).toMatchObject({ address: address(1) });
    expect(await reopened.commitClaim({ nonce: 'persist_nonce', address: address(1), action: 'register', username: 'first_name', now })).toEqual({ ok: false, reason: 'challenge_used' });
    expect((await reopened.consume('claim:127.0.0.1', 1, 60000, now + 1)).allowed).toBe(false);
    expect((await reopened.consume('claim:127.0.0.1', 1, 60000, now + 60000)).allowed).toBe(true);
  });

  it('changes and releases names atomically and prevents a second name for the same wallet', async () => {
    await register('register_nonce');
    expect(await register('duplicate_nonce', address(1), 'second_name')).toEqual({ ok: false, reason: 'already_registered' });
    await store.saveChallenge(challenge('change_nonce', address(1), 'changed_name', 'change'));
    expect(await store.commitClaim({ nonce: 'change_nonce', address: address(1), action: 'change', username: 'changed_name', now })).toMatchObject({ ok: true, previousUsername: 'first_name' });
    expect(await store.getByUsername('first_name')).toBeNull();
    expect((await register('release_nonce', address(2), 'first_name')).ok).toBe(true);
    expect((await store.getByAddress(address(1)))?.username).toBe('changed_name');
  });

  it('rejects expired and mismatched challenges without leaving usable nonces', async () => {
    await store.saveChallenge(challenge('expired_nonce', address(1), 'expired_name'));
    expect(await store.commitClaim({ nonce: 'expired_nonce', address: address(1), action: 'register', username: 'expired_name', now: now + 300000 })).toEqual({ ok: false, reason: 'challenge_expired' });
    await store.saveChallenge(challenge('mismatch_nonce', address(1), 'signed_name'));
    expect(await store.commitClaim({ nonce: 'mismatch_nonce', address: address(2), action: 'register', username: 'signed_name', now })).toEqual({ ok: false, reason: 'challenge_mismatch' });
    expect((await store.getChallenge('mismatch_nonce'))?.usedAt).toBe(now);
    expect(await store.getByUsername('signed_name')).toBeNull();
  });

  it('rolls back nonce consumption and name release if the final write fails', async () => {
    await register('initial_nonce');
    await store.saveChallenge(challenge('rollback_nonce', address(1), 'new_name', 'change'));
    const db = new DatabaseSync(filename);
    db.exec("CREATE TRIGGER fail_test BEFORE INSERT ON usernames WHEN NEW.username='new_name' BEGIN SELECT RAISE(ABORT,'test write failure'); END"); db.close();
    await expect(store.commitClaim({ nonce: 'rollback_nonce', address: address(1), action: 'change', username: 'new_name', now })).rejects.toMatchObject({ name: 'StoreUnavailableError' });
    expect((await store.getByAddress(address(1)))?.username).toBe('first_name');
    expect((await store.getChallenge('rollback_nonce'))?.usedAt).toBeNull();
    expect(await store.getByUsername('new_name')).toBeNull();
  });

  it('verifies real wallet signatures and refuses replay after restarting the registry', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const origin = { domain: 'pay.example.com', uri: 'https://pay.example.com' };
    const service = new IdentityService({ store, now: () => now });
    const c = await service.createChallenge({ address: account.address, chainId: 31611, action: 'register', username: 'signed_owner' }, origin);
    const signature = await account.signMessage({ message: c.message });
    expect((await service.claim({ nonce: c.nonce, signature }, origin)).record.verified).toBe(true);
    store.close(); const restarted = new IdentityService({ store: open(), now: () => now });
    expect(await restarted.lookupUsername('signed_owner')).toMatchObject({ address: account.address, verified: true });
    await expect(restarted.claim({ nonce: c.nonce, signature }, origin)).rejects.toMatchObject({ code: 'challenge_used' });
    const wrong = privateKeyToAccount(generatePrivateKey());
    const c2 = await restarted.createChallenge({ address: account.address, chainId: 31611, action: 'change', username: 'stolen_name' }, origin);
    await expect(restarted.claim({ nonce: c2.nonce, signature: await wrong.signMessage({ message: c2.message }) }, origin)).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('backs up committed WAL data consistently and refuses to overwrite an existing backup', async () => {
    await register('backup_nonce');
    const destination = path.join(directory, `snapshot-${counter}.sqlite`);
    await backupIdentity(filename, destination);
    const restored = open(destination);
    expect((await restored.getByUsername('first_name'))?.address).toBe(address(1));
    expect((await restored.getChallenge('backup_nonce'))?.usedAt).toBe(now);
    await expect(backupIdentity(filename, destination)).rejects.toThrow();
    expect((await restored.getByUsername('first_name'))?.address).toBe(address(1));
  });

  it('fails closed for unavailable files and refuses unrelated or newer database schemas', async () => {
    await expect(store.getByUsername("'; DROP TABLE usernames; --")).resolves.toBeNull();
    store.close(); await expect(store.ping()).rejects.toMatchObject({ name: 'StoreUnavailableError' });
    expect(() => new SqliteIdentityStore(':memory:')).toThrow('absolute');
    const other = path.join(directory, 'unrelated.sqlite'); const db = new DatabaseSync(other); db.exec('CREATE TABLE unrelated (id INTEGER)'); db.close();
    expect(() => new SqliteIdentityStore(other)).toThrow('Unsupported');
    const future = path.join(directory, 'future.sqlite'); const newer = new DatabaseSync(future); newer.exec('PRAGMA application_id=1128353090; PRAGMA user_version=2'); newer.close();
    expect(() => new SqliteIdentityStore(future)).toThrow('Unsupported');
    const broken = open(filename); broken.close();
    const damaged = new DatabaseSync(filename); damaged.exec('DROP TABLE usernames'); damaged.close();
    expect(() => new SqliteIdentityStore(filename)).toThrow();
  });

  it('bootstraps production SQLite without Firebase and rejects ephemeral serverless storage', async () => {
    const result = await bootstrapIdentity({ IDENTITY_STORE: 'sqlite', IDENTITY_DATABASE_PATH: filename, FIRESTORE_EMULATOR_HOST: '127.0.0.1:1', FIREBASE_SERVICE_ACCOUNT_JSON: 'invalid-and-unused' }, 'production');
    try { expect(result.identity?.storeInfo).toEqual({ kind: 'sqlite', durable: true }); expect(result.rateLimitStore).toBeDefined(); } finally { result.close?.(); }
    expect((await bootstrapIdentity({ IDENTITY_STORE: 'sqlite' }, 'production')).identity).toBeNull();
    expect((await bootstrapIdentity({ IDENTITY_STORE: 'sqlite', IDENTITY_DATABASE_PATH: filename, VERCEL: '1' }, 'production')).identity).toBeNull();
    expect((await bootstrapIdentity({ IDENTITY_STORE: 'sqlite', IDENTITY_DATABASE_PATH: filename, K_SERVICE: 'cloud-run' }, 'production')).identity).toBeNull();
  });

  it('enforces unique names, one-use nonces and shared limits under genuinely concurrent workers', async () => {
    const bundle = path.join(directory, 'store.mjs');
    await build({ entryPoints: ['server/identity/sqliteStore.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle });
    for (let i = 0; i < 6; i++) await store.saveChallenge(challenge(`race_nonce_${i}`, address(i + 20), 'race_name'));
    const workers = Array.from({ length: 6 }, (_, i) => new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      import(workerData.module).then(({ SqliteIdentityStore }) => {
        const store = new SqliteIdentityStore(workerData.file);
        parentPort.once('message', async () => {
          try { const result = await store.commitClaim(workerData.claim); const limit = await store.consume('same-key', 3, 60000, workerData.claim.now); parentPort.postMessage({ result, limit }); }
          catch(error) { parentPort.postMessage({ error: error.message }); }
          finally { store.close(); parentPort.close(); }
        }); parentPort.postMessage('ready');
      }).catch(error => { throw error; });
    `, { eval: true, execArgv: [], workerData: { module: pathToFileURL(bundle).href, file: filename, claim: { nonce: `race_nonce_${i}`, address: address(i + 20), action: 'register', username: 'race_name', now } } }));
    try {
      await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject); })));
      const replies = workers.map((worker) => new Promise<{ result: { ok: boolean }; limit: { allowed: boolean }; error?: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
      workers.forEach((worker) => worker.postMessage('go'));
      const results = await Promise.all(replies);
      expect(results.filter((r) => r.error)).toEqual([]);
      expect(results.filter((r) => r.result.ok)).toHaveLength(1);
      expect(results.filter((r) => r.limit.allowed)).toHaveLength(3);
      const winner = await store.getByUsername('race_name');
      const replay = await store.commitClaim({ nonce: `race_nonce_${Number(BigInt(winner!.address)) - 20}`, address: winner!.address, action: 'register', username: 'race_name', now });
      expect(replay).toEqual({ ok: false, reason: 'challenge_used' });
    } finally { await Promise.all(workers.map((worker) => worker.terminate())); }
  });
});
