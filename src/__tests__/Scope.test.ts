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
  });
});
