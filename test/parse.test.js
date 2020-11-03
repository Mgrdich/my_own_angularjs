const parse = require("../src/parse");
const Lib = require("../src/util/functions");


describe("Parse", function () {

    it("can parse an integer", function () {
        let fn = parse('42');
        expect(fn).toBeDefined();
        expect(fn()).toBe(42);
    });


    it("parse floating numbers",function (){
        let fn = parse('4.2');
        expect(fn()).toBe(4.2);
    });


    it("parse floating numbers without integer part",function (){
        let fn = parse('.2');
        expect(fn()).toBe(0.2);
    });


    it("parsing scientific notations",function (){
       let fn = parse('42e3');
       expect(fn()).toBe(42000);
    });


    it("parsing scientific notations starts with point",function (){
       let fn = parse('.42e3');
       expect(fn()).toBe(420);
    });


    it("parsing scientific notations starts with negative exponents",function (){
       let fn = parse('4200e-2');
       expect(fn()).toBe(42);
    });


    it("can parse scientific notation with the + sign", function() {
        let fn = parse( '.42e+2');
        expect(fn()).toBe(42);
    });


    it("can parse upper case scientific notation", function() {
        let fn = parse( '.42E2' );
        expect(fn()).toBe(42);
    });


    it("will not parse invalid scientific notation", function() {
        expect(function() { parse('42e-'); }).toThrow();
        expect(function() { parse('42e-a'); }).toThrow();
    });


    it("can parse string in a double quote",function (){
        let fn = parse('"abc"');
        expect(fn()).toBe('abc');
    });


    it("can parse string in a single quote",function (){
        let fn = parse("'abc'");
        expect(fn()).toBe('abc');
    });


    it("will not parse a string with mismatching quotes", function () {
        //first should equal the last
        expect(function () {
            parse('"abc\'');
        }).toThrow();
    });


    it("can parse a string with a single quote inside",function () {
       let fn = parse("'a\\\'b'"); //with one backslash is escaping the second slash
       expect(fn()).toEqual('a\'b'); //with third is escaping the double quote
        expect(fn()).toEqual("a'b"); //with third is escaping the double quote
    });


    it('can parse a string with double quotes inside', function () {
        let fn = parse('"a\\\"b"'); //with one backslash is escaping the second slash
        expect(fn()).toEqual("a\"b"); //with third is escaping the double quote
        expect(fn()).toEqual('a"b');
    });
});