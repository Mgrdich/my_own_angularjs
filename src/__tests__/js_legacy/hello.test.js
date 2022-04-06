// eslint-disable-next-line @typescript-eslint/no-var-requires
let sayHello = require('js_legacy/hello');

describe('Hello', function () {
  it('says hello', function () {
    expect(sayHello()).toBe('Hello, world!');
  });
});
