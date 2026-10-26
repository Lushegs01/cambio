/**
 * End-to-end identity flow through the HTTP API backed by the Firestore emulator:
 * challenge -> real wallet signature -> claim -> lookup, plus replay and race behaviour.
 * Run with: npm run test:rules
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createApiApp } from '../../server/app';
import { IdentityService } from '../../server/identity/service';
import { FirestoreIdentityStore } from '../../server/identity/firestoreStore';

let app: App;
let server: Server;
let base: string;

beforeAll(async () => {
  app = initializeApp({ projectId: 'demo-cambio-api' }, `api-test-${Date.now()}`);
  const identity = new IdentityService({ store: new FirestoreIdentityStore(getFirestore(app)) });
  const api = createApiApp({ identity, rateLimits: { mutatePerMinute: 1000, lookupPerMinute: 1000 } });
  await new Promise<void>((resolve) => {
    server = api.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => {
  server?.close();
  if (app) await deleteApp(app);
});

const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

describe('identity API on Firestore', () => {
  it('registers with a verified signature, resolves both ways, and rejects replay', async () => {
    const acct = privateKeyToAccount(generatePrivateKey());
    const name = `fs_${Date.now().toString(36)}`;
    const ch = await post('/api/identity/challenge', { address: acct.address, chainId: 31611, action: 'register', username: name });
    expect(ch.status).toBe(200);
    const signature = await acct.signMessage({ message: ch.body.message });
    const claim = await post('/api/identity/claim', { nonce: ch.body.nonce, signature });
    expect(claim.status).toBe(200);
    expect((await (await fetch(`${base}/api/identity/username/${name}`)).json()).record.address).toBe(acct.address);
    expect((await (await fetch(`${base}/api/identity/address/${acct.address}`)).json()).record.username).toBe(name);
    expect((await post('/api/identity/claim', { nonce: ch.body.nonce, signature })).status).toBe(409);
  });

  it('lets only one of two racing wallets win a username', async () => {
    const name = `race_${Date.now().toString(36)}`;
    const [a, b] = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())];
    const [chA, chB] = await Promise.all([a, b].map((w) => post('/api/identity/challenge', { address: w.address, chainId: 31611, action: 'register', username: name })));
    const [sA, sB] = await Promise.all([a.signMessage({ message: chA.body.message }), b.signMessage({ message: chB.body.message })]);
    const results = await Promise.all([
      post('/api/identity/claim', { nonce: chA.body.nonce, signature: sA }),
      post('/api/identity/claim', { nonce: chB.body.nonce, signature: sB }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});
