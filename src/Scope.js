const _ = require('lodash');

function Scope() {
    this.$$watchers = [];
    this.$$lastDirtyWatch = null;
}

/**
 * @description angular scope functions private functions in angular somewhat not used by functions but with $$ prefix
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
    let dirty = false;
    let ttl = 10;
    this.$$lastDirtyWatch = null;
    do { //at least to do once
        dirty = this.$$digestOnce();
        if(dirty && !(ttl--)) {
            throw "10 digest iterations reached";
        }
    } while (dirty)
};

/**
 * @return {Boolean}
 * */
Scope.prototype.$$digestOnce = function () {
    let newValue,oldValue;
    let dirty = false;
    let self = this;
    _.forEach(this.$$watchers, function(watcher) {
        newValue = watcher.watchFn(self); //passing the scope itself
        oldValue = watcher.last;
        if (oldValue !== newValue) {
            self.$$lastDirtyWatch = watcher;
            watcher.last = newValue;
            watcher.listenerFn(newValue, (oldValue === initWatchVal) ? newValue : oldValue, self);
            dirty = true;
        } else if (self.$$lastDirtyWatch === watcher){
            return false; // breaking the loop after the lastDirtyWatcher
        }
    });
    return dirty;
};



/**
 * @description private functions
 * */

/**
 * @description first time undefined equality not to be satisfied
 * */
function initWatchVal () {}


module.exports = Scope;