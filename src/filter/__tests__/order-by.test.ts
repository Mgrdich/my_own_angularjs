/**
 * `orderBy` built-in filter tests (Slice 10 / FS §2.12).
 *
 * Locks down the thirteen FS §2.12 acceptance criteria plus the
 * empty-array sanity case. Test vectors marked AngularJS-port were
 * lifted from `angular/angular.js/test/ng/filter/orderBySpec.js` and
 * adapted to the local `$filter` resolution path.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { FilterFn, FilterService } from '@filter/filter-types';

describe('orderBy built-in filter (FS §2.12)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  describe('string predicate — ascending by property', () => {
    it('sorts items ascending by the named property', () => {
      // AngularJS orderBySpec.js: 'should sort by predicate'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [{ name: 'Beth' }, { name: 'Adam' }, { name: 'Carl' }];
      expect($filter('orderBy')(users, 'name')).toEqual([{ name: 'Adam' }, { name: 'Beth' }, { name: 'Carl' }]);
    });

    it('sorts numerically when the property is a number', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const items = [{ age: 30 }, { age: 25 }, { age: 35 }];
      expect($filter('orderBy')(items, 'age')).toEqual([{ age: 25 }, { age: 30 }, { age: 35 }]);
    });
  });

  describe('+ / - prefix — direction', () => {
    it("'-name' sorts descending", () => {
      // AngularJS orderBySpec.js: 'should sort by reverse predicate'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [{ name: 'Adam' }, { name: 'Beth' }, { name: 'Carl' }];
      expect($filter('orderBy')(users, '-name')).toEqual([{ name: 'Carl' }, { name: 'Beth' }, { name: 'Adam' }]);
    });

    it("'+name' is explicit ascending — equivalent to bare 'name'", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [{ name: 'Beth' }, { name: 'Adam' }, { name: 'Carl' }];
      expect($filter('orderBy')(users, '+name')).toEqual($filter('orderBy')(users, 'name'));
    });
  });

  describe('function predicate', () => {
    it('sorts by the function result', () => {
      // AngularJS orderBySpec.js: 'should sort by predicate function'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [{ lastName: 'Smith' }, { lastName: 'adams' }, { lastName: 'Brown' }];
      const sorted = $filter('orderBy')(users, (u: { lastName: string }) => u.lastName.toLowerCase()) as ReadonlyArray<{
        lastName: string;
      }>;

      expect(sorted.map((u) => u.lastName)).toEqual(['adams', 'Brown', 'Smith']);
    });

    it('invokes the function once per item', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const seen: unknown[] = [];

      $filter('orderBy')([3, 1, 2], (item: unknown) => {
        seen.push(item);
        return item;
      });

      expect(seen).toEqual([3, 1, 2]);
    });
  });

  describe('array of predicates — primary + tie-breaker', () => {
    it('sorts by the first predicate, breaking ties with the second', () => {
      // AngularJS orderBySpec.js: 'should use multiple predicates as tie-breakers'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [
        { lastName: 'Adams', firstName: 'Charlie' },
        { lastName: 'Brown', firstName: 'Alice' },
        { lastName: 'Adams', firstName: 'Beth' },
      ];

      expect($filter('orderBy')(users, ['lastName', 'firstName'])).toEqual([
        { lastName: 'Adams', firstName: 'Beth' },
        { lastName: 'Adams', firstName: 'Charlie' },
        { lastName: 'Brown', firstName: 'Alice' },
      ]);
    });
  });

  describe('mixed array — direction per element', () => {
    it("['-age', 'name'] — descending age, ascending name on ties", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [
        { age: 25, name: 'Adam' },
        { age: 30, name: 'Charlie' },
        { age: 25, name: 'Beth' },
        { age: 30, name: 'Alice' },
      ];

      expect($filter('orderBy')(users, ['-age', 'name'])).toEqual([
        { age: 30, name: 'Alice' },
        { age: 30, name: 'Charlie' },
        { age: 25, name: 'Adam' },
        { age: 25, name: 'Beth' },
      ]);
    });
  });

  describe('reverse argument', () => {
    it('reverses the entire sort order', () => {
      // AngularJS orderBySpec.js: 'should reverse the sort if `reverseOrder` is true'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [{ name: 'Beth' }, { name: 'Adam' }, { name: 'Carl' }];
      expect($filter('orderBy')(users, 'name', true)).toEqual([{ name: 'Carl' }, { name: 'Beth' }, { name: 'Adam' }]);
    });

    it('reverse=false leaves direction unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [{ name: 'Beth' }, { name: 'Adam' }, { name: 'Carl' }];
      expect($filter('orderBy')(users, 'name', false)).toEqual($filter('orderBy')(users, 'name'));
    });
  });

  describe('custom comparator', () => {
    it('uses the user-supplied comparator', () => {
      // AngularJS orderBySpec.js: 'should support a custom comparator'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const users = [{ name: 'Beth' }, { name: 'Adam' }];
      const reverseLocaleComparator = (a: { value: unknown }, b: { value: unknown }) =>
        String(b.value).localeCompare(String(a.value));

      expect($filter('orderBy')(users, 'name', false, reverseLocaleComparator)).toEqual([
        { name: 'Beth' },
        { name: 'Adam' },
      ]);
    });

    it('receives ComparisonValue-shaped (value/type/index) keys', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const seen: Array<{ value: unknown; type: unknown; index: unknown }> = [];

      const recordingComparator = (a: { value: unknown; type: unknown; index: unknown }, b: typeof a) => {
        seen.push(a, b);
        return 0;
      };

      $filter('orderBy')([{ name: 'A' }, { name: 'B' }], 'name', false, recordingComparator);
      expect(seen.length).toBeGreaterThan(0);
      const first = seen[0];
      expect(first).toBeDefined();
      expect(typeof first?.value).toBe('string');
      expect(first?.type).toBe('string');
      expect(typeof first?.index).toBe('number');
    });
  });

  describe('default ordering rules — type precedence', () => {
    it('compares numbers numerically', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      // Numeric, NOT lexicographic — `10` ranks above `2`.
      expect($filter('orderBy')([10, 2, 1, 20], '+')).toEqual([1, 2, 10, 20]);
    });

    it('compares strings case-insensitively', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      // `'Adam'` and `'adam'` compare equal under lowercase folding;
      // tie-break preserves input order.
      expect($filter('orderBy')(['Adam', 'beth', 'Carl', 'adam'], '+')).toEqual(['Adam', 'adam', 'beth', 'Carl']);
    });

    it('null and undefined sort to the END (ascending)', () => {
      // AngularJS orderBySpec.js: 'should sort `undefined` and `null` values to the end'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const items = [{ x: 2 }, { x: null }, { x: 1 }, { x: undefined }, { x: 3 }];
      const result = $filter('orderBy')(items, 'x') as ReadonlyArray<{ x: unknown }>;
      // First three are the defined values in ascending order.
      expect(result.slice(0, 3)).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
      // Last two are null/undefined in some order — both at the end.
      const tail = result.slice(3);
      expect(tail).toHaveLength(2);
      expect(tail.every((item) => item.x === null || item.x === undefined)).toBe(true);
    });

    it('null and undefined still sort to the END under descending order', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const items = [{ x: 2 }, { x: null }, { x: 1 }, { x: undefined }, { x: 3 }];
      const result = $filter('orderBy')(items, '-x') as ReadonlyArray<{ x: unknown }>;
      // First three are the defined values in descending order.
      expect(result.slice(0, 3)).toEqual([{ x: 3 }, { x: 2 }, { x: 1 }]);
      // Last two are still null/undefined.
      const tail = result.slice(3);
      expect(tail.every((item) => item.x === null || item.x === undefined)).toBe(true);
    });

    it('mixed types compare by typeof precedence (lexical order of type names)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      // `'boolean' < 'number' < 'string'` lexically — booleans rank
      // first, then numbers, then strings.
      const result = $filter('orderBy')(['hello', 5, true, 1, 'world', false], '+') as ReadonlyArray<unknown>;
      // Booleans first (false < true): false, true
      // Numbers next (1 < 5): 1, 5
      // Strings last ('hello' < 'world'): 'hello', 'world'
      expect(result).toEqual([false, true, 1, 5, 'hello', 'world']);
    });
  });

  describe('empty / identity predicates', () => {
    it("'+' sorts by item identity itself", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')([3, 1, 2], '+')).toEqual([1, 2, 3]);
    });

    it("'-' sorts by item identity, descending", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')([3, 1, 2], '-')).toEqual([3, 2, 1]);
    });

    it("'' (empty string) sorts by item identity", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')([3, 1, 2], '')).toEqual([1, 2, 3]);
    });

    it('undefined predicate sorts by item identity', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')([3, 1, 2], undefined)).toEqual([1, 2, 3]);
    });

    it('empty predicate array `[]` defaults to identity ascending', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')([3, 1, 2], [])).toEqual([1, 2, 3]);
    });
  });

  describe('non-mutation guarantee', () => {
    it('does not mutate a frozen input array', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const frozen = Object.freeze([{ n: 'Beth' }, { n: 'Adam' }]);

      const out = $filter('orderBy')(frozen, 'n') as ReadonlyArray<{ n: string }>;
      expect(out).toEqual([{ n: 'Adam' }, { n: 'Beth' }]);
      expect(out).not.toBe(frozen);
      // Frozen reference still in original order.
      expect(frozen[0]).toEqual({ n: 'Beth' });
      expect(frozen[1]).toEqual({ n: 'Adam' });
    });

    it('returns a fresh array reference even when the input is already sorted', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const input = [{ n: 'Adam' }, { n: 'Beth' }];

      const out = $filter('orderBy')(input, 'n');
      expect(out).toEqual(input);
      expect(out).not.toBe(input);
    });
  });

  describe('non-array input', () => {
    it('returns null unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')(null, 'name')).toBe(null);
    });

    it('returns undefined unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')(undefined, 'name')).toBe(undefined);
    });

    it('returns a plain object reference unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const obj = { not: 'an array' };

      expect($filter('orderBy')(obj, 'name')).toBe(obj);
    });

    it('returns a string unchanged (string is not array-typed for this filter)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')('hello', '+')).toBe('hello');
    });
  });

  describe('stable sort guarantee', () => {
    it('items with equal sort keys retain their relative input order (sentinel _origIndex)', () => {
      // AngularJS orderBySpec.js: 'should sort stably'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      // Build an input where every item has the SAME sort key but a
      // distinct sentinel `_origIndex`. After sorting, the sentinel
      // sequence MUST equal the input sequence — that's stable sort.
      type Item = { key: string; _origIndex: number };
      const items: Item[] = Array.from({ length: 50 }, (_, i) => ({ key: 'tied', _origIndex: i }));

      const sorted = $filter('orderBy')(items, 'key') as ReadonlyArray<Item>;
      expect(sorted.map((item) => item._origIndex)).toEqual(items.map((item) => item._origIndex));
    });

    it('items with equal primary keys retain order on the secondary fallback', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      type Item = { group: string; _origIndex: number };
      const items: Item[] = [
        { group: 'b', _origIndex: 0 },
        { group: 'a', _origIndex: 1 },
        { group: 'b', _origIndex: 2 },
        { group: 'a', _origIndex: 3 },
        { group: 'b', _origIndex: 4 },
      ];

      const sorted = $filter('orderBy')(items, 'group') as ReadonlyArray<Item>;
      // Groups sort to: a, a, b, b, b. Within each group, _origIndex
      // sequence preserves input order.
      expect(sorted.map((item) => item._origIndex)).toEqual([1, 3, 0, 2, 4]);
    });
  });

  describe('empty array sanity (FS §2.12 implicit 13th)', () => {
    it('returns an empty array unchanged in shape', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('orderBy')([], 'name')).toEqual([]);
    });

    it('empty input + reverse + comparator still returns []', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      const result = $filter('orderBy')([], 'name', true, () => 0);
      expect(result).toEqual([]);
    });
  });

  describe('stateless contract', () => {
    it('the resolved filter has no $stateful flag', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const filterFn: FilterFn = $filter('orderBy');

      expect(filterFn.$stateful).toBeUndefined();
    });
  });
});
