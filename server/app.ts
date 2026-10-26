/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Express application for the Cambio API. Used by both the production server (server/index.ts)
 * and the Vite dev server, so development exercises the same code that ships.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { IdentityError, IdentityService, StoreUnavailableError, type OriginContext } from './identity/service.js';
import { rateLimit, type SharedRateLimitStore } from './rateLimit.js';

export interface AppOptions {
  /** Null when the identity store could not be initialised; identity routes then answer 503. */
  identity: IdentityService | null;
  identityInitError?: string;
  /** Extra origins allowed to call the API cross-origin. Same-origin requests need nothing. */
  allowedOrigins?: string[];
  trustProxy?: boolean | number | string;
  /** Canonical public origin (e.g. APP_URL). When unset, the request's own host is used for SIWE binding. */
  publicOrigin?: string;
  rateLimits?: { lookupPerMinute?: number; mutatePerMinute?: number };
  rateLimitStore?: SharedRateLimitStore;
}

export function createApiApp(opts: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy !== undefined) app.set('trust proxy', opts.trustProxy);

  const allowed = new Set((opts.allowedOrigins ?? []).map((o) => o.replace(/\/+$/, '')));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const origin = req.headers.origin;
    const ownOrigin = opts.publicOrigin ?? `${req.protocol}://${req.get('host')}`;
    if (origin && origin !== ownOrigin && !allowed.has(origin)) {
      res.status(403).json({ error: 'origin_not_allowed' });
      return;
    }
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.status(origin && allowed.has(origin) ? 204 : 403).end();
      return;
    }
    next();
  });

  app.use('/api', express.json({ limit: '4kb', strict: true, type: 'application/json' }));

  const lookupLimit = rateLimit({ name: 'lookup', windowMs: 60_000, max: opts.rateLimits?.lookupPerMinute ?? 120, store: opts.rateLimitStore });
  const mutateLimit = rateLimit({ name: 'mutate', windowMs: 60_000, max: opts.rateLimits?.mutatePerMinute ?? 10, store: opts.rateLimitStore });

  const requireIdentity = (_req: Request, res: Response, next: NextFunction) => {
    if (!opts.identity) {
      res.status(503).json({ error: 'identity_unavailable', message: 'The username registry is unavailable. Usernames cannot be changed right now.' });
      return;
    }
    next();
  };

  const originFor = (req: Request): OriginContext => {
    if (opts.publicOrigin) {
      const u = new URL(opts.publicOrigin);
      return { domain: u.host, uri: u.origin };
    }
    const host = req.get('host') || 'localhost';
    return { domain: host, uri: `${req.protocol}://${host}` };
  };

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).catch(next);

  app.get(
    '/api/health',
    wrap(async (_req, res) => {
      if (!opts.identity) {
        res.status(503).json({ ok: false, identity: { available: false, durable: false, store: null, error: opts.identityInitError ?? 'not configured' } });
        return;
      }
      try {
        await opts.identity.ping();
        res.json({ ok: true, identity: { available: true, ...opts.identity.storeInfo } });
      } catch (err) {
        res.status(503).json({ ok: false, identity: { available: false, ...opts.identity.storeInfo, error: 'store unreachable' } });
      }
    })
  );

  app.get(
    '/api/identity/username/:username',
    lookupLimit,
    requireIdentity,
    wrap(async (req, res) => {
      res.json({ record: await opts.identity!.lookupUsername(req.params.username) });
    })
  );

  app.get(
    '/api/identity/address/:address',
    lookupLimit,
    requireIdentity,
    wrap(async (req, res) => {
      res.json({ record: await opts.identity!.lookupAddress(req.params.address) });
    })
  );

  app.get(
    '/api/identity/availability',
    lookupLimit,
    requireIdentity,
    wrap(async (req, res) => {
      res.json(await opts.identity!.checkAvailability(req.query.username, req.query.address));
    })
  );

  app.post(
    '/api/identity/challenge',
    mutateLimit,
    requireIdentity,
    wrap(async (req, res) => {
      res.json(await opts.identity!.createChallenge(req.body ?? {}, originFor(req)));
    })
  );

  app.post(
    '/api/identity/claim',
    mutateLimit,
    requireIdentity,
    wrap(async (req, res) => {
      res.json(await opts.identity!.claim(req.body ?? {}, originFor(req)));
    })
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Errors never leak stack traces or internal messages.
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof IdentityError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof StoreUnavailableError) {
      res.status(503).json({ error: 'identity_unavailable', message: 'The username registry is unavailable. Try again later.' });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: 'payload_too_large' });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }
    console.error('[api] unexpected error', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
