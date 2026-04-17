/**
 * Tree-walking interpreter for AngularJS expression ASTs.
 *
 * Evaluates an AST node against a scope and optional locals object.
 * Uses a recursive approach rather than code generation, providing
 * a cleaner TypeScript implementation with full type safety.
 */

import type { ASTNode } from './parse-types';

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
  }
}
