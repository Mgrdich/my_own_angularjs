const _ = require('lodash');

function Scope() {
    this.$$watchers = [];
}

Scope.prototype.$watch = function (watchFn, listenerFn) {

    let watcher = {
        watchFn: watchFn,
        listenerFn: listenerFn
    };

    this.$$watchers.push(watcher);

};

Scope.prototype.$digest = function () {
    let self = this;
    _.forEach(this.$$watchers, function (watcher) {
        watcher.watchFn(self);
        watcher.listenerFn();
    });
};


module.exports = Scope;