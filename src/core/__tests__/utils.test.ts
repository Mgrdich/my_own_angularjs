import { describe, it, expect } from 'vitest';
import {
  isEqual,
  isKeyOf,
  isString,
  isNumber,
  isBoolean,
  isFunction,
  isNull,
  isUndefined,
  isDefined,
  isArray,
  isObject,
  isDate,
  isRegExp,
  isNaN,
  isWindow,
  isBlankObject,
  isTypedArray,
  isArrayBuffer,
  isArrayLike,
  forEach,
  copy,
  noop,
  createMap,
  range,
} from '@core/utils';

describe('isKeyOf', () => {
  const obj = { a: 1, b: 2 } as const satisfies Record<string, number>;

  it('returns true for a key that exists', () => {
    expect(isKeyOf(obj, 'a')).toBe(true);
  });

  it('returns false for a key that does not exist', () => {
    expect(isKeyOf(obj, 'c')).toBe(false);
  });

  it('narrows the key type in a conditional', () => {
    const key = 'b' as string;
    if (isKeyOf(obj, key)) {
      // If this compiles, the type guard works — key is narrowed to 'a' | 'b'
      expect(obj[key]).toBe(2);
    }
  });
});

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

  describe('$-prefixed key skipping', () => {
    it('treats objects differing only in $-prefixed keys as equal', () => {
      expect(isEqual({ a: 1, $hashKey: 'abc' }, { a: 1, $hashKey: 'xyz' })).toBe(true);
    });

    it('treats objects differing only in $$-prefixed keys as equal', () => {
      expect(isEqual({ a: 1, $$phase: 'digest' }, { a: 1 })).toBe(true);
    });

    it('treats objects as equal when one has a $-key the other does not, if non-$ keys match', () => {
      expect(isEqual({ a: 1, $id: 1 }, { a: 1 })).toBe(true);
    });

    it('treats objects as not equal when non-$ keys differ', () => {
      expect(isEqual({ a: 1, $id: 1 }, { a: 2, $id: 1 })).toBe(false);
    });
  });

  describe('function-valued property skipping', () => {
    it('treats objects differing only in function-valued properties as equal', () => {
      expect(isEqual({ a: 1, fn: () => 1 }, { a: 1, fn: () => 2 })).toBe(true);
    });

    it('treats objects as equal when one has a function property the other does not', () => {
      expect(isEqual({ a: 1, onClick: () => {} }, { a: 1 })).toBe(true);
    });

    it('treats objects as not equal when non-function properties differ', () => {
      expect(isEqual({ a: 1, fn: () => 1 }, { a: 2, fn: () => 1 })).toBe(false);
    });

    it('treats objects with both $-keys and function values differing only in those as equal', () => {
      expect(isEqual({ a: 1, $key: 'x', fn: () => {} }, { a: 1, $key: 'y', fn: () => 'other' })).toBe(true);
    });
  });

  describe('undefined member variables', () => {
    it('treats an explicit undefined property as equivalent to a missing property', () => {
      expect(isEqual({ name: 'misko' }, { name: 'misko', undefinedVar: undefined })).toBe(true);
    });

    it('treats both sides having undefined properties as equal', () => {
      expect(isEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(true);
    });
  });

  describe('Object.prototype key collisions', () => {
    it('returns false when one object shadows hasOwnProperty and the other does not', () => {
      expect(isEqual({}, { hasOwnProperty: 1 })).toBe(false);
    });

    it('returns false when one object shadows toString with null', () => {
      expect(isEqual({}, { toString: null })).toBe(false);
    });
  });

  describe('objects shadowing hasOwnProperty', () => {
    it('compares correctly when both objects have hasOwnProperty as own property', () => {
      expect(isEqual({ hasOwnProperty: true, a: 1 }, { hasOwnProperty: true, a: 1 })).toBe(true);
    });

    it('returns false when hasOwnProperty values differ', () => {
      expect(isEqual({ hasOwnProperty: true, a: 1 }, { hasOwnProperty: false, a: 1 })).toBe(false);
    });
  });

  describe('Date edge cases', () => {
    it('treats two invalid dates (new Date(undefined)) as equal', () => {
      const invalidDate1 = new Date('invalid');
      const invalidDate2 = new Date('also-invalid');
      expect(isEqual(invalidDate1, invalidDate2)).toBe(true);
    });

    it('returns false for invalid date vs Date(0)', () => {
      const invalidDate = new Date('invalid');
      expect(isEqual(invalidDate, new Date(0))).toBe(false);
    });

    it('returns false for invalid date vs Date(null)', () => {
      const invalidDate = new Date('invalid');
      const nullDate = new Date(0); // Date(null) coerces to 0
      expect(isEqual(invalidDate, nullDate)).toBe(false);
    });

    it('treats two NaN-timestamp dates as equal (e.g. new Date("wrong"))', () => {
      const invalidDate = new Date('invalid');
      const wrongDate = new Date('wrong');
      expect(isEqual(invalidDate, wrongDate)).toBe(true);
    });
  });

  describe('cross-type comparisons', () => {
    it('returns false for Date vs number', () => {
      expect(isEqual(new Date(0), 0)).toBe(false);
      expect(isEqual(0, new Date(0))).toBe(false);
    });

    it('returns false for Date vs RegExp', () => {
      expect(isEqual(new Date(), /abc/)).toBe(false);
    });

    it('returns false for RegExp vs string', () => {
      expect(isEqual(/^abc/, '/^abc/')).toBe(false);
    });

    it('returns false for Object vs RegExp', () => {
      expect(isEqual({}, /abc/)).toBe(false);
    });

    it('returns false for Object vs Date', () => {
      expect(isEqual({}, new Date())).toBe(false);
    });
  });

  describe('objects with no prototype', () => {
    it('treats Object.create(null) objects with matching properties as equal', () => {
      const a = Object.create(null) as Record<string, unknown>;
      a['x'] = 1;
      a['y'] = 2;
      const b = Object.create(null) as Record<string, unknown>;
      b['x'] = 1;
      b['y'] = 2;
      expect(isEqual(a, b)).toBe(true);
    });

    it('returns false for Object.create(null) objects with different properties', () => {
      const a = Object.create(null) as Record<string, unknown>;
      a['x'] = 1;
      const b = Object.create(null) as Record<string, unknown>;
      b['x'] = 2;
      expect(isEqual(a, b)).toBe(false);
    });
  });

  describe('null vs various types', () => {
    it('returns false for null vs string', () => {
      expect(isEqual(null, '123')).toBe(false);
      expect(isEqual('123', null)).toBe(false);
    });

    it('returns false for null vs object', () => {
      expect(isEqual(null, { foo: 'bar' })).toBe(false);
      expect(isEqual({ foo: 'bar' }, null)).toBe(false);
    });
  });

  describe('undefined vs various types', () => {
    it('returns false for undefined vs string', () => {
      expect(isEqual(undefined, '123')).toBe(false);
      expect(isEqual('123', undefined)).toBe(false);
    });

    it('returns false for undefined vs object', () => {
      expect(isEqual(undefined, { foo: 'bar' })).toBe(false);
      expect(isEqual({ foo: 'bar' }, undefined)).toBe(false);
    });
  });
});

// Shared test values used across all type guard suites
const ALL_VALUES = {
  string: 'hello',
  number: 42,
  zero: 0,
  nan: NaN,
  infinity: Infinity,
  true: true,
  false: false,
  null: null,
  undefined: undefined,
  object: {},
  array: [] as unknown[],
  function: () => {},
  symbol: Symbol('test'),
  date: new Date(),
  regexp: new RegExp('test'),
} as const;

describe('isString', () => {
  it('returns true for a string value', () => {
    expect(isString(ALL_VALUES.string)).toBe(true);
  });

  it('returns false for all non-string values', () => {
    expect(isString(ALL_VALUES.number)).toBe(false);
    expect(isString(ALL_VALUES.zero)).toBe(false);
    expect(isString(ALL_VALUES.nan)).toBe(false);
    expect(isString(ALL_VALUES.infinity)).toBe(false);
    expect(isString(ALL_VALUES.true)).toBe(false);
    expect(isString(ALL_VALUES.false)).toBe(false);
    expect(isString(ALL_VALUES.null)).toBe(false);
    expect(isString(ALL_VALUES.undefined)).toBe(false);
    expect(isString(ALL_VALUES.object)).toBe(false);
    expect(isString(ALL_VALUES.array)).toBe(false);
    expect(isString(ALL_VALUES.function)).toBe(false);
    expect(isString(ALL_VALUES.symbol)).toBe(false);
    expect(isString(ALL_VALUES.date)).toBe(false);
    expect(isString(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isNumber', () => {
  it('returns true for a regular number', () => {
    expect(isNumber(ALL_VALUES.number)).toBe(true);
  });

  it('returns true for zero', () => {
    expect(isNumber(ALL_VALUES.zero)).toBe(true);
  });

  it('returns true for NaN (typeof NaN is number)', () => {
    expect(isNumber(ALL_VALUES.nan)).toBe(true);
  });

  it('returns true for Infinity', () => {
    expect(isNumber(ALL_VALUES.infinity)).toBe(true);
  });

  it('returns false for all non-number values', () => {
    expect(isNumber(ALL_VALUES.string)).toBe(false);
    expect(isNumber(ALL_VALUES.true)).toBe(false);
    expect(isNumber(ALL_VALUES.false)).toBe(false);
    expect(isNumber(ALL_VALUES.null)).toBe(false);
    expect(isNumber(ALL_VALUES.undefined)).toBe(false);
    expect(isNumber(ALL_VALUES.object)).toBe(false);
    expect(isNumber(ALL_VALUES.array)).toBe(false);
    expect(isNumber(ALL_VALUES.function)).toBe(false);
    expect(isNumber(ALL_VALUES.symbol)).toBe(false);
    expect(isNumber(ALL_VALUES.date)).toBe(false);
    expect(isNumber(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isBoolean', () => {
  it('returns true for true', () => {
    expect(isBoolean(ALL_VALUES.true)).toBe(true);
  });

  it('returns true for false', () => {
    expect(isBoolean(ALL_VALUES.false)).toBe(true);
  });

  it('returns false for all non-boolean values', () => {
    expect(isBoolean(ALL_VALUES.string)).toBe(false);
    expect(isBoolean(ALL_VALUES.number)).toBe(false);
    expect(isBoolean(ALL_VALUES.zero)).toBe(false);
    expect(isBoolean(ALL_VALUES.nan)).toBe(false);
    expect(isBoolean(ALL_VALUES.infinity)).toBe(false);
    expect(isBoolean(ALL_VALUES.null)).toBe(false);
    expect(isBoolean(ALL_VALUES.undefined)).toBe(false);
    expect(isBoolean(ALL_VALUES.object)).toBe(false);
    expect(isBoolean(ALL_VALUES.array)).toBe(false);
    expect(isBoolean(ALL_VALUES.function)).toBe(false);
    expect(isBoolean(ALL_VALUES.symbol)).toBe(false);
    expect(isBoolean(ALL_VALUES.date)).toBe(false);
    expect(isBoolean(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isFunction', () => {
  it('returns true for an arrow function', () => {
    expect(isFunction(ALL_VALUES.function)).toBe(true);
  });

  it('returns false for all non-function values', () => {
    expect(isFunction(ALL_VALUES.string)).toBe(false);
    expect(isFunction(ALL_VALUES.number)).toBe(false);
    expect(isFunction(ALL_VALUES.zero)).toBe(false);
    expect(isFunction(ALL_VALUES.nan)).toBe(false);
    expect(isFunction(ALL_VALUES.infinity)).toBe(false);
    expect(isFunction(ALL_VALUES.true)).toBe(false);
    expect(isFunction(ALL_VALUES.false)).toBe(false);
    expect(isFunction(ALL_VALUES.null)).toBe(false);
    expect(isFunction(ALL_VALUES.undefined)).toBe(false);
    expect(isFunction(ALL_VALUES.object)).toBe(false);
    expect(isFunction(ALL_VALUES.array)).toBe(false);
    expect(isFunction(ALL_VALUES.symbol)).toBe(false);
    expect(isFunction(ALL_VALUES.date)).toBe(false);
    expect(isFunction(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isNull', () => {
  it('returns true for null', () => {
    expect(isNull(ALL_VALUES.null)).toBe(true);
  });

  it('returns false for all non-null values', () => {
    expect(isNull(ALL_VALUES.string)).toBe(false);
    expect(isNull(ALL_VALUES.number)).toBe(false);
    expect(isNull(ALL_VALUES.zero)).toBe(false);
    expect(isNull(ALL_VALUES.nan)).toBe(false);
    expect(isNull(ALL_VALUES.infinity)).toBe(false);
    expect(isNull(ALL_VALUES.true)).toBe(false);
    expect(isNull(ALL_VALUES.false)).toBe(false);
    expect(isNull(ALL_VALUES.undefined)).toBe(false);
    expect(isNull(ALL_VALUES.object)).toBe(false);
    expect(isNull(ALL_VALUES.array)).toBe(false);
    expect(isNull(ALL_VALUES.function)).toBe(false);
    expect(isNull(ALL_VALUES.symbol)).toBe(false);
    expect(isNull(ALL_VALUES.date)).toBe(false);
    expect(isNull(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isUndefined', () => {
  it('returns true for undefined', () => {
    expect(isUndefined(ALL_VALUES.undefined)).toBe(true);
  });

  it('returns false for all non-undefined values', () => {
    expect(isUndefined(ALL_VALUES.string)).toBe(false);
    expect(isUndefined(ALL_VALUES.number)).toBe(false);
    expect(isUndefined(ALL_VALUES.zero)).toBe(false);
    expect(isUndefined(ALL_VALUES.nan)).toBe(false);
    expect(isUndefined(ALL_VALUES.infinity)).toBe(false);
    expect(isUndefined(ALL_VALUES.true)).toBe(false);
    expect(isUndefined(ALL_VALUES.false)).toBe(false);
    expect(isUndefined(ALL_VALUES.null)).toBe(false);
    expect(isUndefined(ALL_VALUES.object)).toBe(false);
    expect(isUndefined(ALL_VALUES.array)).toBe(false);
    expect(isUndefined(ALL_VALUES.function)).toBe(false);
    expect(isUndefined(ALL_VALUES.symbol)).toBe(false);
    expect(isUndefined(ALL_VALUES.date)).toBe(false);
    expect(isUndefined(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isDefined', () => {
  it('returns false for undefined', () => {
    expect(isDefined(ALL_VALUES.undefined)).toBe(false);
  });

  it('returns true for null (null is defined, just null)', () => {
    expect(isDefined(ALL_VALUES.null)).toBe(true);
  });

  it('returns true for falsy-but-defined values', () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined('')).toBe(true);
    expect(isDefined(false)).toBe(true);
    expect(isDefined(NaN)).toBe(true);
  });

  it('returns true for all non-undefined values', () => {
    expect(isDefined(ALL_VALUES.string)).toBe(true);
    expect(isDefined(ALL_VALUES.number)).toBe(true);
    expect(isDefined(ALL_VALUES.zero)).toBe(true);
    expect(isDefined(ALL_VALUES.nan)).toBe(true);
    expect(isDefined(ALL_VALUES.infinity)).toBe(true);
    expect(isDefined(ALL_VALUES.true)).toBe(true);
    expect(isDefined(ALL_VALUES.false)).toBe(true);
    expect(isDefined(ALL_VALUES.null)).toBe(true);
    expect(isDefined(ALL_VALUES.object)).toBe(true);
    expect(isDefined(ALL_VALUES.array)).toBe(true);
    expect(isDefined(ALL_VALUES.function)).toBe(true);
    expect(isDefined(ALL_VALUES.symbol)).toBe(true);
    expect(isDefined(ALL_VALUES.date)).toBe(true);
    expect(isDefined(ALL_VALUES.regexp)).toBe(true);
  });
});

describe('isArray', () => {
  it('returns true for an empty array', () => {
    expect(isArray([])).toBe(true);
  });

  it('returns true for an array with elements', () => {
    expect(isArray([1, 2, 3])).toBe(true);
  });

  it('returns false for an array-like object with a length property', () => {
    expect(isArray({ length: 0 })).toBe(false);
  });

  it('returns false for all non-array values', () => {
    expect(isArray(ALL_VALUES.string)).toBe(false);
    expect(isArray(ALL_VALUES.number)).toBe(false);
    expect(isArray(ALL_VALUES.true)).toBe(false);
    expect(isArray(ALL_VALUES.null)).toBe(false);
    expect(isArray(ALL_VALUES.undefined)).toBe(false);
    expect(isArray(ALL_VALUES.object)).toBe(false);
    expect(isArray(ALL_VALUES.function)).toBe(false);
    expect(isArray(ALL_VALUES.symbol)).toBe(false);
    expect(isArray(ALL_VALUES.date)).toBe(false);
    expect(isArray(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isObject', () => {
  it('returns true for a plain object', () => {
    expect(isObject({})).toBe(true);
  });

  it('returns true for an array (arrays are objects)', () => {
    expect(isObject([])).toBe(true);
  });

  it('returns true for a Date instance', () => {
    expect(isObject(new Date())).toBe(true);
  });

  it('returns true for a RegExp instance', () => {
    expect(isObject(new RegExp('x'))).toBe(true);
  });

  it('returns true for an object created with Object.create(null)', () => {
    expect(isObject(Object.create(null))).toBe(true);
  });

  it('returns false for null', () => {
    expect(isObject(null)).toBe(false);
  });

  it('returns false for primitives and functions', () => {
    expect(isObject(ALL_VALUES.string)).toBe(false);
    expect(isObject(ALL_VALUES.number)).toBe(false);
    expect(isObject(ALL_VALUES.true)).toBe(false);
    expect(isObject(ALL_VALUES.undefined)).toBe(false);
    expect(isObject(ALL_VALUES.function)).toBe(false);
    expect(isObject(ALL_VALUES.symbol)).toBe(false);
  });
});

describe('isDate', () => {
  it('returns true for a Date instance', () => {
    expect(isDate(new Date())).toBe(true);
  });

  it('returns false for a date-like string', () => {
    expect(isDate('2024-01-01')).toBe(false);
  });

  it('returns false for a timestamp number', () => {
    expect(isDate(Date.now())).toBe(false);
  });

  it('returns false for all non-date values', () => {
    expect(isDate(ALL_VALUES.string)).toBe(false);
    expect(isDate(ALL_VALUES.number)).toBe(false);
    expect(isDate(ALL_VALUES.true)).toBe(false);
    expect(isDate(ALL_VALUES.null)).toBe(false);
    expect(isDate(ALL_VALUES.undefined)).toBe(false);
    expect(isDate(ALL_VALUES.object)).toBe(false);
    expect(isDate(ALL_VALUES.array)).toBe(false);
    expect(isDate(ALL_VALUES.function)).toBe(false);
    expect(isDate(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isRegExp', () => {
  it('returns true for a RegExp constructor instance', () => {
    expect(isRegExp(new RegExp('x'))).toBe(true);
  });

  it('returns true for a regex literal', () => {
    expect(isRegExp(/test/)).toBe(true);
  });

  it('returns false for a regex-like string', () => {
    expect(isRegExp('/test/')).toBe(false);
  });

  it('returns false for all non-regexp values', () => {
    expect(isRegExp(ALL_VALUES.string)).toBe(false);
    expect(isRegExp(ALL_VALUES.number)).toBe(false);
    expect(isRegExp(ALL_VALUES.true)).toBe(false);
    expect(isRegExp(ALL_VALUES.null)).toBe(false);
    expect(isRegExp(ALL_VALUES.undefined)).toBe(false);
    expect(isRegExp(ALL_VALUES.object)).toBe(false);
    expect(isRegExp(ALL_VALUES.array)).toBe(false);
    expect(isRegExp(ALL_VALUES.function)).toBe(false);
    expect(isRegExp(ALL_VALUES.date)).toBe(false);
  });
});

describe('isNaN', () => {
  it('returns true for NaN', () => {
    expect(isNaN(NaN)).toBe(true);
  });

  it('returns true for Number.NaN', () => {
    expect(isNaN(Number.NaN)).toBe(true);
  });

  it('returns false for undefined (unlike global isNaN)', () => {
    expect(isNaN(undefined)).toBe(false);
  });

  it('returns false for non-numeric strings (unlike global isNaN)', () => {
    expect(isNaN('hello')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNaN(null)).toBe(false);
  });

  it('returns false for regular numbers', () => {
    expect(isNaN(0)).toBe(false);
    expect(isNaN(42)).toBe(false);
    expect(isNaN(-1)).toBe(false);
    expect(isNaN(Infinity)).toBe(false);
  });

  it('returns false for all other types', () => {
    expect(isNaN(ALL_VALUES.string)).toBe(false);
    expect(isNaN(ALL_VALUES.true)).toBe(false);
    expect(isNaN(ALL_VALUES.object)).toBe(false);
    expect(isNaN(ALL_VALUES.array)).toBe(false);
    expect(isNaN(ALL_VALUES.function)).toBe(false);
    expect(isNaN(ALL_VALUES.date)).toBe(false);
    expect(isNaN(ALL_VALUES.regexp)).toBe(false);
  });
});

describe('isWindow', () => {
  it('returns true for a self-referencing window-like object', () => {
    const fakeWindow: Record<string, unknown> = {};
    fakeWindow['window'] = fakeWindow;
    expect(isWindow(fakeWindow)).toBe(true);
  });

  it('returns false for a regular object', () => {
    expect(isWindow({})).toBe(false);
  });

  it('returns false for an object with a window property that does not reference itself', () => {
    expect(isWindow({ window: 'not self' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isWindow(null)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isWindow(ALL_VALUES.string)).toBe(false);
    expect(isWindow(ALL_VALUES.number)).toBe(false);
    expect(isWindow(ALL_VALUES.true)).toBe(false);
    expect(isWindow(ALL_VALUES.undefined)).toBe(false);
  });
});

describe('isBlankObject', () => {
  it('returns true for Object.create(null)', () => {
    expect(isBlankObject(Object.create(null))).toBe(true);
  });

  it('returns false for a plain object literal (has Object.prototype)', () => {
    expect(isBlankObject({})).toBe(false);
  });

  it('returns false for an array', () => {
    expect(isBlankObject([])).toBe(false);
  });

  it('returns false for null', () => {
    expect(isBlankObject(null)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isBlankObject(ALL_VALUES.string)).toBe(false);
    expect(isBlankObject(ALL_VALUES.number)).toBe(false);
    expect(isBlankObject(ALL_VALUES.true)).toBe(false);
    expect(isBlankObject(ALL_VALUES.undefined)).toBe(false);
  });
});

describe('isTypedArray', () => {
  it('returns true for Uint8Array', () => {
    expect(isTypedArray(new Uint8Array())).toBe(true);
  });

  it('returns true for Float32Array', () => {
    expect(isTypedArray(new Float32Array())).toBe(true);
  });

  it('returns true for Int16Array', () => {
    expect(isTypedArray(new Int16Array())).toBe(true);
  });

  it('returns false for a regular array', () => {
    expect(isTypedArray([])).toBe(false);
  });

  it('returns false for an ArrayBuffer', () => {
    expect(isTypedArray(new ArrayBuffer(8))).toBe(false);
  });

  it('returns false for all other types', () => {
    expect(isTypedArray(ALL_VALUES.string)).toBe(false);
    expect(isTypedArray(ALL_VALUES.number)).toBe(false);
    expect(isTypedArray(ALL_VALUES.null)).toBe(false);
    expect(isTypedArray(ALL_VALUES.undefined)).toBe(false);
    expect(isTypedArray(ALL_VALUES.object)).toBe(false);
    expect(isTypedArray(ALL_VALUES.function)).toBe(false);
  });
});

describe('isArrayBuffer', () => {
  it('returns true for an ArrayBuffer', () => {
    expect(isArrayBuffer(new ArrayBuffer(8))).toBe(true);
  });

  it('returns false for a typed array', () => {
    expect(isArrayBuffer(new Uint8Array())).toBe(false);
  });

  it('returns false for a regular array', () => {
    expect(isArrayBuffer([])).toBe(false);
  });

  it('returns false for all other types', () => {
    expect(isArrayBuffer(ALL_VALUES.string)).toBe(false);
    expect(isArrayBuffer(ALL_VALUES.number)).toBe(false);
    expect(isArrayBuffer(ALL_VALUES.null)).toBe(false);
    expect(isArrayBuffer(ALL_VALUES.undefined)).toBe(false);
    expect(isArrayBuffer(ALL_VALUES.object)).toBe(false);
    expect(isArrayBuffer(ALL_VALUES.function)).toBe(false);
  });
});

describe('isArrayLike', () => {
  it('returns true for an array', () => {
    expect(isArrayLike([])).toBe(true);
    expect(isArrayLike([1, 2, 3])).toBe(true);
  });

  it('returns true for a string', () => {
    expect(isArrayLike('hello')).toBe(true);
  });

  it('returns true for an object with length 0', () => {
    expect(isArrayLike({ length: 0 })).toBe(true);
  });

  it('returns true for an object with a positive integer length', () => {
    expect(isArrayLike({ length: 5 })).toBe(true);
  });

  it('returns false for a plain object without length', () => {
    expect(isArrayLike({})).toBe(false);
  });

  it('returns false for an object with negative length', () => {
    expect(isArrayLike({ length: -1 })).toBe(false);
  });

  it('returns false for an object with non-integer length', () => {
    expect(isArrayLike({ length: 1.5 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isArrayLike(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isArrayLike(undefined)).toBe(false);
  });

  it('returns false for a function', () => {
    expect(isArrayLike(() => {})).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isArrayLike(42)).toBe(false);
  });

  it('returns false for a boolean', () => {
    expect(isArrayLike(true)).toBe(false);
  });
});

describe('forEach', () => {
  describe('array iteration', () => {
    it('iterates all elements passing correct value, index, and array reference', () => {
      const source = ['a', 'b', 'c'];
      const collected: Array<{ value: string; index: number; ref: string[] }> = [];

      forEach(source, (value, index, array) => {
        collected.push({ value, index, ref: array });
        return undefined;
      });

      expect(collected).toEqual([
        { value: 'a', index: 0, ref: source },
        { value: 'b', index: 1, ref: source },
        { value: 'c', index: 2, ref: source },
      ]);
    });

    it('collects values in order', () => {
      const values: number[] = [];

      forEach([10, 20, 30], (value) => {
        values.push(value);
        return undefined;
      });

      expect(values).toEqual([10, 20, 30]);
    });
  });

  describe('object iteration', () => {
    it('iterates all own enumerable properties passing correct value, key, and object reference', () => {
      const source = { x: 1, y: 2, z: 3 };
      const collected: Array<{ value: number; key: string; ref: Record<string, number> }> = [];

      forEach(source, (value, key, object) => {
        collected.push({ value, key, ref: object });
        return undefined;
      });

      expect(collected).toEqual([
        { value: 1, key: 'x', ref: source },
        { value: 2, key: 'y', ref: source },
        { value: 3, key: 'z', ref: source },
      ]);
    });

    it('collects keys and values', () => {
      const keys: string[] = [];
      const values: string[] = [];

      forEach({ name: 'Alice', role: 'admin' }, (value, key) => {
        keys.push(key);
        values.push(value);
        return undefined;
      });

      expect(keys).toEqual(['name', 'role']);
      expect(values).toEqual(['Alice', 'admin']);
    });
  });

  describe('early exit', () => {
    it('stops array iteration when iteratee returns false', () => {
      const visited: number[] = [];

      forEach([1, 2, 3, 4, 5], (value) => {
        visited.push(value);
        if (value === 3) return false;
        return undefined;
      });

      expect(visited).toEqual([1, 2, 3]);
    });

    it('stops object iteration when iteratee returns false', () => {
      const visited: string[] = [];

      forEach({ a: 1, b: 2, c: 3, d: 4 }, (_value, key) => {
        visited.push(key);
        if (key === 'b') return false;
        return undefined;
      });

      expect(visited).toEqual(['a', 'b']);
    });
  });

  describe('inherited properties skipped', () => {
    it('only visits own properties, not inherited ones', () => {
      const proto = { inherited: true };
      const obj = Object.create(proto) as Record<string, unknown>;
      obj['own'] = 'value';

      const keys: string[] = [];

      forEach(obj, (_value, key) => {
        keys.push(key);
        return undefined;
      });

      expect(keys).toEqual(['own']);
    });
  });

  describe('objects shadowing hasOwnProperty', () => {
    it('iterates all keys of an object that shadows hasOwnProperty', () => {
      const obj = { hasOwnProperty: true, a: 1, b: 2, c: 3 };
      const keys: string[] = [];

      forEach(obj, (_value, key) => {
        keys.push(key);
        return undefined;
      });

      expect(keys).toContain('hasOwnProperty');
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).toContain('c');
      expect(keys).toHaveLength(4);
    });
  });

  describe('objects with no prototype parent', () => {
    it('iterates properties of Object.create(null) objects without errors', () => {
      const obj = Object.create(null) as Record<string, unknown>;
      obj['x'] = 10;
      obj['y'] = 20;
      const keys: string[] = [];

      forEach(obj, (_value, key) => {
        keys.push(key);
        return undefined;
      });

      expect(keys).toContain('x');
      expect(keys).toContain('y');
      expect(keys).toHaveLength(2);
    });
  });

  describe('null/undefined handling', () => {
    it('does not throw when collection is null', () => {
      const iteratee = () => undefined;
      expect(() => {
        forEach(null, iteratee);
      }).not.toThrow();
    });

    it('does not throw when collection is undefined', () => {
      const iteratee = () => undefined;
      expect(() => {
        forEach(undefined, iteratee);
      }).not.toThrow();
    });
  });
});

describe('copy', () => {
  describe('primitives', () => {
    it('returns a number as-is', () => {
      expect(copy(42)).toBe(42);
    });

    it('returns a string as-is', () => {
      expect(copy('hello')).toBe('hello');
    });

    it('returns null as-is', () => {
      expect(copy(null)).toBe(null);
    });

    it('returns undefined as-is', () => {
      const value: unknown = undefined;
      expect(copy(value)).toBe(undefined);
    });

    it('returns a boolean as-is', () => {
      expect(copy(true)).toBe(true);
    });
  });

  describe('nested objects (independence)', () => {
    it('deeply clones an object so mutations to the clone do not affect the original', () => {
      const original = { a: 1, b: { c: 2 } };
      const cloned = copy(original);

      cloned.b.c = 999;

      expect(original.b.c).toBe(2);
    });
  });

  describe('arrays', () => {
    it('deeply clones an array so mutations to the clone do not affect the original', () => {
      const original = [1, [2, 3], 4];
      const cloned = copy(original);

      (cloned[1] as number[])[0] = 999;

      expect((original[1] as number[])[0]).toBe(2);
    });
  });

  describe('Date', () => {
    it('clones a Date as a different instance with the same time', () => {
      const original = new Date(1234567890000);
      const cloned = copy(original);

      expect(cloned).not.toBe(original);
      expect(cloned.getTime()).toBe(original.getTime());
    });
  });

  describe('RegExp', () => {
    it('clones a RegExp as a different instance with the same source and flags', () => {
      const original = /test/gi;
      const cloned = copy(original);

      expect(cloned).not.toBe(original);
      expect(cloned.source).toBe(original.source);
      expect(cloned.flags).toBe(original.flags);
    });
  });

  describe('TypedArray', () => {
    it('clones a Uint8Array as a different instance with the same values', () => {
      const original = new Uint8Array([1, 2, 3]);
      const cloned = copy(original);

      expect(cloned).not.toBe(original);
      expect(cloned).toEqual(original);

      cloned[0] = 255;
      expect(original[0]).toBe(1);
    });
  });

  describe('ArrayBuffer', () => {
    it('clones an ArrayBuffer as a different instance', () => {
      const original = new ArrayBuffer(8);
      const cloned = copy(original);

      expect(cloned).not.toBe(original);
    });
  });

  describe('circular reference', () => {
    it('throws when the source contains a circular reference', () => {
      const a: Record<string, unknown> = {};
      a['self'] = a;

      expect(() => copy(a)).toThrow('Circular reference');
    });
  });

  describe('destination parameter', () => {
    it('copies source properties into destination object, clearing existing destination keys', () => {
      const dest: Record<string, number> = { y: 2 };
      const result = copy({ x: 1 }, dest);

      expect(result).toBe(dest);
      expect(dest).toEqual({ x: 1 });
      expect('y' in dest).toBe(false);
    });

    it('copies source elements into destination array, replacing existing contents', () => {
      const dest = [5, 6, 7];
      const result = copy([1, 2], dest);

      expect(result).toBe(dest);
      expect(dest).toEqual([1, 2]);
    });
  });

  describe('source equals destination', () => {
    it('throws when source and destination are the same object', () => {
      const obj = { a: 1 };
      expect(() => copy(obj, obj)).toThrow('Cannot copy! Source and destination are identical.');
    });
  });

  describe('TypedArray destination', () => {
    it('throws when a TypedArray is provided as destination', () => {
      const src = new Uint8Array([1, 2, 3]);
      const dest = new Uint8Array(3);
      expect(() => copy(src, dest)).toThrow('Cannot copy! TypedArray destination is not supported.');
    });
  });

  describe('ArrayBuffer destination', () => {
    it('throws when an ArrayBuffer is provided as destination', () => {
      const src = new ArrayBuffer(8);
      const dest = new ArrayBuffer(8);
      expect(() => copy(src, dest)).toThrow('Cannot copy! ArrayBuffer destination is not supported.');
    });
  });

  describe('edge cases', () => {
    it('copies an empty object', () => {
      const result = copy({});
      expect(result).toEqual({});
    });

    it('copies an empty array', () => {
      const result = copy([]);
      expect(result).toEqual([]);
    });
  });
});

describe('noop', () => {
  it('returns undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    expect(noop()).toBe(undefined);
  });

  it('has no side effects', () => {
    expect(() => {
      noop();
    }).not.toThrow();
  });
});

describe('createMap', () => {
  it('returns an object with null prototype', () => {
    expect(Object.getPrototypeOf(createMap())).toBe(null);
  });

  it('has no inherited properties', () => {
    expect('toString' in createMap()).toBe(false);
  });

  it('allows properties to be set and read', () => {
    const map = createMap<number>();
    map['key'] = 42;
    expect(map['key']).toBe(42);
  });
});

describe('range', () => {
  it('generates a sequence from 0 to end-1 with one argument', () => {
    expect(range(4)).toEqual([0, 1, 2, 3]);
  });

  it('returns an empty array when the single argument is zero', () => {
    expect(range(0)).toEqual([]);
  });

  it('generates an ascending sequence with two arguments', () => {
    expect(range(1, 5)).toEqual([1, 2, 3, 4]);
  });

  it('generates a descending sequence with two arguments when start > end', () => {
    expect(range(5, 0)).toEqual([5, 4, 3, 2, 1]);
  });

  it('generates a sequence with a custom step', () => {
    expect(range(0, 10, 2)).toEqual([0, 2, 4, 6, 8]);
  });

  it('generates a descending sequence with a negative step', () => {
    expect(range(5, 0, -1)).toEqual([5, 4, 3, 2, 1]);
  });

  it('returns an empty array when start equals end', () => {
    expect(range(3, 3)).toEqual([]);
  });

  it('returns an empty array when step goes in the wrong direction', () => {
    expect(range(0, 5, -1)).toEqual([]);
  });
});
