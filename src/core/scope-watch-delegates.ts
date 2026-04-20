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
