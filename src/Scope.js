const _ = require('lodash');

function Scope() {
    this.$$watchers = [];
}

/**
 * @description public functions
 * */

Scope.prototype.$watch = function (watchFn, listenerFn) {

    let watcher = {
        watchFn: watchFn, // A watch function, which specifies the piece of data you’re interested in.
        listenerFn: listenerFn || function () {}, // A listener function which will be called whenever that data changes no from lib reference thingy
        last:initWatchVal // reference function equal only to itself
    };

    this.$$watchers.push(watcher);

};

Scope.prototype.$digest = function () {
    let newValue,oldValue;
    let self = this;
    _.forEach(this.$$watchers, function(watcher) {
        newValue = watcher.watchFn(self); //passing the scope itself
        oldValue = watcher.last;
        if (oldValue !== newValue) {
            watcher.last = newValue;
            watcher.listenerFn(newValue, (oldValue === initWatchVal) ? newValue : oldValue, self);
        }
    });
};




/**
 * @description private functions
 * */

/**
 * @description first time undefined equality not to be satisfied
 * */
function initWatchVal () {}


module.exports = Scope;