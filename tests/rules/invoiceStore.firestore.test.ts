/**
 * FirestoreInvoiceStore against the real Firestore emulator (npm run test:rules): the same contract as
 * the memory and SQLite stores, including genuinely concurrent transactions.
 */
import { afterAll, beforeAll, describe } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreInvoiceStore, INVOICE_COLLECTIONS } from '../../server/invoices/firestoreStore';
import { invoiceStoreContract } from '../invoiceStoreContract';

let app: App;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST must point at the emulator');
  app = initializeApp({ projectId: 'demo-cambio-invoices' }, `invoice-test-${Date.now()}`);
});
afterAll(async () => app && deleteApp(app));

async function freshStore() {
  const db = getFirestore(app);
  for (const c of Object.values(INVOICE_COLLECTIONS)) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  return new FirestoreInvoiceStore(db, false);
}

describe('FirestoreInvoiceStore', () => invoiceStoreContract(freshStore));
