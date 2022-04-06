// eslint-disable-next-line @typescript-eslint/no-var-requires
const parse = require('js_legacy/parse');

describe('Parse', function () {
  it('can parse an integer', function () {
    let fn = parse('42');
    expect(fn).toBeDefined();
    expect(fn()).toBe(42);
  });

  it('parse floating numbers', function () {
    let fn = parse('4.2');
    expect(fn()).toBe(4.2);
  });

  it('parse floating numbers without integer part', function () {
    let fn = parse('.2');
    expect(fn()).toBe(0.2);
  });

  it('parsing scientific notations', function () {
    let fn = parse('42e3');
    expect(fn()).toBe(42000);
  });

  it('parsing scientific notations starts with point', function () {
    let fn = parse('.42e3');
    expect(fn()).toBe(420);
  });

  it('parsing scientific notations starts with negative exponents', function () {
    let fn = parse('4200e-2');
    expect(fn()).toBe(42);
  });

  it('can parse scientific notation with the + sign', function () {
    let fn = parse('.42e+2');
    expect(fn()).toBe(42);
  });

  it('can parse upper case scientific notation', function () {
    let fn = parse('.42E2');
    expect(fn()).toBe(42);
  });

  it('will not parse invalid scientific notation', function () {
    expect(function () {
      parse('42e-');
    }).toThrow();
    expect(function () {
      parse('42e-a');
    }).toThrow();
  });

  it('can parse string in a double quote', function () {
    let fn = parse('"abc"');
    expect(fn()).toBe('abc');
  });

  it('can parse string in a single quote', function () {
    let fn = parse("'abc'");
    expect(fn()).toBe('abc');
  });

  it('will not parse a string with mismatching quotes', function () {
    //first should equal the last
    expect(function () {
      parse('"abc\'');
    }).toThrow();
  });

  it('can parse a string with a single quote inside', function () {
    let fn = parse("'a\\'b'"); //with one backslash is escaping the second slash
    expect(fn()).toEqual("a'b"); //with third is escaping the double quote
    expect(fn()).toEqual("a'b"); //with third is escaping the double quote
  });

  it('can parse a string with double quotes inside', function () {
    let fn = parse('"a\\"b"'); //with one backslash is escaping the second slash
    expect(fn()).toEqual('a"b'); //with third is escaping the double quote
    expect(fn()).toEqual('a"b');
  });

  it('can parse a string with unicode escapes', function () {
    let fn = parse('"\\u00A0"');
    expect(fn()).toEqual('\u00A0');
  });

  it('will not parse a string with invalid unicode escapes', function () {
    expect(function () {
      parse('"\\u00TO"');
    });
  });

  it('will parse null', function () {
    let fn = parse('null');
    expect(fn()).toBe(null);
  });

  it('will parse true', function () {
    let fn = parse('true');
    expect(fn()).toBe(true);
  });

  it('will parse false', function () {
    let fn = parse('false');
    expect(fn()).toBe(false);
  });

  it('will ignore whitespace', function () {
    let fn = parse(' \n42');
    expect(fn()).toEqual(42);
  });

  it('will parse empty array', function () {
    let fn = parse('[]');
    expect(fn()).toEqual([]);
  });

  it('will parse a non empty array', function () {
    let fn = parse('[1,"two",[3],true]');
    expect(fn()).toEqual([1, 'two', [3], true]);
  });

  it('will parse array with trailing commas', function () {
    let fn = parse('[1,2,3,]');
    expect(fn()).toEqual([1, 2, 3]);
  });

  it('will parse empty object', function () {
    let fn = parse('{}');
    expect(fn()).toEqual({});
  });

  it('will parse an object with identifier keys', function () {
    let fn = parse('{a: 1, b: [2, 3], c: {d: 4}}');
    expect(fn()).toEqual({ a: 1, b: [2, 3], c: { d: 4 } });
  });

  it('looks up attribute in the scope', function () {
    let fn = parse('aKey');
    expect(fn({ aKey: 42 })).toBe(42); //object as a parameter
    expect(fn({})).toBeUndefined();
  });

  it('returns undefined when looking attribute and is undefined', function () {
    let fn = parse('aKey');
    expect(fn({})).toBeUndefined();
    expect(fn()).toBeUndefined();
  });

  it('will parse this', function () {
    let fn = parse('this');
    let scope = {};
    expect(fn(scope)).toBe(scope);
    expect(fn()).toBeUndefined();
  });

  it('should looks up 2-part identifier path from the scope', function () {
    let fn = parse('aKey.anotherKey');
    expect(fn({ aKey: { anotherKey: 42 } })).toBe(42);
    expect(fn({ aKey: {} })).toBeUndefined(); //we expect the expression to reach down or return undefined if not found
    expect(fn({})).toBeUndefined();
  });

  it('should look a member from object parser itself', function () {
    let fn = parse('{aKey:40}.aKey');
    expect(fn()).toBe(40);
  });

  it('looks up 4 part identifier path from the scope', function () {
    /*{
            type: AST.Program,
                body: {
            type: AST.MemberExpression,
                property: {type: AST.Identifier, name: !fourthKey!},
            object: {
                type: AST.MemberExpresion,
                    property: {type: AST.Identifier, name: !thirdKey!},
                object: {
                    type: AST.MemberExpression,
                        property: {type: AST.Identifier, name: !secondKey!},
                    object: {type: AST.Identifier, name: !aKey!}
                }
            }
        }*/
    let fn = parse('aKey.secondKey.thirdKey.fourthKey');
    expect(fn({ aKey: { secondKey: { thirdKey: { fourthKey: 42 } } } })).toBe(42);
    expect(fn({ aKey: { secondKey: { thirdKey: {} } } })).toBeUndefined();
    expect(fn({ aKey: {} })).toBeUndefined();
    expect(fn()).toBeUndefined();
  });

  it('look up in the locals instead of the scope when there is a matching key', function () {
    let fn = parse('aKey');
    let scope = { aKey: 1 };
    let locals = { aKey: 2 };
    expect(fn(scope, locals)).toBe(2);
  });

  it('does not use locals instead of scope when no matching key', function () {
    let fn = parse('aKey');
    let scope = { aKey: 12 };
    let locals = { anotherKey: 2 };
    expect(fn(scope, locals)).toBe(12);
  });

  it('it uses locals instead of scope when the first part matches', function () {
    let fn = parse('aKey.anotherKey');
    let scope = { aKey: { anotherKey: 42 } };
    let locals = { aKey: {} };
    expect(fn(scope, locals)).toBeUndefined();
  });

  it('parses javascript object computed property', function () {
    let fn = parse('aKey["a"]');
    expect(fn({ aKey: { a: 10 } })).toBe(10);
  });

  it('parses javascript array computed property', function () {
    let fn = parse('aKey[1]');
    expect(fn({ aKey: [1, 2, 3] })).toBe(2);
  });

  it('parses a computed access with another key as property', function () {
    let fn = parse('lock[key]');
    expect(fn({ key: 'theKey', lock: { theKey: 42 } })).toBe(42);
  });

  it('!parses computed access with another access as property!', function () {
    let fn = parse('lock[keys["aKey"]]');
    expect(fn({ keys: { aKey: 'theKey' }, lock: { theKey: 42 } })).toBe(42);
  });

  it('parses a function call', function () {
    let fn = parse('aFunction()');
    expect(
      fn({
        aFunction: function () {
          return 42;
        },
      }),
    ).toBe(42);
  });

  it('parses a function call with param', function () {
    let fn = parse('aFunction(42)');
    expect(
      fn({
        aFunction: function (n) {
          return n;
        },
      }),
    ).toBe(42);
  });

  it('parses a function call with different args', function () {
    let fn = parse('aFunction(key)');
    expect(
      fn({
        key: 10,
        aFunction: function (n) {
          return n;
        },
      }),
    ).toBe(10);
  });

  it('should parse a function call with a single argument of a function call', function () {
    let fn = parse('aFunction(argsFn())');
    expect(
      fn({
        argsFn: function () {
          return 40;
        }, //lodash _.constant
        aFunction: function (n) {
          return n;
        },
      }),
    ).toBe(40);
  });

  it('should parse a function call with a single argument of a function call all possible combinations', function () {
    let fn = parse('aFunction(argsFn(),10,n)');
    expect(
      fn({
        n: 3,
        argsFn: function () {
          return 40;
        }, //lodash _.constant
        aFunction: function (a1, a2, a3) {
          return a1 + a2 + a3;
        },
      }),
    ).toBe(53);
  });

  it('method calls and the call context non computed', function () {
    let scope = {
      anObject: {
        n: 10,
        aFunction: function () {
          return this.n;
        },
      },
    };
    let fn = parse('anObject["aFunction"](n)');
    expect(fn(scope)).toBe(10);
  });

  it('method calls and the call context computed', function () {
    let scope = {
      anObject: {
        n: 10,
        aFunction: function () {
          return this.n;
        },
      },
    };
    let fn = parse('anObject.aFunction(n)');
    expect(fn(scope)).toBe(10);
  });

  it('binds a bare functions to the scope', function () {
    let scope = {
      aFunction: function () {
        return this;
      },
    };

    let fn = parse('aFunction()');
    expect(fn(scope)).toBe(scope);
  });

  it('binds a bare function on locals to the locals', function () {
    let scope = {};
    let locals = {
      aFunction: function () {
        return this;
      },
    };
    let fn = parse('aFunction()');
    expect(fn(scope, locals)).toBe(locals);
  });
});
