# Functional Specification: `$provide` — Config-Phase Service Registration

- **Roadmap Item:** Phase 1 — Core Runtime Foundation > Dependency Injection > `$provide` Service
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 007 and spec 008 delivered the module DSL — `createModule('app', []).factory('svc', factory).provider(…).decorator(…)` — a chainable builder where every registration is recorded BEFORE `createInjector(...)` runs. That covers the static case: a module knows up front which services it needs.

Spec 014 (`$exceptionHandler`) surfaced a gap: AngularJS apps canonically override services from inside `config()` blocks via `$provide.factory('$exceptionHandler', () => myHandler)`. The `module.factory` chain is the static equivalent and works, but the dynamic config-block path is the API every AngularJS migration guide and tutorial documents. Without it, two things suffer: (a) developers porting code from AngularJS hit unexpected friction; (b) one of spec 014's acceptance criteria sits with a skipped test waiting for this spec.

**`$provide` is the config-phase injectable that closes that gap.** Inside a `config()` block, developers can write:

```typescript
appModule.config(['$provide', ($provide) => {
  $provide.factory('$exceptionHandler', () => mySentryHandler);
  $provide.decorator('$http', ['$delegate', wrap]);
}]);
```

The six methods on `$provide` mirror the six recipes already on the module DSL (`provider`, `factory`, `service`, `value`, `constant`, `decorator`). They have the same registration semantics — last-wins, same `Invokable` shapes accepted, same DI dependency rules — so the developer's mental model carries over from chain-time to config-time without surprise.

**Success criteria:**

- Inside a `config()` block, `'$provide'` is a valid dependency name and resolves to an object with `.provider`, `.factory`, `.service`, `.value`, `.constant`, `.decorator` methods.
- Each method registers a service that becomes resolvable at run-time, with the same semantics as the corresponding module DSL method.
- `$provide.factory('foo', invokable)` registered in a `config()` block fully replaces a prior module-level `.factory('foo', ...)` registration on a parent module.
- Calling any `$provide.*` method outside a `config()` block throws a clear, descriptive error (the run-phase / runtime path is closed).
- The skipped `$provide.factory` test in `src/exception-handler/__tests__/di.test.ts` is flipped from `it.skip(...)` to `it(...)` and passes.
- All existing tests (specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014) continue to pass; behavior is purely additive.

---

## 2. Functional Requirements (The "What")

### 2.1. `$provide` Availability Inside `config()` Blocks

- `$provide` is an injectable that resolves only inside `config()` blocks. It is NOT an injectable in `run()` blocks, in factory functions, in service constructors, or via `injector.get('$provide')` after the injector finishes bootstrapping.
  - **Acceptance Criteria:**
    - [ ] `appModule.config(['$provide', ($provide) => { /* … */ }])` — `$provide` is passed to the function and is an object with `.provider`, `.factory`, `.service`, `.value`, `.constant`, `.decorator` methods
    - [ ] `appModule.run(['$provide', () => {}])` — throws "Unknown provider: $provide" or equivalent (final error wording locked in technical considerations)
    - [ ] `injector.get('$provide')` (post-bootstrap) — throws "Unknown provider: $provide"
    - [ ] `appModule.factory('foo', ['$provide', ($provide) => $provide])` — throws when `injector.get('foo')` triggers resolution (factory deps are run-phase; `$provide` is config-only)
    - [ ] `$provide` is resolvable across config blocks of any module in the dependency graph — `appModule.config(['$provide', …])` works whether `appModule` depends on `ng` or not, as long as the injector is built with that module

### 2.2. `$provide.factory(name, invokable)`

- The dynamic equivalent of `module.factory(name, invokable)`. Registers a factory under `name`; the factory runs lazily on first `injector.get(name)` and produces the service.
  - **Acceptance Criteria:**
    - [ ] `$provide.factory('greeting', [() => 'hello'])` — `injector.get('greeting')` returns `'hello'` after the run phase begins
    - [ ] Plain-function shape: `$provide.factory('greeting', () => 'hello')` — also accepted, matching the module DSL's tolerance for non-array invokables (verify against spec 007 behavior)
    - [ ] Array-style annotation with deps: `$provide.factory('doubled', ['base', (base) => base * 2])` — resolves `base` from the run-phase registry and passes it in
    - [ ] `$provide.factory('foo', ...)` registered in a `config()` block replaces a prior `module.factory('foo', ...)` registration on a parent module — last-wins (matches spec 008 semantics)
    - [ ] Singleton: repeated `injector.get('greeting')` calls return the same reference
    - [ ] An ad-hoc factory registered via `$provide.factory` that depends on a service NOT in the registry throws `Unknown provider:` at resolution time, exactly like a module-level factory would

### 2.3. `$provide.service(name, ConstructorFn)`

- The dynamic equivalent of `module.service(name, Ctor)`. Registers a class to be instantiated with `new`; injected deps come from the constructor's `$inject` annotation or array form.
  - **Acceptance Criteria:**
    - [ ] `class Greeter { greet() { return 'hi'; } } $provide.service('greeter', Greeter)` — `injector.get('greeter')` returns a `Greeter` instance; `injector.get('greeter').greet() === 'hi'`
    - [ ] Constructor with deps: `class Counter { constructor(public start: number) {} } Counter.$inject = ['start']; $provide.service('counter', Counter)` — `start` is resolved from the registry and passed in
    - [ ] Array annotation: `$provide.service('counter', ['start', class Counter { … }])` — same resolution behavior
    - [ ] Singleton: `injector.get('greeter')` returns the SAME instance across calls
    - [ ] Last-wins replacement: `$provide.service('greeter', NewGreeter)` in a config block overrides a prior `.service('greeter', OldGreeter)` registered earlier

### 2.4. `$provide.value(name, value)`

- The dynamic equivalent of `module.value(name, value)`. Registers a static value that resolves immediately on `injector.get(name)`.
  - **Acceptance Criteria:**
    - [ ] `$provide.value('apiUrl', '/api/v2')` — `injector.get('apiUrl') === '/api/v2'`
    - [ ] Object values: `$provide.value('config', { timeout: 5000 })` — `injector.get('config')` returns the same object reference (no clone)
    - [ ] Mutating the value after registration: the registered value is captured by reference; later mutations of the original object ARE visible to consumers (matches module DSL behavior — values are not deep-copied)
    - [ ] Last-wins replacement: `$provide.value('apiUrl', '/api/v3')` overrides a prior `.value('apiUrl', '/api/v2')`

### 2.5. `$provide.constant(name, value)`

- The dynamic equivalent of `module.constant(name, value)`. Registers a value resolvable in BOTH the config phase and the run phase. This is the only `$provide.*` method whose registrations are usable inside subsequent config blocks of the same or downstream modules.
  - **Acceptance Criteria:**
    - [ ] `$provide.constant('SECRET', 'abc')` registered in module A's config block — `injector.get('SECRET') === 'abc'` at run-phase
    - [ ] Constants are resolvable across config blocks: `$provide.constant('SECRET', 'abc')` in module A's config; module B (downstream of A) `.config(['SECRET', (s) => /* uses s */])` — works exactly as it does for module-DSL constants
    - [ ] Constants registered via `$provide.constant` cannot be replaced via `$provide.value` or `$provide.factory` later: attempting to do so [NEEDS CLARIFICATION: does this throw, or silently override? AngularJS behavior is to silently override. Match upstream OR throw — to be locked in technical considerations]
    - [ ] Order: constants registered later replace earlier ones with the same name (last-wins, matches module DSL)

### 2.6. `$provide.provider(name, providerSource)`

- The dynamic equivalent of `module.provider(name, providerSource)`. Registers a provider — a configurable service that exposes a config-phase shape (the provider instance) and a run-phase shape (the result of `$get`).
  - **Acceptance Criteria:**
    - [ ] Constructor form: `class MyProvider { value = 'x'; $get = ['value', (v) => () => v] } $provide.provider('my', MyProvider)` — at config-phase, `'myProvider'` resolves to the provider instance; at run-phase, `'my'` resolves to the result of `$get`
    - [ ] Object literal form: `$provide.provider('my', { $get: () => 'value' })` — same shape, no constructor
    - [ ] Array annotation form: `$provide.provider('my', [() => ({ $get: () => 'value' })])` — invokable resolves to a provider instance
    - [ ] Provider configurability: `$provide.provider('my', MyProvider)` registered in a config block; a LATER config block writes `config(['myProvider', (p) => p.value = 'z'])` — the run-phase service reflects `'z'`. This matches AngularJS exactly — provider mutations from subsequent config blocks ARE visible.
    - [ ] Last-wins replacement: `$provide.provider('my', NewProvider)` overrides a prior provider registration, including any prior config-phase mutations of the old provider instance
    - [ ] When a config block uses `$provide.provider('foo', …)` AFTER another config block already configured `'fooProvider'`, the prior config mutations are discarded (the old provider instance is replaced wholesale)

### 2.7. `$provide.decorator(name, decoratorFn)`

- The dynamic equivalent of `module.decorator(name, decoratorFn)`. Wraps an existing service: the decorator is invoked with `'$delegate'` (the original service) and any other declared deps, and returns the replacement.
  - **Acceptance Criteria:**
    - [ ] `$provide.decorator('greeting', ['$delegate', ($delegate) => `${$delegate}!`])` — `injector.get('greeting')` returns the decorated value
    - [ ] Decorator can declare additional deps: `$provide.decorator('greeting', ['$delegate', 'punctuation', ($delegate, punc) => `${$delegate}${punc}`])` — `punc` is resolved from the registry
    - [ ] Multiple decorators on the same service compose in registration order — `$provide.decorator('foo', dec1)` then `$provide.decorator('foo', dec2)` produces a final value where `dec2` wraps `dec1` wraps the original (matches module DSL)
    - [ ] Decorator on a service registered later in the chain still works: `$provide.factory('foo', ...)` in module A's config; `$provide.decorator('foo', ...)` in module B's config (downstream) — the decorator wraps the factory's output
    - [ ] Decorator on a non-existent service: `$provide.decorator('nonexistent', dec)` followed by `injector.get('nonexistent')` throws `Unknown provider:` at resolution time — the decorator does NOT register a placeholder

### 2.8. Config-Phase Exclusivity

- `$provide` is intentionally locked to the config phase. Any attempt to use `$provide.*` outside a `config()` block (in `run()` blocks, factory functions, service constructors, decorators, or via `injector.get('$provide')`) throws a descriptive error.
  - **Acceptance Criteria:**
    - [ ] Calling `$provide.factory(...)` (or any of the six methods) AFTER all config blocks have run throws `Error` with a message containing `'$provide'` and `'config'` (exact wording locked in technical considerations) — explains the phase rule clearly
    - [ ] The throw happens synchronously at the call site, NOT when `injector.get(...)` later tries to resolve the registration
    - [ ] Capturing a `$provide` reference inside a config block and calling it later (e.g., `let saved; config(['$provide', ($p) => { saved = $p; }]); … saved.factory('foo', ...)`) — also throws, with the same error
    - [ ] `injector.has('$provide') === false` at run-phase
    - [ ] `injector.get('$provide')` throws `Unknown provider:` at run-phase
    - [ ] The thrown error from out-of-phase usage is NOT routed through `$exceptionHandler` — it surfaces synchronously to the misusing call site (this is a programming error, not a runtime exception)

### 2.9. Override Semantics — Last-Wins Across Module DSL and `$provide`

- `$provide.<recipe>(name, ...)` and `module.<recipe>(name, ...)` write into the same registration queue and obey the same last-wins rule. The only difference is timing: module DSL runs at chain-build, `$provide` runs at config-phase invocation.
  - **Acceptance Criteria:**
    - [ ] `module.factory('foo', oldFn)` followed by `$provide.factory('foo', newFn)` in a downstream module's config block — `injector.get('foo')` resolves via `newFn`
    - [ ] Two config blocks both registering `$provide.factory('foo', ...)` — the LATER config block (per module loading order) wins
    - [ ] Mixing recipes: `module.value('foo', 'x')` followed by `$provide.factory('foo', () => 'y')` — the factory wins (last-wins regardless of recipe type)
    - [ ] Decorator stacking is preserved across both APIs: `module.decorator('foo', d1)` + `$provide.decorator('foo', d2)` — `d2` wraps `d1` wraps the original (registration order is a single timeline)

### 2.10. TypeScript Surface — Loosely Typed for Now

- The `$provide` parameter in a `config()` block is typed with method signatures that accept the same `Invokable` shapes the module DSL accepts, but does NOT extend the typed `MergeRegistries` machinery. Registering a service via `$provide.factory<'svc', Shape>(...)` does not augment the typed registry that `injector.get('svc')` uses.
  - **Acceptance Criteria:**
    - [ ] The inferred type of `$provide` inside `config(['$provide', ($provide) => …])` is an object with the six methods, each accepting the appropriate `Invokable` / `ProviderSource` / `value` argument shapes
    - [ ] `$provide.factory('svc', invokable)` compiles cleanly — no need for explicit generics
    - [ ] The runtime registration is still type-checked at the boundary: passing a non-Invokable to `$provide.factory` is a compile-time error
    - [ ] Calling `injector.get('foo')` after registering `'foo'` via `$provide.factory` returns `unknown` from the typed registry — apps wanting tighter typing must explicitly assert. (This is the documented limitation of dynamic registration in this spec; a future spec could add typed-DI integration.)
    - [ ] The two type augmentation paths exposed elsewhere (`declare module '@di/di-types'` ModuleRegistry augmentation) continue to work for static module-DSL registrations — they are NOT affected by `$provide`

### 2.11. Spec 014 Skipped Test Activation

- The skipped `$provide.factory` test in spec 014's `di.test.ts` (line 91, `it.skip("config(['$provide', $p => $p.factory(...)]) replaces the default", ...)`) is flipped to `it(...)` and passes as part of this spec's deliverables.
  - **Acceptance Criteria:**
    - [ ] `src/exception-handler/__tests__/di.test.ts` line 91 (or wherever the skipped test now lives) — `it.skip(...)` becomes `it(...)`
    - [ ] The local `ProvideService` type alias used by the test is removed (or replaced with a proper import from `@di/index` or wherever the canonical `$provide` type lives)
    - [ ] The TODO comment block above the test (currently lines 84-90) is removed — the explanation no longer applies
    - [ ] The test passes: registering `$provide.factory('$exceptionHandler', () => mySpy)` in a config block makes `mySpy` the resolved handler
    - [ ] The full spec 014 verification can re-run: `pnpm test` shows the test as passing rather than skipped
    - [ ] [SUGGESTED] After this spec ships, an `/awos:verify` re-run on spec 014 can flip the two `[ ] NOT MET` criteria in `functional-spec.md` to `[x]` — this spec is what they were waiting for

### 2.12. Backward Compatibility

- Adding `$provide` is purely additive. No existing API is renamed, removed, or behavior-changed.
  - **Acceptance Criteria:**
    - [ ] All tests from specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014 continue to pass unchanged
    - [ ] `createModule(...).factory(...) / .service(...) / .value(...) / .constant(...) / .provider(...) / .decorator(...)` chain methods retain their current signatures and behavior
    - [ ] `createInjector([...])` retains its current signature; the only observable change is that `'$provide'` becomes a resolvable name during config-phase invocation
    - [ ] `module.config([...])` retains its current signature; the only change is the expanded set of valid dep names (now includes `'$provide'`)
    - [ ] No prior public export is renamed or removed
    - [ ] The `RecipeType` union in `src/di/module.ts` (currently `'value' | 'constant' | 'factory' | 'service' | 'provider' | 'decorator'`) is unchanged — `$provide` writes the same record types to the same queue

### 2.13. Documentation

- The new injectable is documented for downstream developers without forcing them to read source.
  - **Acceptance Criteria:**
    - [ ] `CLAUDE.md` "Modules" table: the existing `./di` row is updated to mention that `$provide` is now resolvable in config blocks (small inline addition; no new row needed)
    - [ ] `CLAUDE.md` "Non-obvious invariants" gains a bullet stating that `$provide` is config-phase only — usage outside config throws synchronously, and this is intentional to keep registration semantics deterministic
    - [ ] `CLAUDE.md` "Where to look when…" gains a row pointing to wherever `$provide` is implemented (likely `src/di/injector.ts` or a new `src/di/provide.ts`) for "How are services registered from inside config blocks?"
    - [ ] TSDoc on each of the six `$provide` methods carries at least one usage example showing the canonical AngularJS-style override pattern
    - [ ] `src/di/README.md` (if it exists) is extended; otherwise a brief section at the top of `src/di/index.ts` or in the existing module/injector files documents the override pattern

---

## 3. Scope and Boundaries

### In-Scope

- `$provide` injectable resolvable in `config()` blocks across any module in the dependency graph
- Six methods: `provider`, `factory`, `service`, `value`, `constant`, `decorator` — full AngularJS parity
- Each method shares semantics with its module DSL counterpart: same `Invokable` shapes, same DI dep resolution, same last-wins rule, same singleton/instantiation behavior
- Synchronous throw on out-of-phase use (run blocks, runtime resolution, captured-`$provide` reuse)
- Spec 014 skipped test (`$provide.factory` override of `$exceptionHandler`) flipped to active and passing
- TypeScript surface: loosely typed (`$provide` parameter has typed methods accepting `Invokable` shapes; no `MergeRegistries` integration in this spec)
- `CLAUDE.md` and DI documentation updates
- All prior spec test suites (002, 003, 006, 007–014) continue to pass

### Out-of-Scope

- **Typed `MergeRegistries` integration for `$provide`** — `$provide.factory<'svc', Shape>` does NOT augment the typed registry in this spec. A future spec can add this if usage patterns demand it.
- **`$injector` parity additions** — `$injector` is already self-registered (per `CLAUDE.md` "Non-obvious invariants"); this spec doesn't touch the `$injector` surface. Any new methods on `$injector` (e.g., `$injector.invoke`, `$injector.instantiate` parity) are separate.
- **Run-phase / runtime registration via `$provide`** — explicitly rejected. The phase boundary is part of the contract.
- **`$provide.constant` resolvability inside the SAME config block that registers it** — AngularJS allows late-binding within a single config block. This spec deliberately matches that behavior since it falls out of the registration queue ordering, but it's noted here as a behavior boundary rather than an acceptance criterion.
- **Performance optimizations** — the implementation is expected to be straightforward (push to the existing `$$invokeQueue`, processed by the existing injector machinery). No micro-optimizations.
- **`angular.module().config(['$provide', …])` Phase 5 compat layer** — the Phase 5 `angular.module` is a thin wrapper over `createModule`/`getModule` and inherits the full DSL. Once this spec ships, the compat layer automatically picks up `$provide` config-block injection because they share the same module registry. No additional wiring needed in Phase 5.
- **Filters, Directives, Controllers, Bootstrap, HTTP, Forms, Routing, Animations** — separate phases per the roadmap.
- **`$controllerProvider`, `$compileProvider`, `$filterProvider`, `$animateProvider`** — these are domain-specific providers added in their own specs (Phase 2/4). Each will register itself on `ngModule.provider(...)` independently; `$provide` is the generic injectable, and registering one of those domain providers via `$provide.provider(name, ProviderClass)` will be supported automatically by virtue of `$provide.provider` being one of the six recipes. No special-case wiring needed in this spec.
