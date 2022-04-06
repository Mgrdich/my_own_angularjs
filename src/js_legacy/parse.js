/**
 * @description File
 * This function takes an expression string and returns a function. That function executes
 * the expression by evaluating it as JavaScript code. It also sets the context of the code to
 * be a scope object using the JavaScript with statement.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Lib = require('util/functions');
const def = new Lib();

let ESCAPES = {
  n: '\n',
  f: '\f',
  r: '\r',
  t: '\t',
  v: '\v',
  "'": "'",
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
 *
 *
 * Map of call Function
 * parse -----> ASTCompiler.compile ----> ASTCompiler has AST instance ----> AST.ast() ------> Lexer.lex
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

Lexer.prototype.lex = function (text) {
  //Tokenizing will be done here
  this.text = text;
  this.index = 0; //out current character index in string
  this.ch = undefined; //current character but why not a local variable?
  this.tokens = [];

  while (this.index < this.text.length) {
    //where we will add different kind of characters
    this.ch = this.text.charAt(this.index);
    if (this.isNumber(this.ch) || (this.is('.') && this.isNumber(this.peek()))) {
      this.readNumber();
    } else if (this.isString()) {
      //keep in mind this inside original string quote
      this.readString(this.ch);
    } else if (this.isIdentifierSymboles()) {
      //todo check is it valid name
      this.tokens.push({
        text: this.ch,
      });
      this.index++;
    } else if (this.isIdentifier(this.ch)) {
      this.readIdentifier();
    } else if (this.isWhiteSpace(this.ch)) {
      this.index++;
    } else {
      throw `Unexpected next character ${this.ch}`;
    }
  }
  return this.tokens;
};

Lexer.prototype.is = function (chs) {
  //checking for any character
  return chs.indexOf(this.ch) >= 0;
};

Lexer.prototype.isNumber = function (ch) {
  return '0' <= ch && ch <= '9';
};

Lexer.prototype.isString = function () {
  return this.is('\'"');
};

Lexer.prototype.isIdentifierSymboles = function () {
  return this.is('[],{}:.()');
};

Lexer.prototype.isIdentifier = function (ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
};

Lexer.prototype.isWhiteSpace = function (ch) {
  return ch === ' ' || ch === '\r' || ch === '\t' || ch === '\v' || ch === '\n' || ch === '\u00A0';
};

Lexer.prototype.isExpOperator = function (ch) {
  return ch === '-' || ch === '+' || this.isNumber(ch);
};

Lexer.prototype.readNumber = function () {
  //loops after finding one number to check for more
  let numberAsString = '';
  while (this.index < this.text.length) {
    let ch = this.text.charAt(this.index).toLowerCase();

    if (ch === '.' || this.isNumber(ch)) {
      numberAsString += ch;
    } else {
      //scientific notation
      let nextCh = this.peek();
      let prevCh = numberAsString.charAt(numberAsString.length - 1);
      if (ch === 'e' && this.isExpOperator(nextCh)) {
        //e+ e- e1 pointer on the exponent
        numberAsString += ch;
      } else if (this.isExpOperator(ch) && prevCh === 'e' && nextCh && this.isNumber(nextCh)) {
        //first e+ e- e2 - but pointer now is on operator check after the number is there number
        numberAsString += ch;
      } else if (this.isExpOperator(ch) && prevCh === 'e' && (!nextCh || !this.isNumber(nextCh))) {
        //e+  e-s Invalid
        throw 'Invalid Exponent';
      } else {
        break; //break from loop continuation whatever it is not a number
      }
    }
    this.index++; //push to the next symbol and check it does work break
  }
  this.tokens.push({
    text: numberAsString,
    value: Number(numberAsString),
  });
};

Lexer.prototype.readString = function (quote) {
  this.index++; //skip the quote character
  let string = '';
  let escape = false;

  while (this.index < this.text.length) {
    let ch = this.text.charAt(this.index); //current character

    if (escape) {
      if (ch === 'u') {
        let hex = this.text.substring(this.index + 1, this.index + 5);
        if (!hex.match(/[\da-f]{4}/i)) {
          throw 'Invalid unicode escape';
        }
        this.index += 4; //jump over the hex
        string += String.fromCharCode(parseInt(hex, 16));
      } else {
        let replacement = ESCAPES[ch]; //after / which character did we see replace it
        if (replacement) {
          string += replacement;
        } else {
          string += ch;
        }
      }

      escape = false;
    } else if (quote === ch) {
      //first quote check is done up should equal to last quote
      this.index++; //last character skip
      this.tokens.push({
        text: string,
        value: string,
      });
      return; //this will terminate and indicate quotes match
    } else if (ch === '\\') {
      //when backslash \ is escaped by another backslash checking for one backslash as string
      escape = true; //then applying regular escape characters on it
    } else {
      string += ch;
    }

    this.index++;
  }
  throw 'Unmatched quote';
};

Lexer.prototype.readIdentifier = function () {
  let text = '';
  while (this.index < this.text.length) {
    let ch = this.text.charAt(this.index);
    if (this.isIdentifier(ch) || this.isNumber(ch)) {
      text += ch;
    } else {
      break;
    }
    this.index++;
  }
  let token = { text: text, identifier: true };
  this.tokens.push(token);
};

Lexer.prototype.peek = function () {
  //it looks at the next char without moving the index
  if (this.index < this.text.length - 1) {
    return this.text.charAt(this.index + 1);
  }
  return false;
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

/**
 * @description Constants
 * */
AST.Program = 'Program';
AST.Literal = 'Literal';
AST.Property = 'Property';
AST.ArrayExpression = 'ArrayExpression';
AST.ObjectExpression = 'ObjectExpression';
AST.Identifier = 'Identifier';
AST.ThisExpression = 'ThisExpression';
AST.MemberExpression = 'MemberExpression';
AST.CallExpression = 'CallExpression';

AST.prototype.constants = {
  null: { type: AST.Literal, value: null },
  true: { type: AST.Literal, value: true },
  false: { type: AST.Literal, value: false },
  this: { type: AST.ThisExpression },
};

AST.prototype.ast = function (text) {
  //array of instructions that were parsed
  this.tokens = this.lexer.lex(text); //taking token form the lexer
  return this.program();
};

AST.prototype.program = function () {
  return { type: AST.Program, body: this.primary() };
};

AST.prototype.primary = function () {
  let primary;
  if (this.expect('[')) {
    primary = this.arrayDeclaration();
  } else if (this.expect('{')) {
    primary = this.object();
  } else if (this.constants.hasOwnProperty(this.tokens[0].text)) {
    primary = this.constants[this.consume().text];
  } else if (this.peek().identifier) {
    primary = this.identifier();
  } else {
    primary = this.constant();
  }

  let next;

  while ((next = this.expect('.', '[', '('))) {
    if (next.text === '[') {
      primary = {
        type: AST.MemberExpression,
        object: primary,
        property: this.primary(),
        computed: true,
      };
      this.consume(']');
    } else if (next.text === '.') {
      primary = {
        type: AST.MemberExpression,
        object: primary,
        property: this.identifier(),
        computed: false,
      };
    } else {
      primary = {
        type: AST.CallExpression,
        callee: primary,
        arguments: this.parseArguments(),
      };
      this.consume(')');
    }
  }

  return primary;
};

AST.prototype.constant = function () {
  return { type: AST.Literal, value: this.consume().value };
};

AST.prototype.identifier = function () {
  return { type: AST.Identifier, name: this.consume().text };
};

AST.prototype.arrayDeclaration = function () {
  let elements = [];
  if (!this.peek(']')) {
    //checking whether array is closed immediately empty array
    do {
      if (this.peek(']')) {
        //to support the trailing comma to break out early
        break;
      }
      elements.push(this.primary());
    } while (this.expect(','));
  }
  this.consume(']');
  return { type: AST.ArrayExpression, elements: elements };
};

AST.prototype.object = function () {
  let properties = [];
  if (!this.peek('}')) {
    do {
      let property = { type: AST.Property };
      if (this.peek().identifier) {
        //An object’s keys are not always strings.
        property.key = this.identifier();
      } else {
        property.key = this.constant(); //string case
      }
      this.consume(':');
      property.value = this.primary(); //if it is embedded object recursive else returns the Value
      properties.push(property);
    } while (this.expect(','));
  }

  this.consume('}');
  return { type: AST.ObjectExpression, properties: properties };
};

AST.prototype.peek = function (e1, e2, e3, e4) {
  //TODO do it with spread
  if (this.tokens.length > 0) {
    let text = this.tokens[0].text;
    if (text === e1 || text === e2 || text === e3 || text === e4 || (!e1 && !e2 && !e3 && !e4)) {
      //peek the first character
      return this.tokens[0];
    }
  }
};

AST.prototype.expect = function (e1, e2, e3, e4) {
  //TODO do it with spread
  //Note that expect can also be called with no arguments, in which case it’ll process whatever token is next.
  let token = this.peek(e1, e2, e3, e4);
  if (token) {
    return this.tokens.shift(); //remove it from the Token Consume the Token
  }
};

AST.prototype.consume = function (e) {
  let token = this.expect(e);
  if (!token) {
    throw `Unexpected. Expecting: ${e}`;
  }
  return token;
};

AST.prototype.parseArguments = function () {
  let args = [];
  if (!this.peek(')')) {
    do {
      args.push(this.primary());
    } while (this.expect(','));
  }
  return args;
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

ASTCompiler.prototype.stringEscapeFn = function (c) {
  //we get the unicode replacement of a the escaping
  return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
};

ASTCompiler.prototype.compile = function (text) {
  let ast = this.astBuilder.ast(text);

  //AST compilation will be done here
  this.state = { body: [], nextId: 0, vars: [] };

  this.recurse(ast);

  let funBody;
  if (this.state.vars.length) {
    funBody = `var ${this.state.vars.join(',')};`;
  } else {
    funBody = '';
  }
  funBody += this.state.body.join('');

  /**
   * s stands for scope parameter
   * l stands for local parameter
   * */
  return new Function('s', 'l', funBody); //giving args
};

ASTCompiler.prototype.nonComputedMember = function (left, right) {
  return `(${left}).${right}`; //return s.Something
};

ASTCompiler.prototype.computedMember = function (left, right) {
  return `(${left})[${right}]`;
};

ASTCompiler.prototype.nextId = function () {
  let id = `v${this.state.nextId++}`;
  this.state.vars.push(id);
  return id;
};

ASTCompiler.prototype.if_ = function (test, consequent) {
  this.state.body.push('if(', test, '){', consequent, '}');
};

ASTCompiler.prototype.not = function (e) {
  return `!(${e})`;
};

ASTCompiler.prototype.getHasOwnProperty = function (object, property) {
  return `${object} && (${this.escape(property)} in ${object})`;
};

ASTCompiler.prototype.assign = function (id, value) {
  return `${id}=${value};`;
};

ASTCompiler.prototype.nextId = function () {
  return `v${this.state.nextId++}`;
};

ASTCompiler.prototype.recurse = function (ast, context) {
  //param is the ast structure not the instructor
  let intoId;
  switch (ast.type) {
    case AST.Program:
      this.state.body.push('return ', this.recurse(ast.body), ';');
      break;
    case AST.Literal:
      return this.escape(ast.value);
    case AST.ArrayExpression:
      let elements = ast.elements.map((elem) => {
        return this.recurse(elem);
      });
      return `[${elements.join(',')}]`;
    case AST.ObjectExpression:
      let properties = ast.properties.map((property) => {
        //key string or an identifier
        let key = property.key.type === AST.Identifier ? property.key.name : this.escape(property.key.value);
        let value = this.recurse(property.value);
        return `${key}:${value}`;
      });
      return `{${properties.join(',')}}`;
    case AST.Identifier:
      intoId = this.nextId();
      //if local parameter exist
      this.if_(this.getHasOwnProperty('l', ast.name), this.assign(intoId, this.nonComputedMember('l', ast.name)));

      this.if_(
        `${this.not(this.getHasOwnProperty('l', ast.name))} && s`,
        this.assign(intoId, this.nonComputedMember('s', ast.name)),
      );

      if (context) {
        context.context = `${this.getHasOwnProperty('l', ast.name)}?l:s`;
        context.name = ast.name;
        context.computed = false;
      }
      return intoId;
    case AST.MemberExpression:
      intoId = this.nextId();
      let left = this.recurse(ast.object);
      if (context) {
        context.context = left;
      }
      if (ast.computed) {
        let right = this.recurse(ast.property);
        this.if_(left, this.assign(intoId, this.computedMember(left, right)));
        if (context) {
          context.name = right;
          context.computed = true;
        }
      } else {
        this.if_(left, this.assign(intoId, this.nonComputedMember(left, ast.property.name)));
        if (context) {
          context.name = ast.property.name;
          context.computed = false;
        }
      }
      return intoId;

    case AST.CallExpression:
      let callContext = {};
      let callee = this.recurse(ast.callee, callContext);
      let args = ast.arguments.map((arg) => {
        return this.recurse(arg);
      });
      if (callContext.name) {
        if (callContext.computed) {
          callee = this.computedMember(callContext.context, callContext.name);
        } else {
          callee = this.nonComputedMember(callContext.context, callContext.name);
        }
      }
      return `${callee} && ${callee}(${args.join(',')})`; // fn && fn() not to throw error
    case AST.ThisExpression:
      return 's';
  }
};

ASTCompiler.prototype.escape = function (value) {
  if (def.isString(value)) {
    return "'" + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + "'";
  } else if (def.isNull(value)) {
    return 'null';
  } else {
    return value;
  }
};

module.exports = parse;
