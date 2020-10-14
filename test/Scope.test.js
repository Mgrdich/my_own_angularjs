const Scope = require("../src/Scope");
const Function = require("../src/util/functions");
const _ = require('lodash');

const def = new Function();

describe("Scope", function () {
    let scope;

    beforeEach(function () {
        scope = new Scope();
    });

    it("can be constructed using an object", function () {
        let scope = new Scope();
        scope.aProperty = 1;
        expect(scope.aProperty).toBe(1);
    });


    it("calls the listener function of a watch o first $digest",function () {

        let watchFn  = function () {
            return 'wat';
        };
        let listenerFn = jest.fn(def.noop);

        scope.$watch(watchFn,listenerFn);

        scope.$digest();

        expect(listenerFn).toHaveBeenCalled();

    });


    it('calls the listener function when the watch value changes',function () {
        scope.someValue = 'a';
        scope.counter = 0;

        scope.$watch(function (scope) {
            return scope.someValue; //the expression
        }, function (newValue,oldValue,scope) {
            scope.counter++;
        });

        expect(scope.counter).toBe(0);

        scope.$digest();

        expect(scope.counter).toBe(1);

        scope.$digest();

        expect(scope.counter).toBe(1);

    });


    it("calls listener with new value as old value the first time", function() {
        scope.someValue = 123;
        let testFirstTimeWatch = undefined;

        scope.$watch(function (scope) {
            return scope.someValue;
        },function (newValue,oldValue) {
            //oldValue === initWatchVal --> newVal
            testFirstTimeWatch = oldValue;
        });

        expect(testFirstTimeWatch).toBeUndefined();
        scope.$digest();
        expect(testFirstTimeWatch).toBe(123);

        scope.someValue = 124;
        scope.$digest();
        expect(testFirstTimeWatch).toBe(123); //oldValue

    });


    it("watch function without any listener function",function () {
        let watchFn = jest.fn().mockReturnValue('hello');
        scope.$watch(watchFn);

        scope.$digest();
        expect(watchFn).toHaveBeenCalled();
        expect(watchFn).toHaveReturnedWith('hello');

    });


    it("keep digesting while dirty one watcher changes the value of another watcher",function () {
        scope.name = "Bob";
        scope.initial = null;

        //order of $watches are intended so the dependent one will get passover than because of dirty will get rendered again
        scope.$watch(function (scope) {
            return scope.nameUpper;
        },function (newValue,oldValue,scope) {
            if(newValue) {
                scope.initial = newValue.substring(0, 1) + '.';
            }
        });

        scope.$watch(function (scope) {
            return scope.name;
        }, function (newValue, oldValue, scope) {
            if (newValue) {
                scope.nameUpper = newValue.toUpperCase();
            }
        });

        scope.$digest();
        expect(scope.initial).toBe('B.');

        scope.name = "George";
        scope.$digest();
        expect(scope.initial).toBe('G.');
    });


    it("unstable digest two watches being dependent from one another",function () {
        scope.first = 0;
        scope.second = 0;

        scope.$watch(function (scope) {
            return scope.first
        }, function () {
            scope.second++;
        });

        scope.$watch(function (scope) {
            return scope.second
        }, function () {
            scope.first++;
        });

        expect(function () {scope.$digest()}).toThrow();

    });


    it("watcher unstable and inefficient digest cycle",function () {
        scope.array = _.range(100);
        let watchExecution = 0;

        _.times(100,function (i) {
            scope.$watch(function (scope) { //setting up 100 watchers
               watchExecution++;
               return scope.array[i]; //setting return value on each value of the array
            },function () {});
        });

        //loop goes on all the watchers then the second round to determine whether some watcher was changed in the listerner

        scope.$digest();
        expect(watchExecution).toBe(200);

        scope.array[0] = 69;
        scope.$digest();
        expect(watchExecution).toBe(301); //if not with short circuiting optimization

    });


    it("does not end digest so that new watches are not run Watch inside a Watch",function () {

    });

});

