import { describe, it, expect, vi } from 'vitest';
import { Scope } from '../index';

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

      expect(() => { scope.$destroy(); }).not.toThrow();
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
