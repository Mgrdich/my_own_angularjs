/**
 * Tree-walking interpreter for AngularJS expression ASTs.
 *
 * Evaluates an AST node against a scope and optional locals object.
 * Uses a recursive approach rather than code generation, providing
 * a cleaner TypeScript implementation with full type safety.
 */

import type { ASTNode, Identifier, MemberExpression } from './parse-types';

/**
 * Evaluate an AST node in the context of a scope and optional locals.
 *
 * @param node - The AST node to evaluate
 * @param scope - The scope object for property lookups
 * @param locals - Optional locals object that takes precedence over scope
 * @returns The result of evaluating the expression
 */
export function evaluate(node: ASTNode, scope?: Record<string, unknown>, locals?: Record<string, unknown>): unknown {
  switch (node.type) {
    case 'Program':
      return evaluate(node.body, scope, locals);

    case 'Literal':
      return node.value;

    case 'Identifier':
      if (locals !== undefined && Object.prototype.hasOwnProperty.call(locals, node.name)) {
        return locals[node.name];
      }
      if (scope !== undefined) {
        return scope[node.name];
      }
      return undefined;

    case 'ThisExpression':
      return scope;

    case 'ArrayExpression':
      return node.elements.map((element) => evaluate(element, scope, locals));

    case 'ObjectExpression': {
      const result: Record<string, unknown> = {};
      for (const prop of node.properties) {
        const key = prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value);
        result[key] = evaluate(prop.value, scope, locals);
      }
      return result;
    }

    case 'Property':
      // PropertyNode is not evaluated directly; handled within ObjectExpression
      return evaluate(node.value, scope, locals);

    case 'MemberExpression': {
      const object = evaluate(node.object, scope, locals);
      if (object === undefined || object === null) {
        return undefined;
      }
      if (node.computed) {
        const property = evaluate(node.property, scope, locals);
        return (object as Record<string, unknown>)[property as string];
      }
      if (node.property.type === 'Identifier') {
        return (object as Record<string, unknown>)[node.property.name];
      }
      return undefined;
    }

    case 'CallExpression': {
      // Resolve the callee and its context for proper `this` binding
      let context: unknown;
      let fn: unknown;

      if (node.callee.type === 'MemberExpression') {
        context = evaluate(node.callee.object, scope, locals);
        if (context === undefined || context === null) {
          return undefined;
        }
        if (node.callee.computed) {
          const prop = evaluate(node.callee.property, scope, locals);
          fn = (context as Record<string, unknown>)[prop as string];
        } else if (node.callee.property.type === 'Identifier') {
          fn = (context as Record<string, unknown>)[node.callee.property.name];
        }
      } else {
        context = scope;
        fn = evaluate(node.callee, scope, locals);
      }

      if (typeof fn !== 'function') {
        return undefined;
      }

      const args = node.arguments.map((arg) => evaluate(arg, scope, locals));
      return (fn as (...a: unknown[]) => unknown).call(context, ...args);
    }

    case 'UnaryExpression': {
      const value = evaluate(node.argument, scope, locals);
      switch (node.operator) {
        case '!':
          return !value;
        case '-':
          return -(value as number);
        case '+':
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- runtime coercion of unknown to number (AngularJS parity)
          return +(value as number);
      }
    }

    case 'BinaryExpression': {
      const left = evaluate(node.left, scope, locals);
      const right = evaluate(node.right, scope, locals);
      // The `as number` casts silence TS's `unknown` arithmetic complaints;
      // JS `+` is intentionally polymorphic at runtime (string concat, NaN for
      // undefined), matching AngularJS behavior regardless of the static cast.
      switch (node.operator) {
        case '+':
          return (left as number) + (right as number);
        case '-':
          return (left as number) - (right as number);
        case '*':
          return (left as number) * (right as number);
        case '/':
          return (left as number) / (right as number);
        case '%':
          return (left as number) % (right as number);
        case '==':
          return left == right;
        case '!=':
          return left != right;
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '<':
          return (left as number) < (right as number);
        case '<=':
          return (left as number) <= (right as number);
        case '>':
          return (left as number) > (right as number);
        case '>=':
          return (left as number) >= (right as number);
      }
    }

    case 'LogicalExpression': {
      // Short-circuit evaluation: do NOT evaluate `right` unless needed.
      // Returns the operand value (not a coerced boolean), matching JS semantics.
      const left = evaluate(node.left, scope, locals);
      if (node.operator === '&&') {
        return left ? evaluate(node.right, scope, locals) : left;
      }
      // operator === '||'
      return left ? left : evaluate(node.right, scope, locals);
    }

    case 'ConditionalExpression': {
      // Only evaluate the selected branch.
      return evaluate(node.test, scope, locals)
        ? evaluate(node.consequent, scope, locals)
        : evaluate(node.alternate, scope, locals);
    }

    case 'AssignmentExpression': {
      const value = evaluate(node.right, scope, locals);
      return assign(node.left, value, scope, locals);
    }
  }
}

/**
 * Write `value` to the location described by `node`.
 *
 * For identifiers, uses locals-first semantics (writes to locals only if the key
 * already exists there; otherwise writes to scope). For member expressions,
 * resolves the object chain via {@link ensurePath} and sets the final property.
 */
function assign(
  node: Identifier | MemberExpression,
  value: unknown,
  scope?: Record<string, unknown>,
  locals?: Record<string, unknown>,
): unknown {
  if (node.type === 'Identifier') {
    // Locals-first: write to locals only if locals already has the key
    if (locals !== undefined && Object.prototype.hasOwnProperty.call(locals, node.name)) {
      locals[node.name] = value;
    } else if (scope !== undefined) {
      scope[node.name] = value;
    }
    return value;
  }
  // MemberExpression: resolve the object chain, creating intermediates as needed
  const object = ensurePath(node.object, scope, locals);
  const key = node.computed ? String(evaluate(node.property, scope, locals)) : (node.property as Identifier).name;
  object[key] = value;
  return value;
}

/**
 * Resolve an object path, creating `{}` for any undefined/null intermediate.
 * Used by {@link assign} to implement auto-create semantics (AngularJS parity).
 */
function ensurePath(
  node: ASTNode,
  scope?: Record<string, unknown>,
  locals?: Record<string, unknown>,
): Record<string, unknown> {
  if (node.type === 'Identifier') {
    const root = locals !== undefined && Object.prototype.hasOwnProperty.call(locals, node.name) ? locals : scope;
    if (root === undefined) {
      throw new Error('Cannot assign: no scope or locals');
    }
    if (root[node.name] === undefined || root[node.name] === null) {
      root[node.name] = {};
    }
    return root[node.name] as Record<string, unknown>;
  }
  if (node.type === 'MemberExpression') {
    const parent = ensurePath(node.object, scope, locals);
    const key = node.computed ? String(evaluate(node.property, scope, locals)) : (node.property as Identifier).name;
    if (parent[key] === undefined || parent[key] === null) {
      parent[key] = {};
    }
    return parent[key] as Record<string, unknown>;
  }
  if (node.type === 'ThisExpression') {
    if (scope === undefined) {
      throw new Error('Cannot assign to `this` with no scope');
    }
    return scope;
  }
  // Other node types (Literal, CallExpression, etc.) aren't valid l-value roots
  throw new Error(`Invalid assignment target: ${node.type}`);
}
