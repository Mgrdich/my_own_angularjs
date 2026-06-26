/**
 * `createInterval` — the `$interval` service: a repeating deferred task that
 * runs every `delay` milliseconds and reports its progress / final result as a
 * `$q` promise (FS §2.8). The repeating sibling of `$timeout` (`@async/timeout`),
 * sharing its seam shape, phase-guard, error-routing, and cancel-`Map` design.
 *
 * `$interval(fn, delay, count = 0, invokeApply = true, ...args)`:
 * - arms a REPEATING timer via the injected `setIntervalFn` seam (`setInterval`),
 * - on EACH tick increments an iteration counter and runs `fn(iteration, ...args)`
 *   PHASE-GUARDED — identical to `$timeout`: when `invokeApply` is `true` AND no
 *   digest is currently in flight (`rootPhase() === null`) the run happens inside
 *   `apply` (so bound content refreshes); when a digest is already running, or
 *   `invokeApply` is `false`, the run happens directly,
 * - after the run reports a progress notification carrying the iteration count
 *   via `deferred.notify(iteration)` (per-repetition progress),
 * - when `count > 0` and the iteration counter REACHES it, stops the timer
 *   (`clearIntervalFn`) and RESOLVES the promise with the final count;
 *   `count === 0` runs indefinitely and never self-settles,
 * - because `apply` is `try/finally`, NOT `try/catch` (`scope.ts`), each tick's
 *   run is wrapped in its OWN `try/catch` so a throw routes via
 *   `invokeExceptionHandler(exceptionHandler, err, '$interval')` — and, unlike
 *   `$timeout`, a throw does NOT settle the promise and does NOT auto-cancel:
 *   the interval keeps ticking (AngularJS parity).
 *
 * `$interval.cancel(promise)` stops the timer, REJECTS the promise (cancellation
 * signal), and returns `true`; cancelling an unknown / already-settled promise
 * returns `false` and does not throw. A per-factory `Map<QPromise, …>` backs
 * cancellation; the entry is cleaned on the count-cap resolve and on cancel.
 *
 * The factory is PURE — all digest / timer seams are injected, so it is
 * unit-testable without an injector. The DI factory on `ngModule` binds the
 * seams to the real `$rootScope` / global `setInterval` / `clearInterval`.
 */

import { invokeExceptionHandler } from '@exception-handler/index';
import type { QDeferred, QPromise } from '@async/q-types';
import type { IntervalOptions, IntervalService, TimerId } from '@async/async-types';

/**
 * Build the `$interval` service. See the file-level doc for the per-tick
 * progress, count-cap resolve, no-auto-cancel-on-throw, and phase-guard
 * contracts.
 *
 * The factory is PURE — every digest / timer seam is injected, so `$interval`
 * is exercisable with fake timers and stubs WITHOUT an injector. On `ngModule`
 * the DI factory binds `apply` to `$rootScope.$apply`, `rootPhase` to
 * `$rootScope.$$phase`, and `setIntervalFn` / `clearIntervalFn` to the global
 * `setInterval` / `clearInterval`.
 *
 * @param options - The injected `$q` engine + digest / timer / error seams.
 * @returns The callable `$interval` service carrying `.cancel`.
 *
 * @example
 * ```ts
 * const $interval = createInterval({
 *   q: $q,
 *   exceptionHandler: $exceptionHandler,
 *   apply: (fn) => $rootScope.$apply(fn),
 *   rootPhase: () => $rootScope.$$phase,
 *   setIntervalFn: (fn, delay) => setInterval(fn, delay),
 *   clearIntervalFn: (id) => clearInterval(id),
 * });
 *
 * // Run 3 times, then resolve with the final count; progress fires each tick.
 * const promise = $interval((iteration) => doWork(iteration), 1000, 3);
 * promise.then(
 *   (finalCount) => {
 *     // finalCount === 3
 *   },
 *   undefined,
 *   (iteration) => {
 *     // progress: 1, 2, 3
 *   },
 * );
 * $interval.cancel(promise); // stops further ticks — rejects with 'canceled'
 * ```
 */
export function createInterval(options: IntervalOptions): IntervalService {
  const { q, exceptionHandler, apply, rootPhase, setIntervalFn, clearIntervalFn } = options;

  /** Running-task registry backing `.cancel` — cleaned on count-cap resolve and on cancel. */
  const intervals = new Map<QPromise<unknown>, { deferred: QDeferred<number>; timerId: TimerId }>();

  function interval(
    fn: (iteration: number, ...args: never[]) => unknown,
    delay: number,
    count = 0,
    invokeApply = true,
    ...args: unknown[]
  ): QPromise<number> {
    const deferred = q.defer<number>();
    const { promise } = deferred;
    let iteration = 0;

    const onTick = (): void => {
      iteration += 1;

      const run = (): void => {
        fn(iteration, ...(args as never[]));
      };

      try {
        if (invokeApply && rootPhase() === null) {
          // Common path — no digest in flight: run inside an update cycle so
          // bound content the callback changed refreshes on its own (FS §2.8).
          apply(run);
        } else {
          // Either `invokeApply === false` (opt-out of the automatic refresh),
          // or a digest is already running (the tick fired mid-`$apply`, where
          // calling `apply` would throw '$digest already in progress'). Run
          // directly — the in-flight digest absorbs any progress propagation.
          run();
        }
      } catch (err: unknown) {
        // `apply` is `try/finally`, so a throw from `run` escapes it. Route the
        // throw through the central channel — but do NOT settle the promise and
        // do NOT stop the timer: the interval keeps ticking (AngularJS parity).
        invokeExceptionHandler(exceptionHandler, err, '$interval');
      }

      // Per-repetition progress — reported every tick, including the final one.
      deferred.notify(iteration);

      if (count > 0 && iteration >= count) {
        // Capped run complete — stop the timer and succeed with the final count.
        intervals.delete(promise as QPromise<unknown>);
        clearIntervalFn(timerId);
        deferred.resolve(iteration);
      }
    };

    const timerId = setIntervalFn(onTick, delay);
    intervals.set(promise as QPromise<unknown>, { deferred, timerId });

    return promise;
  }

  interval.cancel = (promise?: QPromise<unknown>): boolean => {
    if (promise === undefined) {
      return false;
    }
    const entry = intervals.get(promise);
    if (entry === undefined) {
      // Unknown or already-settled (count-capped / previously cancelled) — nothing to do.
      return false;
    }
    intervals.delete(promise);
    clearIntervalFn(entry.timerId);
    entry.deferred.reject('canceled');
    return true;
  };

  return interval as IntervalService;
}
