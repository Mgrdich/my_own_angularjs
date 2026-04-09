import { describe, it, expect } from 'vitest';
import { parse } from '@parser/parse';

describe('parse', () => {
  describe('numbers', () => {
    it('parses integers', () => {
      const fn = parse('42');
      expect(fn()).toBe(42);
    });

    it('parses floating-point numbers', () => {
      const fn = parse('4.2');
      expect(fn()).toBe(4.2);
    });

    it('parses a leading-dot float', () => {
      const fn = parse('.42');
      expect(fn()).toBe(0.42);
    });

    it('parses scientific notation', () => {
      const fn = parse('42e3');
      expect(fn()).toBe(42000);
    });

    it('parses a negative exponent', () => {
      const fn = parse('4200e-2');
      expect(fn()).toBe(42);
    });

    it('parses a float with exponent', () => {
      const fn = parse('.42e2');
      expect(fn()).toBe(42);
    });

    it('throws for invalid scientific notation', () => {
      expect(() => parse('42e-')).toThrow();
    });

    it('parses an invalid float as NaN', () => {
      const fn = parse('42.3.4');
      expect(fn()).toBeNaN();
    });
  });

  describe('strings', () => {
    it('parses single-quoted strings', () => {
      const fn = parse("'abc'");
      expect(fn()).toBe('abc');
    });

    it('parses double-quoted strings', () => {
      const fn = parse('"abc"');
      expect(fn()).toBe('abc');
    });

    it('parses escape sequences', () => {
      const fn = parse("'a\\nb'");
      expect(fn()).toBe('a\nb');
    });

    it('parses unicode escapes', () => {
      const fn = parse("'\\u00A0'");
      expect(fn()).toBe('\u00A0');
    });

    it('throws for unterminated strings', () => {
      expect(() => parse("'abc")).toThrow();
    });
  });

  describe('literals', () => {
    it('parses true', () => {
      const fn = parse('true');
      expect(fn()).toBe(true);
    });

    it('parses false', () => {
      const fn = parse('false');
      expect(fn()).toBe(false);
    });

    it('parses null', () => {
      const fn = parse('null');
      expect(fn()).toBe(null);
    });
  });

  describe('whitespace', () => {
    it('ignores whitespace', () => {
      const fn = parse(' \n42 ');
      expect(fn()).toBe(42);
    });
  });

  describe('identifiers', () => {
    it('looks up an identifier from the scope', () => {
      expect(parse('aKey')({ aKey: 42 })).toBe(42);
    });

    it('returns undefined for a missing identifier', () => {
      expect(parse('aKey')({})).toBeUndefined();
    });

    it('supports the this keyword', () => {
      const scope = { a: 1 };
      expect(parse('this')(scope)).toBe(scope);
    });
  });
});
