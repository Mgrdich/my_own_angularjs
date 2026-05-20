/**
 * `filter` — array filtering built-in.
 *
 * `array | filter : expression : comparator? : anyPropertyKey?`
 * returns a NEW array containing items from `array` that match
 * `expression`. The expression may be:
 *
 * - A string — case-insensitive substring match against ANY string
 *   property in the item (recursive through nested objects). A leading
 *   `!` negates the match.
 * - An object — each key matches against the item's same-named property
 *   (substring by default, strict if `comparator === true`, or via the
 *   user comparator function). The wildcard key (default `'$'`,
 *   overridable via the `anyPropertyKey` argument) matches against ANY
 *   property — equivalent to the string form.
 * - A function — used directly as a predicate.
 *
 * `comparator` selects the equality semantics:
 *
 * - `true` → strict equality (`===`) at every leaf.
 * - A function `(actual, expected) => boolean` → user-defined.
 * - Anything else → default case-insensitive substring match.
 *
 * Recursion is bounded by the EXPRESSION's structure, not the input's,
 * so circular item references do NOT cause infinite recursion (the
 * matcher walks the expression tree, which is finite). This matches
 * AngularJS's `filterFilter` exactly.
 *
 * Returns the input unchanged when `expression` is `undefined`, `null`,
 * or `''`, or when the input is not an array. Always returns a fresh
 * array — `Array.prototype.filter` allocates a new array, so the input
 * is never mutated even when frozen.
 */

import { isArray, isFunction, isObjectLike } from '@core/utils';
import type { Invokable } from '@di/di-types';

import type { FilterFn } from './filter-types';

type Comparator = (actual: unknown, expected: unknown) => boolean;
type Predicate = (item: unknown) => boolean;

const ANY_PROPERTY_KEY_DEFAULT = '$';

// Default substring matcher: case-insensitive `String.includes`. Returns
// `false` when either side is `null` / `undefined` so we don't fall into
// `String(null) === 'null'` and accidentally match the literal letter `l`.
// Both sides are coerced via `primitiveToString` — only string / number /
// boolean / bigint leaves participate in the match. Non-primitive `actual`
// values (e.g. plain objects) would `[object Object]`-stringify and produce
// spurious matches; we instead refuse the comparison and return `false`.
function primitiveToString(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

const defaultSubstringComparator: Comparator = (actual, expected) => {
  const actualStr = primitiveToString(actual);
  const expectedStr = primitiveToString(expected);
  if (actualStr === null || expectedStr === null) {
    return false;
  }
  return actualStr.toLowerCase().includes(expectedStr.toLowerCase());
};

const strictComparator: Comparator = (actual, expected) => actual === expected;

function resolveComparator(comparator: unknown) {
  if (comparator === true) {
    return strictComparator;
  }
  if (isFunction(comparator)) {
    return comparator as Comparator;
  }
  return defaultSubstringComparator;
}

/**
 * Recursive matcher. The branching mirrors AngularJS's
 * `deepCompare`: the expectation is the driver, the actual value is
 * walked down to a leaf where the comparator runs.
 *
 * `matchAgainstAnyProp` is set when the expectation arrived via the
 * wildcard (`anyPropertyKey`) lane — in that mode the matcher recurses
 * into the actual value's own properties, succeeding when ANY property
 * (recursively) matches.
 */
function deepCompare(
  actual: unknown,
  expected: unknown,
  comparator: Comparator,
  anyPropertyKey: string,
  matchAgainstAnyProp: boolean,
): boolean {
  // Predicate-as-expectation: invoke and coerce to boolean. (This is
  // reachable through nested object expressions whose value is a function.)
  if (isFunction(expected)) {
    return Boolean((expected as (value: unknown) => unknown)(actual));
  }

  // Object expectation — recurse per key.
  if (isObjectLike(expected) && !isFunction(expected)) {
    const expObj = expected;
    for (const key of Object.keys(expObj)) {
      const expectedValue = expObj[key];
      // Skip `undefined`-valued keys — AngularJS treats them as "no
      // constraint on this key" so an explicit `{ name: undefined }`
      // expression matches every item.
      if (expectedValue === undefined) continue;

      if (key === anyPropertyKey) {
        // Wildcard key — match against any property of the actual value
        // (recursively).
        if (!deepCompare(actual, expectedValue, comparator, anyPropertyKey, true)) {
          return false;
        }
      } else {
        // Per-key match: pull `actual[key]` and recurse with
        // wildcard-mode OFF (key-targeted match).
        const actualValue = isObjectLike(actual) ? actual[key] : undefined;
        if (!deepCompare(actualValue, expectedValue, comparator, anyPropertyKey, false)) {
          return false;
        }
      }
    }
    return true;
  }

  // Primitive expectation. In wildcard mode, walk into the actual value's
  // own properties — the expression matches if ANY (recursive) property
  // satisfies the comparator. Outside wildcard mode, run the comparator
  // directly against the actual leaf.
  if (matchAgainstAnyProp && isObjectLike(actual)) {
    const actualObj = actual;
    for (const key of Object.keys(actualObj)) {
      if (deepCompare(actualObj[key], expected, comparator, anyPropertyKey, true)) {
        return true;
      }
    }
    return false;
  }

  return comparator(actual, expected);
}

function buildPredicate(expression: unknown, comparator: Comparator, anyPropertyKey: string): Predicate {
  // Function expression — use as predicate directly. The first argument
  // is the item; second/third are index/array (matches Array.filter).
  if (isFunction(expression)) {
    return expression as Predicate;
  }

  // String expression with `!` prefix → strip and negate the inner
  // wildcard match. The negation only applies at the top level — `!` is
  // not recognized inside object expressions.
  if (typeof expression === 'string' && expression.startsWith('!')) {
    const stripped = expression.slice(1);
    const inner = buildPredicate(stripped, comparator, anyPropertyKey);
    return (item) => !inner(item);
  }

  // Primitive expression (string / number / boolean) — wrap as a
  // wildcard match against any property.
  if (typeof expression === 'string' || typeof expression === 'number' || typeof expression === 'boolean') {
    return (item) => deepCompare(item, expression, comparator, anyPropertyKey, true);
  }

  // Object expression — match every key. Pre-compute whether the
  // expression itself contains the wildcard so the `matchAgainstAnyProp`
  // mode is set correctly at the entry point. (deepCompare handles per-key
  // dispatch internally; the predicate just hands the item in.)
  return (item) => deepCompare(item, expression, comparator, anyPropertyKey, false);
}

const filterFilter: FilterFn = (input, expression, comparator, anyPropertyKey) => {
  // Early bail: non-array input and no-op expressions both pass through.
  if (!isArray(input)) {
    return input;
  }
  if (expression === undefined || expression === null || expression === '') {
    return input;
  }

  const resolvedComparator = resolveComparator(comparator);
  const resolvedAnyPropertyKey = typeof anyPropertyKey === 'string' ? anyPropertyKey : ANY_PROPERTY_KEY_DEFAULT;
  const predicate = buildPredicate(expression, resolvedComparator, resolvedAnyPropertyKey);

  return input.filter((item) => predicate(item));
};

/**
 * Factory for the `filter` built-in. Stateless and dep-free.
 *
 * The returned filter accepts up to four positional arguments — `input`,
 * `expression`, `comparator`, `anyPropertyKey` — per FS §2.11. Returns
 * a new array; never mutates the input.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * const users = [{ name: 'Adam' }, { name: 'Beth' }];
 * $filter('filter')(users, 'a');                        // => [{ name: 'Adam' }]
 * $filter('filter')(users, '!Adam');                    // => [{ name: 'Beth' }]
 * $filter('filter')(users, { name: 'Adam' });           // => [{ name: 'Adam' }]
 * $filter('filter')(users, { $: 'Adam' });              // wildcard key — any prop
 * $filter('filter')(users, (u) => u.name === 'Adam');   // predicate function
 * $filter('filter')([{n:'Adam'},{n:'Adamantium'}], { n: 'Adam' }, true);
 * //                                                    // => [{ n: 'Adam' }] (strict)
 * // Inside an expression / interpolation:
 * // {{ users | filter : query }}
 * ```
 */
export const filterFilterFactory: Invokable<FilterFn> = [() => filterFilter];
