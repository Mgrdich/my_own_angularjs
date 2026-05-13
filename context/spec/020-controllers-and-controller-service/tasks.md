# Tasks: Controllers and the `$controller` Service

- **Specification:** `context/spec/020-controllers-and-controller-service/`
- **Status:** Draft

---

- [ ] **Slice 1: Foundation — Module Scaffolding + Type Surface + Error Classes (No Behavior Change)**
  - [ ] Add `"@controller/*": ["./src/controller/*"]` to `tsconfig.json` `paths`. Mirrors every prior subpath alias (`@core`, `@parser`, `@di`, `@interpolate`, `@sce`, `@sanitize`, `@exception-handler`, `@filter`, `@compiler`, `@template`). **[Agent: rollup-build]**
  - [ ] Add `'@controller': path.resolve(__dirname, 'src/controller')` to `vitest.config.ts` `resolve.alias` (Vitest does not read `tsconfig.json` paths; the alias must be duplicated, same precedent as `@filter` / `@compiler` / `@template`). Also add `src/controller/**` to coverage `include`. **[Agent: rollup-build]**
  - [ ] Add `./controller` entry to `rollup.config.mjs` so the new module emits `dist/{esm,cjs,types}/controller/index.{mjs,cjs,d.ts}`. Mirror the existing `./template` entry. **[Agent: rollup-build]**
  - [ ] Add `./controller` to `package.json` `exports` map (ESM `import`, CJS `require`, `types`). Mirror the existing exports entries. **[Agent: rollup-build]**
  - [ ] Create `src/controller/controller-types.ts` exporting the public type surface per technical-considerations §2.4:
        - `type ControllerInvokable = ControllerFn | (string | ControllerFn)[]` where `ControllerFn = (...args: unknown[]) => unknown | void`
        - `interface ControllerLocals extends Record<string, unknown> { $scope?: Scope; $element?: Element; $attrs?: Attributes; $transclude?: TranscludeFn }` (all optional — `$controller(fn, {})` is legal)
        - `type ControllerService = (nameOrFn: string | ControllerInvokable, locals?: ControllerLocals, ident?: string) => unknown`
        - `interface IControllerProvider { register(name: string, fn: ControllerInvokable): IControllerProvider; register(map: Record<string, ControllerInvokable>): IControllerProvider; has(name: string): boolean }`
        - `interface CreateControllerArgs { injector: Injector; registry: ReadonlyMap<string, ControllerInvokable> }` (internal — re-exported for tests, NOT in the root barrel). **[Agent: typescript-framework]**
  - [ ] Create `src/controller/controller-errors.ts` with the six error classes per technical-considerations §2.6, mirroring the existing `src/compiler/compile-error.ts` pattern (extends `Error`, `readonly name = '<ClassName>' as const`, deterministic single-string message):
        - `ControllerRegistrationOutOfPhaseError(method: string)` → `$controllerProvider.<method> is only callable during the config phase; calling it after the run phase begins is not supported`
        - `InvalidControllerNameError(received: string)` → `Invalid controller name: <received> (must be a non-empty string with no whitespace; "hasOwnProperty" is reserved)`
        - `InvalidControllerFactoryError(name: string, description: string)` → `Invalid controller factory for "<name>": <description>` — also reused by `$controller(badInput, ...)` direct-call path
        - `UnknownControllerError(name: string)` → `Unknown controller: <name>`
        - `MalformedControllerAliasError(received: string)` → `Malformed controller alias: "<received>" — expected "Name as alias" where alias is a valid identifier`
        - `ControllerAsWithoutControllerError(directiveName: string)` → `Directive "<directiveName>" declares controllerAs without a controller; both must be present together`. **[Agent: typescript-framework]**
  - [ ] Create `src/controller/index.ts` (initial barrel — populated in subsequent slices). For Slice 1, re-export only the types from `./controller-types` and the six error classes from `./controller-errors`. The factory + provider ship in Slices 2 and 3. **[Agent: typescript-framework]**
  - [ ] Update `src/index.ts` (root barrel) to re-export the six error classes + the four public types (`ControllerService`, `ControllerInvokable`, `ControllerLocals`, `IControllerProvider`) from `./controller`. `CreateControllerArgs` is INTERNAL — not re-exported from the public root barrel. **[Agent: typescript-framework]**
  - [ ] Create `src/controller/__tests__/controller-errors-foundation.test.ts` covering all six error classes — instantiate each, assert message format, `name` discriminator, and `instanceof Error`. Mirror the spec-018 `transclude-errors-foundation.test.ts` pattern. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests (specs 002–019) pass unchanged. The new build emits `dist/types/controller/index.d.ts` containing the four public types + six error classes. No public ngModule surface change yet; no `EXCEPTION_HANDLER_CAUSES` change. **[Agent: rollup-build]**

- [ ] **Slice 2: `createController` ESM-First Factory + Name Parser**
  - [ ] Create `src/controller/controller.ts` exporting `createController(args: CreateControllerArgs): ControllerService` per technical-considerations §2.4. Internal helpers (private, not exported):
        - `CONTROLLER_NAME_ALIAS_RE = /^(\S+?)(\s+as\s+([\w$]+))?\s*$/` — splits `"Name as alias"` into `{ name, ident? }`
        - `IDENT_RE = /^[\w$][\w$\d]*$/` — validates `controllerAs` value + explicit `ident` argument
        - `parseControllerName(input: string): { name: string; ident?: string }` — runs the regex, throws `MalformedControllerAliasError` on no-match or invalid alias
        - `instantiate(injector, fn, locals): unknown` — `Object.create(constructor.prototype)` + `injector.invoke(fn, instance, locals)` + return-value-replacement (return value wins if it's a non-null object; otherwise the prototype-instance wins) per AngularJS `$injector.instantiate` semantics
        - `bindAlias(scope, alias, instance): void` — silent skip when scope absent; no-op when alias absent. **[Agent: typescript-framework]**
  - [ ] In `controller.ts`, the returned `ControllerService` function follows §2.4 resolution order:
        1. `typeof nameOrFn === 'string'` → `parseControllerName` → registry lookup → throw `UnknownControllerError` if missing → `instantiate` → `bindAlias(locals?.$scope, parsed.ident, instance)` → return
        2. `typeof nameOrFn === 'function' || Array.isArray(nameOrFn)` → `instantiate` → if `ident` arg supplied, validate against `IDENT_RE` (throw `MalformedControllerAliasError` on fail) → `bindAlias(locals?.$scope, ident, instance)` → return
        3. Otherwise → throw `InvalidControllerFactoryError(name='<inline>', describe(nameOrFn))`. **[Agent: typescript-framework]**
  - [ ] Also export from `controller.ts`:
        - A default `controller = createController({ injector: defaultInjector, registry: new Map() })` binding for ESM-first standalone use. Follow the `interpolate` / `sce` precedent — the default binding is a thin convenience wrapper that closes over a fresh empty registry; tests that need a populated registry call `createController(...)` directly. (If this introduces a chicken-and-egg with the default `injector` symbol from `@di`, fall back to omitting the default binding from this slice and revisit in Slice 5; document the choice in the task close-out note.) **[Agent: typescript-framework]**
  - [ ] Update `src/controller/index.ts` to re-export `createController` (and the default `controller` binding if it survived the previous bullet's check). **[Agent: typescript-framework]**
  - [ ] Update `src/index.ts` to re-export `createController` (and the default `controller` binding if applicable) from `./controller`. **[Agent: typescript-framework]**
  - [ ] Create `src/controller/__tests__/controller.test.ts` covering FS §2.2 + §2.3 against a **fake injector** (a small handcrafted `{ invoke, get, has, annotate }` object) and a **fake registry** (a real `Map`):
        - String name → registered fn lookup → instance returned
        - Inline function → instantiation works
        - Array-style annotation → last element invoked, deps resolved
        - Each call returns a distinct instance (identity check)
        - `UnknownControllerError` shape on missing name
        - `InvalidControllerFactoryError` shape on `null` / `undefined` / `42` / `{}` / empty array
        - Locals override: when locals + injector both have the same key, locals win
        - `'Name as vm'` parses correctly; `bindAlias` runs when `$scope` present; silent skip when absent
        - Explicit `ident` argument honored for inline-function path; `MalformedControllerAliasError` when ident isn't a valid identifier
        - `MalformedControllerAliasError` for: empty alias (`'Name as '`), alias-only (`' as vm'`), non-identifier alias (`'Name as 123'`), leading whitespace before `as`
        - Constructor-returns-object replaces the prototype-instance; constructor returns `undefined` / primitive → prototype-instance returned
        - `'hasOwnProperty'` is rejected at lookup if it ever reaches the registry path — defensive (registration-time rejection lives in Slice 3 but the lookup-time fallback is asserted here too). **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests pass unchanged. New `createController` is reachable from the root barrel. `injector.get(...)` is NOT yet wired (that's Slice 3). **[Agent: rollup-build]**

- [ ] **Slice 3: `$ControllerProvider` + `ngModule` Registration**
  - [ ] Create `src/controller/controller-provider.ts` exporting `$ControllerProvider` (class) per technical-considerations §2.3. Constructor takes `['$provide', $provide]` (mirrors `$FilterProvider`); the provider closes over `$$registry: Map<string, ControllerInvokable>`. **[Agent: typescript-framework]**
  - [ ] Implement `$ControllerProvider.register` overloads:
        - `register(name: string, fn: ControllerInvokable): this` — runs `getPhase()` guard (throws `ControllerRegistrationOutOfPhaseError('register')` outside config); validates name (`/^\S+$/` + reject `'hasOwnProperty'` → `InvalidControllerNameError`); validates factory (function or non-empty array → `InvalidControllerFactoryError`); calls `$$registry.set(name, fn)`; returns `this`. Last-wins on duplicate name.
        - `register(map: Record<string, ControllerInvokable>): this` — runs config-phase guard once; iterates entries; recurses into the string-form path; returns `this`.
        - `getPhase` is captured from `$provide` (existing pattern in `src/di/provide.ts:26-33`). **[Agent: typescript-framework]**
  - [ ] Implement `$ControllerProvider.has(name: string): boolean` → `$$registry.has(name)`. Reachable in both phases (no guard). **[Agent: typescript-framework]**
  - [ ] Implement `$ControllerProvider.$get` as `['$injector', ($injector) => createController({ injector: $injector, registry: this.$$registry })]`. The `ReadonlyMap` cast is purely a type seam — the runtime registry is the same `Map` the provider mutates. **[Agent: typescript-framework]**
  - [ ] Update `src/controller/index.ts` to re-export `$ControllerProvider`. (Class is exposed for advanced consumers + tests; matches `$FilterProvider` precedent.) **[Agent: typescript-framework]**
  - [ ] Register `$controller` on `ngModule` in `src/core/ng-module.ts` per technical-considerations §2.8. Add `.provider<'$controller', ControllerService, $ControllerProvider>('$controller', ['$provide', $ControllerProvider])` BEFORE the existing `'$compile'` registration so the dep graph resolves. **[Agent: typescript-framework]**
  - [ ] Extend the `declare module '@di/di-types'` block in `src/core/ng-module.ts` to add `$controller: ControllerService` to the `registry` half and `$controllerProvider: $ControllerProvider` to the `config` half. **[Agent: typescript-framework]**
  - [ ] Note: `$ControllerProvider` is intentionally **NOT** re-exported from `src/index.ts` (DI-only providers stay out of the root barrel — same precedent as `$SanitizeProvider`, per technical-considerations §2.9). **[Agent: typescript-framework]**
  - [ ] Create `src/controller/__tests__/controller-provider.test.ts` covering provider-standalone behavior (constructed manually with a mock `$provide` exposing a controllable `getPhase()`):
        - String-form `register('MyCtrl', fn)` succeeds in config phase; returns `this`
        - Array-form `register('MyCtrl', ['$scope', fn])` succeeds
        - Object-form `register({ FooCtrl: fn1, BarCtrl: fn2 })` registers both; returns `this`
        - `has('MyCtrl')` returns `true` after registration; `false` before / for unregistered name
        - Last-wins: register `'X' → fnA` then `'X' → fnB` — `$$registry.get('X') === fnB`
        - Out-of-phase: `getPhase()` returns `'run'` → `register(...)` throws `ControllerRegistrationOutOfPhaseError`; assert `err.name`, `err.message`, `instanceof Error`
        - Invalid name: `register('', fn)` / `register('a b', fn)` / `register(null, fn)` / `register('hasOwnProperty', fn)` → `InvalidControllerNameError`
        - Invalid factory: `register('X', null)` / `register('X', 42)` / `register('X', [])` / `register('X', ['$scope'])` (array without trailing fn) → `InvalidControllerFactoryError`. **[Agent: vitest-testing]**
  - [ ] Create `src/controller/__tests__/controller-di.test.ts` covering end-to-end via real `createInjector(['ng', customModule])`:
        - `injector.has('$controller') === true` and `injector.has('$controllerProvider') === true` (config-phase reachable)
        - `injector.get('$controller')` returns a function
        - `module.config(['$controllerProvider', $cp => $cp.register('Greeter', ['$scope', $s => { $s.greeting = 'hi' }])])` followed by `$controller('Greeter', { $scope })` works
        - Captured `$controllerProvider` reference called inside `run()` throws `ControllerRegistrationOutOfPhaseError` (reference-safety regression)
        - `$controller('NotRegistered', {})` throws `UnknownControllerError` directly to caller (no `$exceptionHandler` interception per FS §2.5 acceptance #5)
        - Decorator pattern works: `module.decorator('$controllerProvider', ['$delegate', $d => $d])` keeps registration semantics intact (sanity check)
        - Update `src/__tests__/cross-spec-smoke.test.ts` (if it exists, otherwise skip this bullet) with `injector.has('$controller') === true`. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. New public observable: `injector.has('$controller') === true`. All prior tests pass unchanged. Compiler integration NOT yet active — directives that declare `controller` are still ignored at link time (Slice 4 wires that). **[Agent: rollup-build]**

- [ ] **Slice 4: `$compile` Per-Element Controller Seam + Registration-Phase `controllerAs` Validation**
  - [ ] Extend `normalizeDirective` in `src/compiler/compile-provider.ts` per technical-considerations §2.7. Insert a `normalizeController` block AFTER the existing `normalizeTransclude` / template normalization and BEFORE the priority assignment. Validate:
        1. **`controllerAs` without `controller`:** `ddo.controllerAs != null && ddo.controller == null` → throw `ControllerAsWithoutControllerError(name)`. Caught by the existing factory try/catch in `$$buildDirectiveArrayProvider` and routed via `$exceptionHandler('$compile')`.
        2. **`controllerAs` shape:** when present, must be a non-empty string matching `IDENT_RE` (re-export `IDENT_RE` from `@controller/controller.ts` for this validation; do NOT duplicate the regex). Throw `MalformedControllerAliasError(received)` on fail.
        3. **`controller` shape:** when present, must be a string, function, or non-empty array (last element must be a function). Otherwise throw `InvalidControllerFactoryError(directiveName, describeValue(controller))`. Reuse the `describeValue` helper from spec 018's `normalizeDirective` extension. **[Agent: typescript-framework]**
  - [ ] Widen `DirectiveDefinition` in `src/compiler/directive-types.ts` to accept `controller?: string | ControllerInvokable` and `controllerAs?: string`. TSDoc on each — `controllerAs` cites `ControllerAsWithoutControllerError`; `controller` cites the per-element instantiation contract + `'$compile'` exception cause. Re-export `ControllerInvokable` from `directive-types.ts` so the existing single-import surface is preserved. **[Agent: typescript-framework]**
  - [ ] Modify `$CompileProvider.$get` deps in `src/compiler/compile-provider.ts` per technical-considerations §2.7 — current `['$provide', ...]` becomes `['$provide', '$controller', ...]`; the linker holds the resolved `$controller` reference in its closure. **[Agent: typescript-framework]**
  - [ ] Modify the per-element linker in `src/compiler/compile.ts` per technical-considerations §2.7. **Insertion point:** between line 637 (end of `$transclude` build / `setElementScope` at line 645) and line 680 (start of pre-link loop), AFTER `bindAttrsToScope` at line 679. For each `directive` in `effectiveDirectives` where `directive.controller != null`:
        1. Build `locals: ControllerLocals = { $scope: scope, $element: target as Element, $attrs: attrs, $transclude }` (`$transclude` may be `undefined`).
        2. Wrap in `try { $controller(directive.controller, locals, directive.controllerAs); } catch (err) { invokeExceptionHandler(exceptionHandler, err, '$compile'); }`.
        3. Discard the returned instance — no `controllerMap` is built (would land with `require:` in a future spec).
        4. Continue to the next directive on throw (matches the linker's existing per-directive isolation pattern at lines 684-688). **[Agent: typescript-framework]**
  - [ ] Create `src/controller/__tests__/controller-compile.test.ts` covering FS §2.4 + cross-cutting integration (uses real `createInjector(['ng', module])` + real `$compile` + jsdom `Element`):
        - Directive with `controller: 'MyCtrl'` (registered via `$controllerProvider`) instantiates exactly once per matched element; assert via spy on the constructor
        - Directive with `controller: function ($scope, $element, $attrs) {}` receives all three values — `$element` is the matched DOM node, `$attrs` is the `Attributes` instance, `$scope` is the linked scope (or child scope when `scope: true`)
        - **Ordering:** controller runs BEFORE the directive's own pre-link AND BEFORE any other directive's pre-link on the same element. Assert via shared spy ordering across `controller`, `pre`, `post`, child compile callbacks
        - `controllerAs: 'vm'` exposes the new instance on the controller's scope under `vm`; when `scope: true`, the alias lands on the child scope
        - Two directives on the same element each declaring `controller` → both controllers run independently; neither sees the other's instance (no cross-injection in this slice)
        - Directive declaring `controllerAs` without `controller` is REJECTED at registration time (`directive(name, factory)` call) — assert via `$exceptionHandler` spy that `ControllerAsWithoutControllerError` routes via `'$compile'` cause
        - Throwing controller routes via `$exceptionHandler('$compile')`; the surrounding pre-link / post-link on the SAME element still runs; sibling elements' compile/link unaffected
        - `controller: '<UnregisteredName>'` → at link time, `UnknownControllerError` routes via `$exceptionHandler('$compile')` (compiler-invoked path differs from direct-call path)
        - Transclude-host directive with a `controller` field: the controller's `locals.$transclude` is a callable function; calling it produces a clone (smoke test that the existing transclude wiring is untouched)
        - Inline `controller: function` with `controllerAs: 'vm'` works — alias from the DDO field, not from a string suffix
        - Constructor returning an object: `$scope.vm` becomes the returned object (not the prototype instance)
        - Multi-element directive (the same directive matching 3 sibling elements via class restrict) instantiates 3 distinct controller instances
        - Existing spec-017/018/019 directive tests still pass — directives without `controller`/`controllerAs` remain unaffected. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. `EXCEPTION_HANDLER_CAUSES.length === 10` regression holds (no new cause token). Spec-017/018/019 directive tests pass unchanged — controller integration is additive. **[Agent: rollup-build]**

- [ ] **Slice 5: Documentation, AngularJS Parity Port, Final Regression Check**
  - [ ] Create `src/controller/README.md` per technical-considerations §2.1. Cover:
        - The dual surface: `createController` ESM-first vs. `$controller` DI-shim, with a worked example for each
        - The `'Name as alias'` parser + the `ident` argument precedence
        - The `Object.create(prototype)` + invoke + return-value-replacement instantiation pattern, with an ES-class footnote (classes throw if invoked without `new` — wrap in a factory function)
        - Last-wins on duplicate `register(name, ...)` (contrast with directives' accumulation)
        - The `$compile` integration: `controller` runs before pre-link, receives `$scope/$element/$attrs/$transclude`; `controllerAs` exposes the instance on scope; `controllerAs` without `controller` is rejected at registration
        - Direct-call vs. compile-time exception asymmetry (FS §2.5 acceptance #4 vs. #5) — direct callers own their try/catch
        - Intentionally-deferred items: `require:`, `$onInit` / `$onChanges` / `$onDestroy`, `bindToController`, `allowGlobals`, `.controller(name, fn)` module DSL — each linked to its roadmap spec where relevant
        - The `'hasOwnProperty'` registration block + the `controllerAs: 'vm'` silent-overwrite footgun. **[Agent: typedoc-docs]**
  - [ ] Update `CLAUDE.md` per technical-considerations §2.10:
        - Add `./controller` row to the "Modules (public surface via `package.json` exports)" table with key exports
        - Add the new "Non-obvious invariants" bullet covering: alias-parser regex + `ident` precedence; `$controllerProvider.register` config-phase + captured-reference safety; `$controller` run-phase only; controller seam runs once per directive declaring `controller`, after `$transclude` setup and before pre-link; `'$compile'` cause reused (no new `EXCEPTION_HANDLER_CAUSES` entry, tuple stays at 10); `controllerAs`-without-`controller` rejected at directive registration; `Object.create(prototype)` + invoke + return-value-replacement pattern; last-wins on duplicate `register`; direct-call path does NOT route exceptions through `$exceptionHandler` (asymmetry with compile-time path)
        - Add the new "Where to look when…" row: *How does `$controller` find a registered controller? → `src/controller/controller-provider.ts` ($$registry Map) + `src/controller/controller.ts` (parse + lookup + instantiate)*. **[Agent: typedoc-docs]**
  - [ ] TSDoc audit on every new public export — `createController`, `controller` (default binding, if it shipped), `$ControllerProvider`, the four public types, and the six error classes. Each carries at least one runnable example. The `DirectiveDefinition.controller` and `DirectiveDefinition.controllerAs` TSDoc carry the worked `controller` + `controllerAs: 'vm'` example from the README. **[Agent: typedoc-docs]**
  - [ ] Port relevant cases from `angular/angular.js/test/ng/controllerSpec.js` into `src/controller/__tests__/controller-parity.test.ts` per technical-considerations §4 "Reference parity":
        - The `'as'` syntax test cases (registered name + inline function + explicit `ident`)
        - The `register(map)` object-form variant
        - The locals-override test (controller asks for a service, locals provide a substitute)
        - The "controller returns object" semantic
        - The `$controllerProvider.has(name)` introspection test
        - **Skipped** with documented `it.skip(...)` calls (so future spec audits show what's deferred): `allowGlobals` cases, `require:`-related cases, `bindToController` cases, `$onInit` lifecycle cases. Each `.skip` has a comment naming the deferring roadmap item. **[Agent: vitest-testing]**
  - [ ] Final regression check: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All five gates pass. `dist/{esm,cjs,types}/controller/index.{mjs,cjs,d.ts}` outputs include the public surface. The full prior-spec test suite (002–019) passes unchanged. New observable: `injector.has('$controller') === true`. `EXCEPTION_HANDLER_CAUSES.length === 10` regression holds. **[Agent: rollup-build]**

---

## Notes for the Implementation Agent

- **No new `EXCEPTION_HANDLER_CAUSES` entry.** The `'$compile'` token from spec 017 covers every controller-related error site at link time per FS §2.5. The tuple stays at 10 entries.
- **`require:` / `$onInit` / `$onChanges` / `$onDestroy` / `bindToController` are DEFERRED** — explicit FS §3 out-of-scope items. The current `$controller` signature returns the bare instance; when `require:` lands, the signature gets a 4th `later: boolean` argument that returns `{ instance, identifier }` — additive, no breaking change.
- **`allowGlobals` (window scanning) is PERMANENTLY out** on security grounds. Document but do not implement.
- **`.controller(name, fn)` module DSL is OUT** — separate roadmap item ("Module DSL `.directive` / `.component` / `.controller`"). All registration goes through `$controllerProvider.register(...)` from a config block, consistent with specs 017/018/019.
- **Direct-call vs. compile-time exception asymmetry is intentional.** FS §2.5 acceptance #4 (direct call propagates) vs. #5 (compile-time invocation routes via `$exceptionHandler('$compile')`). Mirrors AngularJS 1.x. Document loudly in README + CLAUDE.md.
- **`$rootScope` is still NOT registered on `ngModule`.** Compile-integration tests construct `Scope.create()` directly (same as specs 017/018/019). Deferred to "Application Bootstrap".
- **No browser tests.** jsdom is sufficient — `Element`, `Object.create`, and the existing `$compile` pipeline all work as expected.
