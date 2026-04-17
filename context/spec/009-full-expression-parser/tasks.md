# Tasks: Expression Parser — Operators, Assignments, and Scope Integration

- **Specification:** `context/spec/009-full-expression-parser/`
- **Status:** Draft

---

- [x] **Slice 1: Unary Operators (`!`, `-`, `+`)**
  - [x] Add `UnaryExpression` node to `ASTNode` union in `src/parser/parse-types.ts` with `operator: '!' | '+' | '-'` and `argument: ASTNode`. **[Agent: typescript-framework]**
  - [x] Extend `lexer.ts` to emit `!` as a single-character symbol token (alongside existing `+`/`-` handling). Do NOT yet change `+`/`-` lexing — they still tokenize as operator chars. **[Agent: typescript-framework]**
  - [x] In `src/parser/ast.ts`, introduce `unary()` between `primary()` and the future cascade entry. If the current token is `!`/`+`/`-` and not the start of a number literal, consume it and wrap `unary()` recursively; otherwise delegate to `primary()`. Update `program()` to call `unary()`. **[Agent: typescript-framework]**
  - [x] In `src/parser/interpreter.ts`, add a `UnaryExpression` case that evaluates `argument` and applies the operator (`!x`, `-x`, `+x`). **[Agent: typescript-framework]**
  - [x] Add tests in `src/parser/__tests__/parse.test.ts` under a new `describe('spec 009 — operators & assignment', ...)` wrapper, sub-describe `unary operators`: (a) `!true` → false, (b) `!0`/`!''` → true, (c) `!!'x'` → true, (d) `-5` → -5, (e) `-a` with `a=3` → -3, (f) `+"42"` coerces to 42, (g) `!!undefined` → false. **[Agent: vitest-testing]**
  - [x] Verify all existing spec 003 parser tests still pass plus new unary tests. `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass. **[Agent: typescript-framework]**

- [ ] **Slice 2: Multiplicative & Additive Arithmetic (`*`, `/`, `%`, `+`, `-`)**
  - [ ] Add `BinaryExpression` node to `ASTNode` union with operator literal type covering `+ - * / % == != === !== < <= > >=`. **[Agent: typescript-framework]**
  - [ ] Add `multiplicative()` and `additive()` layers in `ast.ts` using the standard left-recursive loop pattern (`let left = next(); while (op) left = BinaryExpression(...)`). Wire cascade: `program → additive → multiplicative → unary → primary`. **[Agent: typescript-framework]**
  - [ ] Add `BinaryExpression` case in `interpreter.ts` — switch on operator and apply the JS operator to evaluated `left`/`right`. **[Agent: typescript-framework]**
  - [ ] Add tests under `describe('spec 009 …')` sub-describe `arithmetic`: (a) `2+3`, `'a'+'b'`, `'x'+1`, (b) `10-4`, `3*4`, `10/4`, `10/0 === Infinity`, `10%3`, (c) precedence: `2+3*4` → 14, `(2+3)*4` → 20, (d) left-associativity: `10-3-2` → 5, (e) undefined identifier in arithmetic yields `NaN`. **[Agent: vitest-testing]**
  - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass. **[Agent: typescript-framework]**

- [ ] **Slice 3: Comparison Operators (`==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, `>=`)**
  - [ ] Extend `lexer.ts` with a greedy multi-character operator matcher: 3-char (`===`, `!==`), then 2-char (`==`, `!=`, `<=`, `>=`), then 1-char (`<`, `>`). Preserve existing single-char symbol handling. **[Agent: typescript-framework]**
  - [ ] Add `equality()` and `relational()` layers in `ast.ts`. Cascade order: `program → equality → relational → additive → multiplicative → unary → primary`. Equality handles `==`/`!=`/`===`/`!==`; relational handles `<`/`<=`/`>`/`>=`. Both produce `BinaryExpression` nodes. **[Agent: typescript-framework]**
  - [ ] Extend the `BinaryExpression` switch in `interpreter.ts` to cover the new comparison operators (using JS's `==`/`!=`/`===`/`!==`/`<`/`<=`/`>`/`>=`). **[Agent: typescript-framework]**
  - [ ] Add tests under sub-describe `comparison`: (a) `1==1`, `1=='1'` → true, (b) `1===1`, `1==='1'` → false, (c) `1!=2`, `1!=='1'`, (d) `3<5`, `5<=5`, `5>3`, `5>=5`, (e) precedence: `1+2<4` → true, `1<2 === true` → true. **[Agent: vitest-testing]**
  - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass. **[Agent: typescript-framework]**

- [ ] **Slice 4: Logical Operators (`&&`, `||`) with Short-Circuit**
  - [ ] Extend lexer greedy matcher to emit `&&` and `||` as 2-char tokens. **[Agent: typescript-framework]**
  - [ ] Add `LogicalExpression` node (fields: `operator: '&&' | '||'`, `left`, `right`). Add `logicalOR()` and `logicalAND()` layers. Cascade order: `program → logicalOR → logicalAND → equality → relational → additive → multiplicative → unary → primary`. **[Agent: typescript-framework]**
  - [ ] Add `LogicalExpression` case in `interpreter.ts` with short-circuit semantics — never evaluate `right` when `left` decides the result. **[Agent: typescript-framework]**
  - [ ] Add tests under sub-describe `logical`: (a) `true && false` → false, `true && 'x'` → 'x' (returns operand), (b) `false || 'fallback'` → 'fallback', `'a' || 'b'` → 'a', (c) short-circuit: `false && throwingFn()` does NOT call `throwingFn` (sentinel throws), (d) `true || throwingFn()` does NOT call, (e) precedence: `a || b && c` → `a || (b && c)`. **[Agent: vitest-testing]**
  - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass. **[Agent: typescript-framework]**

- [ ] **Slice 5: Ternary Operator (`? :`)**
  - [ ] Ensure `?` tokenizes as a single-character symbol (`:` already supported). **[Agent: typescript-framework]**
  - [ ] Add `ConditionalExpression` node (`test`, `consequent`, `alternate`). Add `ternary()` layer between `logicalOR` and `assignment` (assignment arrives in slice 6; for now `program → ternary → logicalOR → …`). Right-associative: after parsing `test ?`, parse `consequent` as `assignment/ternary`, then `:` then `alternate` as `assignment/ternary`. **[Agent: typescript-framework]**
  - [ ] Add `ConditionalExpression` case in `interpreter.ts` — evaluate `test`, then only the chosen branch. **[Agent: typescript-framework]**
  - [ ] Add tests under sub-describe `ternary`: (a) `true ? 1 : 2` → 1, `false ? 1 : 2` → 2, (b) dead-branch not evaluated: `true ? safe : throwingFn()` does not throw, (c) right-associative nesting: `a ? b : c ? d : e` → `a ? b : (c ? d : e)`, (d) precedence vs `||`: `a || b ? x : y` → `(a || b) ? x : y`. **[Agent: vitest-testing]**
  - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass. **[Agent: typescript-framework]**

- [ ] **Slice 6: Simple Assignment (`=`) with Auto-Create and Locals-First**
  - [ ] Add `AssignmentExpression` node with `left: Identifier | MemberExpression` and `right: ASTNode`. Ensure `=` tokenizes as a single-character symbol (don't collide with `==`/`===` matcher — greedy longest-match handles this). **[Agent: typescript-framework]**
  - [ ] Add `assignment()` layer as the new lowest-precedence top: `program → assignment → ternary → …`. After parsing an expression via `ternary()`, if the next token is `=`, verify the parsed LHS is `Identifier` or `MemberExpression` (throw `"Trying to assign a value to a non l-value"` otherwise), consume `=`, recursively parse RHS via `assignment()` (right-associative). **[Agent: typescript-framework]**
  - [ ] Add an `assign(node, value, scope, locals)` helper in `interpreter.ts`. For `Identifier`: write to `locals` iff `Object.prototype.hasOwnProperty.call(locals, name)`, else write to `scope`. For `MemberExpression`: recursively resolve the object chain, create `{}` for any `undefined`/`null` intermediate, then set the final key (handle both computed and non-computed). Return the assigned value. **[Agent: typescript-framework]**
  - [ ] Add `AssignmentExpression` case: evaluate `right`, call `assign(left, value, scope, locals)`. **[Agent: typescript-framework]**
  - [ ] Add tests under sub-describe `assignment`: (a) `a = 1` sets `scope.a`, returns 1, (b) `a.b = 2`, `a[k] = 3`, (c) auto-create: `a.b.c = 1` when `scope.a` undefined creates intermediates, (d) precedence: `a = 1 + 2` assigns 3, (e) right-associative: `a = b = 5` sets both, (f) invalid LHS throws (`1 = 2`, `fn() = 1`), (g) locals-first: `a = 1` writes to `locals` when `locals.a` exists, (h) locals does NOT hijack deep writes when root is in scope (e.g., if `scope.a = {}` and `locals.a` absent, `a.b = 2` writes to `scope.a.b`). **[Agent: vitest-testing]**
  - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass. **[Agent: typescript-framework]**

- [ ] **Slice 7: Scope Integration — String Expressions in `$watch`/`$watchGroup`/`$watchCollection`/`$eval`/`$evalAsync`/`$apply`/`$applyAsync`**
  - [ ] In `src/core/scope-types.ts`, widen `WatchFn<T>` usage sites: add `type Parsable<T> = WatchFn<T> | string` (or widen inline at each method signature). Update parameter types on the seven affected methods so each accepts the union. **[Agent: typescript-framework]**
  - [ ] In `src/core/scope.ts`, import `parse` from `../parser` and add a private helper `compileToWatchFn<T>(expr: WatchFn<T> | string): WatchFn<T>` that returns the function as-is if already a function, or wraps `parse(expr)` into a `WatchFn` otherwise. Parse error surfaces immediately. **[Agent: typescript-framework]**
  - [ ] At the entry of each of the seven methods, replace the raw parameter with `compileToWatchFn(...)` before the existing logic runs. For `$watchGroup`, map over the array. String expressions MUST be parsed once at the method-call site, not inside digest. **[Agent: typescript-framework]**
  - [ ] Create new test file `src/core/__tests__/scope-string-expr.test.ts`. Cover: (a) `$watch('user.name', fn)` fires on change, (b) function form still works, (c) `$watchGroup(['a','b.c'], fn)` fires when either changes, (d) `$watchCollection('items', fn)` detects mutations, (e) `$eval('a+b')` returns value, `$eval('a+b', {a:10})` honors locals, (f) `$evalAsync('counter = counter + 1')` commits during digest, (g) `$apply('x + 1')` returns value and triggers digest, (h) `$applyAsync('x = 1')` coalesces, (i) invalid string throws at call/registration (not silently deferred). **[Agent: vitest-testing]**
  - [ ] Add a regression check: all pre-existing scope tests continue to pass without modification. **[Agent: vitest-testing]**
  - [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass. **[Agent: typescript-framework]**

- [ ] **Slice 8: Precedence Matrix, Build Verification, Full Regression Pass**
  - [ ] Add a precedence matrix test table in `parse.test.ts` asserting every pairing of adjacent precedence levels (e.g., `a=b?c:d`, `a||b&&c`, `a&&b==c`, `a==b<c`, `a<b+c`, `a+b*c`, `a*b` + unary, unary + primary chain). Reference AngularJS `parse.js` tests for parity. **[Agent: vitest-testing]**
  - [ ] Run `pnpm build` and verify all dist artifacts (`dist/esm/*`, `dist/cjs/*`, `dist/types/*`) are still generated. Confirm the new AST node types flow through `dist/types/parser/parse-types.d.ts`. **[Agent: rollup-build]**
  - [ ] Run the full test suite: all pre-existing tests (parser + scope + DI) plus new spec 009 tests must pass. No regressions allowed. **[Agent: vitest-testing]**
  - [ ] Final verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass. **[Agent: typescript-framework]**
