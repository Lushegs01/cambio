/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production entry point: serves the built SPA from dist/ and the API from the same origin.
 * Build with `npm run build`, run with `npm start` (PORT defaults to 3000; Cloud Run sets it).
 */

import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { createApiApp } from './app.js';
import { bootstrapIdentity } from './bootstrap.js';
import { securityHeaders, parseTrustProxy, parsePublicOrigin } from './securityHeaders.js';

// A rejected promise inside a dependency (e.g. a gRPC credential refresh) must not take the whole
// payments API down. Log it; request handlers already convert their own failures into 5xx responses.
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection:', reason instanceof Error ? reason.message : reason);
});

async function main() {
  const publicOrigin = parsePublicOrigin(process.env.APP_URL);
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  const { identity, error, rateLimitStore, close } = await bootstrapIdentity(process.env, 'production');
  if (process.env.IDENTITY_STORE === 'sqlite' && !identity) throw new Error(error || 'SQLite identity is required for self-hosted startup.');
  const api = createApiApp({
    identity,
    identityInitError: error,
    rateLimitStore,
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    publicOrigin,
    // Cloud Run and most PaaS put exactly one proxy in front; needed for correct client IPs in rate limiting.
    trustProxy,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(securityHeaders);
  app.use(api);

  const dist = path.resolve(process.cwd(), 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error('[server] dist/index.html not found. Run `npm run build` first.');
    process.exit(1);
  }
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use('/assets', (_req, res) => { res.status(404).end(); });
  // SPA fallback for client-side routes such as /app/activity. Payment links use #pay, which never reaches the server.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });

  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, process.env.BIND_HOST || '0.0.0.0', () => {
    console.log(`[server] Cambio listening on :${port} (identity: ${identity ? identity.storeInfo.kind : `unavailable — ${error}`})`);
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    server.close(() => { close?.(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

main().catch((err) => {
  console.error('[server] fatal', err);
  process.exit(1);
});
