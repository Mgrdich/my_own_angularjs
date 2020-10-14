/**
 * @description a list pf utility pure functions with no side effects
 * */
const _ = require('lodash');

function Function() {

}

Function.prototype.noop = function () {};

Function.prototype.areEqual = function (newValue, oldValue, valueEq) {
    if (valueEq) {
        return _.isEqual(newValue, oldValue);//recursive
    } else {
        return newValue === oldValue;
    }
};

module.exports = Function;