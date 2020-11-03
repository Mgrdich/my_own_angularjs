/**
 * @description File
 * This function takes an expression string and returns a function. That function executes
 * the expression by evaluating it as JavaScript code. It also sets the context of the code to
 * be a scope object using the JavaScript with statement.
 */

const Lib = require("../src/util/functions");
const def = new Lib();

let ESCAPES = {
    'n': '\n',
    'f': '\f',
    'r': '\r',
    't': '\t',
    'v': '\v',
    '\'': '\'',
    '"': '"',
};

function parse(expr) {
    let lexer = new Lexer();
    let parser = new Parser(lexer);
    return parser.parse(expr);
}

/**
 * @description Graphical explanation
 * 'a + b'
 * ---- Lexer ---->
 * Tokens [{text:'a',identifier:true},{text:'+'},{text:'b',identifier:true}]
 *
 * ---- AST Builder ----->
 * {type: AST.BinaryExpression,operator: '+',left: {type: AST.Identifier,name: 'a'},right: {type: AST.Identifier,name: 'b'}}
 *
 * ---- AST Compiler ----->
 * function(scope) {return scope.a + scope.b;}
 * */

/*------------------------------------------ Parser ------------------------------------------*/
/**
 * @description Parser is a constructor function that constructs the complete parsing pipeline from
 * the pieces outlined above. It takes a Lexer as an argument , and has a method called parse:
 * @param lexer {Lexer}
 * */
function Parser(lexer) {
    this.lexer = lexer; //initial empty lexer
    this.ast = new AST(this.lexer); //build ast from Lexer
    this.astCompiler = new ASTCompiler(this.ast);
}

Parser.prototype.parse = function (text) {
    return this.astCompiler.compile(text);
};


/*------------------------------------------ Lexer ------------------------------------------*/

/**
 * @description The Lexer takes the original expression string and returns an array of tokens parsed
 * from that string. For example, the string "a + b" would result in tokens for a, +,and b
 * */
function Lexer() {}

Lexer.prototype.lex = function (text){
    //Tokenization will be done here
    this.text = text;
    this.index = 0; //out current character index in string
    this.ch = undefined; //current character but why not a local variable?
    this.tokens = [];

    while (this.index < this.text.length) { //where we will add different kind of characters
        this.ch = this.text.charAt(this.index);
        if (this.isNumber(this.ch) || this.ch === '.' && this.isNumber(this.peek())) {
            this.readNumber();
        } else if (this.ch === '\'' || this.ch === '"') { //keep in mind this inside original string quote
            this.readString(this.ch);
        } else {
            throw `Unexpected next character ${this.ch}`;
        }
    }
    return this.tokens;
};

Lexer.prototype.isNumber = function (ch) {
    return '0' <= ch && ch <= '9';
};

Lexer.prototype.readNumber = function () {
    //loops after finding one number to check for more
    let numberAsString = '';
    while (this.index < this.text.length) {
       let ch = this.text.charAt(this.index).toLowerCase();
        if(ch === '.' || this.isNumber(ch)){
            numberAsString += ch;
        } else { //scientific notation
            let nextCh = this.peek();
            let prevCh = numberAsString.charAt(numberAsString.length - 1);
            if(ch === 'e' && this.isExpOperator(nextCh)){ //e+ e- e1 pointer on the exponent
                numberAsString +=ch;
            } else if(this.isExpOperator(ch) && prevCh === 'e' && nextCh && this.isNumber(nextCh)){
                //first e+ e- e2 - but pointer now is on operator check after the number is there number
                numberAsString +=ch;
            } else if(this.isExpOperator(ch) && prevCh === 'e' && !nextCh || !this.isNumber(nextCh)){
                throw "Invalid Exponent";
            } else {
                break;
            }
        }
        this.index++;
    }
    this.tokens.push({
        text:numberAsString,
        value:Number(numberAsString)
    });
};

Lexer.prototype.readString = function (quote) {
    this.index++; //skip the quote character
    let string = '';
    let escape = false;

    while (this.index < this.text.length) {
        let ch = this.text.charAt(this.index); //current character

        if (escape) {
            let replacement = ESCAPES[ch]; //after / which character did we see replace it 
            if (replacement) {
                string += replacement;
            } else {
                string += ch;
            }
            escape = false;
        } else if (quote === ch) { //first quote check is done up should equal to last quote
            this.index++; //last character skip
            this.tokens.push({
                text: string,
                value: string
            });
            return ; //this will terminate and indicate quotes match
        } else if (ch === '\\') { //when backslash \ is escaped by another backslash checking for one backslash as string
            escape = true; //then applying regular escape characters on it
        } else {
            string += ch;
        }

        this.index++;
    }
    throw 'Unmatched quote';
};

Lexer.prototype.peek = function () {  //it looks at the next char without moving the index
    if (this.index < this.text.length - 1) {
        return this.text.charAt(this.index + 1);
    }
    return false;
};

Lexer.prototype.isExpOperator = function (ch){
    return ch === '-' || ch === '+' || this.isNumber(ch);
};

/*------------------------------------------ AST ------------------------------------------*/
/**
 * @description The AST Builder takes the array of tokens generated by the lexer, and builds up an
 * Abstract Syntax Tree (AST) from them. The tree represents the syntactic structure
 * of the expression as nested JavaScript objects.
 * {
 *     type:AST.Program,
 *     body:{
 *         type:AST.Literal,
 *         value:42
 *     }
 * }
 * @param lexer {Lexer}
 * */
function AST(lexer) {
    this.lexer = lexer;
}

AST.Program = 'Program'; //const
AST.Literal = 'Literal'; //const

AST.prototype.ast = function (text) {
    this.tokens = this.lexer.lex(text); //taking token form the lexer
    return this.program();
};

AST.prototype.program = function () {
    return {type: AST.Program, body: this.constant()};
};

AST.prototype.constant = function () {
    return {type: AST.Literal, value: this.tokens[0].value};
};


/*------------------------------------------ ASTCompiler ------------------------------------------*/
/**
 * @description The AST Compiler takes the abstract syntax tree and compiles it into a JavaScript
 * function that evaluates the expression represented in the tree
 * @param astBuilder {AST}
 * */
function ASTCompiler(astBuilder) {
    this.astBuilder = astBuilder; //taking the builder form ast
}

ASTCompiler.prototype.stringEscapeRegex = /[^ a-zA-Z0-9]/g;

ASTCompiler.prototype.stringEscapeFn = function (c){
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
};

ASTCompiler.prototype.compile = function (text){
    let ast = this.astBuilder.ast(text);
    //AST compilation will be done here
    this.state = {body: []};
    this.recurse(ast);

    return new Function(this.state.body.join(''));
};

ASTCompiler.prototype.recurse = function (ast) { //param is the ast structure not the instructor
    switch (ast.type){
        case AST.Program:
            this.state.body.push('return ',this.recurse(ast.body),';');
            break;
        case AST.Literal:
            return this.escape(ast.value);
    }
};

ASTCompiler.prototype.escape = function (value){
    if(def.Lo.isString(value)){
        return '\'' + value.replace(this.stringEscapeRegex,this.stringEscapeFn) + '\'';
    } else {
        return value;
    }
};

module.exports = parse;