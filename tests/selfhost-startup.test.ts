import { afterAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const cache = path.resolve('node_modules/.cache'); mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(path.join(cache, 'cambio-selfhost-startup-'));
const children: ChildProcess[] = [];
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
}
afterAll(async () => {
  await Promise.all(children.map(stop));
  if (!directory.startsWith(cache + path.sep)) throw new Error('Unexpected test directory');
  rmSync(directory, { recursive: true, force: true });
});
async function freePort() {
  const server = createServer(); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve())); return port;
}

it('runs the real production server without Firebase and preserves identity after a process restart', async () => {
  const entry = path.join(directory, 'server.mjs');
  await build({ entryPoints: ['server/index.ts'], outfile: entry, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
  mkdirSync(path.join(directory, 'dist')); writeFileSync(path.join(directory, 'dist/index.html'), '<!doctype html><title>Cambio local test</title>');
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, VERCEL: '', K_SERVICE: '', PORT: String(port), BIND_HOST: '127.0.0.1', APP_URL: base, TRUST_PROXY: '0', NODE_ENV: 'production',
    IDENTITY_STORE: 'sqlite', IDENTITY_DATABASE_PATH: path.join(directory, 'identity.sqlite'), ALLOW_NON_DURABLE_IDENTITY: 'false',
    FIREBASE_SERVICE_ACCOUNT_JSON: 'deliberately-invalid-and-not-used', FIRESTORE_EMULATOR_HOST: '' };
  async function start() {
    const child = spawn(process.execPath, [entry], { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
    let diagnostic = ''; child.stderr!.on('data', (d) => { diagnostic += d; });
    child.stdout!.resume();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Production server exited: ${diagnostic}`);
      try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return child; } catch { /* Wait for startup. */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Production server did not become ready: ${diagnostic}`);
  }
  const first = await start();
  expect((await (await fetch(`${base}/api/health`)).json()).identity).toMatchObject({ available: true, durable: true, kind: 'sqlite' });
  expect((await fetch(`${base}/app/activity`)).status).toBe(200);
  const account = privateKeyToAccount(generatePrivateKey());
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('/api/identity/challenge', { address: account.address, chainId: 31611, action: 'register', username: 'restart_owner' });
  expect(response.status).toBe(200);
  const c = await response.json(); const signature = await account.signMessage({ message: c.message });
  expect((await post('/api/identity/claim', { nonce: c.nonce, signature })).status).toBe(200);
  await stop(first);
  await start();
  expect((await (await fetch(`${base}/api/identity/username/restart_owner`)).json()).record).toMatchObject({ address: account.address, verified: true });
  expect((await post('/api/identity/claim', { nonce: c.nonce, signature })).status).toBe(409);
  expect((await fetch(`${base}/api/missing`)).status).toBe(404);
}, 20000);
