# Tasks: Dependency Injection — Foundation

- **Specification:** `context/spec/007-dependency-injection-foundation/`
- **Status:** Complete

---

- [x] **Slice 1: Module Registry & Creation APIs**
  - [x] Create `src/di/di-types.ts` with core type definitions: `Annotated`, `InvokableArray`, `Invokable`, `ModuleAPI<Registry>` (generic over a Registry type), `Injector<Registry>` (generic over a merged registry). Export as `type` exports. **[Agent: typescript-framework]**
  - [x] Create `src/di/module.ts` with a module-scoped `registry` Map, a `Module` class (minimal — just `name`, `requires`, `invokeQueue`), `createModule(name, requires?)` and `getModule(name)` named exports, and a `resetRegistry()` test helper. **[Agent: typescript-framework]**
  - [x] Create `src/di/__tests__/di.test.ts` with a `describe('createModule / getModule', ...)` block. Tests: create module, retrieve module, throw on missing, replacing a module works. Use `beforeEach(() => resetRegistry())` for test isolation. **[Agent: vitest-testing]**
  - [x] Create `src/di/index.ts` barrel exporting `createModule`, `getModule`, and types. Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [x] **Slice 2: value/constant Registration & Basic Injector (no dependencies)**
  - [x] Add `value<Name extends string, T>(name: Name, value: T)` and `constant<Name, T>(name, value)` methods to the `Module` class using the builder pattern. Each returns `ModuleAPI<Registry & { [K in Name]: T }>` so the registry type widens with each call. At runtime the same instance is returned (cast through the new type). **[Agent: typescript-framework]**
  - [x] Create `src/di/injector.ts` with `createInjector(modules)` that loads modules from the registry, walks the (flat, no deps yet) invoke queue, and builds a `providerCache: Map<string, unknown>` for values/constants. Return an `Injector<Registry>` with overloaded `get<K extends keyof Registry>(name: K): Registry[K]` (typed) and `get<T>(name: string): T` (escape hatch), plus `has(name): boolean`. **[Agent: typescript-framework]**
  - [x] Add runtime tests: `module.value('url', 'https://...')`, `module.constant('MAX', 3)`, `injector.get('url')`, `injector.has('url')`, `injector.get('unknown')` throws. **[Agent: vitest-testing]**
  - [x] Add type-safety tests using `expectTypeOf` or `satisfies`: `injector.get('url')` infers `string`, `injector.get('MAX')` infers `number`, `injector.get('nonexistent')` is a **compile-time error** on a typed injector. **[Agent: vitest-testing]**
  - [x] Update `src/di/index.ts` to export `createInjector`. Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [x] **Slice 3: Module Dependency Graph**
  - [x] Update `createInjector` to walk the dependency graph: given `['app']`, recursively load `app.requires` modules, then their requires, etc. Track loaded modules in a `Set<string>` to handle shared deps (load once). Throw `'Module not found: <name>'` for missing modules. **[Agent: typescript-framework]**
  - [x] Add a `MergeRegistries` utility type that merges the typed registries of multiple modules. The injector built from several modules should have a combined registry type so `get('nameFromDep')` also has compile-time type inference. **[Agent: typescript-framework]**
  - [x] Add runtime tests: module `app` depends on `common`, service registered on `common` is visible in `app`. Transitive: `app → b → c`. Shared dep loaded once. Missing module throws. **[Agent: vitest-testing]**
  - [x] Add type-safety tests: services registered in a dependency module appear in the consuming module's typed registry (`get('serviceFromCommon')` infers the correct type). **[Agent: vitest-testing]**
  - [x] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [x] **Slice 4: factory Recipe with Dependency Injection**
  - [x] Create `src/di/annotate.ts` with an `annotate(fn: Invokable): readonly string[]` helper. If `fn` is an array, split into `[...deps, actualFn]`. Else read `fn.$inject`. Throw clear error if neither. **[Agent: typescript-framework]**
  - [x] Add `factory<Name extends string, T>(name: Name, invokable)` method to the `Module` class using the same builder pattern — returns `ModuleAPI<Registry & { [K in Name]: T }>`. The factory's return type `T` should be inferable from the invokable's return type when possible. **[Agent: typescript-framework]**
  - [x] In `createInjector`, update provider resolution: factories are lazy — store the invokable, resolve dependencies on first `get(name)`, cache the result for singleton behavior. **[Agent: typescript-framework]**
  - [x] Add runtime tests: factory with no deps, factory with `$inject` property, factory with array-style annotation, singleton caching, factory accessing a `value` dependency. **[Agent: vitest-testing]**
  - [x] Add type-safety tests: `.factory('logger', () => ({ log: ... }))` — `injector.get('logger')` infers `{ log: ... }`. **[Agent: vitest-testing]**
  - [x] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [x] **Slice 5: Injector.invoke and Injector.annotate**
  - [x] Add `invoke<T>(fn: Invokable, self?: unknown, locals?: Record<string, unknown>): T` to the `Injector`. Use `annotate()` to get dep names, resolve each via `get()` or `locals[name]` if provided, call the function with `self` as `this`. **[Agent: typescript-framework]**
  - [x] Add `annotate(fn)` method on `Injector` that delegates to the `annotate` helper. **[Agent: typescript-framework]**
  - [x] Add tests: `invoke` with array-style, `invoke` with `$inject`, `invoke` with `self` binding, `invoke` with `locals` override, `invoke` with unannotated function throws, `annotate` returns dep names. **[Agent: vitest-testing]**
  - [x] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [x] **Slice 6: Circular Dependency Detection**
  - [x] Update `createInjector`'s factory resolution to track a resolution path stack (`Array<string>`). Before resolving a service, check if its name is already in the stack. If yes, throw `'Circular dependency: A <- B <- A'` with the full chain. Push before resolving, pop after. **[Agent: typescript-framework]**
  - [x] Add tests: direct cycle (`A` depends on `A`), 2-level cycle (`A → B → A`), 3-level cycle (`A → B → C → A`). Error message includes the full chain. **[Agent: vitest-testing]**
  - [x] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [x] **Slice 7: Public API Exports & Root Integration**
  - [x] Ensure `src/di/index.ts` exports everything: `createModule`, `getModule`, `createInjector`, and all public types. Update `src/index.ts` to re-export from `./di/index`. **[Agent: typescript-framework]**
  - [x] Verify build: run `pnpm build`, check that `dist/esm/di/index.mjs`, `dist/cjs/di/index.cjs`, and `dist/types/di/index.d.ts` are all generated. **[Agent: rollup-build]**
  - [x] Final verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass. **[Agent: typescript-framework]**
