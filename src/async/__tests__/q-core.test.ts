/**
 * `$q` core tests (spec 037 Slice 1).
 *
 * Covers the deferred/promise state machine and `.then` chaining at TWO
 * layers:
 *
 * 1. PURE — `createQ(...)` with a synchronous `scheduleDigest` stand-in so the
 *    state-machine semantics (finality, success/failure routing, chaining,
 *    async-not-sync settlement) are provable WITHOUT an injector.
 * 2. DI — `injector.get('$q')` + `injector.get('$rootScope')` with vitest fake
 *    timers, exercising the real `$rootScope.$evalAsync` seam: a settlement
 *    from OUTSIDE a digest schedules one and refreshes a `$watch`ed value
 *    (FS §2.5).
 */

import { ngModule } from '@core/ng-module';
import type { Scope } from '@core/scope';
import { createInjector } from '@di/injector';
import { noopExceptionHandler } from '@exception-handler/index';
import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Build a pure `$q` whose `scheduleDigest` drains queued continuations
 * synchronously when the test calls `flush()`. Mirrors a digest turn without
 * needing a real scope.
 */
function makePureQ(): { q: QService; flush: () => void } {
  let queue: Array<() => void> = [];
  const q = createQ({
    exceptionHandler: noopExceptionHandler,
    scheduleDigest: (fn) => {
      queue.push(fn);
    },
  });
  const flush = (): void => {
    // Drain repeatedly: a continuation may schedule further continuations.
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      for (const fn of batch) {
        fn();
      }
    }
  };
  return { q, flush };
}

describe('$q core — deferred finality (FS §2.1)', () => {
  it('resolve delivers the value to a success follow-up', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<number>();
    const onOk = vi.fn();

    deferred.promise.then(onOk);
    deferred.resolve(42);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('reject delivers the reason to a failure follow-up', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<number>();
    const onErr = vi.fn();

    deferred.promise.then(undefined, onErr);
    deferred.reject('boom');
    flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('boom');
  });

  it('a second settle is ignored — the first outcome stands', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<string>();
    const onOk = vi.fn();
    const onErr = vi.fn();

    deferred.promise.then(onOk, onErr);
    deferred.resolve('first');
    deferred.resolve('second'); // ignored
    deferred.reject('nope'); // ignored
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith('first');
    expect(onErr).not.toHaveBeenCalled();
  });
});

describe('$q core — .then success/failure routing (FS §2.3)', () => {
  it('a follow-up attached AFTER settlement still runs', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<number>();
    deferred.resolve(7);

    const onOk = vi.fn();
    deferred.promise.then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('a returned value flows to the next chained follow-up', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<number>();
    const last = vi.fn();

    deferred.promise
      .then((n) => n + 1)
      .then((n) => n * 2)
      .then(last);
    deferred.resolve(10);
    flush();

    expect(last).toHaveBeenCalledExactlyOnceWith(22);
  });

  it('a thrown follow-up rejects the derived promise', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<number>();
    const onErr = vi.fn();

    deferred.promise
      .then(() => {
        throw new Error('in callback');
      })
      .then(undefined, onErr);
    deferred.resolve(1);
    flush();

    expect(onErr).toHaveBeenCalledOnce();
    expect((onErr.mock.calls[0]?.[0] as Error).message).toBe('in callback');
  });

  it('an unhandled failure propagates down the chain to a failure follow-up', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<number>();
    const onErr = vi.fn();

    // No failure handler on the first .then — the rejection passes through.
    deferred.promise.then((n) => n + 1).then(undefined, onErr);
    deferred.reject('reason');
    flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('reason');
  });
});

describe('$q core — chaining on a returned pending promise (FS §2.3)', () => {
  it('the next step waits for a returned pending promise to settle first', () => {
    const { q, flush } = makePureQ();
    const outer = q.defer<number>();
    const inner = q.defer<number>();
    const last = vi.fn();

    outer.promise.then(() => inner.promise).then(last);

    outer.resolve(1);
    flush();
    // Inner is still pending — the chain must NOT have continued.
    expect(last).not.toHaveBeenCalled();

    inner.resolve(99);
    flush();
    expect(last).toHaveBeenCalledExactlyOnceWith(99);
  });
});

describe('$q core — callbacks run asynchronously (FS §2.5)', () => {
  it('a follow-up does NOT run in the same turn that settled the result', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<number>();
    const onOk = vi.fn();

    deferred.promise.then(onOk);
    deferred.resolve(5);
    // No flush yet — settlement must not have run the callback synchronously.
    expect(onOk).not.toHaveBeenCalled();

    flush();
    expect(onOk).toHaveBeenCalledExactlyOnceWith(5);
  });
});

describe('$q — DI registration + digest integration (FS §2.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("injector.get('$q') resolves to the service after createInjector(['ng'])", () => {
    const injector = createInjector([ngModule]);
    const $q = injector.get('$q');
    expect(typeof $q.defer).toBe('function');
  });

  it('a resolution from OUTSIDE a digest triggers a digest and refreshes a $watch value', () => {
    const injector = createInjector([ngModule]);
    const $q = injector.get('$q');
    const $rootScope = injector.get('$rootScope') as unknown as Scope & {
      result?: number;
    };

    let seen: number | undefined;
    $rootScope.$watch(
      (scope: Scope & { result?: number }) => scope.result,
      (newValue: number | undefined) => {
        seen = newValue;
      },
    );

    // Prime the watcher so the initial-undefined fire settles.
    $rootScope.$digest();
    expect(seen).toBeUndefined();

    const deferred = $q.defer<number>();
    deferred.promise.then((value) => {
      ($rootScope as { result?: number }).result = value;
    });

    // Settle from outside any digest — this must auto-schedule a digest.
    deferred.resolve(123);

    // Flush the $evalAsync-scheduled setTimeout → $digest drains the
    // continuation AND re-evaluates the watcher.
    vi.advanceTimersByTime(0);

    expect(($rootScope as { result?: number }).result).toBe(123);
    expect(seen).toBe(123);
  });

  it('continuations run asynchronously through the real digest seam', () => {
    const injector = createInjector([ngModule]);
    const $q = injector.get('$q');
    const onOk = vi.fn();

    const deferred = $q.defer<string>();
    deferred.promise.then(onOk);
    deferred.resolve('later');

    // Not yet — the digest has not run.
    expect(onOk).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(onOk).toHaveBeenCalledExactlyOnceWith('later');
  });
});
