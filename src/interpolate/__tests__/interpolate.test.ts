import { describe, it, expect } from 'vitest';

import { createInterpolate, type InterpolateFn } from '@interpolate/index';

describe('createInterpolate — service semantics (Slice 3)', () => {
  describe('mustHaveExpression flag', () => {
    it('returns undefined for plain text when mustHaveExpression is true', () => {
      const service = createInterpolate();
      expect(service('plain text', true)).toBeUndefined();
    });

    it('returns a callable fn for text with markers when mustHaveExpression is true', () => {
      const service = createInterpolate();
      const fn = service('Hello {{name}}', true);
      expect(fn).toBeTypeOf('function');
      // The `mustHaveExpression: true` overload returns `InterpolateFn | undefined`,
      // so the optional-chain is load-bearing for type narrowing here.
      expect(fn?.({ name: 'Alice' })).toBe('Hello Alice');
    });

    it('returns undefined for whitespace-only text when mustHaveExpression is true', () => {
      const service = createInterpolate();
      expect(service('   ', true)).toBeUndefined();
    });

    it('returns a callable fn yielding the literal when mustHaveExpression is explicitly false', () => {
      const service = createInterpolate();
      const fn = service('plain text', false);
      expect(fn).toBeTypeOf('function');
      expect(fn({})).toBe('plain text');
    });

    it('treats omitted mustHaveExpression as false', () => {
      const service = createInterpolate();
      const fn = service('plain text');
      expect(fn).toBeTypeOf('function');
      expect(fn({})).toBe('plain text');
    });
  });

  describe('allOrNothing flag', () => {
    it('returns undefined when a single expression evaluates to undefined', () => {
      const service = createInterpolate();
      const fn = service('hello {{name}}', false, undefined, true);
      expect(fn({})).toBeUndefined();
    });

    it('returns the rendered string when every expression is defined', () => {
      const service = createInterpolate();
      const fn = service('hello {{name}}', false, undefined, true);
      expect(fn({ name: 'World' })).toBe('hello World');
    });

    it('does not trigger on null values — null renders as empty string', () => {
      const service = createInterpolate();
      const fn = service('hello {{name}}', false, undefined, true);
      expect(fn({ name: null })).toBe('hello ');
    });

    it('is a no-op on templates with no expressions — the literal text still renders', () => {
      const service = createInterpolate();
      const fn = service('plain text', false, undefined, true);
      expect(fn({})).toBe('plain text');
    });

    it('returns undefined when any of multiple expressions is undefined', () => {
      const service = createInterpolate();
      const fn = service('a {{x}} b {{y}}', false, undefined, true);
      expect(fn({ x: 1 })).toBeUndefined();
      expect(fn({ y: 2 })).toBeUndefined();
      expect(fn({ x: 1, y: 2 })).toBe('a 1 b 2');
    });

    it('evaluates allOrNothing per call — same compiled fn can yield undefined or a string', () => {
      const service = createInterpolate();
      const fn = service('hello {{name}}', false, undefined, true);
      expect(fn({})).toBeUndefined();
      expect(fn({ name: 'Alice' })).toBe('hello Alice');
      expect(fn({})).toBeUndefined();
    });
  });

  describe('TypeScript overload narrowing', () => {
    it('narrows return to InterpolateFn when mustHaveExpression is omitted', () => {
      const service = createInterpolate();
      // Compile-time proof: the overload without `mustHaveExpression: true` is
      // typed as returning `InterpolateFn`, not `InterpolateFn | undefined`.
      // Assigning to an `InterpolateFn`-typed variable would fail TS if the
      // overload narrowing were wrong, and accessing `.exp` without a `?.`
      // guard would then be flagged by @typescript-eslint/no-unnecessary-condition.
      const fn: InterpolateFn = service('Hello {{name}}');
      expect(fn.exp).toBe('Hello {{name}}');
      expect(fn.expressions).toEqual(['name']);
      expect(fn({ name: 'Alice' })).toBe('Hello Alice');
    });

    it('narrows return to InterpolateFn when mustHaveExpression is explicitly false', () => {
      const service = createInterpolate();
      const fn: InterpolateFn = service('plain text', false);
      expect(fn({})).toBe('plain text');
    });
  });
});

describe('createInterpolate — metadata properties (Slice 4)', () => {
  describe('.exp — verbatim template source', () => {
    it('is the input string for plain text', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello').exp).toBe('Hello');
    });

    it('is the input string verbatim when expressions are present', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello {{name}}').exp).toBe('Hello {{name}}');
    });
  });

  describe('.expressions — raw source strings in left-to-right order', () => {
    it('is empty for plain text', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello').expressions).toEqual([]);
    });

    it('contains the single expression source for one marker', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello {{name}}').expressions).toEqual(['name']);
    });

    it('retains the `::` prefix on one-time expressions', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello {{::name}}').expressions).toEqual(['::name']);
    });

    it('preserves order for multiple expressions', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello {{name}} {{age}}').expressions).toEqual(['name', 'age']);
    });
  });

  describe('.oneTime — true only when every embedded expression is `::`', () => {
    it('is false for plain text (no expressions)', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello').oneTime).toBe(false);
    });

    it('is false for a non-one-time expression', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello {{name}}').oneTime).toBe(false);
    });

    it('is true for a single `::` expression', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('Hello {{::name}}').oneTime).toBe(true);
    });

    it('is true when every expression is `::`', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('{{::a}} and {{::b}}').oneTime).toBe(true);
    });

    it('is false for mixed one-time and non-one-time (::-first)', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('{{::a}} and {{b}}').oneTime).toBe(false);
    });

    it('is false for mixed one-time and non-one-time (non-::-first)', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('{{a}} and {{::b}}').oneTime).toBe(false);
    });
  });
});

describe('createInterpolate — one-time render hold-back (Slice 4)', () => {
  it('returns undefined while a `::` expression is still undefined', () => {
    const fn = createInterpolate()('Hello {{::name}}');
    expect(fn({})).toBeUndefined();
  });

  it('renders the stabilized string once the `::` expression resolves', () => {
    const fn = createInterpolate()('Hello {{::name}}');
    expect(fn({ name: 'Alice' })).toBe('Hello Alice');
  });

  it('treats an explicit undefined value as "not yet stabilized"', () => {
    const fn = createInterpolate()('Hello {{::name}}');
    expect(fn({ name: undefined })).toBeUndefined();
  });

  it('does not hold back on null — null stringifies to empty', () => {
    const fn = createInterpolate()('Hello {{::name}}');
    expect(fn({ name: null })).toBe('Hello ');
  });

  it('holds back until ALL `::` expressions are defined (multi-expression)', () => {
    const fn = createInterpolate()('{{::a}} {{::b}}');
    expect(fn({ a: 1 })).toBeUndefined();
    expect(fn({ a: 1, b: 2 })).toBe('1 2');
  });

  it('non-oneTime template renders undefined as empty string (baseline)', () => {
    const fn = createInterpolate()('Hello {{name}}');
    expect(fn({})).toBe('Hello ');
  });

  it('allOrNothing also short-circuits to undefined on one-time templates', () => {
    // Either oneTime or allOrNothing is enough to trigger the undefined return;
    // both paths are orthogonal and both exit the render with `undefined`.
    const fn = createInterpolate()('Hello {{::name}}', false, undefined, true);
    expect(fn({})).toBeUndefined();
  });
});

describe('createInterpolate — parse error propagation (Slice 4)', () => {
  it('throws synchronously from parse() at compile time, not at render', () => {
    const $interpolate = createInterpolate();
    expect(() => $interpolate('Hello {{a +}}')).toThrow();
  });
});

describe('createInterpolate — parity cross-reference (Slice 7, interpolateSpec.js)', () => {
  describe('empty / zero-length inputs', () => {
    it('returns undefined for the empty string when mustHaveExpression is true', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('', true)).toBeUndefined();
    });

    it('returns a fn yielding "" for the empty string under default flags', () => {
      const $interpolate = createInterpolate();
      const fn = $interpolate('');
      expect(fn).toBeTypeOf('function');
      expect(fn({})).toBe('');
    });

    it('.exp is the verbatim empty-string input', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('').exp).toBe('');
    });

    it('.expressions is an empty array for empty input', () => {
      const $interpolate = createInterpolate();
      expect($interpolate('').expressions).toEqual([]);
    });
  });

  describe('whitespace-tolerant expression bodies', () => {
    // AngularJS parity: the parser is whitespace-tolerant, so `{{ name }}`
    // must evaluate `name` identically to `{{name}}`.
    it('resolves an expression with leading/trailing whitespace inside the delimiters', () => {
      const $interpolate = createInterpolate();
      const fn = $interpolate('Hello {{ name }}');
      expect(fn({ name: 'Alice' })).toBe('Hello Alice');
    });

    it('retains the raw whitespace verbatim in .expressions (scanner passes source through)', () => {
      // The scanner captures the raw source between delimiters without trimming —
      // this preserves AngularJS parity where `.expressions[i]` is the raw text.
      const $interpolate = createInterpolate();
      expect($interpolate('Hello {{ name }}').expressions).toEqual([' name ']);
    });
  });

  describe('allOrNothing + oneTime interactions (combined-flag coverage)', () => {
    it('renders "" for {{::a}} with allOrNothing=true and {a: null} (null does not trigger either hold-back)', () => {
      const fn = createInterpolate()('{{::a}}', false, undefined, true);
      expect(fn({ a: null })).toBe('');
    });

    it('renders the stringified value for {{::a}} with allOrNothing=true and a defined context', () => {
      const fn = createInterpolate()('{{::a}}', false, undefined, true);
      expect(fn({ a: 'x' })).toBe('x');
    });

    it('returns undefined for mixed {{::a}} {{b}} with allOrNothing=true when b is still undefined', () => {
      // allOrNothing triggers regardless of the template's .oneTime flag —
      // a mixed template (oneTime === false) still short-circuits on any
      // undefined embedded expression when allOrNothing is requested.
      const fn = createInterpolate()('{{::a}} {{b}}', false, undefined, true);
      expect(fn.oneTime).toBe(false);
      expect(fn({ a: 1 })).toBeUndefined();
    });
  });

  describe('toJson parity for objects and arrays', () => {
    it('stringifies nested objects', () => {
      const fn = createInterpolate()('{{v}}');
      expect(fn({ v: { a: { b: 1 } } })).toBe('{"a":{"b":1}}');
    });

    it('stringifies an array of objects', () => {
      const fn = createInterpolate()('{{v}}');
      expect(fn({ v: [{ a: 1 }, { b: 2 }] })).toBe('[{"a":1},{"b":2}]');
    });

    it('stringifies an object with a null-valued property as JSON (null stays in place here)', () => {
      // Note: the top-level null short-circuit to "" only fires when the entire
      // expression value is null. A null FIELD inside a non-null object is
      // serialized by JSON.stringify verbatim.
      const fn = createInterpolate()('{{v}}');
      expect(fn({ v: { a: null } })).toBe('{"a":null}');
    });

    it('stringifies the empty object as {}', () => {
      const fn = createInterpolate()('{{v}}');
      expect(fn({ v: {} })).toBe('{}');
    });

    it('stringifies the empty array as []', () => {
      const fn = createInterpolate()('{{v}}');
      expect(fn({ v: [] })).toBe('[]');
    });

    it('omits object properties whose value is undefined (JSON.stringify parity)', () => {
      // JSON.stringify drops `undefined` properties; matches AngularJS toJson.
      const fn = createInterpolate()('{{v}}');
      expect(fn({ v: { a: undefined } })).toBe('{}');
    });

    it('throws when the value contains a circular reference (JSON.stringify parity)', () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;
      const fn = createInterpolate()('{{v}}');
      expect(() => fn({ v: circular })).toThrow();
    });
  });

  describe('consecutive and mixed escape sequences', () => {
    it('renders two adjacent escaped delimiter pairs as literal text', () => {
      // `\{\{a\}\}\{\{b\}\}` → `{{a}}{{b}}` (no real expressions present)
      const fn = createInterpolate()('\\{\\{a\\}\\}\\{\\{b\\}\\}');
      expect(fn.expressions).toEqual([]);
      expect(fn({})).toBe('{{a}}{{b}}');
    });

    it('renders mixed escape-expression-escape correctly', () => {
      // `\{\{x\}\} {{y}} \{\{z\}\}` → `{{x}} <y> {{z}}`
      const fn = createInterpolate()('\\{\\{x\\}\\} {{y}} \\{\\{z\\}\\}');
      expect(fn.expressions).toEqual(['y']);
      expect(fn({ y: 'YY' })).toBe('{{x}} YY {{z}}');
    });
  });
});
