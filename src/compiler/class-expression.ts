/**
 * `flattenClassExpression` — normalize the three `ng-class` expression
 * forms (string / array / object) into a single class-name set
 * (spec 024 Slice 1 / technical-considerations §2.1).
 *
 * Used by the `ng-class*` directives (`ng-class`, and the Slice 2
 * additions `ng-class-even` / `ng-class-odd`) as the shared front-end
 * that converts whatever the user wrote in their `ng-class="…"`
 * attribute into the concrete set of class names to apply.
 *
 * The helper is module-private — exported only for the
 * `ng-class*` directives in `src/compiler/ng-class.ts` and the
 * accompanying unit tests. It is NOT exported from
 * `@compiler/index` (same DI-registration-only precedent as the
 * directive factories themselves).
 *
 * **Form dispatch.**
 *
 * - **String** — `value.trim().split(/\s+/)`. Empty / whitespace-only
 *   strings return an empty set; otherwise each non-empty token is a
 *   set entry.
 * - **Array** — each element is classified recursively. String
 *   elements follow the string-form rule; plain-object elements follow
 *   the object-form rule (only truthy keys included). All other
 *   element types (numbers, booleans, functions, `null`, `undefined`,
 *   nested arrays) are ignored.
 * - **Object** — for every own key, include the key in the set when
 *   its value is truthy. Falsy values exclude the key.
 *
 * **Edge cases.** Inputs that are not one of the three accepted forms
 * — `null`, `undefined`, numbers, booleans, functions — return a fresh
 * empty `Set` without throwing. The helper is total and synchronous.
 *
 * **Purity.** A fresh `Set<string>` is returned on every call; the
 * helper never mutates its input. Callers may freely mutate the
 * returned set.
 *
 * @example String form
 * ```ts
 * flattenClassExpression('active');           // Set { 'active' }
 * flattenClassExpression('foo bar baz');      // Set { 'foo', 'bar', 'baz' }
 * flattenClassExpression('  foo   bar  ');    // Set { 'foo', 'bar' } — whitespace collapsed
 * flattenClassExpression('');                 // Set {} — empty string returns empty set
 * ```
 *
 * @example Array form
 * ```ts
 * flattenClassExpression(['selected', 'primary']);
 * // Set { 'selected', 'primary' }
 *
 * flattenClassExpression(['a', { active: true, error: false }, 'extra']);
 * // Set { 'a', 'active', 'extra' } — object element follows object-form rule
 *
 * flattenClassExpression([]);                 // Set {} — empty array
 * ```
 *
 * @example Object form
 * ```ts
 * flattenClassExpression({ active: true, error: false, primary: 1 });
 * // Set { 'active', 'primary' } — only truthy values included
 *
 * flattenClassExpression({});                 // Set {} — no keys
 * ```
 *
 * @example Non-form inputs return an empty set
 * ```ts
 * flattenClassExpression(null);               // Set {}
 * flattenClassExpression(undefined);          // Set {}
 * flattenClassExpression(42);                 // Set {}
 * flattenClassExpression(() => 'foo');        // Set {}
 * flattenClassExpression(true);               // Set {}
 * ```
 */

import { isPlainObject } from '@core/index';

function collectStringForm(value: string, out: Set<string>) {
  const trimmed = value.trim();
  if (trimmed === '') {
    return;
  }
  for (const token of trimmed.split(/\s+/)) {
    if (token !== '') {
      out.add(token);
    }
  }
}

function collectObjectForm(value: Record<string, unknown>, out: Set<string>) {
  for (const key of Object.keys(value)) {
    if (value[key]) {
      out.add(key);
    }
  }
}

export function flattenClassExpression(value: unknown) {
  const result = new Set<string>();
  if (typeof value === 'string') {
    collectStringForm(value, result);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) {
      if (typeof item === 'string') {
        collectStringForm(item, result);
      } else if (isPlainObject(item)) {
        collectObjectForm(item, result);
      }
      // Other element types (numbers, booleans, functions, null,
      // undefined, nested arrays) are silently ignored per
      // technical-considerations §2.1.
    }
    return result;
  }
  if (isPlainObject(value)) {
    collectObjectForm(value, result);
    return result;
  }
  // `null` / `undefined` / numbers / booleans / functions — return the
  // fresh empty set.
  return result;
}
