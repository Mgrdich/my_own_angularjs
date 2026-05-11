# Technical Specification: Transclusion — Content + Multi-Slot

- **Functional Specification:** [`functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Spec 018 extends the spec-017 DOM compiler with the AngularJS-canonical transclusion model. Implementation is **purely additive** inside the existing `src/compiler/` module — no new top-level subpath, no new `EXCEPTION_HANDLER_CAUSES` token, no breaking changes to spec-017 callers.

Three integration seams in the current compiler do all of the heavy lifting:

1. **Capture pipeline at the matched-directive compile loop.** The compile loop in `src/compiler/compile.ts:129-160` runs each directive's `compile(node, attrs)` in priority order BEFORE the walker recurses into children at `src/compiler/compile.ts:171-182`. The first directive on a node whose normalized DDO declares `transclude: true | { … }` (a) detaches the directive element's child nodes into a private fragment, (b) routes them into named slots or the default bucket, and (c) feeds each bucket to the existing recursive `CompileService` to produce a single shared `Linker` per slot. The walker's child-recursion at `:171-182` then sees an empty element and produces a no-op `childLinker` for it — exactly the "children leave before they get linked" behaviour FS §2.2 requires.

2. **`$transclude` closure built per linked element, captured against the OUTER scope.** The `nodeLinker(parentScope)` closure at `src/compiler/compile.ts:190-205` still has the OUTER scope in hand BEFORE the `scope: true` `$new()` call at `:205`. The transclusion `$transclude` function is built inside that closure, capturing `parentScope` so every clone's transclusion scope is `parentScope.$new()` — never `scope.$new()`. This is the AngularJS-canonical rule that lets `<my-dir scope="true">` keep its own namespace while consumer markup binds to consumer variables.

3. **Element-stash via DOM ancestry for `ng-transclude`.** The bound `$transclude` is written onto the directive's host element as a non-enumerable `$$ngBoundTransclude` slot. The new `ng-transclude` directive walks `element.parentElement` chains at link time to find the nearest ancestor carrying `$$ngBoundTransclude`, then calls it. This mirrors the existing `$$ngScope` / `$$ngCleanupQueue` private-property pattern (`src/compiler/cleanup.ts:69-76`) and decouples the marker from the walker — `ng-transclude` works whether the author placed it in the directive's pre-existing markup, inserted it programmatically in a link function, or (later) authored it inside a `template` string.

Cross-cutting integrations:

- **Captured children compile EXACTLY ONCE.** At capture, each slot bucket is fed to the existing top-level `CompileService` (which already accepts `Node[]` / `NodeList` at `src/compiler/compile.ts:269-291`) to produce a shared `slotLinker: Linker`. Each `$transclude(...)` call deep-clones the captured master via `Node.cloneNode(true)`, then re-invokes `slotLinker(transclusionScope, clone)` — no re-compile. The master nodes themselves are never inserted into the DOM.
- **`$exceptionHandler` reuses the spec-017 `'$compile'` cause token.** No new entry in `EXCEPTION_HANDLER_CAUSES`. All error sites in this spec route via `invokeExceptionHandler(handler, err, '$compile')`, mirroring the existing pattern at `src/compiler/compile.ts:141-148, :236-241, :259-264` and `src/compiler/compile-provider.ts:200-208`.
- **Cleanup parity.** Each clone's transclusion scope is pushed onto the host element's `$$ngCleanupQueue` (`src/compiler/cleanup.ts`) as a `() => scope.$destroy()` entry. `destroyElementScope(hostEl)` already drains this queue before destroying `$$ngScope`, so transclusion tear-down rides on spec-017 plumbing with zero new public surface.
- **`ng-transclude` is the FIRST built-in directive registered on `ngModule`.** `src/core/ng-module.ts:78-102` today registers providers and filters but no directives — `.directive('ngTransclude', ngTranscludeFactory)` lands after the filter chain.

The `LinkFn` / `CompileFn` public types gain an optional trailing parameter (`$transclude`) and a stable placeholder slot for `controllers` (deferred). TypeScript function-parameter subtyping means existing 3-arg link callers remain type-compatible without source changes.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. Module Layout

New files under `src/compiler/`:

| File | Responsibility |
| --- | --- |
| `transclude-capture.ts` | Pure-function "split the directive element's children into slot buckets" engine. Given the host element + the normalized `transclude` declaration, returns `{ defaultBucket: Node[]; slotBuckets: Record<string, Node[]>; unfilledRequired: string[]; unfilledOptional: string[] }`. Detaches children from the live DOM as a side effect. Pure DOM walk; no scope, no injector. |
| `transclude-compile.ts` | Takes the bucket map from `transclude-capture.ts` plus the `CompileService` and returns `{ defaultLinker: Linker \| null; slotLinkers: Record<string, Linker \| null>; declaredSlots: TranscludeSlotMap }`. Each bucket is compiled exactly once via the existing `CompileService` entry. Empty buckets yield `null` (no master to clone). |
| `transclude-fn.ts` | Builds the per-element `$transclude` closure. Inputs: the compiled slot-linker map, the OUTER `parentScope`, the host element, the exception handler. Output: the `TranscludeFn` function exposed as the 5th link / 3rd compile argument. Handles per-call deep-clone, transclusion scope creation, cleanup-queue registration, and `cloneAttachFn` invocation with `'$compile'`-routed error catch. |
| `ng-transclude.ts` | The built-in `ngTransclude` directive factory. Exports `ngTranscludeDirective` (the array form ready for `$compileProvider.directive`) and the slot-resolution helper that walks `element.parentElement` until finding `$$ngBoundTransclude`. Restrict `'EA'`, priority 0. |
| `transclude-types.ts` | Public TS types: `TranscludeFn`, `CloneAttachFn`, `TranscludeSlotName`, `TranscludeSlotMap` (the normalized internal form: `{ name: string; selector: string; required: boolean }[]`), `BoundTranscludeFn` (the `$$ngBoundTransclude` shape). |

Modified files:

| File | Change |
| --- | --- |
| `src/compiler/compile.ts` | (a) Detect transclusion-declaring directive in the matched list at `:129-160`; (b) intercept BEFORE `directive.compile(...)` invocation to run capture + compile pipeline; (c) stash `$$ngBoundTransclude` on the host element; (d) thread the built `$transclude` closure into pre-link (`:236-241`), post-link (`:259-264`), and `directive.compile(...)` (`:142`) call sites; (e) document the "second `transclude`-declaring directive on same element" error site. |
| `src/compiler/compile-provider.ts` | Extend `normalizeDirective` at `:265-310` to (a) validate the `transclude` field shape, (b) normalize `transclude: true | object` into the internal `TranscludeSlotMap` form (or `{ kind: 'content' }` for `true`), (c) reject `transclude: 'element'` and other invalid values via new error classes in `compile-error.ts`. Mirrors the existing `IsolateScopeNotSupportedError` throw site at `:276`. |
| `src/compiler/compile-error.ts` | Add new error classes following the existing pattern at `:29-80`: `InvalidTranscludeValueError`, `ElementTranscludeNotSupportedError`, `DuplicateTranscludeSelectorError`, `InvalidTranscludeSlotNameError`, `InvalidTranscludeSelectorError`, `MultipleTranscludeDirectivesError` (link-time), `RequiredTranscludeSlotUnfilledError` (link-time), `UndeclaredTranscludeSlotError` (link-time, both from `$transclude` and from `ng-transclude`), `NgTranscludeMisuseError` (no enclosing transclude / disallowed named slot under `transclude: true`). |
| `src/compiler/cleanup.ts` | Add helper `pushElementCleanup(element, cb)` exported alongside `setElementScope` / `getElementScope` at `:69-76`, used by `transclude-fn.ts` to push `() => scope.$destroy()` for every clone's transclusion scope. Implementation-wise this is a one-liner over `$$ngCleanupQueue`; centralized for type-safety + symmetry. |
| `src/compiler/directive-types.ts` | Widen `LinkFn` (`:77`) and `CompileFn` (`:86-90`) to accept the optional trailing arguments. Re-export the new public types from `transclude-types.ts` through the existing barrel pattern. |
| `src/compiler/index.ts` | Re-export `TranscludeFn`, `CloneAttachFn`, `TranscludeSlotName`, `TranscludeSlotMap` and the new error classes. The `ngTransclude` factory is internal — not re-exported, only consumed by `ng-module.ts`. |
| `src/core/ng-module.ts` | After the filter-chain block at `:78-102`, register the new directive: `.directive('ngTransclude', ngTranscludeDirective)`. This is the FIRST `.directive(...)` call on `ngModule`. |
| `src/index.ts` | Re-export the new public types added in `src/compiler/index.ts`. |

Tests under `src/compiler/__tests__/`:

| Test file | Concern (mirrors FS §2.10) |
| --- | --- |
| `transclude-true.test.ts` | Content transclusion — capture happens at compile, children removed from live DOM, captured order/whitespace/comments preserved, void-element + empty-element + comment-child cases, captured children NOT linked against directive element, captured fragment compiled exactly once. |
| `transclude-multi-slot.test.ts` | Tag-name routing, kebab/camel name normalization, `?` optional prefix parsing, default-slot bucket for unmatched children, whitespace + comments + loose text → default slot, duplicate-selector rejection, invalid-key + invalid-selector rejection at registration. |
| `transclude-scope.test.ts` | `$transclude(...)`-produced scope has `outer` as `$parent`; directive's `scope: true` child is NEVER in the prototype chain of the transclusion scope; prototypal writes shadow vs. inherit; per-clone scope independence. |
| `transclude-multi-clone.test.ts` | Two sequential `$transclude(...)` calls produce independent clones with independent scopes; master fragment never mutated; many-clone (1000+) sanity check. |
| `transclude-cleanup.test.ts` | Each clone's scope is `$destroy()`-ed by `destroyElementScope(host)`; `$destroy()` on the outer scope tears down clones via scope-tree; `cloneAttachFn` throw still registers the scope for cleanup; idempotent re-tear-down is a no-op. |
| `ng-transclude.test.ts` | Default slot, named slot, element-form `<ng-transclude>`, fallback content for unfilled optional slots, fallback compiled against OUTER scope, post-link timing relative to host directive's pre-link, marker's pre-existing children REPLACED on fill, named-slot under `transclude: true` is an error, unenclosed `ng-transclude` is a no-op + error. |
| `transclude-errors.test.ts` | Every error class — registration-time (invalid value, element mode, duplicate selector, invalid slot key, invalid selector) and link-time (multiple transcluding directives, required slot unfilled, undeclared slot via `$transclude` and via `ng-transclude`, `cloneAttachFn` throw routed but clone still returned, custom `$exceptionHandler` that itself throws falls back to `console.error`). |

Existing spec-017 test files run unchanged. The widening of `LinkFn` / `CompileFn` is type-additive — 3-arg / 2-arg callers remain assignable.

### 2.2. Capture Pipeline — Transcluding-Directive Detection (`compile.ts` + `transclude-capture.ts`)

The compile loop at `src/compiler/compile.ts:129-160` iterates the matched-directive array in priority-descending order. Insert a pre-pass over the sorted list (before the per-directive `compile()` invocations begin):

1. **Find the transclusion-declaring directive.** Scan the sorted list for entries whose normalized DDO has `transclude` set (`{ kind: 'content' } | { kind: 'slots'; slots: TranscludeSlotMap }`). Record the first match.
2. **If a SECOND match exists**, route a `MultipleTranscludeDirectivesError` via `invokeExceptionHandler(handler, err, '$compile')` and clear the second match's `transclude` field on the local copy of the entry. Other behavior (link/compile) of the second directive runs unchanged. This is the FS §2.1 "first declaration wins" rule.
3. **If exactly one match exists**, invoke `captureChildren(node, normalizedTransclude)` from `transclude-capture.ts` which:
   - For `{ kind: 'content' }`: detach all `node.childNodes` into a private `Node[]` array. Order preserved. Element children, text nodes, and comments all captured.
   - For `{ kind: 'slots' }`: iterate `node.childNodes` once. For each `Element` child, run `directiveNormalize(child.tagName.toLowerCase())` and check it against the normalized selector map (selector strings are pre-normalized at registration). On match, route to the named bucket; otherwise route to the default bucket. Text nodes and comments always go to the default bucket. Whitespace-only text nodes between slot-matched siblings still go to default (visually invisible per FS §2.3).
   - Returns `{ defaultBucket, slotBuckets, unfilledRequired, unfilledOptional, declaredSlots }`.
4. **Compile each bucket via the existing `CompileService` entry.** `transclude-compile.ts` calls `compileService(defaultBucket)` and `compileService(slotBuckets[name])` for each named slot. Empty buckets produce `null` (sentinel for "nothing to project"). The existing top-level branch at `src/compiler/compile.ts:269-291` already accepts `Node[]` / `NodeList`, so this reuses the recursive walker verbatim — no new entry point.
5. **Report unfilled required slots at link time, not at compile time.** The functional spec is explicit (§2.9): the directive's own link STILL runs so the author can render skeleton chrome. The error fires either (a) when `$transclude(fn, null, '<slotName>')` is called for the unfilled required slot (synchronous at the call site), or (b) eagerly via `$exceptionHandler('$compile')` from the per-element linker once all directives on the node have been linked (so directives that DON'T touch the missing slot still surface the error). Implementation: `transclude-fn.ts` carries the `unfilledRequired` set; the per-element linker reports each unfilled required slot via `invokeExceptionHandler` once after all link phases complete on the host element.

The `directive.compile(node, attrs)` call at `compile.ts:142` is then invoked AFTER capture has completed. Capture runs in the COMPILE phase, before the walker recurses into children (`:171-182`) — so by the time recursion runs, the host element has no children and `childLinker` is the no-op composite from `composeLinkers([])`.

### 2.3. Slot Validation at Registration (`normalizeDirective` extension)

Extend `normalizeDirective` at `src/compiler/compile-provider.ts:265-310`. After the existing isolate-scope rejection at `:276` and before the directive object is frozen:

1. **`transclude === undefined` or `transclude === false`**: leave the normalized form's `transclude` field unset. Directive runs as in spec 017.
2. **`transclude === true`**: set normalized `transclude` to `{ kind: 'content' }`.
3. **`typeof transclude === 'object' && transclude !== null && !Array.isArray(transclude)`**:
   - Build the `TranscludeSlotMap` by iterating `Object.entries(transclude)`:
     - Validate each key is a valid camelCase JS identifier (regex `/^[a-zA-Z_$][a-zA-Z0-9_$]*$/`) — else throw `InvalidTranscludeSlotNameError`.
     - Validate each value is a non-empty string. Strip optional leading `?` and record `required = !leadingQuestionMark`. Validate the remainder is a single kebab-case tag-name token (regex `/^[a-z][a-z0-9\-]*$/`) — else throw `InvalidTranscludeSelectorError`.
     - Pre-normalize the selector via `directiveNormalize(selector)` (camelized form) so the capture step at runtime is a plain string-equality check against `directiveNormalize(child.tagName.toLowerCase())`.
   - Detect duplicate selectors after normalization — throw `DuplicateTranscludeSelectorError` if any.
   - Result: `{ kind: 'slots', slots: [{ name, selector, normalizedSelector, required }, ...] }`.
4. **`transclude === 'element'`**: throw `ElementTranscludeNotSupportedError` with the FS §2.1 message verbatim. Deliberate forward-compat rejection.
5. **Any other value** (`42`, `'true'`, `[]`, `null`): throw `InvalidTranscludeValueError`.

All throws are caught by the existing factory-invocation try/catch in `$$buildDirectiveArrayProvider` at `compile-provider.ts:200-208` and routed through `$exceptionHandler('$compile')`. The directive is dropped from the array; siblings continue. Matches the spec-017 isolate-scope-rejection routing exactly.

### 2.4. The `$transclude` Function (`transclude-fn.ts`)

`buildTranscludeFn` is a factory called from the per-element linker closure at `compile.ts:190-205`. Inputs (named):

- `slotLinkers: Record<string, Linker | null>` — compiled per-slot linkers from the capture pipeline. The default slot's entry is keyed under a private constant (e.g. `'$$default'`); name collision with a slot named `$$default` is prevented by the camelCase-identifier rule in §2.3.
- `declaredSlots: TranscludeSlotMap` — the normalized slot map (or `[]` for `transclude: true`).
- `unfilledRequired: Set<string>` — required slot names with no matching child.
- `outerScope: Scope` — captured from the per-element linker's `parentScope` argument. This is the AngularJS-canonical "outer" scope.
- `hostElement: Element` — for cleanup-queue registration.
- `exceptionHandler: ExceptionHandler` — for `'$compile'` routing.

Output: a function matching the public `TranscludeFn` shape:

```
type TranscludeFn = (
  cloneAttachFn?: CloneAttachFn,
  futureParent?: Element | null,
  slotName?: string | null,
) => Node[];

type CloneAttachFn = (clone: Node[], scope: Scope) => void;
```

Per-call lifecycle:

1. **Resolve the target linker.** If `slotName == null`, use the default slot. If `slotName` is provided but not in `declaredSlots` (and not the special default key), throw `UndeclaredTranscludeSlotError` via `invokeExceptionHandler` and return `[]`. If `slotName` is in `declaredSlots` AND in `unfilledRequired`, throw `RequiredTranscludeSlotUnfilledError` via `invokeExceptionHandler` and return `[]`. If `slotName` is in `declaredSlots` AND unfilled-optional, the slot linker is `null` — return `[]` after invoking `cloneAttachFn([], transclusionScope)` (FS §2.4 — optional empty slots still call the attach fn so `ng-transclude` can render fallback).
2. **Create the transclusion scope.** `transclusionScope = outerScope.$new()`. Push `() => transclusionScope.$destroy()` onto `hostElement.$$ngCleanupQueue` via `pushElementCleanup(hostElement, ...)`. Registration happens BEFORE link, so a `cloneAttachFn` throw or a link-time throw still leaves a destroy-able scope on the queue (FS §2.4, §2.8).
3. **Deep-clone the master.** For each master node in the slot's bucket, call `node.cloneNode(true)`. The cloned `Node[]` is the linker's input.
4. **Link the clone.** Invoke `slotLinker(transclusionScope, clonedNodes)` — but the existing `Linker` signature at `directive-types.ts` is `(scope: Scope) => Element | NodeList | Comment` and binds the original-node identity. For transclusion we need to link a CLONE, not the master. Two implementation options:
   - **(Recommended) Extend the internal `Linker` type with an optional override input.** The public type stays `(scope) => Element | NodeList | Comment` (back-compat for spec-017 callers). Internally, the walker returns a function that ALSO accepts the cloned NodeList for substitution before running per-node closures. This is the same pattern AngularJS uses (`publicLinkFn.bind(null, cloneAttachFn)`). The widening is internal to `compile.ts`; no public type changes.
   - **Alternative: store linker closures keyed by their original master node**, look up the cloned counterparts via post-order traversal at link time, and bind into the existing signature. Equivalent, slightly more bookkeeping.
   The recommended option matches AngularJS exactly and concentrates the change in `transclude-compile.ts` + `compile.ts`'s `composeLinkers`. Internal-only — no public-surface impact.
5. **Invoke `cloneAttachFn(clonedNodes, transclusionScope)` synchronously**, wrapped in try/catch that routes via `invokeExceptionHandler(handler, err, '$compile')`. Errors do NOT abort the call — `clonedNodes` is still returned so the directive may recover.
6. **Return `clonedNodes`.**

Multi-clone (FS §2.7) is just "call the function again" — each call repeats the deep-clone + scope-create + link sequence against the same master and shared `slotLinkers`. No state is mutated on the master.

### 2.5. Outer-Scope Binding — Why `parentScope` Is Captured at the Right Seam

The functional spec (§2.5) requires transcluded content to bind against the OUTER scope, not the directive's own scope. The mechanical evidence that this drops out naturally:

- `nodeLinker` at `compile.ts:190-205` receives `parentScope` as its argument.
- The decision to call `parentScope.$new()` for `scope: true` happens at `:205`. BEFORE that line, `parentScope` is the OUTER scope.
- `buildTranscludeFn(...)` is called BEFORE `:205`, capturing `outerScope = parentScope` in its closure. Every clone's transclusion scope is `outerScope.$new()`.
- The directive's own link function (whether bound to a `scope: true` child or to `parentScope` directly) is called AFTER `:205` — at that point `scope` is the directive's scope, NOT what `$transclude` uses internally.

Consequence: `transcludedScope.$parent === outerScope` strictly; the directive's `scope: true` child is on a sibling branch, never in the prototype chain. FS §2.5 acceptance #1 lands by construction.

### 2.6. Element-Stash for `ng-transclude` — `$$ngBoundTransclude` Slot

After `buildTranscludeFn` returns the `$transclude` function, the per-element linker writes it onto the host element as a non-enumerable property:

| Property | Type | Defined where | Read by |
| --- | --- | --- | --- |
| `(element as any).$$ngBoundTransclude` | `{ fn: TranscludeFn; declaredSlots: TranscludeSlotMap; kind: 'content' \| 'slots' } \| undefined` | Per-element linker in `compile.ts` (new write site immediately after `pushElementCleanup` calls). Defined via `Object.defineProperty(...)` with `enumerable: false`, `writable: true`, `configurable: true` — same shape as `$$ngScope` (`cleanup.ts:69-76`). | `ng-transclude` link fn walks `element.parentElement` chain. |

`ng-transclude` resolves its host directive by walking `element.parentElement` (synchronous `while (current = current.parentElement) { if (current.$$ngBoundTransclude) break; }`). The walk stops at the first ancestor carrying the slot — that is the enclosing transcluding directive. Encapsulation guarantee: an `ng-transclude` placed inside a NESTED transcluding directive correctly binds to its IMMEDIATELY enclosing transcluding parent, not a more-distant ancestor.

Edge cases:
- No `$$ngBoundTransclude` ancestor found → `NgTranscludeMisuseError` routed via `$exceptionHandler('$compile')`; the marker becomes a no-op (its pre-existing children, if any, remain).
- `ng-transclude="someName"` under a `kind: 'content'` host → `NgTranscludeMisuseError` (named slot under non-multi-slot host).
- `ng-transclude="someName"` under a `kind: 'slots'` host whose `declaredSlots` doesn't include `someName` → `UndeclaredTranscludeSlotError` (same error class the `$transclude` call-site path throws).

### 2.7. `ng-transclude` Directive (`ng-transclude.ts`)

Factory shape (described, not coded):

- `restrict: 'EA'`, `priority: 0`. No compile fn. Post-link only.
- Post-link function `(scope, element, attrs) => void`:
  1. Walk `element.parentElement` to find `$$ngBoundTransclude`. On miss, route `NgTranscludeMisuseError` and return.
  2. Read the slot name from `attrs.ngTransclude` (the normalized attribute value — `directiveNormalize` produces `'ngTransclude'`). Treat empty string / missing as the default slot.
  3. Validate the slot is declared on the host (per the rules in §2.6). On validation error, route via `$exceptionHandler` and return — pre-existing children of the marker remain in place as a no-op.
  4. Invoke the host's `$transclude(cloneAttachFn, null, slotName)` where `cloneAttachFn(clone, transcludedScope)`:
     - For OPTIONAL slots returning an empty clone (unfilled): leave the marker's pre-existing children unchanged (fallback content path — FS §2.6). Those children were already compiled and linked as part of the OUTER walk against `scope`, so no extra wiring is needed.
     - For DEFAULT slots and FILLED slots: REMOVE the marker's pre-existing children (`while (element.firstChild) element.removeChild(element.firstChild)`), then `element.append(...clone)`.
  5. Errors thrown by the `$transclude` call (e.g. `UndeclaredTranscludeSlotError`, `RequiredTranscludeSlotUnfilledError`) are already routed by the `$transclude` implementation in §2.4 — `ng-transclude` does not need to re-wrap.

`ng-transclude` is registered via `$compileProvider.directive('ngTransclude', factory)` from `src/core/ng-module.ts` immediately after the filter chain. This is the FIRST built-in directive on `ngModule`; existing test `cross-spec-smoke.test.ts` will need a smoke-check that `injector.has('ngTranscludeDirective') === true`.

### 2.8. `LinkFn` / `CompileFn` Type Widening (`directive-types.ts`)

Current types:

- `LinkFn` (`:77`): `(scope: Scope, element: Element, attrs: Attributes) => void`
- `CompileFn` (`:86-90`): `(element: Element, attrs: Attributes) => LinkFn | { pre?: LinkFn; post?: LinkFn } | void`

Widened types:

- `LinkFn`: `(scope: Scope, element: Element, attrs: Attributes, controllers?: undefined, $transclude?: TranscludeFn) => void`. `controllers` is a stable placeholder reserved for the controllers spec (deferred per FS §3 Out-of-Scope).
- `CompileFn`: `(element: Element, attrs: Attributes, $transclude?: TranscludeFn) => LinkFn | { pre?: LinkFn; post?: LinkFn } | void`.

TypeScript function-parameter subtyping: a function with FEWER parameters is assignable to a function type with MORE optional parameters. Existing 3-arg link callers and 2-arg compile callers remain type-compatible without source changes. New tests in `transclude-true.test.ts` cover both the widened-arity case and the narrowed-arity case to lock the back-compat contract.

The walker at `compile.ts:236-241, :259-264` passes the additional argument(s) unconditionally — for directives that didn't declare `transclude`, the `$transclude` slot is `undefined` (FS §2.4 acceptance #1).

### 2.9. Cleanup Integration — `destroyElementScope` Plumbing

Existing infrastructure at `src/compiler/cleanup.ts`:

- `setElementScope(element, scope)` writes `$$ngScope` non-enumerably.
- `addElementCleanup(element, fn)` (already exported) pushes `fn` onto `$$ngCleanupQueue`.
- `destroyElementScope(element)` drains the queue THEN calls `$$ngScope.$destroy()`, recursing into descendants depth-first.

This spec adds zero new public surface to `cleanup.ts`. Transclusion call sites use `addElementCleanup(hostEl, () => scope.$destroy())` for every clone's scope. Ordering is preserved by the existing FIFO drain in `destroyElementScope`; transclusion scopes destroy BEFORE the host's own `$$ngScope` per the spec-017 contract (cleanup callbacks first, then `$destroy`).

FS §2.8 acceptance #6 (outer-scope-tree destroy without `destroyElementScope`): each transclusion scope is a normal child of `outerScope`, so `outerScope.$destroy()` tears them down via standard scope-tree propagation. Both paths (`destroyElementScope(host)` and `outer.$destroy()`) converge on `transcludedScope.$$destroyed === true`. Tested in `transclude-cleanup.test.ts`.

### 2.10. Error Surface (`compile-error.ts`)

Add nine new error classes following the existing pattern at `compile-error.ts:29-80`. Each extends `Error`, carries `readonly name = '<ClassName>' as const`, and supers a deterministic message string.

| Class | Thrown at | Routed by |
| --- | --- | --- |
| `InvalidTranscludeValueError` | `normalizeDirective` (compile-provider.ts) | Existing factory try/catch at `:200-208` → `$exceptionHandler('$compile')` |
| `ElementTranscludeNotSupportedError` | `normalizeDirective` | Same as above |
| `DuplicateTranscludeSelectorError` | `normalizeDirective` | Same as above |
| `InvalidTranscludeSlotNameError` | `normalizeDirective` | Same as above |
| `InvalidTranscludeSelectorError` | `normalizeDirective` | Same as above |
| `MultipleTranscludeDirectivesError` | Per-element linker pre-pass in `compile.ts` | New direct `invokeExceptionHandler` call at the new pre-pass site |
| `RequiredTranscludeSlotUnfilledError` | (a) per-element linker after host link phases (one report per unfilled required slot); (b) inside `$transclude` if the call requests an unfilled required slot | `invokeExceptionHandler(handler, err, '$compile')` at each site |
| `UndeclaredTranscludeSlotError` | (a) inside `$transclude` for undeclared slot names; (b) inside `ng-transclude` link for marker-declared but host-undeclared slot | Same as above |
| `NgTranscludeMisuseError` | `ng-transclude` post-link | Same as above |

All thrown via the existing `invokeExceptionHandler(handler, err, '$compile')` helper from `src/exception-handler/exception-handler.ts`. **No new entry to `EXCEPTION_HANDLER_CAUSES`** — the `'$compile'` token added in spec 017 already covers this entire surface, exactly as FS §2.9 requires.

The spec-014 recursion guard in `invokeExceptionHandler` already handles the "custom `$exceptionHandler` that itself throws" case (FS §2.9 acceptance #8) — transclusion inherits that contract for free.

### 2.11. Documentation Updates

- **`src/compiler/README.md`** — add a top-level "Transclusion" section after the existing "Compile vs link" section. Subsections (mirroring FS §2.12 acceptance):
  - When to use `transclude: true` vs the object form
  - Multi-slot selector rules + `?` optional prefix
  - `ng-transclude` — default, named, fallback content
  - The outer-scope rule (worked example with `<my-card>` + `outerCtrl.title`)
  - Multi-clone pattern (forward-pointer to `ng-repeat`)
  - Cleanup contract — `destroyElementScope` and the `$$ngCleanupQueue` plumbing
  - Forward-pointers: `transclude: 'element'` lands with structural directives; `template` / `templateUrl` integration lands with the templates spec; controllers fill the 4th link arg in their own spec.
- **`CLAUDE.md` updates** (per FS §2.12):
  - "Modules" table row for `./compiler`: amend the purpose summary to include "transclusion (content + multi-slot)" and add `TranscludeFn`, `CloneAttachFn`, the new error classes to the exports column.
  - "Non-obvious invariants" bullets (5 new):
    1. Transclusion scope is a child of the OUTER scope (the scope the host directive was linked against), NOT the directive's own scope. Mechanically: the `$transclude` closure captures `parentScope` BEFORE the `scope: true` `$new()` runs.
    2. Captured children compile EXACTLY ONCE at capture time (during the host directive's compile phase, before the walker descends into the host's child positions). Each `$transclude(...)` call deep-clones the master via `Node.cloneNode(true)` and re-links the clone against a fresh transclusion scope. The master fragment is never inserted into the DOM.
    3. Multi-clone is supported — each clone gets its own scope, pushed onto the host element's `$$ngCleanupQueue` so `destroyElementScope(host)` tears them all down regardless of how many clones were produced.
    4. `ng-transclude` finds its enclosing transcluding directive by walking `element.parentElement` until it finds an ancestor carrying the non-enumerable `$$ngBoundTransclude` slot. Decoupled from the walker — works for programmatically-inserted markers AND (in the future) for markers inside compiled `template` strings.
    5. `transclude: 'element'` is deliberately deferred and REJECTED at registration so a future structural-directives spec can add it without a silent semantic change. `'$compile'` cause is reused for every transclusion error site — no new `EXCEPTION_HANDLER_CAUSES` entry.
  - "Where to look when…" rows (3 new):
    - "How does `transclude: true` capture children?" → `src/compiler/transclude-capture.ts` + the pre-pass block in `src/compiler/compile.ts`
    - "How does multi-slot routing decide which child fills which slot?" → `src/compiler/transclude-capture.ts` (selector match against `directiveNormalize(tagName)`)
    - "How does `ng-transclude` find the captured content to project?" → `src/compiler/ng-transclude.ts` (parent-element walk for `$$ngBoundTransclude`)
- **TSDoc on every new public export** — `TranscludeFn`, `CloneAttachFn`, the nine error classes. The `TranscludeFn` TSDoc carries the FS §2.4 worked example (consumer markup → captured-children → `$transclude(fn)` → projected DOM).
- **No changes to `package.json` `exports` map**. No new build entry; `./compiler` already covers transclusion.

### 2.12. Public API Surface — Barrel Updates

`src/compiler/index.ts`:

- New named exports:
  - Types: `TranscludeFn`, `CloneAttachFn`, `TranscludeSlotName`, `TranscludeSlotMap`
  - Errors: `InvalidTranscludeValueError`, `ElementTranscludeNotSupportedError`, `DuplicateTranscludeSelectorError`, `InvalidTranscludeSlotNameError`, `InvalidTranscludeSelectorError`, `MultipleTranscludeDirectivesError`, `RequiredTranscludeSlotUnfilledError`, `UndeclaredTranscludeSlotError`, `NgTranscludeMisuseError`
- Unchanged (FS §2.10 acceptance #3): `createCompile`, `compile` default, `Attributes`, `directiveNormalize`, `setElementScope`, `getElementScope`, `addElementCleanup`, `destroyElementScope`, all spec-017 error classes, all spec-017 types.

`src/index.ts`: re-export the new types and error classes from `./compiler`. `ngTranscludeDirective` is INTERNAL — only consumed by `src/core/ng-module.ts`. Mirrors the spec-016 pattern where individual filter factories are exported but the underlying `<name>Filter` provider names are implementation detail.

---

## 3. Impact and Risk Analysis

### System Dependencies

**Modules touched:**

- `src/compiler/` — gains 5 new files, modifies 6 existing files. No public-API removal.
- `src/core/ng-module.ts` — gains exactly one `.directive('ngTransclude', ...)` line.
- `src/index.ts` — gains re-exports for new types and error classes.

**Modules unchanged:**

- `Scope`, `parser`, `injector`, `module`, `interpolate`, `sce`, `sanitize`, `exception-handler`, `filter` — no source changes.
- `EXCEPTION_HANDLER_CAUSES` tuple — unchanged. FS §2.9 explicit constraint.
- Existing test suites for specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017 — pass unchanged.

**Public-API surface additions (changelog-worthy):**

- New types: `TranscludeFn`, `CloneAttachFn`, `TranscludeSlotName`, `TranscludeSlotMap`.
- New error classes (9): listed in §2.10.
- Widened `LinkFn` and `CompileFn` signatures (optional trailing args — TypeScript-additive).
- New built-in directive: `ng-transclude` on `ngModule`. Observable as `injector.has('ngTranscludeDirective') === true`.

**Run-phase dependency graph:**

- `$compile` and `$compileProvider` continue to depend on `$injector`, `$interpolate`, `$exceptionHandler` only — no new run-phase deps.
- `ngTranscludeDirective` has no factory deps; it's a pure-DOM directive that reads `$$ngBoundTransclude` from the parent chain.

### Potential Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Capture happens AFTER one of the matched directives' `compile()` has already mutated children — the capture grabs the post-mutation tree, not what the consumer authored. | Med | Med | The compile-loop pre-pass (§2.2) runs capture BEFORE any directive's `compile()` on this element is invoked, even though transclusion-declaring is the directive with priority X. Implementation detail: the pre-pass scans the sorted list FIRST to find the transcluding entry, then captures, then runs the normal per-directive compile loop. Tested in `transclude-true.test.ts` with a sibling-priority directive that would mutate children if it ran first. |
| `Node.cloneNode(true)` does not clone DOM event listeners attached via `addEventListener` (only inline `on*` attributes). | Low | Low | Documented in `src/compiler/README.md` "Transclusion" section. FS §2.2 acceptance is "preserve attributes and inline event handlers" — explicit. AngularJS has the same behavior. Out-of-scope `template` integration would render this moot for in-template handlers; consumer-authored handlers are an authoring concern. |
| Per-clone deep clone is O(N) per call where N is captured-fragment node count; multi-clone scenarios (`ng-repeat` over 10,000 items) could become a real cost. | Med | Med | FS §3 Out-of-Scope: "Performance optimizations — straightforward deep-clone via `Node.cloneNode(true)` and per-clone scope creation. No node pooling, no diffing, no memoization." Spec 018 locks correctness, not performance. A future spec may revisit (node pooling, structural diff). The 10,000-clone correctness test in `transclude-multi-clone.test.ts` runs as a smoke check, not a benchmark. |
| `$$ngBoundTransclude` property collision with consumer-set element properties. | Low | Low | `Object.defineProperty(element, '$$ngBoundTransclude', { enumerable: false, ... })`. Property name uses the AngularJS-canonical `$$` framework-private prefix. Same convention as `$$ngScope`, `$$ngCleanupQueue`. Documented in `cleanup.ts` and `README.md`. |
| Two `transclude`-declaring directives on the same element — the "first wins" rule depends on the deterministic priority + registration-order sort from spec 017. | Low | Med | Sort is deterministic by §2.5 of spec 017's tech spec (priority desc, registration `index` asc). The pre-pass picks the first entry in the sorted list. Tested in `transclude-errors.test.ts` with both same-priority-different-registration-order AND different-priority cases. |
| Required-slot unfilled is reported at link time (not registration), so a transcluding directive's link STILL runs and may itself throw before the unfilled-slot error is reported. | Med | Med | FS §2.9 acceptance #3 explicitly mandates this — the directive's link must run so the author can render fallback. The per-element linker reports unfilled-required errors AFTER all link phases complete on the host, so directive-link throws are reported via `$exceptionHandler('$compile')` independently of slot-validation errors. Both surfaces visible in `transclude-errors.test.ts`. |
| `cloneAttachFn` throws but the clone is still returned — the caller may not realize the attach failed and may attach the clone twice. | Med | Med | FS §2.4 acceptance #11 documents this contract precisely: the scope IS still created and registered for cleanup, the clone IS still returned, the directive may inspect the return value and recover. The README "Transclusion" section calls out this contract with an example. |
| `ng-transclude` placed inside a transcluding directive's pre-capture children — i.e. the consumer authors `<my-card><ng-transclude></ng-transclude></my-card>`. The marker gets captured along with the rest, then projected back into itself when `$transclude` is called — infinite recursion risk. | Low | High | Captured `ng-transclude` markers compile against the OUTER scope (they're consumer-authored), where the parent-element walk finds NO `$$ngBoundTransclude` (the directive's host is the consumer's `<my-card>` element — but the marker has been MOVED into the captured fragment, so its `parentElement` chain at link time is the disconnected fragment, not the original DOM). The walk fails to find a transclude ancestor and routes `NgTranscludeMisuseError`. The marker becomes a no-op. Tested in `ng-transclude.test.ts`. |
| Cross-test pollution: `ngTranscludeDirective` is the FIRST built-in directive on `ngModule`, so adding it changes `injector.has('ngTranscludeDirective')` for every test that builds an injector with `'ng'` in its deps. | Low | Low | The change is additive — existing tests that only check what they registered themselves are unaffected. `cross-spec-smoke.test.ts` gains an explicit `expect(injector.has('ngTranscludeDirective')).toBe(true)` assertion. No other spec-017 test asserts the directive count. |
| FS §2.2 acceptance "children are NOT compiled in the OUTER walk against the directive's element" — implementation correctness depends on the walker NOT descending into children after capture has emptied them. | Med | High | The walker at `compile.ts:171-182` snapshots `childNodes` AFTER the compile-loop completes; capture (which runs at the START of the compile loop) empties `childNodes` BEFORE the snapshot, so the snapshot is `[]` and `childLinker` is a no-op composite. Test in `transclude-true.test.ts` explicitly observes that an inner directive (e.g. `<my-dir><other-dir>x</other-dir></my-dir>`) does NOT link against the OUTER walker's path — `other-dir` runs only when projected via `$transclude`. |
| FS §2.4 — `controllers` 4th arg placeholder. If a future controllers spec changes the placeholder's runtime value from `undefined` to a controllers object, every directive that introspects the 4th arg breaks. | Low | Med | Documented in `directive-types.ts` TSDoc and in `README.md`: "the 4th argument is RESERVED for the controllers spec — directives MUST NOT introspect it as `undefined`. Use the documented 5th `$transclude` slot or wait for the controllers spec to land." The widened `LinkFn` type carries `controllers?: undefined` exactly so today's authors cannot accidentally type `controllers as ControllerInstance`. |
| `directive-types.ts` widening from `(scope, element, attrs) => void` to `(scope, element, attrs, controllers?, $transclude?) => void` — does TypeScript still allow assignment from a 3-arg function to a 5-arg function? | Low | High | YES — TypeScript function-parameter subtyping (bivariance under `strictFunctionTypes: false`; explicit assignability under `strictFunctionTypes: true` for functions with FEWER parameters). The project's `tsconfig.json` enables `strict` (which includes `strictFunctionTypes`) — narrower-arity functions remain assignable to wider-arity types because the extra parameters are simply unused at call sites. Verified locally for `LinkFn` and `CompileFn`. A type-level back-compat test in `transclude-true.test.ts` instantiates a 3-arg link fn against the widened type. |

---

## 4. Testing Strategy

### Test Framework and Environment

- **Framework:** Vitest (already configured at `vitest.config.ts`).
- **DOM:** jsdom (already configured at `vitest.config.ts:19`). Every transclusion test relies on jsdom for `Node.cloneNode(true)`, `Element.childNodes`, `Comment`, `Object.defineProperty`. No real browser tests.
- **Coverage:** 90%+ on `src/compiler/` enforced via the existing V8 provider at `vitest.config.ts:21-25`. The new transclusion files inherit the existing threshold; no `vitest.config.ts` change.
- **Reference:** test vectors ported from `angular/angular.js/test/ng/compileSpec.js` (the `transclusion` describe blocks) where applicable, with explicit comments citing the source-test name. Matches the project's reference-implementation convention (`architecture.md` §2 line 133).

### Test Organization

One test file per concern, mirroring FS §2.10 acceptance #5. Each follows the AngularJS-canonical "register a directive, compile a fixture node, link with a scope, assert" pattern that spec-017 tests already use (`compile.test.ts:21-45` is the structural template).

### Coverage by Concern

- **`transclude-true.test.ts`** — content transclusion. Asserts:
  - Compile-phase capture order (capture runs BEFORE sibling-priority directives' compile on the same element).
  - Captured children removed from live DOM (`element.childNodes.length === 0` immediately after compile).
  - Captured nodes preserve order, attributes, inline event handlers (`<button onclick="x">`), text nodes (whitespace fidelity), comments.
  - Captured children are NOT visited by the OUTER walker (a directive inside the captured fragment runs only on projection).
  - Empty captured fragment is valid (`<my-dir></my-dir>` + `transclude: true` produces a `$transclude(...)` that returns `[]`).
  - Void elements are accepted (`<img my-dir />`).
  - The captured master is compiled EXACTLY ONCE (a spy on the captured-children-compile path observes one invocation regardless of clone count).

- **`transclude-multi-slot.test.ts`** — slot routing. Asserts:
  - Named-slot match against tag name (kebab + camelCase forms both work via `directiveNormalize`).
  - `?` prefix correctly parsed off; required vs optional bookkeeping.
  - Default slot bucket for unmatched element children, text nodes, comments, whitespace.
  - Duplicate-selector registration error.
  - Invalid slot key (whitespace, digit-prefix, reserved char) registration error.
  - Invalid selector value (empty string, non-kebab, numeric) registration error.
  - Two declared slots with the SAME key — last-wins per JS object-literal semantics (documented limitation).

- **`transclude-scope.test.ts`** — outer-scope binding. Asserts:
  - `transcludedScope.$parent === outerScope` strictly (the directive's `scope: true` child is NEVER in the prototype chain).
  - Bindings inside the clone resolve against `outerScope` properties.
  - Prototypal write-shadowing (mutation on `t.foo` does not leak to `outer.foo`).
  - Per-call scope independence (two clones don't share scope state).
  - `scope: true` + `transclude: true` coexistence on the same element — directive's own link sees `scope: true` child; transcluded content sees `outer`.

- **`transclude-multi-clone.test.ts`** — repeated `$transclude(...)`. Asserts:
  - Two sequential calls produce independent clones, independent scopes.
  - Master never mutated.
  - 1000-clone smoke check completes without timeout.
  - Zero-call directive (consumes children for its own purposes, never projects) doesn't leak.

- **`transclude-cleanup.test.ts`** — `destroyElementScope` integration. Asserts:
  - Each clone's scope is on `host.$$ngCleanupQueue`.
  - `destroyElementScope(host)` `$destroy()`s every clone's scope.
  - `cloneAttachFn` throw still registers the scope for cleanup.
  - Idempotent re-tear-down is a no-op.
  - `outer.$destroy()` independently tears down clones via scope-tree (not via cleanup queue).
  - Both teardown paths converge on `transcludedScope.$$destroyed === true`.

- **`ng-transclude.test.ts`** — slot marker directive. Asserts:
  - Default slot projection (`<div ng-transclude></div>`).
  - Element-form (`<ng-transclude></ng-transclude>`).
  - Named slot projection.
  - Fallback content preserved when an OPTIONAL slot is unfilled.
  - Fallback content REPLACED when slot IS filled.
  - Named slot under `transclude: true` host → error + no-op.
  - Undeclared slot under multi-slot host → error + no-op.
  - Unenclosed `ng-transclude` (no ancestor declares transclude) → error + no-op (pre-existing children remain).
  - Captured-content `ng-transclude` (consumer puts `ng-transclude` INSIDE a transcluding host) → error + no-op (no ancestor with `$$ngBoundTransclude` in the captured-fragment chain).
  - Marker timing — runs in post-link AFTER host's own pre-link.

- **`transclude-errors.test.ts`** — every error class. Asserts:
  - Registration-time errors route through factory try/catch at `compile-provider.ts:200-208`; directive dropped; siblings continue.
  - Two transcluding directives on same element: SECOND is reported; second's transclude is ignored; second's link still runs.
  - Required-slot unfilled: reported once via `$exceptionHandler` after host link phases; `$transclude(fn, null, '<slotName>')` for the unfilled slot throws at the call site.
  - Undeclared slot: synchronous error at `$transclude` call site OR at `ng-transclude` link site, both with the directive name in the message.
  - `cloneAttachFn` throw: routed; scope still created and queued for cleanup; clone still returned.
  - Inner-directive throw inside transcluded content: routed; sibling directives in same clone still link; other clones produce normally.
  - Custom `$exceptionHandler` that throws: spec-014 recursion guard catches; transclusion continues; falls back to `console.error`.

### Cross-Spec Regression

- All existing tests for specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017 continue to pass without modification (run as part of `pnpm test`).
- `cross-spec-smoke.test.ts` gains explicit assertions:
  - `injector.has('ngTranscludeDirective') === true` when `'ng'` is in the deps chain.
  - `LinkFn` 3-arg back-compat — a directive registered with the spec-017-canonical `(scope, element, attrs) => void` link still works against the widened type.
- `src/exception-handler/__tests__/*.test.ts` — NO assertion change (no new `EXCEPTION_HANDLER_CAUSES` entry). The token list stays at 10.

### Special Considerations

- **No performance benchmarks.** FS §3 Out-of-Scope.
- **No snapshot tests.** Explicit value/property checks per the existing convention.
- **TypeScript type-level tests** — instantiate a 3-arg `LinkFn`, a 4-arg `LinkFn` (with `controllers: undefined`), and a 5-arg `LinkFn` (with `$transclude: TranscludeFn`) all against the widened type to lock the back-compat contract. Same pattern for `CompileFn` (2-arg + 3-arg).
- **No new build entry.** `package.json` `exports` map and `rollup.config.mjs` already cover `./compiler`; transclusion ships through the same entry.
