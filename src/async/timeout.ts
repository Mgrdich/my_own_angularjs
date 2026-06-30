/**
 * `createTimeout` — the `$timeout` service: a one-off deferred task that runs
 * after an optional delay and reports its result as a `$q` promise (FS §2.7).
 *
 * `$timeout(fn?, delay = 0, invokeApply = true, ...args)`:
 * - arms a timer via the injected `defer` seam (`setTimeout`),
 * - on fire runs `fn(...args)` PHASE-GUARDED: when `invokeApply` is `true` AND
 *   no digest is currently in flight (`rootPhase() === null`) the run happens
 *   inside `apply` (so bound content refreshes); when a digest is already
 *   running the run happens directly (the in-flight digest absorbs the
 *   resolution — calling `apply` would throw '$digest already in progress');
 *   when `invokeApply` is `false` the run happens directly with NO automatic
 *   refresh,
 * - resolves the promise with `fn`'s return value, or — because `apply` is
 *   `try/finally`, NOT `try/catch` (`scope.ts`) — wraps the run in its OWN
 *   `try/catch` so a throw both REJECTS the promise AND routes via
 *   `invokeExceptionHandler(exceptionHandler, err, '$timeout')`.
 *
 * `$timeout.cancel(promise)` clears the pending timer, REJECTS the promise
 * (cancellation signal), and returns `true`; cancelling an unknown / already
 * settled promise returns `false` and does not throw. A per-factory
 * `Map<QPromise, TimerId>` backs cancellation; the entry is cleaned on fire and
 * on cancel.
 *
 * The factory is PURE — all digest / timer seams are injected, so it is
 * unit-testable without an injector. The DI factory on `ngModule` binds the
 * seams to the real `$rootScope` / global timers.
 */

import { invokeExceptionHandler } from '@exception-handler/index';
import type { QDeferred, QPromise } from '@async/q-types';
import type { TimeoutOptions, TimeoutService, TimerId } from '@async/async-types';

/**
 * Build the `$timeout` service. See the file-level doc for the phase-guard and
 * error-routing contract.
 *
 * The factory is PURE — every digest / timer seam is injected, so `$timeout`
 * is exercisable with fake timers and stubs WITHOUT an injector. On `ngModule`
 * the DI factory binds `apply` to `$rootScope.$apply`, `rootPhase` to
 * `$rootScope.$$phase`, and `defer` / `cancelDefer` to the global
 * `setTimeout` / `clearTimeout`.
 *
 * @param options - The injected `$q` engine + digest / timer / error seams.
 * @returns The callable `$timeout` service carrying `.cancel`.
 *
 * @example
 * ```ts
 * const $timeout = createTimeout({
 *   q: $q,
 *   exceptionHandler: $exceptionHandler,
 *   apply: (fn) => $rootScope.$apply(fn),
 *   rootPhase: () => $rootScope.$$phase,
 *   defer: (fn, delay) => setTimeout(fn, delay),
 *   cancelDefer: (id) => clearTimeout(id),
 * });
 *
 * const promise = $timeout(() => 'done', 1000);
 * promise.then((result) => {
 *   // result === 'done'
 * });
 * $timeout.cancel(promise); // true if still pending — rejects with 'canceled'
 * ```
 */
export function createTimeout(options: TimeoutOptions): TimeoutService {
  const { q, exceptionHandler, apply, rootPhase, defer, cancelDefer } = options;

  /** Pending-task registry backing `.cancel` — cleaned on fire and on cancel. */
  const deferreds = new Map<QPromise<unknown>, { deferred: QDeferred<unknown>; timerId: TimerId }>();

  function timeout<T = unknown>(
    fn?: (...args: never[]) => T,
    delay = 0,
    invokeApply = true,
    ...args: unknown[]
  ): QPromise<T> {
    const deferred = q.defer<T>();
    const { promise } = deferred;

    const onFire = (): void => {
      // The task has fired — it is no longer cancellable, so drop the entry
      // BEFORE running so a `cancel` from inside `fn` is a clean no-op.
      deferreds.delete(promise);

      const run = (): void => {
        deferred.resolve(fn ? fn(...(args as never[])) : (undefined as T));
      };

      try {
        if (invokeApply && rootPhase() === null) {
          // Common path — no digest in flight: run inside an update cycle so
          // bound content the callback changed refreshes on its own (FS §2.7).
          apply(run);
        } else {
          // Either `invokeApply === false` (opt-out of the automatic refresh),
          // or a digest is already running (the timer fired mid-`$apply`, where
          // calling `apply` would throw '$digest already in progress'). Run
          // directly. On the mid-digest path the in-flight digest absorbs the
          // resolution; on the idle opt-out path resolving the promise still
          // schedules its OWN digest via `$q`'s `scheduleDigest` seam, draining
          // the continuations — but no extra `apply` is forced here, which is
          // what FS §2.7's "no automatic refresh" opt-out means for the
          // callback body itself.
          run();
        }
      } catch (err: unknown) {
        // `apply` is `try/finally`, so a throw from `run` escapes it. Reject the
        // promise AND route the throw through the central channel.
        deferred.reject(err);
        invokeExceptionHandler(exceptionHandler, err, '$timeout');
      }
    };

    const timerId = defer(onFire, delay);
    deferreds.set(promise as QPromise<unknown>, { deferred: deferred as QDeferred<unknown>, timerId });

    return promise;
  }

  timeout.cancel = (promise?: QPromise<unknown>): boolean => {
    if (promise === undefined) {
      return false;
    }
    const entry = deferreds.get(promise);
    if (entry === undefined) {
      // Unknown or already-settled (fired / previously cancelled) — nothing to do.
      return false;
    }
    deferreds.delete(promise);
    cancelDefer(entry.timerId);
    entry.deferred.reject('canceled');
    return true;
  };

  return timeout as TimeoutService;
}
