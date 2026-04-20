# Functional Specification: One-Time Bindings (`::` Prefix) & Constant Watch Optimization

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Expressions & Parser > One-Time Bindings
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 009 delivered a full expression parser and wired string expressions into every Scope watch/eval/apply method. Every `$watch('user.name', fn)` now registers a live watcher that runs on every digest for the lifetime of the scope — even when the underlying value is set once at boot time and never changes.

In real AngularJS apps, this cost adds up fast. A rendered list with 500 rows, each binding three "static-once-loaded" fields (username, created-at, avatar url), produces 1,500 watchers that keep re-evaluating forever. AngularJS 1.3 solved this with **one-time bindings**: an expression prefixed with `::` is watched only until its value stabilizes, then the watcher deregisters itself. A companion optimization, the **constant watch**, deregisters after a single evaluation whenever the expression is a pure literal (`42`, `'hello'`, `[1,2]`) — no `::` required.

This spec adds both optimizations, in strict parity with AngularJS 1.x. After this spec lands, downstream work (interpolation, directives like `ng-bind`, templates with `{{::user.name}}`) can rely on these semantics being available at the Scope layer.

**Success criteria:** Any expression string accepted by `parse()` continues to parse and evaluate identically; additionally, expressions prefixed with `::` or detected as constant trigger self-deregistering watcher behavior matching AngularJS 1.x. All existing spec 009 tests continue to pass.

---

## 2. Functional Requirements (The "What")

### 2.1. Parser Recognizes `::` Prefix

- The parser strips a leading `::` from a trimmed expression string and flags the resulting parsed function as one-time.
  - **Acceptance Criteria:**
    - [ ] `parse('::user.name')` returns a function whose `.oneTime` property is `true`; calling it returns the same value as `parse('user.name')` against the same scope
    - [ ] `parse('user.name')` returns a function whose `.oneTime` property is `false`
    - [ ] Leading/trailing whitespace around `::` is ignored: `parse('  ::user.name  ')` is equivalent to `parse('::user.name')`
    - [ ] `::` must appear at the very start of the trimmed expression. `a + ::b`, `::a + ::b`, and `foo(::x)` each throw a descriptive parse error
    - [ ] A lone `::` with no following expression (`parse('::')`) throws a descriptive parse error

### 2.2. Parsed Function Metadata Flags

- The function returned by `parse()` exposes three boolean properties used by the Scope layer to decide watcher behavior.
  - **Acceptance Criteria:**
    - [ ] `.oneTime` — `true` iff the expression starts with `::`
    - [ ] `.constant` — `true` iff the entire AST is composed of literal values (numbers, strings, booleans, `null`, `undefined`, and arrays/objects of constants). Identifiers, member access, function calls, and operators over non-constants all produce `.constant === false`
    - [ ] `.literal` — `true` iff the top-level AST node is an array literal, object literal, or primitive literal (matches AngularJS `isLiteral`)
    - [ ] All three flags are present on every parsed fn (never `undefined`); default to `false` when not applicable
    - [ ] `parse('42').constant === true`, `parse('42').literal === true`, `parse('42').oneTime === false`
    - [ ] `parse('::[a, b]').oneTime === true`, `parse('::[a, b]').literal === true`, `parse('::[a, b]').constant === false`
    - [ ] `parse('[1, 2]').constant === true` and `.literal === true`
    - [ ] `parse('a + b').constant === false`, `.literal === false`, `.oneTime === false`

### 2.3. One-Time Watch — Non-Literal Expressions

- When `$watch` receives a string expression whose parsed fn has `.oneTime === true` and `.literal === false`, the watcher deregisters itself after the digest in which the value first becomes defined.
  - **Acceptance Criteria:**
    - [ ] `scope.$watch('::user.name', listener)` — while `scope.user` is undefined, digests run without firing the listener and the watcher remains registered
    - [ ] The first digest in which `scope.user.name` becomes non-`undefined` (even if it's `null`, `0`, `''`, `false`, or `NaN`) fires the listener with the new value, then the watcher deregisters at the end of the digest (post-digest phase)
    - [ ] After deregistration, further changes to `scope.user.name` do NOT fire the listener and do NOT re-register the watcher
    - [ ] If the stabilized value subsequently changes within the same digest (before post-digest unwatch), the final value is what the listener sees; the watcher still deregisters
    - [ ] The `$watch` call returns a deregister function; calling it before the value stabilizes cancels the watch and the listener is never called
    - [ ] An expression that never becomes defined continues to be watched indefinitely (no forced deregistration)

### 2.4. One-Time Watch — Literal Expressions

- When `$watch` receives a one-time expression whose parsed fn is a top-level array or object literal, the watcher deregisters only after every element/property of the literal is defined.
  - **Acceptance Criteria:**
    - [ ] `scope.$watch('::[a, b]', listener)` — if `scope.a === 1` and `scope.b === undefined`, the watcher stays live. The listener fires on each change as a normal watcher would
    - [ ] Once both `scope.a` and `scope.b` are non-`undefined`, the watcher deregisters post-digest
    - [ ] `scope.$watch('::{x: a, y: b}', listener)` — deregisters only after both `a` and `b` are non-`undefined`
    - [ ] Nested literals check only the top-level members: `::[a, [b, c]]` deregisters once `a` and the inner array itself are defined (the inner array is always defined since it's constructed each eval)
    - [ ] Empty literals (`::[]`, `::{}`) deregister immediately on the first digest

### 2.5. Constant Watch Optimization

- When `$watch` receives a string expression whose parsed fn has `.constant === true` (regardless of `.oneTime`), the watcher fires once and deregisters immediately on that first evaluation.
  - **Acceptance Criteria:**
    - [ ] `scope.$watch('42', listener)` fires `listener` once with `newValue === 42` on the next digest, then deregisters
    - [ ] `scope.$watch('::42', listener)` behaves identically to `scope.$watch('42', listener)` — `::` on a constant is a no-op
    - [ ] `scope.$watch('"hello"', listener)` and `scope.$watch('[1, 2, 3]', listener)` both fire once then deregister
    - [ ] Deregistration for constants happens in the same digest as the first evaluation (no need to wait for post-digest), matching AngularJS `constantWatchDelegate`
    - [ ] The returned deregister function remains callable (no-op after self-deregistration)

### 2.6. Scope Integration — `$watchGroup`

- `$watchGroup` honors `::` on each entry independently. Each string expression in the array is routed through its own one-time or normal watch.
  - **Acceptance Criteria:**
    - [ ] `scope.$watchGroup(['::a', 'b'], listener)` — the `a` watch deregisters once `scope.a` stabilizes; the `b` watch continues watching normally
    - [ ] The listener continues to fire for changes to `b` even after `a`'s watch has deregistered; the `a` slot in the `newValues` array retains its last stable value
    - [ ] A mix of `::`, constant, and normal expressions in one group all behave per their individual rules
    - [ ] An empty `$watchGroup([], listener)` continues to work as today (listener fires once asynchronously with empty arrays)

### 2.7. Scope Integration — `$watchCollection`

- `$watchCollection` honors `::` on its expression. The collection watcher deregisters after the collection value first becomes non-`undefined`.
  - **Acceptance Criteria:**
    - [ ] `scope.$watchCollection('::items', listener)` — while `scope.items` is undefined, nothing fires. Once `scope.items` becomes an array or object (even empty), the listener fires once with the initial collection snapshot and the watcher deregisters post-digest
    - [ ] After deregistration, subsequent mutations to `scope.items` (push, splice, property add/remove) do NOT fire the listener
    - [ ] `scope.$watchCollection('items', listener)` (without `::`) retains all existing spec-009 behavior — tracks collection mutations indefinitely
    - [ ] A constant collection expression (e.g., `scope.$watchCollection('[1,2,3]', listener)`) fires once and deregisters, matching `.constant` behavior

### 2.8. Scope Integration — `$eval`, `$apply`, `$evalAsync`, `$applyAsync`

- The `::` prefix is stripped by the parser but has no one-time semantics for these methods (they don't register watchers). They evaluate the underlying expression normally.
  - **Acceptance Criteria:**
    - [ ] `scope.$eval('::a + b')` returns the same value as `scope.$eval('a + b')`
    - [ ] `scope.$apply('::counter = counter + 1')` applies and digests normally, returning the expression's value
    - [ ] `scope.$evalAsync('::x')` and `scope.$applyAsync('::y = 1')` queue evaluations exactly as their non-prefixed equivalents would
    - [ ] No deregistration or special behavior occurs; these methods never register watchers, so `oneTime` is purely inert here

### 2.9. Error Behavior

- Invalid `::` usage produces descriptive parse errors at registration time, not silent failures at digest time.
  - **Acceptance Criteria:**
    - [ ] `parse(':')` throws a parse error (not treated as one-time)
    - [ ] `parse('a + ::b')` throws a parse error referencing the unexpected `:` token
    - [ ] `parse('::')` throws a descriptive "empty expression after `::`" style error
    - [ ] `scope.$watch('a + ::b', fn)` throws the same error synchronously on registration (consistent with spec 009 § 2.7)

### 2.10. Backward Compatibility

- All spec 003 and spec 009 behaviors and APIs remain intact.
  - **Acceptance Criteria:**
    - [ ] Every existing parser and scope test from specs 003 and 009 continues to pass unchanged
    - [ ] The `parse(expr)` return value is still callable as `(scope, locals?) => value`; adding the `oneTime`/`constant`/`literal` properties is additive
    - [ ] Existing `$watch` / `$watchGroup` / `$watchCollection` / `$eval` / `$apply` / `$evalAsync` / `$applyAsync` signatures are unchanged — no argument order changes, no removed overloads
    - [ ] Function-form watch expressions (e.g., `$watch(fn, listener)`) continue to work exactly as before; they simply have no `oneTime`/`constant`/`literal` flags and behave as normal watchers
    - [ ] No existing public export is removed or renamed

---

## 3. Scope and Boundaries

### In-Scope

- `::` prefix recognition at the start of expression strings (parser level)
- `oneTime`, `constant`, and `literal` metadata flags on parsed functions
- One-time watch semantics for `$watch` (non-literal and literal cases)
- Constant-expression watch optimization (single-fire, immediate self-deregistration)
- Per-entry `::` handling in `$watchGroup`
- `::` handling in `$watchCollection`
- No-op but error-free handling of `::` in `$eval`, `$apply`, `$evalAsync`, `$applyAsync`
- Descriptive parse errors for malformed `::` usage
- Post-digest-timed deregistration (unwatch happens after the stabilizing digest finishes)

### Out-of-Scope

- **Interpolation (`$interpolate`, `{{::expr}}` in templates)** — separate Phase 2 roadmap item. The `::` inside `{{...}}` will be handled by the interpolation service in its own spec, though it will reuse the parser flags delivered here.
- **Filter pipeline (`|`)** — separate Phase 2 roadmap item. One-time expressions interacting with filters (e.g., `::items | orderBy:'name'`) will be covered when filters land.
- **Directives & DOM compilation** — separate Phase 2 roadmap items
- **`$parseProvider.unwrapPromises` and other $parse provider config** — not part of modern AngularJS and explicitly out of scope for the project
- **`$$watchDelegate` as a public API** — internal mechanism only; callers use `::` in the string, not direct delegate injection
- **Watcher fast-path input optimization (`inputsWatchDelegate`)** — AngularJS also memoizes expressions by their inputs to skip re-evaluation when inputs haven't changed. That is a separate performance optimization, not required for one-time binding correctness, and is out of scope for this spec
- **All later-phase roadmap items** — HTTP, Forms, Routing, Animations, `angular` namespace — separate specs
