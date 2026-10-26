/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fixed-window, per-key rate limiter. Durable Firestore/SQLite stores enforce the quota atomically
 * across instances sharing that store. Development memory limits apply to one process only.
 */

import type { Request, Response, NextFunction } from 'express';

export interface SharedRateLimitStore {
  consume(key: string, max: number, windowMs: number, now: number): Promise<{ allowed: boolean; retryAfter: number }>;
}

export function rateLimit(opts: { windowMs: number; max: number; name: string; now?: () => number; store?: SharedRateLimitStore }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;
  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    const key = `${opts.name}:${req.ip ?? 'unknown'}`;
    if (opts.store) {
      void opts.store.consume(key, opts.max, opts.windowMs, t).then((result) => {
        if (result.allowed) return next();
        res.setHeader('Retry-After', String(result.retryAfter));
        res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
      }).catch(() => res.status(503).json({ error: 'rate_limit_unavailable', message: 'The shared rate limiter is unavailable. Try again later.' }));
      return;
    }
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + opts.windowMs };
      hits.set(key, entry);
      if (hits.size > 50_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - t) / 1000)));
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
      return;
    }
    next();
  };
}
