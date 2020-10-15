const Scope = require("../src/Scope");
const Lib = require("../src/util/functions");
const def = new Lib();

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
        scope.array = def.Lo.range(100);
        let watchExecution = 0;

        def.Lo.times(100,function (i) {
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
        scope.someValue = 'a';
        scope.counter = 0;

        //second watch without reset on every watch will never run because were ending the digest before new watch would run
        //bcz we're ending the digest detecting the first watch as dirty

        scope.$watch(function (scope) {
            return scope.someValue;
        }, function (newValue, oldValue, scope) {
            scope.$watch(function (scope) { //on first it will put the watcher but it will be lost since it will be terminated
                return scope.someValue;
            }, function (newValue, oldValue, scope) {
                scope.counter++;
            });
        });

        scope.$digest();
        expect(scope.counter).toBe(1);

    });


    it("watching an array or an object",function () {
        scope.aValue = [1, 2, 3];
        scope.counter = 0;

        scope.$watch(function (scope) {
            return scope.aValue;
        },function (newValue,oldValue,scope) {
            scope.counter++;
        },true);

        scope.$digest();
        expect(scope.counter).toBe(1);

        scope.aValue.push(4);
        scope.$digest();
        expect(scope.counter).toBe(2);
    });


    it("correct handle NAN", function () {
        scope.number = 0 / 0; //NaN
        scope.counter = 0;

        scope.$watch(function (scope) {
            return scope.number;
        }, function (n, o, scope) {
            scope.counter++;
        });

        scope.$digest();
        expect(scope.counter).toBe(1);
        scope.$digest();
        expect(scope.counter).toBe(1);

    });


    it("$eval creating and return of the result with one parameter and with two parameter",function () {
        scope.aValue = 42;

        let result = scope.$eval(function (scope) {
           return scope.aValue;
        });

        expect(result).toBe(42);

        let result2 = scope.$eval(function (scope,arg) {
            return scope.aValue + arg;
        },2);

        expect(result2).toBe(44);
    });


    it("apply function which will take and expr or not and trigger a digest cycle",function () {
        scope.aValue = 'someThingShouldBeHere';
        scope.counter = 0;

        scope.$watch(function () {
            return scope.aValue;
        }, function (newValue, oldValue, scope) {
            scope.counter++;
        });

        scope.$digest();
        expect(scope.counter).toBe(1);

        scope.$apply(function (scope) {
           scope.aValue = "ApplyChangedMe";
        });
        expect(scope.counter).toBe(2);
        expect(scope.aValue).toBe("ApplyChangedMe");

    });


    it("executes evalAsync in function later in the same cycle",function () {
        scope.aValue = [1, 2, 3];
        scope.asyncEvaluated = false;
        scope.asyncEvaluatedImmediately = false;

        scope.$watch(function (scope) {
            return scope.aValue;
        },function (newValue,oldValue,scope) {
            scope.$evalAsync(function (scope) {
                scope.asyncEvaluated = true;
            });
            scope.asyncEvaluatedImmediately = scope.asyncEvaluated; //won't pick up the new Value here but after the main digest is over
        });

        scope.$digest();
        expect(scope.asyncEvaluatedImmediately).toBeFalsy(); //means it will be evaluated before the evalAsync digest in progress
        expect(scope.asyncEvaluated).toBeTruthy();

    });


    it("executes evalAsync in the watch functions when not dirty!!",function () {
        scope.aValueWorking = 'WorkingCaseEvalAsyncNotDirty';
        scope.asyncEvaluatedTimesWorking = 0;
        scope.aValue = [1, 2, 3];
        scope.asyncEvaluatedTimes = 0;

        scope.$watch(function (scope) {
            if (!scope.asyncEvaluatedTimesWorking) {
                scope.$evalAsync(function (scope) { //this one will get scheduled when a watch is dirty
                    scope.asyncEvaluatedTimesWorking++;
                });
            }
            return scope.aValueWorking;
        },function (newValue,oldValue,scope) {});

        //what if we schedule an evalAsync when no watch is dirty
        scope.$watch(function (scope) {
            if (scope.asyncEvaluatedTimes < 2) { //second time watch wont be dirty and it will be a problem
                scope.$evalAsync(function (scope) {
                   scope.asyncEvaluatedTimes++;
                });
            }
            return scope.aValue;
        },function (newValue,oldValue,scope) {});

        scope.$digest();
        expect(scope.asyncEvaluatedTimesWorking).toBeTruthy();
        expect(scope.asyncEvaluatedTimes).toBe(2);
    });


    it("has a $$phase field whose value is the current digest phase",function () {
        scope.aValue = [1, 2, 3];
        scope.phaseInWatch = undefined;
        scope.phaseInListener = undefined;
        scope.phaseInApply = undefined;


        scope.$watch(function () {
            scope.phaseInWatch = scope.$$phase;
            return scope.aValue;
        },function (newValue,oldValue,scope) {
            scope.phaseInListener = scope.$$phase;
        });

        scope.$apply(function () {
            scope.phaseInApply = scope.$$phase;
        });

        expect(scope.phaseInWatch).toBe('$digest');
        expect(scope.phaseInListener).toBe('$digest');
        expect(scope.phaseInApply).toBe('$apply');

    });


    it("schedules a digest in $evalAsync",function (done) {
       scope.aValue = "abc";
       scope.counter = 0;

       scope.$watch(function (scope) {
           return scope.aValue;
       },function () {
            scope.counter++;
       });

       scope.$evalAsync(function (scope) {}); //trigger a digest if none is running

       expect(scope.counter).toBe(0);

       setTimeout(function () {
           expect(scope.counter).toBe(1);
           done();
       },50);

    });


    it("allows async $apply with $applyAsync",function (done) {
       scope.counter = 0;
       scope.aValue = 88;

       scope.$watch(function () {
           return scope.aValue
       },function (newValue,oldValue,scope) {
           scope.counter++;
       });

       scope.$digest();
       expect(scope.counter).toBe(1);

       scope.$applyAsync(function (scope) {
          scope.aValue = 'somethingHere';
       });

       expect(scope.counter).toBe(1);

       setTimeout(function () {
           expect(scope.counter).toBe(2);
           done();
       },50);

    });

});

