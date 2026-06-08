/**
 * `parseIteratorExpression` — iterator expression parser for `ng-repeat`
 * (spec 028 Slice 1 / technical-considerations §2.1).
 *
 * Locks the AngularJS-canonical grammar
 * `ITEM in COLLECTION [as ALIAS] [track by EXPR]` and the
 * `(KEY, VALUE)` tuple-LHS variant. Coverage walks the four optional
 * clauses in every combination, validates the returned record shape
 * (identifier strings + the compiled `ExpressionFn` callables), and
 * pins the three error classes the parser surfaces:
 *
 *  - {@link NgRepeatBadIteratorExpressionError} — top-level regex miss
 *    (empty input, missing `in`, empty item name).
 *  - {@link NgRepeatBadIdentifierError} — any LHS identifier fails
 *    `IDENT_RE` (empty, leading digit, contains punctuation, the
 *    three-name parenthesized form, unparenthesized `(k, v)`).
 *  - {@link NgRepeatBadAliasError} — alias collides with the item /
 *    key / value name in the same expression OR with one of the six
 *    reserved per-row locals (`$index`, `$first`, `$last`, `$middle`,
 *    `$even`, `$odd`).
 *
 * Compiled sub-expressions (the `<collection>` and `<track by>`
 * strings) are invoked against tiny scope objects to verify the
 * `parse()` integration end-to-end.
 *
 * Module-private surface only — the parser exports a single function
 * and the directive factory (Slice 3) is its sole runtime consumer.
 */

import { describe, expect, it } from 'vitest';

import { NgRepeatBadAliasError, NgRepeatBadIdentifierError, NgRepeatBadIteratorExpressionError } from '@compiler/index';
import { parseIteratorExpression } from '@compiler/ng-repeat-iterator-parse';

describe('parseIteratorExpression — basic `item in list`', () => {
  it('parses the canonical single-identifier form', () => {
    const parsed = parseIteratorExpression('todo in todos');

    expect(parsed.keyIdent).toBeNull();
    expect(parsed.valueIdent).toBe('todo');
    expect(parsed.aliasIdent).toBeNull();
    expect(parsed.trackByExpr).toBeNull();
    expect(typeof parsed.collectionExpr).toBe('function');
  });

  it('compiles `collectionExpr` so it evaluates against a scope', () => {
    const parsed = parseIteratorExpression('item in items');

    expect(parsed.collectionExpr({ items: [10, 20, 30] })).toEqual([10, 20, 30]);
  });

  it('accepts a dollar-prefixed item identifier', () => {
    const parsed = parseIteratorExpression('$item in $items');

    expect(parsed.valueIdent).toBe('$item');
    expect(parsed.collectionExpr({ $items: [1] })).toEqual([1]);
  });

  it('accepts an underscore-prefixed item identifier', () => {
    const parsed = parseIteratorExpression('_x in _xs');

    expect(parsed.valueIdent).toBe('_x');
  });
});

describe('parseIteratorExpression — `(key, value) in obj`', () => {
  it('parses the canonical tuple form and exposes both idents', () => {
    const parsed = parseIteratorExpression('(name, age) in people');

    expect(parsed.keyIdent).toBe('name');
    expect(parsed.valueIdent).toBe('age');
    expect(parsed.aliasIdent).toBeNull();
    expect(parsed.trackByExpr).toBeNull();
  });

  it('tolerates extra whitespace inside the parens', () => {
    const parsed = parseIteratorExpression('(  k  ,   v  ) in obj');

    expect(parsed.keyIdent).toBe('k');
    expect(parsed.valueIdent).toBe('v');
  });

  it('accepts dollar- and underscore-prefixed names in the tuple', () => {
    const parsed = parseIteratorExpression('($k, _v) in obj');

    expect(parsed.keyIdent).toBe('$k');
    expect(parsed.valueIdent).toBe('_v');
  });

  it('compiles `collectionExpr` so it evaluates against a scope', () => {
    const parsed = parseIteratorExpression('(k, v) in obj');
    const value = parsed.collectionExpr({ obj: { a: 1, b: 2 } });

    expect(value).toEqual({ a: 1, b: 2 });
  });
});

describe('parseIteratorExpression — `as alias`', () => {
  it('captures the alias identifier on the single-identifier form', () => {
    const parsed = parseIteratorExpression('todo in todos as visible');

    expect(parsed.valueIdent).toBe('todo');
    expect(parsed.aliasIdent).toBe('visible');
    expect(parsed.trackByExpr).toBeNull();
  });

  it('captures the alias identifier on the tuple form', () => {
    const parsed = parseIteratorExpression('(k, v) in obj as visible');

    expect(parsed.keyIdent).toBe('k');
    expect(parsed.valueIdent).toBe('v');
    expect(parsed.aliasIdent).toBe('visible');
  });

  it('accepts dollar- and underscore-prefixed alias identifiers', () => {
    expect(parseIteratorExpression('todo in todos as $visible').aliasIdent).toBe('$visible');
    expect(parseIteratorExpression('todo in todos as _list').aliasIdent).toBe('_list');
  });
});

describe('parseIteratorExpression — `track by EXPR`', () => {
  it('captures and compiles a property-path track-by expression', () => {
    const parsed = parseIteratorExpression('todo in todos track by todo.id');

    expect(parsed.trackByExpr).not.toBeNull();
    if (parsed.trackByExpr !== null) {
      expect(parsed.trackByExpr({ todo: { id: 42 } })).toBe(42);
    }
  });

  it('accepts `track by $index` (the canonical escape hatch)', () => {
    const parsed = parseIteratorExpression('n in [1, 2, 2, 3] track by $index');

    expect(parsed.trackByExpr).not.toBeNull();
    if (parsed.trackByExpr !== null) {
      expect(parsed.trackByExpr({ $index: 3 })).toBe(3);
    }
  });

  it('accepts a method-call track-by expression', () => {
    const parsed = parseIteratorExpression('item in items track by item.identityKey()');

    expect(parsed.trackByExpr).not.toBeNull();
    if (parsed.trackByExpr !== null) {
      const value = parsed.trackByExpr({ item: { identityKey: () => 'k1' } });
      expect(value).toBe('k1');
    }
  });

  it('captures `track by` on the tuple form', () => {
    const parsed = parseIteratorExpression('(k, v) in obj track by k');

    expect(parsed.keyIdent).toBe('k');
    expect(parsed.valueIdent).toBe('v');
    expect(parsed.trackByExpr).not.toBeNull();
    if (parsed.trackByExpr !== null) {
      expect(parsed.trackByExpr({ k: 'apple' })).toBe('apple');
    }
  });
});

describe('parseIteratorExpression — combined forms', () => {
  it('parses `item in list as alias track by item.id`', () => {
    const parsed = parseIteratorExpression('todo in todos as visible track by todo.id');

    expect(parsed.keyIdent).toBeNull();
    expect(parsed.valueIdent).toBe('todo');
    expect(parsed.aliasIdent).toBe('visible');
    expect(parsed.trackByExpr).not.toBeNull();
    if (parsed.trackByExpr !== null) {
      expect(parsed.trackByExpr({ todo: { id: 7 } })).toBe(7);
    }
  });

  it('parses `(key, value) in obj as alias track by key`', () => {
    const parsed = parseIteratorExpression('(k, v) in obj as visible track by k');

    expect(parsed.keyIdent).toBe('k');
    expect(parsed.valueIdent).toBe('v');
    expect(parsed.aliasIdent).toBe('visible');
    expect(parsed.trackByExpr).not.toBeNull();
  });

  it('parses a filter-chain collection combined with alias and track-by', () => {
    const parsed = parseIteratorExpression('todo in todos | filter:q as visible track by todo.id');

    expect(parsed.valueIdent).toBe('todo');
    expect(parsed.aliasIdent).toBe('visible');
    expect(parsed.trackByExpr).not.toBeNull();
    // The collection sub-expression handles the full `parse()` grammar,
    // including filter chains — calling it without filter registration
    // would throw, so we only assert it is a callable function here.
    expect(typeof parsed.collectionExpr).toBe('function');
  });
});

describe('parseIteratorExpression — collection filter chain', () => {
  it('accepts a filter chain in the collection sub-expression', () => {
    const parsed = parseIteratorExpression('todo in todos | filter:q');

    expect(parsed.valueIdent).toBe('todo');
    expect(typeof parsed.collectionExpr).toBe('function');
  });

  it('accepts a chained-filter collection sub-expression', () => {
    // Two filters on the same input — `parse()` supports the full chain.
    const parsed = parseIteratorExpression('todo in todos | filter:q | orderBy:"name"');

    expect(typeof parsed.collectionExpr).toBe('function');
  });
});

describe('parseIteratorExpression — whitespace tolerance', () => {
  it('strips leading and trailing whitespace', () => {
    const parsed = parseIteratorExpression('   todo in todos   ');

    expect(parsed.valueIdent).toBe('todo');
  });

  it('tolerates multiple spaces between tokens', () => {
    const parsed = parseIteratorExpression('todo    in    todos');

    expect(parsed.valueIdent).toBe('todo');
  });

  it('tolerates newlines mixed with spaces', () => {
    const parsed = parseIteratorExpression('  todo\n  in\n  todos  ');

    expect(parsed.valueIdent).toBe('todo');
  });

  it('tolerates whitespace around the `as ALIAS` clause', () => {
    const parsed = parseIteratorExpression('todo in todos   as   visible');

    expect(parsed.aliasIdent).toBe('visible');
  });

  it('tolerates whitespace around the `track by EXPR` clause', () => {
    const parsed = parseIteratorExpression('todo in todos   track   by   todo.id');

    expect(parsed.trackByExpr).not.toBeNull();
  });

  it('tolerates whitespace around tuple parentheses', () => {
    const parsed = parseIteratorExpression('  (  k , v )  in obj  ');

    expect(parsed.keyIdent).toBe('k');
    expect(parsed.valueIdent).toBe('v');
  });
});

describe('parseIteratorExpression — `NgRepeatBadIteratorExpressionError`', () => {
  it('throws when the `in` keyword is missing', () => {
    expect(() => parseIteratorExpression('todos.length')).toThrow(NgRepeatBadIteratorExpressionError);
  });

  it('throws when the input is the empty string', () => {
    expect(() => parseIteratorExpression('')).toThrow(NgRepeatBadIteratorExpressionError);
  });

  it('throws when the input is whitespace only', () => {
    expect(() => parseIteratorExpression('   ')).toThrow(NgRepeatBadIteratorExpressionError);
  });

  it('throws when the item name slot is empty before `in`', () => {
    expect(() => parseIteratorExpression(' in todos')).toThrow(NgRepeatBadIteratorExpressionError);
  });

  it('throws when the collection slot is empty after `in`', () => {
    expect(() => parseIteratorExpression('todo in ')).toThrow(NgRepeatBadIteratorExpressionError);
  });

  it('embeds the offending raw expression in the error message', () => {
    try {
      parseIteratorExpression('no-in-here');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NgRepeatBadIteratorExpressionError);
      if (err instanceof NgRepeatBadIteratorExpressionError) {
        expect(err.message).toContain('"no-in-here"');
        expect(err.name).toBe('NgRepeatBadIteratorExpressionError');
      }
    }
  });
});

describe('parseIteratorExpression — `NgRepeatBadIdentifierError`', () => {
  it('throws when the item name contains punctuation', () => {
    expect(() => parseIteratorExpression('item.x in todos')).toThrow(NgRepeatBadIdentifierError);
  });

  it('throws when the item name contains a hyphen', () => {
    expect(() => parseIteratorExpression('item-name in todos')).toThrow(NgRepeatBadIdentifierError);
  });

  it('throws when the item name has a leading digit', () => {
    expect(() => parseIteratorExpression('1bad in todos')).toThrow(NgRepeatBadIdentifierError);
  });

  it('throws when the key in the tuple has a leading digit', () => {
    expect(() => parseIteratorExpression('(1bad, value) in obj')).toThrow(NgRepeatBadIdentifierError);
  });

  it('throws when the value in the tuple has a leading digit', () => {
    expect(() => parseIteratorExpression('(key, 1bad) in obj')).toThrow(NgRepeatBadIdentifierError);
  });

  it('throws for the three-name parenthesized form `(a, b, c) in obj`', () => {
    // The tuple regex requires exactly two comma-separated names; three
    // names short-circuits to the single-identifier branch with the raw
    // string still containing parens, which fails `IDENT_RE`.
    expect(() => parseIteratorExpression('(a, b, c) in obj')).toThrow(NgRepeatBadIdentifierError);
  });

  it('throws for unparenthesized `key, value in obj`', () => {
    // The outer regex's non-greedy LHS capture treats the comma-joined
    // pair as a single identifier-shaped token, which fails IDENT_RE.
    expect(() => parseIteratorExpression('key, value in obj')).toThrow(NgRepeatBadIdentifierError);
  });

  it('embeds the offending identifier and the raw expression in the message', () => {
    try {
      parseIteratorExpression('item-x in todos');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NgRepeatBadIdentifierError);
      if (err instanceof NgRepeatBadIdentifierError) {
        expect(err.message).toContain('"item-x"');
        expect(err.message).toContain('"item-x in todos"');
        expect(err.name).toBe('NgRepeatBadIdentifierError');
      }
    }
  });
});

describe('parseIteratorExpression — `NgRepeatBadAliasError`', () => {
  it('throws when the alias collides with the single-identifier item name', () => {
    expect(() => parseIteratorExpression('item in list as item')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias collides with the tuple key', () => {
    expect(() => parseIteratorExpression('(k, v) in obj as k')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias collides with the tuple value', () => {
    expect(() => parseIteratorExpression('(k, v) in obj as v')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias collides with $index', () => {
    expect(() => parseIteratorExpression('item in list as $index')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias collides with $first', () => {
    expect(() => parseIteratorExpression('item in list as $first')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias collides with $last', () => {
    expect(() => parseIteratorExpression('item in list as $last')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias collides with $middle', () => {
    expect(() => parseIteratorExpression('item in list as $middle')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias collides with $even', () => {
    expect(() => parseIteratorExpression('item in list as $even')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias collides with $odd', () => {
    expect(() => parseIteratorExpression('item in list as $odd')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias name itself fails `IDENT_RE` (leading digit)', () => {
    expect(() => parseIteratorExpression('item in list as 1bad')).toThrow(NgRepeatBadAliasError);
  });

  it('throws when the alias name itself fails `IDENT_RE` (contains punctuation)', () => {
    expect(() => parseIteratorExpression('item in list as bad-name')).toThrow(NgRepeatBadAliasError);
  });

  it('embeds the offending alias and the raw expression in the message', () => {
    try {
      parseIteratorExpression('item in list as item');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NgRepeatBadAliasError);
      if (err instanceof NgRepeatBadAliasError) {
        expect(err.message).toContain('"item"');
        expect(err.message).toContain('"item in list as item"');
        expect(err.name).toBe('NgRepeatBadAliasError');
      }
    }
  });
});

describe('parseIteratorExpression — returned record shape', () => {
  it('returns null sentinels for omitted optional clauses', () => {
    const parsed = parseIteratorExpression('x in xs');

    expect(parsed.keyIdent).toBeNull();
    expect(parsed.aliasIdent).toBeNull();
    expect(parsed.trackByExpr).toBeNull();
  });

  it('returns callable `ExpressionFn` instances for `collectionExpr`', () => {
    const parsed = parseIteratorExpression('x in xs');

    expect(typeof parsed.collectionExpr).toBe('function');
    // ExpressionFn carries `oneTime` / `constant` / `literal` brand flags.
    expect(typeof parsed.collectionExpr.constant).toBe('boolean');
    expect(typeof parsed.collectionExpr.literal).toBe('boolean');
  });

  it('returns a callable `trackByExpr` when the clause is present', () => {
    const parsed = parseIteratorExpression('x in xs track by x.id');

    expect(parsed.trackByExpr).not.toBeNull();
    if (parsed.trackByExpr !== null) {
      expect(typeof parsed.trackByExpr).toBe('function');
      expect(typeof parsed.trackByExpr.constant).toBe('boolean');
    }
  });

  it('`collectionExpr` evaluates against a fresh scope on each call (no captured state)', () => {
    const parsed = parseIteratorExpression('item in items');

    expect(parsed.collectionExpr({ items: ['a'] })).toEqual(['a']);
    expect(parsed.collectionExpr({ items: ['b', 'c'] })).toEqual(['b', 'c']);
  });
});
