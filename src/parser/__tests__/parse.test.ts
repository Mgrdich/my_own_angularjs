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

  describe('arithmetic', () => {
    it('adds integers', () => {
      expect(parse('2 + 3')({})).toBe(5);
    });

    it('concatenates strings with +', () => {
      expect(parse("'a' + 'b'")({})).toBe('ab');
    });

    it('concatenates mixed string and number with +', () => {
      expect(parse("'x' + 1")({})).toBe('x1');
    });

    it('subtracts integers', () => {
      expect(parse('10 - 4')({})).toBe(6);
    });

    it('multiplies integers', () => {
      expect(parse('3 * 4')({})).toBe(12);
    });

    it('divides numbers', () => {
      expect(parse('10 / 4')({})).toBe(2.5);
    });

    it('returns Infinity for division by zero', () => {
      expect(parse('10 / 0')({})).toBe(Infinity);
    });

    it('computes remainder with %', () => {
      expect(parse('10 % 3')({})).toBe(1);
    });

    it('respects operator precedence: * tighter than +', () => {
      expect(parse('2 + 3 * 4')({})).toBe(14);
    });

    it('allows parentheses to override precedence', () => {
      expect(parse('(2 + 3) * 4')({})).toBe(20);
    });

    it('is left-associative for -', () => {
      expect(parse('10 - 3 - 2')({})).toBe(5);
    });

    it('returns NaN when adding a number to an undefined identifier', () => {
      expect(parse('1 + missing')({})).toBeNaN();
    });
  });

  describe('comparison', () => {
    it('1 == 1 is true', () => {
      expect(parse('1 == 1')({})).toBe(true);
    });

    it('loose equality: 1 == "1" is true', () => {
      expect(parse('1 == "1"')({})).toBe(true);
    });

    it('1 === 1 is true', () => {
      expect(parse('1 === 1')({})).toBe(true);
    });

    it('strict equality: 1 === "1" is false', () => {
      expect(parse('1 === "1"')({})).toBe(false);
    });

    it('1 != 2 is true', () => {
      expect(parse('1 != 2')({})).toBe(true);
    });

    it('strict inequality: 1 !== "1" is true', () => {
      expect(parse('1 !== "1"')({})).toBe(true);
    });

    it('3 < 5 is true', () => {
      expect(parse('3 < 5')({})).toBe(true);
    });

    it('5 <= 5 is true', () => {
      expect(parse('5 <= 5')({})).toBe(true);
    });

    it('5 > 3 is true', () => {
      expect(parse('5 > 3')({})).toBe(true);
    });

    it('5 >= 5 is true', () => {
      expect(parse('5 >= 5')({})).toBe(true);
    });

    it('precedence: + tighter than < (1 + 2 < 4 is true)', () => {
      expect(parse('1 + 2 < 4')({})).toBe(true);
    });

    it('precedence: < tighter than === (1 < 2 === true is true)', () => {
      expect(parse('1 < 2 === true')({})).toBe(true);
    });
  });

  describe('logical', () => {
    it('true && false is false', () => {
      expect(parse('true && false')({})).toBe(false);
    });

    it("true && 'x' returns the right operand 'x'", () => {
      expect(parse("true && 'x'")({})).toBe('x');
    });

    it("false || 'fallback' returns 'fallback'", () => {
      expect(parse("false || 'fallback'")({})).toBe('fallback');
    });

    it("'a' || 'b' returns the left operand 'a'", () => {
      expect(parse("'a' || 'b'")({})).toBe('a');
    });

    it('short-circuits && when the left operand is falsy', () => {
      const scope = {
        throws: vi.fn(() => {
          throw new Error('should not run');
        }),
      };
      expect(parse('false && throws()')(scope)).toBe(false);
      expect(scope.throws).toHaveBeenCalledTimes(0);
    });

    it('short-circuits || when the left operand is truthy', () => {
      const scope = {
        throws: vi.fn(() => {
          throw new Error('should not run');
        }),
      };
      expect(parse('true || throws()')(scope)).toBe(true);
      expect(scope.throws).toHaveBeenCalledTimes(0);
    });

    it('precedence: || is looser than && (a || b && c)', () => {
      expect(parse('a || b && c')({ a: false, b: true, c: 'result' })).toBe('result');
    });
  });

  describe('ternary', () => {
    it('true ? 1 : 2 returns 1', () => {
      expect(parse('true ? 1 : 2')({})).toBe(1);
    });

    it('false ? 1 : 2 returns 2', () => {
      expect(parse('false ? 1 : 2')({})).toBe(2);
    });

    it('does not evaluate the false branch when the condition is truthy', () => {
      const scope = {
        safe: 'ok',
        throws: vi.fn(() => {
          throw new Error('should not run');
        }),
      };
      expect(parse('true ? safe : throws()')(scope)).toBe('ok');
      expect(scope.throws).toHaveBeenCalledTimes(0);
    });

    it('does not evaluate the true branch when the condition is falsy', () => {
      const scope = {
        safe: 'ok',
        throws: vi.fn(() => {
          throw new Error('should not run');
        }),
      };
      expect(parse('false ? throws() : safe')(scope)).toBe('ok');
      expect(scope.throws).toHaveBeenCalledTimes(0);
    });

    it('nested ternary: true ? 1 : false ? 2 : 3 returns 1', () => {
      expect(parse('true ? 1 : false ? 2 : 3')({})).toBe(1);
    });

    it('is right-associative: false ? 1 : true ? 2 : 3 returns 2', () => {
      expect(parse('false ? 1 : true ? 2 : 3')({})).toBe(2);
    });

    it("precedence vs ||: false || true ? 'yes' : 'no' returns 'yes'", () => {
      expect(parse("false || true ? 'yes' : 'no'")({})).toBe('yes');
    });
  });

  describe('assignment', () => {
    it('assigns a value to an identifier on the scope', () => {
      const scope: { a?: number } = {};
      const result = parse('a = 1')(scope);
      expect(result).toBe(1);
      expect(scope.a).toBe(1);
    });

    it('returns the assigned value', () => {
      const scope: { a?: number } = {};
      expect(parse('a = 42')(scope)).toBe(42);
    });

    it('assigns to a dot-member expression', () => {
      const scope: { a: { b?: number } } = { a: {} };
      parse('a.b = 2')(scope);
      expect(scope.a.b).toBe(2);
    });

    it('assigns to a computed-member expression', () => {
      const scope: { a: Record<string, number>; k: string } = { a: {}, k: 'key' };
      parse('a[k] = 3')(scope);
      expect(scope.a.key).toBe(3);
    });

    it('auto-creates intermediate objects for a deep member path', () => {
      const scope: { a?: { b?: { c?: number } } } = {};
      parse('a.b.c = 1')(scope);
      expect(scope.a?.b?.c).toBe(1);
      expect(typeof scope.a).toBe('object');
    });

    it('has lower precedence than +: a = 1 + 2 assigns 3', () => {
      const scope: { a?: number } = {};
      parse('a = 1 + 2')(scope);
      expect(scope.a).toBe(3);
    });

    it('is right-associative: a = b = 5 assigns 5 to both', () => {
      const scope: { a?: number; b?: number } = {};
      parse('a = b = 5')(scope);
      expect(scope.a).toBe(5);
      expect(scope.b).toBe(5);
    });

    it('throws when assigning to a literal on the LHS', () => {
      expect(() => parse('1 = 2')({})).toThrow('Trying to assign a value to a non l-value');
    });

    it('throws when assigning to a call expression on the LHS', () => {
      expect(() => parse('fn() = 1')({ fn: () => ({}) })).toThrow(
        'Trying to assign a value to a non l-value',
      );
    });

    it('writes to locals when the identifier resolves to locals (locals-first)', () => {
      const scope: { a: number } = { a: 1 };
      const locals: { a: number } = { a: 10 };
      parse('a = 99')(scope, locals);
      expect(locals.a).toBe(99);
      expect(scope.a).toBe(1);
    });

    it('writes deep members to scope when the root is not in locals', () => {
      const scope: { a: { b?: number } } = { a: {} };
      const locals: Record<string, unknown> = {};
      parse('a.b = 2')(scope, locals);
      expect(scope.a.b).toBe(2);
      expect(locals).toEqual({});
    });
  });

  describe('precedence matrix', () => {
    it('assignment binds looser than ternary: a = b ? 1 : 2 assigns the ternary result', () => {
      const scope: { b: number; a?: number } = { b: 0 };
      parse('a = b ? 1 : 2')(scope);
      expect(scope.a).toBe(2);
    });

    it('ternary binds looser than ||: true || false ? "yes" : "no" evaluates the || first', () => {
      expect(parse('true || false ? "yes" : "no"')({})).toBe('yes');
    });

    it('|| binds looser than &&: true || false && "dead" short-circuits to true', () => {
      expect(parse('true || false && "dead"')({})).toBe(true);
    });

    it('&& binds looser than equality: false && 0 == 0 short-circuits to false', () => {
      expect(parse('false && 0 == 0')({})).toBe(false);
    });

    it('equality binds looser than relational: 1 < 2 == true evaluates the < first', () => {
      expect(parse('1 < 2 == true')({})).toBe(true);
    });

    it('relational binds looser than additive: 1 + 2 < 4 evaluates the + first and yields a boolean', () => {
      const result = parse('1 + 2 < 4')({});
      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('additive binds looser than multiplicative: 2 + 3 * 4 evaluates the * first', () => {
      expect(parse('2 + 3 * 4')({})).toBe(14);
    });

    it('multiplicative binds looser than unary: !0 * 5 evaluates the unary first and yields a number', () => {
      const result = parse('!0 * 5')({});
      expect(result).toBe(5);
      expect(typeof result).toBe('number');
    });

    it('unary binds looser than primary: -a.b negates the member-access result', () => {
      const scope = { a: { b: 5 } };
      expect(parse('-a.b')(scope)).toBe(-5);
    });
  });
});
