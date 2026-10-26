/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Browser client for the Cambio identity API. The API is the only authority on usernames:
 * there is no local or cached fallback that could make an unverified name look verified.
 */

import type { Address, Hex } from 'viem';
import { getAddress, isAddress } from 'viem';

export interface VerifiedUsername {
  username: string;
  display: string;
  address: Address;
  createdAt: number;
  updatedAt: number;
  verified: true;
}

export interface IdentityHealth {
  available: boolean;
  durable: boolean;
  store: 'firestore' | 'sqlite' | 'memory' | null;
}

export class IdentityApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'IdentityApiError';
  }
}

const TIMEOUT_MS = 8000;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } });
  } catch {
    throw new IdentityApiError(0, 'network', 'The username service could not be reached.');
  } finally {
    clearTimeout(timer);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new IdentityApiError(res.status, body?.error || 'error', body?.message || (res.status === 503 ? 'The username service is unavailable.' : 'Request failed.'));
  }
  return body as T;
}

function parseRecord(r: any): VerifiedUsername | null {
  if (!r || typeof r.username !== 'string' || typeof r.address !== 'string' || !isAddress(r.address, { strict: false }) || r.verified !== true) return null;
  return { username: r.username, display: `@${r.username}`, address: getAddress(r.address), createdAt: Number(r.createdAt) || 0, updatedAt: Number(r.updatedAt) || 0, verified: true };
}

export async function getIdentityHealth(): Promise<IdentityHealth> {
  try {
    const body = await call<{ identity?: { available?: boolean; durable?: boolean; kind?: string; store?: string } }>('/api/health');
    return { available: !!body.identity?.available, durable: !!body.identity?.durable, store: (body.identity?.kind ?? body.identity?.store ?? null) as IdentityHealth['store'] };
  } catch {
    return { available: false, durable: false, store: null };
  }
}

/** Resolves @username to its verified wallet. Returns null if unregistered; throws if the service is unavailable. */
export async function resolveUsername(username: string): Promise<VerifiedUsername | null> {
  const clean = username.trim().replace(/^@+/, '').toLowerCase();
  const body = await call<{ record: unknown }>(`/api/identity/username/${encodeURIComponent(clean)}`);
  return parseRecord(body.record);
}

/** Reverse lookup. Returns null if the wallet has no verified username; throws if the service is unavailable. */
export async function lookupAddress(address: string): Promise<VerifiedUsername | null> {
  const body = await call<{ record: unknown }>(`/api/identity/address/${encodeURIComponent(address.toLowerCase())}`);
  return parseRecord(body.record);
}

export async function checkAvailability(username: string, address?: string) {
  const q = new URLSearchParams({ username });
  if (address) q.set('address', address);
  return call<{ username: string; available: boolean; ownedByCaller?: boolean; reason?: string }>(`/api/identity/availability?${q}`);
}

export async function requestChallenge(args: { address: Address; chainId: number; action: 'register' | 'change'; username: string }) {
  return call<{ nonce: string; message: string; expiresAt: number }>('/api/identity/challenge', { method: 'POST', body: JSON.stringify(args) });
}

export async function submitClaim(args: { nonce: string; signature: Hex }) {
  const body = await call<{ record: unknown; previousUsername: string | null }>('/api/identity/claim', { method: 'POST', body: JSON.stringify(args) });
  const record = parseRecord(body.record);
  if (!record) throw new IdentityApiError(500, 'bad_response', 'The username service returned an invalid record.');
  return { record, previousUsername: body.previousUsername };
}

export function notifyUsernameChanged(address: string, username: string) {
  try {
    window.dispatchEvent(new CustomEvent('cambio_username_updated', { detail: { walletAddress: address, username } }));
  } catch {
    // non-browser environment
  }
}
