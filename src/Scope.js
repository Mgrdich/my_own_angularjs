const _ = require('lodash');

function Scope() {
    this.$$watchers = [];
}

Scope.prototype.$watch = function (watchFn, listenerFn) {

    let watcher = {
        watchFn: watchFn, //A watch function, which specifies the piece of data you’re interested in.
        listenerFn: listenerFn //A listener function which will be called whenever that data changes
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