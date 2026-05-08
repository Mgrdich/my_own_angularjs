/**
 * `date` built-in filter tests (Slice 8 / FS §2.16).
 *
 * Covers the seventeen FS §2.16 acceptance criteria. Tests exercise the
 * full DI chain — `ngModule → .filter() DSL → $filterProvider → $filter
 * → $locale resolution`. Each `it` maps to one criterion (or one branch
 * of a multi-part criterion) for traceability.
 *
 * The system clock is pinned via `vi.setSystemTime` so any
 * environment-sensitive Date construction (e.g. `Date.parse` of a bare
 * date-only string) produces a deterministic value. For local-time
 * tokens we construct dates with explicit local-time component literals
 * (`new Date(year, month - 1, ...)`); for UTC assertions we use the
 * `'UTC'` timezone arg.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { defaultLocale } from '@filter/locale';

beforeAll(() => {
  vi.setSystemTime(new Date('2026-05-07T14:30:45Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

describe('date built-in filter (FS §2.16)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  describe('input parsing', () => {
    it('formats a Date instance with yyyy-MM-dd HH:mm:ss', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date(2026, 4, 7, 14, 30, 45);

      expect($filter('date')(date, 'yyyy-MM-dd HH:mm:ss')).toBe('2026-05-07 14:30:45');
    });

    it('formats an ISO-8601 string in UTC', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')('2026-05-07T14:30:45Z', 'yyyy-MM-dd', 'UTC')).toBe('2026-05-07');
    });

    it('formats a numeric ms input', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const ms = new Date(2025, 0, 1).getTime();

      expect($filter('date')(ms, 'yyyy')).toBe('2025');
    });
  });

  describe('year tokens', () => {
    it('yyyy renders 4-digit year', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 0, 1), 'yyyy')).toBe('2026');
    });

    it('yy renders 2-digit year', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 0, 1), 'yy')).toBe('26');
    });

    it('y renders the year unpadded', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 0, 1), 'y')).toBe('2026');
    });
  });

  describe('month tokens', () => {
    it('MMMM renders the full month name', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7), 'MMMM')).toBe('May');
    });

    it('MMM renders the short month name', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 0, 7), 'MMM')).toBe('Jan');
    });

    it('MM renders the 2-digit month', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 0, 7), 'MM')).toBe('01');
    });

    it('M renders the unpadded month', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 0, 7), 'M')).toBe('1');
    });
  });

  describe('day tokens', () => {
    it('dd renders the 2-digit day', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 3), 'dd')).toBe('03');
    });

    it('d renders the unpadded day', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 3), 'd')).toBe('3');
    });

    it('EEEE renders the full day name', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date(2026, 4, 7);
      const expected = defaultLocale.DATETIME_FORMATS.DAY[date.getDay()];

      expect($filter('date')(date, 'EEEE')).toBe(expected);
    });

    it('EEE renders the short day name', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date(2026, 4, 7);
      const expected = defaultLocale.DATETIME_FORMATS.SHORTDAY[date.getDay()];

      expect($filter('date')(date, 'EEE')).toBe(expected);
    });
  });

  describe('hour tokens', () => {
    it('HH renders the padded 24-hour', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 9, 5), 'HH')).toBe('09');
    });

    it('H renders the unpadded 24-hour', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 9, 5), 'H')).toBe('9');
    });

    it('hh renders the padded 12-hour (1-12)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      // Midnight maps to 12, not 00.
      expect($filter('date')(new Date(2026, 4, 7, 0, 0), 'hh')).toBe('12');
      // 13:00 maps to 1 in 12-hour form.
      expect($filter('date')(new Date(2026, 4, 7, 13, 0), 'hh')).toBe('01');
    });

    it('h renders the unpadded 12-hour', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 13, 0), 'h')).toBe('1');
    });
  });

  describe('minute / second / ms tokens', () => {
    it('mm renders the padded minute', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 5), 'mm')).toBe('05');
    });

    it('m renders the unpadded minute', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 5), 'm')).toBe('5');
    });

    it('ss renders the padded second', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 30, 7), 'ss')).toBe('07');
    });

    it('s renders the unpadded second', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 30, 7), 's')).toBe('7');
    });

    it('sss renders the padded milliseconds', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 30, 7, 42), 'sss')).toBe('042');
    });

    it('.sss renders dot-prefixed milliseconds', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 30, 7, 42), 'ss.sss')).toBe('07.042');
    });
  });

  describe('AM/PM token', () => {
    it('a renders AM before noon', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 9, 0), 'a')).toBe('AM');
    });

    it('a renders PM at and after noon', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 12, 0), 'a')).toBe('PM');
      expect($filter('date')(new Date(2026, 4, 7, 14, 30), 'a')).toBe('PM');
    });
  });

  describe('timezone tokens', () => {
    it('Z renders +0000 in UTC', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date('2026-05-07T14:30:45Z');

      expect($filter('date')(date, 'Z', 'UTC')).toBe('+0000');
    });

    it('ZZ renders +00:00 in UTC', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date('2026-05-07T14:30:45Z');

      expect($filter('date')(date, 'ZZ', 'UTC')).toBe('+00:00');
    });

    it('ww renders the 2-digit ISO week of year', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date(Date.UTC(2026, 0, 4));

      expect($filter('date')(date, 'ww', 'UTC')).toBe('01');
    });

    it('w renders the unpadded ISO week', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date(Date.UTC(2026, 0, 4));

      expect($filter('date')(date, 'w', 'UTC')).toBe('1');
    });
  });

  describe('named formats', () => {
    it('"medium" → "MMM d, y h:mm:ss a"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 30, 45), 'medium')).toBe('May 7, 2026 2:30:45 PM');
    });

    it('"short" → "M/d/yy h:mm a"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 30, 45), 'short')).toBe('5/7/26 2:30 PM');
    });

    it('"fullDate" → "EEEE, MMMM d, y"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date(2026, 4, 7);
      const dayName = defaultLocale.DATETIME_FORMATS.DAY[date.getDay()] ?? '';

      expect($filter('date')(date, 'fullDate')).toBe(`${dayName}, May 7, 2026`);
    });

    it('"longDate" → "MMMM d, y"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7), 'longDate')).toBe('May 7, 2026');
    });

    it('"mediumDate" → "MMM d, y"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7), 'mediumDate')).toBe('May 7, 2026');
    });

    it('"shortDate" → "M/d/yy"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7), 'shortDate')).toBe('5/7/26');
    });

    it('"mediumTime" → "h:mm:ss a"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 30, 45), 'mediumTime')).toBe('2:30:45 PM');
    });

    it('"shortTime" → "h:mm a"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7, 14, 30, 45), 'shortTime')).toBe('2:30 PM');
    });
  });

  describe('default and special inputs', () => {
    it('uses "mediumDate" as the default format when omitted', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7))).toBe('May 7, 2026');
    });

    it('formats in UTC when timezone is "UTC"', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const date = new Date('2026-05-07T14:30:45Z');

      expect($filter('date')(date, 'yyyy-MM-dd HH:mm', 'UTC')).toBe('2026-05-07 14:30');
    });

    it('returns the input unchanged when the string is not parseable', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')('not a date')).toBe('not a date');
    });

    it('returns "" for null input', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(null)).toBe('');
    });

    it('returns "" for undefined input', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(undefined)).toBe('');
    });
  });

  describe('quoted-literal escapes', () => {
    it("emits literal text inside single quotes (yyyy 'year')", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7), "yyyy 'year'")).toBe('2026 year');
    });

    it("emits one literal apostrophe for ''", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date')(new Date(2026, 4, 7), "yyyy''")).toBe("2026'");
    });
  });

  describe('stateless contract', () => {
    it('the filter has no $stateful flag', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('date').$stateful).toBeUndefined();
    });
  });
});
