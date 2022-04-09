import sayHello from 'js_legacy/hello';

describe('Hello', function () {
  it('says hello', function () {
    expect(sayHello()).toBe('Hello, world!');
  });
});
