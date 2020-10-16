const Lib = require("../src/util/functions");
const def = new Lib();

function Scope() {
    this.$$watchers = [];
    this.$$lastDirtyWatch = null;
    this.$$asyncQueue = [];
    this.$$applyAsyncQueue = [];
    this.$$postDigestQueue = [];
    this.$$applyAsyncId = null;
    this.$$phase = null;
}

/**
 * @description angular scope functions private functions in angular somewhat not used by functions but with $$ prefix
 * */

Scope.prototype.$watch = function (watchFn, listenerFn, valueEq) {

    let watcher = {
        watchFn: watchFn, // A watch function, which specifies the piece of data you’re interested in.
        listenerFn: listenerFn || function () {}, // A listener function which will be called whenever that data changes no from lib reference thingy,
        valueEq:!!valueEq, //array object watcher
        last:initWatchVal // reference function equal only to itself
    };

    this.$$watchers.push(watcher);
    this.$$lastDirtyWatch = null; //nested watch :)

};

Scope.prototype.$digest = function () {
    let dirty = false;
    let ttl = 10;
    this.$$lastDirtyWatch = null;
    this.$beginPhase("$digest");

    if(this.$$applyAsyncId) { //calling from digest we will cancel pending and flush immediately
        clearTimeout(this.$$applyAsyncId);
        this.$$flushApplyAsync();//draining
    }

    do { //at least to do once
        while (this.$$asyncQueue.length) { //first async queue to be consumed then after the digest is over its digest will get working
            let asyncTask = this.$$asyncQueue.shift();
            asyncTask.scope.$eval(asyncTask.expression);
        }
        dirty = this.$$digestOnce();
        if ((dirty || this.$$asyncQueue.length) && !(ttl--)) { //if the watch keeps scheduling and eval async
            this.$clearPhase();
            throw "10 digest iterations reached";
        }
    } while (dirty || this.$$asyncQueue.length);
    this.$clearPhase();

    while (this.$$postDigestQueue.length) {
        this.$$postDigestQueue.shift()(); //no parameter
    }
};

/**
 * @return {Boolean}
 * */
Scope.prototype.$$digestOnce = function () {
    let newValue,oldValue;
    let dirty = false;
    let self = this;
    def.Lo.forEach(this.$$watchers, function(watcher) {
        newValue = watcher.watchFn(self); //passing the scope itself and getting the return Value
        oldValue = watcher.last;
        if (!def.areEqual(newValue,oldValue,watcher.valueEq)) {
            self.$$lastDirtyWatch = watcher;
            watcher.last = watcher.valueEq ? def.Lo.cloneDeep(newValue) : newValue;//object case
            watcher.listenerFn(newValue, (oldValue === initWatchVal) ? newValue : oldValue, self);
            dirty = true;
        } else if (self.$$lastDirtyWatch === watcher){
            return false; // breaking the loop after the lastDirtyWatcher
        }
    });
    return dirty;
};

Scope.prototype.$eval = function (expr, locals) {
    return expr(this, locals);//passing in the Scope with this
};

Scope.prototype.$apply = function (expr) {
    try {
        this.$beginPhase('$apply');
        return this.$eval(expr);
    } finally {
        this.$clearPhase(); //apply phase
        this.$digest();
    }
};

Scope.prototype.$applyAsync = function(expr) {
    //for handling HTTP responses
    //optimize things that happen in quick succession so they need single digest
    let self = this;
    self.$$applyAsyncQueue.push(function () {
        self.$eval(expr)
    });

    if(self.$$applyAsyncId === null) {
        //Point is we schedule it only once
        self.$$applyAsyncId = setTimeout(function () {
            self.$apply(function () {
                self.$$flushApplyAsync.bind(self);
            });
        });
    }

};

Scope.prototype.$evalAsync = function (expr) {
    //If you call $evalAsync when a digest is already running, your function will be evaluated
    //during that digest. If there is no digest running, one is started.
    let self = this;
    if(!self.$$phase && !self.$$asyncQueue.length) { //second for two evalAsync only work once :)
        setTimeout(function () {
           if(self.$$asyncQueue.length) {
            self.$digest();
           }
        });
    }
    this.$$asyncQueue.push({scope: this, expression: expr});//Scope related to inheritance
};

Scope.prototype.$$flushApplyAsync = function () {
    while (this.$$applyAsyncQueue.length) {
        this.$$applyAsyncQueue.shift()();
    }
    this.$$applyAsyncId = null;
};

Scope.prototype.$beginPhase = function (phase) {
    if (this.$$phase) {
        throw  this.$$phase + ' already in progress';
    }
    this.$$phase = phase;
};

Scope.prototype.$clearPhase = function () {
    this.$$phase = null;
};

Scope.prototype.$$postDigest = function (fn) {
    this.$$postDigestQueue.push(fn);
};


/**
 * @description private functions
 * */

/**
 * @description first time undefined equality not to be satisfied
 * */
function initWatchVal () {}


module.exports = Scope;