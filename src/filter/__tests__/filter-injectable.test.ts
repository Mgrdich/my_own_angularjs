/**
 * `$filter` run-phase service tests (Slice 2 / FS §2.3).
 *
 * Locks down the six FS §2.3 acceptance criteria: function shape,
 * unknown-name lookup error, identity stability, injectability into
 * factories, and the run-phase-only access boundary. Slices 5-10
 * register the nine built-ins; this slice's tests use exclusively
 * custom factories registered via `$filterProvider`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { FilterLookupError } from '@filter/filter-error';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterService } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('$filter — run-phase lookup service (FS §2.3)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  describe('basic shape', () => {
    it("injector.get('$filter') returns a function", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect(typeof $filter).toBe('function');
    });
  });

  describe('unknown filter', () => {
    it('throws FilterLookupError synchronously with the canonical message', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect(() => $filter('foo')).toThrow(FilterLookupError);
      expect(() => $filter('foo')).toThrow('Unknown filter: foo');
    });

    it('throws cleanly when no filters have been registered at all', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      // No registrations on the bare `ng` module yet (built-ins land in
      // later slices). Any name should error consistently.
      expect(() => $filter('anything')).toThrow(FilterLookupError);
      expect(() => $filter('totallyMissing')).toThrow(/Unknown filter: totallyMissing/);
    });
  });

  describe('identity stability', () => {
    it('returns the same FilterFn reference on repeated lookups', () => {
      const appModule = createModule('app', ['ng']).config([
        '$filterProvider',
        ($fp: $FilterProvider) => {
          $fp.register('shout', [() => (s: unknown) => `${String(s)}!`]);
        },
      ]);

      const injector = createInjector([appModule]);
      const $filter = injector.get('$filter');

      const a = $filter('shout');
      const b = $filter('shout');

      expect(a).toBe(b);
      expect(a('hi')).toBe('hi!');
      expect(b('hi')).toBe('hi!');
    });

    it('$filter resolved twice from the injector is the same singleton', () => {
      const injector = createInjector([ngModule]);
      const a: FilterService = injector.get('$filter');
      const b: FilterService = injector.get('$filter');

      expect(a).toBe(b);
    });
  });

  describe('injectability', () => {
    it('$filter is injectable into a module.factory consumer', () => {
      const appModule = createModule('app', ['ng'])
        .config([
          '$filterProvider',
          ($fp: $FilterProvider) => {
            $fp.register('shout', [() => (s: unknown) => `${String(s)}!`]);
          },
        ])
        .factory('formatter', [
          '$filter',
          ($filter: FilterService) =>
            (input: unknown): string =>
              $filter('shout')(input) as string,
        ]);

      const injector = createInjector([appModule]);
      const formatter = injector.get('formatter') as (input: unknown) => string;

      expect(formatter('ok')).toBe('ok!');
    });
  });

  describe('config-phase boundary', () => {
    it('config blocks cannot inject $filter (run-phase service, not a provider)', () => {
      const appModule = createModule('app', ['ng']).config([
        '$filter',
        // The config-phase injector rejects run-phase service names with a
        // dedicated diagnostic that points the user at the corresponding
        // provider — `$filter` (run-phase) vs. `$filterProvider` (config-phase).
        // The message is intentionally distinct from the run-phase
        // `Unknown provider:` text used for typo'd injectable names.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- unreachable; here only to typecheck the dep slot
        ($filter: FilterService) => {
          throw new Error('config block should not have run');
        },
      ]);

      expect(() => createInjector([appModule])).toThrow(
        /Cannot inject "\$filter" during config phase; use "\$filterProvider" instead/,
      );
    });
  });
});
