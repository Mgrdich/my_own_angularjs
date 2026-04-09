import { describe, it, expect } from 'vitest';
import { isEqual } from '../is-equal';

describe('isEqual', () => {
  describe('primitives', () => {
    it('returns true for equal numbers', () => {
      expect(isEqual(42, 42)).toBe(true);
    });

    it('returns false for unequal numbers', () => {
      expect(isEqual(42, 43)).toBe(false);
    });

    it('returns true for equal strings', () => {
      expect(isEqual('hello', 'hello')).toBe(true);
    });

    it('returns false for unequal strings', () => {
      expect(isEqual('hello', 'world')).toBe(false);
    });

    it('returns true for equal booleans', () => {
      expect(isEqual(true, true)).toBe(true);
      expect(isEqual(false, false)).toBe(true);
    });

    it('returns false for unequal booleans', () => {
      expect(isEqual(true, false)).toBe(false);
    });

    it('returns true for null === null', () => {
      expect(isEqual(null, null)).toBe(true);
    });

    it('returns true for undefined === undefined', () => {
      expect(isEqual(undefined, undefined)).toBe(true);
    });

    it('returns false for null !== undefined', () => {
      expect(isEqual(null, undefined)).toBe(false);
    });
  });

  describe('NaN', () => {
    it('returns true when comparing NaN to NaN', () => {
      expect(isEqual(NaN, NaN)).toBe(true);
    });
  });

  describe('arrays', () => {
    it('returns true for equal arrays', () => {
      expect(isEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it('returns false for arrays with different lengths', () => {
      expect(isEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it('returns false for arrays with different elements', () => {
      expect(isEqual([1, 2, 3], [1, 2, 4])).toBe(false);
    });

    it('returns true for nested equal arrays', () => {
      expect(isEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true);
    });

    it('returns false for nested unequal arrays', () => {
      expect(isEqual([[1, 2], [3]], [[1, 2], [4]])).toBe(false);
    });

    it('returns true for empty arrays', () => {
      expect(isEqual([], [])).toBe(true);
    });
  });

  describe('objects', () => {
    it('returns true for equal objects', () => {
      expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    it('returns false for objects with different values', () => {
      expect(isEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    });

    it('returns false for objects with different key counts', () => {
      expect(isEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it('returns true for nested equal objects', () => {
      expect(isEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    });

    it('returns false for nested unequal objects', () => {
      expect(isEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    });

    it('returns true for empty objects', () => {
      expect(isEqual({}, {})).toBe(true);
    });
  });

  describe('Date', () => {
    it('returns true for dates with the same time', () => {
      const time = Date.now();
      expect(isEqual(new Date(time), new Date(time))).toBe(true);
    });

    it('returns false for dates with different times', () => {
      expect(isEqual(new Date(1000), new Date(2000))).toBe(false);
    });
  });

  describe('RegExp', () => {
    it('returns true for regexps with the same pattern and flags', () => {
      expect(isEqual(/abc/gi, /abc/gi)).toBe(true);
    });

    it('returns false for regexps with different patterns', () => {
      expect(isEqual(/abc/, /def/)).toBe(false);
    });

    it('returns false for regexps with different flags', () => {
      expect(isEqual(/abc/g, /abc/i)).toBe(false);
    });
  });

  describe('mixed types', () => {
    it('returns false for number vs string', () => {
      expect(isEqual(42, '42')).toBe(false);
    });

    it('returns false for array vs object', () => {
      expect(isEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    });

    it('returns false for null vs 0', () => {
      expect(isEqual(null, 0)).toBe(false);
    });

    it('returns false for undefined vs false', () => {
      expect(isEqual(undefined, false)).toBe(false);
    });
  });

  describe('empty structures', () => {
    it('returns false for [] vs {}', () => {
      expect(isEqual([], {})).toBe(false);
    });

    it('returns false for {} vs []', () => {
      expect(isEqual({}, [])).toBe(false);
    });
  });
});
