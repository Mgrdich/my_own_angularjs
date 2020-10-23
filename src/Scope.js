const Lib = require("../src/util/functions");
const def = new Lib();

function Scope() {
    this.$$watchers = [];
    this.$$lastDirtyWatch = null;
    this.$$asyncQueue = [];
    this.$$applyAsyncQueue = [];
    this.$$postDigestQueue = [];
    this.$$children = [];
    this.$$applyAsyncId = null;
    this.$$phase = null;
    this.$root = this;
}

/**
 * @description angular scope functions private functions in angular somewhat not used by functions but with $$ prefix
 * */

Scope.prototype.$watch = function (watchFn, listenerFn, valueEq) {

     let watcher = {
        watchFn: watchFn, // A watch function, which specifies the piece of data you’re interested in.
        listenerFn: listenerFn || function () {
        }, // A listener function which will be called whenever that data changes no from lib reference thingy,
        valueEq: !!valueEq, //array object watcher
        last: initWatchVal // reference function equal only to itself
    };

    this.$$watchers.unshift(watcher); //new watchers are added to the beginning
    this.$root.$$lastDirtyWatch = null; //nested watch :)
    return  () => {
        let index = this.$$watchers.indexOf(watcher);
        if (index >= 0) {
            this.$$watchers.splice(index, 1);
            this.$root.$$lastDirtyWatch = null; //cause the rearrangement will change everything
        }
    }

};

Scope.prototype.$digest = function () {
    let dirty = false;
    let ttl = 10;
    this.$root.$$lastDirtyWatch = null;
    this.$beginPhase("$digest");

    if (this.$root.$$applyAsyncId) { //calling from digest we will cancel pending and flush immediately
        clearTimeout(this.$root.$$applyAsyncId);
        this.$$flushApplyAsync();//draining
    }

    do { //at least to do once
        while (this.$$asyncQueue.length) { //first async queue to be consumed then after the digest is over its digest will get working
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

Scope.prototype.$new = function (isolated,parent) {
    let child;
    parent  = parent || this; //is the scope whom we push childrens into
    if (isolated) {
        child = new Scope();
        //since isolated Scope is not root it should not be circular referencing it should reference root scope
        child.$root = parent.$root;
        child.$$asyncQueue = parent.$$asyncQueue; //to not get attribute shadowing and block root we want to pick up the root
        child.$$postDigestQueue = parent.$$postDigestQueue; //to not get attribute shadowing and block root we want to pick up the root
        child.$$applyAsyncQueue = parent.$$applyAsyncQueue; //to not get attribute shadowing and block root we want to pick up the root
    } else {
        let ChildScope = function () {};
        ChildScope.prototype = this; //to get to know it is always root
        child = new ChildScope();
    }
    parent.$$children.push(child);
    child.$$watchers = []; //attribute shadowing each has its watchers and should shadows the parent
    child.$$children = []; //attribute shadowing
    child.$parent = parent;
    return child;
};

Scope.prototype.$destroy = function () {
    //as long as it is not the rootscope and has a parent i will also remove the watchers os scope
    if (this.$parent) {
        let siblings = this.$parent.$$children;
        let indexOfThis = siblings.indexOf(this);
        if (indexOfThis >= 0) {
             siblings.splice(indexOfThis,1);
        }
        this.$$watchers = null; //for the current scope digest with no upper inheritance
    }
};

/**
 * @return {Boolean}
 * */
Scope.prototype.$$digestOnce = function () {
    let dirty = false;
    let continueLooping = true;
    this.$$everyScope((scope) => { //check the use case of this arrow function
        let newValue, oldValue;
        def.Lo.forEachRight(scope.$$watchers,  (watcher) => { //so it can keep iterating over the new watchers
            try {
                if (watcher) { //is it iterating over an undefined because Lodash forEachRight checks the lenght of the array during the start
                    newValue = watcher.watchFn(scope); //passing the scope itself and getting the return Value
                    oldValue = watcher.last;
                    if (!def.areEqual(newValue, oldValue, watcher.valueEq)) {
                        this.$root.$$lastDirtyWatch = watcher;
                        watcher.last = watcher.valueEq ? def.Lo.cloneDeep(newValue) : newValue;//object case
                        watcher.listenerFn(newValue, (oldValue === initWatchVal) ? newValue : oldValue, scope);
                        dirty = true;
                    } else if (this.$root.$$lastDirtyWatch === watcher) { //reference  from the rootscope
                        continueLooping = false; //keeps track of the short circuit optimization in all the hierarchy
                        return false; // breaking the loop after the lastDirtyWatcher
                    }
                }
            } catch (e) {
                console.error(e);
            }
        });
        return continueLooping;
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
        this.$root.$digest();
    }
};

Scope.prototype.$applyAsync = function (expr) {
    //for handling HTTP responses
    //optimize things that happen in quick succession so they need single digest
    this.$$applyAsyncQueue.push(() =>{
        this.$eval(expr)
    });

    if (this.$root.$$applyAsyncId === null) {
        //Point is we schedule it only once
        this.$root.$$applyAsyncId = setTimeout(() => {
            this.$apply(() => {
                this.$$flushApplyAsync.bind(this);
            });
        });
    }

};

Scope.prototype.$evalAsync = function (expr) {
    //If you call $evalAsync when a digest is already running, your function will be evaluated
    //during that digest. If there is no digest running, one is started.
    if (!this.$$phase && !this.$$asyncQueue.length) { //second for two evalAsync only work once :)
        setTimeout(() =>{
            if (this.$$asyncQueue.length) {
                this.$root.$digest();
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
    this.$root.$$applyAsyncId = null;
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
    let newValues = new Array(watchFns.length);
    let oldValues = new Array(watchFns.length);
    let changedReactionScheduled = false;
    let firstRun = true;

    if(!watchFns.length) {
        let shouldCall = true;
        this.$evalAsync(() => {
            if(shouldCall) {
                listenerFn(newValues,newValues,this);
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


    let destroyFunctions = watchFns.map((watchFn, i) => {
        return this.$watch(watchFn, (newValue, oldValue) => {
            newValues[i] = newValue;
            oldValues[i] = oldValue;
            if(!changedReactionScheduled){
                changedReactionScheduled = true;
                this.$evalAsync(watchGroupListener); //all the watch listen to work together and once cause of evalAsync edge
            }
        });
    });

    return function () {
      def.Lo._.forEach(destroyFunctions,function (destroyFunction) {
          destroyFunction();
      })
    };
};

Scope.prototype.$$everyScope = function (fn) {
    //it keeps calling itself until no children is empty recursively
    if (fn(this)) { //here it invokes the fn once for current scope
        return this.$$children.every(function (child) {
            return child.$$everyScope(fn); //recursively calling the children and the fn on them
        });
    } else {
        return false;
    }
};

/**
 * @description a more moderate watch that uses simple
 * techniques to check whether array or an object
 * been changed without recursive calling
 * */
Scope.prototype.$watchCollection = function (watchFn,listenerFn) {
    let newValue; //local variables to store values to trigger change
    let oldValue; //local variables to store values to trigger change

    // indicate whether the watch function should execute the triggers or not
    //  local always will get increase never same value maybe that is way
    //  they did it with no short circuit return
    let changeCount = 0;

    let oldLength; //storing the oldValue to avoid one loop and gets

    let veryOldValue;
    let trackVeryOldValue = (listenerFn.length > 1);
    let firstRun = true;

    let internalWatchFn = function (scope) {
        newValue = watchFn(scope);
        let newLength;

        if (def.Lo.isObject(newValue)) {
            if (def.Lo.isArrayLike(newValue)) { //considers array like if its not a function and has a length
                if(!def.Lo.isArray(oldValue)){ //if the previous is not array so it is changed
                    changeCount++;
                    oldValue = [];
                }

                if(newValue.length !== oldValue.length)  {
                    changeCount++;
                    oldValue.length = newValue.length;
                }

                def.Lo.forEach(newValue,function (newItem,index) {
                let bothNaN = def.Lo.isNaN(newItem) && def.Lo.isNaN(oldValue[index]);
                    if(!bothNaN && newItem !== oldValue[index]) { //both are non not to be considered a change
                        changeCount++;
                        oldValue[index] = newItem;
                    }
                });
            } else {
                if(!def.Lo.isObject(oldValue) || def.Lo.isArrayLike(oldValue)) {
                    changeCount++;
                    oldValue = {};
                    oldLength = 0;
                }
                newLength = 0;
                def.Lo.forOwn(newValue,function (newItem,key) {
                    newLength++;
                    if(oldValue.hasOwnProperty(key)){
                        let bothNaN = def.Lo.isNaN(newItem) && def.Lo.isNaN(oldValue[key]);
                        if(!bothNaN && newItem !== oldValue[key]) { //both are non not to be considered a change
                            changeCount++;
                            oldValue[key] = newItem;
                        }
                    } else {
                        changeCount++;
                        oldLength++;
                        oldValue[key] = newItem;
                    }

                });

                if (oldLength > newLength) {
                    changeCount++;
                    //iterate over the oldLoop and check if the key is still there not deleted
                    def.Lo.forOwn(oldValue, function (item, key) {
                        if (!newValue.hasOwnProperty(key)) {
                            changeCount++;
                            oldLength--;
                            delete oldValue[key];
                        }
                    });
                }
            }
        } else { //primitive Values
            if (!def.areEqual(newValue, oldValue, false)) {
                changeCount++;
            }
            //check for changes
            oldValue = newValue; //for the next take
        }
        return changeCount;
    };
    let internalListenerFn = () => {
        if(firstRun) {
            listenerFn(newValue, newValue, this);
            firstRun = false;
        } else  {
            listenerFn(newValue, veryOldValue, this);
        }
        if (trackVeryOldValue) {
            veryOldValue = def.Lo.clone(newValue);
        }
    };
    return this.$watch(internalWatchFn,internalListenerFn);
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