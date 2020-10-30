const parse = require("../src/parse");
const Lib = require("../src/util/functions");


describe("Parse", function () {

    it("can parse an integer", function () {
        let fn = parse('42');
        expect(fn).toBeDefined();
        expect(fn()).toBe(42);
    });

});