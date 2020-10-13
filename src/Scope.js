const _ = require('lodash');
const Function = require("../src/util/functions");


const def = new Function();



function Scope() {
    this.$$watchers = [];
}
/**
 * @description public functions
 * */
Scope.prototype.$watch = function (watchFn, listenerFn) {

    let watcher = {
        watchFn: watchFn, // A watch function, which specifies the piece of data you’re interested in.
        listenerFn: listenerFn, // A listener function which will be called whenever that data changes
        last:def.noop // reference function equal only to itself
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
            watcher.listenerFn(newValue,oldValue,self);
        }
    });
};




/**
 * @description private functions
 * */


module.exports = Scope;