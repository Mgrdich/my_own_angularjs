# Tasks: Expression Parser

---

## Slice 1: Types, Lexer, and Primitive Literals

_After this slice: `parse('42')`, `parse('"hello"')`, `parse('true')`, `parse('null')` all return working expression functions. The full three-stage pipeline (lex → AST → interpret) is operational for primitive values._

- [x] **Slice 1: Types, Lexer, and primitive literal parsing**
  - [x] Create `src/core/parse-types.ts` with `Token`, all AST node discriminated union types (`Program`, `Literal`, `Identifier`, `ThisExpression`, `ArrayExpression`, `ObjectExpression`, `Property`, `MemberExpression`, `CallExpression`), and `ExpressionFn` type **[Agent: typescript-framework]**
  - [x] Create `src/core/lexer.ts` with `lex(input: string): Token[]` — tokenize numbers (int, float, scientific notation), strings (single/double quote, escapes, Unicode), identifiers/keywords, symbols, whitespace. Throw on invalid input **[Agent: typescript-framework]**
  - [x] Create `src/core/ast.ts` with `buildAST(tokens: Token[]): Program` — implement `program`, `primary` (literals, identifiers, `this` only for now) **[Agent: typescript-framework]**
  - [x] Create `src/core/interpreter.ts` with `evaluate(node: ASTNode, scope?, locals?): unknown` — handle `Program`, `Literal`, `Identifier`, `ThisExpression` **[Agent: typescript-framework]**
  - [x] Create `src/core/parse.ts` with `parse(expr: string): ExpressionFn` — chain lex → buildAST → evaluate **[Agent: typescript-framework]**
  - [x] Create `src/core/__tests__/parse.test.ts` with tests for: numbers (integers, floats, scientific notation, errors), strings (quotes, escapes, Unicode, unterminated), booleans, null, whitespace handling, identifiers (scope lookup, undefined, `this`) **[Agent: vitest-testing]**
  - [x] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 2: Array and Object Literals

_After this slice: `parse('[1, "two", [3]]')` and `parse('{a: 1, b: "two"}')` work correctly._

- [ ] **Slice 2: Array and object literal parsing**
  - [ ] Extend `ast.ts` — add `parseArrayExpression` (with trailing comma support) and `parseObjectExpression` (identifier and string keys) to `primary` **[Agent: typescript-framework]**
  - [ ] Extend `interpreter.ts` — add `ArrayExpression` and `ObjectExpression` evaluation (map elements, build object from key-value pairs) **[Agent: typescript-framework]**
  - [ ] Add tests for: empty arrays, nested arrays, trailing commas, empty objects, identifier keys, string keys **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 3: Member Expressions (Property Access)

_After this slice: `parse('a.b.c')`, `parse('a["key"]')`, and locals override all work._

- [ ] **Slice 3: Member expressions and property access**
  - [ ] Extend `ast.ts` — add `parseCallOrMember` to chain `.property` (dot notation) and `[computed]` (bracket notation) after primary expressions **[Agent: typescript-framework]**
  - [ ] Extend `interpreter.ts` — add `MemberExpression` evaluation with safe access (return `undefined` for nullish intermediates), locals-first resolution for root identifiers **[Agent: typescript-framework]**
  - [ ] Add tests for: dot notation, computed access, deeply chained access, undefined intermediates, nested computed (`lock[keys["aKey"]]`), locals override, scope fallback when locals lack property, correct source object throughout chain **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 4: Function Calls

_After this slice: `parse('fn()')`, `parse('fn(42)')`, `parse('obj.method()')` all work with correct `this` binding._

- [ ] **Slice 4: Function call expressions**
  - [ ] Extend `ast.ts` — add `(args)` parsing to `parseCallOrMember` for `CallExpression` nodes **[Agent: typescript-framework]**
  - [ ] Extend `interpreter.ts` — add `CallExpression` evaluation: resolve callee, evaluate arguments, preserve `this` binding for method calls via `.call()` **[Agent: typescript-framework]**
  - [ ] Add tests for: simple calls, calls with literal arguments, calls with identifier arguments, nested function arguments, multiple arguments, method `this` binding (dot and computed), deeply nested method binding **[Agent: vitest-testing]**
  - [ ] **Verify:** `pnpm lint` + `pnpm typecheck` + `pnpm test` all pass **[Agent: typescript-framework]**

---

## Slice 5: Barrel Exports and End-to-End Validation

_After this slice: `parse` and types are exported, build output includes parser, coverage meets threshold._

- [ ] **Slice 5: Exports, build, and validation**
  - [ ] Update `src/core/index.ts` and `src/index.ts` barrel exports to re-export `parse` and public types (`ExpressionFn`, AST node types, `Token`) **[Agent: typescript-framework]**
  - [ ] Run full command sequence: `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` — all pass **[Agent: general-purpose]**
  - [ ] Verify `dist/types/` contains parse type declarations **[Agent: general-purpose]**
  - [ ] Verify test coverage meets 90% threshold on `src/core/` parser files **[Agent: vitest-testing]**
