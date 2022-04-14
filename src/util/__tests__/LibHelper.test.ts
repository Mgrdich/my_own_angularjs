import LibHelper from 'util/LibHelper';

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

  describe('Loops and forEach-es', () => {
    const emptyArray: unknown[] = [];
    const emptyObject = {};

    const dataCheckArray = ['string', 1, null, undefined];
    const dataObject = {
      a: 1,
      b: 'string',
      c: function () {
        return 'functionCall';
      },
    };

    it('should test empty case of object iteration for baseEach', () => {
      const mockFn = jest.fn();
      LibHelper.baseEach(emptyObject, mockFn);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should test empty case of array iteration for arrayEach', () => {
      const mockFn = jest.fn();
      LibHelper.arrayEach(emptyArray, mockFn);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should test data based case of object iteration for baseEach', () => {
      const mockFn = jest.fn();
      LibHelper.baseEach(dataObject, mockFn);
      expect(mockFn).toHaveBeenCalledTimes(Object.keys(dataObject).length);
      // TODO write tests for parameter
    });

    it('should test data based case of object iteration for arrayEach', () => {
      const mockFn = jest.fn();
      LibHelper.arrayEach(dataCheckArray, mockFn);
      expect(mockFn).toHaveBeenCalledTimes(dataCheckArray.length);
      // TODO write tests for parameter
    });

    it('should check the short circuit optimization option in the baseEach', () => {});

    it('should check the short circuit optimization option in the arrayEach', () => {});
  });
});
