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


    it("can parse string in a single quote",function (){

    });
});