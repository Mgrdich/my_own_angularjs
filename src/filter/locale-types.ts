/**
 * Type-only surface for the `$locale` service.
 *
 * Mirrors AngularJS 1.x's `$locale` shape: a top-level `id` plus
 * `NUMBER_FORMATS` (decimal/grouping/currency patterns) and
 * `DATETIME_FORMATS` (day/month names, AM/PM markers, named
 * format strings). Sub-types (`NumberFormats`, `NumberPattern`,
 * `DatetimeFormats`) stay internal to `@filter/*` — only
 * {@link LocaleService} is re-exported through `index.ts` so app
 * authors registering a custom locale can type their factory.
 *
 * All fields are `readonly` so the en-US default literal is
 * structurally `Readonly` after `Object.freeze` — accidental
 * mutation surfaces as a TypeScript error before it reaches strict
 * mode at runtime.
 */

/**
 * A single formatting pattern slot — either the number pattern (index
 * 0 in {@link NumberFormats.PATTERNS}) or the currency pattern (index
 * 1). The shape matches AngularJS's `$locale.NUMBER_FORMATS.PATTERNS`
 * entries verbatim:
 *
 * - `minInt` — minimum integer digits (pads leading zeros).
 * - `minFrac` / `maxFrac` — bounds on fractional digits.
 * - `posPre` / `posSuf` — positive-value prefix / suffix.
 * - `negPre` / `negSuf` — negative-value prefix / suffix (the
 *   en-US currency pattern uses `'(¤'` / `')'` for accounting-style
 *   parentheses).
 * - `gSize` — group size for the rightmost group of integer digits.
 * - `lgSize` — group size for any subsequent groups (en-US: 3 for
 *   both; some locales use 2 for `lgSize` to render Indian-style
 *   `1,00,000` grouping).
 *
 * `posPre` / `negPre` may include the `¤` (U+00A4) placeholder; the
 * `currency` filter substitutes it with the resolved symbol before
 * concatenating into the final output.
 */
export interface NumberPattern {
  readonly minInt: number;
  readonly minFrac: number;
  readonly maxFrac: number;
  readonly posPre: string;
  readonly posSuf: string;
  readonly negPre: string;
  readonly negSuf: string;
  readonly gSize: number;
  readonly lgSize: number;
}

/**
 * Numeric-formatting bundle on `$locale.NUMBER_FORMATS`. Carries the
 * decimal / group separators, the default currency symbol, and the
 * exact two-tuple of {@link NumberPattern}s — index 0 for the `number`
 * filter, index 1 for `currency`. The fixed two-tuple shape matches
 * AngularJS 1.x exactly.
 */
export interface NumberFormats {
  readonly DECIMAL_SEP: string;
  readonly GROUP_SEP: string;
  readonly CURRENCY_SYM: string;
  readonly PATTERNS: readonly [NumberPattern, NumberPattern];
}

/**
 * Datetime-formatting bundle on `$locale.DATETIME_FORMATS`. Day-of-week
 * arrays are Sunday-first seven-tuples; month arrays are January-first
 * twelve-tuples. The named format strings (`medium`, `short`, ...) are
 * resolved by the `date` filter via lookup — `format | date:'medium'`
 * indirects through this map first, then re-parses the resulting token
 * string. `FIRSTDAYOFWEEK`, `WEEKENDRANGE`, `ERAS`, and `ERANAMES`
 * round out parity with AngularJS's `ngLocale` payload (the `date`
 * filter slot in Slice 8 will consume them).
 */
export interface DatetimeFormats {
  readonly DAY: readonly [string, string, string, string, string, string, string];
  readonly SHORTDAY: readonly [string, string, string, string, string, string, string];
  readonly MONTH: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  readonly SHORTMONTH: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  readonly AMPMS: readonly [string, string];
  readonly medium: string;
  readonly short: string;
  readonly fullDate: string;
  readonly longDate: string;
  readonly mediumDate: string;
  readonly shortDate: string;
  readonly mediumTime: string;
  readonly shortTime: string;
  readonly FIRSTDAYOFWEEK: number;
  readonly WEEKENDRANGE: readonly [number, number];
  readonly ERAS: readonly [string, string];
  readonly ERANAMES: readonly [string, string];
}

/**
 * Public face of the `$locale` service. The default registered on the
 * `ng` module is the en-US literal in `@filter/locale`; apps swap the
 * entire object via `module.factory('$locale', () => myLocale)` or
 * `$provide.factory('$locale', () => myLocale)`. The `currency`,
 * `number`, and (Slice 8) `date` filters read this service lazily on
 * each invocation so a config-time swap is visible at run time.
 *
 * @example
 * ```ts
 * const $locale = injector.get<LocaleService>('$locale');
 * $locale.id;                                // => 'en-us'
 * $locale.NUMBER_FORMATS.CURRENCY_SYM;       // => '$'
 * $locale.DATETIME_FORMATS.AMPMS;            // => ['AM', 'PM']
 * ```
 */
export interface LocaleService {
  readonly id: string;
  readonly NUMBER_FORMATS: NumberFormats;
  readonly DATETIME_FORMATS: DatetimeFormats;
}
