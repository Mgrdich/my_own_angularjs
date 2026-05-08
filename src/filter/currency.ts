/**
 * `currency` — number → currency-string built-in filter.
 *
 * Depends on `$locale` (resolved by `$injector.invoke` of the array-style
 * factory below). Reads `$locale.NUMBER_FORMATS.CURRENCY_SYM` and
 * `$locale.NUMBER_FORMATS.PATTERNS[1]` lazily on each invocation — the
 * factory captures the `$locale` reference once at injector resolution
 * time, but the per-call lookups go through that reference, so a
 * `decorator` or run-time mutation on `$locale` is visible immediately
 * (FS §2.20).
 *
 * Output:
 * - non-numeric / `null` / `undefined` / `NaN` input → `''`
 * - finite number → `formatNumber` with `PATTERNS[1]`, then `¤`
 *   substituted with the resolved symbol
 * - `Infinity` / `-Infinity` → `formatNumber` returns `'∞'` / `'-∞'`
 *   and the same `¤` substitution wraps them with the pattern
 *   prefix/suffix (e.g. `'$∞'` / `'(-$∞)'`)
 *
 * Negatives use `negPre`/`negSuf` from the en-US currency pattern —
 * `'(¤'` / `')'` — so `-1234.5 | currency` renders as `'($1,234.50)'`
 * (FS §2.14 acceptance criterion 4).
 */

import type { Invokable } from '@di/di-types';

import type { FilterFn } from './filter-types';
import { formatNumber } from './format-number';
import type { LocaleService } from './locale-types';

/**
 * Factory for the `currency` built-in filter.
 *
 * Array-style annotation (`['$locale', fn]`) — `$locale` is resolved
 * by `$injector.invoke` when the filter is first looked up, then
 * cached as a singleton.
 *
 * The returned filter accepts up to three positional arguments:
 *   - `amount` — the number to format. Non-numeric inputs return `''`.
 *   - `symbol` (optional) — currency symbol. Defaults to
 *     `$locale.NUMBER_FORMATS.CURRENCY_SYM` (en-US: `'$'`).
 *   - `fractionSize` (optional) — decimal digit count. Defaults to `2`.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * $filter('currency')(1234.5);            // => '$1,234.50'
 * $filter('currency')(1234.5, '€');       // => '€1,234.50'
 * $filter('currency')(1234.5, '$', 0);    // => '$1,235'
 * $filter('currency')(-1234.5);           // => '($1,234.50)'
 * $filter('currency')('not-a-number');    // => ''
 * // {{ subtotal | currency:'€':2 }}      // template usage
 * ```
 */
export const currencyFilterFactory: Invokable<FilterFn> = [
  '$locale',
  ($locale: LocaleService): FilterFn =>
    (amount, symbol, fractionSize) => {
      if (amount === null || amount === undefined) {
        return '';
      }
      if (typeof amount !== 'number' || Number.isNaN(amount)) {
        return '';
      }

      // Lazy reads of `$locale` — the factory only captured the
      // service REFERENCE, so a decorator / run-time swap of the
      // service's properties is visible immediately.
      const sym = typeof symbol === 'string' ? symbol : $locale.NUMBER_FORMATS.CURRENCY_SYM;
      const frac = typeof fractionSize === 'number' ? fractionSize : 2;
      const pattern = $locale.NUMBER_FORMATS.PATTERNS[1];

      const formatted = formatNumber(amount, pattern, frac, $locale);
      // `¤` (U+00A4) is the international-currency placeholder embedded
      // in the pattern's `posPre` / `negPre`. Substitute once, anywhere
      // in the string — the regex/g handles both `(¤` and `¤` cases.
      return formatted.replace(/¤/g, sym);
    },
];
