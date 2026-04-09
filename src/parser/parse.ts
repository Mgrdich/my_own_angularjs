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

/**
 * Parse an AngularJS expression string into a reusable evaluation function.
 *
 * The returned function can be called multiple times with different scope
 * and locals objects to evaluate the expression in different contexts.
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
  const tokens = lex(expr);
  const ast = buildAST(tokens);
  return (scope?: Record<string, unknown>, locals?: Record<string, unknown>) => evaluate(ast.body, scope, locals);
}
