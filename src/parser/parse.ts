/**
 * Public entry point for the AngularJS expression parser.
 *
 * Composes the three-stage pipeline: Lexer → AST Builder → Interpreter.
 * Returns a reusable function that evaluates the parsed expression
 * against a scope and optional locals.
 */

import type { ExpressionFn } from './parse-types';
import { lex } from './lexer';
import { buildAST } from './ast';
import { evaluate } from './interpreter';
import { isConstant, isLiteral } from './ast-flags';

/**
 * Parse an AngularJS expression string into a reusable evaluation function.
 *
 * The returned function can be called multiple times with different scope
 * and locals objects to evaluate the expression in different contexts.
 *
 * The returned function also carries three readonly flag properties used by
 * watchers and one-time bindings: `oneTime`, `constant`, and `literal`.
 *
 * A leading `::` prefix on the (trimmed) expression marks it as a one-time
 * binding: the prefix is stripped before lexing and `oneTime` is set to true.
 *
 * @param expr - The expression string to parse
 * @returns A function that evaluates the expression against a scope
 *
 * @example
 * ```ts
 * const fn = parse('name');
 * fn({ name: 'Alice' }); // 'Alice'
 * ```
 */
export function parse(expr: string): ExpressionFn {
  const trimmed = expr.trim();
  let oneTime = false;
  let source = trimmed;
  if (trimmed.startsWith('::')) {
    oneTime = true;
    source = trimmed.slice(2).trim();
    if (source.length === 0) {
      throw new Error("Empty expression after '::'");
    }
  }
  const tokens = lex(source);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i]?.text === ':' && tokens[i + 1]?.text === ':') {
      throw new Error("Unexpected '::' — one-time binding prefix must appear at the start of the expression");
    }
  }
  const ast = buildAST(tokens);
  const fn = (scope?: Record<string, unknown>, locals?: Record<string, unknown>) => evaluate(ast.body, scope, locals);
  Object.defineProperties(fn, {
    oneTime: { value: oneTime, writable: false, enumerable: true, configurable: false },
    constant: { value: isConstant(ast.body), writable: false, enumerable: true, configurable: false },
    literal: { value: isLiteral(ast), writable: false, enumerable: true, configurable: false },
  });
  return fn as ExpressionFn;
}
