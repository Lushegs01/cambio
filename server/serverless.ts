import express, { type Request, type Response } from 'express';
import { createApiApp } from './app.js';
import { bootstrapIdentity } from './bootstrap.js';
import { parsePublicOrigin, parseTrustProxy, securityHeaders } from './securityHeaders.js';

/** Share initialization across concurrent invocations, but recover from a transient cold-start failure. */
export function createServerlessHandler(
  env: NodeJS.ProcessEnv = process.env,
  initialize = bootstrapIdentity,
  now = Date.now,
) {
  let pending: Promise<ReturnType<typeof createApiApp>> | undefined;
  let retryAt = Infinity;

  function application() {
    if (!pending || now() >= retryAt) {
      retryAt = Infinity;
      pending = (async () => {
        const publicOrigin = parsePublicOrigin(env.APP_URL);
        const trustProxy = parseTrustProxy(env.TRUST_PROXY || (env.VERCEL === '1' ? '1' : '0'));
        const { identity, error, rateLimitStore } = await initialize(env, 'production');
        if (!identity) retryAt = now() + 30_000;
        const app = createApiApp({
          identity, identityInitError: error, rateLimitStore, publicOrigin, trustProxy,
          allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
        });
        // Apply headers before any API response, including errors and health checks.
        const secured = createApiAppWrapper(app, trustProxy);
        return secured;
      })().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  }

  return async (req: Request, res: Response) => {
    try {
      (await application())(req, res);
    } catch {
      // Initialization errors can contain credentials. Return and log only a safe diagnostic.
      console.error('[serverless] API initialization failed; check runtime configuration.');
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(JSON.stringify({ error: 'api_unavailable', message: 'The API could not be initialized. Check server configuration.' }));
    }
  };
}

function createApiAppWrapper(api: ReturnType<typeof createApiApp>, trustProxy: number | string) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(securityHeaders);
  app.use(api);
  return app;
}
