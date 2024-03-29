import Scope from 'modules/Scope';
import LibHelper from 'util/LibHelper';

describe('Scope', () => {
  it('should check whether properties can bind to it', function () {
    const scope = new Scope();
    const propertyValue = 'propValue';
    scope.aProperty = propertyValue;
    expect(scope.aProperty).toBe(propertyValue);
  });

  describe('Digest', () => {
    let scope: Scope;

    beforeEach(() => {
      scope = new Scope();
    });

    it('should call the listener function of a watch on first $digest', () => {
      const watcherFn = () => {
        return 'Watcher';
      };
      const listenerFnMock = jest.fn();
      scope.$watch(watcherFn, listenerFnMock);
      scope.$digest();
      expect(listenerFnMock).toHaveBeenCalled();
    });

    it('should call the watch function with the scope as the argument', () => {
      const watchFn = jest.fn();
      const listenerFn = () => {};
      scope.$watch(watchFn, listenerFn);
      scope.$digest();
      expect(watchFn).toHaveBeenCalledWith(scope);
    });

    it('should call the listener when the variable value changes', () => {
      scope.aVariable = 10;
      scope.counter = 0;
      const listenerMock = jest.fn((newValue: unknown, oldValue: unknown, scope: Scope) => {
        scope.counter++;
      });

      scope.$watch((scope) => {
        return scope.aVariable;
      }, listenerMock);

      expect(scope.counter).toBe(0);
      expect(listenerMock).not.toHaveBeenCalled();

      scope.$digest();
      expect(scope.counter).toBe(1);
      expect(listenerMock).toHaveBeenCalledTimes(1);

      scope.$digest();
      expect(scope.counter).toBe(1);
      expect(listenerMock).toHaveBeenCalledTimes(1);

      scope.aVariable = 11;
      scope.$digest();
      expect(scope.counter).toBe(2);
      expect(listenerMock).toHaveBeenCalledTimes(2);

      scope.aVariable = 12;
      scope.$digest();
      expect(scope.counter).toBe(3);
      expect(listenerMock).toHaveBeenCalledTimes(3);
    });

    it('should call the $watch on initialization point', () => {
      scope.counter = 0;

      const listenerMock = jest.fn((newValue: unknown, oldValue: unknown, scope: Scope) => {
        scope.counter++;
      });

      scope.$watch(function (scope) {
        return scope.someUndefined;
      }, listenerMock);

      scope.$digest();
      expect(listenerMock).toHaveBeenCalledTimes(1);
      expect(scope.counter).toBe(1);
    });

    it('should call listener with new value as old value the first time', () => {
      scope.someValue = 'someValue';
      let oldGlobalValue: string;

      scope.$watch(
        (scope) => scope.someValue,
        (newValue: string, oldValue: string) => {
          oldGlobalValue = oldValue;
        },
      );

      scope.$digest();
      expect(oldGlobalValue).toBe(scope.someValue);
    });

    it('should call the watchers even if omit the listener function', () => {
      const watchFn = jest.fn().mockReturnValueOnce('Something');
      scope.$watch(watchFn);
      scope.$digest();
      expect(watchFn).toHaveBeenCalled();
    });

    it('should trigger chained watchers in the same digest', () => {
      scope.name = 'jane';

      scope.$watch(
        () => scope.nameUpper,
        (newValue: string) => {
          if (newValue) {
            scope.initial = `${newValue.substring(0, 1)}.`;
          }
        },
      );

      scope.$watch(
        () => scope.name,
        (newValue: string) => {
          if (newValue) {
            scope.nameUpper = newValue.toUpperCase();
          }
        },
      );

      scope.$digest();
      expect(scope.initial).toBe(`${scope.name[0].toUpperCase()}.`);

      scope.name = 'bob';
      scope.$digest();
      expect(scope.initial).toBe(`${scope.name[0].toUpperCase()}.`);
    });

    it('should throw an error during unstable digest', () => {
      scope.counter1 = 0;
      scope.counter2 = 0;

      scope.$watch(
        () => scope.counter1,
        () => {
          scope.counter2++;
        },
      );

      scope.$watch(
        () => scope.counter2,
        () => {
          scope.counter1++;
        },
      );

      expect(() => {
        scope.$digest();
      }).toThrow();
    });

    it('should ends the digest when the last watch is clean', () => {
      scope.array = LibHelper.range(100);
      let watchExecutions = 0;

      for (let i = 0; i < scope.array.length; i++) {
        scope.$watch(() => {
          watchExecutions++;
          return scope.array[i];
        });
      }

      scope.$digest();
      expect(watchExecutions).toBe(200);

      scope.array[0] = 420;
      scope.$digest();
      expect(watchExecutions).toBe(301);
    });

    it('should not end digest so that new watches are not in run', () => {
      scope.AValue = 'aValue';
      scope.counter = 0;

      const embeddedWatcherMock = jest.fn(() => {
        scope.counter++;
      });

      scope.$watch(
        (scope) => scope.aValue,
        (newValue, oldValue, scope) => {
          scope.$watch((scope) => scope.aValue, embeddedWatcherMock);
        },
      );

      scope.$digest();
      expect(scope.counter).toBe(1);
      expect(embeddedWatcherMock).toHaveBeenCalledTimes(1);
    });

    it('should make a digest if the content of an array is changed', () => {
      scope.aValue = [1, 2, 3];
      scope.counter = 0;

      const watcherMock = jest.fn((newValue, oldValue, scope) => {
        scope.counter++;
      });

      scope.$watch((scope) => scope.aValue, watcherMock, true);

      scope.$digest();
      expect(scope.counter).toBe(1);
      expect(watcherMock).toHaveBeenCalledTimes(1);

      scope.aValue.push(4);
      scope.$digest();
      expect(scope.counter).toBe(2);
      expect(watcherMock).toHaveBeenCalledTimes(2);
    });

    it('correctly handles NaNs', () => {
      scope.number = 0 / 0; // NaN
      scope.counter = 0;
      const watcherMock = jest.fn((newValue, oldValue, scope) => {
        scope.counter++;
      });
      scope.$watch((scope) => scope.number, watcherMock);
      scope.$digest();
      expect(scope.counter).toBe(1);
      scope.$digest();
      expect(scope.counter).toBe(1);
    });
  });
});
