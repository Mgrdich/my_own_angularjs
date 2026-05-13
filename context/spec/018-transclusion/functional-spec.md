# Functional Specification: Transclusion — Content + Multi-Slot

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Directives & DOM Compilation (Transclusion)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 017 shipped `$compile` end-to-end: directives register, the tree walker matches them, and pre-link / post-link run against a live scope. What's still missing is the AngularJS-canonical mechanism that lets a directive *re-use* the markup the consumer wrote between its open and close tags — known as **transclusion**.

Today, content placed inside a directive's element is linked against the parent scope alongside everything else and stays in the DOM where the consumer put it. That makes "wrapper" directives unwritable. A developer cannot author this and have it work:

```html
<my-collapsible-card title="Account settings">
  <p>Click any field below to edit it.</p>
  <button ng-click="resetAll()">Reset all</button>
</my-collapsible-card>
```

…because there is no way for `myCollapsibleCard` to (a) capture the `<p>` / `<button>` children before they get linked into the parent context, (b) render its own wrapper chrome (heading, expand/collapse affordance), and (c) project the captured children into a chosen slot inside that wrapper while still letting `ng-click="resetAll()"` resolve against the OUTER scope where `resetAll` is defined.

This spec adds the AngularJS-canonical transclusion model to `$compile`:

1. **`transclude: true` on a directive definition** — the directive's children are captured at compile time and made available to its link functions through a transclusion function the developer calls when ready.
2. **`transclude: { slotName: 'fill-tag', '?optionalSlot': 'fill-tag' }` for multi-slot** — each declared slot is filled from a child element whose tag matches the selector; optional slots tolerate "unfilled" without an error.
3. **`$transclude` exposed as the 5th argument to compile / pre-link / post-link** — `(scope, element, attrs, controllers, $transclude)`. Calling it clones the captured content, creates a fresh transclusion scope as a child of the OUTER scope, links the clone against that scope, and returns the linked DOM ready for insertion. Each call is an independent clone so the directive can project the same content many times.
4. **`ng-transclude` directive — the slot marker** — used inside a transcluding directive's template, it replaces its own contents with the projected slot content. `<div ng-transclude></div>` projects the default slot; `<div ng-transclude="titleSlot"></div>` projects a named slot. If an optional slot is unfilled, the marker element's pre-existing children act as fallback content.
5. **Outer-scope binding** — captured content was authored by the OUTER developer in the OUTER template, so its expressions evaluate against the OUTER scope (a child of it, scoped for cleanup). The directive's own scope (whether shared, `scope: true`, or — once it ships — isolate) is never visible to transcluded expressions. This is what every existing AngularJS tutorial and snippet relies on.
6. **Cleanup parity with spec 017** — every clone gets its own child scope; that scope is registered against the host element's cleanup queue so removing the host (or a future `ng-if` / `ng-repeat` calling `destroyElementScope`) tears down every clone produced from it.
7. **Errors route through `$exceptionHandler` with the existing `'$compile'` cause token** — a thrown error in a slot-fill `cloneAttachFn`, in a transcluded directive's link, or while resolving an unfilled required slot is reported through the configured handler and the digest continues. No new cause token is added; this spec reuses spec 017's contract verbatim.

**Concrete success criteria:**

- A directive with `transclude: true` whose link function calls `$transclude(clone => container.appendChild(clone))` produces a clone of the consumer-supplied children, linked against the OUTER scope, inserted into the directive's chosen container.
- The same directive can call `$transclude(...)` multiple times to produce independent clones; each clone has its own transclusion scope and `scope.$destroy()` on the host scope tears them all down.
- A directive with `transclude: { titleSlot: 'card-title', '?subtitleSlot': 'card-subtitle', bodySlot: 'card-body' }` captures children by tag: `<card-title>`, `<card-subtitle>`, `<card-body>`. The optional `?subtitleSlot` produces no error when no `<card-subtitle>` child is present; missing `titleSlot` (required) throws a clear, named error at link time, routed through `$exceptionHandler('$compile')`.
- `<div ng-transclude></div>` inside a `transclude: true` directive's template, with `<my-dir><p>hi</p></my-dir>` in the consumer markup, renders `<div ng-transclude><p>hi</p></div>` with `<p>hi</p>` bound to the OUTER scope.
- `<div ng-transclude="titleSlot"></div>` renders the named slot. With an OPTIONAL slot that the consumer did not fill, the marker keeps its original children as fallback.
- All tests from prior specs (002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017) continue to pass; behavior is purely additive.

---

## 2. Functional Requirements (The "What")

### 2.1. `transclude` DDO Option — Opt-In Surface

- A directive opts into transclusion by declaring a `transclude` property on its Directive Definition Object. Three values are accepted in this spec:
  - `transclude: true` — content transclusion (capture this element's children).
  - `transclude: { slotName: 'fill-tag' }` — multi-slot transclusion (capture by tag-name selector).
  - `transclude: undefined` / omitted — no transclusion (default, current behaviour).
  - **Acceptance Criteria:**
    - [x] `$compileProvider.directive('myDir', () => ({ transclude: true, link: () => {} }))` registers successfully and the directive matches normally
    - [x] `transclude: { titleSlot: 'card-title' }` registers successfully
    - [x] Omitting `transclude` is equivalent to `transclude: undefined` — directive behaves exactly as in spec 017 with no transclusion semantics
    - [x] `transclude: false` is accepted as an explicit "no transclusion" value and behaves identically to omitting it
    - [x] `transclude: 'element'` (whole-element transclusion — foundation for future `ng-if`/`ng-repeat`) is REJECTED at registration time with a clear error: `Element transclusion (transclude: 'element') is not yet supported; this spec ships only transclude: true and the multi-slot object form.` This rejection is deliberate so a future spec can add it without a silent semantic change
    - [x] Any other value (`transclude: 123`, `transclude: 'true'`, `transclude: []`) is REJECTED at registration time with `Invalid transclude value for directive <name>: <description>`
    - [x] Only ONE directive per element is allowed to declare `transclude` — if two directives on the same element both declare `transclude`, the SECOND directive's `transclude` is reported as an error at link time through `$exceptionHandler('$compile')` and that second directive's `transclude` is ignored (its other behavior — link, compile — still runs). The first declaration wins. This matches AngularJS's behaviour for the historical "multiple transclusion directives on one element" error
    - [x] A directive may combine `transclude: true | { ... }` with any other DDO field already supported in spec 017 (`restrict`, `priority`, `terminal`, `scope: false | true`, `compile`, `link`) without restriction

### 2.2. Content Transclusion — `transclude: true`

- When a directive declares `transclude: true`, the compiler captures the directive element's **child nodes** at compile time, removes them from the live DOM, and exposes a transclusion function via the `$transclude` link argument (§2.4). The directive's own element remains in place; only its children are captured.
  - **Acceptance Criteria:**
    - [x] Given `<my-dir><p>hi</p><span>there</span></my-dir>` where `myDir` declares `transclude: true`, immediately after compile the directive element has NO children (`element.childNodes.length === 0`); the original `<p>` and `<span>` have been MOVED into a private captured fragment
    - [x] Captured nodes preserve their order, attributes, and inline event handlers EXACTLY as authored — no normalization, no cloning at capture time
    - [x] Text nodes between captured elements are preserved as text nodes in the captured fragment (whitespace fidelity)
    - [x] Comments inside the directive element ARE captured along with element children (so a comment-restricted directive inside the consumer markup will compile when projected)
    - [x] The children are captured BEFORE the compiler descends into them — they are NOT compiled in the OUTER walk against the directive's element; they are compiled exactly ONCE, against the OUTER scope's compiler position, as part of the capture pipeline (so directives on the captured children apply correctly when projected)
    - [x] Capturing happens during the directive's COMPILE phase (priority-descending within the matched-directive list on that element), BEFORE pre-link and BEFORE descent into the directive's children — this is the only ordering that produces the "children leave before they get linked" behaviour
    - [x] If the directive element has no children, `transclude: true` still succeeds; `$transclude(...)` produces an empty fragment
    - [x] If the directive element is a self-closing void element (e.g. `<img my-dir />`), `transclude: true` is still permitted at registration and yields an empty captured fragment at compile time
    - [x] The directive element itself is NOT captured — only its children. This is what distinguishes content transclusion from element transclusion (the deferred form)

### 2.3. Multi-Slot Transclusion — `transclude: { slotName: 'fill-tag' }`

- When `transclude` is an object, each entry declares one **slot**. The key is the slot's normalized name (used by `ng-transclude="slotName"` and as the parameter to `$transclude(...)`). The value is a **selector**: a kebab-case element-tag name. At compile time, every direct child element whose tag matches a slot's selector is captured into that slot; un-matched children go into the **default slot** (the same content bucket that `transclude: true` produces).
  - **Acceptance Criteria:**
    - [x] `transclude: { titleSlot: 'card-title', bodySlot: 'card-body' }` registered on `myCard` — given `<my-card><card-title>Hi</card-title><card-body>Body</card-body></my-card>`, the `titleSlot` captures the `<card-title>` element and the `bodySlot` captures the `<card-body>` element
    - [x] The selector is matched against the child element's TAG NAME (case-insensitive, the AngularJS-canonical kebab/camel normalization already shipped in spec 017 applies). `<cardTitle>` (camelCase) and `<card-title>` (kebab) both match the selector `'card-title'`
    - [x] **Required vs optional slot prefix:** a selector that begins with `?` (e.g. `'?card-subtitle'`) declares the slot OPTIONAL — no error is raised if no child matches. A selector without `?` is REQUIRED — link-time error if no matching child is present (§2.9)
    - [x] The `?` prefix is parsed off when matching: `'?card-subtitle'` matches the `<card-subtitle>` tag, not `<?card-subtitle>` literally
    - [x] **Default slot for unmatched children:** any direct child element whose tag matches NONE of the slot selectors is captured into the default slot, available as `$transclude(...)` without a slot name (§2.4). This matches AngularJS exactly — multi-slot directives still receive a "leftover" bucket
    - [x] Whitespace-only text nodes between named-slot children go into the default slot but are visually invisible — they're preserved so re-projection round-trips through cleanly
    - [x] Text content directly inside the directive element (e.g. `<my-card>some loose text<card-title>…</card-title></my-card>`) goes into the default slot
    - [x] Comments inside the directive element go into the default slot (they're not slottable via tag-name match, by design)
    - [x] Two slot declarations with the SAME selector (`{ a: 'card-title', b: 'card-title' }`) is REJECTED at registration time with `Duplicate transclude selector "card-title" in directive <name>` — the multi-slot map must produce a deterministic 1:1 selector→slot mapping
    - [x] Two slots with the same NAME (`{ a: 'card-title', a: 'card-body' }`) collapse per JavaScript object literal semantics (last entry wins); this is a documented limitation matching the §2.17 pattern from spec 017
    - [x] The slot-name key MUST be a valid camelCase JavaScript identifier; an invalid key (whitespace, starts with a digit, reserved character) is REJECTED at registration time with `Invalid transclusion slot name "<key>" in directive <name>`
    - [x] The selector value MUST be a non-empty string consisting of one valid kebab-case tag name (optionally prefixed by `?`); anything else (`''`, `null`, `42`, an object) is REJECTED at registration with `Invalid transclusion selector for slot "<key>" in directive <name>`

### 2.4. `$transclude` — Fifth Link Argument

- Compile, pre-link, and post-link functions receive a 5th argument `$transclude` when (and ONLY when) the directive declares `transclude: true | { ... }`. The 4th argument `controllers` stays a stable placeholder value (`undefined`) in this spec because controllers are deferred — that slot is preserved so the controllers spec can fill it in without breaking the signature. `$transclude` is a function with the following signature:

  ```
  $transclude(cloneAttachFn?, futureParent?, slotName?): Node[]
  ```

  Each call clones the captured content for the requested slot (or the default slot if `slotName` is omitted), creates a fresh transclusion scope (§2.5), links the clone against that scope, and returns the linked top-level nodes. The optional `cloneAttachFn(clone, scope) => void` is invoked synchronously with the cloned top-level nodes BEFORE they are returned, so the directive can attach them to the DOM at the chosen location.
  - **Acceptance Criteria:**
    - [x] Link signature is `(scope, element, attrs, controllers, $transclude)`. When `transclude` is NOT declared, the 5th argument is `undefined` (current behavior is preserved — directives without transclusion still receive the same shape they always have, with the trailing slots simply unused)
    - [x] Compile signature is `(element, attrs, $transclude)` — `$transclude` lands as the 3rd argument on `compile` since compile has no `scope` / `controllers` (this matches AngularJS exactly)
    - [x] Calling `$transclude()` with no arguments returns an array of cloned top-level nodes, linked against a fresh transclusion scope. The directive is responsible for inserting them into the DOM
    - [x] Calling `$transclude(cloneAttachFn)` invokes `cloneAttachFn(clone, transcludedScope)` synchronously where `clone` is the array of cloned top-level nodes and `transcludedScope` is the transclusion scope just created. The directive typically inserts `clone` into the DOM inside the attach function
    - [x] Calling `$transclude(cloneAttachFn, futureParent)` is supported for AngularJS parity — `futureParent` is the eventual DOM parent of the clone; passed to `cloneAttachFn` is unchanged. (Reserved for future template/`templateUrl` integrations; in this spec `futureParent` is accepted and remembered but does not change behavior.)
    - [x] Calling `$transclude(cloneAttachFn, futureParent, 'titleSlot')` projects the named slot's content. With `slotName` omitted or `null`, the default slot is used
    - [x] Asking for an UNDECLARED slot name (`$transclude(fn, null, 'noSuchSlot')`) throws `No transclusion slot "<name>" declared on directive <directiveName>` at the call site (synchronous, routed through `$exceptionHandler('$compile')`)
    - [x] Asking for a DECLARED slot that was OPTIONAL and UNFILLED returns an empty array; `cloneAttachFn` is still invoked with an empty array clone, so the directive can decide what to render in the fallback path. This is the signal that lets `ng-transclude` show fallback content for empty optional slots (§2.6)
    - [x] Each call to `$transclude` produces an INDEPENDENT clone. Two calls produce two distinct sets of DOM nodes with two distinct transclusion scopes
    - [x] Calling `$transclude` from a post-link function is the canonical place; calling it from a pre-link or compile function is also permitted (matches AngularJS leniency — no spec-imposed restriction)
    - [x] An exception thrown from `cloneAttachFn` is routed through `$exceptionHandler('$compile')`; the transclusion scope IS still created and the clone IS still returned to the call site, so the directive may recover. The transclusion scope is registered with the host element's cleanup queue regardless of whether the clone is ever attached to the DOM, so it tears down cleanly when the host is destroyed
    - [x] An exception thrown by a directive INSIDE the transcluded content (during its link) is routed through `$exceptionHandler('$compile')`; other directives in the clone still link, and other clones still produce successfully

### 2.5. Transcluded Scope — Outer-Scope Child

- The transclusion scope is the scope passed to every link function inside the transcluded clone. It is **a child of the OUTER scope** (the scope under which the directive itself was linked) — NOT a child of the directive's own scope. This is the AngularJS-canonical rule and what every existing piece of AngularJS code depends on.
  - **Acceptance Criteria:**
    - [x] Given an outer scope `outer` and a transcluding directive whose link function receives `scope: directiveScope` (possibly a child of `outer` because `scope: true` was requested), calling `$transclude(...)` creates a NEW scope `t` such that `t.$parent === outer`. The directive's own `directiveScope` is NEVER in the prototype chain of `t`
    - [x] Expressions inside the transcluded clone resolve against `outer` (via prototypal inheritance from `t`). `outer.foo = 'hi'` is visible as `t.foo` and bindings interpolated against `t.foo` reflect that value
    - [x] Mutations the transcluded content makes on `t.foo` do NOT leak to `outer` (prototypal write-shadowing) — the same rule as any other child scope
    - [x] Each `$transclude(...)` call produces a SEPARATE transclusion scope; two clones cannot accidentally share state through their immediate scope
    - [x] Spec 017's `scope: true` semantics on the directive are preserved unchanged — the directive's OWN link sees its own child scope, while transcluded content sees `outer` (the directive's parent). This is the rule that lets `<my-dir scope="true">` use its own variable namespace internally while still letting the consumer's markup bind to consumer variables
    - [x] Spec 017's rejection of isolate scope (`scope: {}`) is preserved — `transclude: true` is allowed alongside `scope: false | true` but not alongside `scope: { ... }` (which already throws at registration before transclusion semantics matter)
    - [x] When the host element is destroyed (`destroyElementScope(hostEl)`), every transclusion scope created from it has its `$destroy()` called as part of the same teardown — wired through the host element's cleanup queue (the same mechanism spec 017's `scope: true` cleanup uses)
    - [x] When the OUTER scope is destroyed via `outer.$destroy()` directly, the transclusion scopes are destroyed too — because they are normal children of `outer`, they participate in scope-tree teardown just like any other child scope

### 2.6. `ng-transclude` — The Slot Marker Directive

- A new built-in directive `ng-transclude` ships on the `ng` module. Used INSIDE a transcluding directive's template, it identifies the location where projected content should appear. The marker is restricted to `'EA'` (element or attribute form).
  - **Acceptance Criteria:**
    - **Default slot:**
      - [x] `<div ng-transclude></div>` inside a `transclude: true` directive's template renders the projected default-slot content as the marker element's children. Pre-existing children of the marker are REPLACED (not appended to) — fallback content semantics apply only when the slot is empty (see below)
      - [x] `<ng-transclude></ng-transclude>` (element form) renders identically; the element itself remains in the DOM, its children are the projected content
    - **Named slot:**
      - [x] `<div ng-transclude="titleSlot"></div>` projects the `titleSlot` slot of a multi-slot directive
      - [x] Asking for a slot name that the enclosing directive did NOT declare reports `No transclusion slot "<name>" declared on directive <name>` via `$exceptionHandler('$compile')`; the marker is left with its own original children unmodified
    - **Fallback content for empty optional slots:**
      - [x] `<div ng-transclude="subtitleSlot">No subtitle</div>` — when the optional `subtitleSlot` is UNFILLED, the marker keeps its existing children (`No subtitle`) as fallback. The fallback children ARE compiled and linked against the OUTER scope (consistent with §2.5 — fallback content is conceptually part of the outer template authoring)
      - [x] When the optional slot IS filled, the marker's existing children are REPLACED with the projected content (fallback is overridden)
      - [x] For REQUIRED slots, fallback children are never observed because the missing slot raises an error at link time (§2.9)
    - **Lifecycle:**
      - [x] `ng-transclude` runs in the post-link phase (priority 0, restrict `'EA'`) — its projection work happens AFTER its host's own pre-link, which means the directive's link function has had a chance to mutate the marker's siblings before projection
      - [x] If a transcluding directive's template contains NO `ng-transclude` marker for the default slot (or for any declared slot), the captured content for that slot is simply never inserted into the DOM. No error. The directive author opted in to manual placement via `$transclude(...)` and chose not to use the marker — that's a supported path
      - [x] Using `ng-transclude` OUTSIDE any transcluding directive's template (i.e., the enclosing directive does not have a `$transclude` available) reports `ngTransclude must be used inside a directive declaring transclude: true | { … }` via `$exceptionHandler('$compile')`; the marker becomes a no-op
      - [x] An `ng-transclude` inside a `transclude: true` directive's template asking for a NAMED slot (`ng-transclude="titleSlot"`) reports `Slot "titleSlot" is not declared; transclude: true exposes only the default slot` via `$exceptionHandler('$compile')`
      - [x] The marker is itself a directive registered through `$compileProvider.directive('ngTransclude', factory)` — it participates in priority sorting (priority 0), can be combined with other directives on the same element, and is matched by the same name-normalization rules as any other directive (`<div ng-transclude>`, `<div data-ng-transclude>`, `<div x-ng-transclude>` all match)

### 2.7. Multi-Clone — Repeated `$transclude(...)` Calls

- A directive may call `$transclude(...)` more than once. Each call produces an independent clone with its own scope; the same captured fragment is re-cloned (deep clone) so the captured master is never mutated. This is the infrastructure piece that a future `ng-repeat` will lean on.
  - **Acceptance Criteria:**
    - [x] Two sequential calls `$transclude(fn1)` and `$transclude(fn2)` produce two distinct clones, each linked against its own transclusion scope. `fn1` and `fn2` each receive their own `(clone, scope)` pair
    - [x] The captured master fragment is never inserted into the DOM directly — every projection is from a clone, so the master remains pristine for the next call
    - [x] Each clone's transclusion scope is registered with the host element's cleanup queue, so `destroyElementScope(hostEl)` tears them all down regardless of how many clones were produced
    - [x] The clones are independent from each other — `clone1.scope.foo = 'a'` does not affect `clone2.scope.foo`
    - [x] Calling `$transclude(...)` zero times (the directive consumes the children for its own purposes without re-projecting) is fully supported — the captured content is simply released to garbage collection when the host element is destroyed
    - [x] No upper bound on the number of clones (subject to memory). A real-world `ng-repeat` over a 10,000-element array MUST work without spec-imposed restriction (performance is a separate concern; correctness is what this acceptance criterion locks in)

### 2.8. Cleanup Contract — Integration with `destroyElementScope`

- All transclusion scopes are owned by the host element's cleanup registry — the same registry spec 017 introduced for `scope: true` and explicit directive cleanup callbacks.
  - **Acceptance Criteria:**
    - [x] Each transclusion scope created by `$transclude(...)` is pushed onto the host element's `$$ngCleanupQueue` as a `() => scope.$destroy()` callback
    - [x] `destroyElementScope(hostEl)` runs the cleanup queue (which `$destroy()`s every transclusion scope) BEFORE destroying the host element's own `scope: true` child scope (if any) — preserving spec 017's "cleanup callbacks before `$destroy`" ordering
    - [x] If `cloneAttachFn` threw and the clone never made it into the DOM, the transclusion scope is STILL registered and STILL destroyed at teardown — no orphaned scopes in the watcher tree
    - [x] After teardown, the cleanup queue is cleared (spec 017 idempotent-teardown contract is preserved); a second `destroyElementScope` call is a safe no-op
    - [x] If the consumer manually `removeChild`-es the directive's element from the DOM WITHOUT calling `destroyElementScope`, the transclusion scopes leak (same caveat spec 017 already documented for `scope: true`). The fix is for future structural directives to always call `destroyElementScope` before removal — this spec inherits the same contract verbatim
    - [x] When a transclusion scope's PARENT (the outer scope) is destroyed via `outer.$destroy()`, the transclusion scope is destroyed as part of normal scope-tree teardown — independent of the host element's cleanup queue. Both teardown paths converge on the same final state: `transcludedScope.$$destroyed === true`

### 2.9. Error Handling — Reuse `'$compile'` Cause

- No new entry is added to `EXCEPTION_HANDLER_CAUSES`. Every error site in this spec reuses the `'$compile'` token introduced in spec 017.
  - **Acceptance Criteria:**
    - [x] **Invalid `transclude` value at registration:** `transclude: 'element'`, `transclude: 42`, `transclude: []`, `transclude` with invalid slot key or selector — all throw SYNCHRONOUSLY at the lazy `<name>Directive` provider's `$get` (matching spec 017's directive-validation site), routed via `$exceptionHandler('$compile')`. The directive is treated as if it failed to resolve; OTHER directives on the same element continue normally
    - [x] **Two `transclude`-declaring directives on the same element:** at link time, the SECOND `transclude` is reported via `$exceptionHandler('$compile')` with a clear message; the second directive's `transclude` is ignored (its other behavior runs), the first directive's `transclude` wins
    - [x] **Required slot unfilled in the consumer markup:** at link time, when the compiler walks the directive's element and finds NO child matching a required slot's selector, the error `Required transclusion slot "<slotName>" expected one or more elements matching "<selector>", got none` is routed through `$exceptionHandler('$compile')`; the directive's link STILL runs (so the directive author can choose to render fallback or skeleton chrome); calling `$transclude(fn, null, '<slotName>')` later raises a synchronous error at the call site (NOT silently empty — that's the OPTIONAL-slot path)
    - [x] **`$transclude` called with an undeclared slot:** synchronous error at the call site, routed through `$exceptionHandler('$compile')`, with the directive name in the message
    - [x] **`cloneAttachFn` throws:** routed through `$exceptionHandler('$compile')`; the scope is still created and registered for cleanup; the clone is still returned from `$transclude`; the directive may inspect the return value and recover
    - [x] **A directive inside transcluded content throws** during its compile / link: routed through `$exceptionHandler('$compile')`; siblings inside the same clone still link; other clones produce normally
    - [x] **`ng-transclude` misuse** (outside a transcluding directive, or referencing an undeclared slot): routed through `$exceptionHandler('$compile')`; the marker becomes a no-op (it does not crash the surrounding directive's link)
    - [x] **Custom `$exceptionHandler` that itself throws:** spec 014's `invokeExceptionHandler` recursion guard catches it and falls back to `console.error`; transclusion does not crash on a misbehaving handler

### 2.10. Module Layout / Exports

- All transclusion work lives in the existing `src/compiler/` module — there is no new top-level subpath.
  - **Acceptance Criteria:**
    - [x] Capture and projection logic lives in `src/compiler/` alongside the existing `compile.ts`, `compile-provider.ts`, `attributes.ts`, etc. Final file layout is an implementation decision (technical-considerations) — this spec only fixes the public surface
    - [x] The `ng-transclude` directive is registered on the `ng` module from the same place that wires `$compile` / `$compileProvider`
    - [x] The root barrel re-exports any new public types that directive authors need to consume: at minimum, `TranscludeFn` (the `$transclude` signature) and `TranscludeFnSlotName` / `CloneAttachFn` helpers. Existing exports (`createCompile`, `compile`, `Attributes`, `Directive`, `DirectiveFactory`, `LinkFn`, `CompileFn`, `directiveNormalize`, etc.) are unchanged in shape — the `LinkFn` and `CompileFn` types gain the optional 5th / 3rd `$transclude` parameter respectively
    - [x] `package.json` `exports` map and `rollup.config.mjs` entries already include `./compiler`; no new build entry is added in this spec
    - [x] Tests live under `src/compiler/__tests__/*.test.ts` — at minimum one file per concern: `transclude-true.test.ts`, `transclude-multi-slot.test.ts`, `transclude-scope.test.ts`, `transclude-multi-clone.test.ts`, `transclude-cleanup.test.ts`, `ng-transclude.test.ts`, `transclude-errors.test.ts`. Existing spec-017 test files continue to pass unmodified

### 2.11. Backward Compatibility

- Adding transclusion is purely additive. No existing API is renamed, removed, or behavior-changed.
  - **Acceptance Criteria:**
    - [x] All tests from specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017 continue to pass unchanged
    - [x] Directives WITHOUT a `transclude` declaration behave exactly as in spec 017 — same matching, same compile/link order, same scope semantics, same cleanup
    - [x] The `LinkFn` and `CompileFn` type widenings (adding the optional `$transclude` parameter) are non-breaking: callers that pass functions with FEWER parameters (the spec-017-canonical 3-arg `(scope, element, attrs)`) are still type-compatible because TypeScript allows narrower parameter counts on the function-subtyping axis
    - [x] `EXCEPTION_HANDLER_CAUSES` is unchanged — no new entry, every error site reuses `'$compile'`
    - [x] `injector.has('$compile') === true`, `injector.has('$compileProvider') === true` continue to hold. `injector.has('ngTranscludeDirective') === true` is the new internal entry (spec 017 directive-as-`<name>Directive` pattern) — observable but not a public API addition

### 2.12. Documentation

- Transclusion gets the same documentation treatment as the rest of the compiler.
  - **Acceptance Criteria:**
    - [x] `CLAUDE.md` "Modules" table updates the `./compiler` row to mention transclusion in the purpose summary and adds the new public types (`TranscludeFn`, `CloneAttachFn`) to the key exports column
    - [x] `CLAUDE.md` "Non-obvious invariants" gains bullets covering: transcluded scope is a child of the OUTER scope (not the directive's); the capture happens during compile BEFORE the OUTER walker descends into the children; multi-clone is supported and each clone's scope is registered against the host element's cleanup queue; `ng-transclude` fallback content is the marker element's pre-existing children when an optional slot is unfilled; `transclude: 'element'` is deliberately deferred and rejected at registration to keep the future addition non-breaking; the `$transclude` link argument is the 5th parameter (with `controllers` as a stable placeholder in the 4th slot until controllers ship)
    - [x] `CLAUDE.md` "Where to look when…" gains rows for: "How does `transclude: true` capture children?", "How does multi-slot routing decide which child fills which slot?", "How does `ng-transclude` find the captured content to project?"
    - [x] TSDoc on every new public export carries at least one runnable example. The example for `transclude: true` must show the consumer markup → captured-children → `$transclude(fn)` → projected DOM round-trip
    - [x] `src/compiler/README.md` gains a "Transclusion" section documenting: when to use `true` vs the object form, the multi-slot selector + optional-slot rules, the `ng-transclude` directive (default + named + fallback), the outer-scope rule with a worked example, the multi-clone pattern, the cleanup contract, and forward-pointers to the deferred items (`transclude: 'element'` lands with structural directives; `template`/`templateUrl` integration lands with the templates spec)

---

## 3. Scope and Boundaries

### In-Scope

- `transclude: true` (content transclusion) — directive captures its children at compile time
- `transclude: { slotName: 'tag-selector' }` (multi-slot transclusion) with the `?` prefix for optional slots
- Default slot for un-matched children in multi-slot directives
- `$transclude` exposed as the 5th argument to `link` / `pre` / `post` and the 3rd argument to `compile`
- `$transclude(cloneAttachFn?, futureParent?, slotName?)` signature; multi-clone supported via repeated calls
- Transcluded scope is a child of the OUTER scope (AngularJS-canonical) and is registered against the host element's cleanup queue
- `ng-transclude` directive ships now on the `ng` module — default slot, named slot, fallback content for empty optional slots, restrict `'EA'`
- Errors during slot resolution, `cloneAttachFn` execution, transcluded-directive link, and `ng-transclude` misuse all route through `$exceptionHandler` with cause `'$compile'`; no new cause token
- Backwards-compatible widening of `LinkFn` / `CompileFn` types to include the optional `$transclude` parameter
- TSDoc + `src/compiler/README.md` "Transclusion" section + `CLAUDE.md` updates
- Tests under `src/compiler/__tests__/*.test.ts` covering capture, multi-slot routing, scope semantics, multi-clone, cleanup, `ng-transclude`, and the error surface

### Out-of-Scope

- **Element transclusion (`transclude: 'element'`)** — the directive captures its own element. Rejected at registration in this spec so the future addition is non-breaking. Lands with the structural-directives spec (companion to `ng-if` / `ng-repeat`)
- **`ng-if`, `ng-repeat`, `ng-switch`, `ng-include`** — built-in structural directives that USE transclusion; ship in the dedicated Built-in Directives spec
- **`template` / `templateUrl` DDO options** — separate roadmap bullet "Template Loading". This spec documents the manual-DOM-setup pattern for the transitional period
- **`replace: true` DDO option** — same roadmap bullet; deferred
- **Controllers and `require` DDO** — separate roadmap bullet "Controllers (`$controller`)". The 4th link argument `controllers` stays an undefined placeholder in this spec for signature stability
- **Isolate scope (`scope: {...}`)** — already rejected at registration in spec 017; deferred to its own spec
- **`bindToController`, `controllerAs`** — depend on controllers; deferred with that spec
- **Multi-element directives (`multiElement: true`, `*-start` / `*-end` pairs)** — deferred with `ng-repeat`
- **Application Bootstrap (`bootstrap`, `bootstrapInjector`, `autoBootstrap`)** — separate roadmap bullet. Tests in this spec construct the injector via `createInjector([…, 'ng'])` and call `$compile(node)(scope)` explicitly
- **Module DSL `.directive`** — separate roadmap bullet; in this spec, all registration goes through `$compileProvider.directive(...)`
- **Performance optimizations** — straightforward deep-clone via `Node.cloneNode(true)` and per-clone scope creation. No node pooling, no diffing, no memoization. Performance is acceptable for the target audience (learning, parity); a future spec may revisit
- **Phase 5 `angular.module` namespace** — inherits transclusion behavior for free once `.directive` is wired; no extra work here
- **Service Text Diagrams (Phase 2 wrap-up)** — the transclusion diagram lands with that wrap-up
- **`$q`, `$timeout`, `$interval`, `$http`, Forms, Routing, Animations** — separate phases per the roadmap
