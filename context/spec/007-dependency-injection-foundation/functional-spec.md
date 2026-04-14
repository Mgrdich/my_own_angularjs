# Functional Specification: Dependency Injection — Foundation

- **Roadmap Item:** Phase 1 — Core Runtime Foundation > Dependency Injection
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

The framework currently has a standalone Scope module and Expression Parser, but no way to wire services together. Every subsequent module (the Compiler, HTTP, Forms, Routing) depends on having a dependency injection system to register and resolve services.

**Problem:** Without DI, there is no way for modules to declare dependencies, no way to share instances across the application, and no way to build the rest of AngularJS — the entire framework is built on top of the injector.

**Desired outcome:** A working module system and injector that supports registering values, constants, and factories; resolves dependencies using `$inject` property or array-style annotations; detects missing dependencies with clear error messages; and detects circular dependencies before they cause stack overflow. Everything must be fully type-safe with TypeScript inference where possible, and exposed exclusively via modern ES module named exports (consistent with how `Scope`, `parse`, and all other public APIs already work in this codebase). This spec covers the foundation; `service`, `provider`, `decorator` recipes and `config`/`run` blocks are deferred to Spec 008. A classic `angular.module()`-style global namespace is **not** part of this spec — it will be introduced later as a dedicated AngularJS compatibility layer that wraps the ES module APIs.

---

## 2. Functional Requirements (The "What")

### 2.1 Module Creation and Retrieval

Developers create and retrieve modules using modern ES module named exports. This is consistent with how the rest of the framework is exposed (e.g., `Scope.create`, `parse` from the parser module) — everything is a named export, nothing lives on a global namespace.

**API:**

- `createModule('myApp', ['dep1', 'dep2'])` — creates a new module named `myApp` that depends on `dep1` and `dep2`
- `getModule('myApp')` — retrieves an existing module (throws if not found)

A classic `angular.module()` global namespace is explicitly **out of scope for this spec**. A future "AngularJS Compatibility Layer" phase will wrap these ES module APIs under an `angular` namespace constant so users migrating from classic AngularJS have the familiar entry points. Until then, there is one API surface.

**Acceptance Criteria:**

- [x] `createModule('app', [])` creates a new module named `app` with no dependencies
- [x] `createModule('app', ['common'])` creates a module that depends on `common`
- [x] `getModule('app')` returns the previously created module
- [x] `getModule('app')` throws `Error('Module not found: app')` if `app` was never created
- [x] Creating a module with the same name twice replaces the previous registration

### 2.2 Module Dependency Graph

Modules can depend on other modules. When a module is loaded, all its transitive dependencies are also loaded. Services registered in dependency modules are visible to the dependent module.

**Acceptance Criteria:**

- [x] When `app` depends on `common`, services registered on `common` are available in `app`
- [x] Transitive dependencies work: if `app` depends on `b`, and `b` depends on `c`, services from `c` are visible in `app`
- [x] Each module is loaded only once, even if referenced by multiple modules in the graph
- [x] Missing module dependencies throw a clear error (e.g., `Module not found: 'common'`)

### 2.3 Registering Services (value, constant, factory)

Modules must provide methods to register services using three recipes:

- `module.value(name, value)` — registers a plain value
- `module.constant(name, value)` — registers a constant (available during config phase in Spec 008)
- `module.factory(name, factoryFn)` — registers a factory function that returns the service instance. The factory function may declare dependencies.

**Acceptance Criteria:**

- [x] `module.value('apiUrl', 'https://api.example.com')` registers a string value
- [x] `module.value('config', { timeout: 30 })` registers an object value
- [x] `module.constant('MAX_RETRIES', 3)` registers a constant
- [x] `module.factory('logger', () => ({ log: (msg) => console.log(msg) }))` registers a factory with no dependencies
- [x] `module.factory('userService', ['$http', ($http) => ({ ... })])` registers a factory with dependencies using array-style annotation
- [x] `module.factory('userService', userServiceFn)` with `userServiceFn.$inject = ['$http']` works using the `$inject` property

### 2.4 Injector — get and has

An injector must be created from a module (and its dependency graph). The injector provides methods to retrieve services and check their existence.

- `injector.get(name)` — returns the instance of the named service
- `injector.has(name)` — returns true if the service is registered, false otherwise

**Acceptance Criteria:**

- [x] `injector.get('apiUrl')` returns the registered value
- [x] `injector.get('logger')` calls the factory function and returns its result
- [x] Services are singletons — `injector.get('logger') === injector.get('logger')` (same reference on every call)
- [x] `injector.has('apiUrl')` returns `true` for registered services
- [x] `injector.has('nonexistent')` returns `false`
- [x] `injector.get('nonexistent')` throws `Error('Unknown provider: nonexistent')`

### 2.5 Injector — invoke and annotate

The injector must be able to invoke arbitrary functions with their dependencies injected, and to annotate functions to extract their dependency list.

- `injector.invoke(fn, self?, locals?)` — calls `fn` with its dependencies injected. Optional `self` for `this` binding, optional `locals` to override specific dependency resolutions.
- `injector.annotate(fn)` — returns the array of dependency names declared on `fn` (via `$inject` or array-style)

**Acceptance Criteria:**

- [x] `injector.invoke(['$http', ($http) => ...])` calls the function with `$http` injected
- [x] `injector.invoke(fn)` where `fn.$inject = ['$http']` also works
- [x] `injector.invoke(fn, self)` sets `this` to `self` inside `fn`
- [x] `injector.invoke(fn, null, { $http: mockHttp })` uses the mock instead of the registered `$http`
- [x] `injector.annotate(fn)` returns `['$http']` for both array-style and `$inject` annotated functions
- [x] `injector.annotate` throws a clear error if a function has no annotations (function parameter inference is not supported)

### 2.6 Circular Dependency Detection

If a service's factory function declares a dependency that (directly or transitively) depends back on the same service, the injector must detect the cycle and throw a clear error.

**Acceptance Criteria:**

- [x] Direct cycle (`A` depends on `A`) throws `Error('Circular dependency: A <- A')`
- [x] Indirect cycle (`A` depends on `B`, `B` depends on `A`) throws `Error('Circular dependency: A <- B <- A')`
- [x] Deeper cycles (`A → B → C → A`) throw with the full dependency chain in the message

### 2.7 Type Safety and Inference

Every part of the DI system must be fully type-safe with proper TypeScript inference. Consumers should get autocomplete, type checking, and compile-time errors for DI mistakes without having to manually annotate anything.

**Key type-safety goals:**

- **Typed service registration:** `module.value(name, value)` infers the value type from the argument.
- **String-literal-tracked registry (builder pattern):** Each `.value()`, `.constant()`, and `.factory()` call returns a new module type with the accumulated service registry, keyed by the literal string name. This lets TypeScript remember *which* services the module has registered and *what type* each one is.
- **Typed `injector.get`:** When the injector is built from typed modules, `injector.get('apiUrl')` infers its return type from the registration — no generic parameter needed. Passing an unregistered name is a compile-time error (`Argument of type '"xyz"' is not assignable to parameter of type '"apiUrl" | "config" | "logger"'`).
- **Typed factories:** Factory functions can declare typed dependency parameters that match the registered services.
- **`$inject` annotation:** The `$inject` property is typed as `readonly string[]`.
- **No `any` leakage:** The internal implementation must use `unknown` instead of `any`, narrowing with type guards where needed. The only acceptable `any` is at the annotation-parsing boundary if unavoidable, with a comment explaining why.
- **Ergonomic escape hatch:** For advanced cases, `injector.get<T>(name)` still accepts an explicit generic as a fallback when the registry-based inference is not usable.

**Example of desired developer experience:**

```typescript
const mod = createModule('app', [])
  .value('apiUrl', 'https://api.example.com')    // registers 'apiUrl': string
  .value('config', { timeout: 30 })              // registers 'config': { timeout: number }
  .factory('logger', () => ({ log: (m: string) => {} })); // registers 'logger': { log: (m: string) => void }

const injector = createInjector([mod]);
injector.get('apiUrl');   // inferred as string — no generic needed
injector.get('config');   // inferred as { timeout: number }
injector.get('logger');   // inferred as { log: (m: string) => void }
injector.get('unknown');  // compile error — 'unknown' is not a registered key
```

**Acceptance Criteria:**

- [x] `module.value('apiUrl', 'https://...')` infers the value as `string`
- [x] Each `.value()` / `.constant()` / `.factory()` call returns a module type with the new service added to its registry (builder pattern)
- [x] `injector.get('apiUrl')` on a typed injector returns the correct type without an explicit generic parameter
- [x] `injector.get('nonexistent')` is a **compile-time** error on a typed injector (in addition to the runtime error)
- [x] `injector.get<HttpClient>('$http')` still works as an explicit-generic escape hatch
- [x] `pnpm typecheck` passes with zero errors across the DI module
- [x] No use of `any` in the DI source code (except deliberate, commented escape hatches)
- [x] All public APIs have explicit types for parameters and return values

---

## 3. Scope and Boundaries

### In-Scope

- Module system with ES module named exports: `createModule()` / `getModule()`
- Single module registry shared across all DI APIs
- Module dependency graph (including transitive dependencies)
- Three recipes: `value`, `constant`, `factory`
- Injector with `get`, `has`, `invoke`, `annotate`
- Two DI annotation styles: `$inject` property and array shorthand (function parameter inference is NOT supported)
- Singleton instance caching
- Clear errors for missing dependencies, missing modules, and circular dependencies
- Full TypeScript type safety and inference across the entire DI surface
- Comprehensive test suite

### Out-of-Scope (deferred to Spec 008 or later)

- **`angular.module()` global namespace** — Deferred to the dedicated AngularJS Compatibility Layer milestone, which wraps the ES module APIs from this spec under an `angular` constant for users migrating from classic AngularJS
- **`service`, `provider`, `decorator` recipes** — Spec 008
- **`config()` and `run()` blocks** — Spec 008
- **Function parameter inference** — Not supported (explicit `$inject` or array-style only)
- **$rootScope as a service** — A separate spec, integrates Scope with DI
- **Expressions & Parser enhancements** — Phase 2
- **Filters, Directives, HTTP, Forms, Routing, Animations** — Later phases
