# Technical Specification: Structural / Flow-Control Directives

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Five directives, but the work is structured around **one prerequisite**: enabling `transclude: 'element'` in the directive definition surface. That capability is currently rejected at registration via `ElementTranscludeNotSupportedError` (deliberate forward-compat throw from spec 018) — three of the five directives (`ng-if`, `ng-switch-when`, `ng-include`) need it to work, and `ng-switch` orchestrates the children that use it.

Once `transclude: 'element'` is enabled, the implementation breaks into independent pieces:

1. **Foundation: `transclude: 'element'` support** — extend the `NormalizedTransclude` discriminant from `'content' | 'slots'` to add `'element'`; widen `transclude-capture.ts` with a host-detach + comment-placeholder branch; keep `buildTranscludeFn` essentially unchanged (its single-element default-bucket path already supports the new shape). Retire `ElementTranscludeNotSupportedError` as `@deprecated` (matches `IsolateScopeNotSupportedError` precedent from spec 022).
2. **Five new directive files** under `src/compiler/`, each registered on `ngModule` following the spec 023/024/025/026 DI-only precedent (not exported from `@compiler/index`).
3. **One surgical widening of `runControllerSeam`** in `compile.ts` so `ng-controller` reuses the existing controller + lifecycle-hook machinery instead of duplicating it.
4. **One lazy `$injector.has('$sce')` probe** inside `ng-include` so trusted-resource-URL gating works when `$sce` is reachable, without making `ng-include` hard-depend on `$sce`.

Cross-cutting facts:

- **`EXCEPTION_HANDLER_CAUSES` stays at 10.** Every error site reuses `'$compile'` (per spec 018's transclude precedent). `ng-include`'s `onload` re-evaluation throws naturally route via `'watchListener'` (also already in the tuple).
- **The "two structural directives on the same element" rule reuses `MultipleTranscludeDirectivesError`.** Once `ng-if` / `ng-switch-when` / `ng-include` all use `transclude: 'element'`, the existing detection at `compile.ts:781-807` covers the case for free — no new error class needed.
- **The `ng-non-bindable` walker-narrowing hook stays untouched.** The "no-descent" hook narrowed in spec 023 was deliberately gated to `directive.name === 'ngNonBindable'`. Structural directives in spec 027 don't need walker narrowing — element-transclusion removes the host from the DOM at compile time, so the walker has no children to descend into.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. Foundation: `transclude: 'element'` support

This is the prerequisite for `ng-if`, `ng-switch-when`, `ng-switch-default`, and `ng-include`. Five modified files, one retired error class.

| File | Change |
| --- | --- |
| `src/compiler/compile-provider.ts:458-494` | In `normalizeTransclude`, delete the `if (transclude === 'element') throw new ElementTranscludeNotSupportedError(…)` branch and replace with a `return { kind: 'element', slots: [], required: [], optional: [] }` (the existing `'slots'`/`'content'` branches return the same shape). Empty slot arrays satisfy the discriminated union without growing the type. |
| `src/compiler/transclude-types.ts:211` | Widen `NormalizedTransclude` from `\| { kind: 'content'; … } \| { kind: 'slots'; … }` to also accept `\| { kind: 'element'; … }`. |
| `src/compiler/transclude-capture.ts:55-117` | Add a third branch in `captureChildren(host, transclude)` that handles `kind: 'element'`: (a) build the comment placeholder via `document.createComment(\`${directiveName}: ${attrValue}\`)` (the upstream AngularJS naming convention — useful in dev tools); (b) `host.parentNode.insertBefore(placeholder, host)`; (c) `host.parentNode.removeChild(host)`; (d) return the captured master with `defaultBucket: [host]` (single-element bucket — the existing default-bucket linker handles this shape). The `directiveName` and `attrValue` come from the matched directive metadata + `attrs[normalizedName]`. |
| `src/compiler/compile.ts:781-830` | The transclusion pre-pass needs to know that element-form transclusion replaces the host with a comment, so the per-element linker that follows must close over the **placeholder**, not the original host. Practically: after `captureChildren(...)`, if the result was `kind: 'element'`, the local `node` variable used by the per-element linker is rebound to the returned placeholder. The placeholder is what `$$ngBoundTransclude`, `$$ngCleanupQueue`, and the rest of the per-element machinery hang off. |
| `src/compiler/compile-error.ts:161-182` | Mark `ElementTranscludeNotSupportedError` with `@deprecated`. Keep the class exported so a consumer catching it via `instanceof` keeps compiling for one release. Same grace-period treatment as `IsolateScopeNotSupportedError`. |
| `src/compiler/index.ts:4` and `src/index.ts:73` | Inline `eslint-disable @typescript-eslint/no-deprecated -- one-release grace period for spec 027` justifications on the two re-export sites. |
| `src/compiler/__tests__/transclude-registration.test.ts:246-281` | The "explicit forward-compat rejection" suite is **inverted** — same shape, but asserts the directive now registers successfully and the rejection no longer fires. The `@deprecated` class itself is still tested for shape (so the deprecation grace period works). |

**Cleanup wiring for the placeholder.** A Comment node has no `children` HTMLCollection, so `destroyElementScope(placeholder)` cannot walk into a cloned subtree to tear it down. Each `$transclude(...)` invocation in spec 027's directives registers `addElementCleanup(placeholder, () => destroyElementScope(currentClonedRoot))` so a parent `destroyElementScope` reaching the placeholder still tears the active clone down. This is documented as a directive author's responsibility (`ng-if`, `ng-switch`'s children, and `ng-include` all do this).

### 2.2. `src/compiler/ng-if.ts` — conditional rendering

New file. Directive metadata:

```
restrict: 'A'
priority: 600
terminal: true
transclude: 'element'
```

Factory shape: zero-dep — `[() => ({ … })]` (array-form to satisfy strict `annotate`). The `link` fn signature: `(scope, element, attrs, _ctrls, $transclude)` where `element` is the `Comment` placeholder.

**Link-time wiring:**

1. Closed-over state: `let clonedRoot: Element | null = null; let cloneScope: Scope | null = null`.
2. `scope.$watch(attrs.ngIf, (newValue) => { … })`:
   - **Truthy & previous clone is null:** call `$transclude((clone, transcludedScope) => { clonedRoot = clone[0] ?? null; cloneScope = transcludedScope; element.parentNode!.insertBefore(clone[0]!, element.nextSibling); addElementCleanup(element, () => clonedRoot && destroyElementScope(clonedRoot)); })`. The clone is inserted **after** the placeholder so the host position in the parent's `childNodes` is preserved.
   - **Falsy & previous clone exists:** `destroyElementScope(clonedRoot!)`; `clonedRoot.remove()`; `clonedRoot = null; cloneScope = null`.
   - **Truthy → truthy (no transition):** no-op.

The "fresh remount" semantic falls out for free: each truthy transition creates a fresh transclusion scope and a fresh DOM clone via the deep-clone-and-re-link mechanic that `buildTranscludeFn` already provides (per spec 018).

**Errors:** none new. A throwing `$watch` listener routes via the digest's existing `'watchListener'` cause.

**Why `terminal: true` but no walker narrowing:** the same-element terminal cutoff (in `directive-collector.ts:159-182`) is what stops lower-priority sibling directives from running on the host. The walker-narrowing hook (gated on `ngNonBindable` in `compile.ts:1017`) is **not** needed because the host has already been removed from the DOM at this point — there are no children for the outer walker to descend into.

**File size target:** under 200 LOC including TSDoc.

### 2.3. `src/compiler/ng-switch.ts` — value-driven subtree selection

New file. Contains **three** factory exports — `ngSwitchDirective`, `ngSwitchWhenDirective`, `ngSwitchDefaultDirective` — and one shared controller. Mirrors the AngularJS-canonical implementation: parent directive owns a controller that the children require, children register their transclude with the controller, parent watches the expression and orchestrates transitions.

**`ngSwitchDirective`** — the parent.

```
restrict: 'EA'
priority: 1200
require: 'ngSwitch'
controller: NgSwitchController
```

`NgSwitchController` exposes `cases: Map<string, BoundTranscludeFn[]>` and `selectedTranscludes: BoundTranscludeFn[]`. The parent's link fn `scope.$watch(attrs.ngSwitch, (value) => {…})`:
1. For each `transclude` in `selectedTranscludes`: destroy its scope, remove its clone from the DOM.
2. Look up `cases.get(String(value))`; if missing, look up `cases.get('?')` (the AngularJS-canonical key for default).
3. For each matching `transclude`, call `$transclude((clone, transcludedScope) => …)` and insert the clone where it belongs (the child directive itself anchored it via its own placeholder).
4. Replace `selectedTranscludes` with the newly-active set.

**`ngSwitchWhenDirective`** and **`ngSwitchDefaultDirective`** — the children.

```
restrict: 'EA'
priority: 1200
transclude: 'element'
require: '^ngSwitch'
multiElement: false
```

Each child's link fn receives the parent's `NgSwitchController` via `require`. The child's role at link time is purely to register: `ngSwitchController.cases.set(String(attrs.ngSwitchWhen), [...(existing ?? []), boundTranscludeForThisChild])`. The child does NOT install any clone itself — the parent's `$watch` listener does it on transitions.

For `ngSwitchDefault`, the key is the literal string `'?'` (matching upstream); the directive does not read any attribute value.

**Inert-outside-`ng-switch` behavior** falls out for free: `require: '^ngSwitch'` (no `?`) throws `MissingRequiredControllerError` when an `ng-switch-when` appears without a parent `ng-switch`. The error routes via `$exceptionHandler('$compile')` per the existing seam.

**File size target:** under 280 LOC including TSDoc and the controller class.

### 2.4. `src/compiler/ng-include.ts` — async template inclusion

New file. Single directive `ngIncludeDirective`, but registered twice on `ngModule` — once under name `ngInclude` (attribute form) and once under name… actually no: element forms work *for free* via `restrict: 'ECA'` because `<ng-include src="…">` matches the same directive name normalized from its element-tag form.

```
restrict: 'ECA'
priority: 400
terminal: true
transclude: 'element'
controller: NgIncludeController  // exposes the load lifecycle for tests
```

**DI:** `['$templateRequest', '$compile', '$injector', factory]` — `$templateRequest` is hard-required; `$compile` is needed to compile fetched templates; `$injector` is used for the lazy `$sce` probe.

**Link-time wiring:**

1. The URL source is `attrs.ngInclude` (attribute form) **OR** `attrs.src` (element form). Detect at compile time which one is present (both forms run the same factory; the attribute that holds the expression differs).
2. Closed-over state: `let clonedRoot: Element | null = null; let cloneScope: Scope | null = null; let currentLoadToken: object | null = null`.
3. `scope.$watch(srcExpr, (newSrc) => { … })`:
   - **Empty / nullish:** tear down current clone if any, leave slot empty.
   - **Same as previous & clone exists:** no-op (the `$watch` listener already filters identical-value transitions; this is documented for clarity).
   - **Different / first load:**
     1. Set `currentLoadToken = {}` (sentinel for "is this load still relevant?").
     2. Emit `scope.$emit('$includeContentRequested', resolvedSrc)`.
     3. **Trust gate:** `const trustedSrc = $injector.has('$sce') ? $injector.get('$sce').getTrustedResourceUrl(newSrc) : newSrc`. Cross-origin rejection by `$sce` throws; the throw is caught and routed via `$exceptionHandler('$compile')` AND emits `$includeContentError`; the slot is cleared.
     4. `$templateRequest(trustedSrc).then((html) => { if (currentLoadToken !== thisToken) return; … }, (err) => { invokeExceptionHandler(handler, err, '$compile'); scope.$emit('$includeContentError', resolvedSrc); clearCurrentClone(); })`.
     5. **On success:** clear the previous clone; parse `html` via `parseTemplate(html)` (existing helper from `src/compiler/template-parse.ts`); create a fresh child scope (`scope.$new()`); compile the parsed nodes via the injected `$compile`; link into the new scope; insert the linked subtree after the placeholder; register `addElementCleanup(placeholder, () => destroyElementScope(newRoot))`. Emit `$includeContentLoaded`. Evaluate optional `onload` expression on the parent scope.

**Cleanup:** the load-token sentinel prevents a stale fetch from installing content after the directive has been destroyed or after the URL has changed mid-flight. The `currentLoadToken !== thisToken` check is the gate.

**`onload` modifier:** parse `attrs.onload` once at compile time; evaluate against the **parent** scope after each successful load (matches AngularJS — the `onload` expression sees parent scope, not the included template's scope).

**Event emissions:** `$includeContentRequested`, `$includeContentLoaded`, `$includeContentError` all use `scope.$emit(...)` (bubble up). Matches AngularJS-canonical behavior.

**File size target:** under 280 LOC including TSDoc.

### 2.5. `src/compiler/ng-init.ts` — seed scope variables

New file. Trivial.

```
restrict: 'AC'
priority: 450
```

**Compile-time:** parse `attrs.ngInit` once via `parse()` from `@parser/index`.
**Pre-link:** evaluate the parsed expression against the link-time scope. Assignments land via the parser's runtime (already supports `=` against scope identifiers per spec 009).

No watch, no DOM mutation, no cleanup. The expression's `$onChanges`-style behavior is non-applicable (no isolate bindings).

**`priority: 450`** is the upstream AngularJS value. Below `ng-if`'s 600 and above `ng-include`'s 400 (it's higher than `ng-include` so `<div ng-include ng-init>` initializes BEFORE the include fires). Above the default 0 so `ng-init` runs before regular directives that bind to its assignments.

**File size target:** under 100 LOC including TSDoc.

### 2.6. `src/compiler/ng-controller.ts` — attach a controller

New file. Directive metadata:

```
restrict: 'A'
priority: 500
scope: true  // a fresh child scope per AngularJS convention
```

The directive's **value** is the controller name (optionally with `Name as alias` suffix). The factory:

```
['$controller', factory]
```

…but the actual instantiation does NOT happen in the directive's `link` fn. Instead it happens in the **widened `runControllerSeam`** (next subsection). The directive itself is a sentinel that tells the compile-time pipeline "instantiate a controller whose name comes from `attrs.ngController`."

**Wiring to the seam:** the directive sets a sentinel field on its normalized form — `controller: { __attributeSource: 'ngController' }` — that `runControllerSeam` recognizes as "read the controller name from `attrs` at link time" instead of "the controller IS the factory in `directive.controller`."

**Open implementation decision (deferred to implementation agent):** the cleanest wiring is to introduce a new shape on the `Directive` type's `controller` field — instead of accepting only `ControllerInvokable`, accept `ControllerInvokable | { __attributeSource: string }`. The `runControllerSeam` branches on the shape. This is a minimal surgical widening; the type union prevents the sentinel from leaking into other consumers.

**Lifecycle hooks:** because the seam handles instantiation, all four hooks (`$onInit`, `$postLink`, `$onDestroy`, but NOT `$onChanges` — no isolate bindings) fire on the same timeline that component controllers see (per spec 022). `controllerAs` is published on scope by `$controller`'s internal `bindAlias` path.

**`scope: true` reasoning:** AngularJS creates a fresh child scope on every `ng-controller` element so the controller's instance properties (via `controllerAs`) live in their own namespace. This is independent of any surrounding `transclude: 'element'` — when `<div ng-if="…" ng-controller="MyCtrl">` mounts, the cloned root's element gets a transclusion scope AND `ng-controller` creates a `scope: true` child of that. The double-nesting is canonical (one scope per structural mount, one scope per controller).

**File size target:** under 150 LOC including TSDoc.

### 2.7. Widen `runControllerSeam` in `compile.ts`

Spec 022's `runControllerSeam` (at `compile.ts:427-616`) currently has two branches:
- `useBindToController` → deferred-alias path (`later: true`).
- Otherwise → eager `$controller(directive.controller, locals, directive.controllerAs)`.

**New third branch:** when `directive.controller` is the sentinel shape `{ __attributeSource: 'ngController' }`, read the controller name from `attrs.ngController` at this point and invoke `$controller(attrs.ngController, locals)` (no separate `ident` arg — the alias is parsed from the string by `$controller`'s own `parseControllerName`).

**Decision rationale for "widen vs. duplicate":** the four-hook dispatch (`$onInit` / `$postLink` / `$onDestroy` / `$onChanges`), the `require`-resolution dance, the `$$ngControllers` stash, and the `controllerAs` alias publication all live in `runControllerSeam`. Duplicating them from inside `ng-controller.ts` would mean 80+ lines of subtle ordering replication; widening the seam is ~10 lines and one type union.

**Asymmetry preserved:** `$onChanges` only fires on the `bindToController` instance-target path (spec 022 invariant). `ng-controller` never has isolate bindings, so it lands in the "no `$onChanges`" branch — matches AngularJS.

### 2.8. Module registration in `src/core/ng-module.ts`

Five new `$compileProvider.directive(...)` lines plus two more for the `ng-switch` helpers — alphabetized into the existing block (insertion point: between the spec 023/024/025/026 registrations and the existing transclude registration):

```
$compileProvider.directive(NG_CONTROLLER_NAME, ngControllerDirective);
$compileProvider.directive(NG_IF_NAME, ngIfDirective);
$compileProvider.directive(NG_INCLUDE_NAME, ngIncludeDirective);
$compileProvider.directive(NG_INIT_NAME, ngInitDirective);
$compileProvider.directive(NG_SWITCH_NAME, ngSwitchDirective);
$compileProvider.directive(NG_SWITCH_WHEN_NAME, ngSwitchWhenDirective);
$compileProvider.directive(NG_SWITCH_DEFAULT_NAME, ngSwitchDefaultDirective);
```

Per the spec 023+ DI-only precedent, the factory functions are file-local exports (each directive file exports `ngXxxDirective`), and `@compiler/index.ts` does NOT re-export them. The seven `<name>Directive` providers are still resolvable via `injector.get('ngIfDirective')` (etc.) when an app declares `'ng'` in its deps.

`NG_*_NAME` constants follow the spec 023+ precedent — hoist each into the directive's own file as a module-private `const` (e.g. `const NG_IF_NAME = 'ngIf'`), exported only when shared (here, only `NG_SWITCH_NAME` needs to be sharable so `ngSwitchWhenDirective` can `require: '^ngSwitch'` — but `require` reads strings, so the constants stay file-local).

### 2.9. New error classes

The survey confirmed that **`MultipleTranscludeDirectivesError` already covers the "two structural directives on the same element" case** once all three structural directives use `transclude: 'element'`. The existing detection at `compile.ts:781-807` fires automatically.

The one **possibly-new** error class:
- **`NgSwitchHelperOutsideContextError`** — actually unnecessary too: `require: '^ngSwitch'` without `?` produces `MissingRequiredControllerError` (spec 022) which is the natural surface. No new class needed; just verify the message wording in `MissingRequiredControllerError` reads sensibly for this case ("Required controller 'ngSwitch' not found" reads acceptably).

**Net new error classes for spec 027: zero.** This is unusual for a built-in directive batch, but reflects how much of the precedent from specs 018, 020, 022 is being reused.

### 2.10. Public-API surface changes

- `NormalizedTransclude` widened with `kind: 'element'` discriminant — exported from `@compiler/index.ts` via the existing transclude-types re-export. Consumers writing typed directive factories may need to handle the new discriminant if they pattern-match on `transclude.kind`.
- `ElementTranscludeNotSupportedError` is marked `@deprecated` for a one-release grace period. Removed in a future spec.
- The five built-in directive factories (`ngIfDirective`, `ngSwitchDirective`, `ngSwitchWhenDirective`, `ngSwitchDefaultDirective`, `ngIncludeDirective`, `ngInitDirective`, `ngControllerDirective`) are **NOT** exported from `@compiler/index.ts` (DI-only precedent).
- `EXCEPTION_HANDLER_CAUSES` stays at 10 entries. A `'$compile' satisfies ExceptionHandlerCause` regression assertion lives in the new test files.

### 2.11. Documentation

- File-level TSDoc for each of the five new directive files, explaining the structural-directive contract and how the file relates to `transclude: 'element'`.
- TSDoc on `runControllerSeam`'s new branch explaining the attribute-source shape.
- TSDoc on the widened `NormalizedTransclude` `kind: 'element'` discriminant.
- New "Where to look when…" rows in `CLAUDE.md` for each directive.
- New invariants in `CLAUDE.md` covering:
  - The element-transclusion comment-placeholder contract.
  - The "structural directive falls out for free" rule for `ng-controller` inside `ng-if`.
  - The `MultipleTranscludeDirectivesError` reuse for the "two-structural-on-same-element" rule.
  - The lazy `$sce` probe in `ng-include`.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`$templateRequest` (spec 019):** `ng-include` reads through it for fetch + cache + dedup. No changes to the service itself.
- **`$controller` (spec 020):** `ng-controller` invokes it via the widened `runControllerSeam`. No changes to the service itself.
- **`$compile` (spec 017):** `ng-include` injects `$compile` to compile fetched templates against fresh scopes.
- **`$sce` (spec 011/012):** `ng-include` probes lazily via `$injector.has('$sce')` — no hard dependency. The probe pattern mirrors `$SceProvider.$get`'s lazy `$sanitize` lookup (spec 013).
- **`transclude: true` machinery (spec 018):** `buildTranscludeFn` and `transclude-capture.ts` are widened — minimal mechanical changes, the deep-clone-and-re-link mechanic is unchanged.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Removing the `ElementTranscludeNotSupportedError` rejection at `compile-provider.ts:465-467` could silently change behavior for any consumer who was catching the error and treating it as "structural directives aren't supported." | The class stays exported with `@deprecated` for one release. Inverted registration test confirms the new behavior; a new test confirms the `@deprecated` class still has the documented shape so `instanceof` checks keep compiling. |
| Widening `runControllerSeam` is a central change — bugs here affect `ng-controller` AND every component AND every directive that declares `controller`. | Targeted tests for the new branch (controller-name-from-attrs) plus regression coverage that the existing two branches (`bindToController` and eager) behave identically. Ordering tests for the four-hook firing remain valid. |
| The `ng-include` lazy `$sce` probe could surprise consumers who expect SSR / Node environments without `$sce` to still gate URLs. | Document the probe as a soft optional dep. When `$sce` is absent, `ng-include` accepts any URL — matches the current `templateUrl` no-gate behavior. When `$sce` is present, the gate works automatically. |
| `transclude: 'element'` adds a third discriminant to `NormalizedTransclude` — typed consumers who exhaustively pattern-match on the union now need a third branch. | This is the explicit forward-compat contract spec 018 promised. The type widening is intentional. Tests pass for the existing `'content'` and `'slots'` paths unchanged. |
| Comment-placeholder DOM mutation could conflict with consumer-shipped DOM tools (jQuery selectors, MutationObservers) that don't expect a Comment node where the host element was. | This is the AngularJS-canonical behavior — has been the model for 13+ years. No mitigation needed; documented in the directive TSDoc. |
| The `currentLoadToken` sentinel in `ng-include` is the only mechanism preventing a stale fetch from installing content after destruction. A bug here causes a memory leak (the fetched HTML's compiled subtree never tears down). | Targeted test: trigger a fetch, destroy the directive's surrounding scope before the fetch resolves, verify the resolved-but-stale install never happens. Plus the existing element-cleanup contract: `addElementCleanup(placeholder, …)` registers a teardown that runs on `destroyElementScope`. |
| The `ng-switch` controller approach (children register with parent via `require`) means the children's link runs BEFORE the parent's `$watch` listener fires. A test that does `compile(template); flush;` and immediately reads the rendered subtree must wait for the first digest. | Tests follow the spec-018/spec-019 pattern of running a digest after compile. No new mitigation needed — this is how all watched directives work. |

---

## 4. Testing Strategy

**New test files under `src/compiler/__tests__/`:**

| Test file | Concern |
| --- | --- |
| `transclude-element-foundation.test.ts` | `transclude: 'element'` registration now succeeds; comment placeholder is installed at compile time; placeholder takes the host's position in `parentNode.childNodes`; `ElementTranscludeNotSupportedError` is `@deprecated` but still exported with the documented shape. |
| `ng-if.test.ts` | Truthy renders, falsy removes; fresh scope per truthy transition; previous scope destroyed on falsy transition; position preserved across toggles; `terminal: true` blocks lower-priority same-element directives; `restrict: 'A'` enforced. |
| `ng-switch.test.ts` | `ng-switch` + `ng-switch-when` matches by string equality; `ng-switch-default` fires when no when matches; empty container when no match and no default; multiple `ng-switch-when` with same value all render; helpers without parent throw `MissingRequiredControllerError`; restrict; transitions destroy old, mount new. |
| `ng-include.test.ts` | Attribute form; element form (`<ng-include src>`); URL change swaps content; null/empty clears; `$includeContentRequested` / `$includeContentLoaded` / `$includeContentError` events; cache hit serves synchronously after first load; lazy `$sce` probe (mocked); `onload` modifier runs against parent scope on each load; stale-fetch sentinel prevents post-destroy install. |
| `ng-init.test.ts` | Single expression, multi-statement (semicolon-separated); pre-link timing — bindings inside the subtree see initialized values on first render; runs once per mount; re-runs on `ng-if` retoggle (mount → unmount → mount). |
| `ng-controller.test.ts` | Name lookup; `Name as alias` parsed via `$controller`; `$onInit` / `$postLink` / `$onDestroy` fire on the seam's timeline; `$onChanges` does NOT fire (no isolate bindings); unknown name routes `UnknownControllerError` via `$exceptionHandler('$compile')`; `ng-controller` inside `ng-if` only instantiates while `ng-if` is truthy; instance destroyed when `ng-if` flips false. |
| `structural-integration.test.ts` | Nested combinations: `ng-if > ng-switch > ng-include`; `ng-if > ng-controller > ng-include`; `ng-init > ng-if > {{user.name}}`; two structural directives on same element → `MultipleTranscludeDirectivesError`; `ng-if` retoggle with deep nesting tears down all descendant scopes / cleanup queues. |
| `cross-spec-smoke.test.ts` (extend existing) | `injector.has('ngIfDirective')` / `ngSwitchDirective` / `ngIncludeDirective` / `ngInitDirective` / `ngControllerDirective` all `=== true` when an app declares `'ng'`. Module-DSL override path: `module.decorator('ngIfDirective', …)` works. |
| `exception-handler-causes.test.ts` (extend existing) | `EXCEPTION_HANDLER_CAUSES.length === 10` invariant holds; new structural-directive throws (e.g. `MultipleTranscludeDirectivesError` from same-element conflict) route via `'$compile'`. |

**Tests to retire / invert:**
- `transclude-registration.test.ts:246-281` — the `transclude: 'element'` rejection suite is inverted to assert successful registration.
- `transclude-errors-foundation.test.ts:53-68` — the `ElementTranscludeNotSupportedError` shape test stays (the class is `@deprecated` not removed).

**Reference suite:** parity tests port behavior from `angular/angular.js/test/ng/directive/ngIfSpec.js`, `ngSwitchSpec.js`, `ngIncludeSpec.js`, `ngInitSpec.js`, `ngControllerSpec.js`.

**Coverage target:** 90%+ on each new file. The `coverageThreshold` in `vitest.config.ts` already enforces this globally.
