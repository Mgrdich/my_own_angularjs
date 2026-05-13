<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.

DO:
- Describe data models (table names, key columns, relationships)
- Describe API contracts (endpoints, request/response shapes)
- Reference file paths where code will live
- Note critical configuration requirements

DON'T:
- Include full code implementations
- Write complete schema definitions
- Provide copy-paste config files
-->

# Technical Specification: Controllers and the `$controller` Service

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

A new `src/controller/` subpath introduces two layered surfaces, mirroring the project's `sce` / `sanitize` / `interpolate` / `compiler` layout:

1. **ESM-first primary API** — `createController({ injector, registry })` returns a pure `(nameOrFn, locals?, ident?) => instance` function with no DI dependency of its own. All name parsing, alias resolution, dependency injection, and instantiation logic lives here so it's unit-testable without a full injector.
2. **DI-layer shim** — `$ControllerProvider` is a config-phase provider that owns the name registry. Its `$get` calls `createController({ injector: $injector, registry: this.$$registry })` and returns the run-phase `$controller` function. Registered on `ngModule` as `module.provider('$controller', ['$provide', $ControllerProvider])`.

`$compile` is extended at one well-defined seam in the per-element linker — between the `$transclude` closure build (post spec 018) and the pre-link loop (line `compile.ts:680`) — to invoke `$controller(...)` once per directive that declares a `controller` field, with locals `{ $scope, $element, $attrs, $transclude }`. Controller-thrown errors during this seam route through the existing `'$compile'` cause token via `invokeExceptionHandler`; no new cause token is introduced (`EXCEPTION_HANDLER_CAUSES` stays at 10).

**No `.controller(name, fn)` module DSL ships in this spec** — that's the separate "Module DSL `.directive` / `.component` / `.controller`" roadmap item. This spec ships **only** `$controllerProvider.register(...)` (reachable inside `config([...])` blocks) plus the `$controller` run-phase service plus the `$compile` integration.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 New module layout

| Path | Responsibility |
| --- | --- |
| `src/controller/controller.ts` | `createController(args)` — ESM factory; name parser (`'Name as alias'` → `{ name, ident }`); locals override semantics via `$injector.invoke`; per-call construction (`Object.create(constructor.prototype)` + `apply` + AngularJS-canonical return-value-replacement). |
| `src/controller/controller-provider.ts` | `$ControllerProvider` class with `register(name, fn)`, `register(map)`, `has(name)`, `$get` (depends on `'$injector'`). |
| `src/controller/controller-types.ts` | Public types: `ControllerService`, `ControllerConstructor`, `ControllerInvokable`, `ControllerLocals`, `IControllerProvider`. |
| `src/controller/controller-errors.ts` | The six error classes (see §2.6). |
| `src/controller/index.ts` | Barrel — re-exports `createController`, the provider class, types, error classes. |
| `src/controller/__tests__/controller.test.ts` | Unit tests for `createController` (no injector required — pass a fake). |
| `src/controller/__tests__/controller-provider.test.ts` | Provider-level tests — registration, `has`, config-phase enforcement, last-wins, object-form. |
| `src/controller/__tests__/controller-di.test.ts` | End-to-end via real `createInjector([ngModule, ...])`. |
| `src/controller/__tests__/controller-compile.test.ts` | Integration with `$compile` — directive `controller`/`controllerAs`, multi-controller per element, alias-without-controller error, exception routing. |
| `src/controller/README.md` | Short doc — usage examples, the ESM/DI dual surface, alias parser, intentionally-deferred items (require, lifecycle, bindToController, allowGlobals). |

### 2.2 Path alias & build wiring

| File | Change |
| --- | --- |
| `tsconfig.json` | Add `"@controller/*": ["src/controller/*"]` to `paths`. |
| `vitest.config.ts` | Add the matching alias + `src/controller/**` to coverage `include`. |
| `eslint.config.*` | Add `@controller` to the `no-restricted-imports` allow-list (or extend the existing alias rule). |
| `package.json` `exports` | Add `"./controller": { ... }` subpath with `import` / `require` / `types` keys. |
| `rollup.config.mjs` | Add a build entry mirroring the `compiler` / `template` entries — emits `dist/controller/index.{mjs,cjs,d.ts}`. |
| `src/index.ts` | Re-export the public surface from `@controller/index`. |

### 2.3 `$ControllerProvider` API

Public methods (mirrors `$FilterProvider.register` and the spec-017 `$compileProvider.directive` accumulator pattern, with **last-wins** instead of accumulation):

| Method | Signature | Notes |
| --- | --- | --- |
| `register(name, fn)` | `(name: string, fn: ControllerInvokable) => this` | Validates name + factory synchronously; updates `$$registry.set(name, fn)`. Last-wins. Returns `this` for chaining. |
| `register(map)` | `(map: Record<string, ControllerInvokable>) => this` | Iterates entries, recurses into the string form. |
| `has(name)` | `(name: string) => boolean` | `$$registry.has(name)`. Reachable in both phases. |
| `$get` | `['$injector', ($injector) => createController({ injector: $injector, registry: this.$$registry })]` | Returns the run-phase `$controller` function. |

**Config-phase guard.** Both `register` overloads start with the same shape as `src/di/provide.ts:26-33`:

```ts
if (getPhase() !== 'config') throw new ControllerRegistrationOutOfPhaseError(method);
```

`getPhase()` is a thunk closed over the injector's phase flag — captured-reference safety matches `$provide` (a `$controllerProvider` reference captured in `config()` and called in `run()` still trips the guard).

**Validation.** Synchronous, at registration call time (matches `$compileProvider.directive` lines 154-159):

- `name` must be a non-empty string with no whitespace (regex `/^\S+$/`, identical to `$filterProvider`). Otherwise throws `InvalidControllerNameError`.
- `fn` must be a function or a non-empty array whose last element is a function. Otherwise throws `InvalidControllerFactoryError`.
- The name `'hasOwnProperty'` is rejected (parity with AngularJS's prototype-pollution guard).

### 2.4 `createController` API

```ts
type ControllerLocals = Record<string, unknown> & {
  $scope?: Scope;
  $element?: Element;
  $attrs?: Attributes;
  $transclude?: TranscludeFn;
};

interface CreateControllerArgs {
  injector: Injector;
  registry: ReadonlyMap<string, ControllerInvokable>;
}

type ControllerService = (
  nameOrFn: string | ControllerInvokable,
  locals?: ControllerLocals,
  ident?: string,
) => unknown;

function createController(args: CreateControllerArgs): ControllerService;
```

**Resolution order** for the first argument:

1. If string → call `parseControllerName(str)` (alias parser, see §2.5); look up the bare name in `args.registry`; throw `UnknownControllerError` if missing.
2. If function or array → use directly; alias comes from the explicit `ident` argument only.
3. Otherwise → throw `InvalidControllerFactoryError`.

**Instantiation** uses `$injector.invoke(fn, instance, locals)` against an instance constructed via `Object.create(constructor.prototype)`. The return value follows AngularJS semantics: if the invoke returns an object (truthy non-primitive), that object replaces the prototype-instance; otherwise the prototype-instance is returned. (Matches `$injector.instantiate` semantics in classic AngularJS — implemented inside `createController` rather than adding a method to `Injector` to keep the injector surface narrow.)

**Alias binding.** After construction, if an alias resolved (from suffix or `ident`) AND `locals.$scope` is present, set `locals.$scope[alias] = instance`. If no scope is present, the alias is silently ignored (FS §2.3 acceptance #2). The instance is always returned.

### 2.5 Name & alias parser

Single regex used by both the string-name path and the directive `controllerAs` validation:

| Token | Regex | Notes |
| --- | --- | --- |
| `CONTROLLER_NAME_ALIAS_RE` | `/^(\S+?)(\s+as\s+([\w$]+))?\s*$/` | Group 1 = name, group 3 = alias (optional). Must match the whole trimmed string. |
| `IDENT_RE` | `/^[\w$][\w$\d]*$/` | Used to validate `controllerAs` and the explicit `ident` argument. |

Failure to match (empty alias after `as`, alias that isn't a valid identifier, leading whitespace before `as`, etc.) throws `MalformedControllerAliasError` with the offending input quoted in the message. Lives in `controller.ts` next to `createController`; not a separate file.

### 2.6 Error classes

All extend `Error`, all carry a `name` property, all live in `src/controller/controller-errors.ts`, all are re-exported from `@controller/index`.

| Class | Thrown when | Routed via |
| --- | --- | --- |
| `ControllerRegistrationOutOfPhaseError` | `$controllerProvider.register(...)` called outside config phase. | Direct throw — programming error, parity with `$provide`. |
| `InvalidControllerNameError` | Name is empty, non-string, or contains whitespace. | Direct throw at registration. |
| `InvalidControllerFactoryError` | Factory is not a function or non-empty array. | Direct throw at registration; also direct throw from `$controller(badInput, ...)`. |
| `UnknownControllerError` | `$controller('NotRegistered', ...)` lookup miss. | Direct throw to the caller. When the lookup happens inside `$compile`'s seam, the seam's `try/catch` routes through `$exceptionHandler('$compile')`. |
| `MalformedControllerAliasError` | Alias suffix or `controllerAs` value fails `IDENT_RE`. | Direct throw at parse site. |
| `ControllerAsWithoutControllerError` | Directive declares `controllerAs` without a `controller`. | Direct throw at directive **registration** time (in the existing `$compileProvider.directive` factory try/catch — already routed via `'$compile'`). |

### 2.7 `$compile` integration (the link-loop seam)

**File:** `src/compiler/compile.ts`. **Insertion point:** between line 637 (end of the `$transclude` build) and line 680 (start of the pre-link loop), after `bindAttrsToScope` but before pre-link execution.

**Resolution flow per element** (executed once per directive that declares a `controller`):

1. Read `directive.controller` and `directive.controllerAs` from each entry in `effectiveDirectives` (the same array the link loop walks).
2. Build a per-element locals map: `{ $scope: scope, $element: target, $attrs: attrs, $transclude }` (the `$transclude` may be `undefined` when the host doesn't transclude — passed through as-is, matching AngularJS).
3. Call `$controller(directive.controller, locals, directive.controllerAs)`. Wrap in `try/catch`; on throw, route via `invokeExceptionHandler(exceptionHandler, err, '$compile')` and continue to the next directive (matches the linker's existing per-directive isolation pattern at lines 684-688 / 700-705).
4. Two directives on the same element with `controller` fields each get their own independent invocation; controllers do not see one another in this slice (FS §2.4 acceptance #5). The result is discarded — no `controllerMap` is built (would land with `require:`).

**Validation moved to registration time.** The `controllerAs`-without-`controller` check fires inside `$compileProvider.directive`'s factory normalization, alongside the existing `IsolateScopeNotSupportedError` check (`compile-provider.ts:19-22`). This makes it a fast, deterministic failure.

**`$compile` provider deps.** The `$CompileProvider` class is currently registered as `['$provide', $CompileProvider]`. Add `'$controller'` to the `$get` deps so the linker holds a reference to the run-phase service: `['$provide', '$controller', ($provide, $controller) => ...]`. (No new circular-dep risk — `$controller`'s `$get` only depends on `$injector`.)

### 2.8 `ngModule` registration

`src/core/ng-module.ts` gains one new `.provider('$controller', ['$provide', $ControllerProvider])` entry, slotted before `$compile` so the dep graph resolves. The existing `declare module '@di/di-types'` block extends with `$controller: ControllerService` in the `registry` half and `$controllerProvider: $ControllerProvider` in the `config` half.

### 2.9 Public surface (root barrel additions)

Re-exported from `src/index.ts`:

- `createController`, `controller` (the default-injector binding — follow the `interpolate` pattern of exporting a default named binding alongside the factory).
- `$ControllerProvider` (class).
- All six error classes.
- Types: `ControllerService`, `ControllerInvokable`, `ControllerLocals`, `IControllerProvider`.

`$ControllerProvider` is **not** exported from the root barrel directly — only from `@controller/index` — matching the `$SanitizeProvider` precedent (DI-only providers stay out of the root barrel to keep the public ESM surface clean).

### 2.10 CLAUDE.md updates

A new "Non-obvious invariants" bullet documenting:

- `controller as alias` parser regex and the `ident` argument precedence.
- `$controllerProvider.register` is config-phase only; `$controller` is run-phase only — same enforcement timing as `$provide`.
- The `controller` seam runs **once per directive declaring `controller`, after `$transclude` setup, before pre-link** — and exception routing reuses `'$compile'` (no new cause token).
- `controllerAs`-without-`controller` is rejected at directive **registration**, not link.
- The `Object.create(prototype)` + invoke + return-value-replacement instantiation pattern (so consumers who return a different object from a constructor get the AngularJS-canonical behavior).
- Last-wins on duplicate `register(name, ...)` (matches services / filters; contrasts with directives' accumulation).

A new "Where to look when…" entry: *How does `$controller` find a registered controller? → `src/controller/controller-provider.ts` (`$$registry` Map) + `src/controller/controller.ts` (parse + lookup + instantiate).*

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`@di` (`createInjector`, `$injector.invoke`, `$injector.has`)** — relied on for dependency resolution, locals override, and the run-phase phase-flag. No changes.
- **`@compiler/compile.ts`, `@compiler/compile-provider.ts`** — modified to wire the per-element controller invocation seam and the `controllerAs`-without-`controller` registration check. Existing transclude / template install / pre-link / post-link sequencing is preserved exactly — the controller seam slots between `bindAttrsToScope` and the first pre-link iteration.
- **`@exception-handler`** — no changes; the existing `'$compile'` cause token is reused. `EXCEPTION_HANDLER_CAUSES` stays at 10. (Documented as such in the functional spec FS §2.5.)
- **`@core/ng-module.ts`** — one new `.provider(...)` line plus type-augmentation entries.
- **None of `@parser` / `@interpolate` / `@sce` / `@sanitize` / `@filter` / `@template`** — no edits.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| **`$compile`-`$controller` provider dependency cycle.** Adding `'$controller'` to `$compile`'s `$get` deps could deadlock if `$controller` ever depended on `$compile`. | `$ControllerProvider.$get` declares only `'$injector'` as a dep — no transitive path back to `$compile`. A unit test in `controller-di.test.ts` builds a fresh injector with both providers and asserts both resolve. |
| **Controller throws during compile crash the digest / break the page.** The link loop today logs-and-continues on per-directive throws; the same contract must hold for controller throws. | Reuse the existing `try { ... } catch (err) { invokeExceptionHandler(exceptionHandler, err, '$compile'); }` pattern at the seam. Test asserts that a throwing controller on element A still allows element B's controller to run. |
| **Direct `$controller(...)` call inside a digest throws and no one catches it.** FS §2.5 acceptance: direct calls do NOT route through `$exceptionHandler` — they propagate. This is asymmetric with the compile-time path and could surprise consumers. | Document the asymmetry in `src/controller/README.md` and CLAUDE.md; mirror AngularJS 1.x semantics exactly so users with prior AngularJS experience get the expected behavior. The asymmetry is *intentional* — direct callers own the call site and can wrap as needed. |
| **`Object.create(prototype) + invoke + return-replacement` semantics drift from JS `new`.** Specifically, ES classes throw if invoked without `new`. | Document that ES-class controllers must be wrapped (`['$scope', class extends Foo { ... }]` works because `invoke.apply` invokes the class as a function — which throws). Acceptance test asserts the documented behavior with both an ES-class and a plain-function controller; ES-class throw is reported as an `InvalidControllerFactoryError`-adjacent failure (or simply propagates the native `TypeError` — pick the cleaner of the two during implementation, document the choice in the test). |
| **`hasOwnProperty` and other prototype-pollution-prone names.** | Reject `'hasOwnProperty'` at registration with a dedicated `InvalidControllerNameError` message. Use `Map` for the registry (no prototype). |
| **Controller-as alias collides with existing scope property.** A directive's `controllerAs: 'vm'` overwrites `$scope.vm` if it exists. | Match AngularJS — silent overwrite. Documented as a known footgun in the README; the linker test asserts the overwrite happens deterministically. |
| **Coverage drop.** Adding ~6 new source files with a 90% line-coverage gate. | New module is small (estimated ~250 LoC across `controller.ts` + `controller-provider.ts` + `controller-errors.ts`); the dedicated test files in §2.1 give per-file coverage well above 90%. CI's existing threshold catches any regression. |
| **`require:` future spec needs the `later` deferred-instantiation flag.** Returning the bare instance now means `require:` will need a separate seam later. | Acceptable. The functional spec explicitly defers `require:`. When that spec lands, the `$controller` signature gets a 4th `later: boolean` argument that returns a `{ instance, identifier }` deferred object — additive to the public API, no breaking change. |

---

## 4. Testing Strategy

**Framework:** Vitest with jsdom (existing project setup). Tests under `src/controller/__tests__/*.test.ts`.

**Coverage target:** 90%+ on `src/controller/` per the project gate (`vitest.config.ts`). Achieved through the per-file split below.

### Test files

| File | Scope | Key assertions |
| --- | --- | --- |
| `controller.test.ts` | Pure `createController` against a fake injector + fake registry. | Name parser correctness (every alias variant + every malformed input); locals override semantics; `$scope[alias]` binding when alias present; silent skip when alias present + scope absent; instance return when constructor returns an object vs. undefined; `UnknownControllerError` shape; `InvalidControllerFactoryError` shape. |
| `controller-provider.test.ts` | `$ControllerProvider` standalone. | Validation throws at registration; `has(name)` returns the right boolean; object-form registration; last-wins; chainable `this` return; config-phase guard via a fake phase thunk. |
| `controller-di.test.ts` | End-to-end via `createInjector([ngModule, customModule])`. | `injector.get('$controller')` resolves; `module.config(['$controllerProvider', $cp => $cp.register(...)])` works; `register` after run phase throws `ControllerRegistrationOutOfPhaseError`; the `$controllerProvider` reference captured in config and called in run trips the guard. |
| `controller-compile.test.ts` | `$compile` integration. | Directive with `controller: 'Name'` instantiates once per match; inline `controller: fn` receives `$scope/$element/$attrs/$transclude`; controller runs before pre-link (assertion via shared spy ordering); `controllerAs` exposes instance on scope; multiple directives on one element each get their own controller; `controllerAs` without `controller` is rejected at `directive(...)` registration; throwing controller routes via `$exceptionHandler('$compile')` and the surrounding link continues; transclude-host directive's controller receives a callable `$transclude`. |

### Reference parity

Port relevant cases from `angular/angular.js/test/ng/controllerSpec.js`:

- The `'as'` syntax test cases (registered name + inline function + explicit `ident`).
- The `register(map)` object-form variant.
- The locals-override test (controller asks for a service, locals provide a substitute).
- The "controller returns object" semantic.
- The `$controllerProvider.has` introspection test.

**Skipped** from the upstream suite (deferred): `allowGlobals`, `require:`-related tests, `bindToController`, `$onInit` lifecycle.

### Manual / smoke

None — this is a pure-library DOM-less change at the API level. The compile-integration tests run in jsdom and exercise the actual `$compile` pipeline end-to-end with real `Element` nodes.
