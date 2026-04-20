/**
 * Watch delegates used by `Scope.$watch` to specialize the registration
 * behavior of compiled expressions based on parser-derived flags.
 *
 * A "watch delegate" is a function that takes over from the default watcher
 * registration path for expressions with particular static properties --
 * e.g. a constant expression never changes, so it only needs to fire once.
 *
 * Mirrors the delegate pattern in AngularJS `parse.js` (see
 * `constantWatchDelegate`, `oneTimeWatchDelegate`, etc.).
 */

import type { Scope } from './scope';
import type { DeregisterFn, ListenerFn, WatchFn } from './scope-types';

/**
 * Shallow "all defined" check used by the literal one-time watch delegate to
 * decide when a literal expression has stabilized.
 *
 * A value is considered fully defined when:
 *   - it is not `undefined`, AND
 *   - for arrays: every top-level element is not `undefined`, AND
 *   - for plain objects: every top-level property value is not `undefined`.
 *
 * Nested literals are intentionally only inspected at their top level -- an
 * inner `[a, b]` is itself a fresh (non-undefined) array each evaluation, so
 * its own element-level defined-ness does not affect the outer stability
 * decision. Empty literals (`[]`, `{}`) stabilize immediately because
 * `Array.prototype.every`/`Object.values(...).every` over zero elements
 * returns `true`.
 *
 * Matches AngularJS `isAllDefined` at `src/ng/parse.js:1931`.
 */
function isAllDefined(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((v) => v !== undefined);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).every((v) => v !== undefined);
  }
  // Primitives that are not undefined count as defined.
  return true;
}

/**
 * One-shot watch delegate for constant expressions.
 *
 * Because a constant expression (no scope lookups, no function calls) can
 * never produce a different value, there is no benefit to keeping it in the
 * watcher list after the first digest. The listener fires once with the
 * evaluated value (as the dirty-check detects the transition from the
 * `initWatchVal` sentinel to the captured value) and the watcher is
 * immediately deregistered.
 *
 * The inner watch function is a plain function (not a string), so it carries
 * no flags and will not re-enter `constantWatchDelegate` from the recursive
 * `scope.$watch` call.
 *
 * Matches AngularJS `constantWatchDelegate` at `src/ng/parse.js:1939`.
 */
export function constantWatchDelegate<T>(
  scope: Scope,
  watchFn: WatchFn<Record<string, unknown>, T>,
  listenerFn: ListenerFn<T>,
  valueEq: boolean,
): DeregisterFn {
  const unwatch = scope.$watch(
    (s) => {
      // Deregister before returning the value so the watcher fires exactly
      // once, regardless of subsequent digest passes.
      unwatch();
      return watchFn(s);
    },
    listenerFn,
    valueEq,
  );
  return unwatch;
}

/**
 * One-time watch delegate for non-literal `::`-prefixed expressions.
 *
 * The listener fires on each dirty-check while the value remains `undefined`;
 * once the expression yields a defined value, the watcher is deregistered
 * AFTER the current digest completes (via `$$postDigest`). The post-digest
 * re-check guards against the edge case where the value briefly became
 * defined then reverted to `undefined` within the same digest cycle --
 * AngularJS keeps the watcher live in that case.
 *
 * The inner watch function is a plain function (not a string), so it carries
 * no flags and will not re-enter a delegate on the recursive `$watch` call.
 *
 * Matches AngularJS `oneTimeWatchDelegate` at `src/ng/parse.js:1894`.
 */
export function oneTimeWatchDelegate<T>(
  scope: Scope,
  watchFn: WatchFn<Record<string, unknown>, T>,
  listenerFn: ListenerFn<T>,
  valueEq: boolean,
): DeregisterFn {
  let lastValue: T | undefined;

  const unwatch = scope.$watch(
    (s) => {
      lastValue = watchFn(s);
      if (lastValue !== undefined) {
        scope.$$postDigest(() => {
          // Re-check: a value that briefly became defined then reverted to
          // undefined in the same digest should NOT deregister the watcher.
          if (lastValue !== undefined) {
            unwatch();
          }
        });
      }
      return lastValue;
    },
    listenerFn,
    valueEq,
  );

  return unwatch;
}

/**
 * One-time watch delegate for LITERAL `::`-prefixed expressions (array and
 * object literals).
 *
 * Identical in structure to {@link oneTimeWatchDelegate}, but uses a shallow
 * "all defined" check instead of a simple `!== undefined` test: the watcher
 * only deregisters once the literal AND every top-level element/property has
 * a defined value. This mirrors AngularJS behavior: `::[a, b]` should not
 * stabilize while `a` or `b` is still resolving to `undefined`.
 *
 * The inner watch function is a plain function (not a string), so it carries
 * no flags and will not re-enter a delegate on the recursive `$watch` call.
 *
 * Matches AngularJS `oneTimeLiteralWatchDelegate` at `src/ng/parse.js:1919`.
 */
export function oneTimeLiteralWatchDelegate<T>(
  scope: Scope,
  watchFn: WatchFn<Record<string, unknown>, T>,
  listenerFn: ListenerFn<T>,
  valueEq: boolean,
): DeregisterFn {
  let lastValue: T | undefined;

  const unwatch = scope.$watch(
    (s) => {
      lastValue = watchFn(s);
      if (isAllDefined(lastValue)) {
        scope.$$postDigest(() => {
          // Re-check: a literal that briefly became fully defined then had an
          // element/property revert to undefined within the same digest
          // should NOT deregister the watcher.
          if (isAllDefined(lastValue)) {
            unwatch();
          }
        });
      }
      return lastValue;
    },
    listenerFn,
    valueEq,
  );

  return unwatch;
}
