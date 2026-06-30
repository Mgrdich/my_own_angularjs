/**
 * `$q` construction-surface, combiner, and unhandled-rejection tests
 * (spec 037 Slice 2).
 *
 * All cases run at the PURE layer — `createQ(...)` with a synchronous
 * `scheduleDigest` stand-in drained by `flush()` and a spy `exceptionHandler`
 * — so the executor constructor, the wrap-a-value statics, `.catch` /
 * `.finally`, the three combiners, and the always-on unhandled-rejection
 * reporting are all provable WITHOUT an injector (FS §2.2 / §2.3 / §2.4 / §2.6).
 *
 * The `EXCEPTION_HANDLER_CAUSES.length === 13` guard at the bottom pins the
 * single tuple touch the whole spec makes (the `'$q'` / `'$timeout'` /
 * `'$interval'` trio).
 */

import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler } from '@exception-handler/index';
import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { describe, expect, it, vi } from 'vitest';

/**
 * Build a pure `$q` whose `scheduleDigest` drains queued continuations when the
 * test calls `flush()`, plus a spy `exceptionHandler` so unhandled-rejection
 * routing is observable.
 */
function makePureQ(): { q: QService; flush: () => void; exceptionHandler: ReturnType<typeof vi.fn> } {
  let queue: Array<() => void> = [];
  const exceptionHandler = vi.fn<ExceptionHandler>();
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
  return { q, flush, exceptionHandler };
}

describe('$q(executor) — direct construction (FS §2.2)', () => {
  it('resolves when the executor signals success', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q<number>((resolve) => {
      resolve(42);
    }).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('rejects when the executor signals failure', () => {
    const { q, flush } = makePureQ();
    const onErr = vi.fn();

    q<number>((_resolve, reject) => {
      reject('nope');
    }).then(undefined, onErr);
    flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('nope');
  });

  it('a thrown executor becomes a rejection', () => {
    const { q, flush } = makePureQ();
    const onErr = vi.fn();

    q<number>(() => {
      throw new Error('executor boom');
    }).then(undefined, onErr);
    flush();

    expect(onErr).toHaveBeenCalledOnce();
    expect((onErr.mock.calls[0]?.[0] as Error).message).toBe('executor boom');
  });
});

describe('$q.resolve / $q.when / $q.reject (FS §2.2)', () => {
  it('resolve wraps a plain value as an immediately-succeeded promise', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q.resolve(7).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('when is an alias of resolve', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q.when('hi').then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith('hi');
  });

  it('reject wraps a reason as an immediately-failed promise', () => {
    const { q, flush } = makePureQ();
    const onErr = vi.fn();

    q.reject('bad').then(undefined, onErr);
    flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('bad');
  });

  it('resolve adopts a thenable — no promise-of-a-promise (FS §2.2)', () => {
    const { q, flush } = makePureQ();
    const inner = q.resolve(99);
    const onOk = vi.fn();

    // Wrapping a promise yields an equivalent promise, NOT a promise-of-promise:
    // the success follow-up receives the inner VALUE, never a nested promise.
    q.resolve(inner).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledOnce();
    expect(onOk.mock.calls[0]?.[0]).toBe(99);
  });

  it('resolve adopts a deferred thenable and awaits it', () => {
    const { q, flush } = makePureQ();
    const deferred = q.defer<number>();
    const onOk = vi.fn();

    q.resolve(deferred.promise).then(onOk);
    flush();
    expect(onOk).not.toHaveBeenCalled();

    deferred.resolve(5);
    flush();
    expect(onOk).toHaveBeenCalledExactlyOnceWith(5);
  });
});

describe('$q .catch — failure-only shorthand (FS §2.3)', () => {
  it('runs on failure with the reason', () => {
    const { q, flush } = makePureQ();
    const onErr = vi.fn();

    q.reject('kaboom').catch(onErr);
    flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('kaboom');
  });

  it('does NOT run on success — the value passes through', () => {
    const { q, flush } = makePureQ();
    const onErr = vi.fn();
    const onOk = vi.fn();

    q.resolve(1).catch(onErr).then(onOk);
    flush();

    expect(onErr).not.toHaveBeenCalled();
    expect(onOk).toHaveBeenCalledExactlyOnceWith(1);
  });
});

describe('$q .finally — cleanup follow-up (FS §2.3)', () => {
  it('runs on success and passes the value through unchanged', () => {
    const { q, flush } = makePureQ();
    const cleanup = vi.fn();
    const onOk = vi.fn();

    q.resolve(10).finally(cleanup).then(onOk);
    flush();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(onOk).toHaveBeenCalledExactlyOnceWith(10);
  });

  it('runs on failure and passes the reason through unchanged', () => {
    const { q, flush } = makePureQ();
    const cleanup = vi.fn();
    const onErr = vi.fn();

    q.reject('reason').finally(cleanup).then(undefined, onErr);
    flush();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(onErr).toHaveBeenCalledExactlyOnceWith('reason');
  });

  it('a throwing cleanup OVERRIDES the pass-through with its own rejection', () => {
    const { q, flush } = makePureQ();
    const onErr = vi.fn();

    q.resolve(10)
      .finally(() => {
        throw new Error('cleanup failed');
      })
      .then(undefined, onErr);
    flush();

    expect(onErr).toHaveBeenCalledOnce();
    expect((onErr.mock.calls[0]?.[0] as Error).message).toBe('cleanup failed');
  });

  it('a cleanup returning a rejecting thenable OVERRIDES the pass-through', () => {
    const { q, flush } = makePureQ();
    const onErr = vi.fn();

    q.resolve(10)
      .finally(() => q.reject('async cleanup failed'))
      .then(undefined, onErr);
    flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('async cleanup failed');
  });
});

describe('$q.all — wait for all (FS §2.4)', () => {
  it('positional array: succeeds with values in input order', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q.all([q.resolve(1), q.resolve(2), 3]).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledOnce();
    expect(onOk.mock.calls[0]?.[0]).toEqual([1, 2, 3]);
  });

  it('keyed object: succeeds with values under the same keys', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q.all({ a: q.resolve('x'), b: 2 }).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledOnce();
    expect(onOk.mock.calls[0]?.[0]).toEqual({ a: 'x', b: 2 });
  });

  it('rejects with the FIRST failing reason', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();
    const onErr = vi.fn();

    q.all([q.resolve(1), q.reject('first-fail'), q.reject('second-fail')]).then(onOk, onErr);
    flush();

    expect(onOk).not.toHaveBeenCalled();
    expect(onErr).toHaveBeenCalledExactlyOnceWith('first-fail');
  });

  it('an empty array resolves immediately with an empty array', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q.all([]).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledOnce();
    expect(onOk.mock.calls[0]?.[0]).toEqual([]);
  });
});

describe('$q.race — wait for first (FS §2.4, intentional addition §3)', () => {
  it('adopts the first SUCCESS settlement and ignores the rest', () => {
    const { q, flush } = makePureQ();
    const fast = q.defer<string>();
    const slow = q.defer<string>();
    const onOk = vi.fn();
    const onErr = vi.fn();

    q.race([fast.promise, slow.promise]).then(onOk, onErr);

    fast.resolve('fast');
    slow.resolve('slow'); // ignored — finality
    flush();

    expect(onOk).toHaveBeenCalledExactlyOnceWith('fast');
    expect(onErr).not.toHaveBeenCalled();
  });

  it('adopts the first FAILURE settlement', () => {
    const { q, flush } = makePureQ();
    const fast = q.defer<string>();
    const slow = q.defer<string>();
    const onErr = vi.fn();

    q.race([fast.promise, slow.promise]).then(undefined, onErr);

    fast.reject('fast-fail');
    slow.resolve('slow'); // ignored
    flush();

    expect(onErr).toHaveBeenCalledExactlyOnceWith('fast-fail');
  });
});

describe('$q.allSettled — wait for every (FS §2.4, intentional addition §3)', () => {
  it('NEVER rejects; reports per-item discriminated outcomes', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();
    const onErr = vi.fn();

    q.allSettled([q.resolve(1), q.reject('boom'), 3]).then(onOk, onErr);
    flush();

    expect(onErr).not.toHaveBeenCalled();
    expect(onOk).toHaveBeenCalledOnce();
    expect(onOk.mock.calls[0]?.[0]).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: 'boom' },
      { status: 'fulfilled', value: 3 },
    ]);
  });

  it('an empty iterable resolves immediately with an empty report', () => {
    const { q, flush } = makePureQ();
    const onOk = vi.fn();

    q.allSettled([]).then(onOk);
    flush();

    expect(onOk).toHaveBeenCalledOnce();
    expect(onOk.mock.calls[0]?.[0]).toEqual([]);
  });
});

describe('$q — unhandled-rejection reporting (FS §2.6)', () => {
  it('a rejection with NO failure handler is reported via $exceptionHandler("$q")', () => {
    const { q, flush, exceptionHandler } = makePureQ();
    const deferred = q.defer<number>();

    deferred.reject('unhandled-reason');
    flush();

    expect(exceptionHandler).toHaveBeenCalledExactlyOnceWith('unhandled-reason', '$q');
  });

  it('q.reject with no handler is reported as unhandled', () => {
    const { q, flush, exceptionHandler } = makePureQ();

    q.reject(new Error('lonely'));
    flush();

    expect(exceptionHandler).toHaveBeenCalledOnce();
    expect((exceptionHandler.mock.calls[0]?.[0] as Error).message).toBe('lonely');
    expect(exceptionHandler.mock.calls[0]?.[1]).toBe('$q');
  });

  it('a failure handled by .catch is NOT reported as unhandled', () => {
    const { q, flush, exceptionHandler } = makePureQ();

    q.reject('handled').catch(() => {
      /* swallow */
    });
    flush();

    expect(exceptionHandler).not.toHaveBeenCalled();
  });

  it('a failure handled by then(_, onErr) is NOT reported as unhandled', () => {
    const { q, flush, exceptionHandler } = makePureQ();
    const deferred = q.defer<number>();

    deferred.promise.then(undefined, () => {
      /* swallow */
    });
    deferred.reject('also-handled');
    flush();

    expect(exceptionHandler).not.toHaveBeenCalled();
  });

  it('handled-LATER (handler attached before the deferred check fires) is NOT reported', () => {
    const { q, flush, exceptionHandler } = makePureQ();
    const deferred = q.defer<number>();

    // Reject FIRST, then attach the handler before flushing — the deferred
    // unhandled check runs on the scheduled turn, by which point the handler
    // has flipped the `handled` flag.
    deferred.reject('attached-later');
    deferred.promise.catch(() => {
      /* swallow */
    });
    flush();

    expect(exceptionHandler).not.toHaveBeenCalled();
  });

  it('an unhandled rejection at the TIP of a then-chain is reported once', () => {
    const { q, flush, exceptionHandler } = makePureQ();

    // The .then has no failure handler, so the rejection passes to the derived
    // tip — which has no handler either — and is reported exactly once.
    q.reject('chain-tip').then((v) => v);
    flush();

    expect(exceptionHandler).toHaveBeenCalledOnce();
    expect(exceptionHandler.mock.calls[0]?.[1]).toBe('$q');
  });
});

describe('EXCEPTION_HANDLER_CAUSES — spec 037 tuple guard', () => {
  it('is exactly 13 entries (the single tuple touch for spec 037)', () => {
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(13);
  });

  it('contains the three async cause tokens', () => {
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$q');
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$timeout');
    expect(EXCEPTION_HANDLER_CAUSES).toContain('$interval');
  });
});
