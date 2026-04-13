import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Scope, type ScopeEvent } from '@core/index';

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
      }).toThrow(/digest/);
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

  describe('$digest TTL', () => {
    /**
     * Build a watcher whose watch function changes value on each pass
     * until it has been observed `dirtyPasses` times, then stabilizes.
     *
     * With $digest semantics, `dirtyPasses` dirty passes followed by one
     * clean pass means the digest performs `dirtyPasses + 1` total iterations
     * before exiting the do/while loop.
     */
    const attachConvergingWatcher = (scope: Scope, dirtyPasses: number): void => {
      let counter = 0;
      scope.$watch(() => {
        if (counter < dirtyPasses) {
          counter++;
        }
        return counter;
      });
    };

    /** Build a watcher whose watch function never stabilizes. */
    const attachInfiniteWatcher = (scope: Scope): void => {
      let counter = 0;
      scope.$watch(() => {
        counter++;
        return counter;
      });
    };

    describe('default TTL', () => {
      it('defaults to 10 when no options are provided', () => {
        const scope = Scope.create();
        expect(scope.$$ttl).toBe(10);
      });

      it('allows a digest that requires up to 10 iterations to stabilize', () => {
        const scope = Scope.create();
        // 9 dirty passes + 1 clean pass = 10 total iterations -- must succeed
        attachConvergingWatcher(scope, 9);

        expect(() => {
          scope.$digest();
        }).not.toThrow();
      });

      it('throws when a digest cannot stabilize within 10 iterations', () => {
        const scope = Scope.create();
        attachInfiniteWatcher(scope);

        expect(() => {
          scope.$digest();
        }).toThrow(/digest/);
      });
    });

    describe('custom TTL via options', () => {
      it('honours an increased ttl of 20', () => {
        const scope = Scope.create({ ttl: 20 });
        expect(scope.$$ttl).toBe(20);
      });

      it('allows a digest that requires 15 iterations on a scope with ttl 20', () => {
        const scope = Scope.create({ ttl: 20 });
        // 14 dirty passes + 1 clean pass = 15 total iterations
        attachConvergingWatcher(scope, 14);

        expect(() => {
          scope.$digest();
        }).not.toThrow();
      });

      it('throws when a digest cannot stabilize within the custom ttl of 20', () => {
        const scope = Scope.create({ ttl: 20 });
        attachInfiniteWatcher(scope);

        expect(() => {
          scope.$digest();
        }).toThrow(/digest/);
      });
    });

    describe('lower TTL via options', () => {
      it('catches infinite loops faster with ttl 5', () => {
        const scope = Scope.create({ ttl: 5 });
        // 6 dirty passes would stabilize on iteration 7 with the default ttl=10,
        // but with ttl=5 the digest must throw before it can converge.
        attachConvergingWatcher(scope, 6);

        expect(() => {
          scope.$digest();
        }).toThrow(/digest/);
      });
    });

    describe('TTL validation at creation', () => {
      it('throws when ttl is 1', () => {
        expect(() => Scope.create({ ttl: 1 })).toThrow('TTL must be at least 2');
      });

      it('throws when ttl is 0', () => {
        expect(() => Scope.create({ ttl: 0 })).toThrow('TTL must be at least 2');
      });

      it('throws when ttl is negative', () => {
        expect(() => Scope.create({ ttl: -5 })).toThrow('TTL must be at least 2');
      });

      it('does not throw when ttl is exactly 2', () => {
        expect(() => Scope.create({ ttl: 2 })).not.toThrow();
      });
    });

    describe('child scopes inherit root TTL', () => {
      it('child scopes copy the root TTL', () => {
        const root = Scope.create({ ttl: 15 });
        const child = root.$new();

        expect(child.$$ttl).toBe(15);
      });

      it('a child scope can run a digest needing 12 iterations when root ttl is 15', () => {
        const root = Scope.create({ ttl: 15 });
        const child = root.$new();
        // 11 dirty passes + 1 clean pass = 12 total iterations
        // This would exceed the default ttl of 10 but fits within 15.
        attachConvergingWatcher(child, 11);

        expect(() => {
          root.$digest();
        }).not.toThrow();
      });
    });

    describe('isolated scopes inherit root TTL', () => {
      it('isolated scopes copy the root TTL', () => {
        const root = Scope.create({ ttl: 15 });
        const isolated = root.$new(true);

        expect(isolated.$$ttl).toBe(15);
      });
    });

    describe('error message', () => {
      it('includes the default TTL value (10) in the error message', () => {
        const scope = Scope.create();
        attachInfiniteWatcher(scope);

        expect(() => {
          scope.$digest();
        }).toThrow(/10 digest/);
      });

      it('includes the custom TTL value in the error message', () => {
        const scope = Scope.create({ ttl: 15 });
        attachInfiniteWatcher(scope);

        expect(() => {
          scope.$digest();
        }).toThrow(/15 digest/);
      });

      it('includes the watch function source in the error message', () => {
        const scope = Scope.create<{ uniqueMarkerName: number }>();
        scope.uniqueMarkerName = 0;
        scope.$watch(() => scope.uniqueMarkerName++);

        try {
          scope.$digest();
          throw new Error('expected $digest to throw');
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(Error);
          const message = (error as Error).message;
          expect(message).toContain('Last dirty watcher:');
          expect(message).toContain('uniqueMarkerName');
        }
      });

      it('still contains the "digest" substring for backward compatibility', () => {
        const scope = Scope.create();
        attachInfiniteWatcher(scope);

        expect(() => {
          scope.$digest();
        }).toThrow(/digest/);
      });
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

    it('child $digest does NOT trigger parent watchers', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const child = parent.$new();
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      child.$digest();

      expect(parentListener).not.toHaveBeenCalled();
    });

    it('$apply digests from root, triggering parent watchers', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const child = parent.$new();
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      child.$apply(() => {
        /* noop */
      });

      expect(parentListener).toHaveBeenCalled();
    });

    it('$evalAsync digests from root, triggering parent watchers', () => {
      vi.useFakeTimers();
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const child = parent.$new();
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      child.$evalAsync(() => {
        /* noop */
      });

      vi.advanceTimersByTime(0);

      expect(parentListener).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('isolated scope $apply digests from root', () => {
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const isolatedChild = parent.$new(true);
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      isolatedChild.$apply(() => {
        /* noop */
      });

      expect(parentListener).toHaveBeenCalled();
    });

    it('isolated scope $evalAsync digests from root', () => {
      vi.useFakeTimers();
      const parent = Scope.create<{ aValue: string }>();
      parent.aValue = 'abc';
      const isolatedChild = parent.$new(true);
      const parentListener = vi.fn();

      parent.$watch(() => parent.aValue, parentListener);

      isolatedChild.$evalAsync(() => {
        /* noop */
      });

      vi.advanceTimersByTime(0);

      expect(parentListener).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('$evalAsync executes on isolated scope context', () => {
      const parent = new Scope();
      const isolatedChild = parent.$new(true) as Scope & { value: number };

      isolatedChild.$evalAsync((s) => {
        (s as Scope & { value: number }).value = 1;
      });

      parent.$digest();

      expect(isolatedChild.value).toBe(1);
    });

    it('$$postDigest runs on isolated scope', () => {
      const parent = new Scope();
      const isolatedChild = parent.$new(true);
      let postDigestRan = false;

      isolatedChild.$$postDigest(() => {
        postDigestRan = true;
      });

      parent.$digest();

      expect(postDigestRan).toBe(true);
    });

    it('cannot watch parent attributes when isolated', () => {
      const parent = Scope.create<{ parentProp: string }>();
      parent.parentProp = 'hello';
      const isolatedChild = parent.$new(true);
      let watchedValue: unknown = 'not-set';

      isolatedChild.$watch(
        (scope) => (scope as Scope & { parentProp: string }).parentProp,
        (newValue: unknown) => {
          watchedValue = newValue;
        },
      );

      parent.$digest();

      expect(watchedValue).toBeUndefined();
    });

    it('inherits parent properties defined after $new', () => {
      const parent = new Scope();
      const child = parent.$new();

      parent['newProp'] = 1;

      expect(child['newProp']).toBe(1);
    });

    it('child does not cause parent to inherit its properties', () => {
      const parent = new Scope();
      const child = parent.$new();

      (child as Scope & { childProp: number }).childProp = 1;

      expect(parent['childProp']).toBeUndefined();
    });

    it('does not shadow parent reference-type members', () => {
      const parent = Scope.create<{ user: { name: string } }>();
      parent.user = { name: 'Joe' };

      const child = parent.$new() as Scope & { user: { name: string } };
      child.user.name = 'Jill';

      expect(parent.user.name).toBe('Jill');
    });

    it('$root points to root scope', () => {
      const root = new Scope();
      const child = root.$new();
      const grandchild = child.$new();

      expect(root.$root).toBe(root);
      expect(child.$root).toBe(root);
      expect(grandchild.$root).toBe(root);
    });

    it('$parent chain is correct', () => {
      const root = new Scope();
      const child = root.$new();
      const grandchild = child.$new();

      expect(root.$parent).toBeNull();
      expect(child.$parent).toBe(root);
      expect(grandchild.$parent).toBe(child);
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

    it('$destroy is idempotent: calling twice does not throw', () => {
      const parent = new Scope();
      const child = parent.$new();

      child.$destroy();

      expect(() => {
        child.$destroy();
      }).not.toThrow();
    });

    it('after $destroy, $apply is a no-op (watch silently ignored)', () => {
      const parent = new Scope();
      const child = parent.$new();
      const listenerFn = vi.fn();

      child.$watch(() => 'value', listenerFn);

      child.$destroy();
      listenerFn.mockClear();

      // $watch on a destroyed scope returns a noop deregister
      const deregister = child.$watch(() => 'anotherValue', vi.fn());
      expect(typeof deregister).toBe('function');

      parent.$digest();

      expect(listenerFn).not.toHaveBeenCalled();
    });

    it('$destroy preserves model properties', () => {
      const parent = Scope.create<{ parentProp: string }>();
      parent.parentProp = 'parent';
      const child = parent.$new() as Scope & { childProp: string; parentProp: string };
      child.childProp = 'child';

      child.$destroy();

      // Own properties remain accessible
      expect(child.childProp).toBe('child');
      // Inherited properties remain accessible via prototype
      expect(child.parentProp).toBe('parent');
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

    it('$emit still calls remaining listeners on same scope after stopPropagation', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const listener1 = vi.fn((event: ScopeEvent) => {
        event.stopPropagation();
      });
      const listener2 = vi.fn();
      const parentListener = vi.fn();

      scope.$on('someEvent', listener1);
      scope.$on('someEvent', listener2);
      parent.$on('someEvent', parentListener);

      scope.$emit('someEvent');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
      expect(parentListener).not.toHaveBeenCalled();
    });

    it('no listeners fire after $destroy', () => {
      const parent = new Scope();
      const scope = parent.$new();
      const listener = vi.fn();

      scope.$on('someEvent', listener);
      scope.$destroy();
      listener.mockClear();

      scope.$emit('someEvent');

      expect(listener).not.toHaveBeenCalled();
    });

    it('separate $$listeners per scope', () => {
      const parent = new Scope();
      const child = parent.$new();
      const isolatedChild = parent.$new(true);

      expect(parent.$$listeners).not.toBe(child.$$listeners);
      expect(parent.$$listeners).not.toBe(isolatedChild.$$listeners);
      expect(child.$$listeners).not.toBe(isolatedChild.$$listeners);
    });

    it('currentScope during $broadcast equals each scope as it traverses', () => {
      const parent = new Scope();
      const child = parent.$new();
      const grandchild = child.$new();
      const currentScopes: (Scope | null)[] = [];

      parent.$on('someEvent', (event) => {
        currentScopes.push(event.currentScope);
      });
      child.$on('someEvent', (event) => {
        currentScopes.push(event.currentScope);
      });
      grandchild.$on('someEvent', (event) => {
        currentScopes.push(event.currentScope);
      });

      parent.$broadcast('someEvent');

      expect(currentScopes).toEqual([parent, child, grandchild]);
    });

    it('targetScope on $broadcast equals the originating scope', () => {
      const parent = new Scope();
      const child = parent.$new();
      const targetScopes: (Scope | null)[] = [];

      parent.$on('someEvent', (event) => {
        targetScopes.push(event.targetScope);
      });
      child.$on('someEvent', (event) => {
        targetScopes.push(event.targetScope);
      });

      parent.$broadcast('someEvent');

      expect(targetScopes[0]).toBe(parent);
      expect(targetScopes[1]).toBe(parent);
    });

    it('event listener removal by a previous listener prevents removed listener from firing', () => {
      const scope = new Scope();
      const listenerB = vi.fn();
      const deregisterB = scope.$on('someEvent', listenerB);

      scope.$on('someEvent', () => {
        deregisterB();
      });

      // listenerB is registered first but deregisterA sets it to null mid-iteration
      // Due to iteration order, listenerB is at index 0 and has already fired,
      // but let's test when A removes B where B is registered after A
      const scope2 = new Scope();
      const listenerB2 = vi.fn();

      const holder: { deregB2: () => void } = { deregB2: () => {} };
      scope2.$on('someEvent', () => {
        holder.deregB2();
      });
      holder.deregB2 = scope2.$on('someEvent', listenerB2);

      scope2.$emit('someEvent');

      // listenerB2 should NOT fire because listener A (index 0) deregistered it (set to null)
      expect(listenerB2).not.toHaveBeenCalled();
    });

    it('recursive $emit does not cause infinite loops', () => {
      const scope = new Scope();
      let emitCount = 0;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      scope.$on('someEvent', () => {
        emitCount++;
        if (emitCount < 3) {
          scope.$emit('someEvent');
        }
      });

      scope.$emit('someEvent');

      expect(emitCount).toBe(3);

      consoleSpy.mockRestore();
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
