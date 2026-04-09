# Technical Specification: Expression Parser

- **Functional Specification:** `context/spec/003-expression-parser/functional-spec.md`
- **Status:** Completed
- **Author(s):** Poe (AI Assistant)

---

## 1. High-Level Technical Approach

Implement a three-stage expression parser in `src/core/` that compiles string expressions into executable functions:

1. **Lexer** (`lex` function) — tokenizes input into a flat `Token[]` array
2. **AST Builder** (`buildAST` function) — parses tokens into a typed AST using recursive descent
3. **Interpreter** (`evaluate` function) — walks the AST recursively to evaluate against scope/locals

The public entry point is `parse(expr: string): ExpressionFn` which chains all three stages. The returned function has signature `(scope?: Record<string, unknown>, locals?: Record<string, unknown>) => unknown`.

No external dependencies. AST nodes use TypeScript discriminated unions for exhaustive type checking. The interpreter returns `undefined` for missing properties (matching AngularJS behavior) and only throws for invalid syntax.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. File Organization

| File                               | Responsibility                                                               |
|------------------------------------|------------------------------------------------------------------------------|
| `src/core/parse-types.ts`          | All type definitions: `Token`, AST node union types, `ExpressionFn`          |
| `src/core/lexer.ts`                | `lex(input: string): Token[]` — tokenizer function                           |
| `src/core/ast.ts`                  | `buildAST(tokens: Token[]): Program` — recursive descent parser              |
| `src/core/interpreter.ts`          | `evaluate(ast: Program, scope?, locals?): unknown` — tree-walking evaluator  |
| `src/core/parse.ts`                | `parse(expr: string): ExpressionFn` — public entry point chaining all stages |
| `src/core/index.ts`                | Updated barrel exports — re-exports `parse` and public types                 |
| `src/core/__tests__/parse.test.ts` | Comprehensive test suite with nested `describe` blocks                       |

### 2.2. Type Definitions (`parse-types.ts`)

**Token type:**

| Field | Type | Purpose |
|-------|------|---------|
| `text` | `string` | Source text of the token |
| `value` | `number \| string` (optional) | Parsed value for number/string literals |
| `identifier` | `boolean` (optional) | `true` for identifier tokens |

**AST Node Types (discriminated union on `type` field):**

| Node Type | Key Fields | Represents |
|-----------|-----------|------------|
| `Program` | `body: ASTNode` | Root wrapper |
| `Literal` | `value: string \| number \| boolean \| null` | Literal values |
| `Identifier` | `name: string` | Variable names |
| `ThisExpression` | — | `this` keyword |
| `ArrayExpression` | `elements: ASTNode[]` | Array literals `[...]` |
| `ObjectExpression` | `properties: Property[]` | Object literals `{...}` |
| `Property` | `key: Literal \| Identifier, value: ASTNode` | Object key-value pair |
| `MemberExpression` | `object: ASTNode, property: ASTNode, computed: boolean` | `.x` or `[x]` access |
| `CallExpression` | `callee: ASTNode, arguments: ASTNode[]` | Function calls `fn()` |

**Expression function type:**

| Type | Shape | Purpose |
|------|-------|---------|
| `ExpressionFn` | `(scope?: Record<string, unknown>, locals?: Record<string, unknown>) => unknown` | Compiled expression function |

### 2.3. Lexer (`lexer.ts`)

Pure function `lex(input: string): Token[]`. Scans character-by-character:

- **Numbers:** digits, dots, `e`/`E` with optional `+`/`-` for exponents
- **Strings:** single/double quote delimited, with `\n`, `\t`, `\\`, `\uXXXX` escapes
- **Identifiers:** `[a-zA-Z_$]` start, `[a-zA-Z0-9_$]` continue. Includes keywords `true`, `false`, `null`, `this`
- **Symbols:** single characters `[`, `]`, `{`, `}`, `(`, `)`, `.`, `,`, `:`
- **Whitespace:** consumed and discarded (space, tab, newline, carriage return)
- **Errors:** throws for unexpected characters, unterminated strings, invalid numbers

### 2.4. AST Builder (`ast.ts`)

Pure function `buildAST(tokens: Token[]): Program`. Recursive descent parser using token consumption pattern:

| Grammar Rule            | Handles                                                                   |
|-------------------------|---------------------------------------------------------------------------|
| `program`               | Entry: wraps result in `Program` node                                     |
| `primary`               | Literals, identifiers, `this`, arrays, objects, parenthesized expressions |
| `parseArrayExpression`  | `[` elements `,` ... `]` with trailing comma support                      |
| `parseObjectExpression` | `{` key `:` value `,` ... `}`                                             |
| `parseCallOrMember`     | Chains `.property`, `[computed]`, and `(args)` after a primary            |

Token consumption helpers: `peek()` to look ahead, `consume()` to advance and assert, `expect()` to advance if matching.

### 2.5. Interpreter (`interpreter.ts`)

Pure function `evaluate(node: ASTNode, scope?, locals?): unknown`. Recursive switch on `node.type`:

| Node Type          | Evaluation Strategy                                                                                                              |
|--------------------|----------------------------------------------------------------------------------------------------------------------------------|
| `Program`          | Evaluate `body`                                                                                                                  |
| `Literal`          | Return `value` directly                                                                                                          |
| `Identifier`       | Check `locals` first, then `scope`. Return `undefined` if missing                                                                |
| `ThisExpression`   | Return `scope`                                                                                                                   |
| `ArrayExpression`  | Map each element through `evaluate`, return array                                                                                |
| `ObjectExpression` | Build object from evaluated key-value pairs                                                                                      |
| `MemberExpression` | Evaluate `object`, then access `property` (dot or bracket). Return `undefined` if intermediate is nullish                        |
| `CallExpression`   | Evaluate callee, resolve `this` context for method calls (the object of a `MemberExpression`), evaluate arguments, call function |

**Safe access pattern:** When evaluating `a.b.c`, if `a` or `a.b` is `undefined`/`null`, return `undefined` instead of throwing.

**Method `this` binding:** For `obj.method()`, the `CallExpression` callee is a `MemberExpression`. The interpreter evaluates the object part, gets the function from the property, and calls it with the object as `this` via `.call()`.

### 2.6. Parse Entry Point (`parse.ts`)

The `parse` function chains all three stages:

1. Tokenize the expression string via `lex(expr)`
2. Build the AST via `buildAST(tokens)`
3. Return a closure that evaluates the AST against provided scope/locals

The AST is built once and closed over — subsequent calls to the returned function only run the interpreter.

---

## 3. Impact and Risk Analysis

**System Dependencies:**
- `src/core/index.ts` barrel export must be updated to re-export `parse` and public types
- `src/index.ts` must re-export from `./core`
- Rollup build config already handles `src/index.ts` as entry — no changes needed
- ESLint, Vitest, and TypeScript configs already cover `src/` — no changes needed

**Potential Risks & Mitigations:**

| Risk                                                            | Impact                                 | Mitigation                                                           |
|-----------------------------------------------------------------|----------------------------------------|----------------------------------------------------------------------|
| Recursive descent parser edge cases (deeply nested expressions) | Stack overflow on extreme inputs       | Set a reasonable nesting depth limit; test with deep nesting         |
| Safe property access returning `undefined` masks bugs           | Silent failures in expressions         | Match AngularJS behavior exactly; only throw for syntax errors       |
| `this` binding in method calls is subtle                        | Wrong `this` context in `obj.method()` | Test all binding scenarios from legacy tests; use explicit `.call()` |
| Future operators/filters will require grammar changes           | AST builder needs extension points     | Design `primary` and grammar rules to be extendable without rewrite  |
| `ExpressionFn` type is loosely typed (`unknown` return)         | Consumers need type assertions         | This matches AngularJS semantics; downstream modules can narrow      |

---

## 4. Testing Strategy

**Test file:** `src/core/__tests__/parse.test.ts` — single file with nested `describe` blocks.

**Test organization (describe blocks):**

| Block                          | Covers                                                 |
|--------------------------------|--------------------------------------------------------|
| `parse` > `numbers`            | Integers, floats, scientific notation, invalid numbers |
| `parse` > `strings`            | Single/double quotes, escapes, Unicode, unterminated   |
| `parse` > `literals`           | `true`, `false`, `null`                                |
| `parse` > `whitespace`         | Whitespace handling                                    |
| `parse` > `arrays`             | Empty, nested, trailing commas                         |
| `parse` > `objects`            | Empty, identifier keys, string keys                    |
| `parse` > `identifiers`        | Scope lookup, undefined handling, `this`               |
| `parse` > `member expressions` | Dot notation, computed access, chains, locals override |
| `parse` > `function calls`     | Simple calls, arguments, method binding                |

**Approach:**
- Port legacy test behaviors 1:1 — each legacy `it()` block gets a corresponding Vitest `it()` block
- Use `vi.fn()` for spy/mock assertions on function call tests
- Target 90%+ line coverage per the project's coverage threshold
- Optionally: unit tests for `lex()` and `buildAST()` independently for edge cases
