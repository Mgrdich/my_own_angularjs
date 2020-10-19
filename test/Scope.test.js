const Scope = require("../src/Scope");
const Lib = require("../src/util/functions");
const def = new Lib();

describe("Scope", function () {

    it("can be constructed using an object", function () {
        let scope = new Scope();
        scope.aProperty = 1;
        expect(scope.aProperty).toBe(1);
    });

    describe("digest",function () {
        let scope;
        beforeEach(function () {
            scope = new Scope();
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


        it("never executes $applyAsync!ed function in the same cycle", function(done) {
            scope.aValue = [1, 2, 3];
            scope.asyncApplied = false;
            scope.$watch(
                function(scope) { return scope.aValue; },
                function(newValue, oldValue, scope) {
                    scope.$applyAsync(function(scope) {
                        scope.asyncApplied = true;
                    });
                }
            );
            scope.$digest();
            expect(scope.asyncApplied).toBe(false);
            setTimeout(function() {
                expect(scope.asyncApplied).toBe(true);
                done();
            }, 50);
        });


        it("coalescing many call of $applyAsync",function (done) {
            scope.counter = 0;

            scope.$watch(function (scope) {
                scope.counter++;
                return scope.aValue;
            },function () {});

            scope.$applyAsync(function (scope) {
                scope.aValue = 's1';
            });

            scope.$applyAsync(function (scope) {
                scope.aValue = 's2';
            });

            setTimeout(function () {
                expect(scope.counter).toBe(2);
                done();
            },50);

        });


        it("runs a $$postDigest function after each digest",function () {
            scope.counter = 0;

            scope.$$postDigest(function () {
                scope.counter++;
            });

            expect(scope.counter).toBeFalsy();

            scope.$digest();
            expect(scope.counter).toBe(1);

            scope.$digest(); //here the Queue is already consumed
            expect(scope.counter).toBe(1);
        });


        it("does not include $postDigest in the the digest cycle",function () {
            scope.aValue = "someOriginalValue";
            scope.listenerChangedValue = '';

            scope.$$postDigest(function () {
                scope.aValue = "someChangedValue"; //won't immediately check out by dirty checking mechanism
            });

            scope.$watch(function () {
                return scope.aValue;
            },function (newValue,oldValue,scope) {
                scope.listenerChangedValue = newValue; //pick up the old Digested then after the listener
            });

            scope.$digest();
            expect(scope.listenerChangedValue).toBe('someOriginalValue');

            scope.$digest();
            expect(scope.listenerChangedValue).toBe('someChangedValue');
        });


        it("catches the exceptions in watch functions and continues",function () {
            scope.aValue = 'abc';
            scope.counter = 0;

            scope.$watch(function () {
                throw "error";
            });

            scope.$watch(function (scope) {
                return scope.aValue;
            },function (newValue,oldValue,scope) {
                scope.counter++;
            });

            scope.$digest();
            expect(scope.counter).toBe(1);
        });


        it("catches the exceptions in Listener functions and continues",function () {
            scope.aValue = 'abc';
            scope.counter = 0;

            scope.$watch(function () {
                return scope.aValue;
            },function (newValue,oldValue,scope) {
                throw "error";
            });

            scope.$watch(function (scope) {
                return scope.aValue;
            },function (newValue,oldValue,scope) {
                scope.counter++;
            });

            scope.$digest();
            expect(scope.counter).toBe(1);
        });


        it("catches exceptions in evalAsync", function (done) {
            scope.aValue = 'abc';
            scope.counter = 0;

            scope.$watch(function (scope) {
                return scope.aValue;
            }, function (newValue, oldValue, scope) {
                scope.counter++;
            });

            scope.$evalAsync(function (scope) {
                throw "Error";
            });

            setTimeout(function () {
                expect(scope.counter).toBe(1);
                done();
            },50);

        });


        it("catches exceptions in asyncApply", function (done) {

            scope.$applyAsync(function () {
                throw "Error";
            });

            scope.$applyAsync(function () {
                throw "Error2";
            });

            scope.$applyAsync(function () {
                scope.applied = true;
            });

            setTimeout(function () {
                expect(scope.applied).toBeTruthy();
                done();
            },50);

        });


        it("catches exceptions in postDigest", function () {

            scope.$$postDigest(function () {
                throw "Error";
            });

            scope.$$postDigest(function () {
                throw "Error2";
            });

            scope.$$postDigest(function () {
                scope.run = true;
            });

            scope.$digest();
            expect(scope.run).toBeTruthy();

        });


        it("allows a particular watch to be destroyed",function () {
            scope.aValue = "abcv";
            scope.counter = 0;

            let destroyedWatch = scope.$watch(function () {
                return scope.aValue;
            }, function (newValue, oldValue, scope) {
                scope.counter++;
            });

            scope.$digest();
            expect(scope.counter).toBe(1);

            scope.aValue = 'bcd';
            scope.$digest();
            expect(scope.counter).toBe(2);

            scope.aValue = 'efg';

            destroyedWatch();
            scope.$digest();
            expect(scope.counter).toBe(2);

        });


        it("allows destroying a watching during a digest",function () {
            scope.aValue = 'abc';

            let watchCalls = [];

            scope.$watch(function (scope) {
                watchCalls.push('first');
                return scope.aValue;
            });

            let destroyWatch = scope.$watch(function (scope) {
                watchCalls.push('second');
                destroyWatch(); //this should not trick the order and the shifting order of the watcher so they won't budge
            });

            scope.$watch(function (scope) {
                watchCalls.push('third');
                return scope.aValue;
            });

            scope.$digest();
            expect(watchCalls).toEqual(['first','second','third','first','third'])
        });


        it("allows the $watch to destroy another during digest",function () {
            scope.aValue = 'abc';
            scope.counter = 0;

            scope.$watch(function () {
                return scope.aValue;
            },function (newValue,oldValue,scope) {
                destroyWatch();
            });

            let destroyWatch = scope.$watch(
                function(scope) { },
                function(newValue, oldValue, scope) { }
            );

            scope.$watch(
                function(scope) { return scope.aValue; },
                function(newValue, oldValue, scope) {
                    scope.counter++;
                }
            );

            scope.$digest();
            expect(scope.counter).toBe(1)

        });


        it("allows in the $watch to destroy multiple watches in te digest",function () {
            scope.aValue = 'abc';
            scope.counter = 0;

            let destroyWatch1= scope.$watch(function () {
                destroyWatch1();
                destroyWatch2(); //why it makes it undefined rather than deleting it from the array
            });

            let destroyWatch2 = scope.$watch(function () {
                return scope.aValue;
            },function (newValue,oldValue,scope) {
                scope.counter++;
            });

            scope.$digest();
            expect(scope.counter).toBe(0);
        });
    });


    describe("$watchGroup",function () {
        let scope;
        beforeEach(function () {
            scope = new Scope();
        });

        it("takes watches as an array can calls the listener with arrays",function () {
           let gotNewValue = null;
           let gotOldValue = null;
           scope.aValue = 1;
           scope.anotherValue = 2;

           scope.$watchGroup([
               function (scope) {
                   return scope.aValue;
               },
               function (scope) {
                   return scope.anotherValue;
               }
           ],function (newValues,oldValues,scope) {
               gotNewValue = newValues;
               gotOldValue = oldValues;
           });

           scope.$digest();
           expect(gotNewValue).toEqual([1,2]);
           expect(gotOldValue).toEqual([1,2]);

        });
        
        
        it("only calls listener once per digest",function () {
            let counter = 0;
            scope.aValue = 1;
            scope.anotherValue = 2;

            scope.$watchGroup([
                function (scope) {
                    return scope.aValue;
                },
                function (scope) {
                    return scope.anotherValue;
                }
            ], function (newValue, oldValue, scope) {
                counter++;
            });
            scope.$digest();
            expect(counter).toEqual(1);
            
        });


        it("uses different arrays for old and new Values on subsequent runs",function () {
           let gotNewValues = null;
           let gotOldValues = null;

            scope.aValue = 1;
            scope.anotherValue = 2;

            scope.$watchGroup([
                function (scope) {
                    return scope.aValue;
                },
                function (scope) {
                    return scope.anotherValue;
                }
            ], function (newValues, oldValues, scope) {
               gotNewValues = newValues;
               gotOldValues = oldValues;
            });

            scope.$digest();

            scope.anotherValue = 3;
            scope.$digest();

            expect(gotOldValues).toEqual([1, 2]);
            expect(gotNewValues).toEqual([1, 3]);

        });


        it("calls the listener once when the watch array s empty",function () {
           let gotNewsValues = null;
           let gotOldValues = null;

           scope.$watchGroup([],function (newValues,oldValues,scope) {
               gotOldValues = oldValues;
               gotNewsValues = newValues;
           });

           scope.$digest();
           expect(gotNewsValues).toEqual([]);
           expect(gotOldValues).toEqual([]);

        });


        it("destroy or deregister a watchGroup",function () {
            let counter = 0;

            scope.aValue = 1;
            scope.anotherValue = 2;

            let destroyGroup = scope.$watchGroup([
                function (scope) {
                    return scope.aValue;
                },
                function (scope) {
                    return scope.anotherValue;
                }
            ],function (newValue,oldValues,scope) {
                counter++;
            });

            scope.$digest();//it will count me

            scope.anotherValue = 3;

            destroyGroup();

            scope.$digest();

            expect(counter).toBe(1);
        });


        it("does not call the zero watch listener when deregistered first",function () {
            scope.counter = 0;

            let destroyGroup = scope.$watchGroup([],function (newValues,oldValues,scope) {
                scope.counter++;
            });
            destroyGroup();
            scope.$digest();

            expect(scope.counter).toBe(0);
        });

    });


    describe("inheritance",function () {

        it("inherits the parent's properties",function () {
           let parent = new Scope();
           parent.aValue = [1, 2, 3];

           let child = parent.$new();
           expect(child.aValue).toEqual([1, 2, 3]);
        });


        it("does not cause a parent to inherit its properties",function () {
           let parent = new Scope();

           let child = parent.$new();
           child.aValue = [1, 2, 3];

           expect(parent.aValue).toBeUndefined();
        });


        it("inherits the parent's properties whenever they are defined",function () {
           let parent = new Scope();
           let child = parent.$new();

           parent.aValue = [1, 2, 3];
           expect(child.aValue).toEqual([1, 2, 3]);

        });


        it("can watch the property of the parent",function () {
           let parent = new Scope();
           let child = parent.$new();
           parent.aValue = [1, 2, 3];
           child.counter = 0;

           child.$watch(function (scope) {
               return scope.aValue;
           },function (newValue,oldValue,scope) {
               scope.counter++;
           },true);

           child.$digest();
           expect(child.counter).toBe(1);

           parent.aValue.push(4);
           child.$digest();
           expect(child.counter).toBe(2);
        });


        it("can be nested at any depth",function () {
           let a = new Scope();
           let aa = a.$new();
           let aa1 = aa.$new();
           let aa2 = aa1.$new();
           let aa3 = aa2.$new();
           let aa4 = aa3.$new();

           a.value = 1;

           expect(aa.value).toBe(1);
           expect(aa1.value).toBe(1);
           expect(aa2.value).toBe(1);
           expect(aa3.value).toBe(1);
           expect(aa4.value).toBe(1);

           aa3.anoterValue = 4;
           expect(aa4.anoterValue).toBe(4);
           expect(aa2.anoterValue).toBeUndefined();
           expect(aa1.anoterValue).toBeUndefined();

        });


        it("shadows a parent's property with the same name",function () {
           let parent = new Scope();
           let child = parent.$new();

           parent.name = 'Joe';
           child.name = 'Joey'; // this is called attribute shadowing it will not change the parent

           expect(parent.name).toBe('Joe');
           expect(child.name).toBe('Joey');

        });


        it("it does not shadow members of the parent scope attributes",function () {
           let parent = new Scope();
           let child = parent.$new();

           parent.user = {name: 'Joe'};
           child.user.name = 'Jill'; // since in the prototype it holds the reference

           expect(child.user.name).toBe('Jill');
           expect(parent.user.name).toBe('Jill');
        });


        it("does not digest its parent(s)",function () {
            let parent = new Scope();
            let child = parent.$new();

            parent.aValue = 'abc';
            parent.$watch(function (scope) {
                return scope.aValue;
            }, function (newValue, oldValue, scope) {
                scope.aValueWas = newValue;
            });

            child.$digest(); // should not trigger the watch of the parent
            expect(child.aValueWas).toBeUndefined();
        });


        it("keeps the record of its Children Scopes",function () {
           let parent = new Scope();
           let child1 = parent.$new();
           let child2 = parent.$new();
           let child2_1 = child2.$new();

           expect(parent.$$children.length).toBe(2);
           expect(parent.$$children[0]).toBe(child1);
           expect(parent.$$children[1]).toBe(child2);

           expect(child1.$$children.length).toBe(0);
           expect(child2.$$children.length).toBe(1);

           expect(child2.$$children[0]).toBe(child2_1);
        });


        it("digest its children",function () {
           let parent = new Scope();
           let child = parent.$new();

           parent.aValue = 'abc';
           child.$watch(function (scope) {
               return scope.aValue;
           },function (newValue,oldValue,scope) {
                scope.aValueWas = newValue;
           });

           parent.$digest();
           expect(child.aValueWas).toBe('abc');

        });


        it("digest from root on $apply",function () {
           //since digest works from current scope and down
           let parent = new Scope();
           let child = parent.$new();
           let child2 = child.$new();

           parent.aValue = 'abc';
           parent.counter = 0;

           parent.$watch(function (scope) {
               return scope.aValue;
           },function (newValue,oldValue,scope) {
              scope.counter++;
           });

           child2.$apply(function (scope) {});

           expect(parent.counter).toBe(1);

        });


        it("digest from root on $evalAsync",function (done) {
            let parent = new Scope();
            let child = parent.$new();
            let child2 = child.$new();

            parent.aValue = 'abc';
            parent.counter = 0;

            parent.$watch(function (scope) {
                return scope.aValue;
            },function (newValue,oldValue,scope) {
                scope.counter++;
            });

            child2.$evalAsync(function (scope) {});

            setTimeout(function () {
                expect(parent.counter).toBe(1);
                done();
            },50);
        });
    });
});

