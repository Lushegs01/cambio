/**
 * FirestoreIdentityStore against the real Firestore emulator: verifies that commitClaim is atomic
 * under genuinely concurrent transactions. Run with: npm run test:rules
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreIdentityStore, COLLECTIONS } from '../../server/identity/firestoreStore';
import type { ChallengeRecord } from '../../server/identity/store';

let app: App;
let store: FirestoreIdentityStore;
const now = Date.UTC(2026, 9, 22);
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

function challenge(nonce: string, address: string, username: string, action: 'register' | 'change' = 'register'): ChallengeRecord {
  return { nonce, address, action, username, chainId: 31611, message: 'signed text', issuedAt: now, expiresAt: now + 300_000, usedAt: null };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST must point at the emulator');
  app = initializeApp({ projectId: 'demo-cambio-store' }, `store-test-${Date.now()}`);
  const db = getFirestore(app);
  for (const c of Object.values(COLLECTIONS)) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  store = new FirestoreIdentityStore(db);
});
afterAll(async () => app && deleteApp(app));

describe('FirestoreIdentityStore.commitClaim', () => {
  it('shares rate limits atomically across independent server instances', async () => {
    const other = new FirestoreIdentityStore(getFirestore(app));
    const key = `mutation:rate-test-${Date.now()}`;
    const attempts = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? store : other).consume(key, 3, 60000, now)));
    expect(attempts.filter((r) => r.allowed)).toHaveLength(3);
    expect((await other.consume(key, 3, 60000, now + 60000)).allowed).toBe(true);
  });

  it('does not promote unsigned or mis-keyed database records to verified identities', async () => {
    const db = getFirestore(app);
    await db.collection(COLLECTIONS.usernames).doc('unsigned_name').set({ username: 'unsigned_name', address: addr(999), proof: 'unsigned' });
    expect(await store.getByUsername('unsigned_name')).toBeNull();
    await db.collection(COLLECTIONS.usernames).doc('wrong_name').set({ username: 'other_name', address: addr(999), proof: 'siwe' });
    expect(await store.getByUsername('wrong_name')).toBeNull();
  });
  it('lets exactly one of many concurrent wallets claim the same username', async () => {
    const contenders = Array.from({ length: 8 }, (_, i) => ({ nonce: `race${i}nonce`, address: addr(i + 1) }));
    await Promise.all(contenders.map((c) => store.saveChallenge(challenge(c.nonce, c.address, 'hot_name'))));
    const results = await Promise.all(contenders.map((c) => store.commitClaim({ nonce: c.nonce, address: c.address, action: 'register', username: 'hot_name', now })));
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'username_taken')).toBe(true);
    const owner = await store.getByUsername('hot_name');
    expect(owner?.address).toBe((winners[0] as { record: { address: string } }).record.address);
    expect((await store.getByAddress(owner!.address))?.username).toBe('hot_name');
  });

  it('consumes the challenge so a concurrent replay of the same nonce succeeds at most once', async () => {
    await store.saveChallenge(challenge('replaynonce1', addr(100), 'once_only'));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.commitClaim({ nonce: 'replaynonce1', address: addr(100), action: 'register', username: 'once_only', now }))
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await store.getChallenge('replaynonce1'))?.usedAt).toBe(now);
  });

  it('changes a username atomically and releases the old one', async () => {
    const a = addr(200);
    await store.saveChallenge(challenge('reg200nonce', a, 'before_name'));
    expect((await store.commitClaim({ nonce: 'reg200nonce', address: a, action: 'register', username: 'before_name', now })).ok).toBe(true);
    await store.saveChallenge(challenge('chg200nonce', a, 'after_name', 'change'));
    const res = await store.commitClaim({ nonce: 'chg200nonce', address: a, action: 'change', username: 'after_name', now: now + 1 });
    expect(res).toMatchObject({ ok: true, previousUsername: 'before_name' });
    expect(await store.getByUsername('before_name')).toBeNull();
    expect((await store.getByAddress(a))?.username).toBe('after_name');
  });

  it('refuses expired and mismatched challenges and marks them used', async () => {
    await store.saveChallenge(challenge('expirednonce', addr(300), 'late_name'));
    expect(await store.commitClaim({ nonce: 'expirednonce', address: addr(300), action: 'register', username: 'late_name', now: now + 400_000 })).toEqual({ ok: false, reason: 'challenge_expired' });
    await store.saveChallenge(challenge('mismatchnonce', addr(301), 'their_name'));
    expect(await store.commitClaim({ nonce: 'mismatchnonce', address: addr(302), action: 'register', username: 'their_name', now })).toEqual({ ok: false, reason: 'challenge_mismatch' });
    expect((await store.getChallenge('mismatchnonce'))?.usedAt).toBe(now);
    expect(await store.getByUsername('their_name')).toBeNull();
  });
});
