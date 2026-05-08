/**
 * `date` — date-formatting built-in filter.
 *
 * Depends on `$locale`; reads `$locale.DATETIME_FORMATS` lazily on each
 * invocation through the captured service reference (same architecture
 * as `currency` / `number`). Defers the heavy lifting to the internal
 * {@link formatDate} helper.
 *
 * Output:
 * - `null` / `undefined` input → `''`
 * - Date instance → formatted per `format` argument
 * - numeric ms → coerced via `new Date(input)` then formatted
 * - ISO-8601 string → parsed and formatted (UTC by default unless
 *   `timezone` arg overrides)
 * - non-parseable string → input returned unchanged
 * - default `format` when omitted is `'mediumDate'` (FS §2.16)
 */

import type { Invokable } from '@di/di-types';

import type { FilterFn } from './filter-types';
import { formatDate } from './format-date';
import type { LocaleService } from './locale-types';

/**
 * Factory for the `date` built-in filter.
 *
 * Array-style annotation (`['$locale', fn]`) — `$locale` is resolved by
 * `$injector.invoke` on first lookup and cached as a singleton. The
 * returned filter accepts up to three positional arguments:
 *   - `input` — Date, number-of-ms, or ISO-8601 string. `null` /
 *     `undefined` → `''`. Non-parseable string → input unchanged.
 *   - `format` (optional) — token string (e.g. `'yyyy-MM-dd'`) or one
 *     of the eight named formats (`'medium'`, `'short'`, `'fullDate'`,
 *     `'longDate'`, `'mediumDate'`, `'shortDate'`, `'mediumTime'`,
 *     `'shortTime'`). Defaults to `'mediumDate'` (FS §2.16).
 *   - `timezone` (optional) — `'UTC'` or `±HHmm` / `±HH:mm`. Otherwise
 *     local time.
 *
 * Tokens supported: `yyyy`, `yy`, `y`, `MMMM`, `MMM`, `MM`, `M`,
 * `LLLL`, `dd`, `d`, `EEEE`, `EEE`, `HH`, `H`, `hh`, `h`, `mm`, `m`,
 * `ss`, `s`, `sss`, `.sss`, `a`, `Z`, `ZZ`, `ww`, `w`. Single-quote-
 * escaped runs in the format string emit literal text (`'literal'`);
 * `''` emits one literal apostrophe.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * $filter('date')(new Date(2026, 4, 7, 14, 30, 45), 'yyyy-MM-dd HH:mm:ss');
 * // => '2026-05-07 14:30:45' (local time)
 *
 * $filter('date')('2026-05-07T14:30:45Z', 'yyyy-MM-dd', 'UTC');
 * // => '2026-05-07'
 *
 * $filter('date')(new Date(2026, 4, 7), 'medium');
 * // => 'May 7, 2026 12:00:00 AM'   (medium expands to 'MMM d, y h:mm:ss a')
 *
 * $filter('date')(null);              // => ''
 * $filter('date')('not a date');      // => 'not a date' (pass-through)
 *
 * // {{ post.publishedAt | date:'mediumDate' }}   // template usage
 * ```
 */
export const dateFilterFactory: Invokable<FilterFn> = [
  '$locale',
  ($locale: LocaleService): FilterFn =>
    (input, format, timezone) => {
      // Pass-through `null` / `undefined` directly — `formatDate` also
      // returns `''` for these, but we keep the explicit short-circuit
      // here so the function body reads top-to-bottom alongside the
      // FS §2.16 acceptance criteria.
      if (input === null || input === undefined) {
        return '';
      }
      // Non-Date, non-number, non-string input: AngularJS returns the
      // input unchanged. The strictly-typed `formatDate` only handles
      // those three runtime shapes; everything else is a pass-through.
      if (!(input instanceof Date) && typeof input !== 'number' && typeof input !== 'string') {
        return input;
      }

      const fmt = typeof format === 'string' ? format : 'mediumDate';
      const tz = typeof timezone === 'string' ? timezone : undefined;
      return formatDate(input, fmt, tz, $locale);
    },
];
