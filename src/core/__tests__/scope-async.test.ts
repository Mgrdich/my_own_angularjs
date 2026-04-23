import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Scope } from '@core/index';

describe('Scope', () => {
  describe('$eval', () => {
    it("executes $eval'd function and returns result", () => {
      const scope = Scope.create<{ aValue: number }>();
      scope.aValue = 42;

      const result = scope.$eval(() => scope.aValue);

      expect(result).toBe(42);
    });

    it('passes the scope as first argument', () => {
      const scope = new Scope();
      const fn = vi.fn();
      scope.$eval(fn);
      expect(fn).toHaveBeenCalledWith(scope, undefined);
    });

    it('passes locals as second argument', () => {
      const scope = new Scope();
      const locals = { extra: 'data' };
      const fn = vi.fn();

      scope.$eval(fn, locals);

      expect(fn).toHaveBeenCalledWith(scope, locals);
    });

    it('returns undefined when called without arguments', () => {
      const scope = new Scope();
      const result = scope.$eval();
      expect(result).toBeUndefined();
    });
  });

  describe('$apply', () => {
    it("executes $apply'd function and triggers digest", () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'someValue';
      let counter = 0;

      scope.$watch(
        () => scope.aValue,
        () => {
          counter++;
        },
      );

      scope.$digest();
      expect(counter).toBe(1);

      scope.$apply(() => {
        scope.aValue = 'otherValue';
      });
      expect(counter).toBe(2);
    });

    it("sets $$phase to '$apply' during $apply", () => {
      const scope = new Scope();
      let phaseInApply: unknown = null;

      scope.$apply((s) => {
        phaseInApply = s.$$phase;
      });

      expect(phaseInApply).toBe('$apply');
    });

    it('triggers digest even if expression throws', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'someValue';
      let counter = 0;

      scope.$watch(
        () => scope.aValue,
        () => {
          counter++;
        },
      );

      expect(() => {
        scope.$apply(() => {
          scope.aValue = 'otherValue';
          throw new Error('apply error');
        });
      }).toThrow('apply error');

      expect(counter).toBe(1);
    });

    it('throws when $apply is called during $digest (phase conflict)', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'someValue';

      scope.$watch(
        () => scope.aValue,
        () => {
          expect(() => scope.$apply(() => {})).toThrow('$digest already in progress');
        },
      );

      scope.$digest();
    });
  });

  describe('$evalAsync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('executes expression during digest', () => {
      const scope = Scope.create<{ aValue: number[]; asyncEvaluated: boolean }>();
      scope.aValue = [1, 2, 3];
      scope.asyncEvaluated = false;

      scope.$watch(
        () => scope.aValue,
        () => {
          scope.$evalAsync(() => {
            scope.asyncEvaluated = true;
          });
        },
      );

      scope.$digest();

      expect(scope.asyncEvaluated).toBe(true);
    });

    it('executes even when not dirty', () => {
      const scope = Scope.create<{ aValue: number[]; asyncEvaluated: boolean }>();
      scope.aValue = [1, 2, 3];
      scope.asyncEvaluated = false;
      let evalAsyncScheduled = false;

      scope.$watch(
        () => {
          if (!evalAsyncScheduled) {
            evalAsyncScheduled = true;
            scope.$evalAsync(() => {
              scope.asyncEvaluated = true;
            });
          }
          return scope.aValue;
        },
        () => {
          /* noop */
        },
      );

      scope.$digest();

      expect(scope.asyncEvaluated).toBe(true);
    });

    it('auto-schedules a digest via setTimeout when no digest running', () => {
      const scope = Scope.create<{ asyncEvaluated: boolean }>();
      scope.asyncEvaluated = false;

      scope.$evalAsync(() => {
        scope.asyncEvaluated = true;
      });

      expect(scope.asyncEvaluated).toBe(false);

      vi.advanceTimersByTime(0);

      expect(scope.asyncEvaluated).toBe(true);
    });

    it('catches exceptions and continues digest', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'abc';
      let counter = 0;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$watch(
        () => scope.aValue,
        () => {
          scope.$evalAsync(() => {
            throw new Error('evalAsync error');
          });
        },
      );

      scope.$watch(
        () => scope.aValue,
        () => {
          counter++;
        },
      );

      scope.$digest();

      expect(counter).toBe(1);

      consoleSpy.mockRestore();
    });

    it('$evalAsync expression has not executed yet when listener returns', () => {
      const scope = Scope.create<{ aValue: string; asyncExecuted: boolean }>();
      scope.aValue = 'abc';
      scope.asyncExecuted = false;
      let asyncExecutedDuringListener = true;

      scope.$watch(
        () => scope.aValue,
        () => {
          scope.$evalAsync(() => {
            scope.asyncExecuted = true;
          });
          // At this point the evalAsync has been queued but not yet executed
          asyncExecutedDuringListener = scope.asyncExecuted;
        },
      );

      scope.$digest();

      expect(asyncExecutedDuringListener).toBe(false);
      expect(scope.asyncExecuted).toBe(true);
    });
  });

  describe('$applyAsync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('coalesces multiple calls into single $apply', () => {
      const scope = Scope.create<{ aValue: string; bValue: string }>();
      let digestCount = 0;

      scope.$watch(
        () => scope.aValue,
        () => {
          digestCount++;
        },
      );

      scope.$applyAsync(() => {
        scope.aValue = 'first';
      });

      scope.$applyAsync(() => {
        scope.bValue = 'second';
      });

      vi.advanceTimersByTime(0);

      expect(scope.aValue).toBe('first');
      expect(scope.bValue).toBe('second');
      expect(digestCount).toBe(1);
    });

    it('flushes queue during active digest', () => {
      const scope = Scope.create<{ aValue: string }>();

      scope.$applyAsync(() => {
        scope.aValue = 'applied';
      });

      scope.$digest();

      expect(scope.aValue).toBe('applied');
    });

    it('cancels the pending timeout when flushed during digest', () => {
      const scope = Scope.create<{ aValue: string }>();
      let digestCount = 0;

      scope.$watch(
        () => scope.aValue,
        () => {
          digestCount++;
        },
      );

      scope.$applyAsync(() => {
        scope.aValue = 'applied';
      });

      scope.$digest();
      const digestCountAfterDigest = digestCount;

      vi.advanceTimersByTime(0);

      expect(digestCount).toBe(digestCountAfterDigest);
    });

    it('catches exceptions in individual expressions', () => {
      const scope = Scope.create<{ aValue: string }>();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$applyAsync(() => {
        throw new Error('applyAsync error');
      });

      scope.$applyAsync(() => {
        scope.aValue = 'applied';
      });

      vi.advanceTimersByTime(0);

      expect(scope.aValue).toBe('applied');

      consoleSpy.mockRestore();
    });

    it('$applyAsync flushes during active digest when timer is pending', () => {
      const scope = Scope.create<{ aValue: string; asyncApplied: boolean }>();
      scope.aValue = 'abc';
      scope.asyncApplied = false;

      scope.$watch(
        () => scope.aValue,
        () => {
          scope.$applyAsync(() => {
            scope.asyncApplied = true;
          });
        },
      );

      scope.$digest();

      // $applyAsync IS flushed at the end of the active digest when the timer is pending
      expect(scope.asyncApplied).toBe(true);
    });
  });

  describe('$$postDigest', () => {
    it('runs after digest completes', () => {
      const scope = Scope.create<{ postDigestRan: boolean }>();
      scope.postDigestRan = false;

      scope.$$postDigest(() => {
        scope.postDigestRan = true;
      });

      scope.$digest();

      expect(scope.postDigestRan).toBe(true);
    });

    it('does NOT trigger another digest', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'initial';
      let watchCount = 0;

      scope.$watch(
        () => scope.aValue,
        () => {
          watchCount++;
        },
      );

      scope.$$postDigest(() => {
        scope.aValue = 'changed';
      });

      scope.$digest();
      expect(watchCount).toBe(1);

      scope.$digest();
      expect(watchCount).toBe(2);
    });

    it('catches exceptions and continues', () => {
      let secondRan = false;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const scope = new Scope();

      scope.$$postDigest(() => {
        throw new Error('postDigest error');
      });

      scope.$$postDigest(() => {
        secondRan = true;
      });

      scope.$digest();

      expect(secondRan).toBe(true);

      consoleSpy.mockRestore();
    });

    it('$$postDigest FIFO queue with nesting: callback can schedule another that runs in same drain', () => {
      const scope = new Scope();
      const order: number[] = [];

      scope.$$postDigest(() => {
        order.push(1);
        scope.$$postDigest(() => {
          order.push(2);
        });
      });

      scope.$digest();

      expect(order).toEqual([1, 2]);
    });

    it('$$postDigest supports nested $apply', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'initial';
      let watchCount = 0;

      scope.$watch(
        () => scope.aValue,
        () => {
          watchCount++;
        },
      );

      scope.$$postDigest(() => {
        scope.$apply(() => {
          scope.aValue = 'changed';
        });
      });

      scope.$digest();
      // First digest fires the watcher once, then $$postDigest calls $apply which triggers another digest
      expect(watchCount).toBe(2);
      expect(scope.aValue).toBe('changed');
    });

    it('$$postDigest on child scope shares queue and runs when root digests', () => {
      const parent = new Scope();
      const child = parent.$new();
      let postDigestRan = false;

      child.$$postDigest(() => {
        postDigestRan = true;
      });

      parent.$digest();

      expect(postDigestRan).toBe(true);
    });
  });
});
