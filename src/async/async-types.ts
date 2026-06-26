/**
 * Public type surface and injected-seam shapes for the timer-based async
 * services (`$timeout` in this slice; `$interval` in Slice 4).
 *
 * Both services compose the `$q` promise engine (`@async/q`): a scheduled task
 * settles a `$q` deferred and refreshes bound content via the framework's
 * update cycle. The pure factories (`createTimeout` / `createInterval`) take
 * their digest / timer seams as options so they are unit-testable WITHOUT an
 * injector; the DI factories on `ngModule` bind those seams to the real
 * `$rootScope` / global timers (FS §2.7).
 */

import type { ScopePhase } from '@core/index';
import type { ExceptionHandler } from '@exception-handler/index';
import type { QPromise, QService } from '@async/q-types';

/**
 * The opaque handle a `defer` (`setTimeout`) call returns and `cancelDefer`
 * (`clearTimeout`) consumes. Derived from the global `setTimeout` so it is
 * environment-correct (`number` in browsers, `NodeJS.Timeout` in Node) without
 * a hand-picked alias.
 *
 * `setInterval` returns the SAME type as `setTimeout` in every supported
 * environment, so `$interval` reuses this alias for its repeating timer handle
 * (`createInterval`'s `setIntervalFn` / `clearIntervalFn` seams) rather than
 * introducing a near-duplicate `IntervalId`.
 *
 * @example
 * ```ts
 * const id: TimerId = setTimeout(() => {}, 0);
 * clearTimeout(id);
 * ```
 */
export type TimerId = ReturnType<typeof setTimeout>;

/**
 * Injected seams for the pure {@link createTimeout} factory. The DI factory on
 * `ngModule` binds these to the real `$rootScope` / global timers /
 * `$exceptionHandler`; unit tests inject lightweight stand-ins (or vitest fake
 * timers via the real registration) so the factory is exercisable without an
 * injector.
 *
 * @example
 * ```ts
 * const options: TimeoutOptions = {
 *   q: $q,
 *   exceptionHandler: $exceptionHandler,
 *   apply: (fn) => $rootScope.$apply(fn),
 *   rootPhase: () => $rootScope.$$phase,
 *   defer: (fn, delay) => setTimeout(fn, delay),
 *   cancelDefer: (id) => clearTimeout(id),
 * };
 * const $timeout = createTimeout(options);
 * ```
 */
export interface TimeoutOptions {
  /** The `$q` promise engine — `$timeout` settles a `$q` deferred per call. */
  q: QService;
  /** Central error-reporting channel — a callback throw routes here, cause `'$timeout'`. */
  exceptionHandler: ExceptionHandler;
  /**
   * Seam onto `$rootScope.$apply` — runs the callback inside a digest when no
   * digest is currently in flight (the `invokeApply` + idle-phase path).
   */
  apply: (fn: () => void) => void;
  /**
   * Seam onto `$rootScope.$$phase` — read before `apply` so a fire arriving
   * mid-digest avoids the `'$digest already in progress'` throw.
   */
  rootPhase: () => ScopePhase;
  /** Seam onto the global `setTimeout` — arms the deferred task's timer. */
  defer: (fn: () => void, delay: number) => TimerId;
  /** Seam onto the global `clearTimeout` — cancels a pending timer. */
  cancelDefer: (id: TimerId) => void;
}

/**
 * The `$timeout` service surface — a callable scheduling a one-off deferred
 * task, carrying `.cancel` as an own property (FS §2.7).
 *
 * @example
 * ```ts
 * const $timeout: TimeoutService = injector.get('$timeout');
 *
 * const promise = $timeout(() => 'done', 1000);
 * promise.then((result) => {
 *   // result === 'done'
 * });
 *
 * // Opt out of the automatic refresh + pass extra args through:
 * $timeout((a, b) => use(a, b), 500, false, 'a', 'b');
 *
 * $timeout.cancel(promise); // true if pending — rejects with 'canceled'
 * ```
 */
export interface TimeoutService {
  /**
   * Schedule `fn` to run once after `delay` milliseconds. Hands back a promise
   * that succeeds with `fn`'s return value once it runs (or fails if `fn`
   * throws). By default the run happens inside an update cycle so bound content
   * refreshes; pass `invokeApply = false` to opt out of the automatic refresh.
   * Extra `args` are passed through to `fn`.
   *
   * @typeParam T - The value `fn` returns (and the promise succeeds with).
   * @param fn - The unit of work to run after the delay (optional — omitting it schedules a bare delay).
   * @param delay - Milliseconds to wait before running (default `0`).
   * @param invokeApply - Whether to run inside an update cycle (default `true`).
   * @param args - Extra inputs passed through to `fn`.
   * @returns A promise that settles with `fn`'s result.
   */
  <T = unknown>(fn?: (...args: never[]) => T, delay?: number, invokeApply?: boolean, ...args: unknown[]): QPromise<T>;

  /**
   * Cancel a pending task scheduled by this service. Clears the timer, fails
   * the task's promise to signal cancellation, and returns `true`. Cancelling
   * an already-run / already-cancelled / unknown promise returns `false` and
   * does not throw.
   *
   * @param promise - The promise returned by a prior `$timeout(...)` call.
   * @returns `true` if a pending task was cancelled, `false` otherwise.
   */
  cancel(promise?: QPromise<unknown>): boolean;
}

/**
 * Injected seams for the pure {@link createInterval} factory — the `$interval`
 * sibling of {@link TimeoutOptions}. The DI factory on `ngModule` binds these to
 * the real `$rootScope` / global `setInterval` / `clearInterval` /
 * `$exceptionHandler`; unit tests inject stand-ins (or vitest fake timers via
 * the real registration) so the factory is exercisable without an injector.
 *
 * @example
 * ```ts
 * const options: IntervalOptions = {
 *   q: $q,
 *   exceptionHandler: $exceptionHandler,
 *   apply: (fn) => $rootScope.$apply(fn),
 *   rootPhase: () => $rootScope.$$phase,
 *   setIntervalFn: (fn, delay) => setInterval(fn, delay),
 *   clearIntervalFn: (id) => clearInterval(id),
 * };
 * const $interval = createInterval(options);
 * ```
 */
export interface IntervalOptions {
  /** The `$q` promise engine — `$interval` settles a `$q` deferred per call. */
  q: QService;
  /** Central error-reporting channel — a callback throw routes here, cause `'$interval'`. */
  exceptionHandler: ExceptionHandler;
  /**
   * Seam onto `$rootScope.$apply` — runs each tick inside a digest when no
   * digest is currently in flight (the `invokeApply` + idle-phase path).
   */
  apply: (fn: () => void) => void;
  /**
   * Seam onto `$rootScope.$$phase` — read before `apply` so a tick arriving
   * mid-digest avoids the `'$digest already in progress'` throw.
   */
  rootPhase: () => ScopePhase;
  /** Seam onto the global `setInterval` — arms the repeating timer. */
  setIntervalFn: (fn: () => void, delay: number) => TimerId;
  /** Seam onto the global `clearInterval` — stops a repeating timer. */
  clearIntervalFn: (id: TimerId) => void;
}

/**
 * The `$interval` service surface — a callable scheduling a repeating deferred
 * task, carrying `.cancel` as an own property (FS §2.8).
 *
 * @example
 * ```ts
 * const $interval: IntervalService = injector.get('$interval');
 *
 * // Run 3 times then resolve with the final count; progress fires each tick.
 * const promise = $interval((iteration) => use(iteration), 1000, 3);
 * promise.then(
 *   (finalCount) => {
 *     // finalCount === 3
 *   },
 *   undefined,
 *   (iteration) => {
 *     // progress: 1, 2, 3
 *   },
 * );
 *
 * $interval.cancel(promise); // stops further ticks — rejects with 'canceled'
 * ```
 */
export interface IntervalService {
  /**
   * Schedule `fn` to run repeatedly every `delay` milliseconds. Hands back a
   * promise that reports a progress notification carrying the repetition count
   * on EACH tick, and — when `count > 0` — succeeds with the final count after
   * the capped number of repetitions (`count === 0` runs indefinitely and never
   * self-settles). By default each tick runs inside an update cycle so bound
   * content refreshes; pass `invokeApply = false` to opt out. Extra `args` are
   * passed through to `fn` AFTER the iteration count.
   *
   * @param fn - The unit of work to run each interval, called `fn(iteration, ...args)`. Its return value is ignored.
   * @param delay - Milliseconds between runs.
   * @param count - Number of repetitions before succeeding (default `0` = indefinite).
   * @param invokeApply - Whether to run each tick inside an update cycle (default `true`).
   * @param args - Extra inputs passed through to `fn` after the iteration count.
   * @returns A promise reporting per-tick progress and succeeding with the final count.
   */
  (
    fn: (iteration: number, ...args: never[]) => unknown,
    delay: number,
    count?: number,
    invokeApply?: boolean,
    ...args: unknown[]
  ): QPromise<number>;

  /**
   * Cancel a repeating task scheduled by this service. Stops further
   * repetitions, fails the task's promise to signal cancellation, and returns
   * `true`. Cancelling an already-finished / already-cancelled / unknown promise
   * returns `false` and does not throw.
   *
   * @param promise - The promise returned by a prior `$interval(...)` call.
   * @returns `true` if a running task was cancelled, `false` otherwise.
   */
  cancel(promise?: QPromise<unknown>): boolean;
}
