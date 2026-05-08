/**
 * End-to-end interpolation × built-in filter integration (Slice 5).
 *
 * Confirms the full cross-module wiring from `ngModule` (filter
 * registration) → `$filterProvider` → `$filter` → interpreter
 * (FilterExpression case) → `$interpolate` (per-render `{ $$filter }`
 * merge from `InterpolateOptions.filterLookup`) all the way to a
 * rendered string.
 *
 * This is the runnable proof that Slice 5's `uppercase`, `lowercase`,
 * `json` work inside `{{ … | filter }}` template syntax.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { parse } from '@parser/index';

describe('Built-in filters × $interpolate integration (Slice 5)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  describe('single filter inside an interpolation', () => {
    it('renders {{ name | uppercase }} with the upper-cased scope value', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('Hello {{ name | uppercase }}!');
      const out = fn({ name: 'world' });

      expect(out).toBe('Hello WORLD!');
    });

    it('renders {{ greeting | lowercase }} with the lower-cased scope value', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('say {{ greeting | lowercase }}');

      expect(fn({ greeting: 'HELLO' })).toBe('say hello');
    });
  });

  describe('chained filters', () => {
    it('round-trips through uppercase | lowercase to the lowercased form', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('{{ greeting | uppercase | lowercase }}');

      // 'Hi' -> 'HI' -> 'hi'
      expect(fn({ greeting: 'Hi' })).toBe('hi');
    });
  });

  describe('json filter with explicit spacing argument', () => {
    it('renders {{ obj | json:0 }} as compact JSON', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get('$interpolate');

      const fn = $interpolate('{{ obj | json:0 }}');

      expect(fn({ obj: { a: 1 } })).toBe('{"a":1}');
    });
  });

  describe('parse-time success for an unknown filter', () => {
    it('parsing {{ x | nonexistent }} does NOT throw at $interpolate setup time', () => {
      const injector = createInjector([ngModule]);
      const $interpolate = injector.get('$interpolate');

      // Build the interpolation function — must not throw even though
      // `nonexistent` is not registered. The runtime failure path is
      // covered comprehensively in `exception-handler-integration.test.ts`
      // (Slice 4); here we only verify the deferred-binding contract.
      expect(() => $interpolate('{{ x | nonexistent }}')).not.toThrow();

      // The pure parser sees the filter chain as a plain expression.
      expect(typeof parse('x | nonexistent')).toBe('function');
    });
  });
});
