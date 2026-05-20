# Technical Specification: Components & Isolate Scope

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Six capabilities, all layered onto the existing `@compiler` pipeline and the spec-020 controller seam — no new module subpath. The work splits into three areas:

1. **`@compiler` — the bulk of the work.** `normalizeDirective` stops rejecting `scope: { … }` and instead parses it into a normalized binding map; the per-element linker creates an isolate scope via the *already-existing* `Scope.$new(true)`, wires the four binding kinds into the digest, extends spec-020's `runControllerSeam` to build a per-element controller map, resolve `require`, deliver `bindToController` bindings, and fire the four lifecycle hooks in a defined order. `$compileProvider` gains a `component(name, def)` method that translates a component-definition-object into a directive registration.
2. **`@controller` — one signature extension.** `createController` gains the 4th `later: boolean` argument that spec 020 explicitly predicted — when `true` it returns `{ instance, identifier }` and defers alias binding, so the compiler can resolve `require` and populate bindings *before* `$onInit` runs.
3. **`@di` — one thin DSL method.** `.component(name, def)` on the module builder, a pure config-block-forwarding wrapper mirroring spec 021's `.directive` exactly (type-only `@compiler` import already in place).

Error routing reuses the existing `'$compile'` cause token — `EXCEPTION_HANDLER_CAUSES` stays at 10, consistent with specs 017–021.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Isolate scope + the four binding kinds

**`src/compiler/compile-provider.ts` — `normalizeDirective`:** Remove the `IsolateScopeNotSupportedError` throw. When `ddo.scope` is an object, parse each entry through a new binding-spec parser into a normalized record: `{ mode: '=' | '@' | '<' | '&', optional: boolean, attrName: string }`. A malformed spec throws a new `InvalidIsolateBindingError` (routed via the existing factory `try/catch` → `$exceptionHandler('$compile')`).

**`src/compiler/directive-types.ts`:** Widen `DirectiveDefinition.scope` to also accept `Record<string, string>` (the binding-spec map). The normalized `Directive` keeps `scope: false | true` for the child-scope decision and gains `isolateBindings?: NormalizedBindingMap`.

**New file `src/compiler/isolate-bindings.ts`:** Owns the binding-spec parser and the four runtime wiring strategies:

- `=` — a `scope.$watch` on the parent expression writing to the local, plus a reverse `scope.$watch` on the local writing back to the parent (last-digest-value reconciliation, AngularJS-canonical).
- `@` — reuses the spec-017 `$interpolate`-of-attribute machinery (`attrs.$observe`), writing the interpolated string to the local.
- `<` — a one-directional `scope.$watch` on the parent expression writing to the local; records into the `$onChanges` queue (see §2.3).
- `&` — the local is assigned a function that calls `parentScope.$eval(expr, locals)`.

**`src/compiler/compile.ts` — both link sites:** A directive declaring object-form `scope` triggers `parentScope.$new(true)` (isolate) instead of `$new()` (child). Two object-form-scope directives on one element throw `MultipleIsolateScopeError` at link time, routed via `$exceptionHandler('$compile')`. `?`-optional bindings skip wiring silently when the attribute is absent; attribute aliasing reads `attrName` from the normalized spec.

### 2.2 `bindToController`

**`src/compiler/directive-types.ts`:** `DirectiveDefinition.bindToController?: boolean | Record<string, string>`; normalized onto `Directive.bindToController`.

**`src/compiler/compile.ts`:** When `bindToController` is set, the §2.1 binding wiring targets the controller instance instead of the isolate scope. Because bindings must exist *before* `$onInit`, this is why `createController` is called with `later: true` (§2.4) — the compiler populates bindings onto the returned `instance`, then calls `$onInit`.

### 2.3 Lifecycle hooks

Extended inside `runControllerSeam` (`src/compiler/compile.ts`), new file `src/compiler/lifecycle.ts` for the hook-dispatch helpers:

- **`$onInit`** — called once, after the controller is constructed, `require` is resolved (§2.4), and bindings are populated; before pre-link.
- **`$onChanges`** — `<` and `@` binding watchers record `{ currentValue, previousValue, isFirstChange }` into a per-digest changes queue keyed by controller; the queue flushes once via `scope.$$postDigestQueue`, calling each controller's `$onChanges` with the batched changes object. An initial `$onChanges` call fires synchronously at link time with every binding marked first-change.
- **`$onDestroy`** — registered on the element's scope via `scope.$on('$destroy', …)`.
- **`$postLink`** — called after the element's child linking completes (after the post-link loop).

A controller defining none of these hooks is unaffected — every hook is an opt-in `typeof ctrl.$onX === 'function'` check.

### 2.4 `require`

**`src/controller/controller.ts`:** `createController` gains the 4th parameter `later?: boolean`. When `later === true` it returns `{ instance, identifier }` and does **not** run `bindAlias` — the caller binds the alias after `require` resolution. This is the exact signature spec 020's tasks.md predicted ("additive, no breaking change").

**`src/compiler/directive-types.ts`:** `DirectiveDefinition.require?: string | string[] | Record<string, string>`; normalized onto `Directive.require`.

**New file `src/compiler/require-resolver.ts`:** Parses the `^` / `^^` / `?` flags and walks for controllers. The per-element linker stashes a non-enumerable `$$ngControllers: Map<string, unknown>` on the element (parallel to spec-018's `$$ngBoundTransclude` and spec-017's `$$ngScope`). Resolution: no prefix → own element's map; `^` → own element then `parentElement` chain; `^^` → `parentElement` chain only. A missing non-optional requirement throws `MissingRequiredControllerError` via `$exceptionHandler('$compile')`; an optional (`?`) miss yields `null`.

**`src/compiler/compile.ts`:** Resolved controllers are passed as the 4th argument to the link function (the `controllers` slot already reserved in the `LinkFn` type since spec 018) and assigned onto the requiring controller instance (by array index or object alias) before `$onInit`.

### 2.5 `$compileProvider.component`

**`src/compiler/compile-provider.ts`:** New `component(name, definition)` method on `$CompileProvider`. It translates the component-definition-object into a directive factory returning a DDO with the AngularJS 1.5+ defaults: `restrict: 'E'`, `scope: definition.bindings ?? {}`, `bindToController: true`, `controller: definition.controller ?? noop`, `controllerAs: definition.controllerAs ?? '$ctrl'`, plus pass-through `template` / `templateUrl` / `transclude` / `require`. It then delegates to the existing `this.directive(name, factory)`. An invalid definition throws `InvalidComponentDefinitionError`. Returns `this` for chaining.

**`src/compiler/directive-types.ts`:** New `ComponentDefinition` type for the definition-object shape.

### 2.6 `.component` module DSL

**`src/di/module.ts`:** A `component(name, definition)` method on the `Module` class + a typed overload on `TypedModule`, mirroring spec 021's `.directive` exactly — pushes one config block `['$compileProvider', ($cp) => $cp.component(name, definition)]` onto `$$configBlocks`, returns `this`. The type-only `@compiler` import is already present from spec 021. Non-widening (a component is one directive registration; the single-name `${K}Directive` widening from spec 021 could be mirrored, but components are typically consumed as elements, not via `injector.get` — non-widening keeps the surface simple, matching `.controller`).

### 2.7 Error classes

New classes in `src/compiler/compile-error.ts`, all routed via `'$compile'`: `InvalidIsolateBindingError`, `MultipleIsolateScopeError`, `MissingRequiredControllerError`, `InvalidComponentDefinitionError`. `IsolateScopeNotSupportedError` is **retired** — its throw site is removed; the class itself is kept (still exported) for one release as a deprecated no-op to avoid a breaking export removal, or removed outright (decide during implementation — note in tasks.md).

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`@core/scope`** — `Scope.$new(true)` (isolate) and `$$postDigestQueue` already exist; no scope changes anticipated. If the `$onChanges` queue needs a hook the scope doesn't expose, that's a scoped addition flagged during implementation.
- **`@controller`** — one additive signature change to `createController` (the `later` arg). All existing 1–3 arg call sites stay valid.
- **`@compiler`** — the bulk of the change: `normalizeDirective`, both per-element link sites, `runControllerSeam`, `$CompileProvider`. Existing `scope: false | true`, transclusion, template, and spec-020 controller behaviour must be preserved exactly.
- **`@di`** — one thin DSL method, type-only import already in place.
- **`@exception-handler`** — no change; `'$compile'` cause reused.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Isolate scope wiring interacts badly with the existing `scope: true` child-scope path or the transclusion outer-scope rule (spec 018). | The isolate scope replaces the child-scope `$new()` call at the same single decision point; transclusion already captures `parentScope` *before* the scope decision, so the outer-scope rule is unaffected. Regression tests from specs 017/018/020 must pass unchanged. |
| `=` two-way binding introduces digest instability (write-back loop). | Standard AngularJS last-value reconciliation: the reverse watcher only writes back when the local actually changed since the last digest. A TTL-breach test guards against an unstable pair. |
| `$onChanges` queue leaks across `$compile` invocations or fires after `$onDestroy`. | The changes queue is keyed per controller and drained via `$$postDigestQueue`; `$onDestroy` removes the controller's queue entry. Tested explicitly. |
| `require` ancestor walk is O(depth) per element and could be slow on deep trees. | Acceptable — matches AngularJS; the project's stated priority is clarity over performance. The `$$ngControllers` map is a direct element-property read, no DOM query. |
| `later`-instantiation ordering bug: `$onInit` fires before bindings/`require` are ready. | The ordering is fixed and documented in §2.3/§2.4: construct → stash → wire bindings → resolve require → `$onInit` → pre-link → child link → post-link → `$postLink`. A shared-spy ordering test pins it. |
| Retiring `IsolateScopeNotSupportedError` breaks a consumer catching it. | Keep the class exported (deprecated) or remove it — decided at implementation time and noted in tasks.md. Internal throw site is the only caller today. |
| Coverage drop across several new files under the 90% gate. | Each new file (`isolate-bindings.ts`, `require-resolver.ts`, `lifecycle.ts`) gets a dedicated test file; CI's existing threshold catches regressions. |

---

## 4. Testing Strategy

**Framework:** Vitest + jsdom (existing setup). Tests under `src/compiler/__tests__/`, `src/controller/__tests__/`, `src/di/__tests__/`.

- **Isolate scope** — non-inheritance from parent; each of `=` / `@` / `<` / `&` binding behaviour (including `=` two-way propagation both directions, `<` no write-back, `&` locals); `?`-optional absent attribute; attribute aliasing; `MultipleIsolateScopeError` on two isolate directives.
- **`bindToController`** — bindings land on the controller instance; present before `$onInit`; both `true` and object forms.
- **Lifecycle hooks** — `$onInit` timing (after bindings + require, before pre-link); `$onChanges` initial call + batched per-digest flush + `isFirstChange()` + `previousValue`; `$onDestroy` on scope destroy; `$postLink` after child linking; a hookless controller is unaffected. Shared-spy ordering test across all hooks + link phases.
- **`require`** — string / array / object forms; `^` / `^^` / `?` flags; resolved controllers as link 4th arg AND on the requiring controller before `$onInit`; `MissingRequiredControllerError` on non-optional miss; `null` on optional miss.
- **`$compileProvider.component`** — defaults applied (`restrict:'E'`, isolate scope, `bindToController:true`, `controllerAs:'$ctrl'`); behaves identically to the hand-written directive equivalent; `InvalidComponentDefinitionError` on bad input.
- **`.component` module DSL** — chainable; one config block forwarding to `$compileProvider.component`; parity with the config-block path.
- **`createController` `later` arg** — returns `{ instance, identifier }`, defers alias binding; the existing 1–3 arg call sites unchanged.
- **Regression** — full specs 002–021 suite passes unchanged; `EXCEPTION_HANDLER_CAUSES.length === 10` holds; spec-017 `scope: true`, spec-018 transclusion, spec-020 controller-seam tests all green.
- **Reference parity** — port relevant cases from `angular/angular.js/test/compileSpec.js` (isolate-scope bindings, `bindToController`, `require`, lifecycle hooks) and `test/ng/componentSpec.js` (`$compileProvider.component`).
