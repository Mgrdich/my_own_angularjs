let sayHello = require("../src/hello");
describe("Hello", function () {
    it("says hello", function () {
         expect(sayHello()).toBe("Hello, world!");
    });
});

