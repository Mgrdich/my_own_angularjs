/**
 * Stateful-filter behavior tests (Slice 11 / FS §2.7).
 *
 * Locks down the five FS §2.7 acceptance criteria around the `$stateful`
 * opt-in: a filter function may declare `$stateful = true` to opt out of
 * the digest's input-identity short-circuit, causing it to re-run every
 * cycle even when its input is identity-stable.
 *
 * Cross-cutting interaction with the watch-install delegate selection
 * (FS §2.9): a stateful filter inside a `::`-prefixed expression
 * downgrades the watch to a regular watcher (no one-time deregistration).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterFn, FilterService } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('$stateful filters (FS §2.7)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  describe('default-stateless behavior', () => {
    it('does not refire the listener when the input is identity-stable across digests', () => {
      const appModule = createModule('app', ['ng']).filter('exclaim', [() => (s: unknown) => `${String(s)}!`]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ msg: string; other: number }>({ filterLookup: $filter });
      scope.msg = 'hello';
      scope.other = 0;

      const listener = vi.fn();
      scope.$watch('msg | exclaim', listener);

      scope.$digest();
      const initialCalls = listener.mock.calls.length;

      // Mutate an unrelated scope property — the filtered watch should not refire.
      scope.other = 1;
      scope.$digest();
      scope.other = 2;
      scope.$digest();

      expect(listener.mock.calls.length).toBe(initialCalls);
    });
  });

  describe('$stateful: true opt-in', () => {
    it('re-runs the filter every digest cycle even when input is identity-stable', () => {
      // Stateful filter exposes its call-count via a closure so the test can
      // inspect whether the filter ran during the current digest. Returning
      // the same value across consecutive calls keeps the digest stable
      // (no dirty marker) — the assertion is on call count, not output value.
      let callCount = 0;
      const tickFilter: FilterFn = Object.assign(
        (input: unknown) => {
          callCount++;
          return input;
        },
        { $stateful: true },
      );

      const appModule = createModule('app', ['ng']).filter('tick', [() => tickFilter]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ fixed: string }>({ filterLookup: $filter });
      scope.fixed = 'unchanging';

      scope.$watch('fixed | tick', () => {
        /* listener body irrelevant — assertion is on filter call count */
      });

      scope.$digest();
      const callsAfterFirst = callCount;
      scope.$digest();
      const callsAfterSecond = callCount;
      scope.$digest();
      const callsAfterThird = callCount;

      // A stateless filter would short-circuit after the first stable digest,
      // leaving callCount frozen. The $stateful flag forces re-evaluation
      // each cycle even when the input is identity-stable.
      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
      expect(callsAfterThird).toBeGreaterThan(callsAfterSecond);
    });

    it('produces changing output when the stateful filter returns fresh values', () => {
      // A stateful filter that cycles through a small bounded set so the
      // digest converges within TTL — this models a realistic pattern where
      // the filter eventually stabilizes (vs. a Date.now()-style filter that
      // would deliberately exhaust TTL by design, which is a separate
      // out-of-scope behavior of the $stateful contract).
      const sequence = ['a', 'b', 'b', 'b', 'b', 'b'];
      let i = 0;
      const seqFilter: FilterFn = Object.assign(
        () => {
          const v = sequence[i] ?? 'b';
          if (i < sequence.length - 1) {
            i++;
          }
          return v;
        },
        { $stateful: true },
      );

      const appModule = createModule('app', ['ng']).filter('seq', [() => seqFilter]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ fixed: string }>({ filterLookup: $filter });
      scope.fixed = 'unchanging';

      const observed: unknown[] = [];
      scope.$watch('fixed | seq', (newValue) => {
        observed.push(newValue);
      });

      scope.$digest();
      scope.$digest();

      // Multiple distinct outputs were surfaced even though the input never
      // changed — proof the digest is re-running the stateful filter.
      const distinct = new Set(observed);
      expect(distinct.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('all nine built-in filters are stateless', () => {
    it('none of them declare $stateful', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const builtinNames = [
        'filter',
        'orderBy',
        'limitTo',
        'currency',
        'number',
        'date',
        'uppercase',
        'lowercase',
        'json',
      ] as const;

      for (const name of builtinNames) {
        const fn = $filter(name);
        expect(fn.$stateful, `${name} must be stateless`).not.toBe(true);
      }
    });
  });

  describe('$stateful is on the filter function (not the factory)', () => {
    it('exposes $stateful as an own property of the resolved FilterFn', () => {
      const myStateful: FilterFn = Object.assign(() => 'x', { $stateful: true });
      const factory = () => myStateful;
      // The factory itself does not carry $stateful — only the value it returns.
      expect((factory as unknown as { $stateful?: boolean }).$stateful).toBeUndefined();

      const appModule = createModule('app', ['ng']).filter('myStateful', [factory]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const resolved = $filter('myStateful');

      const descriptor = Object.getOwnPropertyDescriptor(resolved, '$stateful');
      expect(descriptor).toBeDefined();
      expect(descriptor?.value).toBe(true);
    });
  });

  describe('one-time / constant downgrade for stateful expressions', () => {
    it("'::value | statefulFilter' is observed as a regular watcher (filter runs every digest)", () => {
      // Stateful filter that simply returns its input verbatim — keeps the
      // digest stable so the assertion can isolate "did the filter run?"
      // from "did the watch detach?". A one-time delegate, after the first
      // stable digest, deregisters the inner watcher and the filter would
      // never run again. A regular watcher keeps invoking it every cycle.
      let callCount = 0;
      const statefulFilter: FilterFn = Object.assign(
        (input: unknown) => {
          callCount++;
          return input;
        },
        { $stateful: true },
      );

      const appModule = createModule('app', ['ng']).filter('statefulFilter', [() => statefulFilter]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ value: number }>({ filterLookup: $filter });
      scope.value = 42;

      scope.$watch('::value | statefulFilter', () => {
        /* listener body irrelevant — assertion is on filter call count */
      });

      scope.$digest();
      const callsAfterFirst = callCount;
      scope.$digest();
      const callsAfterSecond = callCount;
      scope.$digest();
      const callsAfterThird = callCount;

      // A one-time delegate would have detached after the first stable
      // digest, freezing callCount. The downgrade path keeps the watcher
      // active so the stateful filter runs every cycle.
      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
      expect(callsAfterThird).toBeGreaterThan(callsAfterSecond);
    });

    it('a constant-input stateful expression also stays as a regular watcher (no constant-watch upgrade)', () => {
      let callCount = 0;
      const statefulFilter: FilterFn = Object.assign(
        (input: unknown) => {
          callCount++;
          return input;
        },
        { $stateful: true },
      );

      const appModule = createModule('app', ['ng']).filter('statefulFilter', [() => statefulFilter]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ tick: number }>({ filterLookup: $filter });
      scope.tick = 0;

      scope.$watch("'literalInput' | statefulFilter", () => {
        /* listener body irrelevant */
      });

      scope.$digest();
      const after1 = callCount;
      scope.tick = 1;
      scope.$digest();
      scope.tick = 2;
      scope.$digest();

      // Stateful presence must defeat the constant-input upgrade — the
      // filter should run on every digest, not just the first.
      expect(callCount).toBeGreaterThan(after1);
    });

    it('a stateful filter buried inside a chain disqualifies the whole expression', () => {
      let statefulRuns = 0;
      const statefulHead: FilterFn = Object.assign(
        (input: unknown) => {
          statefulRuns++;
          return input;
        },
        { $stateful: true },
      );

      const appModule = createModule('app', ['ng'])
        .filter('statefulHead', [() => statefulHead])
        // Stateless tail filter — stateful filter precedes it in the chain.
        .filter('tail', [() => (s: unknown) => `${String(s)}!`]);

      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ msg: string }>({ filterLookup: $filter });
      scope.msg = 'hi';

      scope.$watch('::msg | statefulHead | tail', () => {
        /* listener body irrelevant */
      });

      scope.$digest();
      const after1 = statefulRuns;
      scope.$digest();
      scope.$digest();

      // The stateful filter sitting at the head of the chain should keep
      // the watcher alive; freezing statefulRuns would imply the one-time
      // delegate deregistered the inner watcher.
      expect(statefulRuns).toBeGreaterThan(after1);
    });
  });

  describe('stateless filter does NOT cause downgrade', () => {
    it("'::msg | statelessFilter' still deregisters once the value stabilizes", () => {
      const appModule = createModule('app', ['ng']).filter('exclaim', [() => (s: unknown) => `${String(s)}!`]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ msg?: string; flip: number }>({ filterLookup: $filter });
      scope.flip = 0;

      const listener = vi.fn();
      scope.$watch('::msg | exclaim', listener);

      scope.$digest();
      scope.msg = 'hello';
      scope.$digest();
      const callsAfterDefined = listener.mock.calls.length;

      // Detached after the value stabilized — further mutations should not refire.
      scope.flip = 1;
      scope.$digest();
      scope.flip = 2;
      scope.$digest();

      expect(listener.mock.calls.length).toBe(callsAfterDefined);
    });
  });
});
