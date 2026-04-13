# Tasks: Dependency Injection — Foundation

- **Specification:** `context/spec/007-dependency-injection-foundation/`
- **Status:** Not Started

---

- [ ] **Slice 1: Module Registry & Creation APIs**
  - [ ] Create `src/di/di-types.ts` with core type definitions: `Annotated`, `InvokableArray`, `Invokable`, `ModuleAPI`, `Injector`. Export them as `type` exports. **[Agent: typescript-framework]**
  - [ ] Create `src/di/module.ts` with a module-scoped `registry` Map, a `Module` class (minimal — just `name`, `requires`, `invokeQueue`), and a `resetRegistry()` test helper. **[Agent: typescript-framework]**
  - [ ] Create `src/di/angular.ts` exporting the `angular` namespace object with a `module(name, requires?)` method, plus named exports `createModule(name, requires)` and `getModule(name)`. Both APIs share the same registry. **[Agent: typescript-framework]**
  - [ ] Create `src/di/__tests__/di.test.ts` with a `describe('Module creation', ...)` block. Tests: create module, retrieve module, throw on missing, both APIs share registry, replacing a module works. Use `beforeEach(() => resetRegistry())` for test isolation. **[Agent: vitest-testing]**
  - [ ] Create `src/di/index.ts` barrel exporting `angular`, `createModule`, `getModule`, and types. Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 2: value/constant Registration & Basic Injector (no dependencies)**
  - [ ] Add `value<T>(name, value)` and `constant<T>(name, value)` methods to the `Module` class. They push to the `invokeQueue`. Ensure types use generic `T` for value inference. **[Agent: typescript-framework]**
  - [ ] Create `src/di/injector.ts` with `createInjector(moduleNames: string[])` that loads modules from the registry, walks the (flat, no deps yet) invoke queue, and builds a `providerCache: Map<string, unknown>` for values/constants. Return an `Injector` with `get<T>(name): T` and `has(name): boolean`. **[Agent: typescript-framework]**
  - [ ] Add tests: `module.value('url', 'https://...')`, `module.constant('MAX', 3)`, `injector.get('url')`, `injector.has('url')`, `injector.get('unknown')` throws `'Unknown provider: unknown'`. **[Agent: vitest-testing]**
  - [ ] Update `src/di/index.ts` to export `createInjector`. Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 3: Module Dependency Graph**
  - [ ] Update `createInjector` to walk the dependency graph: given `['app']`, recursively load `app.requires` modules, then their requires, etc. Track loaded modules in a `Set<string>` to handle shared deps (load once). Throw `'Module not found: <name>'` for missing modules. **[Agent: typescript-framework]**
  - [ ] Add tests: module `app` depends on `common`, service registered on `common` is visible in `app`. Transitive: `app → b → c`. Shared dep loaded once. Missing module throws. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 4: factory Recipe with Dependency Injection**
  - [ ] Create `src/di/annotate.ts` with an `annotate(fn: Invokable): readonly string[]` helper. If `fn` is an array, split into `[...deps, actualFn]`. Else read `fn.$inject`. Throw clear error if neither. **[Agent: typescript-framework]**
  - [ ] Add `factory(name, invokable)` method to the `Module` class. In `createInjector`, update provider resolution: factories are lazy — store the invokable, resolve dependencies on first `get(name)`, cache the result for singleton behavior. **[Agent: typescript-framework]**
  - [ ] Add tests: factory with no deps, factory with `$inject` property, factory with array-style annotation, singleton caching (`get` returns same reference), factory accessing a `value` dependency. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 5: Injector.invoke and Injector.annotate**
  - [ ] Add `invoke<T>(fn: Invokable, self?: unknown, locals?: Record<string, unknown>): T` to the `Injector`. Use `annotate()` to get dep names, resolve each via `get()` or `locals[name]` if provided, call the function with `self` as `this`. **[Agent: typescript-framework]**
  - [ ] Add `annotate(fn)` method on `Injector` that delegates to the `annotate` helper. **[Agent: typescript-framework]**
  - [ ] Add tests: `invoke` with array-style, `invoke` with `$inject`, `invoke` with `self` binding, `invoke` with `locals` override, `invoke` with unannotated function throws, `annotate` returns dep names. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 6: Circular Dependency Detection**
  - [ ] Update `createInjector`'s factory resolution to track a resolution path stack (`Array<string>`). Before resolving a service, check if its name is already in the stack. If yes, throw `'Circular dependency: A <- B <- A'` with the full chain. Push before resolving, pop after. **[Agent: typescript-framework]**
  - [ ] Add tests: direct cycle (`A` depends on `A`), 2-level cycle (`A → B → A`), 3-level cycle (`A → B → C → A`). Error message includes the full chain. **[Agent: vitest-testing]**
  - [ ] Verify: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. **[Agent: typescript-framework]**

- [ ] **Slice 7: Public API Exports & Root Integration**
  - [ ] Ensure `src/di/index.ts` exports everything: `angular`, `createModule`, `getModule`, `createInjector`, and all public types. Update `src/index.ts` to re-export from `./di/index`. **[Agent: typescript-framework]**
  - [ ] Verify build: run `pnpm build`, check that `dist/esm/di/index.mjs`, `dist/cjs/di/index.cjs`, and `dist/types/di/index.d.ts` are all generated. **[Agent: rollup-build]**
  - [ ] Final verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass. **[Agent: typescript-framework]**
