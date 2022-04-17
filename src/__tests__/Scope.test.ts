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
      const listenerFn = function () {};
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

      scope.$watch(function (scope) {
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
  });
});
