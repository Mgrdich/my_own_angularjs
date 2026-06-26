/**
 * Public type surface for the `$q` promise toolkit (`src/async/q.ts`).
 *
 * The internal promise *class* is module-private (so it never shadows the
 * global `Promise`); consumers see only the {@link QPromise} interface and
 * the {@link QDeferred} / {@link QService} shapes. Slice 1 ships the deferred
 * + `.then` core; Slice 2 widens {@link QService} with the executor
 * constructor, `resolve` / `when` / `reject` statics, and the
 * `all` / `race` / `allSettled` combiners.
 */

import type { ExceptionHandler } from '@exception-handler/index';

/**
 * A value that may itself be a thenable. `.then` on a promise (or a callback
 * returning a thenable) chains through the inner value via adoption.
 */
export type Thenable<T> = QPromise<T> | PromiseLike<T>;

/**
 * A digest-scheduled promise, aligned with Promises/A+ but with continuations
 * processed through the framework's update cycle (via the injected
 * `scheduleDigest` seam) rather than native microtasks.
 *
 * @typeParam T - The value the promise settles with on success.
 *
 * @example
 * ```ts
 * const promise: QPromise<number> = $q.resolve(21);
 * promise
 *   .then((n) => n * 2) // QPromise<number>
 *   .catch((reason) => 0) // recover on failure
 *   .finally(() => cleanup()); // runs on settle, value passes through
 * ```
 */
export interface QPromise<T> {
  /**
   * Attach success / failure / progress follow-ups and obtain a derived
   * promise. The derived promise resolves with the success follow-up's return
   * value, rejects when a follow-up throws, and awaits a returned thenable
   * before continuing the chain.
   *
   * @param onFulfilled - Runs with the delivered value when this promise succeeds.
   * @param onRejected - Runs with the delivered reason when this promise fails.
   * @param onProgress - Runs with each progress notification (Slice 4 `$interval`).
   * @returns A derived promise carrying the follow-up's result type.
   */
  then<TResult1 = T, TResult2 = never>(
    onFulfilled?: ((value: T) => TResult1 | Thenable<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | Thenable<TResult2>) | null,
    onProgress?: (state: unknown) => void,
  ): QPromise<TResult1 | TResult2>;

  /**
   * Failure-only shorthand — equivalent to `then(undefined, onRejected)`
   * (FS §2.3). Runs `onRejected` when this promise fails; on success the
   * value passes through untouched.
   *
   * @param onRejected - Runs with the delivered reason when this promise fails.
   * @returns A derived promise carrying the recovery value or the original value.
   */
  catch<TResult = never>(onRejected?: ((reason: unknown) => TResult | Thenable<TResult>) | null): QPromise<T | TResult>;

  /**
   * Cleanup follow-up that runs once this promise settles, whether it
   * succeeded or failed (FS §2.3). The original value / reason passes
   * through unchanged UNLESS `callback` throws or returns a rejecting
   * thenable, in which case the derived promise fails with that reason.
   *
   * @param callback - Runs on settlement; its return value is awaited but discarded.
   * @returns A derived promise mirroring this one (unless `callback` fails).
   */
  finally(callback?: (() => unknown) | null): QPromise<T>;
}

/**
 * The controller half of a pending result: hand {@link QDeferred.promise} to
 * other code, then later {@link QDeferred.resolve} or {@link QDeferred.reject}
 * it. Settlement is final — a second resolve / reject is ignored.
 *
 * @typeParam T - The value the associated promise settles with on success.
 *
 * @example
 * ```ts
 * const deferred: QDeferred<string> = $q.defer<string>();
 * giveToOtherCode(deferred.promise);
 * // …later, from any code path (even outside a digest):
 * deferred.resolve('ready'); // success follow-ups receive 'ready'
 * // deferred.reject(new Error('nope')); // — or fail it
 * ```
 */
export interface QDeferred<T> {
  /** The promise other code observes. */
  readonly promise: QPromise<T>;
  /** Settle the result as succeeded with `value` (or adopt a thenable). */
  resolve(value: T | Thenable<T>): void;
  /** Settle the result as failed with `reason`. */
  reject(reason?: unknown): void;
  /** Report a progress notification to attached progress follow-ups. */
  notify(state?: unknown): void;
}

/**
 * The single unit of work handed to the ES6-style `$q(executor)`
 * constructor (FS §2.2). It receives the means to succeed (`resolve`) or
 * fail (`reject`) the constructed promise. A synchronous throw from the
 * executor fails the promise with the thrown value.
 *
 * @typeParam T - The value the constructed promise settles with on success.
 *
 * @example
 * ```ts
 * const executor: QExecutor<number> = (resolve, reject) => {
 *   try {
 *     resolve(compute());
 *   } catch (err) {
 *     reject(err);
 *   }
 * };
 * const promise = $q(executor); // QPromise<number>
 * ```
 */
export type QExecutor<T> = (resolve: (value: T | Thenable<T>) => void, reject: (reason?: unknown) => void) => void;

/**
 * The per-item outcome report produced by {@link QService.allSettled}
 * (FS §2.4). A discriminated union: `'fulfilled'` carries the value,
 * `'rejected'` carries the reason. This form never fails as a whole.
 *
 * @typeParam T - The value type of a fulfilled item.
 *
 * @example
 * ```ts
 * $q.allSettled<number>([$q.resolve(1), $q.reject('boom')]).then((reports) => {
 *   for (const report of reports) {
 *     if (report.status === 'fulfilled') {
 *       use(report.value); // narrowed to number
 *     } else {
 *       log(report.reason); // narrowed to the rejection branch
 *     }
 *   }
 * });
 * ```
 */
export type QSettledResult<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly reason: unknown };

/**
 * The element value type of a `$q.all` / `$q.race` / `$q.allSettled` input
 * item — either a promise / thenable carrying a `T`, or a plain `T` treated
 * as already-resolved.
 */
type QInput<T> = T | Thenable<T>;

/**
 * Recursively unwrap a {@link QPromise} (and any native thenable) to the value
 * it ultimately settles with — the `$q` analogue of TS's built-in `Awaited`.
 *
 * `QPromise<U>` is NOT a native `PromiseLike`, so TS's `Awaited<QPromise<U>>`
 * collapses to `unknown` and the per-slot value type is lost in the combiner
 * return types. `AwaitedQ` peels each `QPromise` layer explicitly, then defers
 * to native {@link Awaited} for native thenables / plain values (so a
 * `Promise<U>` or bare `U` input still unwraps correctly).
 *
 * @typeParam T - The (possibly promise-wrapped) input value type.
 */
export type AwaitedQ<T> = T extends QPromise<infer U> ? AwaitedQ<U> : Awaited<T>;

/**
 * The `$q` service surface — a callable (the ES6-style executor
 * constructor, FS §2.2) carrying the deferred factory, the
 * wrap-a-value statics, and the three combiners as own properties.
 *
 * @example
 * ```ts
 * const $q: QService = injector.get('$q');
 *
 * const deferred = $q.defer<number>(); // controller-object style
 * const wrapped = $q.resolve('ready'); // wrap a known value
 * const failed = $q.reject(new Error('x')); // wrap a known reason
 * const direct = $q<number>((res) => res(1)); // executor constructor
 *
 * $q.all([deferred.promise, wrapped]).then(([n, s]) => {
 *   // n: number, s: string — per-slot types preserved
 * });
 * $q.race([deferred.promise, wrapped]); // first settlement wins
 * $q.allSettled([failed]); // never fails as a whole
 * ```
 */
export interface QService {
  /**
   * Construct a promise directly from a single unit of work (FS §2.2). The
   * executor is called synchronously with `resolve` / `reject`; a thrown
   * executor fails the promise with the thrown value.
   *
   * @typeParam T - The value the constructed promise settles with on success.
   * @param executor - The unit of work handed `resolve` / `reject`.
   * @returns A promise settled by the executor.
   */
  <T = unknown>(executor: QExecutor<T>): QPromise<T>;

  /**
   * Create a fresh {@link QDeferred} controlling a new pending result.
   *
   * @typeParam T - The value the deferred's promise settles with.
   */
  defer<T = unknown>(): QDeferred<T>;

  /**
   * Wrap an already-known value as an immediately-succeeded promise
   * (FS §2.2). Wrapping a thenable adopts it rather than double-wrapping.
   *
   * @typeParam T - The value the resulting promise succeeds with.
   * @param value - The value (or thenable) to wrap.
   */
  resolve<T = unknown>(value?: T | Thenable<T>): QPromise<T>;

  /**
   * Classic alias of {@link QService.resolve} (FS §2.2).
   *
   * @typeParam T - The value the resulting promise succeeds with.
   * @param value - The value (or thenable) to wrap.
   */
  when<T = unknown>(value?: T | Thenable<T>): QPromise<T>;

  /**
   * Wrap an already-known reason as an immediately-failed promise (FS §2.2).
   *
   * @param reason - The reason the resulting promise fails with.
   */
  reject<T = never>(reason?: unknown): QPromise<T>;

  /**
   * Wait for ALL of several pending results and succeed with their values,
   * preserving the grouping — positional list (array) or named keys (object)
   * (FS §2.4). Rejects with the FIRST failing reason. Plain (non-promise)
   * inputs are treated as already-resolved.
   *
   * @typeParam T - The grouping shape (array or keyed object) of inputs.
   * @param inputs - The array / object of promises (or plain values) to await.
   */
  all<T extends readonly unknown[] | []>(inputs: T): QPromise<{ -readonly [K in keyof T]: AwaitedQ<T[K]> }>;
  all<T extends Record<string, unknown>>(inputs: T): QPromise<{ [K in keyof T]: AwaitedQ<T[K]> }>;

  /**
   * Wait for the FIRST of several pending results to settle and adopt its
   * outcome — success or failure — disregarding the rest (FS §2.4,
   * intentional addition §3). Plain inputs settle immediately.
   *
   * @typeParam T - The resolved value type carried by each input.
   * @param inputs - The iterable of promises (or plain values) to race.
   */
  race<T = unknown>(inputs: Iterable<QInput<T>>): QPromise<T>;

  /**
   * Wait for EVERY result to settle and succeed with a per-item report
   * (FS §2.4, intentional addition §3). Never fails as a whole. Plain inputs
   * are reported as `'fulfilled'`.
   *
   * @typeParam T - The resolved value type carried by each input.
   * @param inputs - The iterable of promises (or plain values) to settle.
   */
  allSettled<T = unknown>(inputs: Iterable<QInput<T>>): QPromise<Array<QSettledResult<T>>>;
}

/**
 * Injected seams for the pure {@link createQ} factory. The DI factory on
 * `ngModule` binds these to the real `$rootScope` / `$exceptionHandler`;
 * unit tests inject lightweight stand-ins so `createQ` is exercisable without
 * an injector.
 *
 * @example
 * ```ts
 * const options: QOptions = {
 *   scheduleDigest: (fn) => $rootScope.$evalAsync(fn),
 *   exceptionHandler: $exceptionHandler,
 * };
 * const $q = createQ(options);
 * ```
 */
export interface QOptions {
  /** Central error-reporting channel (Slice 2 unhandled-rejection routing). */
  exceptionHandler: ExceptionHandler;
  /**
   * Seam onto `$rootScope.$evalAsync` — `$q` calls it on every settlement so a
   * digest drains the queued `.then` continuations asynchronously.
   */
  scheduleDigest: (fn: () => void) => void;
}
