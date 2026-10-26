import express, { type Request, type Response } from 'express';
import { createApiApp } from './app.js';
import { bootstrapIdentity } from './bootstrap.js';
import { parsePublicOrigin, parseTrustProxy, securityHeaders } from './securityHeaders.js';

class ConfigurationError extends Error {
  constructor(readonly variable: 'APP_URL' | 'TRUST_PROXY') {
    super(variable === 'APP_URL'
      ? 'APP_URL must be an HTTP(S) origin without a path, credentials, query or fragment.'
      : 'TRUST_PROXY must be a numeric hop count or valid trusted subnet.');
  }
}

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
        let publicOrigin: string | undefined;
        try { publicOrigin = parsePublicOrigin(env.APP_URL); }
        catch { throw new ConfigurationError('APP_URL'); }
        let trustProxy: number | string;
        let secured: ReturnType<typeof express>;
        try {
          trustProxy = parseTrustProxy(env.TRUST_PROXY || (env.VERCEL === '1' ? '1' : '0'));
          // Validate Express's subnet configuration before attempting database initialization.
          secured = createApiAppWrapper(trustProxy);
        } catch { throw new ConfigurationError('TRUST_PROXY'); }
        const { identity, error, rateLimitStore } = await initialize(env, 'production');
        if (!identity) retryAt = now() + 30_000;
        const app = createApiApp({
          identity, identityInitError: error, rateLimitStore, publicOrigin, trustProxy,
          allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
        });
        // Apply headers before any API response, including errors and health checks.
        secured.use(app);
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
    } catch (error: unknown) {
      // Initialization errors can contain credentials. Return and log only a safe diagnostic.
      const configuration = error instanceof ConfigurationError ? error.variable : undefined;
      console.error(configuration
        ? `[serverless] Invalid ${configuration}; check runtime configuration.`
        : '[serverless] API initialization failed; check runtime configuration.');
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.end(JSON.stringify({
        error: 'api_unavailable',
        message: error instanceof ConfigurationError ? error.message : 'The API could not be initialized. Check server configuration.',
        ...(configuration ? { configuration } : {}),
      }));
    }
  };
}

function createApiAppWrapper(trustProxy: number | string) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(securityHeaders);
  return app;
}
