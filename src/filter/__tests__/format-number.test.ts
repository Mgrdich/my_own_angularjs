/**
 * Focused unit test for the internal `formatNumber` helper (Slice 7).
 *
 * Isolates the rounding + grouping logic from the `$locale` plumbing
 * and the filter factories. Table-driven cases lock down the algorithm
 * against the en-US `defaultLocale`; the helper handles non-en-US
 * separators correctly because every separator read goes through the
 * `locale` argument.
 */

import { describe, expect, it } from 'vitest';

import { formatNumber } from '@filter/format-number';
import { defaultLocale } from '@filter/locale';
import type { NumberPattern } from '@filter/locale-types';

const NUMBER_PATTERN: NumberPattern = defaultLocale.NUMBER_FORMATS.PATTERNS[0];
const CURRENCY_PATTERN: NumberPattern = defaultLocale.NUMBER_FORMATS.PATTERNS[1];

describe('formatNumber (helper)', () => {
  describe('NaN / Infinity short-circuits', () => {
    it('returns "" for NaN', () => {
      expect(formatNumber(NaN, NUMBER_PATTERN, 2, defaultLocale)).toBe('');
    });

    it('returns "∞" for Infinity', () => {
      expect(formatNumber(Number.POSITIVE_INFINITY, NUMBER_PATTERN, 2, defaultLocale)).toBe('∞');
    });

    it('returns "-∞" for -Infinity', () => {
      expect(formatNumber(Number.NEGATIVE_INFINITY, NUMBER_PATTERN, 2, defaultLocale)).toBe('-∞');
    });
  });

  describe('grouping', () => {
    it('does not group a single-digit value', () => {
      expect(formatNumber(1, NUMBER_PATTERN, 0, defaultLocale)).toBe('1');
    });

    it('does not group a 3-digit value', () => {
      expect(formatNumber(123, NUMBER_PATTERN, 0, defaultLocale)).toBe('123');
    });

    it('inserts one separator at a 4-digit boundary', () => {
      expect(formatNumber(1234, NUMBER_PATTERN, 0, defaultLocale)).toBe('1,234');
    });

    it('groups millions with two separators', () => {
      expect(formatNumber(1234567, NUMBER_PATTERN, 0, defaultLocale)).toBe('1,234,567');
    });

    it('groups billions with three separators', () => {
      expect(formatNumber(1234567890, NUMBER_PATTERN, 0, defaultLocale)).toBe('1,234,567,890');
    });
  });

  describe('rounding at fractionSize 0', () => {
    it('rounds half-up to integer', () => {
      expect(formatNumber(1234.5, NUMBER_PATTERN, 0, defaultLocale)).toBe('1,235');
    });

    it('rounds 1234.4 down to 1234', () => {
      expect(formatNumber(1234.4, NUMBER_PATTERN, 0, defaultLocale)).toBe('1,234');
    });
  });

  describe('rounding at fractionSize 2', () => {
    it('rounds 1234.5678 to 1234.57', () => {
      expect(formatNumber(1234.5678, NUMBER_PATTERN, 2, defaultLocale)).toBe('1,234.57');
    });

    it('pads 1234 to 1234.00', () => {
      expect(formatNumber(1234, NUMBER_PATTERN, 2, defaultLocale)).toBe('1,234.00');
    });
  });

  describe('rounding at fractionSize 4', () => {
    it('keeps four decimals exactly', () => {
      expect(formatNumber(0.12345, NUMBER_PATTERN, 4, defaultLocale)).toBe('0.1235');
    });

    it('pads short fractional', () => {
      expect(formatNumber(0.1, NUMBER_PATTERN, 4, defaultLocale)).toBe('0.1000');
    });
  });

  describe('tiny numbers', () => {
    it('rounds 0.001 to 0.00 at 2 digits', () => {
      expect(formatNumber(0.001, NUMBER_PATTERN, 2, defaultLocale)).toBe('0.00');
    });

    it('keeps 0.001 at 3 digits', () => {
      expect(formatNumber(0.001, NUMBER_PATTERN, 3, defaultLocale)).toBe('0.001');
    });

    it('keeps 0.0001 at 4 digits', () => {
      expect(formatNumber(0.0001, NUMBER_PATTERN, 4, defaultLocale)).toBe('0.0001');
    });
  });

  describe('negative values', () => {
    it('uses negPre "-" for the number pattern', () => {
      expect(formatNumber(-1234.5, NUMBER_PATTERN, 1, defaultLocale)).toBe('-1,234.5');
    });

    it('uses negPre "(¤" / negSuf ")" for the currency pattern', () => {
      // Placeholder substitution is the caller's job — formatNumber
      // returns the raw `¤`-bearing form.
      expect(formatNumber(-1234.5, CURRENCY_PATTERN, 2, defaultLocale)).toBe('(¤1,234.50)');
    });

    it('rounds the absolute value, not the signed value', () => {
      // -1234.5 rounded half-away-from-zero at fractionSize 0 is -1235.
      expect(formatNumber(-1234.5, NUMBER_PATTERN, 0, defaultLocale)).toBe('-1,235');
    });
  });

  describe('positive currency pattern', () => {
    it('embeds the ¤ placeholder before the number', () => {
      expect(formatNumber(1234.5, CURRENCY_PATTERN, 2, defaultLocale)).toBe('¤1,234.50');
    });
  });

  describe('integer-only values (no fractional part)', () => {
    it('omits the decimal separator at fractionSize 0', () => {
      expect(formatNumber(42, NUMBER_PATTERN, 0, defaultLocale)).toBe('42');
    });

    it('renders zero as "0" at fractionSize 0', () => {
      expect(formatNumber(0, NUMBER_PATTERN, 0, defaultLocale)).toBe('0');
    });

    it('renders zero as "0.00" at fractionSize 2', () => {
      expect(formatNumber(0, NUMBER_PATTERN, 2, defaultLocale)).toBe('0.00');
    });
  });

  describe('minInt padding', () => {
    it('pads 5 to "05" when minInt is 2', () => {
      const padPattern: NumberPattern = { ...NUMBER_PATTERN, minInt: 2 };
      expect(formatNumber(5, padPattern, 0, defaultLocale)).toBe('05');
    });
  });
});
