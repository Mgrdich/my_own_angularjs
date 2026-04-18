# Functional Specification: Expression Parser — Operators, Assignments, and Scope Integration

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Expressions & Parser > Expression Parser
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 003 delivered a tree-walking parser supporting literals, identifiers, member/computed access, and function calls — but deliberately deferred **operators**, **assignment expressions**, and **scope integration**. Without these, real AngularJS expressions like `user.age >= 18`, `price * qty`, `isOpen = true`, or `$watch('user.name', fn)` cannot be used; consumers still have to pre-parse and wrap every expression manually.

This spec closes the gap. It extends the existing `parse()` function to handle the full AngularJS 1.x operator set and simple assignments, and wires it into every Scope method that accepts expressions, so that downstream work (interpolation, directives, filters, one-time bindings) can assume a fully working `parse()` + string-capable Scope API.

**Success criteria:** Any AngularJS 1.x expression composed of literals, identifiers, member access, function calls, arithmetic, comparison, logical, unary, ternary, and simple assignment operators parses and evaluates with AngularJS-parity semantics. `$watch`, `$watchGroup`, `$watchCollection`, `$eval`, `$evalAsync`, `$apply`, and `$applyAsync` all accept string expressions. All existing spec 003 tests continue to pass.

---

## 2. Functional Requirements (The "What")

### 2.1. Arithmetic Operators

- The parser supports binary `+`, `-`, `*`, `/`, `%` with JavaScript semantics.
  - **Acceptance Criteria:**
    - [x] `2 + 3` evaluates to `5`; `'a' + 'b'` evaluates to `'ab'`; `'x' + 1` evaluates to `'x1'` (JS string concat)
    - [x] `10 - 4` evaluates to `6`; `3 * 4` evaluates to `12`
    - [x] `10 / 4` evaluates to `2.5`; `10 / 0` evaluates to `Infinity`
    - [x] `10 % 3` evaluates to `1`
    - [x] Operator precedence matches JS: `2 + 3 * 4` evaluates to `14`
    - [x] Parentheses override precedence: `(2 + 3) * 4` evaluates to `20`
    - [x] Missing identifiers are treated as `undefined` (no throw); arithmetic on `undefined` yields `NaN` as in JS

### 2.2. Comparison Operators

- The parser supports `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, `>=` with JavaScript semantics.
  - **Acceptance Criteria:**
    - [x] `1 == 1` is `true`; `1 == '1'` is `true` (loose equality, JS parity)
    - [x] `1 === '1'` is `false` (strict equality)
    - [x] `1 != 2` is `true`; `1 !== '1'` is `true`
    - [x] `3 < 5`, `5 <= 5`, `5 > 3`, `5 >= 5` all evaluate correctly
    - [x] Relational operators have lower precedence than arithmetic: `1 + 2 < 4` evaluates to `true`

### 2.3. Logical and Unary Operators

- The parser supports `&&`, `||`, `!`, unary `+`, and unary `-` with short-circuit evaluation.
  - **Acceptance Criteria:**
    - [x] `true && false` is `false`; `true && 'x'` is `'x'` (JS parity, returns operand)
    - [x] `false || 'fallback'` is `'fallback'`; `'a' || 'b'` is `'a'`
    - [x] `&&` short-circuits: `false && throwingFn()` does NOT call `throwingFn`
    - [x] `||` short-circuits: `true || throwingFn()` does NOT call `throwingFn`
    - [x] `!true` is `false`; `!0` is `true`; `!!'x'` is `true`
    - [x] Unary `-5` evaluates to `-5`; `-a` where `a=3` evaluates to `-3`
    - [x] Unary `+` coerces: `+"42"` evaluates to `42`
    - [x] Precedence: `!` > unary `+`/`-` > `*`/`/`/`%` > `+`/`-` > comparison > `&&` > `||`

### 2.4. Ternary Operator

- The parser supports the `condition ? thenExpr : elseExpr` conditional expression.
  - **Acceptance Criteria:**
    - [x] `true ? 1 : 2` evaluates to `1`; `false ? 1 : 2` evaluates to `2`
    - [x] Only the selected branch is evaluated: `true ? safe : throwingFn()` does not call `throwingFn`
    - [x] Ternaries nest right-associatively: `a ? b : c ? d : e` parses as `a ? b : (c ? d : e)`
    - [x] Ternary has lower precedence than `||`: `a || b ? x : y` parses as `(a || b) ? x : y`

### 2.5. Assignment Expressions

- The parser supports simple assignment (`=`) to identifiers, dot access, and computed access.
  - **Acceptance Criteria:**
    - [x] `a = 1` sets `scope.a = 1` and evaluates to `1`
    - [x] `a.b = 2` sets `scope.a.b = 2` when `scope.a` exists
    - [x] `a[k] = 3` sets `scope.a[scope.k] = 3`
    - [x] Auto-create intermediates: `a.b.c = 1` when `scope.a` is undefined creates `scope.a = {}`, `scope.a.b = {}`, then sets `.c = 1` (AngularJS parity)
    - [x] Assignment has lowest precedence: `a = 1 + 2` assigns `3`
    - [x] Right-associative: `a = b = 5` sets both `a` and `b` to `5`
    - [x] Assigning to a non-assignable target (e.g., a literal or function call result) throws a descriptive error
    - [x] When `locals` is provided and `locals.a` exists, `a = 1` writes to `locals`, not scope (locals-first resolution)

### 2.6. Scope Integration — Watchers

- `$watch`, `$watchGroup`, and `$watchCollection` accept string expressions, parsed via the existing `parse()` function.
  - **Acceptance Criteria:**
    - [x] `scope.$watch('user.name', listener)` fires `listener` when `scope.user.name` changes
    - [x] `scope.$watch` continues to accept a function `watchExpression` (no breaking change)
    - [x] `scope.$watchGroup(['a', 'b.c'], listener)` fires when either expression's value changes, passing arrays of new/old values
    - [x] `scope.$watchCollection('items', listener)` tracks the parsed expression's result as a collection, matching existing collection-watch semantics
    - [x] String watchExpressions are parsed once at registration, not on every digest
    - [x] Invalid expressions throw at registration time with a descriptive error

### 2.7. Scope Integration — Evaluation & Apply

- `$eval`, `$evalAsync`, `$apply`, and `$applyAsync` accept string expressions.
  - **Acceptance Criteria:**
    - [x] `scope.$eval('a + b')` returns the evaluated value against the scope
    - [x] `scope.$eval('a + b', {a: 10})` evaluates with locals overriding scope
    - [x] `scope.$evalAsync('counter = counter + 1')` queues evaluation for the next digest
    - [x] `scope.$apply('counter + 1')` evaluates the expression and runs a digest, returning the expression's value
    - [x] `scope.$applyAsync('counter = counter + 1')` schedules async apply with the parsed expression
    - [x] All five methods continue to accept function arguments (no breaking change)
    - [x] Passing a string that fails to parse throws a descriptive error immediately (not silently deferred)

### 2.8. Backward Compatibility

- All spec 003 behaviors and APIs remain intact.
  - **Acceptance Criteria:**
    - [x] Every existing parser test from spec 003 continues to pass unchanged
    - [x] The `parse(expr)` signature `(scope, locals?) => value` is unchanged
    - [x] Existing Scope methods keep their function-argument form working exactly as before
    - [x] No existing public export is removed or renamed

---

## 3. Scope and Boundaries

### In-Scope

- Arithmetic operators: `+`, `-`, `*`, `/`, `%`
- Comparison operators: `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, `>=`
- Logical operators: `&&`, `||` (with short-circuit)
- Unary operators: `!`, `+`, `-`
- Ternary: `? :`
- Simple assignment: `=` (with auto-creating intermediates, locals-first resolution)
- Operator precedence and associativity matching JavaScript
- Parenthesized grouping: `( ... )`
- Scope integration for `$watch`, `$watchGroup`, `$watchCollection`, `$eval`, `$evalAsync`, `$apply`, `$applyAsync`
- Descriptive parse errors thrown immediately for invalid expressions

### Out-of-Scope

- **Filters (`|` pipe syntax)** — separate Phase 2 roadmap item
- **One-Time Bindings (`::` prefix)** — separate Phase 2 roadmap item
- **Interpolation (`$interpolate`, `{{...}}`)** — separate Phase 2 roadmap item
- **Directives & DOM compilation** — separate Phase 2 roadmap items
- **Compound assignments** (`+=`, `-=`, `*=`, `/=`, etc.) — not in AngularJS 1.x
- **Increment/decrement operators** (`++`, `--`) — not in AngularJS 1.x
- **Bitwise operators** (`&`, `|`, `^`, `~`, `<<`, `>>`, `>>>`) — not in AngularJS 1.x
- **`typeof`, `instanceof`, `in`, `void`, `delete`** — not in AngularJS 1.x
- **`new` expressions** — not in AngularJS 1.x
- **Regular expression literals** — not in AngularJS 1.x
- **Promises / async** (`$q`, `$timeout`, `$interval`) — separate Phase 3 roadmap items
- **All later-phase roadmap items** (Filters pipeline, Directives, HTTP, Forms, Routing, Animations, `angular` namespace) — separate specs
