/**
 * End-to-end watch / filter pipeline tests (Slice 4).
 *
 * Locks down the runtime composition: a custom filter registered via
 * `module.filter` resolves through `$filter` and is invoked correctly when
 * the underlying scope is constructed with `filterLookup: $filter`.
 *
 * Built-in filters (`uppercase`, `lowercase`, etc.) land in Slice 5; this
 * test deliberately uses two custom filters for the chain assertion so the
 * suite stays self-contained at the Slice-4 boundary.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterService } from '@filter/filter-types';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('Filter ↔ Scope $watch integration', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => () => undefined])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider)
      .provider('$filter', ['$provide', $FilterProvider]);
  });

  describe('single filter expression', () => {
    it('$watch("msg | shout") fires the listener with the filtered value', () => {
      const appModule = createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ msg: string }>({ filterLookup: $filter });

      const listener = vi.fn();
      scope.$watch('msg | shout', listener);

      scope.msg = 'hi';
      scope.$digest();

      expect(listener).toHaveBeenCalled();
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe('hi!');
    });
  });

  describe('chained filter expression', () => {
    it('$watch("msg | shout | reverse") composes filters left-to-right', () => {
      const appModule = createModule('app', ['ng'])
        .filter('shout', [() => (s: unknown) => `${String(s)}!`])
        .filter('reverse', [() => (s: unknown) => String(s).split('').reverse().join('')]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ msg: string }>({ filterLookup: $filter });

      const listener = vi.fn();
      scope.$watch('msg | shout | reverse', listener);

      scope.msg = 'abc';
      scope.$digest();

      expect(listener).toHaveBeenCalled();
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
      // shout('abc') => 'abc!'; reverse('abc!') => '!cba'
      expect(lastCall?.[0]).toBe('!cba');
    });
  });

  describe('filter argument expression evaluates against scope', () => {
    it('uses scope-resolved arguments in the filter call', () => {
      const appModule = createModule('app', ['ng']).filter('shoutWithSuffix', [
        () => (s: unknown, suffix: unknown) => `${String(s)}${String(suffix)}`,
      ]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ msg: string; suffix: string }>({ filterLookup: $filter });

      const listener = vi.fn();
      scope.$watch('msg | shoutWithSuffix : suffix', listener);

      scope.msg = 'hello';
      scope.suffix = '?';
      scope.$digest();

      expect(listener).toHaveBeenCalled();
      const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe('hello?');
    });
  });

  describe('filter argument with binary expression', () => {
    it('evaluates a compound argument expression against scope', () => {
      const appModule = createModule('app', ['ng']).filter('addTo', [
        () => (s: unknown, n: unknown) => (s as number) + (n as number),
      ]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ base: number; offset: number }>({ filterLookup: $filter });

      const listener = vi.fn();
      scope.$watch('base | addTo : offset + 1', listener);

      scope.base = 10;
      scope.offset = 4;
      scope.$digest();

      const lastCall = listener.mock.calls[listener.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe(15); // 10 + (4 + 1)
    });
  });

  describe('value updates propagate through filters', () => {
    it('re-evaluates the filter when the input changes across digests', () => {
      const appModule = createModule('app', ['ng']).filter('shout', [() => (s: unknown) => `${String(s)}!`]);
      const injector = createInjector([ngModule, appModule]);
      const $filter = injector.get<FilterService>('$filter');
      const scope = Scope.create<{ msg: string }>({ filterLookup: $filter });

      const observed: unknown[] = [];
      scope.$watch('msg | shout', (newValue) => {
        observed.push(newValue);
      });

      scope.msg = 'one';
      scope.$digest();
      scope.msg = 'two';
      scope.$digest();
      scope.msg = 'three';
      scope.$digest();

      // First digest fires once with 'one!'; subsequent digests fire on changes.
      expect(observed).toContain('one!');
      expect(observed).toContain('two!');
      expect(observed).toContain('three!');
    });
  });
});
