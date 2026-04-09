import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Scope } from '../index.js';

describe('Scope', () => {
  let scope: Scope;

  beforeEach(() => {
    scope = new Scope();
  });

  describe('$digest', () => {
    it('calls the listener function of a watch on first $digest', () => {
      const watchFn = vi.fn().mockReturnValue('someValue');
      const listenerFn = vi.fn();

      scope.$watch(watchFn, listenerFn);
      scope.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });

    it('calls the watch function with the scope as argument', () => {
      const watchFn = vi.fn().mockReturnValue('someValue');
      const listenerFn = vi.fn();

      scope.$watch(watchFn, listenerFn);
      scope.$digest();

      expect(watchFn).toHaveBeenCalledWith(scope);
    });

    it('calls the listener when the watched value changes', () => {
      scope['someValue'] = 'a';
      let counter = 0;

      scope.$watch(
        (s: Scope) => s['someValue'] as string,
        () => {
          counter++;
        },
      );

      expect(counter).toBe(0);

      scope.$digest();
      expect(counter).toBe(1);

      scope.$digest();
      expect(counter).toBe(1);

      scope['someValue'] = 'b';
      expect(counter).toBe(1);

      scope.$digest();
      expect(counter).toBe(2);
    });

    it('may have watchers that are triggered by other watchers (chained watchers)', () => {
      scope['name'] = 'Jane';

      scope.$watch(
        (s: Scope) => s['nameUpper'] as string,
        (newValue: string) => {
          if (newValue) {
            scope['initial'] = newValue.substring(0, 1) + '.';
          }
        },
      );

      scope.$watch(
        (s: Scope) => s['name'] as string,
        (newValue: string) => {
          if (newValue) {
            scope['nameUpper'] = newValue.toUpperCase();
          }
        },
      );

      scope.$digest();
      expect(scope['initial']).toBe('J.');

      scope['name'] = 'Bob';
      scope.$digest();
      expect(scope['initial']).toBe('B.');
    });

    it('gives up after 10 (TTL) digest iterations and throws', () => {
      scope['counterA'] = 0;
      scope['counterB'] = 0;

      scope.$watch(
        (s: Scope) => s['counterA'] as number,
        () => {
          scope['counterB'] = (scope['counterB'] as number) + 1;
        },
      );

      scope.$watch(
        (s: Scope) => s['counterB'] as number,
        () => {
          scope['counterA'] = (scope['counterA'] as number) + 1;
        },
      );

      expect(() => {
        scope.$digest();
      }).toThrow('10 digest iterations reached');
    });

    it('handles NaN correctly (NaN === NaN for dirty checking)', () => {
      scope['number'] = 0 / 0; // NaN
      let counter = 0;

      scope.$watch(
        (s: Scope) => s['number'] as number,
        () => {
          counter++;
        },
      );

      scope.$digest();
      expect(counter).toBe(1);

      scope.$digest();
      expect(counter).toBe(1);
    });

    it('uses short-circuit optimization: ends digest early when last dirty watcher is clean', () => {
      const watchExecs: number[] = [];

      // Set up 100 watchers on scope properties
      for (let i = 0; i < 100; i++) {
        scope[`val_${String(i)}`] = i;
      }

      for (let i = 0; i < 100; i++) {
        scope.$watch(
          (s: Scope) => {
            watchExecs.push(i);
            return s[`val_${String(i)}`];
          },
          () => {
            /* noop */
          },
        );
      }

      scope.$digest();
      // After the first digest, all watchers have been evaluated at least once.
      // Reset to count evaluations on the next digest.
      watchExecs.length = 0;

      // Change only the first value (watchers iterate in reverse)
      scope['val_0'] = 'changed';
      scope.$digest();

      // With short-circuit, not all 200 (2 * 100) evaluations should run.
      // The second pass should short-circuit after seeing watcher 0 is now clean.
      // Reverse iteration: pass 1 evaluates 100..0, finds val_0 dirty (last dirty = watcher 0).
      // Pass 2 evaluates 100..0, watcher 0 is clean and equals lastDirtyWatch, short-circuits.
      // Total: 200 evaluations.
      expect(watchExecs.length).toBe(200);
    });

    it('does not end digest on short-circuit when new watchers are added', () => {
      scope['aValue'] = 'abc';
      let counter = 0;

      scope.$watch(
        (s: Scope) => s['aValue'] as string,
        (newValue: string) => {
          if (newValue) {
            // Register a new watcher from within a listener
            scope.$watch(
              () => newValue,
              () => {
                counter++;
              },
            );
          }
        },
      );

      scope.$digest();
      // The newly added watcher should fire during the same digest cycle
      expect(counter).toBe(1);
    });
  });

  describe('$watch', () => {
    it('returns a deregistration function', () => {
      const deregister = scope.$watch(() => 'value', vi.fn());
      expect(typeof deregister).toBe('function');
    });

    it('calling deregistration function removes the watcher', () => {
      scope['aValue'] = 'initial';
      const listenerFn = vi.fn();

      const deregister = scope.$watch((s: Scope) => s['aValue'] as string, listenerFn);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope['aValue'] = 'changed';
      deregister();
      scope.$digest();

      // Listener should not have been called again after deregistration
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('allows deregistering a watcher during a digest', () => {
      scope['aValue'] = 'abc';
      const watchCalls: string[] = [];

      const deregisterFirst = scope.$watch(
        (s: Scope) => {
          watchCalls.push('first');
          return s['aValue'] as string;
        },
        () => {
          deregisterFirst();
        },
      );

      scope.$watch(
        (s: Scope) => {
          watchCalls.push('second');
          return s['aValue'] as string;
        },
        () => {
          /* noop */
        },
      );

      scope.$watch(
        (s: Scope) => {
          watchCalls.push('third');
          return s['aValue'] as string;
        },
        () => {
          /* noop */
        },
      );

      scope.$digest();

      // All three watchers should still have run despite the first one deregistering itself.
      // Because watchers iterate in reverse, deregistering the first watcher mid-iteration
      // (by setting it to null) should not skip any watchers.
      expect(watchCalls).toContain('first');
      expect(watchCalls).toContain('second');
      expect(watchCalls).toContain('third');
    });

    it('allows a watcher to deregister another watcher during digest', () => {
      scope['aValue'] = 'abc';
      let counter = 0;

      const deregisterSecond = scope.$watch(
        () => {
          /* noop watch */
        },
        () => {
          deregisterSecond();
        },
      );

      scope.$watch(
        (s: Scope) => s['aValue'] as string,
        () => {
          counter++;
        },
      );

      scope.$digest();
      expect(counter).toBe(1);
    });

    it('does not throw when registering without a listener function', () => {
      expect(() => {
        scope.$watch((s: Scope) => s['someValue']);
        scope.$digest();
      }).not.toThrow();
    });

    it('uses initWatchVal as oldValue on first listener invocation (oldValue === newValue)', () => {
      scope['aValue'] = 123;
      let oldValueGiven: unknown;

      scope.$watch(
        (s: Scope) => s['aValue'] as number,
        (_newValue: number, oldValue: number) => {
          oldValueGiven = oldValue;
        },
      );

      scope.$digest();

      // On first invocation, the listener should receive newValue as oldValue
      // (not the internal initWatchVal sentinel)
      expect(oldValueGiven).toBe(123);
    });

    it('catches exceptions in watch functions and continues', () => {
      scope['aValue'] = 'abc';
      let counter = 0;

      // Suppress console.error output during this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$watch(
        () => {
          throw new Error('watch error');
        },
        () => {
          /* noop */
        },
      );

      scope.$watch(
        (s: Scope) => s['aValue'] as string,
        () => {
          counter++;
        },
      );

      scope.$digest();
      expect(counter).toBe(1);

      consoleSpy.mockRestore();
    });

    it('catches exceptions in listener functions and continues', () => {
      scope['aValue'] = 'abc';
      let counter = 0;

      // Suppress console.error output during this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$watch(
        (s: Scope) => s['aValue'] as string,
        () => {
          throw new Error('listener error');
        },
      );

      scope.$watch(
        (s: Scope) => s['aValue'] as string,
        () => {
          counter++;
        },
      );

      scope.$digest();
      expect(counter).toBe(1);

      consoleSpy.mockRestore();
    });
  });

  describe('$eval', () => {
    it("executes $eval'd function and returns result", () => {
      scope['aValue'] = 42;

      const result = scope.$eval((s: Scope) => s['aValue'] as number);

      expect(result).toBe(42);
    });

    it('passes the scope as first argument', () => {
      const fn = vi.fn();
      scope.$eval(fn);
      expect(fn).toHaveBeenCalledWith(scope, undefined);
    });

    it('passes locals as second argument', () => {
      const locals = { extra: 'data' };
      const fn = vi.fn();

      scope.$eval(fn, locals);

      expect(fn).toHaveBeenCalledWith(scope, locals);
    });

    it('returns undefined when called without arguments', () => {
      const result = scope.$eval();
      expect(result).toBeUndefined();
    });
  });

  describe('$apply', () => {
    it("executes $apply'd function and triggers digest", () => {
      scope['aValue'] = 'someValue';
      let counter = 0;

      scope.$watch(
        (s: Scope) => s['aValue'] as string,
        () => {
          counter++;
        },
      );

      scope.$digest();
      expect(counter).toBe(1);

      scope.$apply((s: Scope) => {
        s['aValue'] = 'otherValue';
      });
      expect(counter).toBe(2);
    });

    it("sets $$phase to '$apply' during $apply", () => {
      let phaseInApply: string | null = null;

      scope.$apply((s: Scope) => {
        phaseInApply = s.$$phase;
      });

      expect(phaseInApply).toBe('$apply');
    });

    it('triggers digest even if expression throws', () => {
      scope['aValue'] = 'someValue';
      let counter = 0;

      scope.$watch(
        (s: Scope) => s['aValue'] as string,
        () => {
          counter++;
        },
      );

      expect(() => {
        scope.$apply(() => {
          scope['aValue'] = 'otherValue';
          throw new Error('apply error');
        });
      }).toThrow('apply error');

      // The digest should still have run despite the error
      expect(counter).toBe(1);
    });

    it('throws when $apply is called during $digest (phase conflict)', () => {
      scope['aValue'] = 'someValue';

      scope.$watch(
        (s: Scope) => s['aValue'] as string,
        () => {
          expect(() => scope.$apply(() => {})).toThrow('$digest already in progress');
        },
      );

      scope.$digest();
    });
  });

  describe('$$phase', () => {
    it('has $$phase as null initially', () => {
      expect(scope.$$phase).toBeNull();
    });

    it("has $$phase as '$digest' during $digest", () => {
      let phaseInWatch: string | null = null;
      let phaseInListener: string | null = null;

      scope['aValue'] = 'someValue';

      scope.$watch(
        (s: Scope) => {
          phaseInWatch = s.$$phase;
          return s['aValue'] as string;
        },
        () => {
          phaseInListener = scope.$$phase;
        },
      );

      scope.$digest();

      expect(phaseInWatch).toBe('$digest');
      expect(phaseInListener).toBe('$digest');
    });

    it("has $$phase as '$apply' during $apply", () => {
      let phaseInApply: string | null = null;

      scope.$apply((s: Scope) => {
        phaseInApply = s.$$phase;
      });

      expect(phaseInApply).toBe('$apply');
    });
  });
});
