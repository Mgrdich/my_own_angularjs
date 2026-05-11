# Technical Specification: DOM Compiler — `$compile` with Pre/Post Linking

- **Functional Specification:** [`functional-spec.md`](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

The compiler ships as a new first-party module under `src/compiler/` following the **ESM-first factory + DI provider shim** pattern already proven by `sce`, `interpolate`, `sanitize`, and `filter`:

- **`createCompile(options)`** — pure ESM factory. Takes a `CompileOptions` bag (`directiveRegistry`, `injector`, `interpolate`, `exceptionHandler`, `flags`) and returns a `CompileService` callable: `(node) => Linker`.
- **`$CompileProvider`** — DI-only class registered on `ngModule`. Owns the directive registry (config-phase), exposes `directive(name, factory)` + object-form, and constructs the `CompileService` from `$get` by passing the captured registry plus injected collaborators (`$injector`, `$interpolate`, `$exceptionHandler`).
- **`$compile`** — the run-phase callable, identical to what `createCompile` returns.

Tree-walking is single-pass and recursive. Each invocation of the walker on a node:

1. **Collects** all matched directives (E/A/C/M restrict modes), sorts by priority (descending) with registration-order tie-break, and applies the `terminal` short-circuit cutoff.
2. **Runs each directive's compile function** in priority order on the node (mutations to the element are visible to children).
3. **Recurses into children** to produce a child composite linker.
4. **Returns a composite linker** for the node that, when invoked with a scope, runs pre-link top-down and post-link bottom-up across the subtree.

Cross-cutting integrations:

- **`$exceptionHandler` integration** — a new `'$compile'` cause token (10th entry in `EXCEPTION_HANDLER_CAUSES`) wraps factory invocation, compile, pre-link, post-link, and `$observe` callbacks. Sibling/ancestor work continues per the spec-014 contract.
- **`$interpolate` integration for `attrs.$observe`** — interpolated attribute values are detected at link time; a per-attribute `$watch` is installed **lazily** the first time any observer registers, not eagerly for every element.
- **Child-scope cleanup** — element-scoped private properties (`(element as any).$$ngScope`, `(element as any).$$ngCleanupQueue`) plus an internal `destroyElementScope(element)` helper that future structural directives (`ng-if`, `ng-repeat`, …) call before removing nodes. No `MutationObserver`, no public destroy API.

The `EXCEPTION_HANDLER_CAUSES` token list grows by exactly one entry; the rest of the tooling (`@compiler/*` alias, `./compiler` package export, Rollup entry) gains real content where empty placeholders already exist.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. Module Layout

New files under `src/compiler/`:

| File | Responsibility |
| --- | --- |
| `index.ts` | Public barrel: re-exports `createCompile`, `compile` default, `Attributes`, `directiveNormalize`, all directive types |
| `compile.ts` | `createCompile` ESM-first factory + the recursive tree walker + composite-linker assembly |
| `compile-provider.ts` | `$CompileProvider` class — config-phase registry + `directive(name, factory)` + object form + `$get` |
| `directive-collector.ts` | Per-node matching engine: scans element/attribute/class/comment matches against the registry, sorts by priority, applies `terminal` |
| `directive-normalize.ts` | `directiveNormalize(name)` helper — strips `(x\|data)[:\-_]` prefix, camelizes `[:\-_]` separators (AngularJS-canonical) |
| `attributes.ts` | `Attributes` class — read access, `$set`, `$observe`, integration with `$interpolate` |
| `cleanup.ts` | `destroyElementScope(element)` + private element-property keys (`$$ngScope`, `$$ngCleanupQueue`) — the spec-017 cleanup hook |
| `directive-types.ts` | Public TS types: `Directive`, `DirectiveFactory`, `LinkFn`, `CompileFn`, `Attributes`, `CompileService` |
| `compile-error.ts` | Typed error classes: `InvalidDirectiveNameError`, `InvalidDirectiveFactoryError`, `IsolateScopeNotSupportedError` (mirrors `filter-error.ts`) |
| `README.md` | Developer-facing module docs (registration patterns, restrict examples, compile-vs-link guidance, raw-`Element` rationale, deferred items) |

Tests under `src/compiler/__tests__/`:

| Test file | Concern |
| --- | --- |
| `compile.test.ts` | `$compile(node)(scope)` happy paths; idempotent linker; multiple-link invocations |
| `compile-provider.test.ts` | `$compileProvider.directive` + object form; chainability; phase guard |
| `directive-normalize.test.ts` | All normalization cases (kebab/camel, `data-`, `x-`, `:`, `_`, mixed) |
| `restrict-modes.test.ts` | E / A / C / M / EAC / EACM / unknown letters |
| `priority-and-terminal.test.ts` | Descending priority sort; registration-order tie-break; terminal short-circuit |
| `compile-phase.test.ts` | Compile-time DOM mutation visible to children; runs once per template |
| `pre-link.test.ts` | Top-down ordering; descending priority on a node; exception routing |
| `post-link.test.ts` | Bottom-up ordering; ascending priority on a node; sugar form |
| `attributes.test.ts` | Read access, `$attr` map, `$set` (DOM sync, observer notification, `writeAttr` flag) |
| `attributes-observe.test.ts` | `$observe` on static + interpolated attrs; lazy watch install; deregistration; exception routing |
| `scope-true.test.ts` | `scope: true` creates one child scope per element; mixed siblings; isolate-scope rejection |
| `multiple-directives.test.ts` | Same-name accumulation; both factories run on a single node |
| `comment-directives.test.ts` | `<!-- directive: name value -->` syntax variants |
| `class-directives.test.ts` | `class="my-dir"` and `class="my-dir: value;"` syntax |
| `exception-handler.test.ts` | `'$compile'` cause routing for factory / compile / link / observe errors; sibling continuation |

### 2.2. `createCompile` ESM Factory

Signature (described — not a code drop):

- Inputs: a `CompileOptions` bag with named collaborators
  - `getDirectivesByName(name: string): Directive[]` — returns the array of accumulated directives for a normalized name (the registry lookup function the provider wires in)
  - `injector: Injector` — for invoking directive factories (`$injector.invoke(factory, …)`)
  - `interpolate: InterpolateService` — for `attrs.$observe` integration
  - `exceptionHandler: ExceptionHandler` — for the `'$compile'` cause routing
  - `flags?: { commentDirectivesEnabled?: true; cssClassDirectivesEnabled?: true }` — reserved for future toggles; default `true` when omitted (toggle config out of scope per FS §3 Out-of-Scope; flags exist in the type to avoid a future signature break)
- Output: `CompileService` — `(node: Element | NodeList | Comment) => Linker`
- `Linker`: `(scope: Scope) => Element | NodeList | Comment` — same node reference returned

The factory's body is the tree walker. It does not own the directive REGISTRY (that lives on the provider) — it only consumes the lookup function `getDirectivesByName`. This keeps the provider responsible for config-phase state and the factory a pure function of its dependencies.

### 2.3. `$CompileProvider` DI Shim

Class shape mirrors `$FilterProvider` (`src/filter/filter-provider.ts:33`):

- Constructor takes `$provide` for registering each directive's underlying provider as `<name>Directive`.
- Private state: `$$registeredNames: Set<string>` — used for fast `getDirectivesByName` lookups without re-querying the injector for every walk.
- Public methods:
  - `directive(name: string, factory: DirectiveFactory): this` — single-form registration
  - `directive(map: Record<string, DirectiveFactory>): this` — object-form batch registration; iterates keys and delegates to single-form
- `$get` is a static `as const` array (matches existing pattern):
  ```
  $get = [
    '$injector', '$interpolate', '$exceptionHandler',
    ($injector, $interpolate, $exceptionHandler) => createCompile({
      getDirectivesByName: (name) => /* injector.get(`${name}Directive`) when registered, else [] */,
      injector: $injector,
      interpolate: $interpolate,
      exceptionHandler: $exceptionHandler,
    }),
  ] as const;
  ```

**Multiple-factories-per-name implementation.** Each call to `$compileProvider.directive(name, factory)` does NOT replace the existing registration. Internally:

1. The first registration for `name` calls `$provide.provider('<name>Directive', { $get: ['$injector', ($injector) => buildDirectiveArray($injector, factories)] })` and adds `name` to `$$registeredNames`.
2. Subsequent registrations append to the captured `factories` closure array. The provider object is the SAME reference, so the closure mutates and `$get` returns the updated array on the next lookup.
3. The `<name>Directive` provider's `$get` invokes each factory via `$injector.invoke(factory)` (lazy), normalizes the result (function → `{ link: fn, restrict: 'EA' }`), validates `scope` (rejecting `{...}` per FS §2.4), and assigns each directive an `index` matching its position in the global registration order.
4. `getDirectivesByName(name)` becomes `$$registeredNames.has(name) ? $injector.get(name + 'Directive') : []`.

This mirrors AngularJS exactly and means a future `module.directive` DSL is a one-line config block over `$compileProvider.directive` (deferred per FS §2.2).

### 2.4. Tree Walker Algorithm

A single recursive function `compileNode(node)`:

1. **If `node` is an `Element`:**
   - Run the matching engine (`directive-collector.ts`) to produce `directives: Directive[]` sorted by descending priority.
   - Apply `terminal`: keep all entries with priority `>= terminalPriority` (the highest priority observed where `terminal === true`); discard the rest.
   - Build a fresh `Attributes` instance for the node (one per element, shared across all directives on it).
   - For each remaining directive in priority order, invoke `directive.compile(node, attrs)` — track the returned link entry (function or `{ pre, post }`) in `nodeLinkFns: NodeLinkEntry[]`.
   - Recurse into `node.children` to produce a `childLinker` (a list of child node-linker functions matching the iteration order).
   - Return a `nodeLinker(scope)` closure that:
     - If any directive on this element declared `scope: true`, calls `scope = parentScope.$new()` and stores `scope` on `(node as any).$$ngScope`. The same created scope is shared across all directives on the element.
     - Runs all `pre` link functions (in descending priority order)
     - Calls `childLinker(scope)` (recursing into children — child pre-link runs top-down naturally)
     - Runs all `post` link functions (in ASCENDING priority order — bottom-up reversal on a single node)
     - Each link function call is wrapped in `try/catch` and routes thrown errors via `invokeExceptionHandler(handler, err, '$compile')`
   - Document this nodeLinker in `(node as any).$$ngCleanupQueue` IF a child scope was created (so `destroyElementScope` later can `$destroy` it).

2. **If `node` is a `Comment` and class/comment directives are enabled:**
   - Parse the comment text against `^\s*directive:\s*(\S+)\s*(.*?)\s*$/i`. If a match is found and the directive is registered with `restrict` containing `'M'`, treat it like an element with one directive matched and a single attribute (`attrs[normalized] = value`).

3. **For `Text` and other node types:** return a no-op linker.

The tree walker returns a `Linker` for the root call. `Linker(scope)` walks the tree and returns the root node(s) reference unchanged.

### 2.5. Directive Matching Engine (`directive-collector.ts`)

For each `Element` node, collect candidates from FOUR sources:

1. **Element-name match (E):** `directiveNormalize(node.tagName.toLowerCase())` → registry lookup.
2. **Attribute matches (A):** iterate `node.attributes`; for each attr, `directiveNormalize(attrName)` → registry lookup; populate `attrs[normalized] = attrValue` and `attrs.$attr[normalized] = attrName` regardless of whether a directive is registered (so directives can read sibling attributes on the same node).
3. **Class matches (C):** if `cssClassDirectivesEnabled !== false`, parse `node.className` token-by-token; recognize the `name: value;` syntax. For each class token, `directiveNormalize(className)` → registry lookup; populate `attrs[normalized] = ''` (or the parsed value).
4. **Comment matches (M):** handled at the tree-walker level for `Comment` nodes; `attrs[normalized] = trailing-text`.

After collection, filter each candidate's `restrict` string for the corresponding letter ('E', 'A', 'C', 'M'). Drop candidates whose `restrict` does not include the source letter.

Sort the surviving candidates:
- Primary: `priority` descending
- Tie-break: `index` ascending (registration order — stamped during provider initialization in §2.3)

Apply `terminal`: walk the sorted list; the first directive with `terminal: true` records `terminalPriority = directive.priority`. Any directive AFTER it with priority `< terminalPriority` is dropped from the matched list. Same-priority directives are NOT dropped.

### 2.6. `Attributes` Class

State (described in tabular form rather than code):

| Field | Shape | Purpose |
| --- | --- | --- |
| Indexed string properties | `[normalizedName: string]: string \| undefined` | Normalized attribute values (`attrs.myAttr === 'value'`) |
| `$attr` | `Record<string, string>` | Maps normalized names → original DOM names (used by `$set` for the un-normalized DOM write) |
| `$$element` | `Element` (non-enumerable) | The bound element — used by `$set` to write back to DOM |
| `$$observers` | `Map<string, ObserverEntry[]>` (non-enumerable) | Per-attribute observer lists; lazily populated |
| `$$interpolators` | `Map<string, InterpolateFn>` (non-enumerable) | Cached parsed interpolation fns from `$interpolate` for attrs containing `{{...}}` |

Public methods:

- **`$set(name, value, writeAttr = true)`** — updates `attrs[name]`, optionally writes the DOM attribute via `$$element.setAttribute($attr[name] ?? camelToKebab(name), value)`, then notifies all observers in `$$observers.get(name)` either synchronously (outside a digest) or via `scope.$evalAsync(...)` (inside one). `value === null` removes the attribute from `attrs` and from the DOM (`removeAttribute`).
- **`$observe(name, fn)`** — appends `fn` to `$$observers.get(name)`. On registration:
  1. Looks up the cached `$$interpolators.get(name)`. If unset:
     - Calls `interpolate(attrs[name], true)` (truthy `mustHaveExpression`)
     - If the result is `undefined`, the attribute is static — fire `fn(attrs[name])` once via `scope.$evalAsync(...)` to honor the "fires initially with the resolved value" contract, and store a flag so future `$observe` calls on the same static attribute also fire once but don't install a watch
     - If the result is an `InterpolateFn`, store it in `$$interpolators` AND install a per-attribute `scope.$watch(interpolateFn, watchListener)` exactly ONCE (subsequent `$observe` calls reuse the existing watch). The watch listener reads the new interpolated value and calls `$set(name, value, false)` — `writeAttr === false` because we don't want to thrash the DOM mid-digest; the DOM is updated separately by built-in attribute directives like `ng-href` (deferred).
  2. Returns a deregistration closure that splices `fn` from `$$observers.get(name)`.
- All observer invocations are wrapped in `invokeExceptionHandler` with cause `'$compile'`.

The scope used by `$observe`'s `$watch` is the linked element's scope at link time. Since `$observe` is meant to be called from inside link functions, the link function captures `scope` from its own arguments and forwards it into `attrs.$observe.bind(attrs, scope)` — see §2.7 for the exact wiring.

### 2.7. Linker Composition + Scope Wiring

When the per-node linker runs:

1. Determine `scope`: if any matched directive on the node has `scope: true`, call `parentScope.$new()` and stash on `(node as any).$$ngScope`; otherwise reuse the parent scope.
2. Bind `attrs` to `scope`. Internally `attrs` exposes `$observe(name, fn)` — but `$observe` must know the SCOPE to install the watch on. This is wired via a scope-bound view: at link time, the linker creates a thin `boundAttrs` that delegates `$observe(name, fn)` calls to a per-element `attrsObserve(scope, attrs, name, fn)` helper (in `attributes.ts`). All other Attributes API surface (`$set`, indexed reads, `$attr`) is identical and forwarded.
3. Pass `(scope, node, boundAttrs)` to each pre-link function in priority-descending order.
4. Recurse into children with the chosen `scope`.
5. Pass `(scope, node, boundAttrs)` to each post-link function in priority-ASCENDING order.

If `parentScope.$new()` was called, register a cleanup callback on the parent's nearest cleanup-tracked element so that when an ancestor is destroyed, the chain of child scopes is destroyed too. (See §2.8.)

### 2.8. Element-Scoped Cleanup Registry (`cleanup.ts`)

Two private element properties (assigned with `Object.defineProperty(node, name, { writable: true, configurable: true, enumerable: false })` to keep them off `for..in` traversal):

- `(element as any).$$ngScope: Scope | undefined` — the child scope created for this element (if any).
- `(element as any).$$ngCleanupQueue: (() => void)[] | undefined` — additional cleanup callbacks registered by directives or by the compiler itself.

Public-internal helper:

- **`destroyElementScope(element: Element): void`** — exported from `@compiler/cleanup` (used internally by future `ng-if`, `ng-repeat`, etc., and by tests). Recurses into descendants depth-first; for each descendant element, runs all entries in `$$ngCleanupQueue` (in insertion order, even on throw), then if `$$ngScope` is set, calls `$$ngScope.$destroy()`. Then runs the element's own `$$ngCleanupQueue` and `$$ngScope.$destroy()`. Errors during cleanup are routed via `$exceptionHandler('$compile')`.

The compiler does NOT call `destroyElementScope` itself in this spec — it only wires the registry. Built-in directives that ship in later specs (`ng-if`, `ng-repeat`, etc.) are responsible for calling `destroyElementScope(node)` BEFORE removing nodes from the DOM. This contract is documented in `src/compiler/README.md` so spec authors of future structural directives know about it.

### 2.9. Directive Normalization (`directive-normalize.ts`)

Pure function. Two phases:

1. **Strip prefix:** apply `/^((?:x|data)[:\-_])/i` to the input; if matched, drop the prefix.
2. **Camelize separators:** apply `/[:\-_]+(.)?/g` and replace each match with the uppercase of the captured letter (or empty if none).

Examples (test vectors):
- `my-directive` → `myDirective`
- `data-my-directive` → `myDirective`
- `x-my-directive` → `myDirective`
- `my:directive` → `myDirective`
- `my_directive` → `myDirective`
- `data:my:directive` → `myDirective`
- `MY-DIR` → `MYDir` (input preserves uppercase letters; the algorithm only camelizes the character AFTER each separator)

Same algorithm AngularJS 1.x has shipped for over a decade (`directiveNormalize` in `compile.js`). Direct port; no novel logic.

### 2.10. `EXCEPTION_HANDLER_CAUSES` Public-API Update

Edit `src/exception-handler/exception-handler-types.ts:83-93`:

- Add `'$compile'` as the 10th entry in the `Object.freeze([...])` tuple, immediately after `'$filter'`.
- Update the leading TSDoc block (lines 4-14) to document `'$compile'` — the cause used by the DOM compiler for errors thrown by directive factory invocation, compile functions, pre-link functions, post-link functions, and `$observe` callbacks.

This is a public-API additive change, called out in `CLAUDE.md` and the changelog (per the spec-016 precedent for `'$filter'`).

### 2.11. `$compile` and `$compileProvider` Registration on `ngModule`

Edit `src/core/ng-module.ts` to register the new provider alongside the existing ones:

- After the line registering `$FilterProvider` (or following the conventional alphabetical/topological order of providers in that file), add `.provider<'$compile', CompileService, $CompileProvider>('$compile', $CompileProvider)`.
- Confirm `$compile` becomes resolvable as a service: `injector.get('$compile')` returns the `CompileService` callable; `injector.get('$compileProvider')` is unavailable at run-phase per the spec-015 phase guard (provider names are config-only).

### 2.12. TypeScript Path Alias and Test Alias

- Add `"@compiler/*": ["./src/compiler/*"]` to `tsconfig.json:14-22` `paths`.
- Add `'@compiler': path.resolve(__dirname, 'src/compiler')` to `vitest.config.ts:6-15` `resolve.alias`.

`rollup.config.mjs` and `package.json` already include the `./compiler` build entry (currently re-exporting `{}`); this spec populates it.

### 2.13. Public API Surface (Root Barrel Updates)

Edit `src/index.ts` to re-export the new public surface:

- `createCompile`, `compile` (default — pure-DOM ESM-first instance for use in tests/SSR scenarios that don't need DI; matches the `interpolate` / `sce` / `sanitize` / `filter` precedent)
- `Attributes` class (type)
- Types: `Directive`, `DirectiveFactory`, `LinkFn`, `CompileFn`, `PreLinkFn`, `PostLinkFn`, `CompileService`, `Linker`
- `directiveNormalize` helper (named export — used by tests, potentially by future `ng-bind-html` slice)

### 2.14. Documentation Updates

- **`src/compiler/README.md`** — new file mirroring `src/sanitize/README.md` and `src/filter/README.md`. Sections: "Registering a directive", "Restrict modes (E / A / C / M)", "Priority + terminal", "Compile vs link (when to reach for which)", "Attributes ($set / $observe)", "Why raw DOM `Element` instead of jqLite", "Deferred items (isolate scope, transclusion, templates, controllers, multi-element)".
- **`CLAUDE.md`** updates per FS §2.20:
  - Modules table row for `./compiler` (replacing "Reserved for future DOM compiler" with the actual export list).
  - "Non-obvious invariants" bullets covering: directive registration accumulates per name (no last-wins); compile-phase mutation runs once per template; `$observe` lazily installs the per-attribute watch on first observer; `'$compile'` cause token added; isolate scope intentionally rejected at registration; raw `Element` argument is deliberate.
  - "Where to look when…" rows: tree walking → `src/compiler/compile.ts`; name normalization → `src/compiler/directive-normalize.ts`; `$observe` interpolation wiring → `src/compiler/attributes.ts`; child-scope cleanup → `src/compiler/cleanup.ts`.

---

## 3. Impact and Risk Analysis

### System Dependencies

**Core consumers of `$compile`:**
- None today — `src/compiler/index.ts` is currently an empty barrel.
- After this spec: future `ng-bind-html` (HTML Sanitization roadmap leaf already deferred), `bootstrap` (Application Bootstrap roadmap item), every built-in directive, every user-defined directive.

**`$compile`'s own dependencies (read at `$get` time):**
- **`$injector`** — to invoke directive factories lazily and to resolve the per-name `<name>Directive` arrays.
- **`$interpolate`** — to detect interpolated attributes and watch them.
- **`$exceptionHandler`** — to route errors with the new `'$compile'` cause.

These three already exist on `ngModule`; no new run-phase dependencies are introduced.

**Public-API additions (changelog-worthy):**
- `EXCEPTION_HANDLER_CAUSES` gains `'$compile'` (10th entry, additive).
- `./compiler` package export transitions from empty barrel to the full surface listed in §2.13.
- Root barrel (`src/index.ts`) re-exports the new compiler types and factories.
- `tsconfig.json` and `vitest.config.ts` gain a new path alias.

**Behavior of existing modules unchanged:**
- `Scope`, `parser`, `injector`, `module`, `interpolate`, `sce`, `sanitize`, `exception-handler`, `filter` all continue to work without modification.
- Existing test suites for specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016 pass unchanged.

### Potential Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Tree walker fails to handle `DocumentFragment` or `Document` root inputs | Med | Med | FS §2.1 limits accepted input to `Element` / `NodeList` / `Comment`. The walker rejects other node types via a typed signature; `Document` is out of scope. Document this as a `Linker` precondition; users wrap roots in a single `Element` before calling `$compile`. |
| Per-attribute `$watch` install path leaks watches when an element is removed before any digest fires | Med | High | The lazy watch is installed on `scope`, not on `attrs`. When the parent (or own) `Scope.$destroy()` runs, the watcher list is cleared — standard scope-tree cleanup. The risk surfaces only if `scope` is the ROOT scope (never destroyed) AND the element is removed without `destroyElementScope` being called. Built-in structural directives (future) MUST call the cleanup helper; this is documented in `src/compiler/README.md` and `CLAUDE.md` invariants. |
| Multiple-factories-per-name introduces ordering surprises across modules | Low | Med | Registration order is deterministic and is the documented tie-break (FS §2.7). Tests in `priority-and-terminal.test.ts` cover same-priority registration-order ties across modules. |
| `$set` mid-digest re-entrancy when an observer triggers another `$set` on the same attr | Low | High | `$set` schedules observer notification via `scope.$evalAsync` when called inside a digest. This is the same pattern AngularJS uses; the spec-014 contract bounds re-entrancy at TTL. Tests in `attributes.test.ts` cover the inside-digest path. |
| `directiveNormalize` regex is hot-path; called for every attribute on every element during walk | Low | Low | Same regex AngularJS has shipped at scale for a decade. The `directiveNormalize` function memoizes per-call inputs via a small `Map<string, string>` to avoid re-running the regex for repeated attribute names across the same compile. Memoization is private to the module. |
| Comment-directive parsing collides with non-AngularJS HTML comments | Low | Low | The `^\s*directive:` prefix is case-sensitive (matches AngularJS). Comments not starting with `directive:` are unaffected. Tested explicitly. |
| `$$ngScope` / `$$ngCleanupQueue` private element properties collide with consumer-set properties | Low | Low | Properties are non-enumerable and namespaced with the AngularJS-canonical `$$` prefix (matches every other framework-internal field). Documented in `cleanup.ts` and `README.md`. |
| `$observe` initial-value firing semantics differ from AngularJS in subtle ways (sync vs. async, current digest vs. next) | Med | Med | FS §2.11 specifies "fires initially via `scope.$evalAsync(...)` so the first invocation lands in the next digest, regardless of whether the attribute is static or interpolated". Tests in `attributes-observe.test.ts` lock this contract. Direct port of AngularJS's `addAttrInterpolateDirective`-equivalent behavior. |
| Adding `'$compile'` to `EXCEPTION_HANDLER_CAUSES` is a public-API change consumers might not expect | Low | Low | Same precedent as spec-016 added `'$filter'`. Documented in changelog and `CLAUDE.md` invariants. The list is `Object.freeze`-d but extending it is purely additive. |
| Compile errors during the walk leave a partially-compiled tree if a sibling factory throws | Med | Med | FS §2.16 establishes the contract: errors are caught at each link/compile site, routed via `$exceptionHandler`, and the rest of the tree compiles/links. Tests in `exception-handler.test.ts` cover sibling continuation. The risk converts from a hard failure to a logged error, matching AngularJS's "log and continue" stance. |
| Linker idempotence: calling `linker(scope)` twice with different scopes accidentally shares state via the `Attributes` instance | Med | High | `Attributes` is created in the COMPILE phase and shared across all link invocations; this is AngularJS-canonical. State stored on `attrs` (e.g., observers from `$observe`) accumulates across linker calls. Tests in `compile.test.ts` cover this explicitly, and the `README.md` documents that `linker(scope1); linker(scope2)` is uncommon and should generally be avoided in production code. |
| `terminal: true` semantics: a directive with priority 0 + terminal blocks priority < 0 only — surprising for users expecting "block everything else" | Low | Low | Matches AngularJS exactly. Documented in `README.md` and `priority-and-terminal.test.ts`. |
| Isolate-scope rejection at registration is a hard breaking change if a user copy-pastes AngularJS code that uses `scope: {...}` | Med | Low | The error message is explicit: `Isolate scope is not yet supported (spec 017 ships only scope: false | true)`. Documented in FS §2.4 and §2.12. A future spec will lift this. |

---

## 4. Testing Strategy

### Test Framework and Environment

- **Framework:** Vitest (already configured).
- **DOM:** jsdom (already configured at `vitest.config.ts:19`). Every compiler test relies on jsdom's DOM implementation; `document.createElement`, `setAttribute`, `Comment`, `NodeList`, `Element.attributes` all exercise the real spec-compliant surface.
- **Coverage:** 90%+ on `src/compiler/` enforced via the existing V8 provider in `vitest.config.ts:21-25` (no threshold change needed).
- **Reference:** Test vectors ported from `angular/angular.js/test/ng/compileSpec.js` where applicable, with explicit comments citing the source-test name. This matches the project's reference-implementation convention (per `architecture.md` §2 line 133).

### Test Organization

One test file per concern (table in §2.1). Each file uses the AngularJS-canonical "register a directive, compile a fixture node, link with a scope, assert" pattern:

```ts
// Pseudocode shape — actual tests follow project conventions
const module = createModule('test', ['ng']);
module.config(['$compileProvider', ($cp) => $cp.directive('myDir', () => ({...}))]);
const injector = createInjector(['test']);
const $compile = injector.get('$compile');
const scope = Scope.create();

const node = document.createElement('div');
node.setAttribute('my-dir', 'value');
$compile(node)(scope);

expect(node.textContent).toBe('expected');
```

### Coverage by Concern

- **Unit tests:**
  - `directive-normalize.test.ts` — 100% line and branch coverage; pure-function tests with all prefix/separator combinations.
  - `compile-error.test.ts` — error class instantiation and message format.
  - `cleanup.test.ts` — `destroyElementScope` walks correctly, runs cleanup queues, calls `$destroy`, recovers from queue errors.

- **Integration tests:**
  - `compile.test.ts`, `compile-provider.test.ts` — end-to-end registration-to-link flow.
  - `restrict-modes.test.ts` — all four restrict modes and combinations.
  - `priority-and-terminal.test.ts` — sort order, ties, terminal short-circuit at multiple priority levels.
  - `compile-phase.test.ts`, `pre-link.test.ts`, `post-link.test.ts` — phase ordering with multiple directives and nested elements.
  - `attributes.test.ts`, `attributes-observe.test.ts` — `$set` and `$observe` semantics, including the lazy watch install and deregistration.
  - `scope-true.test.ts` — `scope: true` creates one child scope per element; mixed siblings (true + false) share the child; isolate-scope rejection error message.
  - `multiple-directives.test.ts` — same-name accumulation; both factories produce running directives.
  - `comment-directives.test.ts`, `class-directives.test.ts` — restrict modes M and C with full syntax variants.
  - `exception-handler.test.ts` — `'$compile'` cause routing for factory / compile / pre-link / post-link / observe errors; sibling continuation.

- **Cross-spec regression:**
  - All existing tests for specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016 must continue to pass unchanged (run as part of the normal `pnpm test`).
  - `EXCEPTION_HANDLER_CAUSES` addition is verified by `src/exception-handler/__tests__/*.test.ts` updates (one new assertion: `'$compile'` is the 10th token).

### Special Considerations

- **No real browser tests** — jsdom is sufficient and matches the rest of the project.
- **No performance benchmarks** — the project's stance per `CLAUDE.md` ("clarity over performance") and per the FS §3 Out-of-Scope "Performance optimizations".
- **Snapshot tests are NOT used** — assertions are explicit value/property checks per the existing testing convention in `src/sce/__tests__/`, `src/filter/__tests__/`, etc.
- **TypeScript compile-check tests** — for the rejected-isolate-scope case, the type-level rejection is enforced at registration time via runtime error; full type-level prevention (banning `scope: { … }` at the type signature) is deferred to a future spec when isolate-scope support lands and the type can carry a discriminated union.
