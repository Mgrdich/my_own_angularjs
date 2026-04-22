import { describe, it, expect } from 'vitest';
import { createInterpolate, interpolate } from '@interpolate/index';

describe('createInterpolate — ES module API (Slice 1)', () => {
  describe('basic rendering', () => {
    it('renders plain text with no expressions', () => {
      const fn = createInterpolate()('Hello');
      expect(fn).toBeTypeOf('function');
      expect(fn({})).toBe('Hello');
    });

    it('renders a single expression against a context', () => {
      const fn = createInterpolate()('Hello {{name}}');
      expect(fn({ name: 'Alice' })).toBe('Hello Alice');
    });

    it('renders multiple expressions via the convenience interpolate export', () => {
      const fn = interpolate('{{a}} and {{b}}');
      expect(fn({ a: 1, b: 2 })).toBe('1 and 2');
    });

    it('concatenates adjacent expressions without separator', () => {
      const fn = createInterpolate()('{{a}}{{b}}');
      expect(fn({ a: 'foo', b: 'bar' })).toBe('foobar');
    });
  });

  describe('stringification rules', () => {
    it('renders undefined values as empty string', () => {
      const fn = createInterpolate()('x={{x}}');
      expect(fn({})).toBe('x=');
    });

    it('renders null values as empty string', () => {
      const fn = createInterpolate()('x={{x}}');
      expect(fn({ x: null })).toBe('x=');
    });

    it('renders numbers via default String conversion', () => {
      const fn = createInterpolate()('{{n}}');
      expect(fn({ n: 42 })).toBe('42');
      expect(fn({ n: 1.5 })).toBe('1.5');
    });

    it('renders NaN as the string "NaN"', () => {
      const fn = createInterpolate()('{{n}}');
      expect(fn({ n: Number.NaN })).toBe('NaN');
    });

    it('renders booleans as "true" / "false"', () => {
      const fn = createInterpolate()('{{b}}');
      expect(fn({ b: true })).toBe('true');
      expect(fn({ b: false })).toBe('false');
    });

    it('renders strings verbatim (no quoting)', () => {
      const fn = createInterpolate()('{{s}}');
      expect(fn({ s: 'hello' })).toBe('hello');
    });

    it('renders arrays via JSON.stringify', () => {
      const fn = createInterpolate()('{{arr}}');
      expect(fn({ arr: [1, 2] })).toBe('[1,2]');
    });

    it('renders plain objects via JSON.stringify', () => {
      const fn = createInterpolate()('{{obj}}');
      expect(fn({ obj: { a: 1 } })).toBe('{"a":1}');
    });
  });

  describe('statelessness', () => {
    it('produces independent functions across compile calls', () => {
      const service = createInterpolate();
      const fn1 = service('Hello {{name}}');
      const fn2 = service('Hi {{name}}');
      expect(fn1({ name: 'A' })).toBe('Hello A');
      expect(fn2({ name: 'A' })).toBe('Hi A');
    });

    it('can be called repeatedly with different contexts', () => {
      const fn = createInterpolate()('Hello {{name}}');
      expect(fn({ name: 'Alice' })).toBe('Hello Alice');
      expect(fn({ name: 'Bob' })).toBe('Hello Bob');
      expect(fn({})).toBe('Hello ');
    });
  });

  describe('metadata', () => {
    it('exposes .exp with the verbatim input text', () => {
      const fn = createInterpolate()('Hello {{name}}');
      expect(fn.exp).toBe('Hello {{name}}');
    });

    it('exposes .expressions as raw sources in left-to-right order', () => {
      const fn = createInterpolate()('{{a}} and {{b}}');
      expect(fn.expressions).toEqual(['a', 'b']);
    });

    it('exposes an empty .expressions array for plain text', () => {
      const fn = createInterpolate()('plain text');
      expect(fn.expressions).toEqual([]);
    });

    it('exposes .oneTime === true when every embedded expression is `::`-prefixed', () => {
      const fn = createInterpolate()('Hello {{::name}}');
      expect(fn.oneTime).toBe(true);
    });

    it('exposes .oneTime === false for non-one-time templates', () => {
      const fn = createInterpolate()('Hello {{name}}');
      expect(fn.oneTime).toBe(false);
    });
  });

  describe('service getters', () => {
    it('returns the active delimiters via startSymbol() / endSymbol()', () => {
      const service = createInterpolate();
      expect(service.startSymbol()).toBe('{{');
      expect(service.endSymbol()).toBe('}}');
    });
  });

  describe('custom delimiters', () => {
    it('renders templates with custom [[ / ]] delimiters end-to-end', () => {
      const service = createInterpolate({ startSymbol: '[[', endSymbol: ']]' });
      const fn = service('Hi [[name]]');
      expect(fn({ name: 'Bob' })).toBe('Hi Bob');
    });

    it('exposes the custom delimiters via getters', () => {
      const service = createInterpolate({ startSymbol: '[[', endSymbol: ']]' });
      expect(service.startSymbol()).toBe('[[');
      expect(service.endSymbol()).toBe(']]');
    });
  });

  describe('delimiter validation', () => {
    it('throws synchronously when startSymbol is an empty string', () => {
      expect(() => createInterpolate({ startSymbol: '', endSymbol: '}}' })).toThrow(
        /startSymbol cannot be an empty string/,
      );
    });

    it('throws synchronously when endSymbol is an empty string', () => {
      expect(() => createInterpolate({ startSymbol: '{{', endSymbol: '' })).toThrow(
        /endSymbol cannot be an empty string/,
      );
    });

    it('throws when startSymbol and endSymbol are identical defaults-style values', () => {
      expect(() => createInterpolate({ startSymbol: '{{', endSymbol: '{{' })).toThrow(
        /startSymbol and endSymbol must differ.*\{\{/,
      );
    });

    it('throws when startSymbol and endSymbol are identical custom values', () => {
      expect(() => createInterpolate({ startSymbol: '##', endSymbol: '##' })).toThrow(
        /startSymbol and endSymbol must differ.*##/,
      );
    });
  });

  describe('escape sequences', () => {
    it('renders literal {{ }} for fully-escaped delimiters in plain text', () => {
      const fn = createInterpolate()('\\{\\{literal\\}\\}');
      expect(fn({})).toBe('{{literal}}');
    });

    it('renders mixed escape + real expression correctly', () => {
      const fn = createInterpolate()('{{a}} and \\{\\{literal\\}\\}');
      expect(fn({ a: 1 })).toBe('1 and {{literal}}');
    });
  });
});
