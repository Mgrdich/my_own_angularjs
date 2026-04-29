import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scope } from '@core/index';
import { consoleErrorExceptionHandler, type ExceptionHandler } from '@exception-handler/index';

describe('Scope — $exceptionHandler integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Scope.create — exceptionHandler option', () => {
    it('defaults to consoleErrorExceptionHandler when no option is provided', () => {
      const scope = Scope.create();
      expect(scope.$$exceptionHandler).toBe(consoleErrorExceptionHandler);
    });

    it('stores the provided custom handler on $$exceptionHandler', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create({ exceptionHandler: spy });
      expect(scope.$$exceptionHandler).toBe(spy);
    });

    it('honors both ttl and exceptionHandler options together', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create({ ttl: 5, exceptionHandler: spy });
      expect(scope.$$exceptionHandler).toBe(spy);
      expect(scope.$$ttl).toBe(5);
    });
  });

  describe('Child scopes — root handler resolution', () => {
    it('routes child watch errors through the root scope handler (no per-child copy)', () => {
      const spy = vi.fn<ExceptionHandler>();
      const root = Scope.create({ exceptionHandler: spy });
      const child = root.$new();

      child.$watch(() => {
        throw new Error('child-watch-broke');
      });

      child.$digest();

      expect(spy).toHaveBeenCalled();
      const calls = spy.mock.calls.filter((call) => call[1] === 'watchFn');
      expect(calls.length).toBeGreaterThan(0);
      const firstWatchFnCall = calls[0];
      expect(firstWatchFnCall).toBeDefined();
      expect(firstWatchFnCall?.[0]).toBeInstanceOf(Error);
    });

    it('mutating root.$$exceptionHandler is reflected in child digest behavior', () => {
      const initialSpy = vi.fn<ExceptionHandler>();
      const replacementSpy = vi.fn<ExceptionHandler>();
      const root = Scope.create({ exceptionHandler: initialSpy });
      const child = root.$new();

      child.$watch(() => {
        throw new Error('boom');
      });

      // Replace handler on the root after registration; child resolves via $root.
      root.$$exceptionHandler = replacementSpy;

      child.$digest();

      expect(replacementSpy).toHaveBeenCalled();
      expect(initialSpy).not.toHaveBeenCalled();
    });
  });

  describe('Digest call sites — log and continue', () => {
    it('routes watch-function throws with cause "watchFn" and continues the digest', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create<{ aValue: number }>({ exceptionHandler: spy });
      scope.aValue = 1;
      let cleanCounter = 0;

      const watchErr = new Error('watch-broke');
      scope.$watch(() => {
        throw watchErr;
      });

      scope.$watch(
        () => scope.aValue,
        () => {
          cleanCounter++;
        },
      );

      expect(() => {
        scope.$digest();
      }).not.toThrow();

      const watchFnCalls = spy.mock.calls.filter((call) => call[1] === 'watchFn');
      expect(watchFnCalls.length).toBeGreaterThan(0);
      expect(watchFnCalls[0]?.[0]).toBe(watchErr);
      expect(cleanCounter).toBeGreaterThan(0);
    });

    it('routes watch-listener throws with cause "watchListener", updates last, and continues', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create<{ aValue: number }>({ exceptionHandler: spy });
      scope.aValue = 1;
      let listenerCalls = 0;

      scope.$watch(
        () => scope.aValue,
        () => {
          listenerCalls++;
          throw new Error('listener-broke');
        },
      );

      // First digest: dirty (initWatchVal -> 1), listener fires and throws.
      expect(() => {
        scope.$digest();
      }).not.toThrow();

      const listenerCallsAfterFirst = spy.mock.calls.filter((call) => call[1] === 'watchListener');
      expect(listenerCallsAfterFirst.length).toBe(1);
      expect(listenerCallsAfterFirst[0]?.[0]).toBeInstanceOf(Error);
      expect(listenerCalls).toBe(1);

      // Change the value; second digest should not infinite-loop (proves `last` was
      // updated despite the listener throw — TTL would otherwise trip).
      scope.aValue = 2;
      expect(() => {
        scope.$digest();
      }).not.toThrow();

      // Listener fired again after value change → bookkeeping intact.
      expect(listenerCalls).toBe(2);
    });

    it('routes $evalAsync task throws with cause "$evalAsync" and runs subsequent tasks', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create({ exceptionHandler: spy });
      let cleanRan = false;

      scope.$evalAsync(() => {
        throw new Error('eval-async-broke');
      });
      scope.$evalAsync(() => {
        cleanRan = true;
      });

      expect(() => {
        scope.$digest();
      }).not.toThrow();

      const evalAsyncCalls = spy.mock.calls.filter((call) => call[1] === '$evalAsync');
      expect(evalAsyncCalls.length).toBe(1);
      expect(evalAsyncCalls[0]?.[0]).toBeInstanceOf(Error);
      expect(cleanRan).toBe(true);
    });

    it('routes $applyAsync task throws with cause "$applyAsync" and runs subsequent tasks', () => {
      vi.useFakeTimers();
      try {
        const spy = vi.fn<ExceptionHandler>();
        const scope = Scope.create<{ aValue: string }>({ exceptionHandler: spy });

        scope.$applyAsync(() => {
          throw new Error('apply-async-broke');
        });
        scope.$applyAsync(() => {
          scope.aValue = 'applied';
        });

        vi.advanceTimersByTime(0);

        const applyAsyncCalls = spy.mock.calls.filter((call) => call[1] === '$applyAsync');
        expect(applyAsyncCalls.length).toBe(1);
        expect(applyAsyncCalls[0]?.[0]).toBeInstanceOf(Error);
        expect(scope.aValue).toBe('applied');
      } finally {
        vi.useRealTimers();
      }
    });

    it('routes $$postDigest callback throws with cause "$$postDigest" and runs subsequent callbacks', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create({ exceptionHandler: spy });
      let cleanRan = false;

      scope.$$postDigest(() => {
        throw new Error('post-broke');
      });
      scope.$$postDigest(() => {
        cleanRan = true;
      });

      expect(() => {
        scope.$digest();
      }).not.toThrow();

      const postCalls = spy.mock.calls.filter((call) => call[1] === '$$postDigest');
      expect(postCalls.length).toBe(1);
      expect(postCalls[0]?.[0]).toBeInstanceOf(Error);
      expect(cleanRan).toBe(true);
    });

    it('routes $on listener throws with cause "eventListener" without stopping $emit propagation', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create({ exceptionHandler: spy });
      const child = scope.$new();
      const flags = { first: false, third: false, parent: false };

      child.$on('foo', () => {
        flags.first = true;
      });
      child.$on('foo', () => {
        throw new Error('listener-broke');
      });
      child.$on('foo', () => {
        flags.third = true;
      });
      scope.$on('foo', () => {
        flags.parent = true;
      });

      expect(() => {
        child.$emit('foo');
      }).not.toThrow();

      const eventCalls = spy.mock.calls.filter((call) => call[1] === 'eventListener');
      expect(eventCalls.length).toBe(1);
      expect(eventCalls[0]?.[0]).toBeInstanceOf(Error);

      // Sibling listeners on the same scope still ran.
      expect(flags.first).toBe(true);
      expect(flags.third).toBe(true);
      // And propagation continued upward to the parent.
      expect(flags.parent).toBe(true);
    });

    it('routes $on listener throws with cause "eventListener" without stopping $broadcast propagation', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create({ exceptionHandler: spy });
      const child = scope.$new();
      const flags = { parent: false, childRan: false };

      scope.$on('foo', () => {
        throw new Error('listener-broke');
      });
      scope.$on('foo', () => {
        flags.parent = true;
      });
      child.$on('foo', () => {
        flags.childRan = true;
      });

      expect(() => {
        scope.$broadcast('foo');
      }).not.toThrow();

      const eventCalls = spy.mock.calls.filter((call) => call[1] === 'eventListener');
      expect(eventCalls.length).toBe(1);
      expect(flags.parent).toBe(true);
      expect(flags.childRan).toBe(true);
    });
  });

  describe('Recursion guard — handler that throws', () => {
    it('does not crash the digest when the handler itself throws; secondary log is emitted', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const throwingHandler = vi.fn<ExceptionHandler>(() => {
        throw new Error('handler-broke');
      });
      // Pin TTL low so the digest deterministically completes (the watchFn is dirty
      // forever — without a low TTL the test would hit the default of 10 iterations).
      const scope = Scope.create({ ttl: 2, exceptionHandler: throwingHandler });

      scope.$watch(() => {
        throw new Error('watch-broke');
      });

      // The TTL exhaustion error from the digest loop should NOT escape because
      // the only dirty signal comes from a thrown watchFn (which is caught and
      // does not mark anything dirty). Confirm $digest stays silent.
      expect(() => {
        scope.$digest();
      }).not.toThrow();

      expect(throwingHandler).toHaveBeenCalled();

      // The recursion-guard `console.error` MUST have been called at least once,
      // with the exact 4-arg shape produced by `invokeExceptionHandler`.
      expect(consoleSpy).toHaveBeenCalled();
      const guardCalls = consoleSpy.mock.calls.filter(
        (call) => call[0] === '[$exceptionHandler] handler threw while reporting:',
      );
      expect(guardCalls.length).toBeGreaterThan(0);
      const firstGuardCall = guardCalls[0];
      expect(firstGuardCall).toBeDefined();
      expect(firstGuardCall?.[1]).toBeInstanceOf(Error);
      expect(firstGuardCall?.[2]).toBe('original exception was:');
      expect(firstGuardCall?.[3]).toBeInstanceOf(Error);
    });
  });

  describe('Digest TTL exhaustion routing', () => {
    it('routes the TTL error through the handler exactly once with cause "$digest"', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create({ ttl: 2, exceptionHandler: spy });

      // Returns a fresh object literal on every pass — reference equality is
      // always dirty, so the digest cannot stabilize and TTL trips deterministically.
      scope.$watch(
        () => ({}),
        () => {},
      );

      expect(() => {
        scope.$digest();
      }).toThrow(/iterations reached\. Aborting!/);

      expect(spy).toHaveBeenCalledTimes(1);

      const callArgs = spy.mock.calls[0];
      expect(callArgs).toBeDefined();
      const reportedError = callArgs?.[0];
      const reportedCause = callArgs?.[1];
      expect(reportedError).toBeInstanceOf(Error);
      expect(reportedCause).toBe('$digest');
      expect((reportedError as Error).message).toContain('2 digest iterations reached. Aborting!');
      expect((reportedError as Error).message).toContain('Last dirty watcher:');
    });

    it('re-throws the SAME Error instance the handler received to the $apply caller', () => {
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create({ ttl: 2, exceptionHandler: spy });

      scope.$watch(
        () => ({}),
        () => {},
      );

      let thrown: unknown;
      try {
        scope.$apply(() => {});
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/iterations reached\. Aborting!/);

      // The Error instance handed to the handler must be the very same instance
      // re-thrown to the caller — no cloning, no rewrapping.
      const reportedError = spy.mock.calls[0]?.[0];
      expect(thrown).toBe(reportedError);
    });

    it('still re-throws the TTL error when the handler itself throws (recursion guard)', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const throwingHandler = vi.fn<ExceptionHandler>(() => {
        throw new Error('handler-broke');
      });
      const scope = Scope.create({ ttl: 2, exceptionHandler: throwingHandler });

      scope.$watch(
        () => ({}),
        () => {},
      );

      expect(() => {
        scope.$apply(() => {});
      }).toThrow(/iterations reached\. Aborting!/);

      // Handler invoked once at TTL exhaustion; the recursion guard prevents re-entry.
      expect(throwingHandler).toHaveBeenCalledTimes(1);

      // The secondary `console.error` from the recursion guard must carry the
      // exact 4-arg shape AND the original exception arg must be the TTL error.
      const guardCalls = consoleSpy.mock.calls.filter(
        (call) => call[0] === '[$exceptionHandler] handler threw while reporting:',
      );
      expect(guardCalls.length).toBe(1);
      const firstGuardCall = guardCalls[0];
      expect(firstGuardCall).toBeDefined();
      expect(firstGuardCall?.[1]).toBeInstanceOf(Error);
      expect(firstGuardCall?.[2]).toBe('original exception was:');
      expect(firstGuardCall?.[3]).toBeInstanceOf(Error);
      expect((firstGuardCall?.[3] as Error).message).toContain('iterations reached. Aborting!');
    });
  });

  describe('Backwards compatibility — default behavior', () => {
    it('Scope.create() with no options still routes watch errors to console.error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const scope = Scope.create();

      scope.$watch(() => {
        throw new Error('default-watch-broke');
      });

      expect(() => {
        scope.$digest();
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalled();
      // The default handler is consoleErrorExceptionHandler, which logs with the
      // 3-arg shape `'[$exceptionHandler]', err, 'watchFn'`. Assert the cause arg
      // shows up in at least one call to lock the route end-to-end.
      const watchFnCalls = consoleSpy.mock.calls.filter((call) => call[2] === 'watchFn');
      expect(watchFnCalls.length).toBeGreaterThan(0);
    });
  });
});
