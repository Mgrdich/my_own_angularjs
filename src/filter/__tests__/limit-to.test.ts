/**
 * `limitTo` built-in filter tests (Slice 6 / FS §2.13).
 *
 * Locks down the nine FS §2.13 acceptance criteria. Positive and
 * negative limits, string + number coercion, the `begin` argument
 * (positive-only), `Infinity` boundaries, pass-through for non-handled
 * types, and the non-mutation guarantee (verified via a frozen array).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { FilterFn } from '@filter/filter-types';

describe('limitTo built-in filter (FS §2.13)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  describe('positive limit', () => {
    it('returns the first N items of an array', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
    });

    it('returns the input array unchanged when limit exceeds length', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')([1, 2, 3], 10)).toEqual([1, 2, 3]);
    });
  });

  describe('negative limit', () => {
    it('returns the last |N| items of an array', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')([1, 2, 3, 4, 5], -2)).toEqual([4, 5]);
    });

    it('returns all items when |negative limit| exceeds length', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')([1, 2, 3], -10)).toEqual([1, 2, 3]);
    });
  });

  describe('string input', () => {
    it('returns the first N characters with a positive limit', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')('hello', 3)).toBe('hel');
    });

    it('returns the last |N| characters with a negative limit', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')('hello', -2)).toBe('lo');
    });
  });

  describe('begin argument', () => {
    it('slices from begin for begin items with a positive limit', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')([1, 2, 3, 4, 5], 2, 1)).toEqual([2, 3]);
    });

    it('ignores begin when limit is negative (AngularJS canonical)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      // The 99 begin would short-circuit if it were honored; the negative
      // limit must dominate and the last two items are returned regardless.
      expect($filter('limitTo')([1, 2, 3, 4, 5], -2, 99)).toEqual([4, 5]);
    });
  });

  describe('numeric input', () => {
    it('coerces a number to its decimal string and slices', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')(12345, 3)).toBe('123');
    });

    it('honors negative limits on coerced numbers', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')(12345, -2)).toBe('45');
    });
  });

  describe('Infinity limit', () => {
    it('returns the entire array for Infinity', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')([1, 2, 3], Infinity)).toEqual([1, 2, 3]);
    });

    it('returns the entire array for -Infinity', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')([1, 2, 3], -Infinity)).toEqual([1, 2, 3]);
    });
  });

  describe('pass-through for non-handled inputs', () => {
    it('returns null unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')(null, 3)).toBe(null);
    });

    it('returns undefined unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');

      expect($filter('limitTo')(undefined, 3)).toBe(undefined);
    });

    it('returns a plain object by reference (no slicing)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const obj = { a: 1, b: 2 };

      expect($filter('limitTo')(obj, 3)).toBe(obj);
    });
  });

  describe('non-mutation guarantee', () => {
    it('does not mutate a frozen array input', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const frozen = Object.freeze([1, 2, 3, 4, 5]);

      // The slice is a fresh array, so freezing the input does not throw.
      const out = $filter('limitTo')(frozen, 3) as ReadonlyArray<number>;
      expect(out).toEqual([1, 2, 3]);
      expect(out).not.toBe(frozen);
      expect(frozen).toEqual([1, 2, 3, 4, 5]);
    });

    it('returns a fresh array reference (does not alias input)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const input = [1, 2, 3, 4, 5];

      const out = $filter('limitTo')(input, 5);
      expect(out).toEqual(input);
      expect(out).not.toBe(input);
    });
  });

  describe('stateless contract', () => {
    it('the resolved filter has no $stateful flag', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get('$filter');
      const limitTo: FilterFn = $filter('limitTo');

      expect(limitTo.$stateful).toBeUndefined();
    });
  });
});
