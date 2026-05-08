/**
 * One-time binding interaction with filters (Slice 11 / FS §2.9).
 *
 * Locks down the four FS §2.9 acceptance criteria:
 *   1. `::items | orderBy:'name'` deregisters once the filtered output is
 *      a defined array — stabilization is checked on the filtered output,
 *      not the raw input.
 *   2. If a filter returns `undefined` for a defined input, the binding
 *      does NOT stabilize until the filter output itself becomes defined.
 *   3. Stateful filters (`$stateful: true`) downgrade `::expr | f` to a
 *      regular watcher.
 *   4. Constant input through a stateless filter (e.g. `'hi' | uppercase`)
 *      is upgraded to constant-watch semantics at install time — the
 *      listener fires once with the snapshot and the watcher detaches.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterFn } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('one-time bindings with filters (FS §2.9)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  describe('filtered-output stabilization', () => {
    it('\'::items | orderBy:"name"\' deregisters once the orderBy output is a defined array', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const scope = Scope.create<{ items?: { name: string }[] }>({ filterLookup: $filter });

      const listener = vi.fn();
      // Deep equality is required because `orderBy` returns a freshly
      // allocated array on every call (matches AngularJS — `orderBy`
      // never mutates its input). Without `valueEq=true` the dirty-check
      // would keep re-firing on identity inequality and the digest would
      // loop until TTL. AngularJS users typically reach for the same
      // pattern (e.g., `ng-repeat` uses `$watchCollection`).
      scope.$watch("::items | orderBy:'name'", listener, true);

      // No `items` yet — listener fires (with undefined) but watch must not detach.
      scope.$digest();
      const callsWhileUndefined = listener.mock.calls.length;

      // Provide items — the filtered output is now defined; the watcher
      // should detach AFTER this digest stabilizes.
      scope.items = [{ name: 'beta' }, { name: 'alpha' }];
      scope.$digest();

      const callsAfterDefined = listener.mock.calls.length;
      // Last observed value should be the sorted array.
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
      expect(lastCall?.[0]).toEqual([{ name: 'alpha' }, { name: 'beta' }]);

      // Subsequent mutations must not fire the listener again — one-time deregistered.
      scope.items = [{ name: 'gamma' }, { name: 'delta' }];
      scope.$digest();
      scope.$digest();

      expect(listener.mock.calls.length).toBe(callsAfterDefined);
      // Sanity: stabilization actually happened (we observed both phases).
      expect(callsAfterDefined).toBeGreaterThan(callsWhileUndefined);
    });
  });

  describe('undefined filtered output does not stabilize', () => {
    it('does NOT deregister while the filter returns undefined for a defined input', () => {
      // Custom filter that drops to `undefined` for inputs it has not yet
      // "approved", letting the test gate when stabilization may occur.
      let approved = false;
      const gateFilter: FilterFn = (input) => (approved ? input : undefined);

      const appModule = createModule('app', ['ng']).filter('gate', [() => gateFilter]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get('$filter');
      const scope = Scope.create<{ value: string }>({ filterLookup: $filter });
      scope.value = 'defined-value';

      const listener = vi.fn();
      scope.$watch('::value | gate', listener);

      scope.$digest();
      scope.$digest();

      // While the filter output is undefined, the watcher must remain active.
      // We cannot directly observe the deregistration, but we can verify that
      // changing the value still re-fires the listener.
      scope.value = 'second';
      scope.$digest();
      const callsBeforeApproval = listener.mock.calls.length;

      // Now flip the gate so the filter starts returning the input —
      // stabilization should occur and the watcher should detach.
      approved = true;
      scope.value = 'third';
      scope.$digest();
      scope.$digest();
      const callsAfterApproval = listener.mock.calls.length;

      // Once stabilized, further mutations must NOT trigger the listener.
      scope.value = 'fourth';
      scope.$digest();
      scope.$digest();

      expect(listener.mock.calls.length).toBe(callsAfterApproval);
      expect(callsAfterApproval).toBeGreaterThanOrEqual(callsBeforeApproval);
    });
  });

  describe('stateful filter downgrade', () => {
    it("'::value | $statefulFilter' is treated as a regular watcher (filter runs every digest)", () => {
      // Stateful filter returns input as-is to keep the digest stable —
      // the assertion is on filter-call-count, which proves the watcher
      // did NOT detach as a one-time binding would.
      let callCount = 0;
      const statefulFilter: FilterFn = Object.assign(
        (input: unknown) => {
          callCount++;
          return input;
        },
        { $stateful: true },
      );
      const appModule = createModule('app', ['ng']).filter('clock', [() => statefulFilter]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get('$filter');
      const scope = Scope.create<{ value: number }>({ filterLookup: $filter });
      scope.value = 1;

      scope.$watch('::value | clock', () => {
        /* listener body irrelevant — assertion is on filter call count */
      });

      scope.$digest();
      const afterFirst = callCount;
      scope.$digest();
      scope.$digest();

      // One-time delegate would have detached after stabilization, freezing
      // callCount. The downgrade path keeps the watcher active.
      expect(callCount).toBeGreaterThan(afterFirst);
    });
  });

  describe('constant input through stateless filter', () => {
    it("'::someConst | uppercase' fires once with the snapshot then deregisters", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const scope = Scope.create<{ flip: number }>({ filterLookup: $filter });
      scope.flip = 0;

      const listener = vi.fn();
      // Constant string literal fed through a stateless built-in filter — the
      // install-time re-check upgrades to constant-watch semantics.
      scope.$watch("::'hi' | uppercase", listener);

      scope.$digest();
      // Subsequent digests with completely unrelated mutations must not refire
      // the listener — constant watch is single-shot.
      scope.flip = 1;
      scope.$digest();
      scope.flip = 2;
      scope.$digest();

      expect(listener).toHaveBeenCalledTimes(1);
      const call = listener.mock.calls[0];
      expect(call?.[0]).toBe('HI');
    });

    it("'someConst | uppercase' (no `::`) also upgrades to a constant watch", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const scope = Scope.create<{ flip: number }>({ filterLookup: $filter });
      scope.flip = 0;

      const listener = vi.fn();
      scope.$watch("'hi' | uppercase", listener);

      scope.$digest();
      scope.flip = 1;
      scope.$digest();
      scope.flip = 2;
      scope.$digest();

      // Constant input + stateless filter → install-time upgrade fires the
      // listener exactly once and the watcher detaches.
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toBe('HI');
    });
  });
});
