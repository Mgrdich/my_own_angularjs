/**
 * `$locale` provider tests (Slice 7 / FS §2.20).
 *
 * The default registered on `ngModule` is the en-US literal in
 * `@filter/locale`. This file pins the structural contract: id,
 * NUMBER_FORMATS shape, DATETIME_FORMATS shape, the eight named date
 * format strings, the swap path via `module.factory('$locale', ...)`,
 * and the lazy-read guarantee that swapping at config time is visible
 * at filter invocation.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { FilterService } from '@filter/filter-types';
import type { LocaleService } from '@filter/locale-types';

describe('$locale provider (FS §2.20)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  describe('en-US defaults', () => {
    it('has id "en-us"', () => {
      const injector = createInjector([ngModule]);
      const $locale = injector.get<LocaleService>('$locale');

      expect($locale.id).toBe('en-us');
    });

    it('has the en-US NUMBER_FORMATS separator and currency-symbol fields', () => {
      const injector = createInjector([ngModule]);
      const $locale = injector.get<LocaleService>('$locale');

      expect($locale.NUMBER_FORMATS.DECIMAL_SEP).toBe('.');
      expect($locale.NUMBER_FORMATS.GROUP_SEP).toBe(',');
      expect($locale.NUMBER_FORMATS.CURRENCY_SYM).toBe('$');
    });

    it('exposes exactly two patterns with the documented shapes', () => {
      const injector = createInjector([ngModule]);
      const $locale = injector.get<LocaleService>('$locale');
      const patterns = $locale.NUMBER_FORMATS.PATTERNS;

      expect(patterns.length).toBe(2);

      // Index 0: number pattern.
      expect(patterns[0].minFrac).toBe(0);
      expect(patterns[0].maxFrac).toBe(3);
      expect(patterns[0].posPre).toBe('');
      expect(patterns[0].negPre).toBe('-');
      expect(patterns[0].gSize).toBe(3);
      expect(patterns[0].lgSize).toBe(3);

      // Index 1: currency pattern (parentheses for negatives).
      expect(patterns[1].minFrac).toBe(2);
      expect(patterns[1].maxFrac).toBe(2);
      expect(patterns[1].posPre).toBe('¤');
      expect(patterns[1].negPre).toBe('(¤');
      expect(patterns[1].negSuf).toBe(')');
    });

    it('has the en-US DAY / SHORTDAY arrays', () => {
      const injector = createInjector([ngModule]);
      const $locale = injector.get<LocaleService>('$locale');

      expect($locale.DATETIME_FORMATS.DAY).toEqual([
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]);
      expect($locale.DATETIME_FORMATS.SHORTDAY).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    });

    it('has the en-US MONTH / SHORTMONTH arrays', () => {
      const injector = createInjector([ngModule]);
      const $locale = injector.get<LocaleService>('$locale');

      expect($locale.DATETIME_FORMATS.MONTH).toEqual([
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ]);
      expect($locale.DATETIME_FORMATS.SHORTMONTH).toEqual([
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ]);
    });

    it('has AMPMS = ["AM", "PM"]', () => {
      const injector = createInjector([ngModule]);
      const $locale = injector.get<LocaleService>('$locale');

      expect($locale.DATETIME_FORMATS.AMPMS).toEqual(['AM', 'PM']);
    });

    it('has the eight named date formats with en-US default values', () => {
      const injector = createInjector([ngModule]);
      const $locale = injector.get<LocaleService>('$locale');
      const dt = $locale.DATETIME_FORMATS;

      expect(dt.medium).toBe('MMM d, y h:mm:ss a');
      expect(dt.short).toBe('M/d/yy h:mm a');
      expect(dt.fullDate).toBe('EEEE, MMMM d, y');
      expect(dt.longDate).toBe('MMMM d, y');
      expect(dt.mediumDate).toBe('MMM d, y');
      expect(dt.shortDate).toBe('M/d/yy');
      expect(dt.mediumTime).toBe('h:mm:ss a');
      expect(dt.shortTime).toBe('h:mm a');
    });

    it('exposes ERAS / ERANAMES / FIRSTDAYOFWEEK / WEEKENDRANGE for parity', () => {
      const injector = createInjector([ngModule]);
      const $locale = injector.get<LocaleService>('$locale');
      const dt = $locale.DATETIME_FORMATS;

      expect(dt.ERAS).toEqual(['BC', 'AD']);
      expect(dt.ERANAMES).toEqual(['Before Christ', 'Anno Domini']);
      expect(dt.FIRSTDAYOFWEEK).toBe(6);
      expect(dt.WEEKENDRANGE).toEqual([5, 6]);
    });
  });

  describe('swap via module.factory', () => {
    it('downstream factory replaces $locale; currency filter sees the new symbol', () => {
      // Construct a minimal-valid LocaleService using the de-DE-style
      // formatting overrides. The DATETIME_FORMATS slot is required by
      // the LocaleService type but is not exercised by `currency`.
      const customLocale: LocaleService = {
        id: 'de-de',
        NUMBER_FORMATS: {
          DECIMAL_SEP: ',',
          GROUP_SEP: '.',
          CURRENCY_SYM: '€',
          PATTERNS: [
            {
              minInt: 1,
              minFrac: 0,
              maxFrac: 3,
              posPre: '',
              posSuf: '',
              negPre: '-',
              negSuf: '',
              gSize: 3,
              lgSize: 3,
            },
            {
              minInt: 1,
              minFrac: 2,
              maxFrac: 2,
              posPre: '¤',
              posSuf: '',
              negPre: '(¤',
              negSuf: ')',
              gSize: 3,
              lgSize: 3,
            },
          ],
        },
        DATETIME_FORMATS: {
          DAY: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
          SHORTDAY: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
          MONTH: [
            'Januar',
            'Februar',
            'März',
            'April',
            'Mai',
            'Juni',
            'Juli',
            'August',
            'September',
            'Oktober',
            'November',
            'Dezember',
          ],
          SHORTMONTH: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
          AMPMS: ['AM', 'PM'],
          medium: 'd. MMM y HH:mm:ss',
          short: 'dd.MM.yy HH:mm',
          fullDate: 'EEEE, d. MMMM y',
          longDate: 'd. MMMM y',
          mediumDate: 'd. MMM y',
          shortDate: 'dd.MM.yy',
          mediumTime: 'HH:mm:ss',
          shortTime: 'HH:mm',
          FIRSTDAYOFWEEK: 0,
          WEEKENDRANGE: [5, 6],
          ERAS: ['v. Chr.', 'n. Chr.'],
          ERANAMES: ['vor Christus', 'nach Christus'],
        },
      };

      // App-module overrides $locale via module.factory. Last-wins,
      // so the en-US default registered on `ng` is replaced.
      const appModule = createModule('app', ['ng']).factory('$locale', [() => customLocale]);

      const injector = createInjector([ngModule, appModule]);
      const $locale = injector.get<LocaleService>('$locale');
      expect($locale.id).toBe('de-de');

      // Currency renders with the de-DE symbol AND the de-DE
      // separators (`.` for groups, `,` for decimals).
      const $filter = injector.get<FilterService>('$filter');
      expect($filter('currency')(1234.5)).toBe('€1.234,50');
    });
  });

  describe('lazy read of $locale on each invocation', () => {
    it('a config-time swap takes effect at run-time filter call', () => {
      const customLocale: LocaleService = {
        ...{
          id: 'fr-fr',
          NUMBER_FORMATS: {
            DECIMAL_SEP: ',',
            GROUP_SEP: ' ',
            CURRENCY_SYM: 'F',
            PATTERNS: [
              {
                minInt: 1,
                minFrac: 0,
                maxFrac: 3,
                posPre: '',
                posSuf: '',
                negPre: '-',
                negSuf: '',
                gSize: 3,
                lgSize: 3,
              },
              {
                minInt: 1,
                minFrac: 2,
                maxFrac: 2,
                posPre: '¤',
                posSuf: '',
                negPre: '(¤',
                negSuf: ')',
                gSize: 3,
                lgSize: 3,
              },
            ],
          },
          DATETIME_FORMATS: {
            DAY: ['', '', '', '', '', '', ''],
            SHORTDAY: ['', '', '', '', '', '', ''],
            MONTH: ['', '', '', '', '', '', '', '', '', '', '', ''],
            SHORTMONTH: ['', '', '', '', '', '', '', '', '', '', '', ''],
            AMPMS: ['AM', 'PM'],
            medium: '',
            short: '',
            fullDate: '',
            longDate: '',
            mediumDate: '',
            shortDate: '',
            mediumTime: '',
            shortTime: '',
            FIRSTDAYOFWEEK: 0,
            WEEKENDRANGE: [5, 6],
            ERAS: ['', ''],
            ERANAMES: ['', ''],
          },
        },
      };

      const appModule = createModule('app', ['ng']).factory('$locale', [() => customLocale]);

      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');

      // The factory produced the filter by injecting `$locale` ONCE,
      // but the filter reads `$locale.NUMBER_FORMATS.CURRENCY_SYM`
      // per invocation — so the custom symbol is visible.
      expect($filter('currency')(100)).toBe('F100,00');
    });
  });
});
