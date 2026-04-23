import { describe, it, expect, vi } from 'vitest';
import { Scope } from '@core/index';

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
