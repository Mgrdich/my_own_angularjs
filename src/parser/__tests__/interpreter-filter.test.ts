import { describe, expect, it } from 'vitest';
import { parse } from '@parser/parse';
import { FilterLookupError } from '@filter/filter-error';
import type { FilterFn } from '@filter/filter-types';

const upperFn: FilterFn = (value) => String(value).toUpperCase();
const limitToFn: FilterFn = (value, limit) => {
  if (!Array.isArray(value)) return value;
  const n = typeof limit === 'number' ? limit : Number(limit);
  return (value as unknown[]).slice(0, n);
};

function makeLookup(map: Record<string, FilterFn>): (name: string) => FilterFn {
  return (name) => {
    const fn = map[name];
    if (fn === undefined) {
      throw new FilterLookupError(name);
    }
    return fn;
  };
}

describe('interpreter — FilterExpression evaluation', () => {
  it('resolves a filter via locals.$$filter and applies it to the input', () => {
    const fn = parse('value | upper');
    const result = fn({ value: 'hello' }, { $$filter: makeLookup({ upper: upperFn }) });
    expect(result).toBe('HELLO');
  });

  it('throws FilterLookupError when locals.$$filter is absent', () => {
    const fn = parse('value | upper');
    let caught: unknown;
    try {
      fn({ value: 'hello' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FilterLookupError);
    if (caught instanceof FilterLookupError) {
      expect(caught.message).toBe('Unknown filter: upper');
    }
  });

  it('propagates FilterLookupError thrown by the lookup for an unregistered name', () => {
    const fn = parse('value | nonexistent');
    let caught: unknown;
    try {
      fn({ value: 'hello' }, { $$filter: makeLookup({ upper: upperFn }) });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FilterLookupError);
    if (caught instanceof FilterLookupError) {
      expect(caught.message).toBe('Unknown filter: nonexistent');
    }
  });

  it('throws when locals.$$filter is present but not callable', () => {
    const fn = parse('value | upper');
    expect(() => fn({ value: 'hello' }, { $$filter: 'not a function' })).toThrow(FilterLookupError);
  });

  it('evaluates filter argument expressions against the same scope', () => {
    const fn = parse('items | limitTo : count');
    const result = fn({ items: [1, 2, 3, 4, 5], count: 3 }, { $$filter: makeLookup({ limitTo: limitToFn }) });
    expect(result).toEqual([1, 2, 3]);
  });

  it('evaluates filter argument expressions with arithmetic against the scope', () => {
    const fn = parse('items | limitTo : count + 1');
    const result = fn({ items: [1, 2, 3, 4, 5], count: 2 }, { $$filter: makeLookup({ limitTo: limitToFn }) });
    expect(result).toEqual([1, 2, 3]);
  });

  it('preserves locals lookups inside filter argument expressions (locals beats scope)', () => {
    const fn = parse('items | limitTo : count');
    const result = fn({ items: [1, 2, 3, 4, 5], count: 1 }, { $$filter: makeLookup({ limitTo: limitToFn }), count: 4 });
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('chains filters left-to-right — the second filter receives the first filter`s output', () => {
    const reverseFn: FilterFn = (value) => String(value).split('').reverse().join('');
    const fn = parse('value | upper | reverse');
    const result = fn({ value: 'abc' }, { $$filter: makeLookup({ upper: upperFn, reverse: reverseFn }) });
    expect(result).toBe('CBA');
  });

  it('passes the input value as the first argument followed by the filter args', () => {
    const recorded: unknown[] = [];
    const recorder: FilterFn = (...args) => {
      recorded.push(args);
      return args;
    };
    const fn = parse('value | rec : 1 : 2 : 3');
    fn({ value: 'in' }, { $$filter: makeLookup({ rec: recorder }) });
    expect(recorded).toEqual([['in', 1, 2, 3]]);
  });
});
