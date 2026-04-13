# Technical Specification: Dependency Injection — Foundation

- **Functional Specification:** `context/spec/007-dependency-injection-foundation/functional-spec.md`
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Build the DI system as a new module under `src/di/`. The module has three main pieces:

1. **Module registry** — A singleton `Map<string, Module>` that stores all modules by name. Both `angular.module()` and `createModule()` read/write this same registry, so the APIs are interchangeable.
2. **Module class** — Holds the queued service registrations (`value`, `constant`, `factory`) as a list of invokables. Registration is *declarative* — nothing is instantiated until the injector is created.
3. **Injector** — Created from a root module name. Walks the dependency graph, collects all queued registrations, and provides `get`, `has`, `invoke`, `annotate` for resolving services. Uses lazy instantiation with a cache for singletons.

The `angular` namespace is a named export that provides the `module()` method. It is NOT a default export or a global — consumers import it explicitly (`import { angular } from 'my-own-angularjs/di'`).

No architectural changes. The new module plugs into existing `src/di/` (currently empty) and extends `src/di/index.ts` as a barrel.

---

## 2. Proposed Solution & Implementation Plan

### Component Breakdown

**New files under `src/di/`:**

| File          | Responsibility                                                                                   |
|---------------|--------------------------------------------------------------------------------------------------|
| `di-types.ts` | Interfaces: `Annotated`, `ModuleAPI`, `Injector`, `Invokable`, `Recipe`                          |
| `module.ts`   | `Module` class with `value`, `constant`, `factory` methods; module registry map                  |
| `injector.ts` | `createInjector(modules)` factory; `Injector` with `get`, `has`, `invoke`, `annotate`            |
| `annotate.ts` | `annotate(fn)` helper — extracts dependency names from `$inject` property or array-style         |
| `angular.ts`  | `angular` namespace object with `module()` method, and named exports `createModule`, `getModule` |
| `index.ts`    | Barrel: re-export `angular`, `createModule`, `getModule`, `createInjector`, types                |

**Test file:** `src/di/__tests__/di.test.ts` — single file with nested `describe` blocks per feature area.

### Architecture & Data Flow

```
consumer code
     ↓
 angular.module('app', ['common'])   (or createModule/getModule)
     ↓
 Module registry (Map<string, Module>)
     ↓
 createInjector(['app'])
     ↓
 1. Load modules: walk graph (app → common → ...), collect invokables
 2. Build providerCache: { value: <value>, factory: () => <instance>, ... }
 3. Return Injector { get, has, invoke, annotate }
```

### Key Type Definitions (signatures only, no implementation)

```typescript
// Dependency annotation
type Annotated<Fn extends (...args: unknown[]) => unknown> = Fn & {
  $inject?: readonly string[];
};

// Array-style invokable
type InvokableArray = readonly [...string[], (...deps: unknown[]) => unknown];
type Invokable = Annotated<(...args: unknown[]) => unknown> | InvokableArray;

// Module API
interface ModuleAPI {
  readonly name: string;
  readonly requires: readonly string[];
  value<T>(name: string, value: T): ModuleAPI;
  constant<T>(name: string, value: T): ModuleAPI;
  factory(name: string, factory: Invokable): ModuleAPI;
}

// Injector API
interface Injector {
  get<T = unknown>(name: string): T;
  has(name: string): boolean;
  invoke<T = unknown>(fn: Invokable, self?: unknown, locals?: Record<string, unknown>): T;
  annotate(fn: Invokable): readonly string[];
}
```

### Key Implementation Details

| Component             | Detail                                                                                                                      |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------------|
| Module registry       | Module-scoped `const registry = new Map<string, Module>()` in `module.ts`                                                   |
| Invokable queue       | `Module` stores registrations as `Array<['value' \| 'constant' \| 'factory', string, unknown]>`                             |
| `createInjector`      | Walks dep graph via BFS, tracks loaded modules in a `Set` to handle shared deps once                                        |
| Singleton cache       | `Map<string, unknown>` keyed by service name, populated lazily on first `get`                                               |
| Resolution path stack | `Array<string>` tracking in-progress resolutions for cycle detection                                                        |
| `annotate`            | If `fn` is an array, pop last element as the actual fn and use rest as `$inject`. Else read `fn.$inject`. Throw if neither. |
| Error messages        | `Unknown provider: <name>`, `Module not found: <name>`, `Circular dependency: A <- B <- A`                                  |
| `angular` namespace   | Object with `module(name, requires?)` method; same signature/behavior as `createModule` / `getModule`                       |

### Public API Exposure

- **File:** `src/di/index.ts` — barrel export
- **Existing `package.json` exports map** already has `/di` entry pointing to `dist/esm/di/index.mjs`
- Consumers: `import { angular } from 'my-own-angularjs/di'` or `import { createModule, createInjector } from 'my-own-angularjs/di'`
- Root `src/index.ts` will also re-export DI for `import { angular } from 'my-own-angularjs'`

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`src/di/` currently empty.** No existing code to break.
- **`src/index.ts`** — needs one new re-export line
- **Scope module** — not affected. Integration with Scope (registering `$rootScope` as a service) is out of scope for this spec.
- **Parser module** — not affected.
- **Build pipeline** — Rollup already handles `src/di/` via the exports map. Confirm the build produces `dist/esm/di/index.mjs`.

### Potential Risks & Mitigations

| Risk                                                                     | Impact                                 | Mitigation                                                                                                                    |
|--------------------------------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| Type inference for `injector.get('name')` without a generic type param   | Medium — callers may get `unknown`     | Accept this limitation. With `get<T>('name')`, callers opt into their known type. Advanced per-module typing is out of scope. |
| Circular module dependencies (module A depends on B, B depends on A)     | Medium — different from service cycles | Track loaded modules in a Set during graph walk. Shared dep is fine; circular module dep should throw.                        |
| Global state (`registry` Map) makes tests order-dependent                | Medium — tests could leak state        | Expose a test-only `resetRegistry()` helper or use a factory function that creates isolated registries per test               |
| `$inject` array length mismatch with function parameters                 | Low — runtime error                    | Validate in `invoke` and throw a clear error                                                                                  |
| `Invokable` type is complex (union of array and function with `$inject`) | Low — affects type UX                  | Use type guards for runtime discrimination; provide helpful error messages when annotation is missing                         |

---

## 4. Testing Strategy

- **Location:** `src/di/__tests__/di.test.ts`
- **Framework:** Vitest
- **Organization:** One top-level `describe` per feature area:
  - `describe('angular.module / createModule / getModule', ...)` — module creation, retrieval, shared registry
  - `describe('Module dependency graph', ...)` — transitive deps, shared deps loaded once, missing module
  - `describe('Module.value / constant / factory', ...)` — registration of each recipe
  - `describe('Injector.get / has', ...)` — resolution, singleton caching, unknown provider
  - `describe('Injector.invoke / annotate', ...)` — both annotation styles, `self`, `locals`, unannotated function
  - `describe('Circular dependency detection', ...)` — direct, indirect, 3-level cycles
  - `describe('Type safety', ...)` — compile-time type assertions using `expectTypeOf` or `satisfies`
- **Test isolation:** Each test creates its own isolated registry (or resets a shared one in `beforeEach`)
- **Coverage target:** 90%+ on the new DI module
