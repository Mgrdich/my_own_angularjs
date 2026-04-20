/**
 * Type definitions for the expression parser pipeline.
 *
 * The parser follows a three-stage pipeline: Lexer → AST Builder → Interpreter.
 * These types define the contracts between each stage.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Lexer types
// ──────────────────────────────────────────────────────────────────────────────

/** A token produced by the lexer from an expression string. */
export interface Token {
  readonly text: string;
  readonly value?: number | string;
  readonly identifier?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// AST Node types — discriminated union on the `type` field
// ──────────────────────────────────────────────────────────────────────────────

/** Root node wrapping the parsed expression body. */
export interface Program {
  readonly type: 'Program';
  readonly body: ASTNode;
}

/** A literal value: number, string, boolean, or null. */
export interface Literal {
  readonly type: 'Literal';
  readonly value: string | number | boolean | null;
}

/** A named identifier reference (e.g. variable name). */
export interface Identifier {
  readonly type: 'Identifier';
  readonly name: string;
}

/** The `this` keyword, resolved to the scope at evaluation time. */
export interface ThisExpression {
  readonly type: 'ThisExpression';
}

/** An array literal expression (e.g. `[1, 2, 3]`). */
export interface ArrayExpression {
  readonly type: 'ArrayExpression';
  readonly elements: ASTNode[];
}

/** An object literal expression (e.g. `{a: 1, b: 2}`). */
export interface ObjectExpression {
  readonly type: 'ObjectExpression';
  readonly properties: PropertyNode[];
}

/** A single property within an object expression. */
export interface PropertyNode {
  readonly type: 'Property';
  readonly key: Literal | Identifier;
  readonly value: ASTNode;
}

/** A member access expression, computed (`a[b]`) or non-computed (`a.b`). */
export type MemberExpression =
  | {
      readonly type: 'MemberExpression';
      readonly object: ASTNode;
      readonly property: Identifier;
      readonly computed: false;
    }
  | {
      readonly type: 'MemberExpression';
      readonly object: ASTNode;
      readonly property: ASTNode;
      readonly computed: true;
    };

/** A function call expression (e.g. `fn(a, b)`). */
export interface CallExpression {
  readonly type: 'CallExpression';
  readonly callee: ASTNode;
  readonly arguments: ASTNode[];
}

/** A unary operator expression: !x, -x, +x. */
export interface UnaryExpression {
  readonly type: 'UnaryExpression';
  readonly operator: '!' | '+' | '-';
  readonly argument: ASTNode;
}

/** A binary operator expression: arithmetic (+, -, *, /, %) or comparison (==, !=, ===, !==, <, <=, >, >=). */
export interface BinaryExpression {
  readonly type: 'BinaryExpression';
  readonly operator: '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '===' | '!==' | '<' | '<=' | '>' | '>=';
  readonly left: ASTNode;
  readonly right: ASTNode;
}

/** A short-circuit logical expression: && or ||. */
export interface LogicalExpression {
  readonly type: 'LogicalExpression';
  readonly operator: '&&' | '||';
  readonly left: ASTNode;
  readonly right: ASTNode;
}

/** A ternary conditional expression: test ? consequent : alternate. */
export interface ConditionalExpression {
  readonly type: 'ConditionalExpression';
  readonly test: ASTNode;
  readonly consequent: ASTNode;
  readonly alternate: ASTNode;
}

/** A simple assignment expression: identifier, dot, or computed member on the left. */
export interface AssignmentExpression {
  readonly type: 'AssignmentExpression';
  readonly left: Identifier | MemberExpression;
  readonly right: ASTNode;
}

/** Union of all AST node types used in the expression parser. */
export type ASTNode =
  | Program
  | Literal
  | Identifier
  | ThisExpression
  | ArrayExpression
  | ObjectExpression
  | PropertyNode
  | MemberExpression
  | CallExpression
  | UnaryExpression
  | BinaryExpression
  | LogicalExpression
  | ConditionalExpression
  | AssignmentExpression;

// ──────────────────────────────────────────────────────────────────────────────
// Public API types
// ──────────────────────────────────────────────────────────────────────────────

/** Compiled expression function returned by `parse`. */
export type ExpressionFn = ((scope?: Record<string, unknown>, locals?: Record<string, unknown>) => unknown) & {
  readonly oneTime: boolean;
  readonly constant: boolean;
  readonly literal: boolean;
};
