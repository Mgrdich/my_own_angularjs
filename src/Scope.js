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

    let self = this;
    let watcher = {
        watchFn: watchFn, // A watch function, which specifies the piece of data you’re interested in.
        listenerFn: listenerFn || function () {
        }, // A listener function which will be called whenever that data changes no from lib reference thingy,
        valueEq: !!valueEq, //array object watcher
        last: initWatchVal // reference function equal only to itself
    };

    this.$$watchers.unshift(watcher); //new watchers are added to the beginning
    this.$$lastDirtyWatch = null; //nested watch :)
    return function () {
        let index = self.$$watchers.indexOf(watcher);
        if (index >= 0) {
            self.$$watchers.splice(index, 1);
            self.$$lastDirtyWatch = null; //cause the rearrangement will change everything
        }
    }

};

Scope.prototype.$digest = function () {
    let dirty = false;
    let ttl = 10;
    this.$$lastDirtyWatch = null;
    this.$beginPhase("$digest");

    if (this.$$applyAsyncId) { //calling from digest we will cancel pending and flush immediately
        clearTimeout(this.$$applyAsyncId);
        this.$$flushApplyAsync();//draining
    }

    do { //at least to do once
        while (this.$$asyncQueue.length) {//first async queue to be consumed then after the digest is over its digest will get working
            try {
                let asyncTask = this.$$asyncQueue.shift();
                asyncTask.scope.$eval(asyncTask.expression);
            } catch (e) {
                console.error(e);
            }
        }
        dirty = this.$$digestOnce();
        if ((dirty || this.$$asyncQueue.length) && !(ttl--)) { //if the watch keeps scheduling and eval async
            this.$clearPhase();
            throw "10 digest iterations reached";
        }
    } while (dirty || this.$$asyncQueue.length);
    this.$clearPhase();

    while (this.$$postDigestQueue.length) {
        try {
            this.$$postDigestQueue.shift()(); //no parameter
        } catch (e) {
            console.error(e);
        }
    }
};

/**
 * @return {Boolean}
 * */
Scope.prototype.$$digestOnce = function () {
    let newValue, oldValue;
    let dirty = false;
    let self = this;
    def.Lo.forEachRight(this.$$watchers, function (watcher) { //so it can keep iterating over the new watchers
        try {
            if (watcher) { //is it iterating over an undefined because Lodash forEachRight checks the lenght of the array during the start
                newValue = watcher.watchFn(self); //passing the scope itself and getting the return Value
                oldValue = watcher.last;
                if (!def.areEqual(newValue, oldValue, watcher.valueEq)) {
                    self.$$lastDirtyWatch = watcher;
                    watcher.last = watcher.valueEq ? def.Lo.cloneDeep(newValue) : newValue;//object case
                    watcher.listenerFn(newValue, (oldValue === initWatchVal) ? newValue : oldValue, self);
                    dirty = true;
                } else if (self.$$lastDirtyWatch === watcher) {
                    return false; // breaking the loop after the lastDirtyWatcher
                }
            }
        } catch (e) {
            console.error(e);
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

Scope.prototype.$applyAsync = function (expr) {
    //for handling HTTP responses
    //optimize things that happen in quick succession so they need single digest
    let self = this;
    self.$$applyAsyncQueue.push(function () {
        self.$eval(expr)
    });

    if (self.$$applyAsyncId === null) {
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
    if (!self.$$phase && !self.$$asyncQueue.length) { //second for two evalAsync only work once :)
        setTimeout(function () {
            if (self.$$asyncQueue.length) {
                self.$digest();
            }
        });
    }
    this.$$asyncQueue.push({scope: this, expression: expr});//Scope related to inheritance
};

Scope.prototype.$$flushApplyAsync = function () {
    while (this.$$applyAsyncQueue.length) {
        try {
            this.$$applyAsyncQueue.shift()();
        } catch (e) {
            console.error(e);
        }
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

Scope.prototype.$watchGroup = function (watchFns, listenerFn) {
    //to defer the listener call to a moment when all watches will have been checked
    let self = this;
    let newValues = new Array(watchFns.length);
    let oldValues = new Array(watchFns.length);
    let changedReactionScheduled = false;
    let firstRun = true;

    if(!watchFns.length) {
        let shouldCall = true;
        self.$evalAsync(function () {
            if(shouldCall) {
                listenerFn(newValues,newValues,self);
            }
        });
        return function () { //if this invoked it will prevent the listener of the eval async to work
            shouldCall = false;
        };
    }

    function watchGroupListener() {
        if (firstRun) {
            firstRun = false;
            listenerFn(newValues, newValues, self);
        } else {
            listenerFn(newValues, oldValues, self);
        }

        changedReactionScheduled = false;
    }


    let destroyFunctions = watchFns.map(function (watchFn, i) {
        return self.$watch(watchFn, function (newValue, oldValue) {
            newValues[i] = newValue;
            oldValues[i] = oldValue;
            if(!changedReactionScheduled){
                changedReactionScheduled = true;
                self.$evalAsync(watchGroupListener); //all the watch listen to work together and once cause of evalAsync edge
            }
        });
    });

    return function () {
      def.Lo._.forEach(destroyFunctions,function (destroyFunction) {
          destroyFunction();
      })
    };
};


/**
 * @description private functions
 * */

/**
 * @description first time undefined equality not to be satisfied
 * */
function initWatchVal() {
}


module.exports = Scope;