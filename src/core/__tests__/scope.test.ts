import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Scope, type ScopeEvent } from '../index';

describe('Scope', () => {
  describe('$digest', () => {
    it('calls the listener function of a watch on first $digest', () => {
      const scope = new Scope();
      const watchFn = vi.fn().mockReturnValue('someValue');
      const listenerFn = vi.fn();

      scope.$watch(watchFn, listenerFn);
      scope.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });

    it('calls the watch function with the scope as argument', () => {
      const scope = new Scope();
      const watchFn = vi.fn().mockReturnValue('someValue');
      const listenerFn = vi.fn();

      scope.$watch(watchFn, listenerFn);
      scope.$digest();

      expect(watchFn).toHaveBeenCalledWith(scope);
    });

    it('calls the listener when the watched value changes', () => {
      const scope = Scope.create<{ someValue: string }>();
      scope.someValue = 'a';
      let counter = 0;

      scope.$watch(
        () => scope.someValue,
        () => {
          counter++;
        },
      );

      expect(counter).toBe(0);

      scope.$digest();
      expect(counter).toBe(1);

      scope.$digest();
      expect(counter).toBe(1);

      scope.someValue = 'b';
      expect(counter).toBe(1);

      scope.$digest();
      expect(counter).toBe(2);
    });

    it('may have watchers that are triggered by other watchers (chained watchers)', () => {
      const scope = Scope.create<{ name: string; nameUpper: string; initial: string }>();
      scope.name = 'Jane';

      scope.$watch(
        () => scope.nameUpper,
        (newValue: string) => {
          if (newValue) {
            scope.initial = newValue.substring(0, 1) + '.';
          }
        },
      );

      scope.$watch(
        () => scope.name,
        (newValue: string) => {
          if (newValue) {
            scope.nameUpper = newValue.toUpperCase();
          }
        },
      );

      scope.$digest();
      expect(scope.initial).toBe('J.');

      scope.name = 'Bob';
      scope.$digest();
      expect(scope.initial).toBe('B.');
    });

    it('gives up after 10 (TTL) digest iterations and throws', () => {
      const scope = Scope.create<{ counterA: number; counterB: number }>();
      scope.counterA = 0;
      scope.counterB = 0;

      scope.$watch(
        () => scope.counterA,
        () => {
          scope.counterB = scope.counterB + 1;
        },
      );

      scope.$watch(
        () => scope.counterB,
        () => {
          scope.counterA = scope.counterA + 1;
        },
      );

      expect(() => {
        scope.$digest();
      }).toThrow('10 digest iterations reached');
    });

    it('handles NaN correctly (NaN === NaN for dirty checking)', () => {
      const scope = Scope.create<{ nanValue: number }>();
      scope.nanValue = 0 / 0; // NaN
      let counter = 0;

      scope.$watch(
        () => scope.nanValue,
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
      const scope = new Scope();
      const watchExecs: number[] = [];

      // Set up 100 watchers on scope properties (dynamic keys require bracket notation)
      for (let i = 0; i < 100; i++) {
        scope[`val_${String(i)}`] = i;
      }

      for (let i = 0; i < 100; i++) {
        scope.$watch(
          () => {
            watchExecs.push(i);
            return scope[`val_${String(i)}`];
          },
          () => {
            /* noop */
          },
        );
      }

      scope.$digest();
      watchExecs.length = 0;

      scope['val_0'] = 'changed';
      scope.$digest();

      // Reverse iteration: pass 1 evaluates 100..0, finds val_0 dirty.
      // Pass 2 evaluates 100..0, watcher 0 is clean and equals lastDirtyWatch, short-circuits.
      expect(watchExecs.length).toBe(200);
    });

    it('does not end digest on short-circuit when new watchers are added', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'abc';
      let counter = 0;

      scope.$watch(
        () => scope.aValue,
        (newValue: string) => {
          if (newValue) {
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
      expect(counter).toBe(1);
    });
  });

  describe('$watch', () => {
    it('returns a deregistration function', () => {
      const scope = new Scope();
      const deregister = scope.$watch(() => 'value', vi.fn());
      expect(typeof deregister).toBe('function');
    });

    it('calling deregistration function removes the watcher', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'initial';
      const listenerFn = vi.fn();

      const deregister = scope.$watch(() => scope.aValue, listenerFn);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.aValue = 'changed';
      deregister();
      scope.$digest();

      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('allows deregistering a watcher during a digest', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'abc';
      const watchCalls: string[] = [];

      const deregisterFirst = scope.$watch(
        () => {
          watchCalls.push('first');
          return scope.aValue;
        },
        () => {
          deregisterFirst();
        },
      );

      scope.$watch(
        () => {
          watchCalls.push('second');
          return scope.aValue;
        },
        () => {
          /* noop */
        },
      );

      scope.$watch(
        () => {
          watchCalls.push('third');
          return scope.aValue;
        },
        () => {
          /* noop */
        },
      );

      scope.$digest();

      expect(watchCalls).toContain('first');
      expect(watchCalls).toContain('second');
      expect(watchCalls).toContain('third');
    });

    it('allows a watcher to deregister another watcher during digest', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'abc';
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
        () => scope.aValue,
        () => {
          counter++;
        },
      );

      scope.$digest();
      expect(counter).toBe(1);
    });

    it('does not throw when registering without a listener function', () => {
      const scope = new Scope();
      expect(() => {
        scope.$watch(() => 'someValue');
        scope.$digest();
      }).not.toThrow();
    });

    it('uses initWatchVal as oldValue on first listener invocation (oldValue === newValue)', () => {
      const scope = Scope.create<{ aValue: number }>();
      scope.aValue = 123;
      let oldValueGiven: unknown;

      scope.$watch(
        () => scope.aValue,
        (_newValue: number, oldValue: number) => {
          oldValueGiven = oldValue;
        },
      );

      scope.$digest();

      expect(oldValueGiven).toBe(123);
    });

    it('catches exceptions in watch functions and continues', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'abc';
      let counter = 0;

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
        () => scope.aValue,
        () => {
          counter++;
        },
      );

      scope.$digest();
      expect(counter).toBe(1);

      consoleSpy.mockRestore();
    });

    it('catches exceptions in listener functions and continues', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'abc';
      let counter = 0;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$watch(
        () => scope.aValue,
        () => {
          throw new Error('listener error');
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

    describe('value-based $watch', () => {
      it('detects array mutation when using valueEq', () => {
        const scope = Scope.create<{ items: number[] }>();
        scope.items = [1, 2, 3];
        const listenerFn = vi.fn();

        scope.$watch(() => scope.items, listenerFn, true);

        scope.$digest();
        expect(listenerFn).toHaveBeenCalledTimes(1);

        scope.items.push(4);
        scope.$digest();
        expect(listenerFn).toHaveBeenCalledTimes(2);
      });

      it('detects nested object property changes when using valueEq', () => {
        const scope = Scope.create<{ obj: { nested: { value: number } } }>();
        scope.obj = { nested: { value: 1 } };
        const listenerFn = vi.fn();

        scope.$watch(() => scope.obj, listenerFn, true);

        scope.$digest();
        expect(listenerFn).toHaveBeenCalledTimes(1);

        scope.obj.nested.value = 2;
        scope.$digest();
        expect(listenerFn).toHaveBeenCalledTimes(2);
      });

      it('does not detect array mutation in reference mode (default)', () => {
        const scope = Scope.create<{ items: number[] }>();
        scope.items = [1, 2, 3];
        const listenerFn = vi.fn();

        scope.$watch(() => scope.items, listenerFn);

        scope.$digest();
        expect(listenerFn).toHaveBeenCalledTimes(1);

        scope.items.push(4);
        scope.$digest();
        // Reference did not change, so listener should not fire again
        expect(listenerFn).toHaveBeenCalledTimes(1);
      });

      it('stores a deep clone via structuredClone so mutations do not affect the snapshot', () => {
        const scope = Scope.create<{ items: number[] }>();
        scope.items = [1, 2, 3];
        const listenerFn = vi.fn();

        scope.$watch(() => scope.items, listenerFn, true);

        scope.$digest();
        expect(listenerFn).toHaveBeenCalledTimes(1);

        // Mutate the original array after digest -- the stored snapshot should be independent
        scope.items.push(4);

        // The next digest should detect the change because the snapshot was a clone
        scope.$digest();
        expect(listenerFn).toHaveBeenCalledTimes(2);

        // Verify the snapshot is not the same reference as the watched value
        scope.items.push(5);
        scope.$digest();
        expect(listenerFn).toHaveBeenCalledTimes(3);
      });
    });
  });

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

  describe('inheritance', () => {
    it('inherits parent properties via prototype chain', () => {
      const parent = Scope.create<{ aValue: number[] }>();
      parent.aValue = [1, 2, 3];

      const child = parent.$new();

      expect(child.aValue).toBe(parent.aValue);
    });

    it('does not affect parent when assigning on child (property shadowing)', () => {
      const parent = Scope.create<{ name: string }>();
      parent.name = 'Joe';

      const child = parent.$new() as Scope & { name: string };
      child.name = 'Jill';

      expect(child.name).toBe('Jill');
      expect(parent.name).toBe('Joe');
    });

    it('sees parent property changes through prototype chain', () => {
      const parent = Scope.create<{ aValue: number[] }>();
      parent.aValue = [1, 2, 3];

      const child = parent.$new();

      parent.aValue.push(4);

      expect(child.aValue).toEqual([1, 2, 3, 4]);
    });

    it('digests child watchers when parent digest is called', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';

      const child = parent.$new();
      const listenerFn = vi.fn();

      child.$watch(() => child.aValue, listenerFn);

      parent.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });

    it('does NOT inherit parent properties when isolated', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';

      const child = parent.$new(true);

      expect(child.aValue).toBeUndefined();
    });

    it('shares $$asyncQueue with root when isolated', () => {
      const parent = new Scope();
      const child = parent.$new(true);

      expect(child.$$asyncQueue).toBe(parent.$$asyncQueue);
    });

    it('digests isolated child watchers when parent digest is called', () => {
      const parent = new Scope();
      const child = parent.$new(true);
      const listenerFn = vi.fn();

      child.$watch(() => 'value', listenerFn);

      parent.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });

    it('sets $parent to custom parent when provided', () => {
      const parentScope = new Scope();
      const customParent = parentScope.$new();
      const child = parentScope.$new(false, customParent);

      expect(child.$parent).toBe(customParent);
      expect(customParent.$$children).toContain(child);
    });

    it('digests arbitrarily nested scope watchers', () => {
      const parent = new Scope();
      const child = parent.$new();
      const grandchild = child.$new();
      const listenerFn = vi.fn();

      grandchild.$watch(() => 'value', listenerFn);

      parent.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });
  });

  describe('$destroy', () => {
    it('removes scope from parent $$children', () => {
      const parent = new Scope();
      const child = parent.$new();

      expect(parent.$$children).toContain(child);

      child.$destroy();

      expect(parent.$$children).not.toContain(child);
    });

    it('nullifies $$watchers so digest skips it', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';

      const child = parent.$new();
      const listenerFn = vi.fn();

      child.$watch(() => parent.aValue, listenerFn);

      parent.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      child.$destroy();
      parent.aValue = 'def';
      parent.$digest();

      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('clears $$listeners', () => {
      const parent = new Scope();
      const child = parent.$new();

      child.$$listeners = { someEvent: [vi.fn()] };

      child.$destroy();

      expect(child.$$listeners).toEqual({});
    });

    it('does not throw on root scope destroy', () => {
      const scope = new Scope();

      expect(() => {
        scope.$destroy();
      }).not.toThrow();
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
  });

  describe('$watchGroup', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('takes watches as an array and calls listener with arrays of new and old values', () => {
      const scope = Scope.create<{ a: number; b: number }>();
      scope.a = 1;
      scope.b = 2;
      let gotNewValues: unknown[] | undefined;
      let gotOldValues: unknown[] | undefined;

      scope.$watchGroup(
        [() => scope.a, () => scope.b],
        (newValues, oldValues) => {
          gotNewValues = newValues;
          gotOldValues = oldValues;
        },
      );

      scope.$digest();
      vi.advanceTimersByTime(0);
      scope.$digest();

      expect(gotNewValues).toEqual([1, 2]);
      expect(gotOldValues).toEqual([1, 2]);
    });

    it('calls the listener once with empty arrays when given an empty watchFns array', () => {
      const scope = new Scope();
      const listenerFn = vi.fn();

      scope.$watchGroup([], listenerFn);

      vi.advanceTimersByTime(0);
      scope.$digest();

      expect(listenerFn).toHaveBeenCalledTimes(1);
      expect(listenerFn).toHaveBeenCalledWith([], [], scope);
    });

    it('can deregister an empty watchGroup before it fires', () => {
      const scope = new Scope();
      const listenerFn = vi.fn();

      const deregister = scope.$watchGroup([], listenerFn);
      deregister();

      vi.advanceTimersByTime(0);
      scope.$digest();

      expect(listenerFn).not.toHaveBeenCalled();
    });

    it('returns a deregistration function that removes all grouped watchers', () => {
      const scope = Scope.create<{ a: number; b: number }>();
      scope.a = 1;
      scope.b = 2;
      const listenerFn = vi.fn();

      const deregister = scope.$watchGroup(
        [() => scope.a, () => scope.b],
        listenerFn,
      );

      scope.$digest();
      vi.advanceTimersByTime(0);
      scope.$digest();

      expect(listenerFn).toHaveBeenCalledTimes(1);

      listenerFn.mockClear();
      scope.a = 3;
      deregister();
      scope.$digest();
      vi.advanceTimersByTime(0);
      scope.$digest();

      expect(listenerFn).not.toHaveBeenCalled();
    });

    it('passes the same reference for oldValues and newValues on the first invocation', () => {
      const scope = Scope.create<{ a: number; b: number }>();
      scope.a = 1;
      scope.b = 2;
      let gotNewValues: unknown[] | undefined;
      let gotOldValues: unknown[] | undefined;

      scope.$watchGroup(
        [() => scope.a, () => scope.b],
        (newValues, oldValues) => {
          gotNewValues = newValues;
          gotOldValues = oldValues;
        },
      );

      scope.$digest();
      vi.advanceTimersByTime(0);
      scope.$digest();

      expect(gotNewValues).toBe(gotOldValues);
    });

    it('passes different references for oldValues and newValues on subsequent invocations', () => {
      const scope = Scope.create<{ a: number; b: number }>();
      scope.a = 1;
      scope.b = 2;
      let gotNewValues: unknown[] | undefined;
      let gotOldValues: unknown[] | undefined;

      scope.$watchGroup(
        [() => scope.a, () => scope.b],
        (newValues, oldValues) => {
          gotNewValues = newValues;
          gotOldValues = oldValues;
        },
      );

      scope.$digest();
      vi.advanceTimersByTime(0);
      scope.$digest();

      scope.a = 3;
      scope.$digest();
      vi.advanceTimersByTime(0);
      scope.$digest();

      expect(gotNewValues).not.toBe(gotOldValues);
      expect(gotNewValues).toEqual([3, 2]);
      expect(gotOldValues).toEqual([1, 2]);
    });
  });

  describe('$watchCollection', () => {
    it('detects when elements are added to an array', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.arr.push(4);
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('detects when elements are removed from an array', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.arr.pop();
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('detects when elements change position in an array', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      // Swap first and last elements
      scope.arr = [3, 2, 1];
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('detects new properties added to an object', () => {
      const scope = Scope.create<{ obj: Record<string, unknown> }>();
      scope.obj = { a: 1 };
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.obj,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.obj['b'] = 2;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('detects removed properties from an object', () => {
      const scope = Scope.create<{ obj: Record<string, unknown> }>();
      scope.obj = { a: 1, b: 2 };
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.obj,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      delete scope.obj['b'];
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('detects changed values on existing object properties', () => {
      const scope = Scope.create<{ obj: Record<string, unknown> }>();
      scope.obj = { a: 1, b: 2 };
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.obj,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.obj['a'] = 99;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('detects when value changes from primitive to array', () => {
      const scope = Scope.create<{ value: unknown }>();
      scope.value = 'hello';
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.value,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.value = [1, 2, 3];
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('detects when value changes from array to object', () => {
      const scope = Scope.create<{ value: unknown }>();
      scope.value = [1, 2, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.value,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.value = { a: 1 };
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('detects when value changes from object to primitive', () => {
      const scope = Scope.create<{ value: unknown }>();
      scope.value = { a: 1 };
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.value,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.value = 42;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('handles NaN values in arrays without triggering infinite digest', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, NaN, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      // NaN should be treated as equal to NaN, so no new trigger
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('handles NaN values in objects without triggering infinite digest', () => {
      const scope = Scope.create<{ obj: Record<string, number> }>();
      scope.obj = { a: NaN };
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.obj,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('does NOT detect nested object changes (shallow only)', () => {
      const nested0 = { inner: 1 };
      const nested1 = { inner: 2 };
      const scope = Scope.create<{ arr: { inner: number }[] }>();
      scope.arr = [nested0, nested1];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      // Mutate a nested property -- the reference in the array has not changed
      nested0.inner = 99;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('does NOT detect nested object property changes in objects (shallow only)', () => {
      const innerObj = { value: 1 };
      const scope = Scope.create<{ obj: Record<string, { value: number }> }>();
      scope.obj = { a: innerObj };
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.obj,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      // Mutate a nested property -- the reference for key 'a' has not changed
      innerObj.value = 99;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('provides the previous collection state as oldValue when listener has >1 parameter', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      let receivedOldValue: unknown;
      let receivedNewValue: unknown;

      scope.$watchCollection(
        () => scope.arr,
        (newValue: unknown, oldValue: unknown) => {
          receivedNewValue = newValue;
          receivedOldValue = oldValue;
        },
      );

      scope.$digest();

      // On first call, oldValue === newValue
      expect(receivedNewValue).toBe(receivedOldValue);

      scope.arr.push(4);
      scope.$digest();

      // On subsequent call, oldValue is the previous state
      expect(receivedNewValue).toEqual([1, 2, 3, 4]);
      expect(receivedOldValue).toEqual([1, 2, 3]);
    });

    it('provides the previous object state as oldValue when listener has >1 parameter', () => {
      const scope = Scope.create<{ obj: Record<string, number> }>();
      scope.obj = { a: 1 };
      let receivedOldValue: unknown;
      let receivedNewValue: unknown;

      scope.$watchCollection(
        () => scope.obj,
        (newValue: unknown, oldValue: unknown) => {
          receivedNewValue = newValue;
          receivedOldValue = oldValue;
        },
      );

      scope.$digest();
      expect(receivedNewValue).toBe(receivedOldValue);

      scope.obj['b'] = 2;
      scope.$digest();

      expect(receivedNewValue).toEqual({ a: 1, b: 2 });
      expect(receivedOldValue).toEqual({ a: 1 });
    });

    it('on first call, oldValue === newValue (same reference)', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      let firstNewValue: unknown;
      let firstOldValue: unknown;
      let callCount = 0;

      scope.$watchCollection(
        () => scope.arr,
        (newValue: unknown, oldValue: unknown) => {
          callCount++;
          if (callCount === 1) {
            firstNewValue = newValue;
            firstOldValue = oldValue;
          }
        },
      );

      scope.$digest();

      expect(firstNewValue).toBe(firstOldValue);
    });

    it('returns a deregistration function', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      const listenerFn = vi.fn();

      const deregister = scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      deregister();
      scope.arr.push(4);
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('handles NaN as a primitive value without infinite digest', () => {
      const scope = Scope.create<{ value: number }>();
      scope.value = NaN;
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.value,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('detects when an array is replaced with a new array of same content', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      // Same content, different reference -- shallow watch tracks element identity
      scope.arr = [1, 2, 3];
      scope.$digest();
      // Should NOT fire again because elements are identical by value
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('detects when an array element is replaced', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.arr[1] = 99;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('does not fire listener when collection has not changed', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.arr,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('handles null and undefined values', () => {
      const scope = Scope.create<{ value: unknown }>();
      scope.value = null;
      const listenerFn = vi.fn();

      scope.$watchCollection(
        () => scope.value,
        listenerFn,
      );

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.value = undefined;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);

      scope.value = [1, 2];
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('events', () => {
    it('registers a listener via $on that gets called when event fires', () => {
      const scope = new Scope();
      const listener = vi.fn();

      scope.$on('someEvent', listener);
      scope.$emit('someEvent');

      expect(listener).toHaveBeenCalled();
    });

    it('calls multiple listeners for the same event', () => {
      const scope = new Scope();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      scope.$on('someEvent', listener1);
      scope.$on('someEvent', listener2);
      scope.$emit('someEvent');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('deregisters a listener when the returned function is called', () => {
      const scope = new Scope();
      const listener = vi.fn();

      const deregister = scope.$on('someEvent', listener);
      deregister();
      scope.$emit('someEvent');

      expect(listener).not.toHaveBeenCalled();
    });

    it('does not skip listeners when a listener is deregistered during event fire', () => {
      const scope = new Scope();
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      const deregister1 = scope.$on('someEvent', () => {
        deregister1();
        listener1();
      });
      scope.$on('someEvent', listener2);
      scope.$on('someEvent', listener3);

      scope.$emit('someEvent');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(listener3).toHaveBeenCalled();
    });

    it('propagates $emit up the scope hierarchy', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const child = scope.$new();

      const parentListener = vi.fn();
      const scopeListener = vi.fn();
      const childListener = vi.fn();

      parent.$on('someEvent', parentListener);
      scope.$on('someEvent', scopeListener);
      child.$on('someEvent', childListener);

      scope.$emit('someEvent');

      expect(scopeListener).toHaveBeenCalled();
      expect(parentListener).toHaveBeenCalled();
      expect(childListener).not.toHaveBeenCalled();
    });

    it('propagates $broadcast down the scope hierarchy', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const child = scope.$new();
      const sibling = parent.$new();

      const parentListener = vi.fn();
      const scopeListener = vi.fn();
      const childListener = vi.fn();
      const siblingListener = vi.fn();

      parent.$on('someEvent', parentListener);
      scope.$on('someEvent', scopeListener);
      child.$on('someEvent', childListener);
      sibling.$on('someEvent', siblingListener);

      scope.$broadcast('someEvent');

      expect(scopeListener).toHaveBeenCalled();
      expect(childListener).toHaveBeenCalled();
      expect(parentListener).not.toHaveBeenCalled();
      expect(siblingListener).not.toHaveBeenCalled();
    });

    it('has the correct event object shape with name, targetScope, currentScope, and defaultPrevented', () => {
      const parent = new Scope();
      const scope = parent.$new();

      parent.$on('someEvent', () => {
        // listener present to verify propagation
      });

      const event = scope.$emit('someEvent');

      expect(event.name).toBe('someEvent');
      expect(event.targetScope).toBe(scope);
      expect(event.defaultPrevented).toBe(false);
    });

    it('sets currentScope on the event object during propagation', () => {
      const parent = new Scope();
      const scope = parent.$new();
      let currentScopeOnParent: Scope | null = null;
      let currentScopeOnScope: Scope | null = null;

      scope.$on('someEvent', (event) => {
        currentScopeOnScope = event.currentScope;
      });
      parent.$on('someEvent', (event) => {
        currentScopeOnParent = event.currentScope;
      });

      scope.$emit('someEvent');

      expect(currentScopeOnScope).toBe(scope);
      expect(currentScopeOnParent).toBe(parent);
    });

    it('sets currentScope to null after $emit propagation completes', () => {
      const scope = new Scope();

      const event = scope.$emit('someEvent');

      expect(event.currentScope).toBeNull();
    });

    it('sets currentScope to null after $broadcast propagation completes', () => {
      const scope = new Scope();

      const event = scope.$broadcast('someEvent');

      expect(event.currentScope).toBeNull();
    });

    it('stops upward propagation when stopPropagation is called on $emit', () => {
      const parent = new Scope();
      const scope = parent.$new();

      const scopeListener = vi.fn((event: ScopeEvent) => {
        event.stopPropagation();
      });
      const parentListener = vi.fn();

      scope.$on('someEvent', scopeListener);
      parent.$on('someEvent', parentListener);

      scope.$emit('someEvent');

      expect(scopeListener).toHaveBeenCalled();
      expect(parentListener).not.toHaveBeenCalled();
    });

    it('does not stop $broadcast propagation when stopPropagation is called', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const child = scope.$new();

      const scopeListener = vi.fn((event: ScopeEvent) => {
        event.stopPropagation();
      });
      const childListener = vi.fn();

      scope.$on('someEvent', scopeListener);
      child.$on('someEvent', childListener);

      scope.$broadcast('someEvent');

      expect(scopeListener).toHaveBeenCalled();
      expect(childListener).toHaveBeenCalled();
    });

    it('sets defaultPrevented to true when preventDefault is called', () => {
      const scope = new Scope();

      scope.$on('someEvent', (event) => {
        event.preventDefault();
      });

      const event = scope.$emit('someEvent');

      expect(event.defaultPrevented).toBe(true);
    });

    it('passes additional arguments to listeners', () => {
      const scope = new Scope();
      let receivedArgs: unknown[] = [];

      scope.$on('someEvent', (_event, ...args) => {
        receivedArgs = args;
      });

      scope.$emit('someEvent', 'arg1', 'arg2', 'arg3');

      expect(receivedArgs).toEqual(['arg1', 'arg2', 'arg3']);
    });

    it('passes additional arguments to listeners on $broadcast', () => {
      const scope = new Scope();
      let receivedArgs: unknown[] = [];

      scope.$on('someEvent', (_event, ...args) => {
        receivedArgs = args;
      });

      scope.$broadcast('someEvent', 'arg1', 'arg2');

      expect(receivedArgs).toEqual(['arg1', 'arg2']);
    });

    it('does not let an error in one listener prevent other listeners from firing', () => {
      const scope = new Scope();
      const listener1 = vi.fn(() => {
        throw new Error('listener1 error');
      });
      const listener2 = vi.fn();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$on('someEvent', listener1);
      scope.$on('someEvent', listener2);

      scope.$emit('someEvent');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('broadcasts a $destroy event when $destroy is called', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const listener = vi.fn();

      scope.$on('$destroy', listener);

      scope.$destroy();

      expect(listener).toHaveBeenCalled();
    });

    it('broadcasts $destroy to child scopes before cleanup', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const child = scope.$new();
      const childListener = vi.fn();

      child.$on('$destroy', childListener);

      scope.$destroy();

      expect(childListener).toHaveBeenCalled();
    });
  });

  describe('$$phase', () => {
    it('has $$phase as null initially', () => {
      const scope = new Scope();
      expect(scope.$$phase).toBeNull();
    });

    it("has $$phase as '$digest' during $digest", () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'someValue';
      let phaseInWatch: unknown = null;
      let phaseInListener: unknown = null;

      scope.$watch(
        (s) => {
          phaseInWatch = s.$$phase;
          return scope.aValue;
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
      const scope = new Scope();
      let phaseInApply: unknown = null;

      scope.$apply((s) => {
        phaseInApply = s.$$phase;
      });

      expect(phaseInApply).toBe('$apply');
    });
  });
});
