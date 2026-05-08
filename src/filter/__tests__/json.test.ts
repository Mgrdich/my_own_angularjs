/**
 * `json` built-in filter tests (Slice 5 / FS §2.19).
 *
 * Locks down the ten FS §2.19 acceptance criteria. Default 2-space indent,
 * explicit spacing, compact mode, edge values (`null`, `undefined`, strings,
 * numbers, arrays), and the `JSON.stringify`-delegated semantics for circular
 * references and non-serializable values (functions, symbols).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { FilterFn } from '@filter/filter-types';

describe('json built-in filter (FS §2.19)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  describe('default spacing', () => {
    it('serializes an object with a 2-space indent (AngularJS default)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('json')({ a: 1, b: 2 })).toBe('{\n  "a": 1,\n  "b": 2\n}');
    });
  });

  describe('explicit spacing', () => {
    it('honors a 4-space indent', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('json')({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');
    });

    it('produces compact output with spacing 0', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('json')({ a: 1 }, 0)).toBe('{"a":1}');
    });
  });

  describe('input shapes', () => {
    it('serializes an array with explicit spacing 0', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('json')([1, 2, 3], 0)).toBe('[1,2,3]');
    });

    it('serializes a string as a JSON-escaped value', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('json')('hello')).toBe('"hello"');
    });

    it('serializes a number as its JSON form', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('json')(42)).toBe('42');
    });
  });

  describe('special values', () => {
    it("serializes null as the literal string 'null'", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('json')(null)).toBe('null');
    });

    it('returns undefined (not the string "undefined") for undefined input', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      // `JSON.stringify(undefined)` returns `undefined`; the filter forwards.
      const out = $filter('json')(undefined);
      expect(out).toBeUndefined();
    });
  });

  describe('JSON.stringify-delegated semantics', () => {
    it('throws on circular references', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const circular: { self?: unknown } = {};
      circular.self = circular;

      expect(() => $filter('json')(circular)).toThrow(TypeError);
    });

    it('omits functions and symbols inside objects', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      const sym = Symbol('hidden');
      const value = { a: 1, fn: () => 1, [sym]: 'sym', s: Symbol('also-hidden') };
      // `JSON.stringify` drops function values, symbol-keyed entries, AND
      // string-keyed entries whose value is a symbol.
      expect($filter('json')(value, 0)).toBe('{"a":1}');
    });
  });

  describe('stateless contract', () => {
    it('the resolved filter has no $stateful flag', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const json: FilterFn = $filter('json');

      expect(json.$stateful).toBeUndefined();
    });
  });
});
