import Scope from 'js_legacy/Scope';
import Lib from 'util/functions';
const def = new Lib();

describe('Scope', function () {
  it('can be constructed using an object', function () {
    let scope = new Scope();
    scope.aProperty = 1;
    expect(scope.aProperty).toBe(1);
  });

  describe('digest', function () {
    let scope;
    beforeEach(function () {
      scope = new Scope();
    });

    it('calls the listener function of a watch o first $digest', function () {
      let watchFn = function () {
        return 'wat';
      };
      let listenerFn = jest.fn(def.noop);

      scope.$watch(watchFn, listenerFn);

      scope.$digest();

      expect(listenerFn).toHaveBeenCalled();
    });

    it('calls the listener function when the watch value changes', function () {
      scope.someValue = 'a';
      scope.counter = 0;

      scope.$watch(
        function (scope) {
          return scope.someValue; //the expression
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      expect(scope.counter).toBe(0);

      scope.$digest();

      expect(scope.counter).toBe(1);

      scope.$digest();

      expect(scope.counter).toBe(1);
    });

    it('calls listener with new value as old value the first time', function () {
      scope.someValue = 123;
      let testFirstTimeWatch = undefined;

      scope.$watch(
        function (scope) {
          return scope.someValue;
        },
        function (newValue, oldValue) {
          //oldValue === initWatchVal --> newVal
          testFirstTimeWatch = oldValue;
        },
      );

      expect(testFirstTimeWatch).toBeUndefined();
      scope.$digest();
      expect(testFirstTimeWatch).toBe(123);

      scope.someValue = 124;
      scope.$digest();
      expect(testFirstTimeWatch).toBe(123); //oldValue
    });

    it('watch function without any listener function', function () {
      let watchFn = jest.fn().mockReturnValue('hello');
      scope.$watch(watchFn);

      scope.$digest();
      expect(watchFn).toHaveBeenCalled();
      expect(watchFn).toHaveReturnedWith('hello');
    });

    it('keep digesting while dirty one watcher changes the value of another watcher', function () {
      scope.name = 'Bob';
      scope.initial = null;

      //order of $watches are intended so the dependent one will get passover than because of dirty will get rendered again
      scope.$watch(
        function (scope) {
          return scope.nameUpper;
        },
        function (newValue, oldValue, scope) {
          if (newValue) {
            scope.initial = newValue.substring(0, 1) + '.';
          }
        },
      );

      scope.$watch(
        function (scope) {
          return scope.name;
        },
        function (newValue, oldValue, scope) {
          if (newValue) {
            scope.nameUpper = newValue.toUpperCase();
          }
        },
      );

      scope.$digest();
      expect(scope.initial).toBe('B.');

      scope.name = 'George';
      scope.$digest();
      expect(scope.initial).toBe('G.');
    });

    it('unstable digest two watches being dependent from one another', function () {
      scope.first = 0;
      scope.second = 0;

      scope.$watch(
        function (scope) {
          return scope.first;
        },
        function () {
          scope.second++;
        },
      );

      scope.$watch(
        function (scope) {
          return scope.second;
        },
        function () {
          scope.first++;
        },
      );

      expect(function () {
        scope.$digest();
      }).toThrow();
    });

    it('watcher unstable and inefficient digest cycle', function () {
      scope.array = def.Lo.range(100);
      let watchExecution = 0;

      def.Lo.times(100, function (i) {
        scope.$watch(
          function (scope) {
            //setting up 100 watchers
            watchExecution++;
            return scope.array[i]; //setting return value on each value of the array
          },
          function () {},
        );
      });

      //loop goes on all the watchers then the second round to determine whether some watcher was changed in the listener

      scope.$digest();
      expect(watchExecution).toBe(200);

      scope.array[0] = 69;
      scope.$digest();
      expect(watchExecution).toBe(301); //if not with short circuit-ing optimization
    });

    it('does not end digest so that new watches are not run Watch inside a Watch', function () {
      scope.someValue = 'a';
      scope.counter = 0;

      //second watch without reset on every watch will never run because were ending the digest before new watch would run
      //bcz we're ending the digest detecting the first watch as dirty

      scope.$watch(
        function (scope) {
          return scope.someValue;
        },
        function (newValue, oldValue, scope) {
          scope.$watch(
            function (scope) {
              //on ,first it will put the watcher, but it will be lost since it will be terminated
              return scope.someValue;
            },
            function (newValue, oldValue, scope) {
              scope.counter++;
            },
          );
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);
    });

    it('watching an array or an object', function () {
      scope.aValue = [1, 2, 3];
      scope.counter = 0;

      scope.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
        true,
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.aValue.push(4);
      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('correct handle NAN', function () {
      scope.number = 0 / 0; //NaN
      scope.counter = 0;

      scope.$watch(
        function (scope) {
          return scope.number;
        },
        function (n, o, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);
      scope.$digest();
      expect(scope.counter).toBe(1);
    });

    it('$eval creating and return of the result with one parameter and with two parameter', function () {
      scope.aValue = 42;

      let result = scope.$eval(function (scope) {
        return scope.aValue;
      });

      expect(result).toBe(42);

      let result2 = scope.$eval(function (scope, arg) {
        return scope.aValue + arg;
      }, 2);

      expect(result2).toBe(44);
    });

    it('apply function which will take and expr or not and trigger a digest cycle', function () {
      scope.aValue = 'someThingShouldBeHere';
      scope.counter = 0;

      scope.$watch(
        function () {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.$apply(function (scope) {
        scope.aValue = 'ApplyChangedMe';
      });
      expect(scope.counter).toBe(2);
      expect(scope.aValue).toBe('ApplyChangedMe');
    });

    it('executes evalAsync in function later in the same cycle', function () {
      scope.aValue = [1, 2, 3];
      scope.asyncEvaluated = false;
      scope.asyncEvaluatedImmediately = false;

      scope.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.$evalAsync(function (scope) {
            scope.asyncEvaluated = true;
          });
          scope.asyncEvaluatedImmediately = scope.asyncEvaluated; //won't pick up the new Value here but after the main digest is over
        },
      );

      scope.$digest();
      expect(scope.asyncEvaluatedImmediately).toBeFalsy(); //means it will be evaluated before the evalAsync digest in progress
      expect(scope.asyncEvaluated).toBeTruthy();
    });

    it('executes evalAsync in the watch functions when not dirty!!', function () {
      scope.aValueWorking = 'WorkingCaseEvalAsyncNotDirty';
      scope.asyncEvaluatedTimesWorking = 0;
      scope.aValue = [1, 2, 3];
      scope.asyncEvaluatedTimes = 0;

      scope.$watch(
        function (scope) {
          if (!scope.asyncEvaluatedTimesWorking) {
            scope.$evalAsync(function (scope) {
              //this one will get scheduled when a watch is dirty
              scope.asyncEvaluatedTimesWorking++;
            });
          }
          return scope.aValueWorking;
        },
        function () {},
      );

      //what if we schedule an evalAsync when no watch is dirty
      scope.$watch(
        function (scope) {
          if (scope.asyncEvaluatedTimes < 2) {
            //second time watch won't be dirty , and it will be a problem
            scope.$evalAsync(function (scope) {
              scope.asyncEvaluatedTimes++;
            });
          }
          return scope.aValue;
        },
        function () {},
      );

      scope.$digest();
      expect(scope.asyncEvaluatedTimesWorking).toBeTruthy();
      expect(scope.asyncEvaluatedTimes).toBe(2);
    });

    it('has a $$phase field whose value is the current digest phase', function () {
      scope.aValue = [1, 2, 3];
      scope.phaseInWatch = undefined;
      scope.phaseInListener = undefined;
      scope.phaseInApply = undefined;

      scope.$watch(
        function () {
          scope.phaseInWatch = scope.$$phase;
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.phaseInListener = scope.$$phase;
        },
      );

      scope.$apply(function () {
        scope.phaseInApply = scope.$$phase;
      });

      expect(scope.phaseInWatch).toBe('$digest');
      expect(scope.phaseInListener).toBe('$digest');
      expect(scope.phaseInApply).toBe('$apply');
    });

    it('schedules a digest in $evalAsync', function (done) {
      scope.aValue = 'abc';
      scope.counter = 0;

      scope.$watch(
        function (scope) {
          return scope.aValue;
        },
        function () {
          scope.counter++;
        },
      );

      scope.$evalAsync(function () {}); //trigger a digest if none is running

      expect(scope.counter).toBe(0);

      setTimeout(function () {
        expect(scope.counter).toBe(1);
        done();
      }, 50);
    });

    it('allows async $apply with $applyAsync', function (done) {
      scope.counter = 0;
      scope.aValue = 88;

      scope.$watch(
        function () {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.$applyAsync(function (scope) {
        scope.aValue = 'somethingHere';
      });

      expect(scope.counter).toBe(1);

      setTimeout(function () {
        expect(scope.counter).toBe(2);
        done();
      }, 50);
    });

    it('never executes $applyAsync!ed function in the same cycle', function (done) {
      scope.aValue = [1, 2, 3];
      scope.asyncApplied = false;
      scope.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.$applyAsync(function (scope) {
            scope.asyncApplied = true;
          });
        },
      );
      scope.$digest();
      expect(scope.asyncApplied).toBe(false);
      setTimeout(function () {
        expect(scope.asyncApplied).toBe(true);
        done();
      }, 50);
    });

    it('coalescing many call of $applyAsync', function (done) {
      scope.counter = 0;

      scope.$watch(
        function (scope) {
          scope.counter++;
          return scope.aValue;
        },
        function () {},
      );

      scope.$applyAsync(function (scope) {
        scope.aValue = 's1';
      });

      scope.$applyAsync(function (scope) {
        scope.aValue = 's2';
      });

      setTimeout(function () {
        expect(scope.counter).toBe(2);
        done();
      }, 50);
    });

    it('runs a $$postDigest function after each digest', function () {
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

    it('does not include $postDigest in the the digest cycle', function () {
      scope.aValue = 'someOriginalValue';
      scope.listenerChangedValue = '';

      scope.$$postDigest(function () {
        scope.aValue = 'someChangedValue'; //won't immediately check out by dirty checking mechanism
      });

      scope.$watch(
        function () {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.listenerChangedValue = newValue; //pick up the old Digested then after the listener
        },
      );

      scope.$digest();
      expect(scope.listenerChangedValue).toBe('someOriginalValue');

      scope.$digest();
      expect(scope.listenerChangedValue).toBe('someChangedValue');
    });

    it('catches the exceptions in watch functions and continues', function () {
      scope.aValue = 'abc';
      scope.counter = 0;

      scope.$watch(function () {
        throw 'error';
      });

      scope.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);
    });

    it('catches the exceptions in Listener functions and continues', function () {
      scope.aValue = 'abc';
      scope.counter = 0;

      scope.$watch(
        function () {
          return scope.aValue;
        },
        function () {
          throw 'error';
        },
      );

      scope.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);
    });

    it('catches exceptions in evalAsync', function (done) {
      scope.aValue = 'abc';
      scope.counter = 0;

      scope.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$evalAsync(function () {
        throw 'Error';
      });

      setTimeout(function () {
        expect(scope.counter).toBe(1);
        done();
      }, 50);
    });

    it('catches exceptions in asyncApply', function (done) {
      scope.$applyAsync(function () {
        throw 'Error';
      });

      scope.$applyAsync(function () {
        throw 'Error2';
      });

      scope.$applyAsync(function () {
        scope.applied = true;
      });

      setTimeout(function () {
        expect(scope.applied).toBeTruthy();
        done();
      }, 50);
    });

    it('catches exceptions in postDigest', function () {
      scope.$$postDigest(function () {
        throw 'Error';
      });

      scope.$$postDigest(function () {
        throw 'Error2';
      });

      scope.$$postDigest(function () {
        scope.run = true;
      });

      scope.$digest();
      expect(scope.run).toBeTruthy();
    });

    it('allows a particular watch to be destroyed', function () {
      scope.aValue = 'abc';
      scope.counter = 0;

      let destroyedWatch = scope.$watch(
        function () {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

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

    it('allows destroying a watching during a digest', function () {
      scope.aValue = 'abc';

      let watchCalls = [];

      scope.$watch(function (scope) {
        watchCalls.push('first');
        return scope.aValue;
      });

      let destroyWatch = scope.$watch(function () {
        watchCalls.push('second');
        destroyWatch(); //this should not trick the order and the shifting order of the watcher, so they won't budge
      });

      scope.$watch(function (scope) {
        watchCalls.push('third');
        return scope.aValue;
      });

      scope.$digest();
      expect(watchCalls).toEqual(['first', 'second', 'third', 'first', 'third']);
    });

    it('allows the $watch to destroy another during digest', function () {
      scope.aValue = 'abc';
      scope.counter = 0;

      scope.$watch(
        function () {
          return scope.aValue;
        },
        function () {
          destroyWatch();
        },
      );

      let destroyWatch = scope.$watch(
        function () {},
        function () {},
      );

      scope.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);
    });

    it('allows in the $watch to destroy multiple watches in te digest', function () {
      scope.aValue = 'abc';
      scope.counter = 0;

      let destroyWatch1 = scope.$watch(function () {
        destroyWatch1();
        destroyWatch2(); //why it makes it undefined rather than deleting it from the array
      });

      let destroyWatch2 = scope.$watch(
        function () {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(0);
    });
  });

  describe('$watchGroup', function () {
    let scope;
    beforeEach(function () {
      scope = new Scope();
    });

    /*it('takes watches as an array can calls the listener with arrays', function () {
      let gotNewValue = null;
      let gotOldValue = null;
      scope.aValue = 1;
      scope.anotherValue = 2;

      scope.$watchGroup(
        [
          function (scope) {
            return scope.aValue;
          },
          function (scope) {
            return scope.anotherValue;
          },
        ],
        function (newValues, oldValues) {
          gotNewValue = newValues;
          gotOldValue = oldValues;
        },
      );

      scope.$digest();
      expect(gotNewValue).toEqual([1, 2]);
      expect(gotOldValue).toEqual([1, 2]);
    });*/

    /*it('only calls listener once per digest', function () {
      let counter = 0;
      scope.aValue = 1;
      scope.anotherValue = 2;

      scope.$watchGroup(
        [
          function (scope) {
            return scope.aValue;
          },
          function (scope) {
            return scope.anotherValue;
          },
        ],
        function () {
          counter++;
        },
      );
      scope.$digest();
      expect(counter).toEqual(1);
    });*/

    /*it('uses different arrays for old and new Values on subsequent runs', function () {
      let gotNewValues = null;
      let gotOldValues = null;

      scope.aValue = 1;
      scope.anotherValue = 2;

      scope.$watchGroup(
        [
          function (scope) {
            return scope.aValue;
          },
          function (scope) {
            return scope.anotherValue;
          },
        ],
        function (newValues, oldValues) {
          gotNewValues = newValues;
          gotOldValues = oldValues;
        },
      );

      scope.$digest();

      scope.anotherValue = 3;
      scope.$digest();

      expect(gotOldValues).toEqual([1, 2]);
      expect(gotNewValues).toEqual([1, 3]);
    });*/

    it('calls the listener once when the watch array s empty', function () {
      let gotNewsValues = null;
      let gotOldValues = null;

      scope.$watchGroup([], function (newValues, oldValues) {
        gotOldValues = oldValues;
        gotNewsValues = newValues;
      });

      scope.$digest();
      expect(gotNewsValues).toEqual([]);
      expect(gotOldValues).toEqual([]);
    });

    /*it('destroy or deregister a watchGroup', function () {
      let counter = 0;

      scope.aValue = 1;
      scope.anotherValue = 2;

      let destroyGroup = scope.$watchGroup(
        [
          function (scope) {
            return scope.aValue;
          },
          function (scope) {
            return scope.anotherValue;
          },
        ],
        function () {
          counter++;
        },
      );

      scope.$digest(); //it will count me

      scope.anotherValue = 3;

      destroyGroup();

      scope.$digest();

      expect(counter).toBe(1);
    });*/

    it('does not call the zero watch listener when de-registered first', function () {
      scope.counter = 0;

      let destroyGroup = scope.$watchGroup([], function (newValues, oldValues, scope) {
        scope.counter++;
      });
      destroyGroup();
      scope.$digest();

      expect(scope.counter).toBe(0);
    });
  });

  describe('inheritance', function () {
    it("inherits the parent's properties", function () {
      let parent = new Scope();
      parent.aValue = [1, 2, 3];

      let child = parent.$new();
      expect(child.aValue).toEqual([1, 2, 3]);
    });

    it('does not cause a parent to inherit its properties', function () {
      let parent = new Scope();

      let child = parent.$new();
      child.aValue = [1, 2, 3];

      expect(parent.aValue).toBeUndefined();
    });

    it("inherits the parent's properties whenever they are defined", function () {
      let parent = new Scope();
      let child = parent.$new();

      parent.aValue = [1, 2, 3];
      expect(child.aValue).toEqual([1, 2, 3]);
    });

    it('can watch the property of the parent', function () {
      let parent = new Scope();
      let child = parent.$new();
      parent.aValue = [1, 2, 3];
      child.counter = 0;

      child.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
        true,
      );

      child.$digest();
      expect(child.counter).toBe(1);

      parent.aValue.push(4);
      child.$digest();
      expect(child.counter).toBe(2);
    });

    it('can be nested at any depth', function () {
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

    it("shadows a parent's property with the same name", function () {
      let parent = new Scope();
      let child = parent.$new();

      parent.name = 'Joe';
      child.name = 'Joey'; // this is called attribute shadowing it will not change the parent

      expect(parent.name).toBe('Joe');
      expect(child.name).toBe('Joey');
    });

    it('it does not shadow members of the parent scope attributes', function () {
      let parent = new Scope();
      let child = parent.$new();

      parent.user = { name: 'Joe' };
      child.user.name = 'Jill'; // since in the prototype it holds the reference

      expect(child.user.name).toBe('Jill');
      expect(parent.user.name).toBe('Jill');
    });

    it('does not digest its parent(s)', function () {
      let parent = new Scope();
      let child = parent.$new();

      parent.aValue = 'abc';
      parent.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.aValueWas = newValue;
        },
      );

      child.$digest(); // should not trigger the watch of the parent
      expect(child.aValueWas).toBeUndefined();
    });

    it('keeps the record of its Children Scopes', function () {
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

    it('digest its children', function () {
      let parent = new Scope();
      let child = parent.$new();

      parent.aValue = 'abc';
      child.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.aValueWas = newValue;
        },
      );

      parent.$digest();
      expect(child.aValueWas).toBe('abc');
    });

    it('digest from root on $apply', function () {
      //since digest works from current scope and down
      let parent = new Scope();
      let child = parent.$new();
      let child2 = child.$new();

      parent.aValue = 'abc';
      parent.counter = 0;

      parent.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      child2.$apply(function () {});

      expect(parent.counter).toBe(1);
    });

    it('digest from root on $evalAsync', function (done) {
      let parent = new Scope();
      let child = parent.$new();
      let child2 = child.$new();

      parent.aValue = 'abc';
      parent.counter = 0;

      parent.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      child2.$evalAsync(function () {});

      setTimeout(function () {
        expect(parent.counter).toBe(1);
        done();
      }, 50);
    });

    it('isolated scope does not have access to the parent', function () {
      let parent = new Scope();
      let child = parent.$new(true);

      parent.aValue = 'abc';
      expect(child.aValue).toBeUndefined();
    });

    it('cannot watch parent attribute when isolated', function () {
      let parent = new Scope();
      let child = parent.$new(true);

      parent.aValue = 'abc';
      child.aSomeValue = 'abc';

      child.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.aValueWas = newValue;
        },
      );

      child.$watch(
        function (scope) {
          return scope.aSomeValue;
        },
        function (newValue, oldValue, scope) {
          scope.aSomeValueWas = newValue;
        },
      );

      child.$digest();
      expect(child.aValueWas).toBeUndefined();
      expect(child.aSomeValueWas).toBe('abc');
    });

    it("digest its isolated children's", function () {
      let parent = new Scope();
      let child = parent.$new(true);

      child.aValue = 'abc';
      child.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.aValueWas = newValue;
        },
      );

      parent.$digest(); //works since the everScope function
      expect(child.aValueWas).toBe('abc');
    });

    it('digest from root $apply when isolated', function () {
      //without the root reference in the isolated it won't work
      let parent = new Scope();
      let child = parent.$new(true);
      let child2 = child.$new();
      parent.aValue = 'abc';
      parent.counter = 0;
      parent.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );
      child2.$apply(function () {});
      expect(parent.counter).toBe(1);
    });

    it('digest from root $evalAsync when isolated', function (done) {
      //without the root reference in the isolated it won't work
      let parent = new Scope();
      let child = parent.$new(true);
      let child2 = child.$new();
      parent.aValue = 'abc';
      parent.counter = 0;
      parent.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );
      child2.$evalAsync(function () {});
      setTimeout(function () {
        expect(parent.counter).toBe(1);
        done();
      }, 50);
    });

    it('executes $evalAsync on the isolated scope', function (done) {
      let parent = new Scope();
      let child = parent.$new(true);

      child.$evalAsync(function (scope) {
        scope.didEvalAsync = true;
      });

      setTimeout(function () {
        expect(child.didEvalAsync).toBeTruthy();
        done();
      }, 50);
    });

    it('executes $$postDigest functions on isolated scope', function () {
      let parent = new Scope();
      let child = parent.$new(true);

      child.$$postDigest(function () {
        child.didPostDigest = true;
      });

      parent.$digest();
      expect(child.didPostDigest).toBeTruthy();
    });

    it('can take some scope as the parent', function () {
      let prototypeParent = new Scope(); //root for them
      let hierarchyParent = new Scope(); //root for them

      let child = prototypeParent.$new(false, hierarchyParent);
      prototypeParent.a = 42;
      hierarchyParent.b = 42;
      expect(child.a).toBe(42);
      expect(child.n).toBeUndefined(); //is not its prototype

      child.counter = 0;
      child.$watch(
        function (scope) {
          return scope.a;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      prototypeParent.$digest();
      expect(child.counter).toBe(0);

      hierarchyParent.$digest();
      expect(child.counter).toBe(1);
    });

    it('no longer get digested when destroy is being called', function () {
      let parent = new Scope();
      let child = parent.$new();

      child.aValue = 'abc';
      child.counter = 0;

      child.$watch(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      parent.$digest();
      expect(child.counter).toBe(1);

      child.aValue = 'bcd';

      parent.$digest();
      expect(child.counter).toBe(2);

      child.$destroy();
      child.aValue = 'bdcg';

      parent.$digest(); //since it is already deleted from children array
      expect(child.counter).toBe(2);

      child.$digest(); //this is why we are making the current watchers null
      expect(child.counter).toBe(2);

      //rest it can be collected by js garbage collector
    });
  });

  describe('$watchCollection', function () {
    let scope;
    beforeEach(function () {
      scope = new Scope();
    });

    it('will work like a normal watch for non Collections', function () {
      let someValue = null;

      scope.aValue = '42';
      scope.counter = 0;

      scope.$watchCollection(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          someValue = newValue;
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);
      expect(someValue).toBe(scope.aValue);

      scope.aValue = '4202';
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('will work with normal non Collection that is NaN', function () {
      scope.aValue = 0 / 0;
      scope.counter = 0;
      scope.$watchCollection(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );
      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.$digest();
      expect(scope.counter).toBe(1);
    });

    it('will test the previous element was an array or not', function () {
      scope.counter = 0;
      scope.arr = null;

      scope.$watchCollection(
        function (scope) {
          return scope.arr;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.arr = [1, 2, 3];
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('will notice an array replace in the Array', function () {
      scope.arr = [1, 2, 3];
      scope.counter = 0;

      scope.$watchCollection(
        function () {
          return scope.arr;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.arr[1] = 45;
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('notices when array is added or removed from it', function () {
      scope.arr = [1, 2, 3];
      scope.counter = 0;

      scope.$watchCollection(
        function () {
          return scope.arr;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.arr.push(69);
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.arr.shift();
      scope.$digest();
      expect(scope.counter).toBe(3);

      scope.$digest();
      expect(scope.counter).toBe(3);
    });

    it('notice item reorder in the array', function () {
      scope.arr = [2, 1, 3];
      scope.counter = 0;

      scope.$watchCollection(
        function () {
          return scope.arr;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.arr.sort();
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('does not fail with NaN in Arrays', function () {
      scope.arr = [2, NaN, 3];
      scope.counter = 0;

      scope.$watchCollection(
        function () {
          return scope.arr;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.arr.push(1);
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('array like objects notices a change in arguments array like object', function () {
      scope.counter = 0;
      (function () {
        scope.functionArgument = arguments;
      })(1, 2, 3);

      expect(scope.functionArgument[1]).toBe(2);

      scope.$watchCollection(
        function () {
          return scope.functionArgument;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.functionArgument[1] = 455;
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    /*it('notices the changes in the NodeList which is array object Argument', function () {
      document.documentElement.appendChild(document.createElement('div'));
      scope.arrayLike = document.getElementsByTagName('div');
      scope.counter = 0;
      scope.$watchCollection(
        function (scope) {
          return scope.arrayLike;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );
      scope.$digest();
      expect(scope.counter).toBe(1);

      document.documentElement.appendChild(document.createElement('div'));
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });*/

    it('detecting new objects when a value becomes one', function () {
      scope.counter = 0;
      scope.obj = null;

      scope.$watchCollection(
        function () {
          return scope.obj;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.obj = { a: 1 };
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('detecting or changing an attribute in an object', function () {
      scope.counter = 0;
      scope.obj = { a: 1 };

      scope.$watchCollection(
        function () {
          return scope.obj;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.obj.b = 2;
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('detecting the change of the same attribute', function () {
      scope.counter = 0;
      scope.obj = { a: 1 };

      scope.$watchCollection(
        function () {
          return scope.obj;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      scope.obj.a = 2;
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('detecting the change delete attribute', function () {
      scope.counter = 0;
      scope.obj = { a: 1, b: 2 };

      scope.$watchCollection(
        function () {
          return scope.obj;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);

      delete scope.obj.a;
      scope.$digest();
      expect(scope.counter).toBe(2);

      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('does not consider any object with a length property an array', function () {
      scope.obj = { length: 42, otherKey: 'abc' };
      scope.counter = 0;
      scope.$watchCollection(
        function (scope) {
          return scope.obj;
        },
        function (newValue, oldValue, scope) {
          scope.counter++;
        },
      );
      scope.$digest();
      scope.obj.newKey = 'def';
      scope.$digest();
      expect(scope.counter).toBe(2);
    });

    it('gives the old non collection value to the listener', function () {
      scope.aValue = 1;
      let oldGivenValue = null;
      scope.$watchCollection(
        function (scope) {
          return scope.aValue;
        },
        function (newValue, oldValue) {
          oldGivenValue = oldValue;
        },
      );
      scope.$digest();

      scope.aValue = 2;
      scope.$digest();
      expect(oldGivenValue).toBe(1);
    });

    it('gives old value array to the listener', function () {
      scope.arr = [1, 2, 3];
      let oldGivenValue = null;
      scope.$watchCollection(
        function (scope) {
          return scope.arr;
        },
        function (newValue, oldValue) {
          oldGivenValue = oldValue;
        },
      );
      scope.$digest();

      scope.arr.push(2);
      scope.$digest();
      expect([...oldGivenValue]).toEqual([1, 2, 3]); //check HERE serialize sting issue
    });

    it('gives the old object value to the listener', function () {
      scope.obj = { a: 1 };
      let oldGivenValue = null;
      scope.$watchCollection(
        function (scope) {
          return scope.obj;
        },
        function (newValue, oldValue) {
          oldGivenValue = oldValue;
        },
      );
      scope.$digest();

      scope.obj.b = 2;
      scope.$digest();
      expect(oldGivenValue).toEqual({ a: 1 });
    });

    it('the new Value as the old value on the first digest', function () {
      scope.obj = { a: 1 };
      let oldGivenValue = null;
      scope.$watchCollection(
        function (scope) {
          return scope.obj;
        },
        function (newValue, oldValue) {
          oldGivenValue = oldValue;
        },
      );

      scope.$digest();
      expect(oldGivenValue).toEqual({ a: 1 });
    });
  });

  describe('Events', function () {
    let scope;
    let parent;
    let child;
    let isolatedChild;

    beforeEach(function () {
      parent = new Scope();
      scope = parent.$new();
      child = scope.$new();
      isolatedChild = scope.$new(true);
    });

    it('allows registration events', function () {
      let listener1 = function () {};
      let listener2 = function () {};
      let listener3 = function () {};

      scope.$on('someEvent', listener1);
      scope.$on('someEvent', listener2);
      scope.$on('someOtherEvent', listener3);

      expect(scope.$$listeners).toEqual({
        someEvent: [listener1, listener2],
        someOtherEvent: [listener3],
      });
    });

    it('register different events on each scope', function () {
      let listener1 = function () {};
      let listener2 = function () {};
      let listener3 = function () {};

      scope.$on('someEvent', listener1);
      child.$on('someEvent', listener2);
      isolatedChild.$on('someOtherEvent', listener3);

      expect(scope.$$listeners).toEqual({
        someEvent: [listener1],
      });

      expect(child.$$listeners).toEqual({
        someEvent: [listener2],
      });

      expect(isolatedChild.$$listeners).toEqual({
        someOtherEvent: [listener3],
      });
    });

    //$emit and $broadcast common code
    def.Lo.forEach(['$emit', '$broadcast'], function (method) {
      it(`calls listeners registered for matching events on : ${method}`, function () {
        let listener1 = jest.fn();
        let listener2 = jest.fn();
        scope.$on('someEvent', listener1);
        scope.$on('someOtherEvent', listener2);
        scope[method]('someEvent');
        expect(listener1).toHaveBeenCalled();
        expect(listener2).not.toHaveBeenCalled();
      });

      it(`passes an an event object with the same name : ${method}`, function () {
        let listener = jest.fn();
        scope.$on('someEvent', listener);

        scope[method]('someEvent');

        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[listener.mock.calls.length - 1][0].name).toEqual('someEvent');
      });

      it(`passes the same event object to each listener on : ${method}`, function () {
        let listener1 = jest.fn();
        let listener2 = jest.fn();

        scope.$on('someEvent', listener1);
        scope.$on('someEvent', listener2);

        scope[method]('someEvent');

        let event1 = listener1.mock.calls[listener1.mock.calls.length - 1][0].name;
        let event2 = listener2.mock.calls[listener2.mock.calls.length - 1][0].name;

        expect(event1).toBe(event2);
      });

      it(`passes additional argument on Emit for $on to receive : ${method}`, function () {
        let listener = jest.fn();

        scope.$on('someEvent', listener);

        scope[method]('someEvent', 'firstArgument', ['secondArgument1', 'secondArgument2'], 3);

        expect(listener.mock.calls[listener.mock.calls.length - 1][0].name).toEqual('someEvent');
        expect(listener.mock.calls[listener.mock.calls.length - 1][1]).toEqual('firstArgument');
        expect(listener.mock.calls[listener.mock.calls.length - 1][2]).toEqual(['secondArgument1', 'secondArgument2']);
        expect(listener.mock.calls[listener.mock.calls.length - 1][3]).toEqual(3);
      });

      it(`returns the event of the object : ${method}`, function () {
        let returnedObject = scope[method]('someEvent');

        expect(returnedObject).toBeDefined();
        expect(returnedObject.name).toBe('someEvent');
      });

      it(`deregister the events from the listener : ${method}`, function () {
        let mock = jest.fn();
        let deregister = scope.$on('someEvent', mock);

        deregister();
        scope[method]('someEvent');

        expect(mock).not.toHaveBeenCalled();
      });

      it(`does not skip next listener when it is removed from a listener: ${method} `, function () {
        let deregister;

        let listener = function () {
          deregister();
        };

        let listener2 = jest.fn();

        deregister = scope.$on('firstEvent', listener);
        scope.$on('firstEvent', listener2);

        scope[method]('firstEvent');

        expect(listener2).toHaveBeenCalled();
      });
    });

    it('propagates up to the scope hierarchy $emit', function () {
      let parentListener = jest.fn();
      let childListener = jest.fn();

      parent.$on('someEvent', parentListener);
      scope.$on('someEvent', childListener);

      scope.$emit('someEvent');

      expect(parentListener).toHaveBeenCalled();
      expect(childListener).toHaveBeenCalled();
    });

    it('propagates the same event up with $emit', function () {
      let parentListener = jest.fn();
      let childListener = jest.fn();

      scope.$on('someEvent', parentListener);
      scope.$on('someEvent', childListener);

      scope.$emit('someEvent');

      let parentArg = parentListener.mock.calls[parentListener.mock.calls.length - 1][0].name;
      let childArg = childListener.mock.calls[childListener.mock.calls.length - 1][0].name;
      expect(parentArg).toEqual(childArg);
    });

    it('propagates down to the scope hierarchy $broadcast', function () {
      let parentListener = jest.fn();
      let childListener = jest.fn();
      let isolatedListener = jest.fn();

      parent.$on('someEvent', parentListener);
      scope.$on('someEvent', childListener);
      isolatedChild.$on('someEvent', isolatedListener);

      parent.$broadcast('someEvent');

      expect(parentListener).toHaveBeenCalled();
      expect(childListener).toHaveBeenCalled();
      expect(isolatedListener).toHaveBeenCalled();
    });

    it('propagates down same event down with $broadcast', function () {
      let parentListener = jest.fn();
      let childListener = jest.fn();

      parent.$on('someEvent', parentListener);
      scope.$on('someEvent', childListener);

      parent.$broadcast('someEvent');

      let parentArg = parentListener.mock.calls[parentListener.mock.calls.length - 1][0].name;
      let childArg = childListener.mock.calls[childListener.mock.calls.length - 1][0].name;
      expect(parentArg).toEqual(childArg);
    });

    it('includes the current and targeted scope in the event object emit', function () {
      let scopeListener = jest.fn();
      let childListener = jest.fn();

      scope.$on('someEvent', scopeListener);
      parent.$on('someEvent', childListener);

      scope.$emit('someEvent');

      expect(scopeListener.mock.calls[scopeListener.mock.calls.length - 1][0].targetScope).toEqual(scope);
      expect(childListener.mock.calls[childListener.mock.calls.length - 1][0].targetScope).toEqual(scope);
    });

    it('includes the current and targeted scope in the event object broadcast', function () {
      let scopeListener = jest.fn();
      let parentListener = jest.fn();

      scope.$on('someEvent', scopeListener);
      child.$on('someEvent', parentListener);

      scope.$broadcast('someEvent');

      expect(scopeListener.mock.calls[scopeListener.mock.calls.length - 1][0].targetScope).toEqual(scope);
      expect(parentListener.mock.calls[parentListener.mock.calls.length - 1][0].targetScope).toEqual(scope);
    });

    it('attaches the current scope in propagation in the event emit', function () {
      let currentScopeOnScope = null;
      let currentScopeOnParent = null;

      let scopeListener = function (event) {
        currentScopeOnScope = event.currentScope;
      };
      let parentListener = function (event) {
        currentScopeOnParent = event.currentScope;
      };

      scope.$on('someEvent', scopeListener);
      parent.$on('someEvent', parentListener);

      scope.$emit('someEvent');

      expect(currentScopeOnScope).toBe(scope);
      expect(currentScopeOnParent).toBe(parent);
    });

    it('attaches the current scope in propagation in the event broadcast', function () {
      let currentScopeOnScope = null;
      let currentScopeOnChild = null;

      let scopeListener = function (event) {
        currentScopeOnScope = event.currentScope;
      };
      let childListener = function (event) {
        currentScopeOnChild = event.currentScope;
      };

      scope.$on('someEvent', scopeListener);
      child.$on('someEvent', childListener);

      scope.$broadcast('someEvent');

      expect(currentScopeOnScope).toBe(scope);
      expect(currentScopeOnChild).toBe(child);
    });

    it('sets current Index null after propagation is over', function () {
      let event = null;
      let event1 = null;
      let scopeListener = function (evt) {
        event = evt;
      };
      let scopeListener1 = function (evt) {
        event1 = evt;
      };
      scope.$on('someEvent', scopeListener);
      scope.$on('someEventForBroadcast', scopeListener1);

      scope.$emit('someEvent');
      scope.$broadcast('someEventForBroadcast');

      expect(event.currentScope).toBe(null);
      expect(event1.currentScope).toBe(null);
    });

    it('does not propagate the event if stopped parent emit', function () {
      let scopeListener = function (event) {
        event.stopPropagation();
      };

      let parentListener = jest.fn();

      scope.$on('someEvent', scopeListener);
      parent.$on('someEvent', parentListener);

      scope.$emit();

      expect(parentListener).not.toHaveBeenCalled();
    });

    it('does not propagate the event will receive on the same scope', function () {
      let scopeListener = function (event) {
        event.stopPropagation();
      };

      let sameScopeListener = jest.fn();

      scope.$on('someEvent', scopeListener);
      scope.$on('someEvent', sameScopeListener);

      scope.$emit('someEvent');

      expect(sameScopeListener).toHaveBeenCalled();
    });

    it('does prevent the default', function () {
      let scopeListener = function (event) {
        event.preventDefault();
      };

      let scopeMock = jest.fn();

      scope.$on('someEvent', scopeListener);
      scope.$on('someEvent', scopeMock);

      let event1 = scope.$emit('someEvent');
      let event2 = scope.$broadcast('someEvent');

      expect(event1.defaultPrevented).toBeTruthy();
      expect(event2.defaultPrevented).toBeTruthy();
    });

    it('fires a destroy when it is removed', function () {
      let listener = jest.fn();
      scope.$on('$destroy', listener);

      scope.$destroy();

      expect(listener).toHaveBeenCalled();
    });

    it('fires a destroy children when it is removed', function () {
      let listener = jest.fn();
      child.$on('$destroy', listener);

      scope.$destroy();

      expect(listener).toHaveBeenCalled();
    });

    it('no longer calls listeners after destroyed', function () {
      let listener = jest.fn();
      scope.$on('myEvent', listener);

      scope.$destroy();

      scope.$emit('myEvent');
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not stop when exception is thrown', function () {
      let listener1 = function () {
        throw '$emit throw error';
      };
      let listener2 = function () {
        throw '$broadcast throw error';
      };

      let listener3 = jest.fn();
      let listener4 = jest.fn();

      scope.$on('someEvent$emit', listener1);
      scope.$on('someEvent$emit', listener3);

      scope.$on('someEvent$broadcast', listener2);
      scope.$on('someEvent$broadcast', listener4);

      scope.$emit('someEvent$emit');
      scope.$broadcast('someEvent$broadcast');

      expect(listener3).toHaveBeenCalled();
      expect(listener4).toHaveBeenCalled();
    });
  });
});
