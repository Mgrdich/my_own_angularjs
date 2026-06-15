/**
 * Shared assignable-expression write machinery (compiler-internal).
 *
 * This module hosts the small set of helpers that turn a parsed
 * expression into a parent-side writer: detecting whether an AST node is
 * structurally assignable, auto-creating intermediate objects along a
 * member path, and performing the final assignment. It is consumed by
 * the `=` two-way isolate binding (see `isolate-bindings.ts`) and by
 * `ngRef` (a later slice) — both need to write a value back through an
 * assignable l-value expression.
 *
 * Compiler-internal only: NOT exported from `@compiler/index` or the
 * root barrel. The parser's public surface is unchanged; these helpers
 * re-implement a narrow subset of the parser's internal `assign` machinery
 * because the parser does not publicly expose its `assign` helper.
 */

import type { Scope } from '@core/index';
import type { ASTNode, ExpressionFn, Identifier, MemberExpression } from '@parser/parse-types';

/**
 * Build a parent-side write-back function for a `=` two-way binding.
 *
 * The parent expression must be a structurally-assignable AST node —
 * an `Identifier` (`foo`) or a `MemberExpression` (`foo.bar`,
 * `arr[idx]`). For anything else we return `undefined` and the reverse
 * watcher is suppressed (a `=` binding on a non-assignable parent
 * expression is one-way in practice, matching AngularJS, which would
 * throw a `$compile:nonassign` error — Slice 1 silently degrades rather
 * than introducing a new error class for that edge case; tests cover
 * the assignable path).
 */
export function buildParentWriter(
  parentExpr: ExpressionFn,
): ((parentScope: Scope, value: unknown) => void) | undefined {
  const ast = parentExpr.$$ast;
  if (!isAssignable(ast)) {
    return undefined;
  }
  return (parentScope: Scope, value: unknown) => {
    writeAssignable(parentScope as unknown as Record<string, unknown>, ast, value);
  };
}

export function isAssignable(node: ASTNode): node is Identifier | MemberExpression {
  return node.type === 'Identifier' || node.type === 'MemberExpression';
}

/**
 * Resolve an object path on `root`, creating `{}` for any nullish
 * intermediate. Mirrors the parser's internal `ensurePath`; we
 * re-implement a narrow version here because the parser does not
 * publicly expose its `assign` helper.
 */
export function ensurePath(root: Record<string, unknown>, node: ASTNode): Record<string, unknown> {
  if (node.type === 'Identifier') {
    return ensureChild(root, node.name);
  }
  if (node.type === 'MemberExpression') {
    const parent = ensurePath(root, node.object);
    const key = node.computed ? String(evaluateForKey(parent, node.property)) : node.property.name;
    return ensureChild(parent, key);
  }
  if (node.type === 'ThisExpression') {
    return root;
  }
  throw new Error(`Invalid assignment target: ${node.type}`);
}

function ensureChild(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (existing === undefined || existing === null) {
    const fresh: Record<string, unknown> = {};
    parent[key] = fresh;
    return fresh;
  }
  if (typeof existing !== 'object') {
    throw new Error(`Cannot traverse through non-object value at "${key}"`);
  }
  return existing as Record<string, unknown>;
}

/**
 * Best-effort evaluator for computed member-key expressions on the
 * reverse-write path. We only need to support assignable l-values, so
 * the input is always an `Identifier` or a `Literal` in practice; for
 * defensiveness we fall back to `String(undefined)` for anything else.
 */
function evaluateForKey(parent: Record<string, unknown>, node: ASTNode): unknown {
  if (node.type === 'Literal') {
    return node.value;
  }
  if (node.type === 'Identifier') {
    return parent[node.name];
  }
  return undefined;
}

export function writeAssignable(
  root: Record<string, unknown>,
  node: Identifier | MemberExpression,
  value: unknown,
): void {
  if (node.type === 'Identifier') {
    root[node.name] = value;
    return;
  }
  const object = ensurePath(root, node.object);
  const key = node.computed ? String(evaluateForKey(object, node.property)) : node.property.name;
  object[key] = value;
}
