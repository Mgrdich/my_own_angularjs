/**
 * `$interval` tests (spec 037 Slice 4).
 *
 * Covers the repeating deferred task at TWO layers:
 *
 * 1. PURE — `createInterval(...)` with stub seams (a manual repeating-timer
 *    registry + a synchronous `apply`) so the per-tick progress / count-cap
 *    resolve / cancellation / no-auto-cancel-on-throw / phase-guard semantics
 *    are provable WITHOUT an injector.
 * 2. DI — `injector.get('$interval')` + `injector.get('$rootScope')` with
 *    vitest fake timers, exercising the real `$rootScope.$apply` / global
 *    `setInterval` seams: ticks after the delay refresh a `$watch`ed value
 *    (FS §2.8).
 */

import { ngModule } from '@core/ng-module';
import type { Scope } from '@core/scope';
import { createInjector } from '@di/injector';
import { noopExceptionHandler } from '@exception-handler/index';
import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { createInterval } from '@async/interval';
import type { IntervalService, TimerId } from '@async/async-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A manual repeating-timer harness for the PURE layer: `setIntervalFn` records
 * the callback under a monotonic id; `tick(id)` runs it once (simulating one
 * interval elapse); `clearIntervalFn` drops it. `apply` runs the fn
 * synchronously. `rootPhase` is fixed to `null` (no digest) unless a test flips
 * it. A synchronous `flush` drains `$q`'s scheduled continuations.
 */
function makeHarness(opts?: { phase?: () => Scope['$$phase']; exceptionHandler?: typeof noopExceptionHandler }) {
  const timers = new Map<TimerId, () => void>();
  let nextId = 1;
  let queue: Array<() => void> = [];

  const q: QService = createQ({
    exceptionHandler: opts?.exceptionHandler ?? noopExceptionHandler,
    scheduleDigest: (fn) => {
      queue.push(fn);
    },
  });

  const flush = (): void => {
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      for (const fn of batch) {
        fn();
      }
    }
  };

  const applyCalls: number[] = [];
  const $interval: IntervalService = createInterval({
    q,
    exceptionHandler: opts?.exceptionHandler ?? noopExceptionHandler,
    apply: (fn) => {
      applyCalls.push(1);
      fn();
    },
    rootPhase: opts?.phase ?? (() => null),
    setIntervalFn: (fn) => {
      const id = nextId++ as unknown as TimerId;
      timers.set(id, fn);
      return id;
    },
    clearIntervalFn: (id) => {
      timers.delete(id);
    },
  });

  /** Run one interval elapse for the timer `id` (no-op if cleared). */
  const tick = (id: TimerId): void => {
    timers.get(id)?.();
  };

  // The id of the single most-recent timer (tests arm exactly one at a time).
  const lastTimerId = (): TimerId => Array.from(timers.keys()).slice(-1)[0] as TimerId;

  return { $interval, tick, flush, applyCalls, timers, lastTimerId };
}

describe('$interval — per-tick progress + count cap (FS §2.8)', () => {
  it('reports a progress notification carrying the iteration count on each tick', () => {
    const h = makeHarness();
    const onProgress = vi.fn();

    const promise = h.$interval(() => undefined, 100, 3);
    promise.then(undefined, undefined, onProgress);

    const id = h.lastTimerId();

    h.tick(id);
    h.flush();
    expect(onProgress).toHaveBeenLastCalledWith(1);

    h.tick(id);
    h.flush();
    expect(onProgress).toHaveBeenLastCalledWith(2);

    h.tick(id);
    h.flush();
    expect(onProgress).toHaveBeenLastCalledWith(3);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it('runs the work once per interval and resolves with the final count after the capped tick', () => {
    const h = makeHarness();
    const fn = vi.fn();
    const onOk = vi.fn();

    const promise = h.$interval(fn, 100, 2);
    promise.then(onOk);

    const id = h.lastTimerId();

    h.tick(id);
    h.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();

    h.tick(id);
    h.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onOk).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('stops ticking after the count cap is reached', () => {
    const h = makeHarness();
    const fn = vi.fn();

    h.$interval(fn, 100, 2);
    const id = h.lastTimerId();

    h.tick(id);
    h.tick(id);
    h.flush();
    expect(fn).toHaveBeenCalledTimes(2);

    // Timer was cleared on the capped tick — the registry dropped it.
    expect(h.timers.size).toBe(0);
    // A further attempted elapse is a clean no-op.
    h.tick(id);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs each tick inside apply by default (automatic refresh)', () => {
    const h = makeHarness();
    h.$interval(() => undefined, 100, 2);
    const id = h.lastTimerId();

    h.tick(id);
    h.tick(id);
    expect(h.applyCalls).toHaveLength(2);
  });

  it('passes extra args through to the callback after the iteration count', () => {
    const h = makeHarness();
    const fn = vi.fn((iteration: number, a: number, b: string) => `${String(iteration)}:${String(a)}-${b}`);

    h.$interval(fn as (iteration: number, ...args: never[]) => string, 100, 1, true, 7, 'x');
    h.tick(h.lastTimerId());

    expect(fn).toHaveBeenCalledExactlyOnceWith(1, 7, 'x');
  });
});

describe('$interval — indefinite (count === 0) (FS §2.8)', () => {
  it('keeps ticking and reporting progress, never self-settling', () => {
    const h = makeHarness();
    const fn = vi.fn();
    const onOk = vi.fn();
    const onErr = vi.fn();
    const onProgress = vi.fn();

    const promise = h.$interval(fn, 100); // count defaults to 0
    promise.then(onOk, onErr, onProgress);

    const id = h.lastTimerId();
    for (let i = 0; i < 5; i++) {
      h.tick(id);
    }
    h.flush();

    expect(fn).toHaveBeenCalledTimes(5);
    expect(onProgress).toHaveBeenCalledTimes(5);
    expect(onProgress).toHaveBeenLastCalledWith(5);
    // Never self-settles.
    expect(onOk).not.toHaveBeenCalled();
    expect(onErr).not.toHaveBeenCalled();
    // Timer is still armed.
    expect(h.timers.size).toBe(1);
  });
});

describe('$interval — invokeApply: false (FS §2.8 opt-out)', () => {
  it('runs ticks WITHOUT going through apply', () => {
    const h = makeHarness();
    const fn = vi.fn();

    h.$interval(fn, 100, 2, false);
    const id = h.lastTimerId();

    h.tick(id);
    h.tick(id);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(h.applyCalls).toHaveLength(0);
  });
});

describe('$interval — phase guard (mid-digest tick)', () => {
  it('runs directly (not via apply) when a digest is already in flight', () => {
    const h = makeHarness({ phase: () => '$digest' });
    const fn = vi.fn();

    h.$interval(fn, 100); // indefinite
    h.tick(h.lastTimerId());

    expect(fn).toHaveBeenCalledOnce();
    // apply would throw '$digest already in progress' — must be bypassed.
    expect(h.applyCalls).toHaveLength(0);
  });
});

describe('$interval — cancellation (FS §2.8)', () => {
  it('cancel rejects the promise and stops further ticks', () => {
    const h = makeHarness();
    const fn = vi.fn();
    const onErr = vi.fn();

    const promise = h.$interval(fn, 100); // indefinite
    promise.catch(onErr);
    const id = h.lastTimerId();

    h.tick(id);
    h.flush();
    expect(fn).toHaveBeenCalledTimes(1);

    expect(h.$interval.cancel(promise)).toBe(true);
    h.flush();
    expect(onErr).toHaveBeenCalledOnce();

    // The timer was cleared — no further ticks run.
    expect(h.timers.size).toBe(0);
    h.tick(id);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel-after-cap returns false and does not throw', () => {
    const h = makeHarness();
    const promise = h.$interval(() => undefined, 100, 1);

    h.tick(h.lastTimerId());
    h.flush();

    expect(() => {
      expect(h.$interval.cancel(promise)).toBe(false);
    }).not.toThrow();
  });

  it('cancel of an unknown / undefined promise returns false and does not throw', () => {
    const h = makeHarness();
    const otherQ = createQ({ exceptionHandler: noopExceptionHandler, scheduleDigest: () => undefined });
    const stranger = otherQ.resolve(1);

    expect(() => {
      expect(h.$interval.cancel(stranger)).toBe(false);
    }).not.toThrow();
    expect(h.$interval.cancel(undefined)).toBe(false);
  });
});

describe('$interval — callback throw routing (FS §2.8)', () => {
  it('routes via the exception handler with cause $interval AND does NOT auto-cancel', () => {
    const seen: Array<{ error: unknown; cause: string | undefined }> = [];
    const handler = (error: unknown, cause?: string): void => {
      seen.push({ error, cause });
    };
    const h = makeHarness({ exceptionHandler: handler });
    const boom = new Error('boom');

    let runs = 0;
    const fn = vi.fn(() => {
      runs += 1;
      throw boom;
    });
    const onOk = vi.fn();
    const onErr = vi.fn();

    const promise = h.$interval(fn, 100); // indefinite
    promise.then(onOk, onErr);
    const id = h.lastTimerId();

    h.tick(id);
    h.flush();
    h.tick(id);
    h.flush();

    // Both ticks ran despite throwing — no auto-cancel.
    expect(runs).toBe(2);
    expect(h.timers.size).toBe(1);

    // Routed twice, cause '$interval' each time.
    expect(seen).toHaveLength(2);
    expect(seen[0]?.error).toBe(boom);
    expect(seen[0]?.cause).toBe('$interval');
    expect(seen[1]?.cause).toBe('$interval');

    // The promise itself is NOT settled by a callback throw.
    expect(onOk).not.toHaveBeenCalled();
    expect(onErr).not.toHaveBeenCalled();
  });
});

describe('$interval — DI registration + digest integration (FS §2.8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("injector.get('$interval') resolves to the callable service", () => {
    const injector = createInjector([ngModule]);
    const $interval = injector.get('$interval');
    expect(typeof $interval).toBe('function');
    expect(typeof $interval.cancel).toBe('function');
  });

  it('ticks after the delay and refreshes a $watch value by default', () => {
    const injector = createInjector([ngModule]);
    const $interval = injector.get('$interval');
    const $rootScope = injector.get('$rootScope') as unknown as Scope & { count?: number };

    let seen: number | undefined;
    $rootScope.$watch(
      (scope: Scope & { count?: number }) => scope.count,
      (newValue: number | undefined) => {
        seen = newValue;
      },
    );
    $rootScope.$digest();
    expect(seen).toBeUndefined();

    $interval(
      (iteration: number) => {
        ($rootScope as { count?: number }).count = iteration;
      },
      50,
      2,
    );

    expect(($rootScope as { count?: number }).count).toBeUndefined();

    vi.advanceTimersByTime(50);
    // $apply ran the tick AND digested — the watcher saw the value with NO
    // manual $apply by the test.
    expect(seen).toBe(1);

    vi.advanceTimersByTime(50);
    expect(seen).toBe(2);
  });
});
