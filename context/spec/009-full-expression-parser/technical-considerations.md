# Technical Specification: Expression Parser — Operators, Assignments, and Scope Integration

- **Functional Specification:** `context/spec/009-full-expression-parser/functional-spec.md`
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Extend the existing three-stage parser pipeline (`src/parser/`) in-place — no new modules, no architectural shift:

1. **Lexer (`lexer.ts`)** — add multi-character operator tokens (`==`, `===`, `!=`, `!==`, `<=`, `>=`, `&&`, `||`) alongside the single-character operators (`+`, `-`, `*`, `/`, `%`, `!`, `<`, `>`, `=`, `?`).
2. **AST builder (`ast.ts`)** — restructure the single `primary()` entry point into a **precedence-layered recursive-descent cascade**: `assignment → ternary → logicalOR → logicalAND → equality → relational → additive → multiplicative → unary → primary`. Each level either falls through or builds a composite node.
3. **AST types (`parse-types.ts`)** — extend the `ASTNode` union with five new node types: `UnaryExpression`, `BinaryExpression`, `LogicalExpression`, `ConditionalExpression`, `AssignmentExpression`.
4. **Interpreter (`interpreter.ts`)** — add cases for the new node types. Introduce an internal `assign(node, value, scope, locals)` helper that navigates member chains and auto-creates intermediate objects for `AssignmentExpression`.
5. **Scope integration (`core/scope.ts`)** — import `parse` and widen the accepted argument type on `$watch`, `$watchGroup`, `$watchCollection`, `$eval`, `$evalAsync`, `$apply`, `$applyAsync` to `WatchFn<T> | string`. Each method calls `parse(expr)` once at registration and forwards the resulting `ExpressionFn` to its existing function path.

All changes are additive with respect to public API. No file is deleted; no existing export is renamed.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. Lexer Changes (`src/parser/lexer.ts`)

Replace the `SYMBOLS` set with a table-driven multi-character operator matcher. On each iteration, attempt to greedily match a 3-char operator (`===`, `!==`), then 2-char (`==`, `!=`, `<=`, `>=`, `&&`, `||`), then 1-char (`+`, `-`, `*`, `/`, `%`, `!`, `<`, `>`, `=`, `?`, `[`, `]`, `{`, `}`, `(`, `)`, `,`, `:`, `;`).

Token shape is unchanged — operators are represented as `{ text: '===' }` etc., distinguished from identifiers by the absence of the `identifier` flag.

| Change | Purpose |
|---|---|
| Add operator set alongside `SYMBOLS` | Emit tokens for new operator characters |
| Greedy multi-char match loop | Produce `===`/`!==`/`==`/`!=`/`<=`/`>=`/`&&`/`\|\|` tokens |
| No change to number/string/identifier/keyword paths | Preserves spec 003 behavior |

### 2.2. AST Type Additions (`src/parser/parse-types.ts`)

Add the following discriminated union members to `ASTNode`:

| Node | Fields | Purpose |
|---|---|---|
| `UnaryExpression` | `operator: '!' \| '+' \| '-'`, `argument: ASTNode` | `!x`, `-x`, `+x` |
| `BinaryExpression` | `operator: '+'\|'-'\|'*'\|'/'\|'%'\|'=='\|'!='\|'==='\|'!=='\|'<'\|'<='\|'>'\|'>='`, `left`, `right` | Arithmetic & comparison |
| `LogicalExpression` | `operator: '&&'\|'\|\|'`, `left`, `right` | Short-circuit logical ops |
| `ConditionalExpression` | `test`, `consequent`, `alternate` | Ternary `?:` |
| `AssignmentExpression` | `left: Identifier \| MemberExpression`, `right: ASTNode` | Simple `=` assignment |

The `left` field on `AssignmentExpression` is typed narrowly so the AST builder rejects non-assignable targets at parse time.

### 2.3. AST Builder Restructure (`src/parser/ast.ts`)

Replace the flat `primary()` entry with the precedence cascade below. Each function attempts its own operator; if not present, it delegates to the next tighter-binding level.

```
program()
  └─ assignment()            // `=`, right-associative, lowest precedence
       └─ ternary()          // `? :`, right-associative
            └─ logicalOR()   // `||`
                 └─ logicalAND()      // `&&`
                      └─ equality()   // `==`, `!=`, `===`, `!==`
                           └─ relational()          // `<`, `<=`, `>`, `>=`
                                └─ additive()       // `+`, `-`
                                     └─ multiplicative()   // `*`, `/`, `%`
                                          └─ unary()        // `!`, `+`, `-`
                                               └─ primary()  // existing literals/identifiers/member/call
```

`assignment()` checks whether the left-hand side is an `Identifier` or `MemberExpression`; anything else produces a descriptive `"Trying to assign a value to a non l-value"` error. The existing postfix chain (member access, bracket access, call) remains inside `primary()` and runs first — so `a.b.c = 1` is parsed as `AssignmentExpression(MemberExpression(...), Literal(1))`.

### 2.4. Interpreter Additions (`src/parser/interpreter.ts`)

Add cases for the five new node types:

| Node | Evaluation strategy |
|---|---|
| `UnaryExpression` | Evaluate `argument`, then apply `!`, `-`, or `+` |
| `BinaryExpression` | Evaluate `left` and `right`, then apply the JS operator (switch on `operator`) |
| `LogicalExpression` | Short-circuit: for `&&`, return `left` if falsy else `right`; mirror for `\|\|` — never evaluate the right-hand side when short-circuited |
| `ConditionalExpression` | Evaluate `test`; evaluate and return the chosen branch only |
| `AssignmentExpression` | Evaluate `right`; call new `assign()` helper with `left`, the value, scope, and locals |

**`assign(node, value, scope, locals)` helper:**

- If `node` is `Identifier`: write to `locals` if `locals.<name>` exists, otherwise to `scope`.
- If `node` is `MemberExpression`: recursively ensure each intermediate object in the path exists (create `{}` when undefined/null), then assign to the final property. Computed (`[]`) and non-computed (`.`) paths both supported.
- Return the assigned value (so chained `a = b = 5` works via nested evaluation).

### 2.5. Scope Integration (`src/core/scope.ts`, `src/core/scope-types.ts`)

In `scope-types.ts`, widen the relevant function parameter types:

| Method | Old accepts | New accepts |
|---|---|---|
| `$watch` | `WatchFn<T>` | `WatchFn<T> \| string` |
| `$watchGroup` | `WatchFn<unknown>[]` | `(WatchFn<unknown> \| string)[]` |
| `$watchCollection` | `WatchFn<unknown>` | `WatchFn<unknown> \| string` |
| `$eval` | `(scope, locals?) => R` | `... \| string` |
| `$evalAsync` | `WatchFn<unknown>` | `WatchFn<unknown> \| string` |
| `$apply` | `WatchFn<R>` | `WatchFn<R> \| string` |
| `$applyAsync` | `WatchFn<unknown>` | `WatchFn<unknown> \| string` |

In `scope.ts`, add a single private helper `compileToWatchFn(expr)`:

- If `expr` is a function, return it unchanged.
- If `expr` is a string, call `parse(expr)` once and adapt the returned `ExpressionFn` (signature `(scope?, locals?) => unknown`) to match `WatchFn<unknown>` (signature `(scope) => T`).

Each of the seven methods calls this helper once at entry, then proceeds with its existing function-based logic. String expressions are parsed exactly once per call (or per registration for watchers), not per digest — satisfying acceptance criterion 2.6.5.

### 2.6. File Changes Summary

| File | Responsibility |
|---|---|
| `src/parser/lexer.ts` | Emit operator tokens (multi-char + single-char) |
| `src/parser/ast.ts` | Precedence-layered recursive descent; assignment l-value check |
| `src/parser/interpreter.ts` | Evaluate new node types; implement `assign()` helper with auto-create |
| `src/parser/parse-types.ts` | Extend `ASTNode` union with 5 new node shapes |
| `src/parser/index.ts` | No change (public API unchanged) |
| `src/core/scope-types.ts` | Widen watcher/eval/apply parameter types |
| `src/core/scope.ts` | Add `compileToWatchFn` helper; call at top of each affected method |
| `src/parser/__tests__/parse.test.ts` | Add operator / assignment / precedence / short-circuit suites |
| `src/core/__tests__/scope-string-expr.test.ts` (new) | Integration tests: `$watch('a.b')`, `$eval('a+b')`, etc. |

Reference: AngularJS 1.x [`$parse`](https://github.com/angular/angular.js/blob/master/src/ng/parse.js) source for operator and assignment semantics parity.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **Parser ↔ core/utils:** Existing (unchanged) — parser imports `isKeyOf` from `@core/utils`.
- **Scope → parser:** New one-way dependency. `scope.ts` imports `parse`. No cycle because `parse` only depends on `@core/utils`, not on scope.
- **DI system:** Untouched — no changes to `src/di/`.
- **Compiler:** Untouched for now — future directive work will benefit from string-expression support but is out of scope here.

### Potential Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Precedence bugs** — JS precedence is easy to get subtly wrong (e.g., `&&` vs `\|\|`, ternary vs `\|\|`) | Dedicated test tables enumerating precedence pairings; reference AngularJS `parse.js` test suite for parity cases |
| **Breaking existing spec 003 tests** when restructuring AST builder | Run the full existing `parse.test.ts` on every commit; the cascade must fall through to `primary()` when no operators are present |
| **Assignment auto-create writing to wrong object** (e.g., overwriting a prototype property, or writing to scope when `locals` should be used) | `assign()` helper uses `Object.prototype.hasOwnProperty.call` for locals-lookup on the root identifier only; for chained member access, follow the resolved object reference |
| **Circular dependency** if anyone later makes `core/utils` import from parser | Keep `core/utils` as a pure leaf module — enforce via review; no new imports added in this spec |
| **Short-circuit regressions** — accidentally evaluating both sides of `&&`/`\|\|` | Explicit tests that assert a function reference in the dead branch is NOT called |
| **Infinite recursion on self-referential watch strings** (e.g., `$watch('a = a + 1', ...)`) | Existing TTL mechanism in digest already handles this; no extra work needed |
| **String-expression re-parsing per digest** (performance) | Parse once at registration and store the compiled `ExpressionFn`; watchers hold the function, not the string |
| **Type safety of widened parameters** — consumers may pass arbitrary `string` and lose type checking | Acceptable trade-off for API parity; Vitest tests cover string-path behavior |

---

## 4. Testing Strategy

- **Unit tests (parser):** Extend `src/parser/__tests__/parse.test.ts` with:
  - One `describe` block per operator category (arithmetic, comparison, logical, unary, ternary, assignment)
  - A precedence table test asserting every pairing of adjacent precedence levels
  - Short-circuit tests using sentinel throwing functions
  - Assignment auto-create tests covering `a=`, `a.b=`, `a[k]=`, deeply-chained paths, locals-vs-scope resolution
  - Parse-error tests for invalid assignment targets
- **Integration tests (scope, new file `src/core/__tests__/scope-string-expr.test.ts`):**
  - `$watch('a.b', fn)` fires when `scope.a.b` changes
  - `$watchGroup(['a','b'], fn)` fires for either
  - `$watchCollection('items', fn)` detects collection changes
  - `$eval('a+b')`, `$eval('a+b', {a:10})`
  - `$evalAsync('counter = counter + 1')` commits during digest
  - `$apply('x')` returns value and triggers digest
  - `$applyAsync('x = 1')` coalesces correctly
  - Each method still accepts a function (regression check against spec 003 / earlier scope tests)
- **Parity check:** Confirm all existing parser and scope tests still pass unmodified.
- **Coverage:** Maintain the 90%+ target on `src/parser/` and `src/core/`. Run `pnpm test --coverage` and verify no regression.
