/**
 * `limitTo` — array / string / number truncation built-in filter.
 *
 * Returns a slice of an array, string, or number-coerced-to-string.
 * Positive `limit` keeps the first N items starting at `begin` (default
 * 0); negative `limit` keeps the last |N| items and ignores `begin`
 * (matching AngularJS — the asymmetry is intentional). `Infinity` and
 * `-Infinity` both return the entire input. Non-array, non-string,
 * non-number inputs (including `null`, plain objects) pass through
 * unchanged. The output is always a fresh array or fresh string —
 * `Array.prototype.slice` and `String.prototype.slice` allocate new
 * values, so the input is never mutated even when frozen.
 */

import type { Invokable } from '@di/di-types';

import type { FilterFn } from './filter-types';

const limitToFilter: FilterFn = (input, limitArg, beginArg) => {
  // Numeric input is coerced to its decimal string form, then re-entered
  // through the same dispatch — `12345 | limitTo:3` becomes `'123'`.
  if (typeof input === 'number') {
    return limitToFilter(String(input), limitArg, beginArg);
  }

  if (!Array.isArray(input) && typeof input !== 'string') {
    return input;
  }

  // `Number(undefined)` is `NaN`; treat any non-finite, non-Infinity
  // limit as "no slice" and return the input unchanged. AngularJS does
  // the same — a `NaN` limit is a usage error, not a transformation.
  const limit = Number(limitArg);
  if (Number.isNaN(limit)) {
    return input;
  }

  const length = input.length;
  // `Infinity` / `-Infinity` collapse to "every item"; the absolute-value
  // and sign handling below would otherwise compute Infinity-sized slices.
  if (!Number.isFinite(limit)) {
    return input.slice(0, length);
  }

  // `begin` is only meaningful for positive limits. AngularJS canonical:
  // negative limits always slice from the tail, ignoring any user-supplied
  // begin offset.
  if (limit >= 0) {
    const beginNum = Number(beginArg);
    const begin = Number.isFinite(beginNum) ? beginNum : 0;
    return input.slice(begin, begin + limit);
  }

  // Negative limit: keep the last |limit| items.
  return input.slice(Math.max(0, length + limit), length);
};

/**
 * Factory for the `limitTo` built-in filter.
 *
 * Stateless and dep-free. The returned filter function accepts up to
 * three positional arguments — `value`, `limit`, and (positive-limit
 * only) `begin`. Negative limits ignore `begin`; this matches
 * AngularJS 1.x behavior and is the basis for the FS §2.13 acceptance
 * criteria.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * $filter('limitTo')([1, 2, 3, 4, 5], 3);          // => [1, 2, 3]
 * $filter('limitTo')([1, 2, 3, 4, 5], -2);         // => [4, 5]
 * $filter('limitTo')('hello', 3);                  // => 'hel'
 * $filter('limitTo')([1, 2, 3, 4, 5], 2, 1);       // => [2, 3]
 * $filter('limitTo')(12345, 3);                    // => '123'
 * // Inside an expression / interpolation:
 * // {{ items | limitTo : pageSize : pageSize * (page - 1) }}
 * ```
 */
export const limitToFilterFactory: Invokable<FilterFn> = [() => limitToFilter];
