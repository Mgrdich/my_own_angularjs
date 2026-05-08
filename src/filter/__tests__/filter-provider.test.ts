/**
 * `$filterProvider` DI integration tests (Slice 2 / FS §2.2).
 *
 * Exercises the full chain: `module.config(['$filterProvider', …])` →
 * provider's private registration map → `$get` invokable → `createFilter`
 * cache → run-phase `$filter(name)` lookup. Covers the seven FS §2.2
 * acceptance criteria.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterFn, FilterService } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('$filterProvider — config-phase registration (FS §2.2)', () => {
  // The `ng` module is registered at import time; a `resetRegistry()` in a
  // neighbouring test would evict it. Re-register a fresh `'ng'` here so
  // any `requires: ['ng']` lookup downstream still resolves. Matches the
  // pattern used in other DI integration test files.
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  describe('register: string form', () => {
    it('registers a filter visible to $filter at run-phase', () => {
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register('shout', [() => (s: unknown) => `${String(s)}!`]);
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('shout')('hi')).toBe('hi!');
    });

    it('resolves array-style annotations through $injector.invoke', () => {
      const appModule = createModule('app', ['ng'])
        .value('factor', 3)
        .config([
          '$filterProvider',
          ($fp: $FilterProvider) => {
            $fp.register('multiply', ['factor', (factor: number) => (n: unknown) => (n as number) * factor]);
          },
        ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('multiply')(5)).toBe(15);
    });
  });

  describe('chaining', () => {
    it('register(string) returns the provider for chaining', () => {
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          const a = $fp.register('a', [() => (s: unknown) => `a:${String(s)}`]);
          const b = a.register('b', [() => (s: unknown) => `b:${String(s)}`]);
          // Both calls return the same provider reference.
          expect(a).toBe($fp);
          expect(b).toBe($fp);
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('a')('x')).toBe('a:x');
      expect($filter('b')('x')).toBe('b:x');
    });

    it('register(map) returns the provider for chaining', () => {
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          const ret = $fp.register({
            shout: [() => (s: unknown) => `${String(s)}!`],
            whisper: [() => (s: unknown) => `*${String(s)}*`],
          });
          expect(ret).toBe($fp);
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('shout')('hi')).toBe('hi!');
      expect($filter('whisper')('hi')).toBe('*hi*');
    });
  });

  describe('register: object form', () => {
    it('iterates Object.entries and registers each key', () => {
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register({
            shout: [() => (s: unknown) => `${String(s)}!`],
            whisper: [() => (s: unknown) => `*${String(s)}*`],
            reverse: [() => (s: unknown) => String(s).split('').reverse().join('')],
          });
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      expect($filter('shout')('hi')).toBe('hi!');
      expect($filter('whisper')('hi')).toBe('*hi*');
      expect($filter('reverse')('abc')).toBe('cba');
    });
  });

  describe('last-wins re-registration', () => {
    it('re-registering the same name replaces the prior factory', () => {
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register('shout', [() => (s: unknown) => `OLD:${String(s)}`]);
          $fp.register('shout', [() => (s: unknown) => `NEW:${String(s)}`]);
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      // The freshly-resolved factory is the second one — the first never runs.
      expect($filter('shout')('x')).toBe('NEW:x');
    });
  });

  describe('cross-module config-block resolution', () => {
    it('any module whose dep chain transitively requires ng can configure $filterProvider', () => {
      // The transitive `requires` chain (parent → child → ng) lets each module
      // configure `$filterProvider` independently. The child module is loaded
      // via the parent's `requires: ['child']` declaration even though it is
      // not passed directly to `createInjector`. The variable assignment is
      // intentionally kept so the registration is owned by the test's local
      // scope; suppressing the no-unused-vars rule mirrors the same pattern
      // other DI integration tests use for "loaded transitively" modules.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- registered into the global module map; loaded via parent's `requires` chain.
      const childModule = createModule('child', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register('child', [() => (s: unknown) => `child:${String(s)}`]);
        },
      ]);

      const parentModule = createModule('parent', ['child']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register('parent', [() => (s: unknown) => `parent:${String(s)}`]);
        },
      ]);

      const injector = createInjector([ngModule, parentModule]);
      const $filter = injector.get('$filter');

      expect($filter('child')('x')).toBe('child:x');
      expect($filter('parent')('x')).toBe('parent:x');
    });
  });

  describe('out-of-phase write — captured-reference behavior', () => {
    // Slice 3 architecture: `$filterProvider.register` routes through
    // `$provide.factory(name + 'Filter', factory)` so it inherits the
    // spec-015 config-phase guard. A captured `$filterProvider` reference
    // saved during a config block and called after the run phase begins
    // throws synchronously with the canonical `$provide.factory` phase
    // message — surfacing the programming error rather than silently
    // mutating the registry. Slice 2 documented a deviation here because
    // `register` mutated a private map directly; Slice 3 closed that
    // gap by going through `$provide`.
    it('captured $filterProvider reference throws when register is called after the run phase begins', () => {
      let captured: $FilterProvider | undefined;
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          captured = $fp;
          $fp.register('shout', [() => (s: unknown) => `OLD:${String(s)}`]);
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      // First lookup caches the OLD factory.
      const shout = $filter('shout');
      expect(shout('x')).toBe('OLD:x');

      const liveProvider = captured;
      expect(liveProvider).toBeDefined();
      if (liveProvider === undefined) {
        throw new Error('captured provider missing — config block did not execute');
      }

      // The phase guard fires through the underlying `$provide.factory`
      // call inside `register` — same canonical message spec 015 set up.
      expect(() => {
        liveProvider.register('shout', [() => (s: unknown) => `LATE:${String(s)}`]);
      }).toThrow(/\$provide\.factory is only callable during the config phase/);

      // The earlier cached lookup is untouched.
      expect($filter('shout')).toBe(shout);
      expect($filter('shout')('x')).toBe('OLD:x');
    });
  });

  describe('filter type metadata', () => {
    it('the resolved filter is typed as a FilterFn callable', () => {
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register('id', [() => (v: unknown) => v]);
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter: FilterService = injector.get('$filter');
      const id: FilterFn = $filter('id');

      expect(typeof id).toBe('function');
      expect(id(42)).toBe(42);
    });
  });

  describe('ngModule baseline parity', () => {
    it('createInjector([ngModule]) exposes $filter even without app config', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect(typeof $filter).toBe('function');
    });
  });
});
