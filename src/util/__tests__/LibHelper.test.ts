import LibHelper from 'util/LibHelper';
import { Dictionary } from 'types';

describe('LibHelper', () => {
  it('should test isNumber Function', () => {
    expect(LibHelper.isNumber(4)).toBeTruthy();
    expect(LibHelper.isNumber(-1)).toBeTruthy();
    expect(LibHelper.isNumber('4')).toBeFalsy();
    expect(LibHelper.isNumber(function () {})).toBeFalsy();
    expect(LibHelper.isNumber(null)).toBeFalsy();
    expect(LibHelper.isNumber(undefined)).toBeFalsy();
    expect(LibHelper.isNumber(true)).toBeFalsy();
    expect(LibHelper.isNumber(false)).toBeFalsy();
  });

  it('should test isString Function', () => {
    expect(LibHelper.isString('STRING')).toBeTruthy();
    expect(LibHelper.isString(4)).toBeFalsy();
    expect(LibHelper.isString(-1)).toBeFalsy();
    expect(LibHelper.isString(function () {})).toBeFalsy();
    expect(LibHelper.isString(null)).toBeFalsy();
    expect(LibHelper.isString(undefined)).toBeFalsy();
    expect(LibHelper.isString(true)).toBeFalsy();
    expect(LibHelper.isString(false)).toBeFalsy();
    expect(LibHelper.isString({})).toBeFalsy();
  });

  it('should test isFunction Function', () => {
    expect(LibHelper.isFunction(function () {})).toBeTruthy();
    expect(LibHelper.isFunction(new Function())).toBeTruthy();
    expect(LibHelper.isFunction(4)).toBeFalsy();
    expect(LibHelper.isFunction(-1)).toBeFalsy();
    expect(LibHelper.isFunction('4')).toBeFalsy();
    expect(LibHelper.isFunction(null)).toBeFalsy();
    expect(LibHelper.isFunction(undefined)).toBeFalsy();
    expect(LibHelper.isFunction(true)).toBeFalsy();
    expect(LibHelper.isFunction(false)).toBeFalsy();
    expect(LibHelper.isFunction({})).toBeFalsy();
  });

  it('should test isNull Function', () => {
    expect(LibHelper.isNull(null)).toBeTruthy();
    expect(LibHelper.isNull(4)).toBeFalsy();
    expect(LibHelper.isNull(-1)).toBeFalsy();
    expect(LibHelper.isNull('4')).toBeFalsy();
    expect(LibHelper.isNull(function () {})).toBeFalsy();
    expect(LibHelper.isNull(undefined)).toBeFalsy();
    expect(LibHelper.isNull(true)).toBeFalsy();
    expect(LibHelper.isNull(false)).toBeFalsy();
    expect(LibHelper.isNull({})).toBeFalsy();
  });

  it('should test isObject Function', () => {
    expect(LibHelper.isObject({})).toBeTruthy();
    expect(LibHelper.isObject(new Object({}))).toBeTruthy();
    expect(LibHelper.isObject(null)).toBeFalsy();
    expect(LibHelper.isObject(4)).toBeFalsy();
    expect(LibHelper.isObject(-1)).toBeFalsy();
    expect(LibHelper.isObject('4')).toBeFalsy();
    expect(LibHelper.isObject(function () {})).toBeFalsy();
    expect(LibHelper.isObject(undefined)).toBeFalsy();
    expect(LibHelper.isObject(true)).toBeFalsy();
    expect(LibHelper.isObject(false)).toBeFalsy();
  });

  it('should test isDefined Function', () => {
    expect(LibHelper.isDefined(null)).toBeTruthy();
    expect(LibHelper.isDefined(4)).toBeTruthy();
    expect(LibHelper.isDefined(-1)).toBeTruthy();
    expect(LibHelper.isDefined('4')).toBeTruthy();
    expect(LibHelper.isDefined(function () {})).toBeTruthy();
    expect(LibHelper.isDefined(undefined)).toBeFalsy();
    expect(LibHelper.isDefined(true)).toBeTruthy();
    expect(LibHelper.isDefined(false)).toBeTruthy();
    expect(LibHelper.isDefined({})).toBeTruthy();
  });

  it('should test isUndefined Function', () => {
    expect(LibHelper.isUndefined(undefined)).toBeTruthy();
    expect(LibHelper.isUndefined(null)).toBeFalsy();
    expect(LibHelper.isUndefined(4)).toBeFalsy();
    expect(LibHelper.isUndefined(-1)).toBeFalsy();
    expect(LibHelper.isUndefined('4')).toBeFalsy();
    expect(LibHelper.isUndefined(function () {})).toBeFalsy();
    expect(LibHelper.isUndefined(true)).toBeFalsy();
    expect(LibHelper.isUndefined(false)).toBeFalsy();
    expect(LibHelper.isUndefined({})).toBeFalsy();
  });

  it('should test isRegExp Function', () => {
    expect(LibHelper.isRegExp(new RegExp(''))).toBeTruthy();
    expect(LibHelper.isRegExp(/name/i)).toBeTruthy();
    expect(LibHelper.isRegExp(undefined)).toBeFalsy();
    expect(LibHelper.isRegExp(null)).toBeFalsy();
    expect(LibHelper.isRegExp(4)).toBeFalsy();
    expect(LibHelper.isRegExp(-1)).toBeFalsy();
    expect(LibHelper.isRegExp('4')).toBeFalsy();
    expect(LibHelper.isRegExp(function () {})).toBeFalsy();
    expect(LibHelper.isRegExp(true)).toBeFalsy();
    expect(LibHelper.isRegExp(false)).toBeFalsy();
    expect(LibHelper.isRegExp({})).toBeFalsy();
  });

  it('should test isDate Function', () => {
    expect(LibHelper.isDate(new Date())).toBeTruthy();
    expect(LibHelper.isDate(undefined)).toBeFalsy();
    expect(LibHelper.isDate(null)).toBeFalsy();
    expect(LibHelper.isDate(4)).toBeFalsy();
    expect(LibHelper.isDate(-1)).toBeFalsy();
    expect(LibHelper.isDate('4')).toBeFalsy();
    expect(LibHelper.isDate(function () {})).toBeFalsy();
    expect(LibHelper.isDate(true)).toBeFalsy();
    expect(LibHelper.isDate(false)).toBeFalsy();
    expect(LibHelper.isDate({})).toBeFalsy();
  });

  it('should test getNoopFunction', function () {
    const fn = LibHelper.getNoopFunction();
    expect(LibHelper.isFunction(fn)).toBeTruthy();

    const fn1 = LibHelper.getNoopFunction();
    expect(LibHelper.isFunction(fn1)).toBeTruthy();

    expect(fn).not.toEqual(fn1);
  });

  it('should test nativeCeil gives the same result as Math.ceil', () => {
    expect(LibHelper.nativeCeil(0)).toBe(Math.ceil(0));
    expect(LibHelper.nativeCeil(3.4)).toBe(Math.ceil(3.4));
    expect(LibHelper.nativeCeil(-3.4)).toBe(Math.ceil(-3.4));
    expect(LibHelper.nativeCeil(3.7)).toBe(Math.ceil(3.7));
    expect(LibHelper.nativeCeil(-3.7)).toBe(Math.ceil(-3.7));
  });

  it('should test nativeMax gives the same result as Math.Max', () => {
    expect(LibHelper.nativeMax(0, 2, 3)).toBe(Math.max(0, 2, 3));
    expect(LibHelper.nativeMax(3.4, -1, 2, 4, 5)).toBe(Math.max(3.4, -1, 2, 4, 5));
  });

  it('should test the range array with only one parameter', () => {
    expect(LibHelper.range(5)).toEqual([0, 1, 2, 3, 4]);
    expect(LibHelper.range(-5)).toEqual([0, -1, -2, -3, -4]);
    expect(LibHelper.range(1, 5)).toEqual([1, 2, 3, 4]);
    expect(LibHelper.range(0, 20, 5)).toEqual([0, 5, 10, 15]);
    expect(LibHelper.range(0, -4, -1)).toEqual([0, -1, -2, -3]);
    expect(LibHelper.range(1, 4, 0)).toEqual([1, 1, 1]);
    expect(LibHelper.range(0)).toEqual([]);
  });

  describe('Loops and forEach-es', () => {
    const emptyArray: unknown[] = [];
    const emptyObject = {};

    const dataCheckArray = ['string', 1, null, undefined, 'something else'];
    const dataObject: Dictionary = {
      a: 1,
      b: 'string',
      c: function () {
        return 'functionCall';
      },
      d: undefined,
    };

    it('should test empty case of object iteration for foreach', () => {
      const mockFn = jest.fn();
      LibHelper.forEach(emptyObject, mockFn);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should test empty case of array iteration for arrayEach', () => {
      const mockFn = jest.fn();
      LibHelper.forEach(emptyArray, mockFn);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should test data based case of object iteration for baseEach', () => {
      const mockFn = jest.fn();
      LibHelper.forEach(dataObject, mockFn);
      const objectKeys: string[] = Object.keys(dataObject);
      expect(mockFn).toHaveBeenCalledTimes(objectKeys.length);
      for (let i = 0; i < objectKeys.length; i++) {
        expect(mockFn).toHaveBeenNthCalledWith(i + 1, dataObject[objectKeys[i]], objectKeys[i], dataObject);
      }
    });

    it('should test data based case of object iteration for arrayEach', () => {
      const mockFn = jest.fn();
      LibHelper.forEach(dataCheckArray, mockFn);
      expect(mockFn).toHaveBeenCalledTimes(dataCheckArray.length);
      for (let i = 0; i < dataCheckArray.length; i++) {
        expect(mockFn).toHaveBeenNthCalledWith(i + 1, dataCheckArray[i], i, dataCheckArray);
      }
    });

    it('should check the short circuit optimization option in the baseEach', () => {
      const mockFn = jest.fn();
      mockFn.mockReturnValueOnce(true).mockReturnValueOnce(null).mockReturnValueOnce(false);
      LibHelper.forEach(dataCheckArray, mockFn);
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should check the short circuit optimization option in the arrayEach', () => {
      const mockFn = jest.fn();
      mockFn.mockReturnValueOnce(true).mockReturnValueOnce('').mockReturnValueOnce(false);
      LibHelper.forEach(dataCheckArray, mockFn);
      expect(mockFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('isEqual', function () {
    it('should return true if same object', function () {
      const o = {};
      expect(LibHelper.isEqual(o, o)).toEqual(true);
      expect(LibHelper.isEqual(o, {})).toEqual(true);
      expect(LibHelper.isEqual(1, '1')).toEqual(false);
      expect(LibHelper.isEqual(1, '2')).toEqual(false);
    });

    it('should recurse into object', function () {
      expect(LibHelper.isEqual({}, {})).toEqual(true);
      expect(LibHelper.isEqual({ name: 'misko' }, { name: 'misko' })).toEqual(true);
      expect(LibHelper.isEqual({ name: 'misko', age: 1 }, { name: 'misko' })).toEqual(false);
      expect(LibHelper.isEqual({ name: 'misko' }, { name: 'misko', age: 1 })).toEqual(false);
      expect(LibHelper.isEqual({ name: 'misko' }, { name: 'adam' })).toEqual(false);
      expect(LibHelper.isEqual(['misko'], ['misko'])).toEqual(true);
      expect(LibHelper.isEqual(['misko'], ['adam'])).toEqual(false);
      expect(LibHelper.isEqual(['misko'], ['misko', 'adam'])).toEqual(false);
    });

    it('should ignore undefined member variables during comparison', function () {
      const obj1 = { name: 'misko' };

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const obj2 = { name: 'misko', undefinedVar: undefined };

      expect(LibHelper.isEqual(obj1, obj2)).toBe(true);
      expect(LibHelper.isEqual(obj2, obj1)).toBe(true);
    });

    it('should ignore $ member variables', function () {
      expect(LibHelper.isEqual({ name: 'misko', $id: 1 }, { name: 'misko', $id: 2 })).toEqual(true);
      expect(LibHelper.isEqual({ name: 'misko' }, { name: 'misko', $id: 2 })).toEqual(true);
      expect(LibHelper.isEqual({ name: 'misko', $id: 1 }, { name: 'misko' })).toEqual(true);
    });

    it('should ignore functions', function () {
      expect(LibHelper.isEqual({ func: function () {} }, { bar: function () {} })).toEqual(true);
    });

    it('should work well with nulls', function () {
      expect(LibHelper.isEqual(null, '123')).toBe(false);
      expect(LibHelper.isEqual('123', null)).toBe(false);

      const obj = { foo: 'bar' };
      expect(LibHelper.isEqual(null, obj)).toBe(false);
      expect(LibHelper.isEqual(obj, null)).toBe(false);

      expect(LibHelper.isEqual(null, null)).toBe(true);
    });

    it('should work well with undefined', function () {
      expect(LibHelper.isEqual(undefined, '123')).toBe(false);
      expect(LibHelper.isEqual('123', undefined)).toBe(false);

      const obj = { foo: 'bar' };
      expect(LibHelper.isEqual(undefined, obj)).toBe(false);
      expect(LibHelper.isEqual(obj, undefined)).toBe(false);

      expect(LibHelper.isEqual(undefined, undefined)).toBe(true);
    });

    it('should treat two NaNs as equal', function () {
      expect(LibHelper.isEqual(NaN, NaN)).toBe(true);
    });

    // it('should compare Scope instances only by identity', inject(function($rootScope) {
    //   let scope1 = $rootScope.$new(),
    //     scope2 = $rootScope.$new();
    //
    //   expect(LibHelper.isEqual(scope1, scope1)).toBe(true);
    //   expect(LibHelper.isEqual(scope1, scope2)).toBe(false);
    //   expect(LibHelper.isEqual($rootScope, scope1)).toBe(false);
    //   expect(LibHelper.isEqual(undefined, scope1)).toBe(false);
    // }));

    it('should compare dates', function () {
      expect(LibHelper.isEqual(new Date(0), new Date(0))).toBe(true);
      expect(LibHelper.isEqual(new Date(0), new Date(1))).toBe(false);
      expect(LibHelper.isEqual(new Date(0), 0)).toBe(false);
      expect(LibHelper.isEqual(0, new Date(0))).toBe(false);

      expect(LibHelper.isEqual(new Date(undefined), new Date(undefined))).toBe(true);
      expect(LibHelper.isEqual(new Date(undefined), new Date(0))).toBe(false);
      expect(LibHelper.isEqual(new Date(undefined), new Date(null))).toBe(false);
      expect(LibHelper.isEqual(new Date(undefined), new Date('wrong'))).toBe(true);
      expect(LibHelper.isEqual(new Date(), /abc/)).toBe(false);
    });

    it('should correctly test for keys that are present on Object.prototype', function () {
      expect(LibHelper.isEqual({}, { hasOwnProperty: 1 })).toBe(false);
      expect(LibHelper.isEqual({}, { toString: null })).toBe(false);
    });

    it('should compare regular expressions', function () {
      expect(LibHelper.isEqual(/abc/, /abc/)).toBe(true);
      expect(LibHelper.isEqual(/abc/i, new RegExp('abc', 'i'))).toBe(true);
      expect(LibHelper.isEqual(new RegExp('abc', 'i'), new RegExp('abc', 'i'))).toBe(true);
      expect(LibHelper.isEqual(new RegExp('abc', 'i'), new RegExp('abc'))).toBe(false);
      expect(LibHelper.isEqual(/abc/i, /abc/)).toBe(false);
      expect(LibHelper.isEqual(/abc/, /def/)).toBe(false);
      expect(LibHelper.isEqual(/^abc/, /abc/)).toBe(false);
      expect(LibHelper.isEqual(/^abc/, '/^abc/')).toBe(false);
      expect(LibHelper.isEqual(/abc/, new Date())).toBe(false);
    });

    it('should return false when comparing an object and an array', function () {
      expect(LibHelper.isEqual({}, [])).toBe(false);
      expect(LibHelper.isEqual([], {})).toBe(false);
    });

    it('should return false when comparing an object and a RegExp', function () {
      expect(LibHelper.isEqual({}, /abc/)).toBe(false);
      expect(LibHelper.isEqual({}, new RegExp('abc', 'i'))).toBe(false);
    });

    it('should return false when comparing an object and a Date', function () {
      expect(LibHelper.isEqual({}, new Date())).toBe(false);
    });

    // it('should safely compare objects with no prototype parent', function() {
    //   let o1 = extend(Object.create(null), {
    //     a: 1, b: 2, c: 3
    //   });
    //   let o2 = extend(Object.create(null), {
    //     a: 1, b: 2, c: 3
    //   });
    //   expect(LibHelper.isEqual(o1, o2)).toBe(true);
    //   o2.c = 2;
    //   expect(LibHelper.isEqual(o1, o2)).toBe(false);
    // });

    it('should safely compare objects which shadow Object.prototype.hasOwnProperty', function () {
      const o1 = {
        hasOwnProperty: true,
        a: 1,
        b: 2,
        c: 3,
      };
      const o2 = {
        hasOwnProperty: true,
        a: 1,
        b: 2,
        c: 3,
      };
      expect(LibHelper.isEqual(o1, o2)).toBe(true);

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      o1.hasOwnProperty = function () {};
      expect(LibHelper.isEqual(o1, o2)).toBe(false);
    });
  });
});
