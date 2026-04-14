# Tasks: Dependency Injection — Advanced Recipes & Lifecycle

- **Specification:** `context/spec/008-advanced-di-recipes-and-lifecycle/`
- **Status:** Not Started

---

- [x] **Slice 1: `ConfigRegistry` Type Parameter & `service` Recipe**
  - [x] Add `ConfigRegistry` as the 2nd type parameter on `Module` class in `src/di/module.ts` (default `{}`). Update `TypedModule` interface with the same arity. Update `AnyModule` type alias to `Module<Record<string, unknown>, Record<string, unknown>, string, readonly string[]>`. **[Agent: typescript-framework]**
  - [x] Update `ExtractRegistry<M>` in `src/di/injector.ts` to match the new arity (`Module<infer R, any, any, any>`). Verify `MergeRegistries` still works with existing spec 007 tests. **[Agent: typescript-framework]**
  - [x] Update `Module.constant` so it widens **both** `Registry` and `ConfigRegistry` (constants are config-injectable). Runtime unchanged. **[Agent: typescript-framework]**
  - [x] Add `'service'` to `RecipeType` in `src/di/di-types.ts`. Add wide-signature `service(name, invokable): Module<...>` runtime method on the `Module` class that pushes `['service', name, invokable]` to the invoke queue. **[Agent: typescript-framework]**
  - [x] Add two typed overloads for `service` on `TypedModule` in `src/di/module.ts`: constructor-only and array-style with typed `Registry` deps. Both return widened `Registry & { [K]: InstanceType<Ctor> }`. **[Agent: typescript-framework]**
  - [x] Update `src/di/injector.ts` `createInjector`: add `serviceCtors: Map<string, Invokable>` alongside `factoryInvokables`. In `loadModule`, route `'service'` queue entries into it. In `get`, add the service branch: extract deps via `annotate`, resolve them, call `new Ctor(...resolvedDeps)`, run any decorators (stub for now), cache in `providerCache`. **[Agent: typescript-framework]**
  - [x] Add runtime tests in `src/di/__tests__/di.test.ts` under a new `describe('spec 008 — advanced recipes & lifecycle', ...)` block, nested inside the existing `'dependency injection'` wrapper. Sub-describe `Module.service`: (a) `$inject` constructor, (b) array-style constructor, (c) singleton reference equality, (d) `instanceof` check, (e) constructor receives resolved deps in order. **[Agent: vitest-testing]**
  - [x] Add type-safety tests for `service`: `injector.get('userService')` infers `InstanceType<typeof UserService>` without explicit generics; array-style deps inferred from `Registry`. **[Agent: vitest-testing]**
  - [x] Verify all 505 existing spec 007 tests still pass plus the new service tests. `pnpm lint`, `pnpm typecheck`, `pnpm test` must pass. **[Agent: typescript-framework]**

<!--
Note: Mid-slice refactor — renamed `Module.invokeQueue` to `Module.$$invokeQueue`
to mark it as internal framework state (matches Scope's `$$`-prefix convention).
`InvokeQueueEntry` removed from the public barrel. Tests, injector, and all
JSDoc references updated. Zero regressions (526 tests still pass).
-->

- [x] **Slice 2: `provider` Recipe with Two-Phase Injector**
  - [x] Add `'provider'` to `RecipeType`. Add utility types in `src/di/di-types.ts`: `ProviderConstructor`, `ProviderObject`, `ProviderArray`, `ProviderInstance<P>`, `InvokableReturn<I>`, `ProviderService<P>`. Use loose structural patterns (per spec 008 section 2.2 "Two-Layer Type System"). **[Agent: typescript-framework]**
  - [x] Add wide-signature `provider(name, providerSource): Module<...>` runtime method on the `Module` class in `src/di/module.ts`. Pushes `['provider', name, providerSource]` to the invoke queue. **[Agent: typescript-framework]**
  - [x] Add three typed overloads for `provider` on `TypedModule`: Form 1 (constructor), Form 2 (object literal), Form 3 (array-style with `keyof ConfigRegistry & string` deps). Each widens **both** `Registry` (with `InvokableReturn<...$get>`) and `ConfigRegistry` (with `<name>Provider: InstanceType<Ctor>`). **[Agent: typescript-framework]**
  - [x] Update `src/di/injector.ts` `createInjector` with two-phase state: add `providerInstances: Map<string, unknown>` and `providerGetInvokables: Map<string, { invokable: Invokable; providerInstance: unknown }>`. Add a `providerInjector` facade whose `get(name)` resolves from `providerCache` (constants) + `providerInstances` (by `<name>Provider` key) and throws `Cannot inject "<name>" during config phase; use "<name>Provider" instead` for service-only names. **[Agent: typescript-framework]**
  - [x] In `loadModule`, handle `'provider'` entries: type-guard detect Form 1/2/3, normalize to a provider instance (for Form 3 use `providerInjector.invoke` on the constructor to resolve its config-phase deps), store in `providerInstances`, extract `$get` into `providerGetInvokables`. Throw `Provider "<name>" has no $get method` if missing. Throw a clear error for invalid provider shape. **[Agent: typescript-framework]**
  - [x] Extend the `get` branch in the run injector to resolve from `providerGetInvokables`: invoke `$get` with `this` bound to the provider instance, cache result, run any decorators. **[Agent: typescript-framework]**
  - [x] Add runtime tests for `Module.provider` and `createInjector (provider recipe)`: (a) all 3 forms, (b) `<name>Provider` visible in config-phase injector, (c) `<name>` service visible in run-phase injector, (d) `$get` called exactly once (singleton), (e) `$get` deps resolved from run phase, (f) missing `$get` throws, (g) invalid provider shape throws. **[Agent: vitest-testing]**
  - [x] Add type-safety tests for `provider`: (a) `injector.get('logger')` infers the `$get` return type, (b) Form 3 constructor deps typed from `ConfigRegistry`, (c) typo in Form 3 dep names is a compile error (via `@ts-expect-error`), (d) all three forms produce correct `ConfigRegistry` widening. **[Agent: vitest-testing]**
  - [x] Verify `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [x] **Slice 3: `decorator` Recipe**
  - [x] Add `'decorator'` to `RecipeType`. Add wide-signature `decorator(name, invokable): Module<...>` runtime method on `Module`. Pushes `['decorator', serviceName, invokable]` to the invoke queue. **[Agent: typescript-framework]**
  - [x] Add typed overload for `decorator` on `TypedModule`: `K extends keyof Registry & string`, `$delegate` inferred as `Registry[K]`, return type replaces service type via `Omit<Registry, K> & { [K]: Return }`. **[Agent: typescript-framework]**
  - [x] Update `loadModule` in `src/di/injector.ts`: add `decorators: Map<string, Invokable[]>`. For `'decorator'` queue entries, append to the array keyed by service name. **After the full graph is loaded**, validate that every decorator's target has a producer — throw `Cannot decorate unknown service: "<name>"` if missing. **[Agent: typescript-framework]**
  - [x] Update the `get` resolution flow to run the decorator chain **after** the producer returns but **before** caching: for each decorator invokable in order, call `runInjector.invoke(decoratorInvokable, null, { $delegate: current })` and assign the return to `current`. Cache the fully-decorated value. **[Agent: typescript-framework]**
  - [ ] Add runtime tests for `Module.decorator` and `createInjector (decorator recipe)`: (a) single decorator wraps a value service, (b) decorator wraps a factory service, (c) decorator wraps a provider-produced service, (d) chain of multiple decorators in registration order, (e) decorator accesses `$delegate` correctly, (f) decorator with additional deps from `Registry`, (g) decorating unknown service throws at load time, (h) decorated service still resolves as singleton. **[Agent: vitest-testing]**
  - [x] Add type-safety tests for `decorator`: (a) `$delegate` parameter typed as `Registry[K]`, (b) unknown service name is a compile error (via `@ts-expect-error`), (c) decorator return type replaces service type in injector, (d) chained decorators see previous return type as `$delegate`. **[Agent: vitest-testing]**
  - [x] Verify `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 4: `config()` Lifecycle Hook**
  - [x] Add `configBlocks: Invokable[]` array to the `Module` class. Add wide-signature `config(invokable): Module<...>` runtime method that pushes to `configBlocks`. **[Agent: typescript-framework]**
  - [x] Add typed overload for `config` on `TypedModule`: deps constrained to `keyof ConfigRegistry & string`, callback params inferred via `ResolveDeps<ConfigRegistry, Deps>`. Returns the same module type (no widening). **[Agent: typescript-framework]**
  - [x] Update `loadModule` in `src/di/injector.ts` to collect each module's `configBlocks` into an ordered array during the dependency graph walk (deps first, registration order within each module). **[Agent: typescript-framework]**
  - [x] In `createInjector`, after `loadModule` finishes draining queues, execute all collected config blocks via `providerInjector.invoke(block)`. This happens **before** the run injector is returned and **before** any service is instantiated. **[Agent: typescript-framework]**
  - [ ] Verify the config-phase enforcement: `providerInjector.get` must throw `Cannot inject "<name>" during config phase; use "<name>Provider" instead` when called with a service name. Add a test case confirming this. **[Agent: typescript-framework]**
  - [ ] Add runtime tests for `Module.config` and `createInjector (config blocks)`: (a) config block runs during createInjector, before any service is instantiated, (b) can inject a provider via `<name>Provider`, (c) can inject a constant, (d) throws when attempting to inject a service/value/factory, (e) multiple config blocks run in registration order within a module, (f) multi-module config blocks run in dependency order, (g) config block can mutate a provider (e.g., call `loggerProvider.setLevel(...)`) and the mutation is visible in the produced service. **[Agent: vitest-testing]**
  - [ ] Add type-safety tests for `config`: (a) callback params typed from `ConfigRegistry`, (b) injecting a service name (not `<name>Provider`) is a compile error (via `@ts-expect-error`), (c) typo in dep names is a compile error. **[Agent: vitest-testing]**
  - [ ] Verify `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 5: `run()` Lifecycle Hook**
  - [ ] Add `runBlocks: Invokable[]` array to the `Module` class. Add wide-signature `run(invokable): Module<...>` runtime method that pushes to `runBlocks`. **[Agent: typescript-framework]**
  - [ ] Add typed overload for `run` on `TypedModule`: deps constrained to `keyof Registry & string`, callback params inferred via `ResolveDeps<Registry, Deps>`. Returns the same module type (no widening). **[Agent: typescript-framework]**
  - [ ] Update `loadModule` to collect each module's `runBlocks` into an ordered array (deps first, registration order within each module), parallel to the config blocks collection. **[Agent: typescript-framework]**
  - [ ] In `createInjector`, **after** executing all config blocks and **after** building the run injector, execute all collected run blocks via `runInjector.invoke(block)`. Return the run injector. Run blocks must run exactly once per `createInjector` call. **[Agent: typescript-framework]**
  - [ ] Add runtime tests for `Module.run` and `createInjector (run blocks)`: (a) run block executes after all config blocks, (b) run block can inject services, values, constants, factories, (c) run block cannot inject `<name>Provider` names (config phase is over — should throw), (d) multiple run blocks run in registration order, (e) multi-module run blocks run in dependency order, (f) run blocks run exactly once per injector creation. **[Agent: vitest-testing]**
  - [ ] Add type-safety tests for `run`: (a) callback params typed from `Registry`, (b) injecting a `<name>Provider` name is a compile error (via `@ts-expect-error`), (c) typo in dep names is a compile error. **[Agent: vitest-testing]**
  - [ ] Verify `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 6: Public API Exports, Build Verification, Regression Pass**
  - [ ] Update `src/di/index.ts` to re-export new utility types: `ProviderInstance`, `ProviderService`, `InvokableReturn`, `ProviderConstructor`, `ProviderObject`, `ProviderArray`. **[Agent: typescript-framework]**
  - [ ] Verify `src/index.ts` still re-exports everything from `./di/index` — no changes needed, but confirm the new types flow through. **[Agent: typescript-framework]**
  - [ ] Run `pnpm build` and verify all 15 dist artifacts are still generated and the DI subpath bundle (`dist/esm/di/index.mjs`, `dist/cjs/di/index.cjs`, `dist/types/di/index.d.ts`) contains the new recipe methods and types. **[Agent: rollup-build]**
  - [ ] Run the full test suite: all pre-existing spec 007 tests (505) plus new spec 008 tests must pass. No regressions allowed. **[Agent: vitest-testing]**
  - [ ] Final verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass. **[Agent: typescript-framework]**
