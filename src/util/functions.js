/**
 * @description a list pf utility pure functions with no side effects and Lodash Library
 * */
const _ = require('lodash');

function Lib() {}

_.mixin({
    isArrayLike: function(obj) {
        if (_.isNull(obj) || _.isUndefined(obj)) {
            return false;
        }
        let length = obj.length;
        return length === 0 ||
            (_.isNumber(length) && length > 0 && (length - 1) in obj);
    }
});

Lib.prototype.Lo = _; //extending Lodash Mgo Style :)

Lib.prototype.noop = function () {};

Lib.prototype.isNumber = function (num) {
    return typeof num === 'number';
};

Lib.prototype.areEqual = function (newValue, oldValue, valueEq) {
    if (valueEq) {
        return _.isEqual(newValue, oldValue);//recursive
    } else { //both NaN then they are equal
        return newValue === oldValue || (this.isNumber(newValue) && this.isNumber(oldValue) && isNaN(newValue) && isNaN(oldValue));
    }
};

Lib.prototype.isNull = function (value) {
    return value === null;
};




//TODO forEach

//TODO forEachRight

//TODO isObject

//TODO isArray

//TODO isEqual

//TODO cloneDeep

//TODO isArrayLike from the mixin

//TODO isString

module.exports = Lib;