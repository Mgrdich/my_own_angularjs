<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: `$interpolate` Service — String & Template Interpolation

- **Functional Specification:** [`context/spec/011-interpolate-service/functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Introduce a new `src/interpolate/` module that implements interpolation as a pair of layered surfaces:

1. **ES module layer (stateless core):** `createInterpolate(options?)` factory plus a default `interpolate` export. This is the primary implementation and matches the project's ES-module-first convention from `context/product/architecture.md` § 1.
2. **DI / AngularJS-compatibility layer:** `$InterpolateProvider` and the `$interpolate` service, registered on a new core `ng` module. The provider is a thin shim that delegates to `createInterpolate` — no duplicate logic.

The interpolation pipeline itself is straightforward:

1. A delimiter-aware scanner splits an input string into interleaved literal text chunks and expression source strings (default delimiters `{{` / `}}`, configurable).
2. Each expression is compiled via the existing `parse()` function from `src/parser/` (spec 009/010 already delivered the `::` / `oneTime` / `constant` / `literal` flags we need).
3. A render function walks the chunks, stringifies each expression result, and concatenates.

Scope integration reuses the existing `oneTimeWatchDelegate` from spec 010 unchanged. The only Scope change is a small extension to `compileToWatchFn` so that function-form watch inputs carrying an `oneTime` flag (i.e. an interpolation fn) route through the same flag-inspecting branch that string inputs already use.

No new dependencies, no new build targets, no new test frameworks.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. New Module Layout

| Path | Responsibility |
| --- | --- |
| `src/interpolate/index.ts` | Public re-exports: `createInterpolate`, `interpolate`, and the three public types. |
| `src/interpolate/interpolate-types.ts` | Type definitions: `InterpolateFn`, `InterpolateService`, `InterpolateOptions`, `TrustedContext` (placeholder). |
| `src/interpolate/interpolate.ts` | Core `createInterpolate(options)` factory — scanner, compiler, renderer composition. |
| `src/interpolate/interpolate-scanner.ts` | Pure helper: scans input text with configurable delimiters into `{ textSegments, expressions }`, handling escape sequences. |
| `src/interpolate/interpolate-provider.ts` | `$InterpolateProvider` class — thin AngularJS-compat shim over `createInterpolate`. |
| `src/interpolate/__tests__/interpolate-scanner.test.ts` | Scanner-level tests. |
| `src/interpolate/__tests__/interpolate-esm.test.ts` | ES module API tests. |
| `src/interpolate/__tests__/interpolate.test.ts` | Service-level semantics tests (stringification, flags, metadata). |
| `src/interpolate/__tests__/interpolate-provider.test.ts` | Provider config-phase tests. |
| `src/interpolate/__tests__/interpolate-di.test.ts` | Full DI integration tests. |
| `src/interpolate/__tests__/interpolate-watch.test.ts` | Scope `$watch` integration tests. |

### 2.2. Dual API Surface

**ES module layer (primary):**

| Export | Signature | Purpose |
| --- | --- | --- |
| `createInterpolate(options?)` | `(options?: InterpolateOptions) => InterpolateService` | Factory that returns a configured interpolate service. Validates delimiter options at call time. |
| `interpolate` | `InterpolateService` | Pre-configured with default delimiters; convenience for consumers who don't need customization. Equivalent to `createInterpolate()`. |
| `InterpolateFn`, `InterpolateService`, `InterpolateOptions` | types | Public types. |

`InterpolateService` is the call signature `(text, mustHaveExpression?, trustedContext?, allOrNothing?) => InterpolateFn | undefined` with `.startSymbol()` / `.endSymbol()` getters attached.

**DI layer (AngularJS compat):**

`$InterpolateProvider` holds delimiter state during the `config()` phase. Its `$get` calls `createInterpolate(this.options)` and returns the resulting service. The provider is registered on the `ng` module via `Module.provider('$interpolate', $InterpolateProvider)` (spec 008 recipe).

There is exactly one implementation — the provider owns only config state; all semantic logic lives in `createInterpolate`.

### 2.3. New `ng` Core Module

**File: `src/core/ng-module.ts` (new)** — AngularJS-core DI module.

- Created via `createModule('ng', [])`.
- Registers `$interpolate` as a provider (so callers get `$interpolateProvider` during `config()`).
- Exported as a named constant `ngModule` so consumers can compose injectors: `createInjector([ngModule, myAppModule])`.

Future specs (`$sce`, `$exceptionHandler`, `$filter`, `$http`, `$q`, `$timeout`) will add their own registrations to this module. First canonical DI-registered core service in the project.

### 2.4. Interpolation Scanner

**File: `src/interpolate/interpolate-scanner.ts`**

A pure function:

```
scan(text: string, startSymbol: string, endSymbol: string): ScanResult
type ScanResult = {
  readonly textSegments: string[];   // length N+1 (literal text around expressions)
  readonly expressions: string[];    // length N (raw expression sources, `::` prefix retained)
}
```

Behavior:

- Walks the input with `indexOf`-based search for `startSymbol` / `endSymbol`, alternating between "literal" and "expression" states.
- When inside an expression, `endSymbol` closes it; nested start markers are treated as literal characters of the expression body (AngularJS parity).
- Escape handling: a backslash before a delimiter character produces the literal delimiter in the output and does NOT open/close an expression. Matches AngularJS `angular.js:src/ng/interpolate.js:parseStringifyInterceptor`.
- An opening `startSymbol` with no matching `endSymbol` throws `"Unterminated expression in interpolation: ..."` with the source text.
- An empty expression body (`{{ }}` — only whitespace between delimiters) throws `"Empty expression in interpolation string: <source>"` (resolves functional-spec § 2.10 `[NEEDS CLARIFICATION]`).

Why a separate module: the scanner is pure and unit-testable in isolation, and keeps `interpolate.ts` focused on composition.

### 2.5. `createInterpolate(options)` Implementation

**File: `src/interpolate/interpolate.ts`**

1. Validate `options.startSymbol` and `options.endSymbol`: non-empty strings, not identical. Throw a descriptive error on violation (resolves functional-spec § 2.4 `[NEEDS CLARIFICATION]`).
2. Return a service function with the signature described in § 2.2.
3. On each service call:
   a. Call `scan(text, startSymbol, endSymbol)` → `{ textSegments, expressions }`.
   b. If `expressions.length === 0` and `mustHaveExpression === true`, return `undefined`.
   c. Compile each raw expression via `parse(rawExpr)` — if any throws, the error propagates synchronously.
   d. Compute `oneTime = expressions.length > 0 && parsedFns.every(fn => fn.oneTime)`.
   e. Build the render function `fn(context) => string | undefined` per § 2.7 semantics.
   f. Attach metadata: `.exp`, `.expressions`, `.oneTime`.
   g. Return the function.
4. Attach `.startSymbol()` / `.endSymbol()` no-arg getters to the service function that return the active symbols.

`parse` is imported directly as an ES module function (not resolved through a `$parse` DI service, which does not exist in this spec).

### 2.6. Stringification Helper

**File: `src/core/utils.ts`** — add `toInterpolationString(value: unknown): string`:

| Input | Output |
| --- | --- |
| `undefined` / `null` | `''` |
| `string` | value as-is |
| `number` / `boolean` | `String(value)` |
| `function` | `String(value)` |
| object / array | `JSON.stringify(value)` |

Lives in `core/utils.ts` so future consumers (e.g., `ng-bind` in a later spec) reuse the same helper and don't diverge.

### 2.7. Render Function Semantics

The render function returned by the service call obeys three orthogonal modes:

- **Non-oneTime, non-allOrNothing (default):** Evaluate every expression, stringify via `toInterpolationString` (undefined/null → `''`), concatenate with text segments, return the string.
- **`allOrNothing === true`:** If ANY expression evaluates to `undefined`, return `undefined`. Otherwise render as above. `null` does NOT trigger this (AngularJS parity).
- **`oneTime === true` (all embedded expressions are `::`):** If ANY expression is still `undefined`, return `undefined` (not `''`). Once all expressions are defined, return the rendered string. This is AngularJS parity (`angular.js:src/ng/interpolate.js:286-310`) and is what lets Scope's existing `oneTimeWatchDelegate` correctly detect stabilization.

The three modes compose as a chain of early-returns; no special plumbing.

### 2.8. `$InterpolateProvider` Class

**File: `src/interpolate/interpolate-provider.ts`**

```
class $InterpolateProvider {
  private options: InterpolateOptions = { startSymbol: '{{', endSymbol: '}}' };
  startSymbol(value?: string): this | string;  // overloaded getter/setter, fluent on set
  endSymbol(value?: string):   this | string;
  $get = ['$delegate'? ... actually no deps] — factory returning createInterpolate(this.options)
}
```

- Setters validate via the same rules `createInterpolate` uses (non-empty, not identical) — but validate at setter call time so misconfiguration surfaces during `config()`, not at first `$interpolate` invocation.
- `$get` closes over `this.options`. Because spec 008 runs all `config()` blocks before any `$get` is invoked, the options are final at that point.

### 2.9. `.constant` Omitted on Interpolation Functions

Resolution of functional-spec § 2.12 `[NEEDS CLARIFICATION]`: the interpolation fn exposes only `.exp`, `.expressions`, `.oneTime`. `.constant` is omitted and the all-literal interpolation optimization (routing through `constantWatchDelegate`) is deferred to a later spec. No correctness impact — a fully-literal interpolation simply stabilizes after one digest via the normal change-detection path.

### 2.10. Scope Integration for `oneTime` Function-Form Watches

**File: `src/core/scope.ts`** — minimal extension to `compileToWatchFn`.

Today `compileToWatchFn`:

- For STRING inputs: builds a wrapper and copies `oneTime` / `constant` / `literal` flags from the parsed fn onto the wrapper.
- For FUNCTION inputs: returns the fn unchanged (no flags).

Change: when the function input itself has an `oneTime` boolean property, return it as-is — the existing flag-inspection branch in `$watch` (spec 010) will pick up the `.oneTime` flag and route through `oneTimeWatchDelegate`. No new delegate is introduced.

Because the interpolation render function returns `undefined` until stabilized (per § 2.7), the SCALAR `oneTimeWatchDelegate` is the correct match — it deregisters precisely when the value transitions from `undefined` to a defined string.

One-liner:

```
if (typeof expr === 'function') {
  return expr;   // flags, if any, flow through unchanged
}
```

(effectively unchanged from today, but now documented as intentional: flagged function-form watchers are supported.)

### 2.11. `trustedContext` Stub

The `trustedContext` parameter is accepted on all signatures but not used. Typed as `string | undefined`. Internal `// TODO(spec-$sce)` comment at the single no-op site so future work is discoverable via grep. Resolves functional-spec § 2.8 — full `$sce` integration is out of scope here.

### 2.12. Public Exports

**File: `src/index.ts`** — add:

```
export { createInterpolate, interpolate } from './interpolate';
export type { InterpolateFn, InterpolateService, InterpolateOptions } from './interpolate';
export { ngModule } from './core/ng-module';
```

`$InterpolateProvider` is internal — reachable only via `injector.get('$interpolateProvider')` during `config()`, which is the AngularJS-idiomatic surface.

### 2.13. TypeScript Signature Overloads

The `InterpolateService` call signature is overloaded so `mustHaveExpression === true` narrows the return type:

```
(text: string, mustHaveExpression: true,  trustedContext?: string, allOrNothing?: boolean): InterpolateFn | undefined;
(text: string, mustHaveExpression?: false | undefined, trustedContext?: string, allOrNothing?: boolean): InterpolateFn;
```

This keeps callers that pass the default / `false` from having to handle the `undefined` branch unnecessarily.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **Parser (`src/parser/`):** consumed read-only. No changes.
- **Scope runtime (`src/core/scope.ts`):** documentation clarification on `compileToWatchFn`; zero semantic change. Existing spec 010 delegates reused unchanged.
- **DI system (`src/di/`):** consumed read-only. Registration uses the existing `Module.provider(...)` recipe from spec 008.
- **New `ng` module (`src/core/ng-module.ts`):** first canonical DI-registered core services module. Future specs register here.
- **Consumers of `$watch`:** function-form watchers without flags take the existing path unchanged — zero regression risk.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| ES module and DI surfaces could drift if implemented independently. | `$InterpolateProvider.$get` calls `createInterpolate` — single implementation. The provider owns only config state. A parity test verifies DI-path output matches ES-module-path output for representative inputs. |
| The `oneTime` render path returning `undefined` until stabilized could surprise callers invoking `$interpolate(...)` directly (expecting a string). | JSDoc on `InterpolateFn`: "Returns `undefined` when `.oneTime === true` and not all expressions have stabilized." Matches AngularJS. Callers on non-oneTime templates always get a string. |
| Introducing the `ng` module now ties subsequent core services to this registration pattern. | Accept — matches AngularJS convention and the Phase 5 compatibility-layer target on the roadmap. Refactoring later, if needed, is a simple rename. |
| Escape handling (`\{\{`) interacts awkwardly with JavaScript string literals — source-in-code users need double-escape (`'\\{\\{'`). | Document in `$interpolate` and `createInterpolate` JSDoc. External-template usage (HTML, `templateUrl` in later specs) is unaffected. |
| Delimiter validation throws during `config()` if someone chains fluently with a bad value. | Error message names the method and the offending value. Documented in provider JSDoc. |
| Duplicating stringification logic (e.g., inside `interpreter.ts`) could diverge. | Centralize in `src/core/utils.ts` as `toInterpolationString`; all consumers import the same helper. |
| Circular imports between `core/scope.ts`, `interpolate/`, `parser/`. | `src/interpolate/` depends only on `src/parser/` and `src/core/utils.ts`. It does NOT import from `src/core/scope.ts`. `src/core/scope.ts` does NOT import from `src/interpolate/`. The `ng` module file imports only from `src/di/` and lazily wires `$InterpolateProvider` via the recipe. No cycle. |
| Two exported symbols (`interpolate` and `createInterpolate`) may confuse consumers. | JSDoc contrast: `interpolate` is the "just give me defaults" shortcut; `createInterpolate` is the factory for custom delimiters. Examples in the README (later spec) will show both side by side. |

---

## 4. Testing Strategy

All tests use Vitest (project standard). Target 90%+ coverage on `src/interpolate/` (per architecture § 2).

### 4.1. Scanner Unit Tests — `src/interpolate/__tests__/interpolate-scanner.test.ts` (new)

- Plain text with no markers.
- Single expression with surrounding text.
- Multiple expressions, with / without intervening text.
- Adjacent expressions (`{{a}}{{b}}`).
- Custom delimiters (`[[` / `]]`).
- Escape sequences: `\{\{`, `\}\}`, escapes inside literal text, escapes inside expression body.
- Unterminated expression throws with source-referencing error.
- Empty expression `{{}}` and whitespace-only `{{ }}` throw.
- `::` prefix retained verbatim in the raw expression string.

### 4.2. ES Module API Unit Tests — `src/interpolate/__tests__/interpolate-esm.test.ts` (new)

- `createInterpolate()` → default `{{` / `}}`.
- `createInterpolate({ startSymbol: '[[', endSymbol: ']]' })` → custom delimiters work end-to-end.
- `createInterpolate({ startSymbol: '', endSymbol: '}}' })` throws validation error.
- `createInterpolate({ startSymbol: '{{', endSymbol: '{{' })` throws (identical).
- `interpolate('Hello {{name}}')({ name: 'Alice' })` returns `'Hello Alice'` (convenience export).
- Stateless: each call to the returned service is independent.

### 4.3. Service Semantics Tests — `src/interpolate/__tests__/interpolate.test.ts` (new)

- Zero / one / many expressions with various scope shapes.
- Stringification rules (undefined, null, numbers, booleans, strings, arrays, objects, functions, NaN).
- `mustHaveExpression` flag returns `undefined` for no-marker input and a fn otherwise.
- `allOrNothing` flag: single undefined triggers; `null` does not trigger.
- Escape sequences render literal braces.
- Metadata: `.exp` verbatim, `.expressions` array (with `::` retained), `.oneTime` per-fn.
- `service.startSymbol()` / `.endSymbol()` return active symbols.
- Parse errors in embedded expressions surface synchronously.
- `trustedContext` accepted — identical output with or without a non-undefined value.

### 4.4. `$InterpolateProvider` Unit Tests — `src/interpolate/__tests__/interpolate-provider.test.ts` (new)

- Default symbols are `{{` / `}}`.
- Setters return `this` (fluent); getters return the current value.
- Setter validation: empty string throws; identical start/end throws.
- Multiple `config()` blocks chaining setters compose correctly.

### 4.5. DI Integration Tests — `src/interpolate/__tests__/interpolate-di.test.ts` (new)

- `createInjector([ngModule])` exposes `$interpolate` at run time.
- `$interpolateProvider` is available only during `config()` phase.
- Symbols set via `config(['$interpolateProvider', fn])` are observed by the service.
- DI-path output matches ES-module-path output for representative inputs (parity guard).

### 4.6. Scope Integration Tests — `src/interpolate/__tests__/interpolate-watch.test.ts` (new)

- `$watch` over a non-oneTime interpolation fires on rendered-string changes.
- `$watch` over an all-`::` interpolation: listener fires until ALL expressions stabilize, then deregisters post-digest.
- Partial-one-time (mixed `::` and non-`::`) behaves as non-oneTime.
- Manual deregister before stabilization works.
- Interpolation with `allOrNothing === true` + `$watch` correctly tracks defined↔undefined transitions.

### 4.7. AngularJS Parity Cross-Reference

Per `context/product/architecture.md` § 2, cross-reference `angular/angular.js/test/ng/interpolateSpec.js`. Port any scenarios not covered by § 4.1–4.6. Manual review step before marking the spec Completed (same process as specs 005 and 010).

### 4.8. Regression Tests

Entire existing suites (specs 003, 007, 008, 009, 010) continue to pass unchanged. CI runs them on every push.
