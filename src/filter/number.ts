/**
 * `number` — number-formatting built-in filter.
 *
 * Depends on `$locale`; reads `$locale.NUMBER_FORMATS.PATTERNS[0]` for
 * the number pattern (decimal sep, group sep, min/max digits). Lazy
 * reads on each invocation — same architecture as `currency`.
 *
 * Output:
 * - non-numeric input (typeof !== 'number') → `''`
 * - `NaN` → `''` (via `formatNumber`'s short-circuit)
 * - `Infinity` / `-Infinity` → `'∞'` / `'-∞'` (via `formatNumber`)
 * - very large numbers exceeding the pattern's representable range
 *   fall through to JavaScript's default `toString`, which renders
 *   exponents (`1e21 | number` → `'1e+21'`) — matches AngularJS
 * - explicit `fractionSize` forces both min and max → padding (`1.5 |
 *   number:3` → `'1.500'`)
 * - omitted `fractionSize` uses pattern bounds (`minFrac`..`maxFrac`)
 *   and TRIMS trailing zeros down to `minFrac` (`1.5 | number` →
 *   `'1.5'`, NOT `'1.500'`) — FS §2.15 acceptance criterion 9
 */

import type { Invokable } from '@di/di-types';

import type { FilterFn } from './filter-types';
import { formatNumber } from './format-number';
import type { LocaleService, NumberPattern } from './locale-types';

/**
 * The very-large-number fall-through threshold. For values whose
 * absolute magnitude renders in scientific notation under JavaScript's
 * default `Number.prototype.toString` (i.e. `String(1e21) === '1e+21'`),
 * we skip pattern-based formatting and return the bare string. This
 * matches AngularJS — its `formatNumber` checks `numStr.indexOf('e')`
 * and bails to the exponent form.
 */
function isExponentNotation(value: number): boolean {
  return String(value).indexOf('e') !== -1;
}

/**
 * Trim trailing zeros from the fractional part of a formatted number,
 * down to `minFrac` digits. Used when `fractionSize` is omitted — the
 * caller formats with `maxFrac` for upper precision, then this helper
 * pulls back to the actual value's representation while honoring
 * `minFrac`.
 */
function trimTrailingZeros(formatted: string, decimalSep: string, minFrac: number): string {
  const dotIdx = formatted.lastIndexOf(decimalSep);
  if (dotIdx === -1) {
    return formatted;
  }
  let end = formatted.length;
  let kept = end - dotIdx - 1;
  while (kept > minFrac && formatted.charAt(end - 1) === '0') {
    end -= 1;
    kept -= 1;
  }
  // If we trimmed everything past the decimal AND `minFrac === 0`,
  // also drop the decimal separator itself.
  if (kept === 0 && minFrac === 0) {
    end -= 1;
  }
  return formatted.slice(0, end);
}

/**
 * Factory for the `number` built-in filter.
 *
 * Array-style annotation; `$locale` resolved on first lookup. The
 * returned filter accepts:
 *   - `value` — the number to format. Non-numeric → `''`.
 *   - `fractionSize` (optional) — fixed decimal-digit count. Omitting
 *     it uses the pattern's `minFrac`..`maxFrac` range with trailing
 *     zeros trimmed.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * $filter('number')(1234567.89);     // => '1,234,567.89'
 * $filter('number')(1234.5678, 2);   // => '1,234.57'
 * $filter('number')(1.5);            // => '1.5'    (trim)
 * $filter('number')(1.5, 3);         // => '1.500'  (pad)
 * $filter('number')(Infinity);       // => '∞'
 * $filter('number')('not-a-number'); // => ''
 * // {{ price | number:2 }} inside a template.
 * ```
 */
export const numberFilterFactory: Invokable<FilterFn> = [
  '$locale',
  ($locale: LocaleService): FilterFn =>
    (value, fractionSize) => {
      if (typeof value !== 'number') {
        return '';
      }
      if (Number.isNaN(value)) {
        return '';
      }

      // Very-large numbers: fall back to `String(value)` — AngularJS
      // parity. Pattern-based formatting cannot represent the
      // exponent.
      if (Number.isFinite(value) && isExponentNotation(value)) {
        return String(value);
      }

      const pattern: NumberPattern = $locale.NUMBER_FORMATS.PATTERNS[0];

      if (typeof fractionSize === 'number') {
        // Explicit size: pad and round to exactly `fractionSize`.
        return formatNumber(value, pattern, fractionSize, $locale);
      }

      // Omitted: format with the pattern's `maxFrac`, then trim
      // trailing zeros down to `minFrac`. Trimming runs against the
      // formatted string (not the digits) so the decimal-separator
      // character is honored — works for any locale.
      const formatted = formatNumber(value, pattern, pattern.maxFrac, $locale);
      // `Infinity` / `-Infinity` shortcut from `formatNumber` returns
      // `'∞'` / `'-∞'` — no decimal separator, nothing to trim.
      if (formatted === '∞' || formatted === '-∞') {
        return formatted;
      }
      return trimTrailingZeros(formatted, $locale.NUMBER_FORMATS.DECIMAL_SEP, pattern.minFrac);
    },
];
