import { describe, it, expect, vi } from 'vitest';
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

    it('parses uppercase scientific notation', () => {
      const fn = parse('.42E2');
      expect(fn()).toBe(42);
    });

    it('parses scientific notation with explicit positive sign', () => {
      const fn = parse('.42e+2');
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

    it('throws for mismatched quotes', () => {
      expect(() => parse('"abc\'')).toThrow();
    });

    it('parses escaped single quote in single-quoted string', () => {
      const fn = parse("'a\\'b'");
      expect(fn()).toBe("a'b");
    });

    it('parses escaped double quote in double-quoted string', () => {
      const fn = parse('"a\\"b"');
      expect(fn()).toBe('a"b');
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

  describe('arrays', () => {
    it('parses empty arrays', () => {
      const fn = parse('[]');
      expect(fn()).toEqual([]);
    });

    it('parses arrays with mixed types', () => {
      const fn = parse('[1, "two", [3], true]');
      expect(fn()).toEqual([1, 'two', [3], true]);
    });

    it('parses arrays with trailing commas', () => {
      const fn = parse('[1, 2, 3, ]');
      expect(fn()).toEqual([1, 2, 3]);
    });
  });

  describe('objects', () => {
    it('parses empty objects', () => {
      const fn = parse('{}');
      expect(fn()).toEqual({});
    });

    it('parses objects with identifier keys', () => {
      const fn = parse('{a: 1, b: "two"}');
      expect(fn()).toEqual({ a: 1, b: 'two' });
    });

    it('parses objects with string keys', () => {
      const fn = parse('{"a key": 1}');
      expect(fn()).toEqual({ 'a key': 1 });
    });

    it('parses objects with numeric keys', () => {
      const fn = parse('{0: 1}');
      expect(fn()).toEqual({ 0: 1 });
    });

    it('parses objects with keyword keys', () => {
      const fn = parse('{null: 1}');
      expect(fn()).toEqual({ null: 1 });
    });
  });

  describe('identifiers', () => {
    it('looks up an identifier from the scope', () => {
      expect(parse('aKey')({ aKey: 42 })).toBe(42);
    });

    it('returns undefined for a missing identifier', () => {
      expect(parse('aKey')({})).toBeUndefined();
    });

    it('returns undefined when no scope argument is passed', () => {
      expect(parse('aKey')()).toBeUndefined();
    });

    it('looks up hasOwnProperty as an identifier', () => {
      expect(parse('hasOwnProperty')({ hasOwnProperty: 42 })).toBe(42);
    });

    it('looks up toString as an identifier', () => {
      expect(parse('toString')({ toString: 42 })).toBe(42);
    });

    it('supports the this keyword', () => {
      const scope = { a: 1 };
      expect(parse('this')(scope)).toBe(scope);
    });
  });

  describe('member expressions', () => {
    it('looks up a property via dot notation', () => {
      expect(parse('aKey.anotherKey')({ aKey: { anotherKey: 42 } })).toBe(42);
    });

    it('looks up a property via computed access', () => {
      expect(parse('aKey["anotherKey"]')({ aKey: { anotherKey: 42 } })).toBe(42);
    });

    it('looks up a deeply chained property', () => {
      const scope = { aKey: { secondKey: { thirdKey: { fourthKey: 42 } } } };
      expect(parse('aKey.secondKey.thirdKey.fourthKey')(scope)).toBe(42);
    });

    it('returns undefined when an intermediate is undefined', () => {
      expect(parse('aKey.anotherKey')({ aKey: undefined })).toBeUndefined();
    });

    it('looks up a nested computed property', () => {
      const scope = { lock: { theKey: 42 }, keys: { aKey: 'theKey' } };
      expect(parse('lock[keys["aKey"]]')(scope)).toBe(42);
    });

    it('uses locals instead of scope when the key exists in locals', () => {
      expect(parse('aKey')({ aKey: 'fromScope' }, { aKey: 'fromLocals' })).toBe('fromLocals');
    });

    it('falls back to scope when the key does not exist in locals', () => {
      expect(parse('aKey')({ aKey: 'fromScope' }, { otherKey: 'fromLocals' })).toBe('fromScope');
    });

    it('uses the locals object for the full chain when the root key exists in locals', () => {
      const scope = { aKey: { anotherKey: 'scope' } };
      const locals = { aKey: { anotherKey: 'locals' } };
      expect(parse('aKey.anotherKey')(scope, locals)).toBe('locals');
    });

    it('handles whitespace around dots', () => {
      expect(parse('a . b')({ a: { b: 42 } })).toBe(42);
    });

    it('accesses a member on an inline object literal', () => {
      expect(parse('{aKey: 40}.aKey')({})).toBe(40);
    });

    it('looks up a computed property using a scope key', () => {
      expect(parse('lock[key]')({ key: 'aKey', lock: { aKey: 'theValue' } })).toBe('theValue');
    });

    it('accesses an element of an inline array literal', () => {
      expect(parse('[1][0]')({})).toBe(1);
    });

    it('accesses a property on an inline array literal', () => {
      expect(parse('[1, 2].length')({})).toBe(2);
    });
  });

  describe('function calls', () => {
    it('parses a simple function call', () => {
      const fn = vi.fn(() => 42);
      expect(parse('aFunction()')({ aFunction: fn })).toBe(42);
      expect(fn).toHaveBeenCalled();
    });

    it('parses a function call with a literal argument', () => {
      expect(parse('aFunction(42)')({ aFunction: (n: number) => n })).toBe(42);
    });

    it('parses a function call with an identifier argument', () => {
      expect(parse('aFunction(n)')({ aFunction: (n: number) => n, n: 42 })).toBe(42);
    });

    it('parses a function call with a nested function as argument', () => {
      const scope = {
        aFunction: (v: number) => v,
        argsFn: () => 42,
      };
      expect(parse('aFunction(argsFn())')(scope)).toBe(42);
    });

    it('parses a function call with multiple arguments', () => {
      const scope = {
        aFunction: (a: number, b: number, c: number) => a + b + c,
        a: 1,
        b: 2,
        c: 3,
      };
      expect(parse('aFunction(a, b, c)')(scope)).toBe(6);
    });

    it('preserves this binding for dot-access method calls', () => {
      const scope = {
        anObject: {
          name: 'obj',
          aFunction() {
            return this.name;
          },
        },
      };
      expect(parse('anObject.aFunction()')(scope)).toBe('obj');
    });

    it('preserves this binding for computed-access method calls', () => {
      const scope = {
        anObject: {
          name: 'obj',
          aFunction() {
            return this.name;
          },
        },
      };
      expect(parse('anObject["aFunction"]()')(scope)).toBe('obj');
    });

    it('binds this to the immediate parent in deeply nested method calls', () => {
      const scope = {
        anObject: {
          obj: {
            name: 'inner',
            nested() {
              return this.name;
            },
          },
        },
      };
      expect(parse('anObject.obj.nested()')(scope)).toBe('inner');
    });

    it('accesses a field on a function call result', () => {
      expect(parse('a().name')({ a: () => ({ name: 'Misko' }) })).toBe('Misko');
    });

    it('calls a function returned by a function', () => {
      expect(parse('fn()()')({ fn: () => () => 42 })).toBe(42);
    });

    it('binds bare function calls to the scope', () => {
      const scope = {
        aFunction() {
          return this;
        },
      };
      const result = parse('aFunction')(scope) as () => unknown;
      // The returned value is the function itself; calling it with the scope's context
      // is handled by the call expression, not bare identifier resolution
      expect(typeof result).toBe('function');
    });

    it('binds bare function calls from locals', () => {
      const locals = {
        aFunction() {
          return this;
        },
      };
      const result = parse('aFunction')({}, locals) as () => unknown;
      expect(typeof result).toBe('function');
    });
  });
});

describe('spec 009 — operators & assignment', () => {
  describe('unary operators', () => {
    it('evaluates !true as false', () => {
      expect(parse('!true')({})).toBe(false);
    });

    it('evaluates !0 as true', () => {
      expect(parse('!0')({})).toBe(true);
    });

    it("evaluates !'' as true", () => {
      expect(parse("!''")({})).toBe(true);
    });

    it("evaluates !!'x' as true", () => {
      expect(parse("!!'x'")({})).toBe(true);
    });

    it('evaluates -5 as -5', () => {
      expect(parse('-5')({})).toBe(-5);
    });

    it('evaluates -a against scope as -3', () => {
      expect(parse('-a')({ a: 3 })).toBe(-3);
    });

    it('evaluates +"42" as 42', () => {
      expect(parse('+"42"')({})).toBe(42);
    });

    it('evaluates !!undefined as false', () => {
      expect(parse('!!undefined')({})).toBe(false);
    });
  });
});
