import { describe, expect, it } from 'vitest';
import { applySlippage, bpsOf, formatTokenDisplay, formatUnitsExact, parseTokenAmount } from '../src/lib/amounts';

const ok = (input: string, decimals = 18) => {
  const r = parseTokenAmount(input, decimals);
  if (!r.ok) throw new Error(`expected ok for ${input}: ${r.error}`);
  return r.value;
};
const err = (input: string, decimals = 18) => {
  const r = parseTokenAmount(input, decimals);
  if (r.ok) throw new Error(`expected error for ${input}`);
  return r.error;
};

describe('parseTokenAmount: exact base units, no floating point', () => {
  it('converts decimals exactly', () => {
    expect(ok('1')).toBe(10n ** 18n);
    expect(ok('12.5')).toBe(12_500_000_000_000_000_000n);
    expect(ok('0.000000000000000001')).toBe(1n);
    expect(ok('.5', 6)).toBe(500_000n);
    expect(ok('5.', 6)).toBe(5_000_000n);
    expect(ok('007.10', 6)).toBe(7_100_000n);
  });

  it('is exact where floating point is not (0.1 + 0.2 style values)', () => {
    expect(ok('0.3')).toBe(300_000_000_000_000_000n);
    expect(Number('0.1') + Number('0.2')).not.toBe(0.3); // the bug this module avoids
    expect(ok('123456789.123456789123456789')).toBe(123456789123456789123456789n);
  });

  it('rejects zero, negative and empty amounts', () => {
    expect(err('0')).toMatch(/greater than zero/);
    expect(err('0.000')).toMatch(/greater than zero/);
    expect(err('-1')).toMatch(/greater than zero/);
    expect(err('')).toMatch(/Enter an amount/);
    expect(err('   ')).toMatch(/Enter an amount/);
  });

  it('rejects excess precision instead of rounding it away', () => {
    expect(err('1.1234567', 6)).toMatch(/at most 6 decimal places/);
    expect(err('0.0000000000000000001', 18)).toMatch(/at most 18/);
    expect(err('1.5', 0)).toMatch(/no decimal places/);
  });

  it('rejects non-decimal notations', () => {
    for (const bad of ['1e18', '0x10', '1,000', '1 000', 'NaN', 'Infinity', '1.2.3', '.', '+5', '٣']) {
      expect(parseTokenAmount(bad, 18).ok, bad).toBe(false);
    }
  });

  it('bounds absurdly large input', () => {
    expect(err('1' + '0'.repeat(20))).toMatch(/too large/);
  });
});

describe('formatting', () => {
  it('formatUnitsExact round-trips', () => {
    for (const s of ['1', '0.5', '123.000001', '0.000000000000000001']) expect(formatUnitsExact(ok(s), 18)).toBe(s);
  });

  it('formatTokenDisplay truncates (never rounds a balance up)', () => {
    expect(formatTokenDisplay(1_999_999n, 6, { maxFractionDigits: 2 })).toBe('1.99');
    expect(formatTokenDisplay(1234567_000000n, 6)).toBe('1,234,567.00');
    expect(formatTokenDisplay(1n, 18, { maxFractionDigits: 4 })).toBe('<0.0001');
    expect(formatTokenDisplay(0n, 18)).toBe('0.00');
  });
});

describe('basis-point math', () => {
  it('applies slippage with round-down', () => {
    expect(applySlippage(1_000_000n, 50)).toBe(995_000n);
    expect(applySlippage(999n, 50)).toBe(994n); // 994.005 rounded down
    expect(bpsOf(10n ** 18n, 2500)).toBe(25n * 10n ** 16n);
  });
  it('rejects out-of-range basis points', () => {
    expect(() => bpsOf(1n, 10_001)).toThrow();
    expect(() => bpsOf(1n, -1)).toThrow();
  });
});
