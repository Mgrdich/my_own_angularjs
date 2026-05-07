# Functional Specification: `$provide` — Config-Phase Service Registration

- **Roadmap Item:** Phase 1 — Core Runtime Foundation > Dependency Injection > `$provide` Service
- **Status:** Completed
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
    - [x] `appModule.config(['$provide', ($provide) => { /* … */ }])` — `$provide` is passed to the function and is an object with `.provider`, `.factory`, `.service`, `.value`, `.constant`, `.decorator` methods
    - [x] `appModule.run(['$provide', () => {}])` — throws "Unknown provider: $provide" or equivalent (final error wording locked in technical considerations)
    - [x] `injector.get('$provide')` (post-bootstrap) — throws "Unknown provider: $provide"
    - [x] `appModule.factory('foo', ['$provide', ($provide) => $provide])` — throws when `injector.get('foo')` triggers resolution (factory deps are run-phase; `$provide` is config-only)
    - [x] `$provide` is resolvable across config blocks of any module in the dependency graph — `appModule.config(['$provide', …])` works whether `appModule` depends on `ng` or not, as long as the injector is built with that module

### 2.2. `$provide.factory(name, invokable)`

- The dynamic equivalent of `module.factory(name, invokable)`. Registers a factory under `name`; the factory runs lazily on first `injector.get(name)` and produces the service.
  - **Acceptance Criteria:**
    - [x] `$provide.factory('greeting', [() => 'hello'])` — `injector.get('greeting')` returns `'hello'` after the run phase begins
    - [x] Plain-function shape: `$provide.factory('greeting', () => 'hello')` — also accepted, matching the module DSL's tolerance for non-array invokables (verify against spec 007 behavior). Note: bare arrows without an `$inject` annotation are not auto-annotated by `annotate` (a property of `annotate`, not `$provide`); the canonical form is either `[() => …]` array-style or an explicitly `$inject`-annotated function. Behavior is identical to `module.factory`.
    - [x] Array-style annotation with deps: `$provide.factory('doubled', ['base', (base) => base * 2])` — resolves `base` from the run-phase registry and passes it in. Structurally inherited via Slice 2 unification: `$provide.factory` and `module.factory` both flow through `applyRegistrationRecord('factory', …)` → the same `factoryInvokables` map → the same injector resolution path. Module-DSL factory-with-deps coverage in `di-injector-basics.test.ts` is the comprehensive proof; sister-recipe `$provide.service('counter', ['start', Counter])` and `$provide.provider('my', ['defaultGreeting', MyProvider])` tests in `provide.test.ts` confirm the array-form deps mechanism works end-to-end through `$provide`.
    - [x] `$provide.factory('foo', ...)` registered in a `config()` block replaces a prior `module.factory('foo', ...)` registration on a parent module — last-wins (matches spec 008 semantics)
    - [x] Singleton: repeated `injector.get('greeting')` calls return the same reference. Structurally inherited (same code path as module-DSL factory; sister-recipe `$provide.service` singleton test at `provide.test.ts:108-124` exercises the same caching layer).
    - [x] An ad-hoc factory registered via `$provide.factory` that depends on a service NOT in the registry throws `Unknown provider:` at resolution time, exactly like a module-level factory would. Structurally inherited (factory-deps unknown-provider error path is in the shared injector resolver, exercised by `$provide.decorator('nonexistent', …)` test at `provide.test.ts:524-539` and module-DSL coverage in `di-injector-basics.test.ts`).

### 2.3. `$provide.service(name, ConstructorFn)`

- The dynamic equivalent of `module.service(name, Ctor)`. Registers a class to be instantiated with `new`; injected deps come from the constructor's `$inject` annotation or array form.
  - **Acceptance Criteria:**
    - [x] `class Greeter { greet() { return 'hi'; } } $provide.service('greeter', Greeter)` — `injector.get('greeter')` returns a `Greeter` instance; `injector.get('greeter').greet() === 'hi'`
    - [x] Constructor with deps: `class Counter { constructor(public start: number) {} } Counter.$inject = ['start']; $provide.service('counter', Counter)` — `start` is resolved from the registry and passed in
    - [x] Array annotation: `$provide.service('counter', ['start', class Counter { … }])` — same resolution behavior
    - [x] Singleton: `injector.get('greeter')` returns the SAME instance across calls
    - [x] Last-wins replacement: `$provide.service('greeter', NewGreeter)` in a config block overrides a prior `.service('greeter', OldGreeter)` registered earlier

### 2.4. `$provide.value(name, value)`

- The dynamic equivalent of `module.value(name, value)`. Registers a static value that resolves immediately on `injector.get(name)`.
  - **Acceptance Criteria:**
    - [x] `$provide.value('apiUrl', '/api/v2')` — `injector.get('apiUrl') === '/api/v2'`
    - [x] Object values: `$provide.value('config', { timeout: 5000 })` — `injector.get('config')` returns the same object reference (no clone)
    - [x] Mutating the value after registration: the registered value is captured by reference; later mutations of the original object ARE visible to consumers (matches module DSL behavior — values are not deep-copied)
    - [x] Last-wins replacement: `$provide.value('apiUrl', '/api/v3')` overrides a prior `.value('apiUrl', '/api/v2')`

### 2.5. `$provide.constant(name, value)`

- The dynamic equivalent of `module.constant(name, value)`. Registers a value resolvable in BOTH the config phase and the run phase. This is the only `$provide.*` method whose registrations are usable inside subsequent config blocks of the same or downstream modules.
  - **Acceptance Criteria:**
    - [x] `$provide.constant('SECRET', 'abc')` registered in module A's config block — `injector.get('SECRET') === 'abc'` at run-phase
    - [x] Constants are resolvable across config blocks: `$provide.constant('SECRET', 'abc')` in module A's config; module B (downstream of A) `.config(['SECRET', (s) => /* uses s */])` — works exactly as it does for module-DSL constants
    - [x] Constants registered via `$provide.constant` cannot be replaced via `$provide.value` or `$provide.factory` later: doing so throws `Cannot override constant "<name>" — already registered via .constant(...)` (decision: throw, stricter than AngularJS upstream which silently overrides). The guard fires uniformly through `applyRegistrationRecord` for any non-`constant` recipe (`value` / `factory` / `service` / `provider` / `decorator`) targeting a name in `constantNames`. Tests in `registration.test.ts` (`constant-override guard` describe block) and `provide.test.ts` (`$provide.constant` sub-suite, four sub-asserts for value/factory/service/provider) lock in this behavior.
    - [x] Order: constants registered later replace earlier ones with the same name (last-wins, matches module DSL)

### 2.6. `$provide.provider(name, providerSource)`

- The dynamic equivalent of `module.provider(name, providerSource)`. Registers a provider — a configurable service that exposes a config-phase shape (the provider instance) and a run-phase shape (the result of `$get`).
  - **Acceptance Criteria:**
    - [x] Constructor form: `class MyProvider { value = 'x'; $get = ['value', (v) => () => v] } $provide.provider('my', MyProvider)` — at config-phase, `'myProvider'` resolves to the provider instance; at run-phase, `'my'` resolves to the result of `$get`
    - [x] Object literal form: `$provide.provider('my', { $get: () => 'value' })` — same shape, no constructor
    - [x] Array annotation form: `$provide.provider('my', [() => ({ $get: () => 'value' })])` — invokable resolves to a provider instance
    - [x] Provider configurability: `$provide.provider('my', MyProvider)` registered in a config block; a LATER config block writes `config(['myProvider', (p) => p.value = 'z'])` — the run-phase service reflects `'z'`. This matches AngularJS exactly — provider mutations from subsequent config blocks ARE visible.
    - [x] Last-wins replacement: `$provide.provider('my', NewProvider)` overrides a prior provider registration, including any prior config-phase mutations of the old provider instance
    - [x] When a config block uses `$provide.provider('foo', …)` AFTER another config block already configured `'fooProvider'`, the prior config mutations are discarded (the old provider instance is replaced wholesale)

### 2.7. `$provide.decorator(name, decoratorFn)`

- The dynamic equivalent of `module.decorator(name, decoratorFn)`. Wraps an existing service: the decorator is invoked with `'$delegate'` (the original service) and any other declared deps, and returns the replacement.
  - **Acceptance Criteria:**
    - [x] `$provide.decorator('greeting', ['$delegate', ($delegate) => `${$delegate}!`])` — `injector.get('greeting')` returns the decorated value
    - [x] Decorator can declare additional deps: `$provide.decorator('greeting', ['$delegate', 'punctuation', ($delegate, punc) => `${$delegate}${punc}`])` — `punc` is resolved from the registry
    - [x] Multiple decorators on the same service compose in registration order — `$provide.decorator('foo', dec1)` then `$provide.decorator('foo', dec2)` produces a final value where `dec2` wraps `dec1` wraps the original (matches module DSL)
    - [x] Decorator on a service registered later in the chain still works: `$provide.factory('foo', ...)` in module A's config; `$provide.decorator('foo', ...)` in module B's config (downstream) — the decorator wraps the factory's output
    - [x] Decorator on a non-existent service: `$provide.decorator('nonexistent', dec)` followed by `injector.get('nonexistent')` throws `Unknown provider:` at resolution time — the decorator does NOT register a placeholder

### 2.8. Config-Phase Exclusivity

- `$provide` is intentionally locked to the config phase. Any attempt to use `$provide.*` outside a `config()` block (in `run()` blocks, factory functions, service constructors, decorators, or via `injector.get('$provide')`) throws a descriptive error.
  - **Acceptance Criteria:**
    - [x] Calling `$provide.factory(...)` (or any of the six methods) AFTER all config blocks have run throws `Error` with a message containing `'$provide'` and `'config'` (exact wording locked in technical considerations) — explains the phase rule clearly
    - [x] The throw happens synchronously at the call site, NOT when `injector.get(...)` later tries to resolve the registration
    - [x] Capturing a `$provide` reference inside a config block and calling it later (e.g., `let saved; config(['$provide', ($p) => { saved = $p; }]); … saved.factory('foo', ...)`) — also throws, with the same error
    - [x] `injector.has('$provide') === false` at run-phase
    - [x] `injector.get('$provide')` throws `Unknown provider:` at run-phase
    - [x] The thrown error from out-of-phase usage is NOT routed through `$exceptionHandler` — it surfaces synchronously to the misusing call site (this is a programming error, not a runtime exception)

### 2.9. Override Semantics — Last-Wins Across Module DSL and `$provide`

- `$provide.<recipe>(name, ...)` and `module.<recipe>(name, ...)` write into the same registration queue and obey the same last-wins rule. The only difference is timing: module DSL runs at chain-build, `$provide` runs at config-phase invocation.
  - **Acceptance Criteria:**
    - [x] `module.factory('foo', oldFn)` followed by `$provide.factory('foo', newFn)` in a downstream module's config block — `injector.get('foo')` resolves via `newFn`
    - [x] Two config blocks both registering `$provide.factory('foo', ...)` — the LATER config block (per module loading order) wins
    - [x] Mixing recipes: `module.value('foo', 'x')` followed by `$provide.factory('foo', () => 'y')` — the factory wins (last-wins regardless of recipe type)
    - [x] Decorator stacking is preserved across both APIs: `module.decorator('foo', d1)` + `$provide.decorator('foo', d2)` — `d2` wraps `d1` wraps the original (registration order is a single timeline)

### 2.10. TypeScript Surface — Loosely Typed for Now

- The `$provide` parameter in a `config()` block is typed with method signatures that accept the same `Invokable` shapes the module DSL accepts, but does NOT extend the typed `MergeRegistries` machinery. Registering a service via `$provide.factory<'svc', Shape>(...)` does not augment the typed registry that `injector.get('svc')` uses.
  - **Acceptance Criteria:**
    - [x] The inferred type of `$provide` inside `config(['$provide', ($provide) => …])` is an object with the six methods, each accepting the appropriate `Invokable` / `ProviderSource` / `value` argument shapes
    - [x] `$provide.factory('svc', invokable)` compiles cleanly — no need for explicit generics
    - [x] The runtime registration is still type-checked at the boundary: passing a non-Invokable to `$provide.factory` is a compile-time error
    - [x] Calling `injector.get('foo')` after registering `'foo'` via `$provide.factory` returns `unknown` from the typed registry — apps wanting tighter typing must explicitly assert. (This is the documented limitation of dynamic registration in this spec; a future spec could add typed-DI integration.)
    - [x] The two type augmentation paths exposed elsewhere (`declare module '@di/di-types'` ModuleRegistry augmentation) continue to work for static module-DSL registrations — they are NOT affected by `$provide`

### 2.11. Spec 014 Skipped Test Activation

- The skipped `$provide.factory` test in spec 014's `di.test.ts` (line 91, `it.skip("config(['$provide', $p => $p.factory(...)]) replaces the default", ...)`) is flipped to `it(...)` and passes as part of this spec's deliverables.
  - **Acceptance Criteria:**
    - [x] `src/exception-handler/__tests__/di.test.ts` line 91 (or wherever the skipped test now lives) — `it.skip(...)` becomes `it(...)`
    - [x] The local `ProvideService` type alias used by the test is removed (or replaced with a proper import from `@di/index` or wherever the canonical `$provide` type lives)
    - [x] The TODO comment block above the test (currently lines 84-90) is removed — the explanation no longer applies
    - [x] The test passes: registering `$provide.factory('$exceptionHandler', () => mySpy)` in a config block makes `mySpy` the resolved handler
    - [x] The full spec 014 verification can re-run: `pnpm test` shows the test as passing rather than skipped
    - [x] [SUGGESTED] After this spec ships, an `/awos:verify` re-run on spec 014 can flip the two `[ ] NOT MET` criteria in `functional-spec.md` to `[x]` — this spec is what they were waiting for

### 2.12. Backward Compatibility

- Adding `$provide` is purely additive. No existing API is renamed, removed, or behavior-changed.
  - **Acceptance Criteria:**
    - [x] All tests from specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014 continue to pass unchanged
    - [x] `createModule(...).factory(...) / .service(...) / .value(...) / .constant(...) / .provider(...) / .decorator(...)` chain methods retain their current signatures and behavior
    - [x] `createInjector([...])` retains its current signature; the only observable change is that `'$provide'` becomes a resolvable name during config-phase invocation
    - [x] `module.config([...])` retains its current signature; the only change is the expanded set of valid dep names (now includes `'$provide'`)
    - [x] No prior public export is renamed or removed
    - [x] The `RecipeType` union in `src/di/module.ts` (currently `'value' | 'constant' | 'factory' | 'service' | 'provider' | 'decorator'`) is unchanged — `$provide` writes the same record types to the same queue

### 2.13. Documentation

- The new injectable is documented for downstream developers without forcing them to read source.
  - **Acceptance Criteria:**
    - [x] `CLAUDE.md` "Modules" table: the existing `./di` row is updated to mention that `$provide` is now resolvable in config blocks (small inline addition; no new row needed)
    - [x] `CLAUDE.md` "Non-obvious invariants" gains a bullet stating that `$provide` is config-phase only — usage outside config throws synchronously, and this is intentional to keep registration semantics deterministic
    - [x] `CLAUDE.md` "Where to look when…" gains a row pointing to wherever `$provide` is implemented (likely `src/di/injector.ts` or a new `src/di/provide.ts`) for "How are services registered from inside config blocks?"
    - [x] TSDoc on each of the six `$provide` methods carries at least one usage example showing the canonical AngularJS-style override pattern
    - [x] `src/di/README.md` (if it exists) is extended; otherwise a brief section at the top of `src/di/index.ts` or in the existing module/injector files documents the override pattern

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
