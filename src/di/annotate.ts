/**
 * Standalone `annotate` helper for the Dependency Injection module.
 *
 * Slice 4 scope: extracts the dependency-name list from an {@link Invokable}
 * by inspecting either its array-style annotation or its `$inject` property.
 * Function-parameter inference (parsing `fn.toString()`) is intentionally NOT
 * supported -- consumers must use one of the two explicit forms. The injector
 * method {@link Injector.annotate} will delegate to this helper in Slice 5.
 */

import { isArray, isFunction } from '@core/utils';

import type { Annotated, Invokable, InvokableArray } from './di-types';

/**
 * Extract the dependency name list from an {@link Invokable}.
 *
 * Supports two annotation styles:
 *
 * 1. **Array-style:** `['dep1', 'dep2', fn]` -- the dependency names are
 *    everything in the tuple except the last element (the function itself).
 * 2. **`$inject` property:** A function with `fn.$inject = ['dep1', 'dep2']`.
 *
 * **For classes**, the idiomatic TypeScript form is a `static readonly $inject`
 * class member -- semantically identical to `Class.$inject = [...]` at runtime
 * (both land on the constructor function as the same own property) but avoids
 * post-hoc casts in typed code:
 *
 * ```typescript
 * class UserService {
 *   static readonly $inject = ['logger'] as const;
 *   constructor(public logger: Logger) {}
 * }
 * ```
 *
 * The trailing `as const` is important: it preserves the literal tuple type so
 * that typed consumers (e.g. `TypedModule.service`) can infer the dependency
 * names rather than collapsing them to `string[]`.
 *
 * Function-parameter inference (parsing `fn.toString()` to read parameter
 * names) is intentionally NOT supported -- callers must use one of the two
 * explicit forms above. This keeps the annotation contract robust under
 * minification, which would otherwise rename parameters and silently break
 * dependency resolution.
 *
 * @param fn - The invokable to inspect.
 * @returns A readonly array of dependency names in declaration order.
 * @throws {Error} when `fn` is a plain function without a `$inject` property.
 * @throws {Error} when `fn` is neither an array nor a function.
 */
export function annotate(fn: Invokable) {
  if (isArray(fn)) {
    // Array-style annotation: ['dep1', 'dep2', fn]. The `InvokableArray` type
    // guarantees the trailing element is the function, so everything before
    // it is a dependency-name string. `slice(0, -1)` drops the function and
    // yields the dependency list as a fresh array.
    const tuple: InvokableArray = fn;
    return tuple.slice(0, -1) as readonly string[];
  }

  if (isFunction(fn)) {
    // Property-based annotation: `fn.$inject = ['dep1', 'dep2']`. We must
    // narrow through `Annotated` because `isFunction` returns the broad
    // `Function` type, which has no `$inject` property.
    const annotated = fn as Annotated<(...args: never[]) => unknown>;
    if (annotated.$inject !== undefined) {
      return annotated.$inject;
    }
    throw new Error(
      'Function has no $inject annotation. Use the array-style annotation ' +
        "(['dep1', 'dep2', fn]) or attach a $inject property to the function.",
    );
  }

  throw new Error(
    'Invalid invokable: expected a function with $inject or an array-style ' + 'annotation [...deps, fn].',
  );
}
