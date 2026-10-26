/**
 * Firestore security rules, tested against the real Firestore emulator.
 * Run with: npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const ALICE = '0x1111111111111111111111111111111111111111';
const MALLORY = '0x2222222222222222222222222222222222222222';

let env: RulesTestEnvironment;

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-cambio-rules',
    firestore: { rules: readFileSync(process.env.RULES_FILE || 'firestore.rules', 'utf8'), host, port: Number(port) },
  });
});
afterAll(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // Seed as the server would (bypassing rules), including legacy prototype data.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'verified_usernames/alice'), { username: 'alice', address: ALICE, createdAt: 1, updatedAt: 1, proof: 'siwe', chainId: 31611 });
    await setDoc(doc(db, `verified_wallets/${ALICE}`), { username: 'alice', address: ALICE, updatedAt: 1 });
    await setDoc(doc(db, 'identity_challenges/abc123nonce'), { nonce: 'abc123nonce', address: ALICE });
    await setDoc(doc(db, `wallet_transactions/${ALICE}/history/tx1`), { amount: 10 });
    await setDoc(doc(db, `user_preferences/${ALICE}`), { preferredCurrency: 'NGN' });
    await setDoc(doc(db, 'usernames/legacy'), { username: 'legacy', ownerAddress: ALICE });
  });
});

const anon = () => env.unauthenticatedContext().firestore();
const signedIn = (uid: string) => env.authenticatedContext(uid).firestore();

describe('public verified registry', () => {
  it('allows reading a single verified username and wallet record', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'verified_usernames/alice')));
    await assertSucceeds(getDoc(doc(anon(), `verified_wallets/${ALICE}`)));
  });

  it('denies listing (enumerating) the registry', async () => {
    await assertFails(getDocs(collection(anon(), 'verified_usernames')));
    await assertFails(getDocs(collection(anon(), 'verified_wallets')));
  });

  it('denies every client write, even for the "owner" uid', async () => {
    for (const db of [anon(), signedIn(ALICE), signedIn(MALLORY)]) {
      await assertFails(setDoc(doc(db, 'verified_usernames/mallory'), { username: 'mallory', address: MALLORY }));
      await assertFails(updateDoc(doc(db, 'verified_usernames/alice'), { address: MALLORY }));
      await assertFails(deleteDoc(doc(db, 'verified_usernames/alice')));
      await assertFails(setDoc(doc(db, `verified_wallets/${MALLORY}`), { username: 'alice' }));
      await assertFails(deleteDoc(doc(db, `verified_wallets/${ALICE}`)));
    }
  });
});

describe('server-only and legacy collections', () => {
  it('never exposes sign-in challenges', async () => {
    await assertFails(getDoc(doc(anon(), 'identity_challenges/abc123nonce')));
    await assertFails(getDoc(doc(signedIn(ALICE), 'identity_challenges/abc123nonce')));
    await assertFails(setDoc(doc(anon(), 'identity_challenges/forged'), { nonce: 'forged' }));
  });

  it('denies reading or writing another wallet’s history or preferences by supplying its address', async () => {
    for (const db of [anon(), signedIn(MALLORY)]) {
      await assertFails(getDoc(doc(db, `wallet_transactions/${ALICE}/history/tx1`)));
      await assertFails(getDocs(collection(db, `wallet_transactions/${ALICE}/history`)));
      await assertFails(setDoc(doc(db, `wallet_transactions/${ALICE}/history/fake`), { amount: 1_000_000, status: 'completed' }));
      await assertFails(getDoc(doc(db, `user_preferences/${ALICE}`)));
      await assertFails(setDoc(doc(db, `user_preferences/${ALICE}`), { preferredCurrency: 'USD' }));
    }
  });

  it('closes the unverified legacy username collections', async () => {
    await assertFails(getDoc(doc(anon(), 'usernames/legacy')));
    await assertFails(setDoc(doc(anon(), 'usernames/alice'), { username: 'alice', ownerAddress: MALLORY, createdAt: 1 }));
    await assertFails(setDoc(doc(anon(), `wallets/${MALLORY}`), { walletAddress: MALLORY, username: 'alice', updatedAt: 1 }));
  });
});
