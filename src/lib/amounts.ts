/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Exact token-amount arithmetic. Every amount that can reach a transaction is a bigint in the
 * token's base units. Floating-point numbers are only produced for display (fiat estimates, charts).
 */

export type ParseAmountResult =
  | { ok: true; value: bigint; normalized: string }
  | { ok: false; error: string };

/** Upper bound on user-entered amounts, so absurd inputs are rejected rather than silently overflowing UI math. */
export const MAX_INPUT_INTEGER_DIGITS = 15;

const DECIMAL_PATTERN = /^(\d*)(?:\.(\d*))?$/;

/**
 * Parse a human-entered decimal string ("12.50") into base units without floating point.
 * Rejects negatives, exponents, thousands separators, and more fractional digits than the token supports
 * (excess precision is an error, never silently rounded).
 */
export function parseTokenAmount(input: string, decimals: number): ParseAmountResult {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return { ok: false, error: 'Unsupported token precision.' };
  }
  const raw = (input ?? '').trim();
  if (raw === '') return { ok: false, error: 'Enter an amount.' };
  if (raw.startsWith('-')) return { ok: false, error: 'Amount must be greater than zero.' };

  const match = DECIMAL_PATTERN.exec(raw);
  if (!match || raw === '.') return { ok: false, error: 'Enter a valid number (digits and an optional decimal point).' };

  const intPart = (match[1] || '').replace(/^0+(?=\d)/, '');
  const fracPart = match[2] ?? '';

  if (intPart.length > MAX_INPUT_INTEGER_DIGITS) return { ok: false, error: 'Amount is too large.' };
  if (fracPart.length > decimals) {
    return {
      ok: false,
      error: decimals === 0 ? 'This token has no decimal places.' : `Use at most ${decimals} decimal places.`,
    };
  }

  const value = BigInt((intPart || '0') + fracPart.padEnd(decimals, '0'));
  if (value <= 0n) return { ok: false, error: 'Amount must be greater than zero.' };

  return { ok: true, value, normalized: formatUnitsExact(value, decimals) };
}

/** Exact decimal string with trailing zeros removed, e.g. 1500000n with 6 decimals -> "1.5". */
export function formatUnitsExact(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let out = whole.toString();
  if (decimals > 0 && frac > 0n) {
    out += '.' + frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  }
  return negative ? `-${out}` : out;
}

/**
 * Display formatting with grouping and a bounded number of fraction digits.
 * Rounds DOWN (truncates) so a displayed balance is never larger than what is actually spendable.
 */
export function formatTokenDisplay(
  value: bigint,
  decimals: number,
  options: { maxFractionDigits?: number; minFractionDigits?: number } = {}
): string {
  const maxFrac = Math.min(options.maxFractionDigits ?? 4, decimals);
  const minFrac = Math.min(options.minFractionDigits ?? 2, maxFrac);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fracDigits = (abs % base).toString().padStart(decimals, '0').slice(0, maxFrac);
  let frac = fracDigits.replace(/0+$/, '');
  if (frac.length < minFrac) frac = frac.padEnd(minFrac, '0');

  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${groupedWhole}.${frac}` : groupedWhole;

  // A non-zero value that truncates to zero should not look like an empty balance.
  if (abs > 0n && whole === 0n && /^0*$/.test(fracDigits)) {
    return `${negative ? '-' : ''}<0.${'0'.repeat(Math.max(0, maxFrac - 1))}1`;
  }
  return negative ? `-${body}` : body;
}

/** Lossy conversion for display-only math such as fiat estimates. Never feed the result back into a transaction. */
export function toDisplayNumber(value: bigint, decimals: number): number {
  return Number(formatUnitsExact(value, decimals));
}

/** basisPoints of value, rounded down. 10_000 bps = 100%. */
export function bpsOf(value: bigint, basisPoints: number): bigint {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new RangeError('basisPoints must be an integer between 0 and 10000');
  }
  return (value * BigInt(basisPoints)) / 10_000n;
}

/** Minimum acceptable output after applying a slippage tolerance, rounded down. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  return bpsOf(amountOut, 10_000 - slippageBps);
}
