import Scope from 'modules/Scope';

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
  });
});
