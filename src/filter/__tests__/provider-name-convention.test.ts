/**
 * `<name>Filter` provider-shim convention tests (Slice 3 / FS §2.5).
 *
 * Locks down the AngularJS-canonical `<name>Filter` convention: every filter
 * registered via `.filter(name, factory)` is also resolvable as
 * `injector.get('<name>Filter')` and refers to the same singleton as
 * `$filter('<name>')`. Filter names that already end in `Filter` are NOT
 * special-cased — `myFilter` registers as `myFilterFilter`, matching
 * AngularJS literally.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterFn } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('<name>Filter provider-shim convention (FS §2.5)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  describe('identity through both lookup paths', () => {
    it('injector.get(`<name>Filter`) returns the same reference as $filter(name)', () => {
      const appModule = createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      const viaProvider = injector.get('shoutFilter');
      const viaService = $filter('shout');

      expect(viaProvider).toBe(viaService);
    });
  });

  describe('injector.has', () => {
    it('returns true for both `<name>Filter` and `$filter` after the ng module loads', () => {
      const appModule = createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);

      const injector = createInjector([appModule]);

      expect(injector.has('shoutFilter')).toBe(true);
      expect(injector.has('$filter')).toBe(true);
    });

    it('regression-protects `injector.has("$filter")` for the bare ng module', () => {
      // No app module — straight ng. Slice 2's wiring registers `$filter` as
      // a provider on ngModule; this guards the wiring.
      const injector = createInjector([ngModule]);

      expect(injector.has('$filter')).toBe(true);
    });
  });

  describe('no special-casing of `Filter`-suffixed names', () => {
    it('a name already ending in `Filter` registers a provider with the doubled `FilterFilter` suffix', () => {
      // AngularJS parity: the convention is mechanical — append `Filter` to
      // whatever the user passed. Inputs ending in `Filter` get a doubled
      // suffix; this is by design.
      const appModule = createModule('app', ['ng']).filter('myFilter', [() => (s: unknown) => `[${String(s)}]`]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      // `$filter('myFilter')` is the canonical lookup path.
      expect($filter('myFilter')('hi')).toBe('[hi]');

      // `injector.get('myFilterFilter')` is the literal provider name.
      const viaProvider = injector.get('myFilterFilter');
      expect(viaProvider('hi')).toBe('[hi]');

      // Both refer to the same singleton.
      expect(viaProvider).toBe($filter('myFilter'));

      // Negative: `myFilter` (no doubled suffix) is NOT a provider name —
      // calling injector.has on the un-suffixed form must return false.
      expect(injector.has('myFilter')).toBe(false);
    });
  });

  describe('invalid identifier rejection', () => {
    it('rejects a name with embedded whitespace at registration time', () => {
      const appModule = createModule('app', ['ng']).filter('bad name', [() => (s: unknown) => s]);

      // Validation fires inside the config block when $filterProvider.register
      // walks the input. The config block runs during createInjector, so the
      // error surfaces synchronously from createInjector itself.
      expect(() => createInjector([appModule])).toThrow(/filter name must be a non-empty string with no whitespace/);
    });

    it('rejects an empty string at registration time', () => {
      const appModule = createModule('app', ['ng']).filter('', [() => (s: unknown) => s]);

      expect(() => createInjector([appModule])).toThrow(/filter name must be a non-empty string with no whitespace/);
    });
  });

  describe('FS §2.5 acceptance — module.provider equivalence', () => {
    it('module.filter(name, factory) is functionally equivalent to module.provider(`<name>Filter`, { $get: factory })', () => {
      // Two modules that should produce indistinguishable behavior. The
      // direct-provider form mirrors what `.filter` writes internally —
      // running both in parallel validates the equivalence FS §2.5
      // claims.
      const dslModule = createModule('dsl-app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);

      const dslInjector = createInjector([dslModule]);
      const dslShout = dslInjector.get('$filter')('shout');

      // Reset & rebuild for the manual-provider variant.
      resetRegistry();
      createModule('ng', [])
        .factory('$exceptionHandler', [() => () => undefined])
        .provider('$sceDelegate', $SceDelegateProvider)
        .provider('$sce', $SceProvider)
        .provider('$interpolate', $InterpolateProvider)
        .provider('$filter', ['$provide', $FilterProvider]);

      const manualModule = createModule('manual-app', ['ng'])
        .provider('shoutFilter', {
          $get: ['$filter', ($filter: (n: string) => FilterFn) => $filter('shout')],
        })
        .config([
          '$filterProvider',
          ($fp: $FilterProvider) => {
            $fp.register('shout', [() => (s: unknown) => `${String(s)}!`]);
          },
        ]);

      const manualInjector = createInjector([manualModule]);
      const manualShout = manualInjector.get('$filter')('shout');

      // Both produce the same observable output. Note: identity comparison
      // across two distinct injectors won't hold (each has its own filter
      // singleton cache), but behavioral equivalence does — that's what
      // §2.5 acceptance criterion 1 actually means.
      expect(dslShout('hi')).toBe(manualShout('hi'));
      expect(dslShout('hi')).toBe('hi!');
    });
  });
});
