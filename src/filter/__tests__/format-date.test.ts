/**
 * Focused unit tests for the internal `formatDate` helper (Slice 8).
 *
 * Isolates the format-string scanner and token dispatch from the
 * `$locale` plumbing and DI machinery. Table-driven cases lock down:
 *
 * - Longest-first token-match priority (`MMMM` not partially matched
 *   as `MMM`; `.sss` not split into `.` + `sss`).
 * - Single-quote-escape rule (`'literal'` and `''` apostrophe).
 * - Named-format → token-string indirection (`'medium'` resolves first
 *   then is re-scanned).
 * - Each token at least once with a known input/output pair.
 * - Boundary cases: midnight + noon for 12-hour tokens, ISO week
 *   boundaries (Jan 1 in week 53 of prior year, Dec 31 in week 1 of
 *   next year).
 *
 * The system clock is pinned via `vi.setSystemTime` so any `new Date()`
 * call inside the helper produces a deterministic value. Tests use
 * explicit local-time `new Date(year, monthIndex, day, ...)` literals
 * for tokens whose output depends on local-time accessors; UTC-
 * dependent assertions go through `'UTC'` as the timezone arg.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { formatDate } from '@filter/format-date';
import { defaultLocale } from '@filter/locale';

beforeAll(() => {
  vi.setSystemTime(new Date('2026-05-07T14:30:45Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

describe('formatDate (helper)', () => {
  describe('null / undefined / non-Date input', () => {
    it('returns "" for null', () => {
      expect(formatDate(null, 'yyyy', undefined, defaultLocale)).toBe('');
    });

    it('returns "" for undefined', () => {
      expect(formatDate(undefined, 'yyyy', undefined, defaultLocale)).toBe('');
    });

    it('returns the input unchanged for a non-parseable string', () => {
      expect(formatDate('not a date', 'yyyy', undefined, defaultLocale)).toBe('not a date');
    });
  });

  describe('input parsing', () => {
    it('accepts a Date instance', () => {
      const date = new Date(2026, 4, 7, 14, 30, 45);
      expect(formatDate(date, 'yyyy-MM-dd', undefined, defaultLocale)).toBe('2026-05-07');
    });

    it('accepts a numeric ms input', () => {
      const ms = new Date(2025, 0, 1).getTime();
      expect(formatDate(ms, 'yyyy', undefined, defaultLocale)).toBe('2025');
    });

    it('accepts an ISO-8601 string with Z suffix', () => {
      expect(formatDate('2026-05-07T14:30:45Z', 'yyyy-MM-dd', 'UTC', defaultLocale)).toBe('2026-05-07');
    });

    it('accepts a date-only ISO string', () => {
      expect(formatDate('2026-05-07', 'yyyy-MM-dd', 'UTC', defaultLocale)).toBe('2026-05-07');
    });

    it('accepts an ISO string with embedded timezone offset', () => {
      // `2026-05-07T07:30:45-07:00` is `2026-05-07T14:30:45Z` in UTC.
      expect(formatDate('2026-05-07T07:30:45-07:00', 'yyyy-MM-dd HH:mm:ss', 'UTC', defaultLocale)).toBe(
        '2026-05-07 14:30:45',
      );
    });
  });

  describe('longest-first token matching', () => {
    it('matches MMMM as the full month name (not MMM + M)', () => {
      const date = new Date(2026, 4, 7);
      expect(formatDate(date, 'MMMM', undefined, defaultLocale)).toBe('May');
    });

    it('matches MMM as the short month name (not MM + M)', () => {
      const date = new Date(2026, 4, 7);
      expect(formatDate(date, 'MMM', undefined, defaultLocale)).toBe('May');
    });

    it('matches yyyy as the 4-digit year (not yy + yy)', () => {
      const date = new Date(2026, 0, 1);
      expect(formatDate(date, 'yyyy', undefined, defaultLocale)).toBe('2026');
    });

    it('matches .sss as a leading-dot millisecond token (not . + sss)', () => {
      const date = new Date(2026, 0, 1, 0, 0, 0, 7);
      expect(formatDate(date, 'ss.sss', undefined, defaultLocale)).toBe('00.007');
    });

    it('matches EEEE as the full day name (not EEE + E)', () => {
      // 2026-05-07 is a Thursday in local time when the system clock
      // is pinned to that calendar date; verify against the helper.
      const date = new Date(2026, 4, 7);
      const dayName = defaultLocale.DATETIME_FORMATS.DAY[date.getDay()];
      expect(formatDate(date, 'EEEE', undefined, defaultLocale)).toBe(dayName);
    });
  });

  describe('single-quote escape', () => {
    it('emits literal text inside single quotes', () => {
      const date = new Date(2026, 4, 7);
      expect(formatDate(date, "yyyy 'year'", undefined, defaultLocale)).toBe('2026 year');
    });

    it('emits a literal apostrophe for ""', () => {
      const date = new Date(2026, 4, 7);
      expect(formatDate(date, "yyyy''", undefined, defaultLocale)).toBe("2026'");
    });

    it('does not interpret tokens inside a quoted run', () => {
      const date = new Date(2026, 4, 7);
      expect(formatDate(date, "'yyyy'", undefined, defaultLocale)).toBe('yyyy');
    });

    it('handles unterminated quoted runs (forgiving)', () => {
      const date = new Date(2026, 4, 7);
      // Unterminated literal — emits the rest as literal text.
      expect(formatDate(date, "yyyy 'unterminated", undefined, defaultLocale)).toBe('2026 unterminated');
    });
  });

  describe('named formats', () => {
    it('resolves "medium" through DATETIME_FORMATS first', () => {
      const date = new Date(2026, 4, 7, 14, 30, 45);
      // medium = 'MMM d, y h:mm:ss a'
      expect(formatDate(date, 'medium', undefined, defaultLocale)).toBe('May 7, 2026 2:30:45 PM');
    });

    it('resolves "shortDate"', () => {
      const date = new Date(2026, 4, 7);
      // shortDate = 'M/d/yy'
      expect(formatDate(date, 'shortDate', undefined, defaultLocale)).toBe('5/7/26');
    });

    it('resolves "fullDate"', () => {
      const date = new Date(2026, 4, 7);
      // fullDate = 'EEEE, MMMM d, y'
      const dayName = defaultLocale.DATETIME_FORMATS.DAY[date.getDay()] ?? '';
      expect(formatDate(date, 'fullDate', undefined, defaultLocale)).toBe(`${dayName}, May 7, 2026`);
    });
  });

  describe('hour boundary cases', () => {
    it('renders midnight as 12 AM (h:mm a)', () => {
      const midnight = new Date(2026, 4, 7, 0, 0, 0);
      expect(formatDate(midnight, 'h:mm a', undefined, defaultLocale)).toBe('12:00 AM');
    });

    it('renders noon as 12 PM (h:mm a)', () => {
      const noon = new Date(2026, 4, 7, 12, 0, 0);
      expect(formatDate(noon, 'h:mm a', undefined, defaultLocale)).toBe('12:00 PM');
    });

    it('renders 13:00 as 1 PM in 12-hour form', () => {
      const onePm = new Date(2026, 4, 7, 13, 0, 0);
      expect(formatDate(onePm, 'h:mm a', undefined, defaultLocale)).toBe('1:00 PM');
    });

    it('renders midnight as 00:00 in 24-hour form', () => {
      const midnight = new Date(2026, 4, 7, 0, 0, 0);
      expect(formatDate(midnight, 'HH:mm', undefined, defaultLocale)).toBe('00:00');
    });

    it('pads 1-digit hour in HH', () => {
      const date = new Date(2026, 4, 7, 9, 5, 3);
      expect(formatDate(date, 'HH:mm:ss', undefined, defaultLocale)).toBe('09:05:03');
    });
  });

  describe('ISO week boundaries', () => {
    it('Jan 1 2023 is in ISO week 52 of 2022 (Sunday)', () => {
      // 2023-01-01 is a Sunday; ISO weeks start on Monday, so it's in week 52 of 2022.
      const date = new Date(Date.UTC(2023, 0, 1));
      expect(formatDate(date, 'w', 'UTC', defaultLocale)).toBe('52');
    });

    it('Dec 31 2024 is in ISO week 1 of 2025 (Tuesday)', () => {
      // 2024-12-31 is a Tuesday; ISO week 1 of 2025 contains Mon-Sun
      // 2024-12-30..2025-01-05.
      const date = new Date(Date.UTC(2024, 11, 31));
      expect(formatDate(date, 'w', 'UTC', defaultLocale)).toBe('1');
    });

    it('Jan 4 is always in ISO week 1', () => {
      const date = new Date(Date.UTC(2026, 0, 4));
      expect(formatDate(date, 'w', 'UTC', defaultLocale)).toBe('1');
    });

    it('pads ISO week with ww', () => {
      const date = new Date(Date.UTC(2023, 0, 1));
      expect(formatDate(date, 'ww', 'UTC', defaultLocale)).toBe('52');
    });
  });

  describe('UTC vs local timezone', () => {
    it('UTC accessor reads UTC fields when timezone is "UTC"', () => {
      const date = new Date('2026-05-07T14:30:45Z');
      expect(formatDate(date, 'yyyy-MM-dd HH:mm:ss', 'UTC', defaultLocale)).toBe('2026-05-07 14:30:45');
    });

    it('Z token returns +0000 in UTC', () => {
      const date = new Date('2026-05-07T14:30:45Z');
      expect(formatDate(date, 'Z', 'UTC', defaultLocale)).toBe('+0000');
    });

    it('ZZ token returns +00:00 in UTC', () => {
      const date = new Date('2026-05-07T14:30:45Z');
      expect(formatDate(date, 'ZZ', 'UTC', defaultLocale)).toBe('+00:00');
    });

    it('shifts the date by the requested offset for ±HHmm timezones', () => {
      // 14:30 UTC + 0530 = 20:00 in IST
      const date = new Date('2026-05-07T14:30:45Z');
      expect(formatDate(date, 'HH:mm', '+0530', defaultLocale)).toBe('20:00');
    });
  });

  describe('year tokens', () => {
    it('yyyy renders 4-digit year', () => {
      expect(formatDate(new Date(2026, 0, 1), 'yyyy', undefined, defaultLocale)).toBe('2026');
    });

    it('yy renders 2-digit year', () => {
      expect(formatDate(new Date(2026, 0, 1), 'yy', undefined, defaultLocale)).toBe('26');
    });

    it('y renders year without padding', () => {
      expect(formatDate(new Date(2026, 0, 1), 'y', undefined, defaultLocale)).toBe('2026');
    });
  });
});
