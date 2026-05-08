/**
 * `defaultLocale` — the en-US `$locale` literal registered on the `ng`
 * module. Pure data, zero DI deps.
 *
 * Every level of the structure is recursively `Object.freeze`'d so that
 * accidental mutation throws in strict mode (which all `.ts` files run
 * in by default). The frozen tuple shape pairs with the `readonly`
 * declarations in `@filter/locale-types` to give both compile-time and
 * runtime immutability guarantees.
 *
 * Apps swap the entire object via `module.factory('$locale', () =>
 * myLocale)`. The `currency`, `number`, and (Slice 8) `date` filters
 * read `$locale` lazily on each invocation, so config-time swaps take
 * effect at run time.
 *
 * Pattern values match `angular/angular.js/src/ngLocale/angular-locale_en-us.js`.
 */

import type { LocaleService, NumberPattern } from './locale-types';

const NUMBER_PATTERN: NumberPattern = Object.freeze({
  minInt: 1,
  minFrac: 0,
  maxFrac: 3,
  posPre: '',
  posSuf: '',
  negPre: '-',
  negSuf: '',
  gSize: 3,
  lgSize: 3,
});

// `posPre` / `negPre` carry the `¤` (U+00A4) international-currency
// placeholder; the `currency` filter substitutes it with the resolved
// symbol (custom argument first, then `NUMBER_FORMATS.CURRENCY_SYM`).
// Negative values render as accounting parentheses — `($1,234.50)` — per
// AngularJS's en-US default.
const CURRENCY_PATTERN: NumberPattern = Object.freeze({
  minInt: 1,
  minFrac: 2,
  maxFrac: 2,
  posPre: '¤',
  posSuf: '',
  negPre: '(¤',
  negSuf: ')',
  gSize: 3,
  lgSize: 3,
});

// Tuple types are preserved via `as const`, which Prettier keeps intact
// (unlike the standalone `as readonly [...]` cast that Prettier collapses
// to `as readonly`).
const PATTERNS = Object.freeze([NUMBER_PATTERN, CURRENCY_PATTERN] as const);

const DAY = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const);
const SHORTDAY = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const);
const MONTH = Object.freeze([
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
] as const);
const SHORTMONTH = Object.freeze([
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
] as const);
const AMPMS = Object.freeze(['AM', 'PM'] as const);
const WEEKENDRANGE = Object.freeze([5, 6] as const);
const ERAS = Object.freeze(['BC', 'AD'] as const);
const ERANAMES = Object.freeze(['Before Christ', 'Anno Domini'] as const);

const NUMBER_FORMATS = Object.freeze({
  DECIMAL_SEP: '.',
  GROUP_SEP: ',',
  CURRENCY_SYM: '$',
  PATTERNS,
});

const DATETIME_FORMATS = Object.freeze({
  DAY,
  SHORTDAY,
  MONTH,
  SHORTMONTH,
  AMPMS,
  medium: 'MMM d, y h:mm:ss a',
  short: 'M/d/yy h:mm a',
  fullDate: 'EEEE, MMMM d, y',
  longDate: 'MMMM d, y',
  mediumDate: 'MMM d, y',
  shortTime: 'h:mm a',
  mediumTime: 'h:mm:ss a',
  shortDate: 'M/d/yy',
  // AngularJS canonical: 0 = Monday, ..., 6 = Sunday. en-US starts the
  // week on Sunday, so `FIRSTDAYOFWEEK` is `6`.
  FIRSTDAYOFWEEK: 6,
  WEEKENDRANGE,
  ERAS,
  ERANAMES,
});

/**
 * Default `$locale` value registered on the `ng` module. en-US locale
 * data — currency symbol `$`, decimal separator `.`, grouping
 * separator `,`, `AM` / `PM` markers, and the eight named date formats
 * AngularJS ships out of the box.
 *
 * Recursively frozen — mutating any field throws in strict mode.
 *
 * @example
 * ```ts
 * import { defaultLocale } from 'my-own-angularjs/filter';
 * defaultLocale.id;                                  // => 'en-us'
 * defaultLocale.NUMBER_FORMATS.CURRENCY_SYM;         // => '$'
 * defaultLocale.NUMBER_FORMATS.PATTERNS[1].negPre;   // => '(¤'
 * defaultLocale.DATETIME_FORMATS.medium;             // => 'MMM d, y h:mm:ss a'
 *
 * // Swapping for a custom locale at config time:
 * createModule('app', ['ng']).factory('$locale', () => myCustomLocale);
 * ```
 */
export const defaultLocale: LocaleService = Object.freeze({
  id: 'en-us',
  NUMBER_FORMATS,
  DATETIME_FORMATS,
});
