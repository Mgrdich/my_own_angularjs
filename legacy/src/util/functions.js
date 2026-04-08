/**
 * @description a list pf utility pure functions with no side effects and Lodash Library
 * */
import _ from 'lodash';

function Lib() {}

_.mixin({
  isArrayLike: function (obj) {
    if (_.isNull(obj) || _.isUndefined(obj)) {
      return false;
    }
    let length = obj.length;
    return length === 0 || (_.isNumber(length) && length > 0 && length - 1 in obj);
  },
});

Lib.prototype.Lo = _;

Lib.prototype.noop = function () {};

/**
 * @description check whether parameter is a number
 * */
Lib.prototype.isNumber = function (num) {
  return typeof num === 'number';
};

/**
 * @description check whether two values are equal
 * */
Lib.prototype.areEqual = function (newValue, oldValue, valueEq) {
  if (valueEq) {
    return _.isEqual(newValue, oldValue); //recursive
  } else {
    //both NaN then they are equal
    return (
      newValue === oldValue ||
      (this.isNumber(newValue) && this.isNumber(oldValue) && isNaN(newValue) && isNaN(oldValue))
    );
  }
};

/**
 * @description check whether parameter is a null
 * */
Lib.prototype.isNull = function (value) {
  return value === null;
};

/**
 * @description check whether parameter is an array
 * */
Lib.prototype.isArray = function (arr) {
  return Array.isArray(arr);
};

/**
 * @description check whether parameter is a string
 * */
Lib.prototype.isString = function (str) {
  return typeof str === 'string';
};

//TODO forEach

//TODO forEachRight

//TODO isObject

//TODO isEqual

//TODO cloneDeep

//TODO isArrayLike from the mixin

//TODO constant easy

export default Lib;
