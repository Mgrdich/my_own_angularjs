# Functional Specification: Dependency Injection — Advanced Recipes & Lifecycle

- **Roadmap Item:** Phase 1 — Core Runtime Foundation > Dependency Injection (Providers & Recipes + Config & Run Blocks)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 007 delivered the DI foundation with fully-typed `value`/`constant`/`factory` recipes — each builder call widens the module's `Registry` type so `injector.get('name')` infers return types without explicit generics, and compile-time errors catch unregistered keys. This spec extends that pattern to the remaining recipes (`service`, `provider`, `decorator`) and adds module lifecycle hooks (`config()`, `run()`) — with the **same level of type safety and inference**.

**Problem:**

- **`service`:** Many services are better expressed as classes than factory functions. Without a class-friendly recipe, developers wrap every class in a factory.
- **`provider`:** Some services need configuration **before** instantiation — e.g., an HTTP client with a startup-configured base URL. Requires a two-phase pattern where the service itself isn't accessible during configuration, but a *provider* for it is.
- **`decorator`:** Extending or wrapping existing services without modifying their source is a key extension point.
- **`config()` and `run()` blocks:** No way to run startup code. Applications can register services but can't configure providers or execute init logic.

**Desired outcome:** Complete the DI recipe set and module lifecycle with the same typed builder pattern as spec 007. Every call on a module should widen or narrow the typed registry in predictable ways. `config` callbacks should only allow injecting from a **config-phase registry** (providers + constants) at compile time. `run` callbacks should use the full run-phase registry. Decorators should compile-error when targeting a service that isn't in the registry.

---

## 2. Functional Requirements (The "What")

### 2.1 `service` Recipe

Register a service by constructor. The injector calls `new ServiceClass(...deps)` where deps come from `$inject` or array-style annotation. The result is cached as a singleton.

```typescript
class UserService {
  constructor(private $http: HttpClient) {}
  getUser(id: string) { return this.$http.get(`/users/${id}`); }
}
UserService.$inject = ['$http'];

module.service('userService', UserService);
```

Array-style is also supported:

```typescript
module.service('userService', ['$http', UserService]);
```

**Acceptance Criteria:**

- [x] `module.service('name', Ctor)` with `Ctor.$inject = [...]` registers a service instantiated via `new Ctor(...deps)` on first `get('name')`
- [x] `module.service('name', ['dep1', 'dep2', Ctor])` registers a service via array-style annotation
- [x] Services are singletons — `injector.get('name') === injector.get('name')`
- [x] Service constructor receives resolved dependencies as positional args
- [x] The returned instance is `instanceof` the original constructor

### 2.2 `provider` Recipe

Register a **configurable** service. A provider is an object (or constructor/function producing one) with a `$get` method. During config phase, the provider itself is injectable as `<name>Provider`. After config, `provider.$get(...deps)` produces the actual service instance.

Three registration forms:

**Form 1 — Constructor function:**

```typescript
function LoggerProvider() {
  this.level = 'info';
  this.setLevel = function(level) { this.level = level; };
  this.$get = ['$http', function($http) {
    return { log: (msg) => $http.post('/log', { level: this.level, msg }) };
  }];
}
module.provider('logger', LoggerProvider);
```

**Form 2 — Object literal:**

```typescript
module.provider('logger', {
  level: 'info',
  $get: ['$http', function($http) { return { log: ... }; }],
});
```

**Form 3 — Array-style with constructor:**

```typescript
module.provider('logger', ['SomeConfigDep', function(cfg) {
  this.level = cfg.defaultLevel;
  this.$get = ['$http', function($http) { ... }];
}]);
```

**Acceptance Criteria:**

- [x] All three forms register the provider correctly
- [x] During config phase, `<name>Provider` is injectable (e.g., `loggerProvider`); the service `<name>` is **not**
- [x] After config phase, the service `<name>` is injectable; `provider.$get(...)` is called exactly once
- [x] The `$get` method's dependencies are resolved from the run-phase injector
- [x] Services produced by providers are singletons
- [x] Missing `$get` on the provider throws a clear error

### 2.3 `decorator` Recipe

Wrap or modify an existing service by name. The decorator function receives the original service as `$delegate` and returns the (possibly modified) service.

```typescript
module.decorator('$log', ['$delegate', function($delegate) {
  return {
    ...$delegate,
    verbose: (msg) => $delegate.log(`[VERBOSE] ${msg}`),
  };
}]);
```

Decorators chain — each decorator sees the result of the previous one as `$delegate`.

**Acceptance Criteria:**

- [x] `module.decorator('name', ['$delegate', fn])` registers a decorator that wraps the existing service
- [x] The decorator function receives the original service as `$delegate`
- [x] `injector.get('name')` returns the decorated service
- [x] Multiple decorators on the same service chain in registration order
- [x] Decorating a nonexistent service throws a clear error at injector creation time

### 2.4 `config()` Blocks

Register a function that runs during the **config phase** — before services are instantiated, after providers are registered. Can inject providers (by `<name>Provider` name) and constants; **not** services, values, or factories.

```typescript
module.config(['loggerProvider', function(loggerProvider) {
  loggerProvider.setLevel('debug');
}]);
```

**Acceptance Criteria:**

- [x] `module.config(fn)` registers a config block
- [x] Config blocks run when `createInjector` is called, **before** any service is instantiated
- [x] Can inject `<name>Provider` names and constants
- [x] **Cannot** inject services, values, or factories — throws a clear error (e.g., `Cannot inject 'logger' during config phase; use 'loggerProvider' instead`)
- [x] Multiple config blocks run in registration order within a module and in dependency order across modules
- [x] Config blocks can mutate providers (e.g., `loggerProvider.setLevel(...)`)

### 2.5 `run()` Blocks

Register a function that runs during the **run phase** — after all config blocks. Can inject anything the run-phase injector supports.

```typescript
module.run(['$rootScope', 'logger', function($rootScope, logger) {
  logger.log('Application started');
}]);
```

**Acceptance Criteria:**

- [x] `module.run(fn)` registers a run block
- [x] Run blocks execute **after** all config blocks
- [x] Can inject services, values, constants, and factories
- [x] **Cannot** inject `<name>Provider` names (config phase is over)
- [x] Multiple run blocks run in registration order within a module and in dependency order across modules
- [x] Run blocks run exactly once per injector creation

### 2.6 Type Safety and Inference — Full Parity with Spec 007

This section is the most important. Every new recipe and lifecycle hook must match the typed builder pattern from spec 007, where:

1. **Literal-tracked registry:** Each call on `Module<Registry, ConfigRegistry, Name, Requires>` widens both registries where appropriate and returns a new module type.
2. **Separate config-phase and run-phase registries:** Internally the module tracks two type parameters — `ConfigRegistry` (providers + constants only) and `Registry` (full services). `config()` callbacks are typed against `ConfigRegistry`; `run()` callbacks are typed against `Registry`.
3. **Compile-time constraints:** Decorator names must be `keyof Registry`; unknown names are compile errors.
4. **`injector.get()` inference:** Services registered via any recipe contribute to the `Registry` type merged by `MergeRegistries`, so `injector.get('userService')` infers the instance type.

#### 2.6.1 Typed `service`

The generic signature:

```typescript
service<
  const K extends string,
  Ctor extends new (...args: never[]) => unknown,
>(
  name: K,
  ctor: Ctor,
): Module<Registry & { [P in K]: InstanceType<Ctor> }, ConfigRegistry, Name, Requires>;

// Array-style overload:
service<
  const K extends string,
  Ctor extends new (...args: never[]) => unknown,
>(
  name: K,
  invokable: readonly [...string[], Ctor],
): Module<Registry & { [P in K]: InstanceType<Ctor> }, ConfigRegistry, Name, Requires>;
```

Example:

```typescript
class UserService { constructor(http: HttpClient) {} }
const mod = createModule('app', []).service('userService', UserService);
//    ↑ Module<{ userService: UserService }, {}, 'app', readonly []>

const injector = createInjector([mod]);
injector.get('userService');   // inferred as UserService
```

**Acceptance Criteria:**

- [x] `module.service('userService', UserService)` widens `Registry` to include `userService: InstanceType<typeof UserService>`
- [x] `injector.get('userService')` returns an instance typed as `InstanceType<typeof UserService>` without explicit generics
- [x] Passing a non-constructor to `service` is a compile error
- [x] Constructor dependency types on the callback (if array-style) are inferred from `Registry`

#### 2.6.2 Typed `provider`

This is the most complex case because a provider registration has dual type effects:

1. **Adds `<name>Provider: ProviderInstance` to `ConfigRegistry`** — so `config()` callbacks can inject it
2. **Adds `<name>: ServiceInstance` to `Registry`** — so `run()` callbacks and `injector.get` can access the final service, where `ServiceInstance` is derived from the `$get` method's return type

All three registration forms must be separate typed overloads so that dep names on the constructor and on `$get` are constrained to the appropriate registry at the call site. Dep names for the provider **constructor** resolve from `ConfigRegistry` (config phase). Dep names for the provider's **`$get`** method resolve from `Registry` (run phase).

**Form 1 — Constructor function (no config-phase deps):**

```typescript
provider<
  const K extends string,
  Ctor extends new () => { $get: Invokable },
>(
  name: K,
  ctor: Ctor,
): Module<
  Registry & { [P in K]: InvokableReturn<InstanceType<Ctor>['$get']> },
  ConfigRegistry & { [P in K as `${P}Provider`]: InstanceType<Ctor> },
  Name,
  Requires
>;
```

**Form 2 — Object literal (no config-phase deps):**

```typescript
provider<
  const K extends string,
  P extends { $get: Invokable },
>(
  name: K,
  obj: P,
): Module<
  Registry & { [Q in K]: InvokableReturn<P['$get']> },
  ConfigRegistry & { [Q in K as `${Q}Provider`]: P },
  Name,
  Requires
>;
```

**Form 3 — Array-style with constructor deps (typed against `ConfigRegistry`):**

```typescript
provider<
  const K extends string,
  const Deps extends readonly (keyof ConfigRegistry & string)[],
  Ctor extends new (...args: ResolveDeps<ConfigRegistry, Deps>) => { $get: Invokable },
>(
  name: K,
  invokable: readonly [...Deps, Ctor],
): Module<
  Registry & { [P in K]: InvokableReturn<InstanceType<Ctor>['$get']> },
  ConfigRegistry & { [P in K as `${P}Provider`]: InstanceType<Ctor> },
  Name,
  Requires
>;
```

The `$get` method itself can be an array-style invokable. When it is, its deps should be typed against `Registry` (the run-phase registry) — the same way spec 007's typed `factory` treats its invokable. The `Invokable<Return>` generic in `di-types.ts` already carries the return type; the *dep-name-against-registry* constraint is enforced at the call site where `$get` is assigned via a nested conditional type.

**Key utility types (structural — used for `extends` matching, not call-site validation):**

- **`ProviderInstance<P>`** — given a provider (constructor, object, or array), produce the instance type. Loose `string[]` in array-match position because this is a value-inference helper, not an API surface.
- **`InvokableReturn<I>`** — given an `Invokable`, extract the return type of its underlying function.
- **`ProviderService<P>` = `InvokableReturn<ProviderInstance<P>['$get']>`** — the service type produced by a provider.

**Note on two-layer types:** The structural utility types (`ProviderInstance`, `InvokableReturn`) use loose patterns like `readonly [...string[], Ctor]` because they match against existing values. The **typed overloads** on `TypedModule` (shown above for Forms 1/2/3) are where dep name validation happens — they use `const Deps extends readonly (keyof ConfigRegistry & string)[]` to enforce that every dep name is a registered config-phase service.

Example:

```typescript
function LoggerProvider() {
  this.level = 'info';
  this.setLevel = function(level) { this.level = level; };
  this.$get = () => ({ log: (msg: string) => {} });
}

const mod = createModule('app', []).provider('logger', LoggerProvider);
//    ↑ Module<
//        { logger: { log: (msg: string) => void } },
//        { loggerProvider: LoggerProvider },
//        'app',
//        readonly []
//      >

mod.config(['loggerProvider', (loggerProvider) => {
  //                           ↑ inferred as LoggerProvider
  loggerProvider.setLevel('debug');
}]);

const injector = createInjector([mod]);
injector.get('logger');   // inferred as { log: (msg: string) => void }
```

**Acceptance Criteria:**

- [x] `module.provider('logger', LoggerProvider)` adds `loggerProvider: InstanceType<typeof LoggerProvider>` to `ConfigRegistry`
- [x] Same call adds `logger: InvokableReturn<InstanceType<typeof LoggerProvider>['$get']>` to `Registry`
- [x] All three provider forms (constructor, object, array-style) produce correct type widening via separate typed overloads on `TypedModule.provider`
- [x] **Form 3 — Array-style constructor deps are typed against `ConfigRegistry`:** `module.provider('svc', ['configDep', function(configDep) { ... }])` with `'configDep'` not in `ConfigRegistry` is a compile error
- [x] **Form 3 — Constructor parameter types are inferred from `ResolveDeps<ConfigRegistry, Deps>`:** the callback's `configDep` parameter types automatically without manual annotation
- [x] **`$get` deps are typed against `Registry`:** when `$get` is an array-style invokable, its dep names must be `keyof Registry & string` — unregistered service names fall through to the untyped fallback overload
- [x] `injector.get('logger')` infers the service type from the provider's `$get` method
- [x] `config()` callbacks can inject `loggerProvider` with its full typed API
- [x] A provider without a `$get` method is a compile error

#### 2.6.3 Typed `decorator`

The name parameter must be `keyof Registry & string` — decorating a nonexistent service is a compile error:

```typescript
decorator<
  const K extends keyof Registry & string,
  Return,
>(
  name: K,
  invokable: readonly [
    ...string[],
    (delegate: Registry[K], ...rest: never[]) => Return,
  ],
): Module<
  // Override the existing service type with the decorator's return type
  Omit<Registry, K> & { [P in K]: Return },
  ConfigRegistry,
  Name,
  Requires
>;
```

Example:

```typescript
const mod = createModule('app', [])
  .value('logger', { log: (m: string) => {} })  // Registry: { logger: { log: ... } }
  .decorator('logger', ['$delegate', ($delegate) => ({
  //          ↑ must be keyof Registry        ↑ inferred as { log: (m: string) => void }
    ...$delegate,
    verbose: (m: string) => $delegate.log(`[VERBOSE] ${m}`),
  })]);
// Registry narrowed/widened to: { logger: { log: ..., verbose: ... } }

// Typo check:
mod.decorator('loggerr', [...]);   // ❌ compile error — 'loggerr' not in Registry
```

**Acceptance Criteria:**

- [x] Decorator name is constrained to `keyof Registry & string`
- [x] Unknown decorator names are a compile error
- [x] The decorator callback's `$delegate` parameter is typed as `Registry[K]`
- [x] The decorator's return type replaces the existing service's type in the Registry
- [x] Chained decorators see the previous decorator's return type as `$delegate`
- [x] Other injected deps in the decorator callback are typed from `Registry`

#### 2.6.4 Typed `config()` and `run()`

Both blocks follow the `invoke` pattern from spec 007 — typed callback parameters inferred from the appropriate registry.

**`config()`** — typed against `ConfigRegistry`:

```typescript
config<
  const Deps extends readonly (keyof ConfigRegistry & string)[],
>(
  invokable: readonly [
    ...Deps,
    (...args: ResolveDeps<ConfigRegistry, Deps>) => void,
  ],
): Module<Registry, ConfigRegistry, Name, Requires>;
```

**`run()`** — typed against `Registry`:

```typescript
run<
  const Deps extends readonly (keyof Registry & string)[],
>(
  invokable: readonly [
    ...Deps,
    (...args: ResolveDeps<Registry, Deps>) => void,
  ],
): Module<Registry, ConfigRegistry, Name, Requires>;
```

Example:

```typescript
const mod = createModule('app', [])
  .provider('logger', LoggerProvider)
  // ConfigRegistry: { loggerProvider: LoggerProvider }
  // Registry: { logger: ... }
  .config(['loggerProvider', (loggerProvider) => {
  //         ↑ typed                ↑ inferred as LoggerProvider
    loggerProvider.setLevel('debug');
  }])
  .run(['logger', (logger) => {
  //     ↑ typed    ↑ inferred as the $get return type
    logger.log('started');
  }]);

// Attempts to cross phases fail at compile time:
mod.config(['logger', (logger) => { ... }]);
//          ↑ ❌ 'logger' is not in ConfigRegistry (only 'loggerProvider' is)

mod.run(['loggerProvider', (p) => { ... }]);
//       ↑ ❌ 'loggerProvider' is not in Registry (config phase is over)
```

**Acceptance Criteria:**

- [x] `config()` callback parameters are typed from `ConfigRegistry`
- [x] `run()` callback parameters are typed from `Registry`
- [x] `config()` with a service name (not a provider name) is a compile error
- [x] `run()` with a provider name is a compile error
- [x] Typo'd dep names in either block are compile errors (fall through to untyped fallback overload if needed for backward compat)

#### 2.6.5 General Type Safety

**Acceptance Criteria:**

- [x] `Module` class gains a new `ConfigRegistry` type parameter alongside `Registry`, `Name`, `Requires`
- [x] All spec-007 recipes (`value`, `constant`, `factory`) continue to compile unchanged — they only widen `Registry` and leave `ConfigRegistry` alone (with `constant` widening both since constants are config-injectable)
- [x] `constant` widens BOTH `Registry` and `ConfigRegistry` (constants are usable in both phases)
- [x] `provider` is the only recipe that widens `ConfigRegistry` with `<name>Provider` entries
- [x] `createInjector`'s `MergeRegistries` continues to merge the full `Registry` from all modules (no change to `ConfigRegistry` merging — it's module-local)
- [x] `pnpm typecheck` passes with zero errors
- [x] No `any` leakage in new source code

---

## 3. Scope and Boundaries

### In-Scope

- `service` recipe with `new`-based instantiation, full dep injection, and `InstanceType` inference
- `provider` recipe with all three forms and dual Registry/ConfigRegistry widening
- `decorator` recipe with `$delegate` pattern, chaining, and compile-time name validation
- `config()` blocks with strict config-phase enforcement and typed callbacks
- `run()` blocks with run-phase injection and typed callbacks
- Full type safety: `Module<Registry, ConfigRegistry, Name, Requires>` with literal-tracked names
- Backward compat: all spec 007 recipes continue to work unchanged
- Comprehensive test suite including `expectTypeOf` assertions for every type guarantee

### Out-of-Scope (later phases)

- **$rootScope as a DI-registered service** — Integration of Scope with DI is a separate spec
- **Expressions & Parser enhancements** — Phase 2
- **Filters, Directives, HTTP, Forms, Routing, Animations** — Later phases
- **`angular` namespace compatibility layer** — Final roadmap phase
