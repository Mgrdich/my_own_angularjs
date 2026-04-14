# Technical Specification: Dependency Injection — Advanced Recipes & Lifecycle

- **Functional Specification:** `context/spec/008-advanced-di-recipes-and-lifecycle/functional-spec.md`
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Extend the existing DI module (from spec 007) with three new recipes (`service`, `provider`, `decorator`) and two lifecycle hooks (`config`, `run`). The heart of the change is a **two-phase injector architecture**:

1. **Config phase** — a `$provide`-style "provider injector" resolves providers (under `<name>Provider` names) and constants. `config()` blocks run here.
2. **Run phase** — the existing main injector resolves services. Services from `provider.$get` are lazily materialized on first `get`. `run()` blocks run after all services are registered.

Both phases share a single `providerCache` and a new `providerInstances` map. The existing `factoryInvokables` / `resolutionPath` / `loadedModules` state is reused. No architectural overhaul — this is purely additive.

On the type side, the `Module` class gains a second type parameter `ConfigRegistry` that tracks `<name>Provider` entries separately from the main `Registry`. The typed overloads (decorator name validation, `config`/`run` dep inference, provider form-specific dep constraints) live on `TypedModule` to preserve the covariance that `AnyModule` widening depends on — same pattern as spec 007.

---

## 2. Proposed Solution & Implementation Plan

### 2.1 File Layout

| File | Change |
|---|---|
| `src/di/module.ts` | Add `ConfigRegistry` type param to `Module`; add runtime `service` / `provider` / `decorator` / `config` / `run` methods (wide signatures). Update `TypedModule` interface with the new typed overloads. Update `createModule` return type. |
| `src/di/di-types.ts` | Extend `ModuleAPI` with new signatures. Add `ProviderInstance<P>`, `ProviderService<P>`, `InvokableReturn<I>`, `ProviderConstructor`, `ProviderObject`, `ProviderArray` utility types. Add `'service'`, `'provider'`, `'decorator'` to `RecipeType`. |
| `src/di/injector.ts` | Add two-phase resolution: `providerInstances` map, config-phase injector facade, decorator chain execution, config/run block execution. Update `ExtractRegistry` for the new `Module` arity. |
| `src/di/annotate.ts` | **No changes** — new invokables route through the existing helper. |
| `src/di/index.ts` | Export any new public utility types (`ProviderInstance`, `InvokableReturn`, etc.) if needed by consumers. |
| `src/di/__tests__/di.test.ts` | Add a new nested `describe('spec 008 — advanced recipes & lifecycle', ...)` block inside the existing top-level `'dependency injection'` wrapper. |

### 2.2 Two-Layer Type System

The spec requires careful separation of two kinds of types:

**Layer A — Structural utility types** (for `extends` pattern matching against existing values):

```typescript
// Loose tuple pattern — used in extends position to structurally match an
// existing provider value. Dep names are plain string[] here because this
// type is used for INFERRING the provider shape, not for validating deps
// at a call site.
type ProviderArray = readonly [...string[], ProviderConstructor];
type ProviderConstructor = new (...args: never[]) => { $get: Invokable };
type ProviderObject = { $get: Invokable };

// Given any provider form, extract the "provider instance" type
type ProviderInstance<P> =
  P extends ProviderConstructor ? InstanceType<P> :
  P extends ProviderArray
    ? P extends readonly [...string[], infer Ctor]
      ? Ctor extends ProviderConstructor ? InstanceType<Ctor> : never
      : never
    : P extends ProviderObject ? P
    : never;

// Extract the return type of an Invokable (factory function or array form)
type InvokableReturn<I> =
  I extends readonly [...string[], (...args: never[]) => infer R] ? R :
  I extends (...args: never[]) => infer R ? R :
  unknown;

// The service type produced by a provider
type ProviderService<P> = InvokableReturn<ProviderInstance<P>['$get']>;
```

**Layer B — Typed call-site overloads on `TypedModule`** (enforce dep name validation):

These are the signatures users actually interact with. Dep names are constrained to `keyof Registry & string` or `keyof ConfigRegistry & string` depending on the phase. See section 2.3 for the full signatures of each typed overload.

### 2.3 TypedModule Overloads

#### `service` — two overloads

```typescript
// Constructor style (uses $inject or implicit no-deps)
service<
  const K extends string,
  Ctor extends new (...args: never[]) => unknown,
>(
  name: K,
  ctor: Ctor,
): TypedModule<
  Registry & { [P in K]: InstanceType<Ctor> },
  ConfigRegistry,
  Name,
  Requires
>;

// Array-style with typed deps from Registry (run phase)
service<
  const K extends string,
  const Deps extends readonly (keyof Registry & string)[],
  Ctor extends new (...args: ResolveDeps<Registry, Deps>) => unknown,
>(
  name: K,
  invokable: readonly [...Deps, Ctor],
): TypedModule<
  Registry & { [P in K]: InstanceType<Ctor> },
  ConfigRegistry,
  Name,
  Requires
>;
```

#### `provider` — three overloads (one per form)

**Form 1 — Constructor:**
```typescript
provider<
  const K extends string,
  Ctor extends new () => { $get: Invokable },
>(
  name: K,
  ctor: Ctor,
): TypedModule<
  Registry & { [P in K]: InvokableReturn<InstanceType<Ctor>['$get']> },
  ConfigRegistry & { [P in K as `${P}Provider`]: InstanceType<Ctor> },
  Name,
  Requires
>;
```

**Form 2 — Object literal:**
```typescript
provider<
  const K extends string,
  P extends { $get: Invokable },
>(
  name: K,
  obj: P,
): TypedModule<
  Registry & { [Q in K]: InvokableReturn<P['$get']> },
  ConfigRegistry & { [Q in K as `${Q}Provider`]: P },
  Name,
  Requires
>;
```

**Form 3 — Array-style with typed ConfigRegistry deps:**
```typescript
provider<
  const K extends string,
  const Deps extends readonly (keyof ConfigRegistry & string)[],
  Ctor extends new (...args: ResolveDeps<ConfigRegistry, Deps>) => { $get: Invokable },
>(
  name: K,
  invokable: readonly [...Deps, Ctor],
): TypedModule<
  Registry & { [P in K]: InvokableReturn<InstanceType<Ctor>['$get']> },
  ConfigRegistry & { [P in K as `${P}Provider`]: InstanceType<Ctor> },
  Name,
  Requires
>;
```

Form 3 is what enables `module.provider('logger', ['myConstant', function(myConstant) { ... }])` — the `myConstant` string must be a `keyof ConfigRegistry & string`, and the callback's `myConstant` parameter is typed via `ResolveDeps<ConfigRegistry, Deps>`.

#### `decorator` — one typed overload

```typescript
decorator<
  const K extends keyof Registry & string,
  const Deps extends readonly (keyof Registry & string)[],
  Return,
>(
  name: K,
  invokable: readonly [
    '$delegate',
    ...Deps,
    (delegate: Registry[K], ...rest: ResolveDeps<Registry, Deps>) => Return,
  ],
): TypedModule<
  Omit<Registry, K> & { [P in K]: Return },
  ConfigRegistry,
  Name,
  Requires
>;
```

The first dep is always `'$delegate'` (typed as `Registry[K]`). Additional deps are typed from `Registry`. The decorator's return type replaces the service's type in `Registry` via `Omit<...> & { [K]: Return }`.

#### `config` and `run` — typed overloads

```typescript
// config — deps from ConfigRegistry only
config<
  const Deps extends readonly (keyof ConfigRegistry & string)[],
>(
  invokable: readonly [...Deps, (...args: ResolveDeps<ConfigRegistry, Deps>) => void],
): TypedModule<Registry, ConfigRegistry, Name, Requires>;

// run — deps from Registry only
run<
  const Deps extends readonly (keyof Registry & string)[],
>(
  invokable: readonly [...Deps, (...args: ResolveDeps<Registry, Deps>) => void],
): TypedModule<Registry, ConfigRegistry, Name, Requires>;
```

Both return the same module type (neither widens the registry). Each typed overload has a corresponding wide-signature fallback on `Module` (plain `Invokable`) for pre-built invokables or cross-module deps — matching the spec 007 pattern.

### 2.4 Runtime Changes

#### Module type parameter arity

```typescript
class Module<
  Registry extends Record<string, unknown> = {},
  ConfigRegistry extends Record<string, unknown> = {},
  Name extends string = string,
  Requires extends readonly string[] = readonly string[],
> { ... }

export type AnyModule = Module<
  Record<string, unknown>,
  Record<string, unknown>,
  string,
  readonly string[]
>;
```

`ConfigRegistry` is inserted as the **second** type parameter. `ExtractRegistry` in `injector.ts` must be updated:

```typescript
type ExtractRegistry<M> =
  M extends TypedModule<infer R, any, any, any> ? R :
  M extends Module<infer R, any, any, any> ? R :
  never;
```

#### New RecipeType members

```typescript
type RecipeType =
  | 'value' | 'constant' | 'factory'
  | 'service' | 'provider' | 'decorator';
```

#### Config and run block storage

Config and run blocks are lifecycle hooks, not service registrations, so they live in separate arrays on `Module`:

```typescript
class Module {
  readonly invokeQueue: InvokeQueueEntry[];
  readonly configBlocks: Invokable[];   // new
  readonly runBlocks: Invokable[];      // new
}
```

#### Injector state additions

```typescript
function createInjector(modules: readonly AnyModule[]) {
  const providerCache = new Map<string, unknown>();          // constants, values, resolved services
  const providerInstances = new Map<string, unknown>();       // provider instances for config phase
  const factoryInvokables = new Map<string, Invokable>();     // lazy factory recipe
  const serviceCtors = new Map<string, Invokable>();          // lazy service recipe
  const providerGetInvokables = new Map<string, {             // lazy provider.$get recipe
    invokable: Invokable;
    providerInstance: unknown;   // `this` binding for $get
  }>();
  const decorators = new Map<string, Invokable[]>();          // per-service decorator chain
  const loadedModules = new Set<string>();
  const resolutionPath: string[] = [];

  // Phase 1: loadModule walks the graph and drains queues into the maps above
  //          Collects configBlocks and runBlocks into arrays in dependency order
  // Phase 2: Run config blocks via providerInjector.invoke
  // Phase 3: Build runInjector
  // Phase 4: Run run blocks via runInjector.invoke
  // Phase 5: Return runInjector
}
```

#### Two-phase injector facades

Two injector objects share state:

- **`providerInjector`** — `get(name)` resolves from `providerCache` (constants) and `providerInstances` (providers by `<name>Provider` name). Throws `Unknown provider: <name>` for service-only names with a hint about using the `<name>Provider` form.
- **`runInjector`** — the main injector returned to the user. Existing `get`/`has`/`invoke`/`annotate` semantics apply.

Both share `providerCache` so constants registered via `constant` are visible in both phases.

#### Resolution flow for each recipe type (lazy)

On first `runInjector.get(name)`:

1. If `providerCache.has(name)` → return cached.
2. Push `name` to `resolutionPath` (for cycle detection).
3. Determine the source in order:
   - `factoryInvokables.get(name)` → invoke via `runInjector.invoke(invokable)`
   - `serviceCtors.get(name)` → resolve deps via `annotate` + `invoke`, then `new Ctor(...resolvedDeps)`
   - `providerGetInvokables.get(name)` → invoke `$get` with `this` bound to `providerInstance`
4. **Run the decorator chain** if `decorators.has(name)`: for each decorator, call `runInjector.invoke(decoratorInvokable, null, { $delegate: current })` and assign the return value back as the new `current`.
5. `providerCache.set(name, current)`, delete from pending maps, pop resolution path.

#### Decorator wrapping point

A decorator wraps the service **after** its producer returns but **before** the result is cached. This matters because a mid-resolution re-entry (e.g., another service needing the same one) would otherwise see the undecorated value.

```typescript
let current = produceService(name);             // factory/service/provider.$get
const chain = decorators.get(name) ?? [];
for (const decoratorInvokable of chain) {
  current = runInjector.invoke(
    decoratorInvokable,
    null,
    { $delegate: current },
  );
}
providerCache.set(name, current);                // cache the fully-decorated value
```

#### Config / Run execution

After the module graph is loaded, before returning the injector:

```typescript
// Phase 2: config blocks (registration order across the dependency graph)
for (const block of collectedConfigBlocks) {
  providerInjector.invoke(block);
}

// Phase 3: build runInjector
const runInjector: Injector = { get, has, invoke, annotate };

// Phase 4: run blocks
for (const block of collectedRunBlocks) {
  runInjector.invoke(block);
}

return runInjector;
```

### 2.5 Key Implementation Details

| Component | Detail |
|---|---|
| `service` runtime | Push `['service', name, invokable]` to invokeQueue. `loadModule` stores in `serviceCtors`. `get` extracts deps via `annotate`, resolves them, calls `new Ctor(...resolvedDeps)`. |
| `provider` runtime | Push `['provider', name, providerSource]`. `loadModule` normalizes all three forms (type-guard: array vs constructor vs object) to produce a provider instance, stores in `providerInstances` under `<name>Provider` key, extracts `$get` into `providerGetInvokables`. For Form 3, calls the constructor via the config-phase injector to resolve its deps. |
| `decorator` runtime | Push `['decorator', serviceName, invokable]`. `loadModule` appends to `decorators.get(serviceName)` array. **Validates at load time** that `serviceName` has a producer in the loaded graph; throws `Cannot decorate unknown service: "xyz"` otherwise. |
| `config` block storage | `Module.configBlocks: Invokable[]`. Collected during `loadModule` walk in dependency order. Executed post-drain via `providerInjector.invoke`. |
| `run` block storage | `Module.runBlocks: Invokable[]`. Same pattern, executed via `runInjector.invoke`. |
| `constant` change | Now widens **both** `Registry` and `ConfigRegistry`. Runtime unchanged. |
| Cycle detection | `resolutionPath` stack still used. Provider `.$get` calls, service constructors, and decorator invocations all count as resolution steps. |
| Two-phase enforcement | `providerInjector.get` throws for service-only names with a clear error message suggesting the `<name>Provider` form. |
| Error messages | `'Cannot inject "logger" during config phase; use "loggerProvider" instead'`, `'Provider "logger" has no $get method'`, `'Cannot decorate unknown service: "xyz"'`, `'Expected provider for "logger" to be a function, array, or object with $get'` |

### 2.6 Public API Exposure

- Update `src/di/index.ts` to export new utility types (`ProviderInstance`, `ProviderService`, `InvokableReturn`, `ProviderConstructor`, `ProviderObject`, `ProviderArray`) for consumers who want to type providers explicitly.
- `src/index.ts` re-exports from `./di/index` — no change needed.
- No new subpath entries in `package.json` `exports` — the existing `./di` subpath covers everything.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **Spec 007 tests:** Any test that spells `Module<...>` or `TypedModule<...>` explicitly needs a new positional `{}` for `ConfigRegistry`. Tests that only use `createModule(...)` and inference will be unaffected.
- **`injector.ts` internal types:** `ExtractRegistry` must be updated in lockstep with the `Module` arity change, or `MergeRegistries` will silently collapse to `never`.
- **No public consumers yet:** This is a learning project, so the breaking change to `AnyModule` and `ExtractRegistry` is contained.

### Potential Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Provider form detection is runtime-fragile | Medium — wrong normalization path produces unclear errors | Use explicit type guards in order: `isArray(p)` → array-style; `typeof p === 'function'` → constructor; `typeof p === 'object' && '$get' in p` → object literal. Throw with a clear message if none match. |
| `InvokableReturn<I>` type extraction hits TS inference limits on complex `$get` invokables | Medium — return type degrades to `unknown` for exotic providers | Mirror the pattern already used in spec 007's typed factory. Provide an explicit-generic escape hatch via the untyped fallback `provider` overload. |
| Decorator applied before the service is registered | Low — load-order issue AngularJS dodges with two-pass collection | `loadModule` already does collect-then-drain. Validate decorators against the full loaded graph in a second pass; throws if the target is missing. |
| `ConfigRegistry` variance bugs break `AnyModule` widening | **High** — silently breaks `createInjector` type inference | Place all `ConfigRegistry`-constrained method signatures on `TypedModule`, not `Module`. Same contract as spec 007. Test via `expectTypeOf` on `AnyModule` assignability. |
| Config-phase injector allows injecting services due to shared `providerCache` | Medium — undermines strict two-phase enforcement | `providerInjector.get` must explicitly whitelist lookups: constants and `<name>Provider` only. If the name is in `factoryInvokables` / `serviceCtors` / `providerGetInvokables`, throw with a clear suggestion. |
| Run blocks with side effects throw mid-startup | Low — same risk as AngularJS | Let errors propagate (match AngularJS behavior). Document that run blocks should not throw. |
| `Form 3` provider dep name typos silently fall through to untyped fallback | Low — matches spec 007's accepted limitation | Document as-is; unit test verifies the typed overload catches literal-tuple typos while the untyped fallback handles dynamic string[] |

---

## 4. Testing Strategy

- **Location:** `src/di/__tests__/di.test.ts` — nested inside the existing `describe('dependency injection', ...)` block
- **New describe:** `describe('spec 008 — advanced recipes & lifecycle', ...)` with sub-blocks per feature
- **Framework:** Vitest with `expectTypeOf` for type-safety assertions (same as spec 007)
- **Coverage per recipe/hook:**
  - **`service`:** runtime (constructor call, singleton, deps from `$inject`/array-style, `instanceof` check) + type (`InstanceType<Ctor>` inference, array-style deps typed from Registry)
  - **`provider`:** runtime (all three forms, dual injector exposure, `$get` deps, singleton, Form 3 with config-phase deps) + type (dual registry widening, Form 3 typed constructor deps from ConfigRegistry, `$get` deps typed from Registry)
  - **`decorator`:** runtime (wrapping, chaining, cycle safety, unknown-service error) + type (`keyof Registry` constraint, `$delegate` typing via `Registry[K]`, return type override via `Omit & { [K]: Return }`)
  - **`config`/`run`:** runtime (phase enforcement, ordering, multi-module ordering, error surfacing) + type (`ConfigRegistry` vs `Registry` constraint enforcement via `@ts-expect-error`)
- **Backward compat check:** Run the entire spec 007 test suite unchanged — if anything breaks, fix the type-level changes until it passes
- **`expectTypeOf` assertions** for every type guarantee listed in section 2.6 of the functional spec
- **Coverage target:** 90%+ on the new recipes and lifecycle
