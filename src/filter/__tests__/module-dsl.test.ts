/**
 * `module.filter()` DSL tests (Slice 3 / FS §2.4).
 *
 * Locks down the seven FS §2.4 acceptance criteria. The DSL is sugar for
 * `module.provider('<name>Filter', shim).config(['$filterProvider', $fp =>
 * $fp.register(name, factory)])`, so the assertions exercise both the
 * `$filter('<name>')` lookup path AND the `injector.get('<name>Filter')`
 * provider-shim path.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterFn, FilterService } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('module.filter — DSL shorthand (FS §2.4)', () => {
  // The `ng` module is registered at import time; a `resetRegistry()` in a
  // neighbouring test would evict it. Re-register a fresh `'ng'` here so any
  // `requires: ['ng']` lookup downstream still resolves. Mirrors the
  // boilerplate other DI integration tests use.
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  describe('basic registration', () => {
    it('registers a filter usable as $filter(name)', () => {
      const appModule = createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('shout')('hi')).toBe('hi!');
    });

    it('exposes the same singleton through injector.get(`<name>Filter`) and $filter(name)', () => {
      const appModule = createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      const viaService = $filter('shout');
      const viaProvider = injector.get<FilterFn>('shoutFilter');

      expect(viaService).toBe(viaProvider);
      expect(viaService('hi')).toBe('hi!');
      expect(viaProvider('hi')).toBe('hi!');
    });
  });

  describe('chaining', () => {
    it('returns the module so .filter calls chain', () => {
      const appModule = createModule('app', ['ng']);
      const chained = appModule.filter('a', [() => (s: unknown) => `a:${String(s)}`]);

      // Same runtime instance returned for chaining.
      expect(chained).toBe(appModule);
    });

    it('chains alongside other recipes without exception', () => {
      const appModule = createModule('app', ['ng'])
        .value('greeting', 'hello')
        .filter('shout', [() => (s: unknown) => `${String(s)}!`])
        .factory('greeter', [
          'greeting',
          '$filter',
          (greeting: string, $filter: FilterService) => (): string => $filter('shout')(greeting) as string,
        ])
        .filter('whisper', [() => (s: unknown) => `*${String(s)}*`]);

      const injector = createInjector([appModule]);
      const greeter = injector.get<() => string>('greeter');
      const $filter = injector.get('$filter');

      expect(greeter()).toBe('hello!');
      expect($filter('whisper')('hi')).toBe('*hi*');
    });
  });

  describe('array-style annotations', () => {
    it('resolves dependencies through $injector.invoke when the factory is array-annotated', () => {
      const appModule = createModule('app', ['ng'])
        .value('factor', 3)
        .filter('multiply', ['factor', (factor: number) => (n: unknown) => (n as number) * factor]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('multiply')(5)).toBe(15);
    });
  });

  describe('last-wins (within chain)', () => {
    it('a second .filter call for the same name replaces the prior factory', () => {
      const appModule = createModule('app', ['ng'])
        .filter('shout', [() => (s: unknown) => `OLD:${String(s)}`])
        .filter('shout', [() => (s: unknown) => `NEW:${String(s)}`]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('shout')('x')).toBe('NEW:x');
    });
  });

  describe('cross-module last-wins', () => {
    it('a downstream config block overrides a parent module .filter via the shared registry', () => {
      // Parent registers via .filter — pushes a config block at the back of
      // its `$$configBlocks` queue. The variable is intentionally retained so
      // the registration is owned by the test's local scope; suppressing the
      // no-unused-vars rule mirrors the pattern other DI integration tests
      // use for "loaded transitively" modules.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- registered into the global module map; loaded via downstream's `requires` chain.
      const parentModule = createModule('parent', ['ng']).filter('shout', [
        () => (s: unknown) => `PARENT:${String(s)}`,
      ]);

      // Downstream module's config block calls $filterProvider.register(...)
      // directly. Because `loadModule` walks deps post-order, the parent's
      // config block runs first, then the downstream's — last-wins on the
      // shared registration map.
      const downstreamModule = createModule('downstream', ['parent']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register('shout', [() => (s: unknown) => `DOWN:${String(s)}`]);
        },
      ]);

      const injector = createInjector([downstreamModule]);
      // Cross-module typing: `downstreamModule` doesn't statically carry `$filter`
      // in its registry (only the transitive `'ng'` augmentation does, and the
      // path through `parent` -> `ng` is not currently surfaced via the
      // RequiredRunRegistry walk for nested chains). Use the explicit-type
      // escape-hatch overload to keep the runtime assertion tight.
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('shout')('x')).toBe('DOWN:x');
    });
  });

  describe('shared-registry assertion', () => {
    it('.filter and $filterProvider.register write into the same map (last-wins observable)', () => {
      const appModule = createModule('app', ['ng'])
        .filter('shout', [() => (s: unknown) => `DSL:${String(s)}`])
        .config([
          '$filterProvider',
          ($fp: $FilterProvider) => {
            // Override what the .filter call queued via $filterProvider directly.
            // .filter's own config block runs first (registered first), then
            // this one — so this one wins.
            $fp.register('shout', [() => (s: unknown) => `CFG:${String(s)}`]);
          },
        ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('shout')('x')).toBe('CFG:x');
    });
  });

  describe('TypeScript compile-time signature', () => {
    it('does not accept a non-Invokable factory (compile-time check via @ts-expect-error)', () => {
      const appModule = createModule('app', ['ng']);

      // Each `@ts-expect-error` line below documents one shape that .filter
      // must reject at compile time. The runtime call is made deliberately —
      // a successful compile of these lines would mean the type-system
      // contract has regressed (TS would emit "Unused '@ts-expect-error'
      // directive" and fail the build instead of silently accepting bad
      // shapes).

      // A bare number is not an Invokable.
      // @ts-expect-error -- factory must be Invokable<FilterFn>
      appModule.filter('bogus1', 42);

      // A string is not an Invokable.
      // @ts-expect-error -- factory must be Invokable<FilterFn>
      appModule.filter('bogus2', 'not-a-factory');

      // An empty array — Invokable arrays must end in a function.
      // @ts-expect-error -- empty array is not a valid Invokable
      appModule.filter('bogus3', []);

      // The valid shape compiles cleanly. Asserting it as a smoke check:
      const ok = appModule.filter('ok', [() => (s: unknown) => s]);
      expect(ok).toBe(appModule);
    });
  });
});
