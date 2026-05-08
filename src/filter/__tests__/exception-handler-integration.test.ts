/**
 * Filter ↔ `$exceptionHandler` integration tests (Slice 4 / FS §2.8).
 *
 * Covers the six FS §2.8 acceptance criteria for unknown-filter routing at
 * digest time. The contract: parsing `'x | nonexistent'` succeeds, but
 * evaluating it inside `$digest` against a scope wired with `filterLookup:
 * $filter` surfaces the `Unknown filter:` error through `$exceptionHandler`
 * with cause `'$filter'` — and the digest continues so sibling watches still
 * run. Direct `$filter('nonexistent')` calls still throw synchronously
 * because there is no `$exceptionHandler` context to route through.
 *
 * The `EXCEPTION_HANDLER_CAUSES.includes('$filter')` runtime check, the
 * compile-time `'$filter' satisfies ExceptionHandlerCause` assertion, and the
 * length === 9 lock-in (after spec 016 added `'$filter'`) all cement the
 * public-API addition in code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler, type ExceptionHandlerCause } from '@exception-handler/index';
import { FilterLookupError } from '@filter/filter-error';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterService } from '@filter/filter-types';
import { parse } from '@parser/index';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('Filter ↔ $exceptionHandler integration (FS §2.8)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('FS §2.8 #1: parse-time success', () => {
    it("parse('x | nonexistent') does NOT throw at parse time", () => {
      expect(() => parse('x | nonexistent')).not.toThrow();
      const fn = parse('x | nonexistent');
      expect(typeof fn).toBe('function');
    });
  });

  describe('FS §2.8 #2: digest-time routing through $exceptionHandler', () => {
    it("routes 'Unknown filter:' through the handler with cause '$filter'", () => {
      const spy = vi.fn<ExceptionHandler>();
      const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => spy]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ x: string }>({ filterLookup: $filter, exceptionHandler: spy });

      scope.x = 'hello';
      scope.$watch('x | nonexistent', () => undefined);
      scope.$digest();

      expect(spy).toHaveBeenCalled();
      const filterCalls = spy.mock.calls.filter((call) => call[1] === '$filter');
      expect(filterCalls.length).toBeGreaterThan(0);
      const firstCall = filterCalls[0];
      expect(firstCall).toBeDefined();
      expect(firstCall?.[0]).toBeInstanceOf(FilterLookupError);
      expect((firstCall?.[0] as Error).message).toBe('Unknown filter: nonexistent');
    });
  });

  describe('FS §2.8 #3: digest continues, sibling watches still run', () => {
    it('runs every other watcher in the same cycle even when one filter expression fails', () => {
      const spy = vi.fn<ExceptionHandler>();
      const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => spy]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ a: number; b: number }>({
        filterLookup: $filter,
        exceptionHandler: spy,
      });
      scope.a = 1;
      scope.b = 2;

      const goodListener = vi.fn();
      scope.$watch('b', goodListener); // sibling, no filter
      // The bad watch is registered second to confirm the sibling runs even
      // though digest visits watchers in reverse order.
      const badListener = vi.fn();
      scope.$watch('a | nonexistent', badListener);

      scope.$digest();

      // The sibling listener fires (initial-value pass).
      expect(goodListener).toHaveBeenCalled();
      // The bad watch's filter-lookup throw was reported.
      const filterCalls = spy.mock.calls.filter((call) => call[1] === '$filter');
      expect(filterCalls.length).toBeGreaterThan(0);

      // Digest didn't crash — second cycle works too.
      scope.b = 3;
      expect(() => {
        scope.$digest();
      }).not.toThrow();
      // The good listener fired again on the value change.
      expect(goodListener.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('FS §2.8 #4: $filter direct call throws synchronously, not via handler', () => {
    it('$filter("nonexistent") raises FilterLookupError without invoking the handler', () => {
      const spy = vi.fn<ExceptionHandler>();
      const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => spy]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect(() => $filter('nonexistent')).toThrow(FilterLookupError);
      expect(() => $filter('nonexistent')).toThrow(/Unknown filter: nonexistent/);
      expect(spy).not.toHaveBeenCalled();
    });

    it('parse("x | nonexistent")(scope) outside any digest also throws synchronously', () => {
      const spy = vi.fn<ExceptionHandler>();
      const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => spy]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');

      const fn = parse('x | nonexistent');
      // No digest context — calls bubble synchronously regardless of whether
      // $$filter is supplied; here we provide it so the throw originates from
      // the lookup itself rather than the missing-`$$filter` guard.
      expect(() =>
        fn({ x: 'hi' } as Record<string, unknown>, { $$filter: $filter } as Record<string, unknown>),
      ).toThrow(FilterLookupError);

      // Outside-digest calls don't reach the handler — the throw bubbles to
      // whoever owns the call site.
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("FS §2.8 #5: EXCEPTION_HANDLER_CAUSES includes '$filter'", () => {
    it('the runtime cause vocabulary is widened by exactly one token', () => {
      expect(EXCEPTION_HANDLER_CAUSES).toContain('$filter');
      expect(EXCEPTION_HANDLER_CAUSES.length).toBe(9);
    });
  });

  describe("FS §2.8 #6: '$filter' satisfies ExceptionHandlerCause (compile-time)", () => {
    it('the typed union accepts the new token without widening', () => {
      // The `satisfies` operator is a compile-time guard; runtime is a no-op.
      // If the derived `ExceptionHandlerCause` union ever drifted from the
      // const tuple, this expression would fail `pnpm typecheck`.
      const cause = '$filter' satisfies ExceptionHandlerCause;
      expect(cause).toBe('$filter');
    });
  });

  describe('cause refinement at every digest call site', () => {
    it("$evalAsync filter expression failures route with cause '$filter'", () => {
      const spy = vi.fn<ExceptionHandler>();
      const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => spy]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ msg: string }>({
        filterLookup: $filter,
        exceptionHandler: spy,
      });
      scope.msg = 'hi';

      scope.$evalAsync('msg | nonexistent');
      scope.$digest();

      const filterCalls = spy.mock.calls.filter((call) => call[1] === '$filter');
      expect(filterCalls.length).toBeGreaterThan(0);
      expect(filterCalls[0]?.[0]).toBeInstanceOf(FilterLookupError);
    });

    it('$interpolate filter expression failures route through $exceptionHandler with cause "$filter"', () => {
      const spy = vi.fn<ExceptionHandler>();
      const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => spy]);
      const injector = createInjector([ngModule, appModule]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('Hello {{ name | nonexistent }}!');
      const result = fn({ name: 'world' } as Record<string, unknown>);

      // Render returns the surrounding text with the bad slot rendered as
      // empty (the spec-014 contract treats render-time errors as undefined).
      expect(result).toBe('Hello !');

      const filterCalls = spy.mock.calls.filter((call) => call[1] === '$filter');
      expect(filterCalls.length).toBeGreaterThan(0);
      expect(filterCalls[0]?.[0]).toBeInstanceOf(FilterLookupError);
    });
  });

  describe('filterLookup option is missing', () => {
    it("a scope without filterLookup surfaces 'Unknown filter:' through the handler", () => {
      // No filter wiring at all — the interpreter's `$$filter` lookup is
      // undefined, so the FilterExpression case throws FilterLookupError
      // immediately. Scope's catch site routes it as cause '$filter'.
      const spy = vi.fn<ExceptionHandler>();
      const scope = Scope.create<{ x: string }>({ exceptionHandler: spy });
      scope.x = 'hi';

      scope.$watch('x | shout', () => undefined);
      scope.$digest();

      const filterCalls = spy.mock.calls.filter((call) => call[1] === '$filter');
      expect(filterCalls.length).toBeGreaterThan(0);
      expect(filterCalls[0]?.[0]).toBeInstanceOf(FilterLookupError);
    });
  });
});
