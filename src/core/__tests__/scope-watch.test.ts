import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Scope } from '@core/index';

describe('Scope', () => {
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

    it('handles destroying multiple watches in same digest without crashing', () => {
      const scope = Scope.create<{ aValue: string }>();
      scope.aValue = 'abc';

      const deregisterHolder: { second: () => void } = { second: () => {} };
      const deregisterFirst = scope.$watch(
        () => scope.aValue,
        () => {
          deregisterFirst();
          deregisterHolder.second();
        },
      );

      deregisterHolder.second = scope.$watch(
        () => scope.aValue,
        () => {
          /* noop */
        },
      );

      expect(() => {
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

      scope.$watchGroup([() => scope.a, () => scope.b], (newValues, oldValues) => {
        gotNewValues = newValues;
        gotOldValues = oldValues;
      });

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

      const deregister = scope.$watchGroup([() => scope.a, () => scope.b], listenerFn);

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

      scope.$watchGroup([() => scope.a, () => scope.b], (newValues, oldValues) => {
        gotNewValues = newValues;
        gotOldValues = oldValues;
      });

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

      scope.$watchGroup([() => scope.a, () => scope.b], (newValues, oldValues) => {
        gotNewValues = newValues;
        gotOldValues = oldValues;
      });

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

      scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.obj, listenerFn);

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

      scope.$watchCollection(() => scope.obj, listenerFn);

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

      scope.$watchCollection(() => scope.obj, listenerFn);

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

      scope.$watchCollection(() => scope.value, listenerFn);

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

      scope.$watchCollection(() => scope.value, listenerFn);

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

      scope.$watchCollection(() => scope.value, listenerFn);

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

      scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.obj, listenerFn);

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

      scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.obj, listenerFn);

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

      const deregister = scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.value, listenerFn);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);
    });

    it('detects when an array is replaced with a new array of same content', () => {
      const scope = Scope.create<{ arr: number[] }>();
      scope.arr = [1, 2, 3];
      const listenerFn = vi.fn();

      scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.arr, listenerFn);

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

      scope.$watchCollection(() => scope.value, listenerFn);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.value = undefined;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);

      scope.value = [1, 2];
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(3);
    });

    it('object with length property is not treated as array', () => {
      const scope = Scope.create<{ obj: Record<string, unknown> }>();
      scope.obj = { length: 42, otherKey: 'abc' };
      const listenerFn = vi.fn();

      scope.$watchCollection(() => scope.obj, listenerFn);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.obj['otherKey'] = 'def';
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });

    it('primitive oldValue tracking with $watchCollection', () => {
      const scope = Scope.create<{ value: number }>();
      scope.value = 1;
      let receivedOldValue: unknown;

      scope.$watchCollection(
        () => scope.value,
        (_newValue: unknown, oldValue: unknown) => {
          receivedOldValue = oldValue;
        },
      );

      scope.$digest();
      // First call: oldValue === newValue
      expect(receivedOldValue).toBe(1);

      scope.value = 2;
      scope.$digest();
      expect(receivedOldValue).toBe(1);

      scope.value = 3;
      scope.$digest();
      expect(receivedOldValue).toBe(2);
    });

    it('handles Object.create(null) objects', () => {
      const scope = Scope.create<{ obj: Record<string, unknown> }>();
      scope.obj = Object.create(null) as Record<string, unknown>;
      scope.obj['a'] = 1;
      const listenerFn = vi.fn();

      scope.$watchCollection(() => scope.obj, listenerFn);

      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(1);

      scope.obj['b'] = 2;
      scope.$digest();
      expect(listenerFn).toHaveBeenCalledTimes(2);
    });
  });
});
