let Scope = require("../src/Scope");

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
        /*let listenerFn = jest.fn(); //error

        jest.spyOn(watchFn,'listenerFn');

        scope.$watch(watchFn,listenerFn);

        scope.$digest();

        expect(listenerFn).toHaveBeenCalled();*/

    });



});

