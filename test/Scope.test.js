const Scope = require("../src/Scope");
const Function = require("../src/util/functions");

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

});

