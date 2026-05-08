/**
 * `filter` built-in filter tests (Slice 9 / FS §2.11).
 *
 * Locks down the eleven FS §2.11 acceptance criteria plus the bonus
 * nested-object case. Test vectors marked AngularJS-port were lifted
 * from `angular/angular.js/test/ng/filter/filterSpec.js` and adapted to
 * the local `$filter` resolution path.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import type { FilterFn, FilterService } from '@filter/filter-types';

describe('filter built-in filter (FS §2.11)', () => {
  beforeEach(() => {
    resetRegistry();
    createModule('ng', []);
  });

  describe('string expression — case-insensitive substring against any property', () => {
    it('matches items whose any string property contains the substring (case-insensitive)', () => {
      // AngularJS filterSpec.js: 'should filter by string'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')([{ n: 'Adam' }, { n: 'Beth' }], 'a')).toEqual([{ n: 'Adam' }]);
    });

    it('returns an empty array when no items match', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')([{ n: 'Adam' }, { n: 'Beth' }], 'zzz')).toEqual([]);
    });

    it('matches across multiple string properties on the item', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [
        { first: 'Ada', last: 'Smith' },
        { first: 'Beth', last: 'Jones' },
      ];

      // 'mit' lives in `last` for the first item only.
      expect($filter('filter')(items, 'mit')).toEqual([{ first: 'Ada', last: 'Smith' }]);
    });

    it('recurses into nested objects when looking up any-property matches', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [
        { name: 'Adam', addr: { city: 'Boston' } },
        { name: 'Beth', addr: { city: 'Seattle' } },
      ];

      expect($filter('filter')(items, 'boston')).toEqual([{ name: 'Adam', addr: { city: 'Boston' } }]);
    });

    it('matches by primitive number expression against numeric properties', () => {
      // AngularJS filterSpec.js: 'should filter by number'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')([{ age: 21 }, { age: 33 }], 21)).toEqual([{ age: 21 }]);
    });

    it('matches by primitive boolean expression against boolean properties', () => {
      // AngularJS filterSpec.js: 'should filter by boolean'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')([{ active: true }, { active: false }], true)).toEqual([{ active: true }]);
    });
  });

  describe("string expression with leading '!' — negation", () => {
    it('excludes items whose any property contains the stripped substring', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')([{ n: 'Adam' }, { n: 'Beth' }], '!Adam')).toEqual([{ n: 'Beth' }]);
    });

    it('returns the full input when no item matches the stripped substring', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')([{ n: 'Adam' }, { n: 'Beth' }], '!zzz')).toEqual([{ n: 'Adam' }, { n: 'Beth' }]);
    });
  });

  describe('object expression — per-property match', () => {
    it('matches only on the named property, not other string properties', () => {
      // AngularJS filterSpec.js: 'should filter by object'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [
        { name: 'Adam', last: 'Adamson' },
        { name: 'Beth', last: 'Adamson' }, // 'last' contains 'adam' but `name` does not.
      ];

      expect($filter('filter')(items, { name: 'Adam' })).toEqual([{ name: 'Adam', last: 'Adamson' }]);
    });

    it('uses substring (case-insensitive) match per key by default', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')([{ n: 'Adam' }, { n: 'Adamantium' }], { n: 'adam' })).toEqual([
        { n: 'Adam' },
        { n: 'Adamantium' },
      ]);
    });

    it('treats undefined-valued keys as "no constraint" (matches every item)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')([{ n: 'Adam' }, { n: 'Beth' }], { n: undefined })).toEqual([
        { n: 'Adam' },
        { n: 'Beth' },
      ]);
    });
  });

  describe("object expression — '$' wildcard key", () => {
    it("with '$' key, matches against any property — equivalent to the string form", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ n: 'Adam' }, { n: 'Beth' }];

      expect($filter('filter')(items, { $: 'Adam' })).toEqual([{ n: 'Adam' }]);
    });

    it("with '$' key combined with property-targeted keys, applies AND semantics", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [
        { name: 'Adam', city: 'Boston' },
        { name: 'Adamantium', city: 'Seattle' },
      ];

      // `$:'Adam'` matches both; `name:'Adamantium'` narrows to the second.
      expect($filter('filter')(items, { $: 'Adam', name: 'Adamantium' })).toEqual([
        { name: 'Adamantium', city: 'Seattle' },
      ]);
    });
  });

  describe('predicate function expression', () => {
    it('uses the function directly as a predicate, keeping items where it returns truthy', () => {
      // AngularJS filterSpec.js: 'should filter using a predicate function'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const users = [
        { name: 'Adam', age: 25 },
        { name: 'Beth', age: 17 },
        { name: 'Carl', age: 33 },
      ];

      const adults = $filter('filter')(users, (u: { age: number }) => u.age > 18);
      expect(adults).toEqual([
        { name: 'Adam', age: 25 },
        { name: 'Carl', age: 33 },
      ]);
    });

    it('invokes the predicate once per item with the item as the first argument', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const seen: unknown[] = [];

      $filter('filter')([10, 20, 30], (item: unknown) => {
        seen.push(item);
        return true;
      });

      expect(seen).toEqual([10, 20, 30]);
    });
  });

  describe('comparator true — strict equality', () => {
    it('matches only by strict equality (no substring) when comparator is true', () => {
      // AngularJS filterSpec.js: 'should support strict comparison'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ n: 'Adam' }, { n: 'Adamantium' }];

      expect($filter('filter')(items, { n: 'Adam' }, true)).toEqual([{ n: 'Adam' }]);
    });

    it('strict equality on numeric values', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ age: 21 }, { age: 210 }];

      expect($filter('filter')(items, { age: 21 }, true)).toEqual([{ age: 21 }]);
    });
  });

  describe('comparator function — user-defined', () => {
    it('delegates each leaf comparison to the user comparator', () => {
      // AngularJS filterSpec.js: 'should support a custom comparator'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ n: 'Adam' }, { n: 'Beth' }, { n: 'Aaron' }];

      const startsWithComparator = (actual: unknown, expected: unknown) =>
        typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);

      expect($filter('filter')(items, 'A', startsWithComparator)).toEqual([{ n: 'Adam' }, { n: 'Aaron' }]);
    });

    it('receives (actualLeaf, expectedLeaf) in that order', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const seen: Array<[unknown, unknown]> = [];

      const recordingComparator = (actual: unknown, expected: unknown) => {
        seen.push([actual, expected]);
        return true;
      };

      $filter('filter')([{ n: 'Adam' }], { n: 'Adam' }, recordingComparator);
      expect(seen).toEqual([['Adam', 'Adam']]);
    });
  });

  describe('anyPropertyKey argument (default $)', () => {
    it("uses the supplied wildcard key in place of '$'", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ n: 'Adam' }, { n: 'Beth' }];

      expect($filter('filter')(items, { ANY: 'Adam' }, false, 'ANY')).toEqual([{ n: 'Adam' }]);
    });

    it("does NOT treat '$' as wildcard when a different anyPropertyKey is supplied", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ $: 'literal-dollar' }, { other: 'unrelated' }];

      // With `anyPropertyKey: 'ANY'`, `$` becomes a literal property key.
      expect($filter('filter')(items, { $: 'literal' }, false, 'ANY')).toEqual([{ $: 'literal-dollar' }]);
    });
  });

  describe('empty / null expression', () => {
    it('returns the input unchanged for undefined expression', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ n: 'Adam' }, { n: 'Beth' }];

      expect($filter('filter')(items, undefined)).toBe(items);
    });

    it('returns the input unchanged for null expression', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ n: 'Adam' }, { n: 'Beth' }];

      expect($filter('filter')(items, null)).toBe(items);
    });

    it("returns the input unchanged for '' (empty string) expression", () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const items = [{ n: 'Adam' }, { n: 'Beth' }];

      expect($filter('filter')(items, '')).toBe(items);
    });
  });

  describe('non-array input', () => {
    it('returns null unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')(null, 'a')).toBe(null);
    });

    it('returns undefined unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')(undefined, 'a')).toBe(undefined);
    });

    it('returns a plain object reference unchanged', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const obj = { not: 'an array' };

      expect($filter('filter')(obj, 'a')).toBe(obj);
    });

    it('returns a string unchanged (string is not array-typed for this filter)', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      expect($filter('filter')('hello', 'l')).toBe('hello');
    });
  });

  describe('non-mutation guarantee', () => {
    it('does not mutate a frozen input array', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const frozen = Object.freeze([{ n: 'Adam' }, { n: 'Beth' }]);

      const out = $filter('filter')(frozen, 'a') as ReadonlyArray<{ n: string }>;
      expect(out).toEqual([{ n: 'Adam' }]);
      expect(out).not.toBe(frozen);
      expect(frozen.length).toBe(2);
    });

    it('returns a fresh array reference even when the predicate keeps every item', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const input = [{ n: 'Adam' }, { n: 'Beth' }];

      const out = $filter('filter')(input, () => true);
      expect(out).toEqual(input);
      expect(out).not.toBe(input);
    });
  });

  describe('nested object property matching (FS §2.11 bonus)', () => {
    it('recurses into nested objects when the expression value is itself an object', () => {
      // AngularJS filterSpec.js: 'should match by nested object'
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const users = [
        { name: 'Adam', address: { city: 'Boston' } },
        { name: 'Beth', address: { city: 'Seattle' } },
      ];

      expect($filter('filter')(users, { address: { city: 'Boston' } })).toEqual([
        { name: 'Adam', address: { city: 'Boston' } },
      ]);
    });

    it('combines nested expression with strict comparator', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const users = [
        { name: 'Adam', address: { city: 'Boston' } },
        { name: 'Adam', address: { city: 'Bostonia' } },
      ];

      expect($filter('filter')(users, { address: { city: 'Boston' } }, true)).toEqual([
        { name: 'Adam', address: { city: 'Boston' } },
      ]);
    });
  });

  describe('circular-input safety (recursion bounded by expression structure)', () => {
    it('does not stack-overflow with a self-referencing item under a predicate expression', () => {
      // The matcher walks the EXPRESSION tree, not the input. A predicate
      // never recurses into the item, so input cycles are irrelevant.
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      type Node = { name: string; self?: Node };
      const a: Node = { name: 'Adam' };
      a.self = a;
      const b: Node = { name: 'Beth' };
      b.self = b;

      expect(() => $filter('filter')([a, b], (n: Node) => n.name === 'Adam')).not.toThrow();
    });

    it('does not stack-overflow with a self-referencing item under a strict object expression', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');

      type Node = { name: string; self?: Node };
      const a: Node = { name: 'Adam' };
      a.self = a;
      const b: Node = { name: 'Beth' };
      b.self = b;

      // `{ name: 'Adam' }` only walks the expression — never traverses
      // `item.self`, so the cycle inside the input is not visited.
      expect(() => $filter('filter')([a, b], { name: 'Adam' }, true)).not.toThrow();
      expect($filter('filter')([a, b], { name: 'Adam' }, true)).toEqual([a]);
    });
  });

  describe('stateless contract', () => {
    it('the resolved filter has no $stateful flag', () => {
      const injector = createInjector([ngModule]);
      const $filter = injector.get<FilterService>('$filter');
      const filterFn: FilterFn = $filter('filter');

      expect(filterFn.$stateful).toBeUndefined();
    });
  });
});
