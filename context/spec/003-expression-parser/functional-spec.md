# Functional Specification: Expression Parser

- **Roadmap Item:** Phase 0 — Legacy Migration & Fresh Start > Reimplement Existing Features > Expression Parser
- **Status:** Draft
- **Author:** Poe (AI Assistant)

---

## 1. Overview and Rationale (The "Why")

The expression parser is the bridge between string-based expressions and executable logic. In AngularJS, expressions appear everywhere — in `$watch`, `$eval`, templates (`{{user.name}}`), and directive attributes. Without a parser, all watchers and evaluations must use function references, which limits the framework's usability.

The legacy implementation exists in `legacy/src/js_legacy/parse.js` with 52 tests. It uses `new Function()` code generation, which creates security concerns (CSP violations) and is difficult to type. The goal is to reimplement the parser in clean TypeScript using a tree-walking interpreter, matching behavioral parity with the legacy tests while gaining type safety and eliminating `eval`-like patterns.

**Success criteria:** All legacy parser test behaviors are reproducible with the new implementation. `pnpm test` passes with full coverage of parser functionality. The module exports a `parse()` function that returns compiled expression functions consumable by downstream modules (Scope, Compiler, Interpolation).

---

## 2. Functional Requirements (The "What")

### 2.1. Parse Function API

- The parser exposes a `parse(expr)` function that compiles a string expression into an executable function.
  - **Acceptance Criteria:**
    - [ ] `parse(expr)` accepts a string and returns a function with signature `(scope, locals?) => value`
    - [ ] The returned function evaluates the expression against the provided scope object
    - [ ] When `locals` is provided, its properties take precedence over scope properties
    - [ ] Parsing an invalid expression throws a descriptive error

### 2.2. Numeric Literals

- The parser handles integer and floating-point numbers, including scientific notation.
  - **Acceptance Criteria:**
    - [ ] Parses integers: `42` evaluates to `42`
    - [ ] Parses floating-point numbers: `4.2` evaluates to `4.2`
    - [ ] Parses leading-dot floats: `.42` evaluates to `0.42`
    - [ ] Parses scientific notation: `42e3` evaluates to `42000`
    - [ ] Parses negative exponents: `4200e-2` evaluates to `42`
    - [ ] Parses float with exponent: `.42e2` evaluates to `42`
    - [ ] Throws an error for invalid scientific notation (e.g., `42e-`)
    - [ ] Throws an error for invalid floats (e.g., `42.3.4`)

### 2.3. String Literals

- The parser handles single and double-quoted strings with escape sequences.
  - **Acceptance Criteria:**
    - [ ] Parses single-quoted strings: `'abc'` evaluates to `"abc"`
    - [ ] Parses double-quoted strings: `"abc"` evaluates to `"abc"`
    - [ ] Parses escape sequences: `'a\\nb'` evaluates to a string with a newline
    - [ ] Parses Unicode escapes: `'\u00A0'` evaluates to the non-breaking space character
    - [ ] Throws an error for unterminated strings

### 2.4. Boolean and Null Literals

- The parser recognizes `true`, `false`, and `null` as literal values.
  - **Acceptance Criteria:**
    - [ ] `true` evaluates to `true`
    - [ ] `false` evaluates to `false`
    - [ ] `null` evaluates to `null`

### 2.5. Array Literals

- The parser handles array expressions with nested elements.
  - **Acceptance Criteria:**
    - [ ] Parses empty arrays: `[]` evaluates to `[]`
    - [ ] Parses arrays with mixed types: `[1, "two", [3], true]` evaluates correctly
    - [ ] Parses arrays with trailing commas: `[1, 2, 3, ]` evaluates to `[1, 2, 3]`

### 2.6. Object Literals

- The parser handles object expressions with identifier and string keys.
  - **Acceptance Criteria:**
    - [ ] Parses empty objects: `{}` evaluates to `{}`
    - [ ] Parses objects with identifier keys: `{a: 1, b: "two"}` evaluates correctly
    - [ ] Parses objects with string keys: `{"a key": 1}` evaluates correctly

### 2.7. Identifier Lookup

- The parser resolves identifiers against the scope and locals objects.
  - **Acceptance Criteria:**
    - [ ] Looks up identifier values from the scope: `aKey` evaluates to `scope.aKey`
    - [ ] Returns `undefined` for missing scope properties (does not throw)
    - [ ] Supports `this` as a reference to the scope itself

### 2.8. Member Expressions (Property Access)

- The parser supports dot notation and computed (bracket) property access.
  - **Acceptance Criteria:**
    - [ ] Dot notation: `aKey.anotherKey` accesses nested properties
    - [ ] Computed access: `aKey["anotherKey"]` accesses properties by string
    - [ ] Deeply chained access: `aKey.secondKey.thirdKey.fourthKey` works correctly
    - [ ] Returns `undefined` for missing intermediate properties (does not throw)
    - [ ] Computed access with expression: `lock[keys["aKey"]]` resolves nested lookups
    - [ ] Locals override scope for member expression roots: if `locals.aKey` exists, it is used instead of `scope.aKey`
    - [ ] Scope is used when locals exist but don't contain the root property
    - [ ] Member access uses the correct source object throughout the chain

### 2.9. Function Calls

- The parser supports calling functions found on scope or locals.
  - **Acceptance Criteria:**
    - [ ] Simple calls: `aFunction()` invokes the function from scope
    - [ ] Calls with arguments: `aFunction(42)` passes the argument
    - [ ] Calls with identifier arguments: `aFunction(n)` resolves `n` from scope
    - [ ] Calls with nested function arguments: `aFunction(argsFn())` evaluates inner call first
    - [ ] Multiple arguments: `aFunction(a, b, c)` passes all arguments
    - [ ] Method calls preserve `this` binding: `anObject.aFunction()` calls with `anObject` as `this`
    - [ ] Computed method calls: `anObject["aFunction"]()` also preserves `this`
    - [ ] Methods on deeply nested objects: `anObject.obj.nested()` binds `this` to `anObject.obj`

### 2.10. Whitespace Handling

- The parser ignores whitespace between tokens.
  - **Acceptance Criteria:**
    - [ ] `' \n42 '` evaluates to `42`
    - [ ] Whitespace between operators and operands is ignored

---

## 3. Scope and Boundaries

### In-Scope

- Full `parse()` function implementation in `src/core/`
- Three-stage pipeline: Lexer → AST Builder → Tree-walking Interpreter
- All expression features matching the legacy implementation (52 test behaviors)
- Comprehensive Vitest test suite achieving behavioral parity with legacy tests
- TypeScript types exported for downstream module consumption
- AST node type definitions

### Out-of-Scope

- **Operators** — arithmetic (`+`, `-`, `*`, `/`), comparison (`==`, `!=`, `<`, `>`), logical (`&&`, `||`, `!`), ternary (`?:`), unary (`+`, `-`, `!`) — separate Phase 2 spec
- **Filters** — the pipe (`|`) syntax for filter chaining — separate Phase 2 spec
- **Assignment expressions** — `a = b` — separate Phase 2 spec
- **One-time bindings** — `::` prefix for expressions that unwatch after stabilization — separate Phase 2 spec
- **Interpolation** — `$interpolate` service for `{{expression}}` in templates — separate Phase 2 spec
- **Scope integration** — wiring `parse()` into `$watch(string)` and `$eval(string)` — separate integration spec
- **Dependency Injection** — module system, injector, providers — separate Phase 1 spec
- **Directives & DOM Compilation** — compiler, linking — separate Phase 2 spec
- **Utility Functions** — helper function reimplementation — separate Phase 0 spec
