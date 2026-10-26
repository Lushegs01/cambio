/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Username rules shared by the browser and the identity API, so both enforce exactly the same thing.
 * Canonical form: lowercase a-z, 0-9 and single underscores; 3-20 chars; no leading/trailing underscore.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const CANONICAL = /^[a-z0-9](?:[a-z0-9]|_(?!_))*[a-z0-9]$/;

/**
 * Names that could impersonate Cambio, Mezo or support staff. Checked against the canonical form with
 * underscores and digits removed ("root"), so "mezo_support1" is caught too.
 * Brand words are blocked as a prefix or suffix ("mezoteam", "real_cambio"); generic words only exactly,
 * so ordinary names such as "bankole" or "badminton" stay available.
 */
const RESERVED_BRAND_WORDS = ['cambio', 'mezo', 'musd', 'admin', 'support', 'official', 'verified', 'security'];
const RESERVED_EXACT = [
  'administrator', 'help', 'helpdesk', 'team', 'staff', 'moderator', 'mod', 'system', 'root', 'treasury',
  'wallet', 'bank', 'verify', 'payments', 'refund', 'airdrop', 'bitcoin', 'btc', 'satoshi', 'null', 'undefined',
];
const RESERVED_LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

export function normalizeUsername(raw: string): string {
  return (raw ?? '').trim().replace(/^@+/, '').toLowerCase();
}

export function formatUsername(canonical: string): string {
  const n = normalizeUsername(canonical);
  return n ? `@${n}` : '';
}

export type UsernameValidation = { valid: true; username: string } | { valid: false; username: string; error: string };

export function validateUsername(raw: string): UsernameValidation {
  const username = normalizeUsername(raw);
  if (!username) return { valid: false, username, error: 'Enter a username.' };
  if (username.length < USERNAME_MIN) return { valid: false, username, error: `Use at least ${USERNAME_MIN} characters.` };
  if (username.length > USERNAME_MAX) return { valid: false, username, error: `Use at most ${USERNAME_MAX} characters.` };
  if (!/^[a-z0-9_]+$/.test(username)) return { valid: false, username, error: 'Use only letters, numbers and underscores.' };
  if (!CANONICAL.test(username)) {
    return { valid: false, username, error: 'Underscores cannot start or end a name, or appear twice in a row.' };
  }
  const root = username.replace(/[_0-9]/g, '');
  const lookalikeRoot = username.replace(/_/g, '').replace(/[01234578]/g, (c) => RESERVED_LOOKALIKES[c]);
  if ([root, lookalikeRoot].some((candidate) => RESERVED_EXACT.includes(candidate) || RESERVED_BRAND_WORDS.some((w) => candidate.startsWith(w) || candidate.endsWith(w)))) {
    return { valid: false, username, error: 'That name is reserved to prevent impersonation.' };
  }
  return { valid: true, username };
}
