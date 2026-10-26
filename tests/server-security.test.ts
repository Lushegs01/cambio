import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApiApp } from '../server/app';
import { bootstrapIdentity } from '../server/bootstrap';
import { IdentityService } from '../server/identity/service';
import { MemoryIdentityStore } from '../server/identity/memoryStore';
import { parsePublicOrigin, parseTrustProxy, securityHeaders } from '../server/securityHeaders';

const servers: Server[] = [];
afterEach(() => { servers.forEach((s) => { s.closeAllConnections(); s.close(); }); servers.length = 0; });
async function start(app: ReturnType<typeof express>) {
  const s = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(s); return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

describe('production configuration and API boundaries', () => {
  it('parses proxy hop counts numerically and rejects invalid public origins', () => {
    expect(parseTrustProxy('1')).toBe(1); expect(parseTrustProxy()).toBe(0);
    for (const value of ['ftp://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'junk']) expect(() => parsePublicOrigin(value)).toThrow();
    expect(parsePublicOrigin('https://cambio.example/')).toBe('https://cambio.example');
  });
  it('refuses a non-durable production identity registry', async () => {
    expect((await bootstrapIdentity({ IDENTITY_STORE: 'memory' }, 'production')).identity).toBeNull();
    expect((await bootstrapIdentity({ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' }, 'production')).identity).toBeNull();
  });
  it('rejects cross-origin requests before generating a challenge', async () => {
    const identity = new IdentityService({ store: new MemoryIdentityStore() });
    const spy = vi.spyOn(identity, 'createChallenge');
    const base = await start(createApiApp({ identity }));
    const r = await fetch(`${base}/api/identity/challenge`, { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(403); expect(spy).not.toHaveBeenCalled();
  });
  it('fails closed if the shared limiter is unavailable', async () => {
    const base = await start(createApiApp({ identity: new IdentityService({ store: new MemoryIdentityStore() }), rateLimitStore: { consume: async () => { throw new Error('down'); } } }));
    expect((await fetch(`${base}/api/identity/username/alice`)).status).toBe(503);
  });
  it('serves restrictive security headers without allowing arbitrary scripts or embedding', async () => {
    const app = express(); app.use(securityHeaders); app.get('/', (_q, r) => r.send('ok'));
    const res = await fetch(await start(app));
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain("script-src 'self'"); expect(csp).toContain("frame-ancestors 'none'"); expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('SIWE metadata and expiry are enforced at commit', () => {
  it('keeps mainnet identity challenges disabled along with the testnet-only application', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const identity = new IdentityService({ store: new MemoryIdentityStore() });
    await expect(identity.createChallenge({ address: account.address, chainId: 31612, action: 'register', username: 'chain_owner' }, { domain: 'cambio.example', uri: 'https://cambio.example' })).rejects.toMatchObject({ code: 'unsupported_chain' });
  });
  it('rejects a challenge that expires while its signature is being verified', async () => {
    let now = 1000000; const account = privateKeyToAccount(generatePrivateKey()); const store = new MemoryIdentityStore();
    const identity = new IdentityService({ store, now: () => now, verifySignature: async () => { now += 300001; return true; } });
    const origin = { domain: 'cambio.example', uri: 'https://cambio.example' };
    const c = await identity.createChallenge({ address: account.address, chainId: 31611, action: 'register', username: 'expiry_test' }, origin);
    await expect(identity.claim({ nonce: c.nonce, signature: '0x1234' }, origin)).rejects.toMatchObject({ code: 'challenge_expired' });
    expect(await store.getByUsername('expiry_test')).toBeNull();
  });
  it('rejects signed SIWE text whose chain differs from stored authorization', async () => {
    const account = privateKeyToAccount(generatePrivateKey()); const store = new MemoryIdentityStore();
    const identity = new IdentityService({ store }); const origin = { domain: 'cambio.example', uri: 'https://cambio.example' };
    const c = await identity.createChallenge({ address: account.address, chainId: 31611, action: 'register', username: 'chain_test' }, origin);
    const challenge = (await store.getChallenge(c.nonce))!;
    challenge.message = challenge.message.replace('Chain ID: 31611', 'Chain ID: 1'); await store.saveChallenge(challenge);
    await expect(identity.claim({ nonce: c.nonce, signature: await account.signMessage({ message: challenge.message }) }, origin)).rejects.toMatchObject({ code: 'invalid_challenge' });
  });
});
