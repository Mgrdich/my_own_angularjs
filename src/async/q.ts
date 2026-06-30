/**
 * `createQ` — the `$q` promise engine.
 *
 * A digest-scheduled, Promises/A+-aligned promise consistent with AngularJS
 * `$q`. Unlike native promises, `.then` continuations are NOT processed on the
 * microtask queue — they are queued and flushed inside the framework's update
 * cycle via the injected `scheduleDigest` seam (`$rootScope.$evalAsync`). That
 * is what makes a settlement originating outside a digest automatically refresh
 * bound content (FS §2.5): settling a promise schedules a digest, and the
 * digest both drains the queued continuations and re-evaluates watchers.
 *
 * The factory is PURE — it takes its seams (`scheduleDigest`,
 * `exceptionHandler`) as options and is unit-testable without an injector. The
 * DI factory on `ngModule` binds those seams to the real `$rootScope` /
 * `$exceptionHandler`.
 *
 * The internal {@link InternalPromise} class is deliberately module-private (so
 * it never shadows the global `Promise`); it is exposed exclusively through the
 * {@link QPromise} type and instances returned by `$q`.
 *
 * Slice 1 shipped `$q.defer()` + `.then`. Slice 2 extends this same engine with
 * the ES6-style executor constructor, the wrap-a-value statics
 * (`resolve` / `when` / `reject`), `.catch` / `.finally`, the three combiners
 * (`all` / `race` / `allSettled`), and always-on unhandled-rejection reporting
 * routed via `invokeExceptionHandler(exceptionHandler, reason, '$q')`.
 */

import { invokeExceptionHandler } from '@exception-handler/index';
import type { QDeferred, QExecutor, QOptions, QPromise, QService, QSettledResult, Thenable } from '@async/q-types';

/** Internal shape of the deferred a follow-up feeds (resolve / reject only). */
type DerivedDeferred = Pick<QDeferred<unknown>, 'resolve' | 'reject'>;

/** The three terminal-or-pending states of a promise (FS §2.1). */
const PromiseState = {
  Pending: 0,
  Resolved: 1,
  Rejected: 2,
} as const;

type PromiseState = (typeof PromiseState)[keyof typeof PromiseState];

/** A registered `.then` follow-up plus the derived deferred it feeds. */
interface PendingCallback {
  readonly onFulfilled?: ((value: unknown) => unknown) | null;
  readonly onRejected?: ((reason: unknown) => unknown) | null;
  readonly onProgress?: ((state: unknown) => void) | null;
  readonly derived: DerivedDeferred;
}

/**
 * Narrow an unknown value to a thenable (something with a callable `.then`).
 * Used by `resolve` to adopt a returned promise / thenable rather than
 * double-wrapping it (FS §2.2).
 */
function isThenable(value: unknown): value is Thenable<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Build the `$q` service. See the file-level doc for the digest-scheduling
 * contract.
 *
 * The factory is PURE — `scheduleDigest` and `exceptionHandler` are injected
 * seams, so `$q` is exercisable without an injector. On `ngModule` the DI
 * factory binds `scheduleDigest` to `$rootScope.$evalAsync` and
 * `exceptionHandler` to `$exceptionHandler`.
 *
 * @param options - The injected digest / error-reporting seams.
 * @returns The callable `$q` service (executor constructor + statics).
 *
 * @example
 * ```ts
 * const $q = createQ({
 *   scheduleDigest: (fn) => $rootScope.$evalAsync(fn),
 *   exceptionHandler: $exceptionHandler,
 * });
 *
 * const deferred = $q.defer<number>();
 * deferred.promise.then((n) => n * 2).then((doubled) => {
 *   // doubled === 20 — runs in the next digest turn
 * });
 * deferred.resolve(10);
 * ```
 */
export function createQ(options: QOptions): QService {
  const { scheduleDigest, exceptionHandler } = options;

  /**
   * The module-private promise implementation. Created only through a
   * {@link Deferred}; consumers see it as a {@link QPromise}.
   */
  class InternalPromise<T> implements QPromise<T> {
    /** @internal */
    state: PromiseState = PromiseState.Pending;
    /** @internal — the value on resolve, or the reason on reject. */
    value: unknown = undefined;
    /** @internal — follow-ups registered before settlement. */
    pending: PendingCallback[] | null = [];
    /**
     * @internal — set once a `.then` follow-up is attached. A handled
     * rejection is never reported as unhandled (FS §2.6): the derived promise
     * the follow-up produced inherits the unhandled-tracking responsibility,
     * so reporting is pushed downstream until a chain tip with no follow-up
     * remains unhandled when the deferred check fires.
     */
    handled = false;

    then<TResult1 = T, TResult2 = never>(
      onFulfilled?: ((value: T) => TResult1 | Thenable<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | Thenable<TResult2>) | null,
      onProgress?: (state: unknown) => void,
    ): QPromise<TResult1 | TResult2> {
      // Attaching ANY follow-up takes over the unhandled-rejection tracking:
      // the derived promise becomes the new chain tip responsible for it.
      this.handled = true;

      const derived = new Deferred<TResult1 | TResult2>();
      const callback: PendingCallback = {
        onFulfilled: onFulfilled as ((value: unknown) => unknown) | null | undefined,
        onRejected: onRejected as ((reason: unknown) => unknown) | null | undefined,
        onProgress: onProgress as ((state: unknown) => void) | null | undefined,
        derived,
      };

      if (this.pending !== null) {
        // Still pending — queue the follow-up; it fires when we settle.
        this.pending.push(callback);
      } else {
        // Already settled — schedule this single follow-up.
        scheduleProcess(this, [callback]);
      }

      return derived.promise;
    }

    catch<TResult = never>(
      onRejected?: ((reason: unknown) => TResult | Thenable<TResult>) | null,
    ): QPromise<T | TResult> {
      return this.then(undefined, onRejected);
    }

    finally(callback?: (() => unknown) | null): QPromise<T> {
      if (typeof callback !== 'function') {
        // No cleanup — pass straight through.
        return this.then();
      }
      const cb = callback;
      // On success: run cb, await it if thenable, then pass the value through.
      // On failure: run cb, await it if thenable, then re-throw the reason.
      return this.then(
        (value: T) => handleFinally(cb, value, false) as T | Thenable<T>,
        (reason: unknown) => handleFinally(cb, reason, true) as never,
      );
    }
  }

  /**
   * Shared `.finally` body: invoke the cleanup callback, await a returned
   * thenable, then propagate the original value (success) or re-throw the
   * original reason (failure) — UNLESS the cleanup itself throws or returns a
   * rejecting thenable, in which case that takes over (FS §2.3).
   */
  function handleFinally(callback: () => unknown, valueOrReason: unknown, isRejection: boolean): unknown {
    const outcome = callback();
    const passThrough = (): unknown => {
      if (isRejection) {
        throw valueOrReason;
      }
      return valueOrReason;
    };
    if (isThenable(outcome)) {
      // Await the cleanup's thenable before propagating; a rejection from it
      // overrides the pass-through.
      return outcome.then(() => passThrough());
    }
    return passThrough();
  }

  /**
   * Schedule the registered follow-ups of a settled promise to run inside the
   * next digest turn (asynchronously, FS §2.5). Coalesced to ONE schedule per
   * settlement so a resolved chain settles within a single digest without
   * re-queuing every iteration (TTL safety).
   */
  function scheduleProcess(promise: InternalPromise<unknown>, callbacks: PendingCallback[]): void {
    scheduleDigest(() => {
      for (const callback of callbacks) {
        processCallback(promise, callback);
      }
    });
  }

  /** Run a single follow-up against a settled promise and settle its derived. */
  function processCallback(promise: InternalPromise<unknown>, callback: PendingCallback): void {
    const { derived } = callback;
    const handler = promise.state === PromiseState.Resolved ? callback.onFulfilled : callback.onRejected;

    if (typeof handler !== 'function') {
      // No handler for this outcome — pass the value/reason straight through.
      if (promise.state === PromiseState.Resolved) {
        derived.resolve(promise.value as never);
      } else {
        derived.reject(promise.value);
      }
      return;
    }

    try {
      derived.resolve(handler(promise.value) as never);
    } catch (error: unknown) {
      derived.reject(error);
    }
  }

  /**
   * The deferred — the controller half of a pending result. Closes over the
   * `InternalPromise` it controls so `resolve` / `reject` mutate its state and
   * schedule the queued follow-ups.
   */
  class Deferred<T> implements QDeferred<T> {
    readonly promise: InternalPromise<T> = new InternalPromise<T>();

    resolve = (value: T | Thenable<T>): void => {
      if (this.promise.state !== PromiseState.Pending) {
        return; // Final once settled (FS §2.1) — second resolve ignored.
      }

      // Thenable adoption (FS §2.2 — no double-wrapping): chain through.
      if (isThenable(value)) {
        value.then(
          (inner: unknown) => {
            this.resolve(inner as T);
          },
          (reason: unknown) => {
            this.reject(reason);
          },
        );
        return;
      }

      this.settle(PromiseState.Resolved, value);
    };

    reject = (reason?: unknown): void => {
      if (this.promise.state !== PromiseState.Pending) {
        return; // Final once settled (FS §2.1).
      }
      this.settle(PromiseState.Rejected, reason);
    };

    notify = (state?: unknown): void => {
      if (this.promise.state !== PromiseState.Pending || this.promise.pending === null) {
        return;
      }
      const callbacks = this.promise.pending.slice();
      scheduleDigest(() => {
        for (const callback of callbacks) {
          if (typeof callback.onProgress === 'function') {
            callback.onProgress(state);
          }
        }
      });
    };

    private settle(state: PromiseState, value: unknown): void {
      const queued = this.promise.pending ?? [];
      this.promise.state = state;
      this.promise.value = value;
      this.promise.pending = null;
      if (queued.length > 0) {
        scheduleProcess(this.promise, queued);
      }
      if (state === PromiseState.Rejected) {
        scheduleUnhandledCheck(this.promise);
      }
    }
  }

  /**
   * Defer the unhandled-rejection check to the next digest turn (FS §2.6). By
   * the time the check runs, any failure follow-up attached slightly later in
   * the same turn has already flipped the `handled` flag — so a rejection that
   * gains a handler before the check is NOT falsely reported. A rejected
   * promise that still has no follow-up attached (a chain tip) is reported via
   * the central error-reporting channel with cause `'$q'`.
   */
  function scheduleUnhandledCheck(promise: InternalPromise<unknown>): void {
    scheduleDigest(() => {
      if (!promise.handled) {
        invokeExceptionHandler(exceptionHandler, promise.value, '$q');
      }
    });
  }

  /** Build a settled promise carrying `state` / `value` directly. */
  function settledPromise<T>(state: PromiseState, value: unknown): InternalPromise<T> {
    const deferred = new Deferred<T>();
    if (state === PromiseState.Resolved) {
      deferred.resolve(value as T | Thenable<T>);
    } else {
      deferred.reject(value);
    }
    return deferred.promise;
  }

  /** Wrap a value as an immediately-succeeded promise (adopts thenables). */
  function resolveValue<T = unknown>(value?: T | Thenable<T>): QPromise<T> {
    if (value instanceof InternalPromise) {
      return value as InternalPromise<T>;
    }
    return settledPromise<T>(PromiseState.Resolved, value);
  }

  /** Wrap a reason as an immediately-failed promise. */
  function rejectReason<T = never>(reason?: unknown): QPromise<T> {
    return settledPromise<T>(PromiseState.Rejected, reason);
  }

  /** The ES6-style executor constructor (FS §2.2). */
  function construct<T = unknown>(executor: QExecutor<T>): QPromise<T> {
    const deferred = new Deferred<T>();
    try {
      executor(deferred.resolve, deferred.reject);
    } catch (error: unknown) {
      deferred.reject(error);
    }
    return deferred.promise;
  }

  /**
   * `$q.all` (FS §2.4) — succeed with the per-slot values preserving the
   * grouping (array index ↔ object key); reject on the FIRST failure. Plain
   * (non-promise) inputs count as already-resolved. Operates on the entry list
   * of the array / object so both shapes share one engine.
   */
  function all(inputs: readonly unknown[] | Record<string, unknown>): QPromise<unknown> {
    const deferred = new Deferred<unknown>();
    const isArray = Array.isArray(inputs);
    const keys: Array<string | number> = isArray ? inputs.map((_, index) => index) : Object.keys(inputs);
    const source = inputs as Record<string | number, unknown>;
    const results: unknown[] | Record<string, unknown> = isArray ? new Array<unknown>(keys.length) : {};
    const setResult = (key: string | number, value: unknown): void => {
      if (Array.isArray(results)) {
        results[key as number] = value;
      } else {
        results[key as string] = value;
      }
    };
    let remaining = keys.length;

    if (remaining === 0) {
      deferred.resolve(results);
      return deferred.promise;
    }

    for (const key of keys) {
      const item = source[key];
      resolveValue(item).then(
        (value) => {
          setResult(key, value);
          remaining -= 1;
          if (remaining === 0) {
            deferred.resolve(results);
          }
        },
        (reason) => {
          deferred.reject(reason);
        },
      );
    }

    return deferred.promise;
  }

  /**
   * `$q.race` (FS §2.4, intentional addition §3) — adopt the FIRST settlement,
   * success or failure; later settlements are ignored by the deferred's
   * finality. Plain inputs settle immediately.
   */
  function race<T = unknown>(inputs: Iterable<T | Thenable<T>>): QPromise<T> {
    const deferred = new Deferred<T>();
    for (const item of inputs) {
      resolveValue<T>(item).then(
        (value) => {
          deferred.resolve(value);
        },
        (reason) => {
          deferred.reject(reason);
        },
      );
    }
    return deferred.promise;
  }

  /**
   * `$q.allSettled` (FS §2.4, intentional addition §3) — NEVER fails as a
   * whole; succeed with a per-item discriminated report once every input has
   * settled. Plain inputs report as `'fulfilled'`.
   */
  function allSettled<T = unknown>(inputs: Iterable<T | Thenable<T>>): QPromise<Array<QSettledResult<T>>> {
    const deferred = new Deferred<Array<QSettledResult<T>>>();
    const items = Array.from(inputs);
    const results = new Array<QSettledResult<T>>(items.length);
    let remaining = items.length;

    if (remaining === 0) {
      deferred.resolve(results);
      return deferred.promise;
    }

    items.forEach((item, index) => {
      resolveValue<T>(item).then(
        (value) => {
          results[index] = { status: 'fulfilled', value };
          remaining -= 1;
          if (remaining === 0) {
            deferred.resolve(results);
          }
        },
        (reason) => {
          results[index] = { status: 'rejected', reason };
          remaining -= 1;
          if (remaining === 0) {
            deferred.resolve(results);
          }
        },
      );
    });

    return deferred.promise;
  }

  // Assemble the callable `$q` with its statics. The construct callable carries
  // `defer` / `resolve` / `when` / `reject` / `all` / `race` / `allSettled` as
  // own properties — the canonical AngularJS `$q` shape.
  const q = Object.assign(construct, {
    defer<T = unknown>(): QDeferred<T> {
      return new Deferred<T>();
    },
    resolve: resolveValue,
    when: resolveValue,
    reject: rejectReason,
    all,
    race,
    allSettled,
  });

  // The `all` overloads (array ↔ object grouping) are declared on QService;
  // the runtime engine handles both shapes through one entry-list path, so a
  // single structural cast bridges the implementation signature to the typed
  // public surface.
  return q as unknown as QService;
}
