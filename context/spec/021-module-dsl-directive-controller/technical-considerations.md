# Technical Specification: Module DSL — `.directive` and `.controller`

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Two new registration methods — `.directive` and `.controller` — are added to the module builder, each a thin sugar layer over an existing provider, following the **exact pattern the existing `.filter` method already established** in `src/di/module.ts`.

Each method pushes a **config block** onto the module's `$$configBlocks` queue rather than touching any registry directly:

- `.directive(...)` → a config block that calls `$compileProvider.directive(...)`
- `.controller(...)` → a config block that calls `$controllerProvider.register(...)`

This guarantees parity-by-construction: the DSL never owns state, never validates, never orders — it forwards verbatim to the provider, so accumulation (`.directive`), last-wins (`.controller`), validation, error messages, and registration timing are all inherited unchanged.

The runtime methods live on the `Module` class; the dependency-typed overloads live on the `TypedModule` interface — the same class-vs-interface split `.filter` uses to avoid the `Registry`-in-contravariant-position variance break. All cross-module references (`DirectiveFactory`, `$CompileProvider`, `ControllerInvokable`, `IControllerProvider`, `Directive`) are **`import type`-only**, so `@di` gains zero runtime dependency on `@compiler` / `@controller` — identical to how `.filter` already type-imports from `@filter`.

No new files, no new modules, no build/export changes. The entire change is contained in `src/di/module.ts` plus tests and docs.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Architecture Changes

None. This is purely additive surface on an existing class. The module-boundary invariant (`@di` depends only on `@core` at runtime) is preserved because the new imports are type-only.

### 2.2 Component Breakdown

All changes in `src/di/module.ts`.

**Runtime methods on the `Module` class** (untyped, mirroring the class-side `filter` method):

| Method | Signature (runtime) | Behavior |
| --- | --- | --- |
| `directive` | `directive(nameOrMap: string \| Record<string, DirectiveFactory>, factory?: DirectiveFactory)` | Pushes `['$compileProvider', ($cp) => $cp.directive(nameOrMap, factory)]` onto `$$configBlocks`. Branches on `typeof nameOrMap` to call the provider's matching overload (`(name, factory)` vs `(map)`). Returns `this`. |
| `controller` | `controller(nameOrMap: string \| Record<string, ControllerInvokable>, fn?: ControllerInvokable)` | Pushes `['$controllerProvider', ($cp) => $cp.register(nameOrMap, fn)]` onto `$$configBlocks`. Same branch-and-forward. Returns `this`. |

**Typed overloads on the `TypedModule` interface:**

`directive` — three overloads (mirrors the typed/untyped split on `factory`):

1. **Single-name, typed-widening:** `directive<K extends string>(name: K, factory: DirectiveFactory): TypedModule<Registry & { [P in K as ` + "`${P}Directive`" + `]: Directive[] }, …>` — widens the run-phase registry so `injector.get('myWidgetDirective')` and `decorator('myWidgetDirective', …)` are type-safe, consistent with `.filter`'s `${K}Filter` widening.
2. **Bulk-map, non-widening:** `directive(map: Record<string, DirectiveFactory>): TypedModule<Registry, …>` — returns the module type unchanged (a mapped-type widening over an arbitrary object's keys is deliberately out of scope — high type-system cost, low value).
3. **Untyped fallback** — preserved for completeness.

`controller` — two overloads, **neither widens**:

1. `controller(name: string, fn: ControllerInvokable): TypedModule<Registry, …>`
2. `controller(map: Record<string, ControllerInvokable>): TypedModule<Registry, …>`

Controllers are stored in `$ControllerProvider`'s private `$$registry` Map — they never become injector-resolvable services, so there is nothing to widen the typed `Registry` with. (This is an intrinsic fact about how `$controllerProvider` works, not a design choice.)

**Type-only imports added to `src/di/module.ts`:**

- `import type { DirectiveFactory, Directive, $CompileProvider } from '@compiler/...'`
- `import type { ControllerInvokable, IControllerProvider } from '@controller/controller-types'`

The config-block callbacks type their injected provider param as `$CompileProvider` (the class — there is no `ICompileProvider` interface, and introducing one is out of scope) and `IControllerProvider` (the existing interface), respectively.

### 2.3 Logic / Algorithm

Trivial by design. Each method:

1. Branches on `typeof nameOrMap === 'string'`.
2. Pushes one `Invokable` config block onto `$$configBlocks` that forwards to the provider's matching overload.
3. Returns `this` for chaining.

The injector already drains `$$configBlocks` in push order during the config phase — interleaving correctly with explicit `.config(...)` blocks and with `.filter` registrations, exactly as today.

### 2.4 Documentation Updates

- `CLAUDE.md` — note the two new module-DSL methods alongside the existing `.filter` mention.
- `src/di/module.ts` — full TSDoc on both methods with `@example`, matching the `.filter` JSDoc depth.
- `context/product/architecture.md` — the "Module DSL Growth" table already lists `.directive` / `.controller` → their providers, Phase 2; update the "Lands in" cells to cite spec 021.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`$compileProvider` / `$controllerProvider` must be reachable.** Both live on `ngModule`. A consumer module that calls `.directive(...)` / `.controller(...)` but does not list `'ng'` in its `requires` (directly or transitively) will fail at `createInjector` time with `Unknown provider: $compileProvider` / `$controllerProvider`. **This is identical to `.filter`'s existing behavior** (`.filter` needs `$filterProvider`) — same failure mode, same diagnostic, no new risk class.
- **`@di` runtime module boundary.** The new imports MUST stay `import type`. A non-type import would create a real `@di → @compiler` / `@di → @controller` runtime cycle.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A non-type import sneaks in and breaks the `@di` runtime boundary. | `import type` only; the `.filter` precedent (`import type { FilterFn, IFilterProvider }`) is the established pattern. A focused test / lint check confirms `@di` has no runtime edge to `@compiler` / `@controller`. |
| Bulk-map `.directive` not widening the registry surprises a user expecting `${K}Directive` keys. | Documented limitation in the method's TSDoc — users who want typed widening use the single-name form (the common case). |
| The typed `directive` overload's `${K}Directive` widening conflicts with a directive registered via a `config` block (no widening there). | Acceptable and consistent with `.filter`: the typed widening is a best-effort convenience on the DSL path only. The runtime registry is identical regardless of path; only the *static* view differs. The `decorator('xDirective', …)` untyped fallback still works for config-block-registered directives. |
| Variance break if the typed overloads are mistakenly added to the `Module` class instead of `TypedModule`. | Follow the established split exactly — runtime method on `Module`, typed overloads on `TypedModule`. The `.filter` method is the reference implementation. |

---

## 4. Testing Strategy

**Unit tests** (`src/di/__tests__/` — alongside the existing `.filter` module tests):

- Both methods return the module instance (chainable).
- A config block is pushed onto `$$configBlocks` for each call; single-name and bulk-map forms each push exactly one block.
- The pushed block names the correct provider (`$compileProvider` / `$controllerProvider`).

**Integration tests** (via `createInjector(['ng', appModule])`):

- A directive registered through `.directive('myWidget', factory)` is matched and linked by `$compile` on a real jsdom element — identical outcome to the same directive registered through a `config(['$compileProvider', …])` block.
- A controller registered through `.controller('HomeCtrl', factory)` is instantiable via `$controller('HomeCtrl', …)` and usable as a directive's `controller: 'HomeCtrl'`.
- Bulk-map forms register every entry.
- **Parity:** accumulation for `.directive` (two registrations of the same name both run), last-wins for `.controller` — verified across both the DSL path and a mixed DSL + config-block path.
- Registration ordering: `.directive` / `.controller` calls interleaved with explicit `.config(...)` blocks execute in source order.
- A module that calls `.directive(...)` without requiring `'ng'` fails at `createInjector` with the expected `Unknown provider` error.

**Type-level tests** (compile-time assertions, matching how `.filter`'s widening is type-tested):

- `.directive('x', factory)` widens the typed registry with `xDirective`.
- `.directive({ … })` (bulk-map) returns the module type unchanged.
- `.controller(...)` (both forms) returns the module type unchanged.

**Reference parity:** port relevant cases from `angular/angular.js/test/loaderSpec.js` (the `angular.module` DSL suite) for `.directive` / `.controller` registration, skipping `.component` (deferred) and `.animation` (Phase 4).
