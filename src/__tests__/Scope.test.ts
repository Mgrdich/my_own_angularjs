import Scope from 'modules/Scope';

describe('Index', () => {
  it('should check whether properties can bind to it', function () {
    const scope = new Scope();
    const propertyValue = 'propValue';
    scope.aProperty = propertyValue;
    expect(scope.aProperty).toBe(propertyValue);
  });
});
