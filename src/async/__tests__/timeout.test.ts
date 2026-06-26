/**
 * `$timeout` tests (spec 037 Slice 3).
 *
 * Covers the one-off deferred task at TWO layers:
 *
 * 1. PURE — `createTimeout(...)` with stub seams (a manual timer registry +
 *    a synchronous `apply`) so the cancellation / phase-guard / error-routing
 *    semantics are provable WITHOUT an injector.
 * 2. DI — `injector.get('$timeout')` + `injector.get('$rootScope')` with vitest
 *    fake timers, exercising the real `$rootScope.$apply` / global `setTimeout`
 *    seams: a fire after the delay refreshes a `$watch`ed value (FS §2.7).
 */

import { ngModule } from '@core/ng-module';
import type { Scope } from '@core/scope';
import { createInjector } from '@di/injector';
import { noopExceptionHandler } from '@exception-handler/index';
import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { createTimeout } from '@async/timeout';
import type { TimeoutService, TimerId } from '@async/async-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A manual timer harness for the PURE layer: `defer` records the callback under
 * a monotonic id; `fire(id)` runs it; `cancelDefer` drops it. `apply` runs the
 * fn synchronously. `rootPhase` is fixed to `null` (no digest) unless a test
 * flips it. A synchronous `flush` drains `$q`'s scheduled continuations.
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
  const $timeout: TimeoutService = createTimeout({
    q,
    exceptionHandler: opts?.exceptionHandler ?? noopExceptionHandler,
    apply: (fn) => {
      applyCalls.push(1);
      fn();
    },
    rootPhase: opts?.phase ?? (() => null),
    defer: (fn) => {
      const id = nextId++ as unknown as TimerId;
      timers.set(id, fn);
      return id;
    },
    cancelDefer: (id) => {
      timers.delete(id);
    },
  });

  const fire = (id: TimerId): void => {
    const fn = timers.get(id);
    timers.delete(id);
    if (fn) {
      fn();
    }
  };

  // The id of the single most-recent timer (tests arm exactly one at a time).
  const lastTimerId = (): TimerId => Array.from(timers.keys()).slice(-1)[0] as TimerId;

  return { $timeout, fire, flush, applyCalls, timers, lastTimerId };
}

describe('$timeout — fires + resolves (FS §2.7)', () => {
  it('runs the callback after the delay and resolves with its return value', () => {
    const h = makeHarness();
    const onOk = vi.fn();

    const promise = h.$timeout(() => 'done', 100);
    promise.then(onOk);

    // Not fired yet.
    h.flush();
    expect(onOk).not.toHaveBeenCalled();

    h.fire(h.lastTimerId());
    h.flush();
    expect(onOk).toHaveBeenCalledExactlyOnceWith('done');
  });

  it('runs inside apply by default (automatic refresh)', () => {
    const h = makeHarness();
    h.$timeout(() => undefined, 0);

    h.fire(h.lastTimerId());
    expect(h.applyCalls).toHaveLength(1);
  });

  it('passes extra args through to the callback', () => {
    const h = makeHarness();
    const fn = vi.fn((a: number, b: string) => `${String(a)}-${b}`);

    // Cast: the public signature types `fn` params as `never[]` so the
    // pass-through args must be supplied positionally.
    const promise = h.$timeout(fn as (...args: never[]) => string, 0, true, 7, 'x');
    const onOk = vi.fn();
    promise.then(onOk);

    h.fire(h.lastTimerId());
    h.flush();
    expect(fn).toHaveBeenCalledExactlyOnceWith(7, 'x');
    expect(onOk).toHaveBeenCalledExactlyOnceWith('7-x');
  });
});

describe('$timeout — invokeApply: false (FS §2.7 opt-out)', () => {
  it('runs the callback WITHOUT going through apply', () => {
    const h = makeHarness();
    const fn = vi.fn(() => 'no-refresh');

    h.$timeout(fn, 0, false);
    h.fire(h.lastTimerId());

    expect(fn).toHaveBeenCalledOnce();
    expect(h.applyCalls).toHaveLength(0);
  });
});

describe('$timeout — phase guard (mid-digest fire)', () => {
  it('runs directly (not via apply) when a digest is already in flight', () => {
    const h = makeHarness({ phase: () => '$digest' });
    const fn = vi.fn(() => 'mid');

    h.$timeout(fn, 0);
    h.fire(h.lastTimerId());

    expect(fn).toHaveBeenCalledOnce();
    // apply would throw '$digest already in progress' — must be bypassed.
    expect(h.applyCalls).toHaveLength(0);
  });
});

describe('$timeout — cancellation (FS §2.7)', () => {
  it('cancel-before-fire rejects the promise and the work never runs', () => {
    const h = makeHarness();
    const fn = vi.fn();
    const onErr = vi.fn();

    const promise = h.$timeout(fn, 100);
    promise.catch(onErr);

    expect(h.$timeout.cancel(promise)).toBe(true);

    // The timer was cleared — even if a fire were attempted, the registry
    // dropped it, so the work never runs.
    expect(h.timers.size).toBe(0);
    h.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(onErr).toHaveBeenCalledOnce();
  });

  it('cancel-after-settle returns false and does not throw', () => {
    const h = makeHarness();
    const promise = h.$timeout(() => 'ok', 0);

    h.fire(h.lastTimerId());
    h.flush();

    expect(() => {
      expect(h.$timeout.cancel(promise)).toBe(false);
    }).not.toThrow();
  });

  it('cancel of an unknown promise returns false and does not throw', () => {
    const h = makeHarness();
    const otherQ = createQ({ exceptionHandler: noopExceptionHandler, scheduleDigest: () => undefined });
    const stranger = otherQ.resolve(1);

    expect(() => {
      expect(h.$timeout.cancel(stranger)).toBe(false);
    }).not.toThrow();
    expect(h.$timeout.cancel(undefined)).toBe(false);
  });
});

describe('$timeout — callback throw routing (FS §2.7)', () => {
  it('rejects the promise AND routes via the exception handler with cause $timeout', () => {
    const seen: Array<{ error: unknown; cause: string | undefined }> = [];
    const handler = (error: unknown, cause?: string): void => {
      seen.push({ error, cause });
    };
    const h = makeHarness({ exceptionHandler: handler });
    const boom = new Error('boom');
    const onErr = vi.fn();

    const promise = h.$timeout(() => {
      throw boom;
    }, 0);
    promise.catch(onErr);

    h.fire(h.lastTimerId());
    h.flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith(boom);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.error).toBe(boom);
    expect(seen[0]?.cause).toBe('$timeout');
  });
});

describe('$timeout — DI registration + digest integration (FS §2.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("injector.get('$timeout') resolves to the callable service", () => {
    const injector = createInjector([ngModule]);
    const $timeout = injector.get('$timeout');
    expect(typeof $timeout).toBe('function');
    expect(typeof $timeout.cancel).toBe('function');
  });

  it('fires after the delay and refreshes a $watch value by default', () => {
    const injector = createInjector([ngModule]);
    const $timeout = injector.get('$timeout');
    const $rootScope = injector.get('$rootScope') as unknown as Scope & { value?: string };

    let seen: string | undefined;
    $rootScope.$watch(
      (scope: Scope & { value?: string }) => scope.value,
      (newValue: string | undefined) => {
        seen = newValue;
      },
    );
    $rootScope.$digest();
    expect(seen).toBeUndefined();

    $timeout(() => {
      ($rootScope as { value?: string }).value = 'fresh';
    }, 50);

    // Before the delay elapses, nothing changed.
    expect(($rootScope as { value?: string }).value).toBeUndefined();

    vi.advanceTimersByTime(50);

    // $apply ran the callback AND digested — the watcher saw the new value
    // with NO manual $apply by the test.
    expect(($rootScope as { value?: string }).value).toBe('fresh');
    expect(seen).toBe('fresh');
  });
});
