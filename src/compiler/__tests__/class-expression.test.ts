/**
 * `flattenClassExpression` — unit tests for the shared class-expression
 * normalizer (spec 024 Slice 1 / technical-considerations §2.1).
 *
 * The helper is the dispatch-based front-end consumed by every
 * `ng-class*` directive in spec 024. These tests pin its three input
 * dispatch paths (string / array / object) and the edge-case
 * pass-throughs (`null`, `undefined`, numbers, booleans, functions) at
 * the call-site granularity — no DOM, no `$compile`, no scope. The
 * integration tests in `ng-class.test.ts` exercise the helper through
 * the directive end-to-end.
 */

import { describe, expect, it } from 'vitest';

import { flattenClassExpression } from '@compiler/class-expression';

describe('flattenClassExpression — string form', () => {
  it('returns a set with a single class for a single-token string', () => {
    expect(flattenClassExpression('active')).toEqual(new Set(['active']));
  });

  it('splits a multi-token string on whitespace', () => {
    expect(flattenClassExpression('foo bar baz')).toEqual(new Set(['foo', 'bar', 'baz']));
  });

  it('trims leading and trailing whitespace', () => {
    expect(flattenClassExpression('  foo bar  ')).toEqual(new Set(['foo', 'bar']));
  });

  it('collapses multiple-space separators between tokens', () => {
    expect(flattenClassExpression('foo    bar')).toEqual(new Set(['foo', 'bar']));
  });

  it('handles mixed whitespace (tabs + spaces + newlines) as a separator', () => {
    expect(flattenClassExpression('foo\tbar\n  baz')).toEqual(new Set(['foo', 'bar', 'baz']));
  });

  it('returns an empty set for an empty string', () => {
    expect(flattenClassExpression('')).toEqual(new Set());
  });

  it('returns an empty set for a whitespace-only string', () => {
    expect(flattenClassExpression('   ')).toEqual(new Set());
  });

  it('de-duplicates repeated tokens within the same string', () => {
    expect(flattenClassExpression('foo bar foo')).toEqual(new Set(['foo', 'bar']));
  });
});

describe('flattenClassExpression — array form', () => {
  it('returns a set containing each string element', () => {
    expect(flattenClassExpression(['selected', 'primary'])).toEqual(new Set(['selected', 'primary']));
  });

  it('handles a single-element array', () => {
    expect(flattenClassExpression(['only'])).toEqual(new Set(['only']));
  });

  it('returns an empty set for an empty array', () => {
    expect(flattenClassExpression([])).toEqual(new Set());
  });

  it('applies the string-form rule to each string element (whitespace-splits)', () => {
    expect(flattenClassExpression(['foo bar', 'baz'])).toEqual(new Set(['foo', 'bar', 'baz']));
  });

  it('applies the object-form rule to nested object elements', () => {
    expect(flattenClassExpression([{ active: true, error: false }])).toEqual(new Set(['active']));
  });

  it('handles a mixed array of strings and objects', () => {
    expect(flattenClassExpression(['a', { active: true, error: false }, 'extra'])).toEqual(
      new Set(['a', 'active', 'extra']),
    );
  });

  it('ignores non-string non-object elements (numbers, booleans, functions, nested arrays)', () => {
    expect(
      flattenClassExpression([
        'kept',
        42,
        true,
        false,
        null,
        undefined,
        () => 'foo',
        ['nested', 'ignored'],
      ] as unknown[]),
    ).toEqual(new Set(['kept']));
  });

  it('skips holes in sparse arrays without error', () => {
    // Sparse array (length 3, only index 1 populated). The `for-of`
    // loop over the array visits the holes as `undefined`, which the
    // helper ignores per the documented edge-case rule.
    const sparse: unknown[] = [];
    sparse[1] = 'b';
    expect(flattenClassExpression(sparse)).toEqual(new Set(['b']));
  });
});

describe('flattenClassExpression — object form', () => {
  it('includes each key whose value is truthy', () => {
    expect(flattenClassExpression({ active: true, primary: 1, hidden: 'yes' })).toEqual(
      new Set(['active', 'primary', 'hidden']),
    );
  });

  it('omits each key whose value is falsy', () => {
    expect(
      flattenClassExpression({
        a: true,
        b: false,
        c: 0,
        d: '',
        e: null,
        f: undefined,
        g: 1,
      }),
    ).toEqual(new Set(['a', 'g']));
  });

  it('returns an empty set for an object with no keys', () => {
    expect(flattenClassExpression({})).toEqual(new Set());
  });

  it('handles multiple truthy keys independently', () => {
    expect(flattenClassExpression({ first: true, second: true, third: true })).toEqual(
      new Set(['first', 'second', 'third']),
    );
  });
});

describe('flattenClassExpression — edge-case inputs return empty sets', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the number 42', 42],
    ['the number 0', 0],
    ['boolean true', true],
    ['boolean false', false],
    ['a function', (): string => 'foo'],
    ['NaN', Number.NaN],
  ])('returns an empty set for %s', (_label, value) => {
    expect(flattenClassExpression(value)).toEqual(new Set());
  });
});

describe('flattenClassExpression — purity', () => {
  it('returns a fresh Set on every call (not a shared reference)', () => {
    const a = flattenClassExpression('foo');
    const b = flattenClassExpression('foo');
    expect(a).not.toBe(b);
  });

  it('does not mutate an array input', () => {
    const input = ['a', 'b'];
    flattenClassExpression(input);
    expect(input).toEqual(['a', 'b']);
  });

  it('does not mutate an object input', () => {
    const input = { active: true, error: false };
    flattenClassExpression(input);
    expect(input).toEqual({ active: true, error: false });
  });

  it('callers may freely mutate the returned set without affecting subsequent calls', () => {
    const a = flattenClassExpression('foo bar');
    a.add('baz');
    a.delete('foo');
    expect(flattenClassExpression('foo bar')).toEqual(new Set(['foo', 'bar']));
  });
});
