/**
 * `$q` / `$timeout` / `$interval` AngularJS-parity hardening (spec 037 Slice 5).
 *
 * Ports the relevant upstream behavioral scenarios (per the architecture's
 * reference-implementation rule) that the slice 1–4 suites do NOT already
 * cover — promise digest-scheduling cadence, unhandled-rejection vectors,
 * cancellation signal semantics, and `all` / `race` edge cases.
 *
 * The intentional ADDITIONS beyond classic `$q` (FS §3 — `race`, `allSettled`,
 * the `$q(executor)` constructor, `.catch` / `.finally`) are labelled inline so
 * they read as deliberate, not as parity gaps.
 *
 * All cases run at the PURE layer with a synchronous `scheduleDigest` stand-in
 * (no injector) — the DI-seam integration is already covered by the slice 1–4
 * `*.test.ts` files.
 */

import { noopExceptionHandler } from '@exception-handler/index';
import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { createTimeout } from '@async/timeout';
import { createInterval } from '@async/interval';
import type { IntervalService, TimeoutService, TimerId } from '@async/async-types';
import { describe, expect, it, vi } from 'vitest';

/** A pure `$q` whose `scheduleDigest` drains queued continuations on `flush()`. */
function makePureQ(exceptionHandler = noopExceptionHandler): { q: QService; flush: () => void } {
  let queue: Array<() => void> = [];
  const q = createQ({
    exceptionHandler,
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
  return { q, flush };
}

/** A pure `$timeout` over a manual timer registry (mirrors `timeout.test.ts`). */
function makeTimeoutHarness(exceptionHandler = noopExceptionHandler) {
  const timers = new Map<TimerId, () => void>();
  let nextId = 1;
  const { q, flush } = makePureQ(exceptionHandler);

  const $timeout: TimeoutService = createTimeout({
    q,
    exceptionHandler,
    apply: (fn) => {
      fn();
    },
    rootPhase: () => null,
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
    fn?.();
  };
  const lastTimerId = (): TimerId => Array.from(timers.keys()).slice(-1)[0] as TimerId;

  return { $timeout, fire, flush, lastTimerId, timers };
}

/** A pure `$interval` over a manual repeating-timer registry (mirrors `interval.test.ts`). */
function makeIntervalHarness(exceptionHandler = noopExceptionHandler) {
  const timers = new Map<TimerId, () => void>();
  let nextId = 1;
  const { q, flush } = makePureQ(exceptionHandler);

  const $interval: IntervalService = createInterval({
    q,
    exceptionHandler,
    apply: (fn) => {
      fn();
    },
    rootPhase: () => null,
    setIntervalFn: (fn) => {
      const id = nextId++ as unknown as TimerId;
      timers.set(id, fn);
      return id;
    },
    clearIntervalFn: (id) => {
      timers.delete(id);
    },
  });

  const tick = (id: TimerId): void => {
    timers.get(id)?.();
  };
  const lastTimerId = (): TimerId => Array.from(timers.keys()).slice(-1)[0] as TimerId;

  return { $interval, tick, flush, lastTimerId, timers };
}

describe('$q parity — digest-scheduling cadence (FS §2.5)', () => {
  it('.then callbacks do NOT run synchronously on resolve; they run on the next digest', () => {
    const { q, flush } = makePureQ();
    const order: string[] = [];

    const deferred = q.defer<number>();
    deferred.promise.then(() => {
      order.push('then');
    });

    deferred.resolve(1);
    order.push('after-resolve');
    // The continuation has NOT run yet — it is queued for the next turn.
    expect(order).toEqual(['after-resolve']);

    flush();
    expect(order).toEqual(['after-resolve', 'then']);
  });

  it('multiple .then on the SAME promise fire in registration order', () => {
    const { q, flush } = makePureQ();
    const order: number[] = [];

    const deferred = q.defer<undefined>();
    deferred.promise.then(() => order.push(1));
    deferred.promise.then(() => order.push(2));
    deferred.promise.then(() => order.push(3));

    deferred.resolve(undefined);
    flush();

    expect(order).toEqual([1, 2, 3]);
  });

  it('resolving with a thenable ADOPTS it — the follow-up sees the inner value', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    const outer = q.defer<number>();
    const inner = q.defer<number>();

    outer.promise.then(onOk);
    // Resolve the outer deferred WITH the inner promise — outer must await inner.
    outer.resolve(inner.promise);
    flush();
    expect(onOk).not.toHaveBeenCalled();

    inner.resolve(77);
    flush();
    expect(onOk).toHaveBeenCalledExactlyOnceWith(77);
  });
});

describe('$q parity — unhandled-rejection vectors (FS §2.6)', () => {
  it('a rejected promise with NO handler reports exactly once via $exceptionHandler("$q")', () => {
    const handler = vi.fn();
    const { q, flush } = makePureQ(handler);

    q.reject(new Error('lonely'));
    flush();
    // A second flush must not re-report — the deferred check ran once.
    flush();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[1]).toBe('$q');
  });

  it('a .catch ANYWHERE in the chain suppresses the report', () => {
    const handler = vi.fn();
    const { q, flush } = makePureQ(handler);

    q.reject('boom')
      .then((v) => v)
      .then((v) => v)
      .catch(() => 'recovered');
    flush();

    expect(handler).not.toHaveBeenCalled();
  });

  it('$q.reject(...).catch(...) is clean — no report (intentional addition: .catch, FS §3)', () => {
    const handler = vi.fn();
    const { q, flush } = makePureQ(handler);

    q.reject('handled').catch(() => undefined);
    flush();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('$timeout parity — cancellation signal (FS §2.7)', () => {
  it('cancel rejects the promise with the cancellation signal', () => {
    const h = makeTimeoutHarness();
    const onErr = vi.fn();

    const promise = h.$timeout(() => 'work', 100);
    promise.catch(onErr);

    expect(h.$timeout.cancel(promise)).toBe(true);
    h.flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('canceled');
  });

  it('double-cancel returns false on the second call', () => {
    const h = makeTimeoutHarness();
    const promise = h.$timeout(() => 'work', 100);

    expect(h.$timeout.cancel(promise)).toBe(true);
    expect(h.$timeout.cancel(promise)).toBe(false);
  });
});

describe('$interval parity — cancellation signal (FS §2.8)', () => {
  it('cancel rejects the promise with the cancellation signal', () => {
    const h = makeIntervalHarness();
    const onErr = vi.fn();

    const promise = h.$interval(() => undefined, 100); // indefinite
    promise.catch(onErr);

    expect(h.$interval.cancel(promise)).toBe(true);
    h.flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('canceled');
  });

  it('double-cancel returns false on the second call', () => {
    const h = makeIntervalHarness();
    const promise = h.$interval(() => undefined, 100);

    expect(h.$interval.cancel(promise)).toBe(true);
    expect(h.$interval.cancel(promise)).toBe(false);
  });
});

describe('$q.all — edge cases (FS §2.4)', () => {
  it('an empty array resolves immediately with []', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q.all([]).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('a mix of promises and plain values resolves with all values in order', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    // Plain values are treated as already-resolved; promise slots are awaited.
    q.all([1, q.resolve(2), 3, q.resolve(4)]).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith([1, 2, 3, 4]);
  });
});

describe('$q.race — edge cases (FS §2.4, intentional addition §3)', () => {
  it('an empty iterable stays PENDING forever (never settles)', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();
    const onErr = vi.fn();

    q.race([]).then(onOk, onErr);
    flush();

    expect(onOk).not.toHaveBeenCalled();
    expect(onErr).not.toHaveBeenCalled();
  });

  it('first-settles-wins — a later settlement is ignored (intentional addition: race, FS §3)', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    const a = q.defer<string>();
    const b = q.defer<string>();
    q.race([a.promise, b.promise]).then(onOk);

    a.resolve('a-wins');
    b.resolve('b-too-late'); // ignored — race already settled
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith('a-wins');
  });

  it('a plain (non-promise) input settles the race immediately', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q.race(['immediate', q.defer<string>().promise]).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith('immediate');
  });
});

describe('$q.allSettled — intentional addition §3', () => {
  it('never rejects as a whole even when every input fails (intentional addition: allSettled, FS §3)', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();
    const onErr = vi.fn();

    q.allSettled([q.reject('a'), q.reject('b')]).then(onOk, onErr);
    flush();

    expect(onErr).not.toHaveBeenCalled();
    expect(onOk).toHaveBeenCalledExactlyOnceWith([
      { status: 'rejected', reason: 'a' },
      { status: 'rejected', reason: 'b' },
    ]);
  });
});

describe('$q(executor) — intentional addition §3', () => {
  it('the ES6-style executor constructor settles the promise (intentional addition: executor, FS §3)', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q<number>((resolve) => {
      resolve(99);
    }).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith(99);
  });
});
