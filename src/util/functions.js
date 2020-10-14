/**
 * @description a list pf utility pure functions with no side effects and Lodash Library
 * */
const _ = require('lodash');

function Lib() {

}

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

module.exports = Lib;