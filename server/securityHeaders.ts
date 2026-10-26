import type { RequestHandler } from 'express';

// Only the integrations used by Cambio and its configured wallet SDK. No arbitrary script origins.
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com",
  "connect-src 'self' https://rpc.test.mezo.org https://api.explorer.test.mezo.org https://api.coingecko.com https://api.coinbase.com https://open.er-api.com https://api.frankfurter.app https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.reown.com https://*.reown.org wss://*.reown.com wss://*.reown.org https://*.web3modal.org https://*.web3modal.com https://*.walletguide.walletconnect.network",
  "frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.com https://secure.walletconnect.org https://secure.reown.com",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (_req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
};

export function parseTrustProxy(value = '0'): number | string {
  if (/^\d+$/.test(value)) return Number(value);
  // Express accepts named subnets and CIDRs. Never interpret a numeric string as a subnet.
  if (value === 'true' || value === 'false') throw new Error('TRUST_PROXY must be a hop count or trusted subnet.');
  return value;
}

export function parsePublicOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('APP_URL must be an HTTP(S) origin without a path or credentials.');
  return u.origin;
}
