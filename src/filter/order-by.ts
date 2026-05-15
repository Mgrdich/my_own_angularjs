/**
 * `orderBy` — array sorting built-in filter.
 *
 * `array | orderBy : expression : reverse? : comparator?` returns a NEW
 * array sorted by `expression`. The expression may be:
 *
 * - A string — interpreted as a property name on each item, with an
 *   optional leading `+`/`-` to control direction (`'+name'` is explicit
 *   ascending, `'-name'` is descending). The empty string `''` and the
 *   bare prefixes `'+'` / `'-'` sort by the item itself.
 * - A function — invoked once per item to produce the sort key.
 * - An array of the above — primary by the first predicate, ties broken
 *   by the second, and so on.
 *
 * `reverse` (boolean) flips the entire sort order at the end. `comparator`
 * (function) replaces the default comparison and receives `(a, b)` keys
 * directly, returning `-1 / 0 / 1`.
 *
 * Default comparison (matches AngularJS `orderByFilter`):
 *
 * - Numbers are compared numerically.
 * - Strings are compared case-insensitively (lowercase + `<`/`>`).
 * - `null` and `undefined` always sort to the END regardless of
 *   ascending / descending direction (`undefined` ranks higher than
 *   `null`).
 * - Mixed types fall back to `typeof` precedence — type names are
 *   compared lexically (`'boolean' < 'number' < 'object' < 'string'` in
 *   ASCII order).
 * - Objects with no `valueOf` / custom `toString` fall back to their
 *   original input position (preserves stable ordering across object
 *   keys).
 *
 * Stability: items with equal sort keys retain their relative order.
 * Implementation uses the Schwartzian decorate-sort-undecorate pattern
 * with an explicit index tie-breaker, so the result is deterministic
 * even under engines whose `Array.prototype.sort` is non-stable on
 * mixed primitive / object arrays.
 *
 * Always returns a fresh array — `Array.prototype.map` (the undecorate
 * step) allocates a new array, so frozen inputs are safe. Non-array
 * input passes through unchanged.
 */

import { isArray, isFunction } from '@core/utils';
import type { Invokable } from '@di/di-types';

import type { FilterFn } from './filter-types';

type Getter = (item: unknown) => unknown;
type ResolvedPredicate = { readonly getter: Getter; readonly descending: 1 | -1 };
type CompareFn = (a: ComparisonValue, b: ComparisonValue) => number;

/**
 * The opaque "ordering key" attached to each item by the decoration
 * pass. The shape mirrors AngularJS exactly so user-supplied
 * comparators receive identically-shaped values.
 *
 * - `value` — the result of the predicate getter, optionally coerced
 *   from a custom-`valueOf`/`toString` object back to a primitive.
 * - `type` — `typeof value`, except `null` is reported as `'null'` to
 *   distinguish it from objects.
 * - `index` — the item's original input position; the tie-breaker.
 */
type ComparisonValue = {
  readonly value: unknown;
  readonly type: string;
  readonly index: number;
};

const IDENTITY: Getter = (item) => item;

/**
 * Walk a string predicate's leading `+`/`-` direction prefix and
 * produce a property-getter for the rest. Empty rest (`''` after
 * stripping, or the original empty string) produces the identity
 * getter, matching `'+'` / `'-'` / `''` semantics.
 */
function buildStringPredicate(predicate: string): ResolvedPredicate {
  let descending: 1 | -1 = 1;
  let propertyName = predicate;

  const firstChar = predicate.charAt(0);
  if (firstChar === '+' || firstChar === '-') {
    descending = firstChar === '-' ? -1 : 1;
    propertyName = predicate.substring(1);
  }

  if (propertyName === '') {
    return { getter: IDENTITY, descending };
  }

  // Bare property-name getter. Nested-path expressions (`'address.city'`)
  // are intentionally NOT supported here — FS §2.12 scopes the string
  // form to a flat property name. Users with nested keys reach for the
  // function form.
  const getter: Getter = (item) => {
    if (item === null || item === undefined) return undefined;
    if (typeof item !== 'object' && typeof item !== 'function') return undefined;
    return (item as Record<string, unknown>)[propertyName];
  };

  return { getter, descending };
}

/**
 * Normalize a single predicate into the unified `{ getter, descending }`
 * shape. Strings go through `buildStringPredicate`; functions wrap
 * directly; anything else collapses to identity (matches AngularJS,
 * which silently treats unrecognized predicates as identity).
 */
function buildPredicate(predicate: unknown): ResolvedPredicate {
  if (isFunction(predicate)) {
    return { getter: predicate as Getter, descending: 1 };
  }
  if (typeof predicate === 'string') {
    return buildStringPredicate(predicate);
  }
  return { getter: IDENTITY, descending: 1 };
}

/**
 * Resolve the user-facing `expression` argument into a list of
 * `ResolvedPredicate`s. Single non-array predicates wrap into a
 * one-element list; an empty list (`[]` or undefined) defaults to
 * `[+]`, the identity-ascending predicate.
 */
function normalizePredicates(expression: unknown): ResolvedPredicate[] {
  const list = isArray(expression) ? [...expression] : [expression];
  if (list.length === 0) {
    return [{ getter: IDENTITY, descending: 1 }];
  }
  return list.map(buildPredicate);
}

/**
 * If `value` is a plain object with a non-default `valueOf` or
 * `toString`, attempt to coerce it to a primitive. Otherwise return
 * the value unchanged — the default comparator falls back to the
 * original input index for object values.
 */
function objectValue(value: object) {
  // Custom valueOf — invoke and accept its primitive result.
  const valueOf = (value as { valueOf?: unknown }).valueOf;
  if (typeof valueOf === 'function') {
    const primitive: unknown = (valueOf as () => unknown).call(value);
    if (isPrimitive(primitive)) return primitive;
  }

  // Custom toString (NOT the inherited Object.prototype.toString) —
  // invoke and accept its primitive result. The "is custom" test
  // compares the own-property toString against the value's prototype
  // toString; if they differ, the type defines a custom override.
  const toString = (value as { toString?: unknown }).toString;
  if (typeof toString === 'function' && hasCustomToString(value, toString)) {
    const stringified: unknown = (toString as () => unknown).call(value);
    if (isPrimitive(stringified)) return stringified;
  }

  return value;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- comparing function references for identity, not invoking
function hasCustomToString(value: object, ownToString: Function) {
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto === null) {
    // No prototype — any function-typed `toString` is by definition
    // user-defined, so treat it as custom.
    return true;
  }
  const inherited = (proto as { toString?: unknown }).toString;
  return ownToString !== inherited;
}

function isPrimitive(value: unknown): value is number | string | boolean {
  switch (typeof value) {
    case 'number':
    case 'string':
    case 'boolean':
      return true;
    default:
      return false;
  }
}

/** True when the predicate-value type tag is `'null'` or `'undefined'`. */
function isNullishType(type: string) {
  return type === 'null' || type === 'undefined';
}

/**
 * Tag `(value, index)` with its `typeof` (with `null` reported as
 * `'null'` to keep it distinguishable from objects). Object-valued
 * predicate results are coerced via `objectValue` so a custom
 * `valueOf` / `toString` participates in the comparison.
 */
function getPredicateValue(value: unknown, index: number) {
  let type: string = typeof value;
  let coerced = value;
  if (value === null) {
    type = 'null';
  } else if (typeof value === 'object') {
    coerced = objectValue(value);
  }
  return { value: coerced, type, index };
}

/**
 * The default `(a, b) => -1/0/1` comparator. Mirrors AngularJS's
 * `defaultCompare` exactly:
 *
 * 1. Different types — `undefined` and `null` sort to the END;
 *    otherwise type names compare lexically.
 * 2. Same string types — case-insensitive lowercase comparison.
 * 3. Same object types with no primitive coercion — fall back to the
 *    original input index.
 * 4. Otherwise — `===` for equality; `<` / `>` for direction.
 */
const defaultCompare: CompareFn = (v1, v2) => {
  const type1 = v1.type;
  const type2 = v2.type;

  if (type1 !== type2) {
    if (type1 === 'undefined') return 1;
    if (type2 === 'undefined') return -1;
    if (type1 === 'null') return 1;
    if (type2 === 'null') return -1;
    return type1 < type2 ? -1 : 1;
  }

  let value1: unknown = v1.value;
  let value2: unknown = v2.value;

  if (type1 === 'string') {
    value1 = (value1 as string).toLowerCase();
    value2 = (value2 as string).toLowerCase();
  } else if (type1 === 'object') {
    // Two objects whose `valueOf`/`toString` did not yield a primitive —
    // fall back to original input index so the order is deterministic.
    value1 = v1.index;
    value2 = v2.index;
  }

  if (value1 === value2) return 0;
  // `<` is well-defined for matching primitive types (number, string,
  // boolean, bigint). For the object-fallback path above we already
  // substituted the numeric index, so this branch is reachable only
  // with comparable primitives.
  return (value1 as number | string) < (value2 as number | string) ? -1 : 1;
};

const orderByFilter: FilterFn = (input, expression, reverse, comparator) => {
  // Non-array input passes through unchanged. Frozen-input safe — the
  // decoration / sort pipeline below allocates a fresh array, so the
  // input is never mutated even when this branch is skipped.
  if (!isArray(input)) {
    return input;
  }

  const predicates = normalizePredicates(expression);
  const direction = reverse === true ? -1 : 1;
  const compare: CompareFn = isFunction(comparator) ? (comparator as unknown as CompareFn) : defaultCompare;

  // Decorate: tag each item with its predicate values + original index.
  // The index tie-breaker is what gives this implementation a stable
  // sort guarantee even on engines whose native `Array.prototype.sort`
  // is unstable for the input shape.
  type Decorated = {
    readonly value: unknown;
    readonly tieBreaker: ComparisonValue;
    readonly predicateValues: ReadonlyArray<ComparisonValue>;
  };

  const decorated: Decorated[] = input.map(
    (value, index): Decorated => ({
      value,
      tieBreaker: { value: index, type: 'number', index },
      predicateValues: predicates.map((predicate) => getPredicateValue(predicate.getter(value), index)),
    }),
  );

  decorated.sort((a, b) => {
    for (let i = 0; i < predicates.length; i++) {
      const predicate = predicates[i];
      const aValue = a.predicateValues[i];
      const bValue = b.predicateValues[i];
      // `predicates`, `a.predicateValues`, and `b.predicateValues` are
      // all the same length by construction; the indexed reads are safe
      // under `noUncheckedIndexedAccess` once narrowed.
      if (predicate === undefined || aValue === undefined || bValue === undefined) continue;
      const result = compare(aValue, bValue);
      if (result !== 0) {
        // FS §2.12 acceptance 8: `null`/`undefined` always sort to the
        // END regardless of ascending/descending direction. Detect that
        // case and skip the direction multipliers so the "send to end"
        // verdict is preserved under reverse / `-` prefix.
        if (isNullishType(aValue.type) || isNullishType(bValue.type)) {
          return result;
        }
        return result * predicate.descending * direction;
      }
    }
    // All predicates tied — fall through to the original-index tie-breaker.
    // Use the user-supplied comparator first (for parity with AngularJS,
    // which exposes the tie-breaker to custom comparators); if it also
    // returns 0, force determinism via the default comparator on the
    // numeric indices.
    const tieResult = compare(a.tieBreaker, b.tieBreaker);
    return (tieResult !== 0 ? tieResult : defaultCompare(a.tieBreaker, b.tieBreaker)) * direction;
  });

  return decorated.map((d) => d.value);
};

/**
 * Factory for the `orderBy` built-in filter. Stateless and dep-free.
 *
 * The returned filter accepts up to four positional arguments —
 * `input`, `expression`, `reverse`, `comparator` — per FS §2.12.
 * Returns a NEW array; never mutates the input.
 *
 * @example
 * ```ts
 * const $filter = injector.get('$filter');
 * const users = [
 *   { name: 'Beth', age: 30 },
 *   { name: 'Adam', age: 25 },
 *   { name: 'Carl', age: 25 },
 * ];
 *
 * // String predicate — ascending by `name`.
 * $filter('orderBy')(users, 'name');
 * // => [{ name: 'Adam', ... }, { name: 'Beth', ... }, { name: 'Carl', ... }]
 *
 * // `-` prefix — descending.
 * $filter('orderBy')(users, '-name');
 *
 * // Array of predicates — primary `age` ascending, ties by `name`.
 * $filter('orderBy')(users, ['age', 'name']);
 *
 * // Function predicate — sort by computed key.
 * $filter('orderBy')(users, (u: { name: string }) => u.name.toLowerCase());
 *
 * // `reverse` argument flips the entire result.
 * $filter('orderBy')(users, 'name', true);
 *
 * // Custom comparator — receives `(a, b)` value-shape objects.
 * $filter('orderBy')(users, 'name', false, (a, b) =>
 *   String(a.value).localeCompare(String(b.value)),
 * );
 * // Inside an expression / interpolation:
 * // ng-repeat="user in users | orderBy:'-age':false"
 * ```
 */
export const orderByFilterFactory: Invokable<FilterFn> = [() => orderByFilter];
