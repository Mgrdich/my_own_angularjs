/**
 * `uppercase` / `lowercase` built-in filter tests (Slice 5 / FS §§2.17, 2.18).
 *
 * Exercises the canonical full chain: ngModule → `.filter()` DSL →
 * `$filterProvider` → `$filter('uppercase' | 'lowercase')` lookup → call.
 * Built-ins ride on the imported `ngModule` instance directly; the
 * `resetRegistry()` re-mock pattern is here only so unrelated tests in the
 * same vitest worker that reset the registry don't break our `requires`
 * chain — `ngModule` itself has `requires: []` so it loads cleanly.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { FilterFn } from '@filter/filter-types';

describe('uppercase / lowercase built-in filters (FS §§2.17, 2.18)', () => {
  // Re-register a fresh `'ng'` shell so any module declared with
  // `requires: ['ng']` in this file (none currently, but kept for symmetry
  // with the project's DI test pattern) still resolves through the registry.
  // The injector is built with the imported `ngModule` instance directly —
  // that's the chain carrying the actual `.filter('uppercase', …)` etc.
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  describe('uppercase (FS §2.17)', () => {
    it('uppercases a lowercase string', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('uppercase')('hello')).toBe('HELLO');
    });

    it('uppercases a mixed-case string fully', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('uppercase')('Hello World')).toBe('HELLO WORLD');
    });

    it('returns numbers, booleans, null, undefined, and objects unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const upper = $filter('uppercase');

      expect(upper(42)).toBe(42);
      expect(upper(true)).toBe(true);
      expect(upper(false)).toBe(false);
      expect(upper(null)).toBe(null);
      expect(upper(undefined)).toBe(undefined);
      const obj = { a: 1 };
      expect(upper(obj)).toBe(obj);
    });

    it('returns the empty string unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('uppercase')('')).toBe('');
    });

    it('is idempotent on already-uppercase input', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const upper = $filter('uppercase');

      expect(upper('HELLO')).toBe('HELLO');
      expect(upper(upper('hello'))).toBe('HELLO');
    });

    it('is registered as a stateless filter (no $stateful flag)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const upper: FilterFn = $filter('uppercase');

      expect(upper.$stateful).toBeUndefined();
    });
  });

  describe('lowercase (FS §2.18)', () => {
    it('lowercases an uppercase string', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('lowercase')('HELLO')).toBe('hello');
    });

    it('lowercases a mixed-case string fully', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('lowercase')('Hello World')).toBe('hello world');
    });

    it('returns non-string input unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const lower = $filter('lowercase');

      expect(lower(42)).toBe(42);
      expect(lower(true)).toBe(true);
      expect(lower(null)).toBe(null);
      expect(lower(undefined)).toBe(undefined);
      const obj = { a: 1 };
      expect(lower(obj)).toBe(obj);
    });

    it('returns the empty string unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('lowercase')('')).toBe('');
    });

    it('is idempotent on already-lowercase input', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const lower = $filter('lowercase');

      expect(lower('hello')).toBe('hello');
      expect(lower(lower('HELLO'))).toBe('hello');
    });

    it('is registered as a stateless filter (no $stateful flag)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const lower: FilterFn = $filter('lowercase');

      expect(lower.$stateful).toBeUndefined();
    });
  });

  describe('cross-filter independence', () => {
    it('uppercase and lowercase resolve to distinct filter instances', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      const upper = $filter('uppercase');
      const lower = $filter('lowercase');

      // Distinct singletons; one's transformation does not influence the other.
      expect(upper).not.toBe(lower);
      expect(upper('mixedCase')).toBe('MIXEDCASE');
      expect(lower('mixedCase')).toBe('mixedcase');
      // Round-trip is the identity for already-cased input only.
      expect(lower(upper('hello'))).toBe('hello');
    });
  });
});
