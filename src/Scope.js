const _ = require('lodash');
//test
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
    _.forEach(this.$$watchers, function (watcher) {
        watcher.listenerFn();
    });
};


module.exports = {Scope};