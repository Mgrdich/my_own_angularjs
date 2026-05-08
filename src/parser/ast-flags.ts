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

import type { FilterService } from '@filter/filter-types';

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
    case 'FilterExpression':
      // Parse-time view: a filter is constant iff its input and arguments are
      // constant AND the resolved filter is stateless. The runtime $stateful
      // check happens at watch-install time (see Slice 11). `parse.ts` adds a
      // conservative `containsFilterExpression` short-circuit on top of this so
      // that filter-bearing expressions are NEVER marked constant at parse time.
      return isConstant(node.input) && node.arguments.every(isConstant);
    default: {
      return node;
    }
  }
}

/**
 * Returns `true` when the given AST sub-tree contains at least one
 * `FilterExpression` node anywhere in its structure.
 *
 * Used by `parse.ts` to short-circuit the `constant` flag at parse time —
 * filter resolution is a runtime concern, so any filter-bearing expression
 * is treated as non-constant until scope re-checks at watch-install time.
 */
export function containsFilterExpression(node: ASTNode): boolean {
  switch (node.type) {
    case 'FilterExpression':
      return true;
    case 'Literal':
    case 'Identifier':
    case 'ThisExpression':
      return false;
    case 'Program':
      return containsFilterExpression(node.body);
    case 'ArrayExpression':
      return node.elements.some(containsFilterExpression);
    case 'ObjectExpression':
      return node.properties.some(containsFilterExpression);
    case 'Property':
      return containsFilterExpression(node.value);
    case 'MemberExpression':
      return containsFilterExpression(node.object) || (node.computed && containsFilterExpression(node.property));
    case 'CallExpression':
      return containsFilterExpression(node.callee) || node.arguments.some(containsFilterExpression);
    case 'UnaryExpression':
      return containsFilterExpression(node.argument);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return containsFilterExpression(node.left) || containsFilterExpression(node.right);
    case 'ConditionalExpression':
      return (
        containsFilterExpression(node.test) ||
        containsFilterExpression(node.consequent) ||
        containsFilterExpression(node.alternate)
      );
    case 'AssignmentExpression':
      return containsFilterExpression(node.left) || containsFilterExpression(node.right);
    default: {
      return node;
    }
  }
}

/**
 * Returns `true` when the program's top-level body is a literal value
 * (primitive, array, or object) — non-recursive.
 */
export function isLiteral(program: Program) {
  const { type } = program.body;
  return type === 'Literal' || type === 'ArrayExpression' || type === 'ObjectExpression';
}

/**
 * Returns `true` when the AST sub-tree contains at least one
 * `FilterExpression` whose resolved filter has `$stateful === true`.
 *
 * This walk runs ONCE at watch-install time, never per digest cycle: scope
 * uses the verdict to decide whether to keep a one-time / constant delegate
 * (stateless filters) or downgrade to a regular watcher (any stateful
 * filter anywhere in the chain). Resolution goes through the runtime
 * `$filter` lookup, so unknown filter names propagate `FilterLookupError`
 * — the watch-install path catches and falls through to the parse-time
 * delegate selection.
 *
 * @param node - AST node to walk (typically `parse(expr).$$ast`)
 * @param $filter - Runtime filter-lookup service
 * @returns `true` iff any `FilterExpression` resolves to a stateful filter
 */
export function containsStatefulFilter(node: ASTNode, $filter: FilterService): boolean {
  switch (node.type) {
    case 'FilterExpression': {
      const filterFn = $filter(node.name);
      if (filterFn.$stateful === true) {
        return true;
      }
      if (containsStatefulFilter(node.input, $filter)) {
        return true;
      }
      return node.arguments.some((arg) => containsStatefulFilter(arg, $filter));
    }
    case 'Literal':
    case 'Identifier':
    case 'ThisExpression':
      return false;
    case 'Program':
      return containsStatefulFilter(node.body, $filter);
    case 'ArrayExpression':
      return node.elements.some((el) => containsStatefulFilter(el, $filter));
    case 'ObjectExpression':
      return node.properties.some((p) => containsStatefulFilter(p, $filter));
    case 'Property':
      return containsStatefulFilter(node.value, $filter);
    case 'MemberExpression':
      return (
        containsStatefulFilter(node.object, $filter) ||
        (node.computed && containsStatefulFilter(node.property, $filter))
      );
    case 'CallExpression':
      return (
        containsStatefulFilter(node.callee, $filter) || node.arguments.some((a) => containsStatefulFilter(a, $filter))
      );
    case 'UnaryExpression':
      return containsStatefulFilter(node.argument, $filter);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return containsStatefulFilter(node.left, $filter) || containsStatefulFilter(node.right, $filter);
    case 'ConditionalExpression':
      return (
        containsStatefulFilter(node.test, $filter) ||
        containsStatefulFilter(node.consequent, $filter) ||
        containsStatefulFilter(node.alternate, $filter)
      );
    case 'AssignmentExpression':
      return containsStatefulFilter(node.left, $filter) || containsStatefulFilter(node.right, $filter);
    default: {
      return node;
    }
  }
}
