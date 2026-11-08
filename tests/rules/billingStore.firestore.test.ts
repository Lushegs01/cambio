/**
 * FirestoreBillingStore against the real Firestore emulator (npm run test:rules): the same contract as
 * the memory and SQLite stores, including genuinely concurrent activation transactions.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { BILLING_COLLECTIONS, FirestoreBillingStore } from '../../server/billing/firestoreStore';
import { billingStoreContract } from '../billingStoreContract';

let app: App;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST must point at the emulator');
  app = initializeApp({ projectId: 'demo-cambio-billing' }, `billing-test-${Date.now()}`);
});
afterAll(async () => app && deleteApp(app));

async function freshStore() {
  const db = getFirestore(app);
  for (const c of Object.values(BILLING_COLLECTIONS)) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  return new FirestoreBillingStore(db);
}

describe('FirestoreBillingStore', () => billingStoreContract(freshStore));
