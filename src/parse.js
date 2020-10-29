//This function takes an expression string and returns a function. That function executes
//the expression by evaluating it as JavaScript code. It also sets the context of the code to
//be a scope object using the JavaScript with statement.

export default function parse(expr) {
    let lexer = new Lexer();
    let parser = new Parser(lexer);
    return parser.parse(expr);
}

/*------------------------------------------ Parser ------------------------------------------*/
/**
 * @description Parser is a constructor function that constructs the complete parsing pipeline from
   the pieces outlined above. It takes a Lexer as an agument, and has a method called parse:
 * */
function Parser(lexer) {
    this.lexer = lexer;
    this.ast = new AST(this.lexer);
    this.astCompiler = new ASTCompiler(this.ast);
}

Parser.prototype.parse = function (text) {
    return this.astCompiler.compile(text);
}


/*------------------------------------------ Lexer ------------------------------------------*/

/**
 * @description The Lexer takes the original expression string and returns an array of tokens parsed
   from that string. For example, the string "a + b" would result in tokens for a, +,and b
 * */
function Lexer() {}

Lexer.prototype.lex = function (text){
    //Tokenization will be done here

}

/*------------------------------------------ AST ------------------------------------------*/
/**
 * @description The AST Builder takes the array of tokens generated by the lexer, and builds up an
   Abstract Syntax Tree (AST) from them. The tree represents the syntactic structure
   of the expression as nested JavaScript objects.
 * */
function AST(lexer) {
    this.lexer = lexer;
}

AST.prototype.ast = function (text) {
    this.tokens = this.lexer.lex(text);
}


/*------------------------------------------ ASTCompiler ------------------------------------------*/
/**
 * @description The AST Compiler takes the abstract syntax tree and compiles it into a JavaScript
   function that evaluates the expression represented in the tree
 * */
function ASTCompiler(astBuilder) {
    this.astBuilder = astBuilder;
}

ASTCompiler.prototype.compile = function (text){
    let ast = this.astBuilder.ast(text);
    //AST compilation will be done here
}