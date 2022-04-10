import LibHelper from 'util/LibHelper';

describe('LibHelper', () => {
  it('should test isNumber Function', function () {
    expect(LibHelper.isNumber(4)).toBeTruthy();
    expect(LibHelper.isNumber(-1)).toBeTruthy();
    expect(LibHelper.isNumber('4')).toBeFalsy();
    expect(LibHelper.isNumber(function () {})).toBeFalsy();
    expect(LibHelper.isNumber(null)).toBeFalsy();
    expect(LibHelper.isNumber(undefined)).toBeFalsy();
    expect(LibHelper.isNumber(true)).toBeFalsy();
    expect(LibHelper.isNumber(false)).toBeFalsy();
  });

  it('should test isString Function', function () {
    expect(LibHelper.isString('STRING')).toBeTruthy();
    expect(LibHelper.isString(4)).toBeFalsy();
    expect(LibHelper.isString(-1)).toBeFalsy();
    expect(LibHelper.isString(function () {})).toBeFalsy();
    expect(LibHelper.isString(null)).toBeFalsy();
    expect(LibHelper.isString(undefined)).toBeFalsy();
    expect(LibHelper.isString(true)).toBeFalsy();
    expect(LibHelper.isString(false)).toBeFalsy();
  });

  it('should test isFunction Function', function () {
    expect(LibHelper.isFunction(function () {})).toBeTruthy();
    expect(LibHelper.isFunction(new Function())).toBeTruthy();
    expect(LibHelper.isFunction(4)).toBeFalsy();
    expect(LibHelper.isFunction(-1)).toBeFalsy();
    expect(LibHelper.isFunction('4')).toBeFalsy();
    expect(LibHelper.isFunction(null)).toBeFalsy();
    expect(LibHelper.isFunction(undefined)).toBeFalsy();
    expect(LibHelper.isFunction(true)).toBeFalsy();
    expect(LibHelper.isFunction(false)).toBeFalsy();
  });

  it('should test isNull Function', function () {
    expect(LibHelper.isNull(null)).toBeTruthy();
    expect(LibHelper.isNull(4)).toBeFalsy();
    expect(LibHelper.isNull(-1)).toBeFalsy();
    expect(LibHelper.isNull('4')).toBeFalsy();
    expect(LibHelper.isNull(function () {})).toBeFalsy();
    expect(LibHelper.isNull(undefined)).toBeFalsy();
    expect(LibHelper.isNull(true)).toBeFalsy();
    expect(LibHelper.isNull(false)).toBeFalsy();
  });
});
