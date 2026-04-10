/**
 * AST Builder for AngularJS expressions.
 *
 * Implements a recursive descent parser that transforms a token array
 * into an Abstract Syntax Tree. Uses a cursor-based approach with
 * `peek`, `expect`, and `consume` helpers.
 */

import type { ASTNode, Identifier, Literal, Program, Token } from './parse-types';
import { isKeyOf } from '@core/utils';

/** Constant AST nodes for keyword literals. */
const CONSTANTS = {
  true: { type: 'Literal', value: true },
  false: { type: 'Literal', value: false },
  null: { type: 'Literal', value: null },
} as const satisfies Record<string, ASTNode>;

/**
 * Build an AST from a token array produced by the lexer.
 *
 * @param tokens - Array of tokens to parse
 * @returns The root Program node of the AST
 */
export function buildAST(tokens: Token[]): Program {
  let cursor = 0;

  /**
   * Look at the current token without advancing.
   * If `text` is provided, only return the token if its text matches.
   */
  function peek(text?: string): Token | undefined {
    if (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token !== undefined && (text === undefined || token.text === text)) {
        return token;
      }
    }
    return undefined;
  }

  /**
   * Advance the cursor if the current token matches `text`.
   * Returns the token if matched, or `undefined` otherwise.
   */
  function expect(text?: string): Token | undefined {
    const token = peek(text);
    if (token !== undefined) {
      cursor++;
      return token;
    }
    return undefined;
  }

  /**
   * Advance the cursor and assert the current token matches `text`.
   * Throws if the token does not match.
   */
  function consume(text: string): Token {
    const token = expect(text);
    if (token === undefined) {
      throw new Error(`Unexpected. Expecting: ${text}`);
    }
    return token;
  }

  /**
   * Parse the top-level program rule.
   */
  function program(): Program {
    return { type: 'Program', body: primary() };
  }

  /**
   * Parse a primary expression: literals, identifiers, keywords,
   * arrays, objects, and postfix member/call chains.
   */
  function primary(): ASTNode {
    let node: ASTNode;

    if (expect('[') !== undefined) {
      node = arrayDeclaration();
    } else if (expect('{') !== undefined) {
      node = objectDeclaration();
    } else {
      const token = peek();
      if (token === undefined) {
        throw new Error('Unexpected end of expression');
      }

      // Check for keyword constants (true, false, null)
      if (isKeyOf(CONSTANTS, token.text)) {
        cursor++;
        node = CONSTANTS[token.text];
      } else if (token.identifier === true) {
        cursor++;
        if (token.text === 'this') {
          node = { type: 'ThisExpression' };
        } else {
          node = { type: 'Identifier', name: token.text };
        }
      } else {
        // Number or string literal
        cursor++;
        node = { type: 'Literal', value: token.value as string | number | boolean | null };
      }
    }

    // Postfix: member access and call expressions
    let next: Token | undefined;
    while (
      (next = expect('.')) !== undefined ||
      (next = expect('[')) !== undefined ||
      (next = expect('(')) !== undefined
    ) {
      if (next.text === '[') {
        node = {
          type: 'MemberExpression',
          object: node,
          property: primary(),
          computed: true,
        };
        consume(']');
      } else if (next.text === '.') {
        node = {
          type: 'MemberExpression',
          object: node,
          property: identifier(),
          computed: false,
        };
      } else {
        // '(' — call expression
        node = {
          type: 'CallExpression',
          callee: node,
          arguments: parseArguments(),
        };
        consume(')');
      }
    }

    return node;
  }

  /**
   * Parse an identifier token into an Identifier node.
   */
  function identifier(): Identifier {
    const token = peek();
    if (token === undefined || token.identifier !== true) {
      throw new Error('Expected identifier');
    }
    cursor++;
    return { type: 'Identifier', name: token.text };
  }

  /**
   * Parse an array literal expression: `[elem, elem, ...]`.
   * The opening `[` has already been consumed.
   */
  function arrayDeclaration(): ASTNode {
    const elements: ASTNode[] = [];

    if (peek(']') === undefined) {
      do {
        // Support trailing comma
        if (peek(']') !== undefined) {
          break;
        }
        elements.push(primary());
      } while (expect(',') !== undefined);
    }

    consume(']');
    return { type: 'ArrayExpression', elements };
  }

  /**
   * Parse an object literal expression: `{key: value, ...}`.
   * The opening `{` has already been consumed.
   */
  function objectDeclaration(): ASTNode {
    const properties: { type: 'Property'; key: Literal | Identifier; value: ASTNode }[] = [];

    if (peek('}') === undefined) {
      do {
        let key: Literal | Identifier;
        const token = peek();
        if (token === undefined) {
          throw new Error('Unexpected end of expression in object');
        }
        if (token.identifier === true) {
          key = identifier();
        } else if (isKeyOf(CONSTANTS, token.text)) {
          // Keyword used as object key (e.g., {null: 1, true: 2})
          cursor++;
          key = { type: 'Identifier', name: token.text };
        } else {
          // String or number key
          cursor++;
          key = { type: 'Literal', value: token.value as string | number | boolean | null };
        }
        consume(':');
        const value = primary();
        properties.push({ type: 'Property', key, value });
      } while (expect(',') !== undefined);
    }

    consume('}');
    return { type: 'ObjectExpression', properties };
  }

  /**
   * Parse a comma-separated list of arguments for a call expression.
   */
  function parseArguments(): ASTNode[] {
    const args: ASTNode[] = [];
    if (peek(')') === undefined) {
      do {
        args.push(primary());
      } while (expect(',') !== undefined);
    }
    return args;
  }

  return program();
}
