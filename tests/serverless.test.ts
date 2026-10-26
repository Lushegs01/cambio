import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, globSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { createServerlessHandler } from '../server/serverless';
import { IdentityService } from '../server/identity/service';
import { MemoryIdentityStore } from '../server/identity/memoryStore';
import { contentSecurityPolicy } from '../server/securityHeaders';

const servers: Server[] = [];
afterEach(() => { for (const server of servers) { server.closeAllConnections(); server.close(); } });
async function serve(handler: ReturnType<typeof createServerlessHandler>) {
  const app = express(); app.use(handler);
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const identity = () => new IdentityService({ store: new MemoryIdentityStore() });
const origin = 'https://cambio-rho.vercel.app';

describe('Vercel API entry point', () => {
  it('boots compiled ESM in plain Node without Vite or esbuild resolving extensionless imports', async () => {
    const ts = await import('typescript');
    const cache = path.resolve('node_modules/.cache'); mkdirSync(cache, { recursive: true });
    const temporary = mkdtempSync(path.join(cache, 'cambio-node-function-'));
    try {
      writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
      for (const file of globSync(['api/**/*.ts', 'server/**/*.ts', 'shared/**/*.ts', 'src/config/chains.ts'])) {
        const target = path.join(temporary, file.replace(/\.ts$/, '.js'));
        mkdirSync(path.dirname(target), { recursive: true });
        const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
        writeFileSync(target, compiled.outputText);
      }
      const entry = pathToFileURL(path.join(temporary, 'api/index.js')).href;
      const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
        import { createServer } from 'node:http';
        const { default: handler } = await import(${JSON.stringify(entry)});
        const server = createServer(handler);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
          const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/health');
          const body = await response.json();
          if (response.status !== 503 || body.identity.available !== false) throw new Error('Production storage must fail closed');
          console.log('compiled-function-ready');
        } finally { server.closeAllConnections(); server.close(); }
      `], { encoding: 'utf8', timeout: 15_000, env: { ...process.env, IDENTITY_STORE: 'memory', ALLOW_NON_DURABLE_IDENTITY: 'false', APP_URL: origin } });
      expect(result).toContain('compiled-function-ready');
    } finally {
      if (!temporary.startsWith(cache + path.sep)) throw new Error('Temporary function directory is outside the test cache');
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('shares production initialization across concurrent cold-start requests and keeps full API paths', async () => {
    const initialize = vi.fn(async () => ({ identity: identity() }));
    const base = await serve(createServerlessHandler({ APP_URL: origin, VERCEL: '1' }, initialize));
    const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(`${base}/api/health`)));
    expect(initialize).toHaveBeenCalledExactlyOnceWith({ APP_URL: origin, VERCEL: '1' }, 'production');
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect((await response.json()).identity.available).toBe(true);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-security-policy')).toBe(contentSecurityPolicy);
    }
    const unknown = await fetch(`${base}/api/missing`);
    expect(unknown.status).toBe(404); expect(await unknown.json()).toEqual({ error: 'not_found' });
  });

  it('handles an actual signed claim through the serverless adapter and binds it to the public origin', async () => {
    const base = await serve(createServerlessHandler({ APP_URL: origin, VERCEL: '1' }, async () => ({ identity: identity() })));
    const account = privateKeyToAccount(generatePrivateKey());
    const post = (path: string, body: unknown, requestOrigin = origin) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin }, body: JSON.stringify(body),
    });
    const challenge = await post('/api/identity/challenge', { address: account.address, chainId: 31611, action: 'register', username: 'vercel_owner' });
    expect(challenge.status).toBe(200);
    const payload = await challenge.json();
    expect(payload.message).toContain('cambio-rho.vercel.app wants you to sign in');
    const signature = await account.signMessage({ message: payload.message });
    const claim = await post('/api/identity/claim', { nonce: payload.nonce, signature });
    expect(claim.status).toBe(200); expect((await claim.json()).record.verified).toBe(true);
    const lookup = await fetch(`${base}/api/identity/username/vercel_owner`);
    expect((await lookup.json()).record.address.toLowerCase()).toBe(account.address.toLowerCase());
    expect((await post('/api/identity/challenge', {}, 'https://attacker.example')).status).toBe(403);
  });

  it('returns honest unavailability and retries a transient initialization failure after 30 seconds', async () => {
    let now = 0;
    const initialize = vi.fn().mockResolvedValueOnce({ identity: null, error: 'store unavailable' }).mockResolvedValue({ identity: identity() });
    const base = await serve(createServerlessHandler({}, initialize, () => now));
    const unavailable = await fetch(`${base}/api/health`);
    expect(unavailable.status).toBe(503); expect((await unavailable.json()).identity.available).toBe(false);
    expect((await fetch(`${base}/api/identity/availability?username=alice`)).status).toBe(503);
    expect(initialize).toHaveBeenCalledTimes(1);
    now = 30_000;
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect(initialize).toHaveBeenCalledTimes(2);
  });

  it('does not expose initialization exceptions or configuration secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = await serve(createServerlessHandler({}, async () => { throw new Error('private-test-value'); }));
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-test-value');
    expect(log.mock.calls.flat().join(' ')).not.toContain('private-test-value');
    log.mockRestore();
  });

  it('routes API requests before SPA links and keeps CDN security headers aligned with Express', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(config.rewrites).toEqual([
      { source: '/api/:path*', destination: '/api/index' },
      { source: '/app/:path*', destination: '/index.html' },
    ]);
    expect(config.functions['api/index.ts'].includeFiles).toBe('firebase-applet-config.json');
    expect(config.headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value).toBe(contentSecurityPolicy);
    expect(config.outputDirectory).toBe('dist');
    expect(readFileSync('api/index.ts', 'utf8')).not.toContain('.listen(');
  });
});
