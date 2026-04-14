# Technical Specification: Dependency Injection — Foundation

- **Functional Specification:** `context/spec/007-dependency-injection-foundation/functional-spec.md`
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Build the DI system as a new module under `src/di/`. The module has three main pieces:

1. **Module registry** — A singleton `Map<string, Module>` that stores all modules by name. `createModule()` and `getModule()` read/write this registry.
2. **Module class** — Generic over a `Registry` type parameter that tracks all registered services as a mapped type `{ [K in registered name]: service type }`. Each `.value()` / `.constant()` / `.factory()` call returns `Module<Registry & { [newName]: newType }>` — a builder-pattern approach that accumulates type information across chained calls. Registration is *declarative* — nothing is instantiated until the injector is created.
3. **Injector** — Created from a root module. Walks the dependency graph, collects all queued registrations, and provides `get`, `has`, `invoke`, `annotate` for resolving services. Uses lazy instantiation with a cache for singletons. The injector type is generic over the merged registry of all modules in the graph, so `injector.get('name')` infers the correct return type from string literal lookup.

All public APIs are exposed as ES module named exports (`createModule`, `getModule`, `createInjector`), consistent with the rest of the framework (`Scope.create`, `parse`, etc.). No global `angular` namespace — that is deferred to a dedicated AngularJS Compatibility Layer milestone in the roadmap.

No architectural changes. The new module plugs into existing `src/di/` (currently empty) and extends `src/di/index.ts` as a barrel.

---

## 2. Proposed Solution & Implementation Plan

### Component Breakdown

**New files under `src/di/`:**

| File          | Responsibility                                                                                   |
|---------------|--------------------------------------------------------------------------------------------------|
| `di-types.ts` | Interfaces: `Annotated`, `ModuleAPI`, `Injector`, `Invokable`, `Recipe`                          |
| `module.ts`   | `Module` class with `value`, `constant`, `factory` methods; module registry map; `createModule`, `getModule`, `resetRegistry` named exports |
| `injector.ts` | `createInjector(modules)` factory; `Injector` with `get`, `has`, `invoke`, `annotate`            |
| `annotate.ts` | `annotate(fn)` helper — extracts dependency names from `$inject` property or array-style         |
| `index.ts`    | Barrel: re-export `createModule`, `getModule`, `createInjector`, types                           |

**Test file:** `src/di/__tests__/di.test.ts` — single file with nested `describe` blocks per feature area.

### Architecture & Data Flow

```
consumer code
     ↓
 createModule('app', ['common'])   (or getModule to retrieve)
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

// Module API — generic over a Registry type that accumulates
// registered services via builder-pattern return types.
interface ModuleAPI<Registry extends Record<string, unknown> = {}> {
  readonly name: string;
  readonly requires: readonly string[];

  // Each call returns a NEW ModuleAPI type with the additional service merged
  // into the registry. TypeScript infers `Name` as a string literal from the
  // argument, and `T` from the value argument.
  value<Name extends string, T>(
    name: Name,
    value: T,
  ): ModuleAPI<Registry & { [K in Name]: T }>;

  constant<Name extends string, T>(
    name: Name,
    value: T,
  ): ModuleAPI<Registry & { [K in Name]: T }>;

  factory<Name extends string, T>(
    name: Name,
    factory: Invokable,
  ): ModuleAPI<Registry & { [K in Name]: T }>;
}

// Injector API — generic over the merged registry of all modules it was built
// from. `get` uses the registry for type inference; an explicit generic is
// still supported as a fallback escape hatch.
interface Injector<Registry extends Record<string, unknown> = Record<string, unknown>> {
  get<K extends keyof Registry>(name: K): Registry[K];
  get<T>(name: string): T; // overload for escape hatch
  has(name: string): boolean;
  invoke<T = unknown>(fn: Invokable, self?: unknown, locals?: Record<string, unknown>): T;
  annotate(fn: Invokable): readonly string[];
}

// Helper type to merge registries from multiple modules in dependency order.
type MergeRegistries<Modules extends readonly ModuleAPI<any>[]> = /* ... */;
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
| Builder-pattern types | `value` / `constant` / `factory` methods return `ModuleAPI<Registry & { [Name]: T }>` — the type widens with each call. At runtime the same instance is returned (cast through the new type). |
| Type-safe `get`       | `Injector<Registry>#get<K extends keyof Registry>(name: K)` returns `Registry[K]`, so calling `get('apiUrl')` infers the registered type. An overload `get<T>(name: string): T` provides the escape hatch. |

### Public API Exposure

- **File:** `src/di/index.ts` — barrel export
- **Existing `package.json` exports map** already has `/di` entry pointing to `dist/esm/di/index.mjs`
- Consumers: `import { createModule, getModule, createInjector } from 'my-own-angularjs/di'`
- Root `src/index.ts` will also re-export DI for `import { createModule } from 'my-own-angularjs'`

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
| Builder-pattern generic types may become complex or hit TS inference limits | Medium — may push against TS recursion/inference limits | Start with a simple intersection type `Registry & { [Name]: T }`. If inference degrades on long chains, fall back to the explicit-generic `get<T>(name)` escape hatch. The runtime behavior is identical either way. |
| Merging registries across module dependencies (transitive types) | Medium — getting `MergeRegistries<[Mod1, Mod2, Mod3]>` right is non-trivial | Implement registry merging as a separate utility type; test with `expectTypeOf` or `satisfies` in the type-safety test suite. |
| Circular module dependencies (module A depends on B, B depends on A)     | Medium — different from service cycles | Track loaded modules in a Set during graph walk. Shared dep is fine; circular module dep should throw.                        |
| Global state (`registry` Map) makes tests order-dependent                | Medium — tests could leak state        | Expose a test-only `resetRegistry()` helper or use a factory function that creates isolated registries per test               |
| `$inject` array length mismatch with function parameters                 | Low — runtime error                    | Validate in `invoke` and throw a clear error                                                                                  |
| `Invokable` type is complex (union of array and function with `$inject`) | Low — affects type UX                  | Use type guards for runtime discrimination; provide helpful error messages when annotation is missing                         |

---

## 4. Testing Strategy

- **Location:** `src/di/__tests__/di.test.ts`
- **Framework:** Vitest
- **Organization:** One top-level `describe` per feature area:
  - `describe('createModule / getModule', ...)` — module creation, retrieval, registry isolation
  - `describe('Module dependency graph', ...)` — transitive deps, shared deps loaded once, missing module
  - `describe('Module.value / constant / factory', ...)` — registration of each recipe
  - `describe('Injector.get / has', ...)` — resolution, singleton caching, unknown provider
  - `describe('Injector.invoke / annotate', ...)` — both annotation styles, `self`, `locals`, unannotated function
  - `describe('Circular dependency detection', ...)` — direct, indirect, 3-level cycles
  - `describe('Type safety', ...)` — compile-time type assertions using `expectTypeOf` or `satisfies`
- **Test isolation:** Each test creates its own isolated registry (or resets a shared one in `beforeEach`)
- **Coverage target:** 90%+ on the new DI module
