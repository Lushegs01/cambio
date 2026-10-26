/**
 * Identity API tests. These use real secp256k1 keys and real EIP-191 signatures against the actual
 * Express app and IdentityService; only the clock and the (in-memory) store are test doubles.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createApiApp } from '../server/app';
import { IdentityService } from '../server/identity/service';
import { MemoryIdentityStore } from '../server/identity/memoryStore';
import { StoreUnavailableError, type IdentityStore } from '../server/identity/store';

const CHAIN = 31611;

let clock = Date.UTC(2026, 9, 22, 12, 0, 0);
let server: Server;
let base: string;
let store: MemoryIdentityStore;

function startServer(app: ReturnType<typeof createApiApp>): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve({ server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` }));
  });
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}, at = base) {
  const res = await fetch(`${at}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function get(path: string, at = base) {
  const res = await fetch(`${at}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const wallet = () => privateKeyToAccount(generatePrivateKey());

/** fetch() forbids overriding Host, so the domain-binding test uses node:http directly. */
function postWithHost(path: string, body: unknown, host: string): Promise<{ status: number }> {
  const url = new URL(base + path);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

async function claimFlow(acct: ReturnType<typeof wallet>, username: string, action: 'register' | 'change' = 'register') {
  const ch = await post('/api/identity/challenge', { address: acct.address, chainId: CHAIN, action, username });
  if (ch.status !== 200) return { challenge: ch, claim: null };
  const signature = await acct.signMessage({ message: ch.body.message });
  const claim = await post('/api/identity/claim', { nonce: ch.body.nonce, signature });
  return { challenge: ch, claim, signature };
}

beforeAll(async () => {
  store = new MemoryIdentityStore();
  const identity = new IdentityService({ store, now: () => clock });
  ({ server, base } = await startServer(createApiApp({ identity, rateLimits: { mutatePerMinute: 1000, lookupPerMinute: 1000 } })));
});
afterAll(() => server.close());
beforeEach(() => {
  clock += 60 * 60 * 1000;
});

describe('registration with a verified wallet signature', () => {
  it('registers a username and resolves it in both directions', async () => {
    const a = wallet();
    const { challenge, claim } = await claimFlow(a, 'Alice_01');
    expect(challenge.status).toBe(200);
    // The wallet signs a standard EIP-4361 message bound to this host, chain and action.
    expect(challenge.body.message).toContain(`${new URL(base).host} wants you to sign in with your Ethereum account:`);
    expect(challenge.body.message).toContain(a.address);
    expect(challenge.body.message).toContain('Register the Cambio username @alice_01');
    expect(challenge.body.message).toContain(`Chain ID: ${CHAIN}`);
    expect(claim!.status).toBe(200);
    expect(claim!.body.record).toMatchObject({ username: 'alice_01', address: a.address, verified: true });

    expect((await get('/api/identity/username/@ALICE_01')).body.record.address).toBe(a.address);
    expect((await get(`/api/identity/address/${a.address.toLowerCase()}`)).body.record.username).toBe('alice_01');
  });

  it('rejects a signature from a different key and leaves the challenge usable by the real owner', async () => {
    const owner = wallet();
    const attacker = wallet();
    const ch = await post('/api/identity/challenge', { address: owner.address, chainId: CHAIN, action: 'register', username: 'victim_name' });
    const forged = await attacker.signMessage({ message: ch.body.message });
    const bad = await post('/api/identity/claim', { nonce: ch.body.nonce, signature: forged });
    expect(bad.status).toBe(401);
    expect((await get('/api/identity/username/victim_name')).body.record).toBeNull();

    const good = await post('/api/identity/claim', { nonce: ch.body.nonce, signature: await owner.signMessage({ message: ch.body.message }) });
    expect(good.status).toBe(200);
  });

  it('rejects a signature over a different (tampered) message', async () => {
    const a = wallet();
    const ch = await post('/api/identity/challenge', { address: a.address, chainId: CHAIN, action: 'register', username: 'tamper_test' });
    const sig = await a.signMessage({ message: ch.body.message.replace('@tamper_test', '@someone_else') });
    expect((await post('/api/identity/claim', { nonce: ch.body.nonce, signature: sig })).status).toBe(401);
  });

  it('rejects a replayed signature', async () => {
    const a = wallet();
    const { challenge, claim, signature } = await claimFlow(a, 'replay_me');
    expect(claim!.status).toBe(200);
    const replay = await post('/api/identity/claim', { nonce: challenge.body.nonce, signature });
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe('challenge_used');
  });

  it('rejects an expired challenge', async () => {
    const a = wallet();
    const ch = await post('/api/identity/challenge', { address: a.address, chainId: CHAIN, action: 'register', username: 'too_slow' });
    const sig = await a.signMessage({ message: ch.body.message });
    clock += 5 * 60 * 1000 + 1;
    const res = await post('/api/identity/claim', { nonce: ch.body.nonce, signature: sig });
    expect(res.status).toBe(410);
  });

  it('rejects a challenge submitted through a different site (domain binding)', async () => {
    const a = wallet();
    const ch = await post('/api/identity/challenge', { address: a.address, chainId: CHAIN, action: 'register', username: 'phished' });
    const sig = await a.signMessage({ message: ch.body.message });
    const res = await postWithHost('/api/identity/claim', { nonce: ch.body.nonce, signature: sig }, 'evil.example');
    expect(res.status).toBe(400);
    expect((await get('/api/identity/username/phished')).body.record).toBeNull();
  });

  it('rejects unknown nonces and malformed signatures', async () => {
    expect((await post('/api/identity/claim', { nonce: 'doesnotexist123', signature: `0x${'11'.repeat(65)}` })).status).toBe(400);
    expect((await post('/api/identity/claim', { nonce: 'abc', signature: 'not-a-sig' })).status).toBe(400);
  });
});

describe('uniqueness and ownership', () => {
  it('prevents duplicate registration of the same username', async () => {
    const a = wallet();
    const b = wallet();
    expect((await claimFlow(a, 'taken_name')).claim!.status).toBe(200);
    const second = await claimFlow(b, 'TAKEN_NAME');
    expect(second.challenge.status).toBe(409);
    expect((await get('/api/identity/username/taken_name')).body.record.address).toBe(a.address);
  });

  it('resolves a race where both wallets obtained challenges before either committed', async () => {
    const a = wallet();
    const b = wallet();
    const chA = await post('/api/identity/challenge', { address: a.address, chainId: CHAIN, action: 'register', username: 'race_name' });
    const chB = await post('/api/identity/challenge', { address: b.address, chainId: CHAIN, action: 'register', username: 'race_name' });
    expect(chA.status).toBe(200);
    expect(chB.status).toBe(200);
    const [sigA, sigB] = await Promise.all([a.signMessage({ message: chA.body.message }), b.signMessage({ message: chB.body.message })]);
    const results = await Promise.all([
      post('/api/identity/claim', { nonce: chA.body.nonce, signature: sigA }),
      post('/api/identity/claim', { nonce: chB.body.nonce, signature: sigB }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!.body.record.address;
    expect((await get('/api/identity/username/race_name')).body.record.address).toBe(winner);
  });

  it('does not let one wallet take over another wallet’s username via change', async () => {
    const a = wallet();
    const b = wallet();
    await claimFlow(a, 'owner_a');
    await claimFlow(b, 'owner_b');
    const hijack = await post('/api/identity/challenge', { address: b.address, chainId: CHAIN, action: 'change', username: 'owner_a' });
    expect(hijack.status).toBe(409);
    expect((await get('/api/identity/username/owner_a')).body.record.address).toBe(a.address);
  });

  it('requires "change" (not a second "register") and releases the old name atomically', async () => {
    const a = wallet();
    await claimFlow(a, 'first_name');
    expect((await claimFlow(a, 'second_try')).challenge.status).toBe(409); // already_registered
    const changed = await claimFlow(a, 'renamed', 'change');
    expect(changed.claim!.status).toBe(200);
    expect(changed.claim!.body.previousUsername).toBe('first_name');
    expect((await get('/api/identity/username/first_name')).body.record).toBeNull();
    expect((await get(`/api/identity/address/${a.address}`)).body.record.username).toBe('renamed');
    // The released name is available to someone else.
    expect((await claimFlow(wallet(), 'first_name')).claim!.status).toBe(200);
  });

  it('refuses reserved and malformed usernames', async () => {
    const a = wallet();
    for (const name of ['mezo_support', 'cambio', 'official_team', 'ab', 'a__b', '_lead', 'name!']) {
      const res = await post('/api/identity/challenge', { address: a.address, chainId: CHAIN, action: 'register', username: name });
      expect(res.status, name).toBe(400);
    }
  });
});

describe('input validation and abuse resistance', () => {
  it('rejects bad addresses, chains, actions and oversized or malformed bodies', async () => {
    const a = wallet();
    expect((await post('/api/identity/challenge', { address: '0x123', chainId: CHAIN, action: 'register', username: 'okname' })).status).toBe(400);
    expect((await post('/api/identity/challenge', { address: a.address, chainId: 1, action: 'register', username: 'okname' })).status).toBe(400);
    expect((await post('/api/identity/challenge', { address: a.address, chainId: CHAIN, action: 'delete', username: 'okname' })).status).toBe(400);
    expect((await post('/api/identity/challenge', JSON.stringify({ pad: 'x'.repeat(10_000) }))).status).toBe(413);
    expect((await post('/api/identity/challenge', '{not json')).status).toBe(400);
  });

  it('does not send permissive CORS headers', async () => {
    const res = await fetch(`${base}/api/identity/username/alice_01`, { headers: { origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rate-limits mutation endpoints', async () => {
    const id = new IdentityService({ store: new MemoryIdentityStore() });
    const { server: s, base: b } = await startServer(createApiApp({ identity: id, rateLimits: { mutatePerMinute: 3 } }));
    try {
      const a = wallet();
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await post('/api/identity/challenge', { address: a.address, chainId: CHAIN, action: 'register', username: `rate_${i}x` }, {}, b)).status);
      expect(codes.slice(0, 3).every((c) => c === 200)).toBe(true);
      expect(codes.slice(3)).toEqual([429, 429]);
    } finally {
      s.close();
    }
  });
});

describe('when the identity store is unavailable', () => {
  it('answers 503 and performs no mutation when the store was never configured', async () => {
    const { server: s, base: b } = await startServer(createApiApp({ identity: null, identityInitError: 'no credentials' }));
    try {
      expect((await get('/api/health', b)).status).toBe(503);
      expect((await get('/api/identity/username/alice', b)).status).toBe(503);
      expect((await post('/api/identity/challenge', { address: wallet().address, chainId: CHAIN, action: 'register', username: 'okname' }, {}, b)).status).toBe(503);
    } finally {
      s.close();
    }
  });

  it('answers 503 (not a fake success) when the store fails mid-request', async () => {
    const failing: IdentityStore = {
      kind: 'firestore',
      durable: true,
      ping: async () => { throw new StoreUnavailableError(); },
      saveChallenge: async () => { throw new StoreUnavailableError(); },
      getChallenge: async () => { throw new StoreUnavailableError(); },
      getByUsername: async () => { throw new StoreUnavailableError(); },
      getByAddress: async () => { throw new StoreUnavailableError(); },
      commitClaim: async () => { throw new StoreUnavailableError(); },
    };
    const { server: s, base: b } = await startServer(createApiApp({ identity: new IdentityService({ store: failing }) }));
    try {
      expect((await get('/api/health', b)).status).toBe(503);
      expect((await get('/api/identity/username/alice', b)).status).toBe(503);
      expect((await post('/api/identity/challenge', { address: wallet().address, chainId: CHAIN, action: 'register', username: 'okname' }, {}, b)).status).toBe(503);
    } finally {
      s.close();
    }
  });

  it('reports a non-durable store honestly in /api/health', async () => {
    const res = await get('/api/health');
    expect(res.body.identity).toMatchObject({ available: true, durable: false, kind: 'memory' });
  });
});
