/**
 * AST flag helpers for the expression parser.
 *
 * - `isConstant` tells whether an AST is composed entirely of compile-time constants
 *   (no scope lookups, no function calls, no assignments).
 * - `isLiteral` tells whether the top-level AST node is a literal value
 *   (primitive, array, or object).
 *
 * Both match AngularJS 1.x `$parse` semantics so that one-time bindings
 * and constant-watch optimizations behave identically.
 */

import type { ASTNode, Program } from './parse-types';

/**
 * Returns `true` when the given AST sub-tree evaluates to a value that can never
 * change because it contains no scope lookups, member access, calls, or assignments.
 */
export function isConstant(node: ASTNode): boolean {
  switch (node.type) {
    case 'Literal':
      return true;
    case 'Identifier':
    case 'ThisExpression':
    case 'MemberExpression':
    case 'CallExpression':
    case 'AssignmentExpression':
      return false;
    case 'Program':
      return isConstant(node.body);
    case 'ArrayExpression':
      return node.elements.every(isConstant);
    case 'ObjectExpression':
      return node.properties.every(isConstant);
    case 'Property':
      // Keys are always static (Identifier name or Literal), so constness is
      // decided purely by the value expression.
      return isConstant(node.value);
    case 'UnaryExpression':
      return isConstant(node.argument);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return isConstant(node.left) && isConstant(node.right);
    case 'ConditionalExpression':
      return isConstant(node.test) && isConstant(node.consequent) && isConstant(node.alternate);
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

/**
 * Returns `true` when the program's top-level body is a literal value
 * (primitive, array, or object) — non-recursive.
 */
export function isLiteral(program: Program): boolean {
  const { type } = program.body;
  return type === 'Literal' || type === 'ArrayExpression' || type === 'ObjectExpression';
}
