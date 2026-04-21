# Functional Specification: `$interpolate` Service — String & Template Interpolation

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Expressions & Parser > Interpolation
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Specs 003/009/010 delivered a complete expression parser: a developer can already call `parse('user.name')` to get an `ExpressionFn` that evaluates against a scope, and `$watch('user.name', fn)` will dirty-check it in the digest. But the real end-user of AngularJS rarely writes `$watch('user.name', ...)` in their code — they write `<span>Hello {{user.name}}</span>` in a template and expect the DOM to show `Hello Alice`.

**The missing piece** is a service that takes a string mixing literal text with `{{expression}}` markers, splits it into text chunks and expression chunks, compiles each expression via `parse()`, and returns a function `(scope) => string` that produces the fully-evaluated text. That service is `$interpolate`. It is the bridge between the parser and every template-facing feature on the roadmap: `ng-bind`, attribute interpolation (`title="Hello {{user.name}}"`), `ng-href`, etc.

This spec delivers the `$interpolate` service and its provider (`$interpolateProvider`) in parity with AngularJS 1.x. It reuses the existing `parse()` module and the `::` one-time metadata from spec 010. After this lands, downstream work on directives and template compilation can rely on `$interpolate` being available via DI.

**Success criteria:**
- Any template string with zero or more `{{expr}}` markers can be compiled to a function that renders correctly against a scope.
- `{{::expr}}` inside an interpolated string produces a watchable function that deregisters when all embedded expressions stabilize.
- `$interpolateProvider.startSymbol()` / `.endSymbol()` let users customize delimiters at config time.
- All existing parser and scope tests (specs 003, 009, 010) continue to pass.

---

## 2. Functional Requirements (The "What")

### 2.1. Service Registration & Signature

- The `$interpolate` service is registered on the core module via the DI/module system delivered in specs 007–008. Callers obtain it by injecting `'$interpolate'`.
  - **Acceptance Criteria:**
    - [ ] A bootstrap module (e.g., `ng` or project-internal equivalent) registers both `$interpolateProvider` (at provider phase) and `$interpolate` (at runtime phase, returned from the provider's `$get`)
    - [ ] `injector.get('$interpolate')` returns a callable function
    - [ ] `injector.get('$interpolateProvider')` is only accessible during `config()` blocks, consistent with the existing provider lifecycle from spec 008
    - [ ] The service signature is `$interpolate(text: string, mustHaveExpression?: boolean, trustedContext?: string, allOrNothing?: boolean): InterpolateFn | undefined`
    - [ ] `InterpolateFn` is a callable `(context: Record<string, unknown>) => string | undefined` with additional metadata properties (defined in § 2.9)

### 2.2. Basic Interpolation (Zero, One, and Many Expressions)

- `$interpolate(text)` returns a function that, when called with a scope-like context, returns the original text with each `{{expr}}` replaced by the stringified evaluation of `expr` against the context.
  - **Acceptance Criteria:**
    - [ ] `$interpolate('Hello')` returns a fn; calling it with any context returns `'Hello'`
    - [ ] `$interpolate('Hello {{name}}')` called with `{name: 'Alice'}` returns `'Hello Alice'`
    - [ ] `$interpolate('{{greet}} {{name}}!')` called with `{greet: 'Hi', name: 'Bob'}` returns `'Hi Bob!'`
    - [ ] Expressions are evaluated in left-to-right order; their string representations are concatenated with the surrounding literal text in source order
    - [ ] Leading/trailing text outside any expression is preserved exactly (including whitespace, punctuation, newlines)
    - [ ] Adjacent expressions with no text between them (`'{{a}}{{b}}'`) concatenate their values with no separator

### 2.3. Value Stringification

- Evaluated expression results are converted to strings using AngularJS parity rules.
  - **Acceptance Criteria:**
    - [ ] `undefined` and `null` render as the empty string (`''`)
    - [ ] Numbers render via their default `String()` conversion: `1` → `'1'`, `1.5` → `'1.5'`, `NaN` → `'NaN'`
    - [ ] Booleans render as `'true'` / `'false'`
    - [ ] Objects and arrays render via `JSON.stringify` (matches AngularJS `toJson`), e.g. `{a: 1}` → `'{"a":1}'`, `[1, 2]` → `'[1,2]'`
    - [ ] Strings render as-is (no quoting)
    - [ ] Functions render as their default `String()` conversion (matches AngularJS — rare in practice)

### 2.4. Configurable Delimiters via `$interpolateProvider`

- `$interpolateProvider` exposes `startSymbol(value?)` and `endSymbol(value?)` to read or configure the interpolation delimiters at config time. Defaults are `'{{'` and `'}}'`.
  - **Acceptance Criteria:**
    - [ ] `$interpolateProvider.startSymbol()` with no args returns the current start symbol; default is `'{{'`
    - [ ] `$interpolateProvider.startSymbol('[[')` sets the start symbol and returns the provider (fluent)
    - [ ] `$interpolateProvider.endSymbol()` with no args returns the current end symbol; default is `'}}'`
    - [ ] `$interpolateProvider.endSymbol(']]')` sets the end symbol and returns the provider (fluent)
    - [ ] After a `config()` block calls `startSymbol('[[').endSymbol(']]')`, `$interpolate('Hello [[name]]')` works as `$interpolate('Hello {{name}}')` would have with defaults
    - [ ] `$interpolate` itself exposes `$interpolate.startSymbol()` and `$interpolate.endSymbol()` (no-arg getters) that return the active symbols
    - [ ] Attempting to set symbols after the injector is created (outside `config()`) is not supported (provider is unavailable post-config, per spec 008)
    - [ ] Start and end symbols must be distinct non-empty strings; [NEEDS CLARIFICATION: should we validate this at `startSymbol`/`endSymbol` call time, or leave validation to the lexer producing undefined behavior?]

### 2.5. `mustHaveExpression` Flag

- When `mustHaveExpression` is `true` and the input text contains no interpolation markers, `$interpolate` returns `undefined` instead of a function.
  - **Acceptance Criteria:**
    - [ ] `$interpolate('plain text', true)` returns `undefined`
    - [ ] `$interpolate('hello {{name}}', true)` returns a callable interpolation function
    - [ ] `$interpolate('plain text')` (flag defaulted/false) returns a function whose invocation yields `'plain text'`
    - [ ] `$interpolate('plain text', false)` is equivalent to `$interpolate('plain text')`
    - [ ] Whitespace-only text with no markers, `$interpolate('   ', true)`, returns `undefined`
    - [ ] A string containing only an empty marker pair (if that's even allowed; see § 2.10) does not count as containing an expression if it yields no parseable expression

### 2.6. `allOrNothing` Flag

- When `allOrNothing` is `true` and ANY embedded expression evaluates to `undefined`, the entire interpolation function returns `undefined` for that invocation (instead of rendering `undefined` chunks as `''`).
  - **Acceptance Criteria:**
    - [ ] `$interpolate('hello {{name}}', false, undefined, true)` called with `{}` (no `name` key) returns `undefined`
    - [ ] The same interpolation called with `{name: 'World'}` returns `'hello World'`
    - [ ] `$interpolate('a {{x}} b {{y}}', false, undefined, true)` with `{x: 1}` (no `y`) returns `undefined` — a single undefined expression triggers all-or-nothing
    - [ ] `null` values do NOT trigger all-or-nothing — only `undefined` does (AngularJS behavior)
    - [ ] With `allOrNothing === false` (the default), undefined values render as `''` per § 2.3
    - [ ] `$interpolate('plain text', false, undefined, true)` (no expressions) still returns a function that yields `'plain text'` — all-or-nothing applies only when there are expressions

### 2.7. One-Time Bindings in Interpolation (`{{::expr}}`)

- Individual expressions inside interpolation may use the `::` prefix. The compiled interpolation function exposes `.oneTime === true` if and only if EVERY embedded expression is one-time. Watchers registered over a one-time interpolation deregister after all expressions have stabilized.
  - **Acceptance Criteria:**
    - [ ] `$interpolate('Hello {{::name}}')` returns a fn with `.oneTime === true`
    - [ ] `$interpolate('Hello {{name}}')` returns a fn with `.oneTime === false`
    - [ ] `$interpolate('{{::a}} and {{b}}')` returns a fn with `.oneTime === false` (mixed — at least one non-one-time expression)
    - [ ] `$interpolate('{{::a}} and {{::b}}')` returns a fn with `.oneTime === true` (all expressions one-time)
    - [ ] `$interpolate('plain text')` (no expressions) returns a fn with `.oneTime === false`
    - [ ] `scope.$watch($interpolate('Hello {{::name}}'), listener)` — the listener fires on each digest while `scope.name` is undefined (reading as `'Hello '`); once `scope.name` becomes non-undefined, the listener fires with the final rendered string and the watcher deregisters post-digest
    - [ ] For an all-one-time interpolation with multiple expressions, deregistration waits until EVERY embedded expression resolves to a non-undefined value
    - [ ] Intermediate digests (before stabilization) render undefined expressions as `''` (not `'undefined'`)

### 2.8. `trustedContext` Parameter (Stub)

- The `trustedContext` parameter is accepted to match the AngularJS signature, but full `$sce` integration is deferred to a separate spec when `$sce` is added to the roadmap. In this spec, `trustedContext` is a no-op placeholder.
  - **Acceptance Criteria:**
    - [ ] The service signature accepts `trustedContext?: string` as its third positional argument
    - [ ] Passing any truthy/falsy value for `trustedContext` produces identical output as omitting it — values are treated as plain strings with no escaping or sanitization
    - [ ] The TypeScript type captures the parameter so downstream callers won't break when `$sce` lands
    - [ ] [NEEDS CLARIFICATION: full `$sce`-based escaping and sanitization] — tracked separately; to be completed when the `$sce` service is specified

### 2.9. Metadata on the Returned Interpolation Function

- The function returned by `$interpolate` exposes metadata properties used by watchers and diagnostics.
  - **Acceptance Criteria:**
    - [ ] `.exp: string` — the original input text passed to `$interpolate` (preserved verbatim)
    - [ ] `.expressions: string[]` — an array of the raw expression source strings extracted from the markers (without surrounding `{{` `}}`, in left-to-right order). For one-time expressions, the `::` prefix is retained in this string (matches AngularJS)
    - [ ] `.oneTime: boolean` — as defined in § 2.7
    - [ ] `$interpolate('Hello {{name}} {{age}}').expressions` equals `['name', 'age']`
    - [ ] `$interpolate('Hello {{::name}}').expressions` equals `['::name']`
    - [ ] `$interpolate('plain text').expressions` equals `[]`
    - [ ] `$interpolate('plain text').exp` equals `'plain text'`

### 2.10. Error Behavior

- Parse errors within any embedded expression surface synchronously at the `$interpolate(text)` call site, not at evaluation time.
  - **Acceptance Criteria:**
    - [ ] `$interpolate('Hello {{a +}}')` throws a descriptive parse error (from `parse()`) synchronously
    - [ ] `$interpolate('Hello {{name}')` (unterminated expression — opening `{{` without closing `}}`) throws a descriptive "unterminated interpolation" error referencing the source text
    - [ ] `$interpolate('Hello {{ }}')` (empty expression between markers) [NEEDS CLARIFICATION: does AngularJS throw, or render as empty? The project should match 1.7.x behavior]
    - [ ] Runtime errors thrown during expression evaluation bubble up to the caller of the interpolation fn (e.g., `$digest` catches them in later specs via `$exceptionHandler`; for now they bubble)
    - [ ] A parse error on expression N does NOT allow expressions 1..N−1 to still produce a partial function — the entire `$interpolate(text)` call fails

### 2.11. Escape Sequences for Literal Delimiters

- A backslash-escaped delimiter allows literal `{{` or `}}` in the output.
  - **Acceptance Criteria:**
    - [ ] `$interpolate('\\{\\{not an expression\\}\\}')` (source: `\{\{not an expression\}\}`) called with any context returns `'{{not an expression}}'`
    - [ ] Escaped delimiters do NOT open or close an interpolation marker
    - [ ] `$interpolate('{{a}} and \\{\\{literal\\}\\}')` with `{a: 1}` returns `'1 and {{literal}}'`
    - [ ] Escape semantics follow AngularJS 1.x `$interpolate` behavior

### 2.12. Integration with Scope Watchers

- An interpolation function is directly usable as the first argument to `scope.$watch`, honoring `.oneTime` metadata.
  - **Acceptance Criteria:**
    - [ ] `scope.$watch($interpolate('Hello {{name}}'), listener)` registers a watcher that fires when the rendered string changes
    - [ ] Same as above with `.oneTime === true`: deregisters after all expressions stabilize (per § 2.7)
    - [ ] The watcher uses reference equality on the rendered string (default `$watch` equality), not deep equality
    - [ ] An all-literal interpolation (e.g., `$interpolate('Hello World')`) exposes `.constant === true` and `$watch` fires once then deregisters, matching the spec 010 constant-watch optimization — [NEEDS CLARIFICATION: do we compute `.constant` for interpolation fns in this spec, or defer constant-interpolation optimization?]

### 2.13. Backward Compatibility

- All prior spec behaviors remain intact; this spec is purely additive.
  - **Acceptance Criteria:**
    - [ ] All tests from specs 003, 007, 008, 009, and 010 continue to pass unchanged
    - [ ] The `parse()` API is not modified (no new arguments, no renamed flags)
    - [ ] The DI/module/injector APIs are not modified — `$interpolate` is a new registrant only
    - [ ] No existing public export is removed or renamed
    - [ ] `$watch`, `$watchGroup`, `$watchCollection`, `$eval`, `$apply`, `$evalAsync`, `$applyAsync` signatures are unchanged

---

## 3. Scope and Boundaries

### In-Scope

- `$interpolate` service and `$interpolateProvider` with DI registration
- Basic interpolation of `{{expr}}` markers into a rendered string
- Configurable start/end symbols via the provider
- `mustHaveExpression` flag (second argument)
- `allOrNothing` flag (fourth argument)
- One-time binding support for individual expressions via `::`
- `.exp`, `.expressions`, `.oneTime` metadata on the returned function
- Escape sequences for literal `{{` / `}}`
- Synchronous parse-time error surfacing
- Usable as input to `scope.$watch`
- `trustedContext` parameter accepted as a no-op stub (placeholder for future `$sce`)

### Out-of-Scope

- **`$sce` service and full `trustedContext` sanitization** — will be added when `$sce` enters the roadmap; current spec stubs the parameter
- **Filters in interpolation (`{{x | currency}}`)** — separate Phase 2 roadmap item
- **Directives and `$compile`** — separate Phase 2 roadmap items
- **`ng-bind`, `ng-bind-html`, `ng-bind-template`, attribute-interpolation in directives** — separate Phase 2 roadmap items that will consume `$interpolate`
- **Promise unwrapping in expressions** — not part of modern AngularJS; explicitly out of scope for this project
- **`$exceptionHandler` integration for runtime errors** — runtime errors bubble for now; integration deferred to when `$exceptionHandler` is specified
- **HTTP, Forms, Routing, Animations, `angular` namespace** — separate phases
- **Performance optimizations beyond the one-time/constant mechanics inherited from spec 010** — e.g., memoization of parsed interpolation fns is out of scope
