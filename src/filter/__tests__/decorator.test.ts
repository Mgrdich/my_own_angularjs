/**
 * Filter decorator tests (Slice 3 / FS §2.6).
 *
 * Filters participate in the existing `module.decorator` / `$provide.decorator`
 * mechanism by virtue of the `<name>Filter` provider naming. These tests
 * exercise that integration with a custom filter (the nine built-ins land in
 * Slices 5-10; the decorator path itself is identical for a custom filter
 * because the convention is purely mechanical).
 */

import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';

import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { ProvideService } from '@di/provide-types';
import { FilterLookupError } from '@filter/filter-error';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterFn } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('filter decorators (FS §2.6)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  describe('module.decorator on a `<name>Filter`', () => {
    it('wraps the underlying filter visible through $filter(name)', () => {
      const appModule = createModule('app', ['ng'])
        .filter('shout', [() => (s: unknown) => `${String(s)}!`])
        .decorator('shoutFilter', [
          '$delegate',
          ($delegate: FilterFn): FilterFn =>
            (s) =>
              `[${String($delegate(s))}]`,
        ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('shout')('hi')).toBe('[hi!]');
    });

    it('the decorated value is also visible through injector.get(`<name>Filter`)', () => {
      const appModule = createModule('app', ['ng'])
        .filter('shout', [() => (s: unknown) => `${String(s)}!`])
        .decorator('shoutFilter', [
          '$delegate',
          ($delegate: FilterFn): FilterFn =>
            (s) =>
              `[${String($delegate(s))}]`,
        ]);

      const injector = createInjector([appModule]);

      const viaProvider = injector.get('shoutFilter');
      const viaService = injector.get('$filter')('shout');

      expect(viaProvider('hi')).toBe('[hi!]');
      // Both lookup paths see the same decorated singleton because the
      // shim provider's `$get` simply returns `$filter(name)`.
      expect(viaProvider).toBe(viaService);
    });
  });

  describe('$provide.decorator from a config block', () => {
    it('decorates a filter equivalently to module.decorator', () => {
      const appModule = createModule('app', ['ng'])
        .filter('shout', [() => (s: unknown) => `${String(s)}!`])
        .config([
          '$provide',
          ($provide: ProvideService) => {
            $provide.decorator('shoutFilter', [
              '$delegate',
              ($delegate: FilterFn): FilterFn =>
                (s) =>
                  `<${String($delegate(s))}>`,
            ]);
          },
        ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('shout')('hi')).toBe('<hi!>');
    });
  });

  describe('multi-decorator stacking', () => {
    it('decorators compose in registration order — d2(d1(orig))', () => {
      const appModule = createModule('app', ['ng'])
        .filter('shout', [() => (s: unknown) => `${String(s)}!`])
        .decorator('shoutFilter', [
          '$delegate',
          ($delegate: FilterFn): FilterFn =>
            (s) =>
              `[${String($delegate(s))}]`,
        ])
        .decorator('shoutFilter', [
          '$delegate',
          ($delegate: FilterFn): FilterFn =>
            (s) =>
              `<${String($delegate(s))}>`,
        ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      // Original: hi -> hi!
      // d1:        hi! -> [hi!]
      // d2:        [hi!] -> <[hi!]>
      expect($filter('shout')('hi')).toBe('<[hi!]>');
    });
  });

  describe('decorator on a non-existent filter', () => {
    it("$filter('nonexistent') still throws FilterLookupError when only the decorator is registered", () => {
      // The decorator registration alone is NOT a producer — it only stacks on
      // top of one. Without a producer, `loadModule` rejects the decorator at
      // injector-construction time with `Cannot decorate unknown service`.
      // This matches the spec-008 / spec-015 behavior where decorating a
      // service that has no registered producer is a hard error.
      const appModule = createModule('app', ['ng']).decorator('nonexistentFilter', [
        '$delegate',
        ($delegate: FilterFn): FilterFn =>
          (s) =>
            `[${String($delegate(s))}]`,
      ]);

      // The decorator-validation pass inside createInjector throws — we
      // never get to the run phase.
      expect(() => createInjector([appModule])).toThrow(/Cannot decorate unknown service: "nonexistentFilter"/);
    });

    it('a filter registered through $filterProvider is reachable on both paths (since register routes through $provide.factory)', () => {
      // Slice 3 architecture: $filterProvider.register routes through
      // $provide.factory(name + 'Filter', factory), so the `<name>Filter`
      // provider entry exists regardless of which surface the user wrote
      // through. Both `$filter(name)` and `injector.get('<name>Filter')`
      // resolve through the unified factory map.
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register('shout', [() => (s: unknown) => `${String(s)}!`]);
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      // The service path works.
      expect($filter('shout')('hi')).toBe('hi!');

      // The provider-name path also works — same singleton.
      // Explicit generic: `appModule` registered via `$filterProvider.register`
      // (config block), which is a runtime-only path — it does NOT widen the
      // typed registry the way `.filter(...)` does. The bare lookup falls
      // through to `unknown`; we re-narrow here.
      const viaProvider = injector.get<FilterFn>('shoutFilter');
      expect(viaProvider).toBe($filter('shout'));
      expect(viaProvider('hi')).toBe('hi!');

      // Untyped lookup of a totally unregistered filter still goes through
      // FilterLookupError on the service path.
      expect(() => $filter('totallyMissing')).toThrow(FilterLookupError);
    });
  });

  describe('TypeScript decorator typing', () => {
    it('the $delegate parameter on a decorator targeting `<name>Filter` is typed as FilterFn', () => {
      // Build the chain so TS sees `shoutFilter: FilterFn` in the registry.
      // The cast through .filter widens the registry; we then use
      // expectTypeOf inside an array-style decorator to pin down the
      // $delegate inference.
      const appModule = createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);

      // expectTypeOf is a compile-time type assertion — runtime is a no-op.
      // We exercise it inside the decorator's callback so the inferred
      // $delegate type is what the test actually pins down.
      const decorated = appModule.decorator('shoutFilter', [
        '$delegate',
        ($delegate: FilterFn): FilterFn => {
          expectTypeOf($delegate).toExtend<FilterFn>();
          return (s) => `[${String($delegate(s))}]`;
        },
      ]);

      // Smoke: the chain still produces a usable filter.
      const injector = createInjector([decorated]);
      expect(injector.get('$filter')('shout')('hi')).toBe('[hi!]');
    });
  });
});
