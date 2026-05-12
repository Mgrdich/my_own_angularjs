# Functional Specification: Template Loading — Inline `template` + Async `templateUrl`

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Directives & DOM Compilation (Template Loading)
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 017 shipped `$compile` with compile + pre-link + post-link phases. Spec 018 added transclusion. What's still missing is the AngularJS-canonical mechanism that lets a directive declare its own **DOM chrome** rather than building it imperatively inside a link function — known as **template loading**.

Today, a directive that wants to render `<div class="card"><h2>title</h2><slot/></div>` around its element's content must imperatively assemble those nodes inside `link` and re-invoke `$compile` on them. That works, but it forces every wrapper directive to repeat the same template-installation boilerplate, and it is divergent from every AngularJS tutorial. A developer cannot write this and have it just work:

```html
<my-card title="Account settings">
  <p>{{vm.description}}</p>
</my-card>
```

```js
$compileProvider.directive('myCard', () => ({
  restrict: 'E',
  scope: true,
  transclude: true,
  template:
    '<div class="card"><h2>{{title}}</h2><div ng-transclude></div></div>',
}));
```

…because `template` is silently accepted at registration today (spec 017's forward-compat) but produces no observable behavior. This spec wires it up.

This spec adds the AngularJS-canonical template-loading model to `$compile`:

1. **`template: '<html-string>'`** — inline template; replaces the directive element's children with the parsed template before compile descends into the new subtree.
2. **`template: (element, attrs) => '<html-string>'`** — function form; computed at compile time with access to the host element + its attributes.
3. **`templateUrl: '/path/to/tpl.html'`** — async template URL; fetched via `$templateRequest` (which caches via `$templateCache`); compile resumes once the template arrives.
4. **`templateUrl: (element, attrs) => '/path/to/tpl.html'`** — function form for computed URLs.
5. **`$templateCache`** — new singleton service exposing `put(key, content)`, `get(key)`, `remove(key)`, `removeAll()`. Programmatic API for apps that want to seed templates at boot or override fetched content.
6. **`$templateRequest`** — new service: `(url, ignoreRequestError?) => Promise<string>`. Reads from `$templateCache` first; on miss, fetches via native `fetch`, stores the response, and returns it. Public DI seam so a future spec can decorate (e.g., add auth headers) or swap to `$http` once Phase 3 lands.
7. **Async compile semantics** — `$compile(element)(scope)` still returns a synchronous linker (spec-017 contract preserved). When `templateUrl` directives exist, the linker fires immediately; the element is empty until the fetch resolves, then the deferred subtree compiles + links in a microtask. No public type change.
8. **Integration with `transclude: true`** — the canonical wrapper pattern works end-to-end: consumer children are captured (spec 018), the template replaces them, and `<ng-transclude>` inside the template projects the captured content back into a chosen slot. Transcluded scopes bind against the OUTER scope (spec 018's contract preserved).
9. **Errors route through `$exceptionHandler` with the existing `'$compile'` cause token** — no new entry to `EXCEPTION_HANDLER_CAUSES`. Network failures, template-parse failures, multiple-template-directives, and function-form throws all route through the same handler the rest of `$compile` uses.

**Concrete success criteria:**

- A directive declaring `template: '<div>...</div>'` whose host element is `<my-dir></my-dir>` ends up rendered as `<my-dir><div>...</div></my-dir>` after compile + link; the template's interpolated expressions resolve against the directive's scope.
- A directive declaring `templateUrl: '/tpl/card.html'` whose host element is `<my-card></my-card>` triggers a `fetch('/tpl/card.html')` on first compile; subsequent compiles read from `$templateCache` (one fetch per URL across the lifetime of the app, by default).
- `$compile(element)(scope)` returns synchronously even when `templateUrl` directives exist. The element is empty immediately after the linker returns; once the fetch resolves (in a microtask), the template is installed and child link runs.
- A `transclude: true` + `template` directive (the wrapper pattern) successfully projects consumer children through an `<ng-transclude>` marker inside the template, bound to the OUTER scope per spec 018 §2.5.
- All tests from prior specs (002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018) continue to pass; behavior is purely additive.

---

## 2. Functional Requirements (The "What")

### 2.1. Inline `template` — String Form

- A directive opts into inline templating by declaring `template: '<html-string>'` on its Directive Definition Object. The string is parsed as HTML and replaces the directive element's children.
  - **Acceptance Criteria:**
    - [ ] `$compileProvider.directive('myDir', () => ({ template: '<p>hi</p>' }))` registers successfully and renders `<p>hi</p>` as the directive element's only child after compile + link
    - [ ] Existing children of the directive element are REPLACED by the template content (the directive's own consumer-supplied children are silently discarded UNLESS `transclude: true | { … }` is ALSO declared — §2.9 for the wrapper-pattern path)
    - [ ] The template runs through the standard `$compile` walker — directives inside the template register normally and link against the host directive's scope
    - [ ] Interpolation expressions inside the template (`{{title}}`) resolve against the host directive's scope at link time
    - [ ] An empty template (`template: ''`) is rejected at registration with `Invalid template for directive <name>: empty string` — routed via `$exceptionHandler('$compile')`
    - [ ] A non-string, non-function `template` value (`42`, `null`, `{}`, `[]`) is rejected at registration with `Invalid template value for directive <name>: <description>` — routed via `$exceptionHandler('$compile')`
    - [ ] A template string with MULTIPLE root nodes (`'<h2>a</h2><p>b</p>'`) is supported — all roots become siblings under the directive element
    - [ ] A template string with text-only content (`'just text'`) is supported — the host element's text content is replaced
    - [ ] Template installation runs BEFORE the directive's own `compile` function on the host element — the `compile` fn sees the post-template DOM
    - [ ] Template installation runs BEFORE the walker descends into the directive's children — child directives in the TEMPLATE compile, not in the original consumer content

### 2.2. Inline `template` — Function Form

- A directive may declare `template: (element, attrs) => '<html-string>'`. The function is invoked exactly once at compile time per host element with the raw `Element` and the populated `Attributes` instance; the returned string is treated identically to the string form.
  - **Acceptance Criteria:**
    - [ ] `template: (el, attrs) => '<p>' + attrs.label + '</p>'` registers successfully; on `<my-dir label="hi"></my-dir>`, the rendered output is `<my-dir><p>hi</p></my-dir>`
    - [ ] The function receives the raw host `Element` as its first argument and the `Attributes` instance as the second (same shape spec 017 passes to `compile` functions)
    - [ ] The function is called EXACTLY ONCE per host element (memoized for that compile invocation); two `linker(scope1); linker(scope2)` calls share the SAME computed template string
    - [ ] A function that returns a non-string value (`undefined`, `null`, `42`, an object) is rejected at compile time with `Template function for directive <name> returned a non-string value: <description>` — routed via `$exceptionHandler('$compile')`; the directive's element stays empty
    - [ ] A function that THROWS is routed through `$exceptionHandler('$compile')`; the directive's element stays empty; siblings and the rest of the compile continue
    - [ ] The function form is mutually exclusive with the string form — declaring both `template: '…'` AND `template: () => …` on the same DDO is impossible per JS object literal semantics (the latter wins); no spec-imposed extra check needed
    - [ ] The function form combined with `transclude: true | { … }` works identically to the string form — consumer children are captured before the template installs (§2.9)

### 2.3. Async `templateUrl` — String Form

- A directive may declare `templateUrl: '/path/to/tpl.html'`. The compiler delegates fetching to `$templateRequest`, which reads from `$templateCache` first and falls back to a `fetch` call. The directive's compile + link is deferred until the template arrives.
  - **Acceptance Criteria:**
    - [ ] `$compileProvider.directive('myDir', () => ({ templateUrl: '/tpl.html' }))` registers successfully
    - [ ] On first compile of `<my-dir></my-dir>`, `$templateRequest('/tpl.html')` is invoked exactly once. The element's children remain empty until the fetch resolves
    - [ ] Once the fetch resolves, the returned HTML string is installed as the element's children, the directive's own compile/link runs against the post-template DOM, and child directives in the template compile + link
    - [ ] Subsequent compiles of `<my-dir></my-dir>` (e.g. another instance in the same document, or a fresh tree via `$compile(otherNode)`) READ FROM `$templateCache` — no additional `fetch` is made for the same URL
    - [ ] `$compile(element)(scope)` returns synchronously per spec 017's `Linker` contract; templates resolve in a microtask after the linker has already returned
    - [ ] `templateUrl` is mutually exclusive with `template` on the same DDO — declaring both throws `Cannot combine template and templateUrl on directive <name>; choose one` at registration time, routed via `$exceptionHandler('$compile')`
    - [ ] A non-string, non-function `templateUrl` value is rejected at registration with `Invalid templateUrl value for directive <name>: <description>` — routed via `$exceptionHandler('$compile')`
    - [ ] An empty `templateUrl` string is rejected at registration with `Invalid templateUrl for directive <name>: empty string` — routed via `$exceptionHandler('$compile')`
    - [ ] If the `fetch` rejects (network error, 404, CORS failure), the error is routed via `$exceptionHandler('$compile')` with a descriptive message (`Failed to load template "<url>" for directive <name>: <reason>`). The directive's element stays empty. Sibling directives and downstream compiles continue unaffected
    - [ ] Multiple `<my-dir>` instances compiled before the first fetch resolves all wait on the SAME in-flight promise — `$templateRequest` deduplicates concurrent fetches for the same URL

### 2.4. Async `templateUrl` — Function Form

- A directive may declare `templateUrl: (element, attrs) => '/computed/path.html'`. The function is invoked once at compile time per host element; the returned string is used as the URL.
  - **Acceptance Criteria:**
    - [ ] `templateUrl: (el, attrs) => '/tpl/' + attrs.kind + '.html'` registers; on `<my-dir kind="card"></my-dir>`, `$templateRequest('/tpl/card.html')` is invoked
    - [ ] The function receives the raw host `Element` and the `Attributes` instance, identical to §2.2
    - [ ] The function is called EXACTLY ONCE per host element
    - [ ] A function returning a non-string value is rejected at compile time with `templateUrl function for directive <name> returned a non-string value: <description>` — routed via `$exceptionHandler('$compile')`; the element stays empty
    - [ ] A function that throws is routed via `$exceptionHandler('$compile')`; the element stays empty; siblings continue

### 2.5. `$templateCache` Service

- A new core service registered on `ngModule`. Simple Map-backed string store keyed by template URL (or arbitrary string for app-seeded templates). API:
  - `put(key: string, content: string): string` — stores the content, returns it for chaining convenience
  - `get(key: string): string | undefined` — reads
  - `remove(key: string): void`
  - `removeAll(): void`
  - `info(): { id: 'templates'; size: number }` — AngularJS-canonical introspection helper
  - **Acceptance Criteria:**
    - [ ] `injector.get('$templateCache')` returns the service after `createInjector(['ng'])`
    - [ ] `$templateCache.put('/tpl.html', '<p>hi</p>')` stores the content; `$templateCache.get('/tpl.html')` returns `'<p>hi</p>'`
    - [ ] `$templateCache.get('/missing.html')` returns `undefined`
    - [ ] `$templateCache.remove('/tpl.html')` removes the entry; subsequent `get` returns `undefined`
    - [ ] `$templateCache.removeAll()` clears all entries
    - [ ] `$templateCache.info().size` reflects the current entry count
    - [ ] Apps can SEED the cache from a `config()` or `run()` block (`$templateCache.put('/users/me.html', '<div>…</div>')`) so that subsequent `templateUrl` requests hit the cache without any network fetch
    - [ ] Values stored via `put` are returned verbatim by `get` — no parsing, no normalization
    - [ ] The cache is a singleton — every injector has exactly one `$templateCache` instance, shared by every consumer

### 2.6. `$templateRequest` Service

- A new core service registered on `ngModule`. Function signature: `$templateRequest(tpl: string, ignoreRequestError?: boolean): Promise<string>`. Reads from `$templateCache` first; on miss, fetches via native `fetch`, stores the response, and returns it. Concurrent requests for the same URL share a single in-flight promise.
  - **Acceptance Criteria:**
    - [ ] `injector.get('$templateRequest')` returns the service after `createInjector(['ng'])`
    - [ ] `$templateRequest('/tpl.html')` returns a `Promise<string>` that resolves with the template content
    - [ ] On cache hit, the returned promise resolves on the next microtask with the cached content; NO `fetch` is made
    - [ ] On cache miss, `fetch('/tpl.html')` is invoked; the response body is read as text and stored in `$templateCache` keyed by the original URL; the promise resolves with the body
    - [ ] Two concurrent `$templateRequest('/tpl.html')` calls before the first resolves share a single in-flight `fetch` — only ONE network request is made; both promises resolve with the same content
    - [ ] On `fetch` rejection (network error) OR non-2xx HTTP status, the promise rejects with a descriptive `Error` whose message includes the URL and the underlying reason
    - [ ] `$templateRequest('/missing.html', true)` with `ignoreRequestError = true` suppresses the rejection; on error, the promise resolves with `undefined` instead. Used by directives that want to render a fallback rather than route an error
    - [ ] The service uses the global `fetch` available in the browser (and in jsdom for tests). No external HTTP library
    - [ ] Tests can override `$templateRequest` via `module.decorator('$templateRequest', …)` to mock fetches without touching the network — standard DI override pattern

### 2.7. Template Replaces Element Children (No `replace` Support)

- Templates always become the host element's CHILDREN. The host element itself is preserved (its tag name, attributes, and event listeners stay). AngularJS 1.x's `replace: true` (template replaces the host element entirely) is deliberately deferred.
  - **Acceptance Criteria:**
    - [ ] `<my-dir id="x" class="y" data-foo="z"></my-dir>` with `template: '<p>hi</p>'` renders as `<my-dir id="x" class="y" data-foo="z"><p>hi</p></my-dir>` — the host element's identity and attributes are preserved
    - [ ] Inline event handlers on the host element (`onclick="…"`) are preserved
    - [ ] `replace: true` declared on a DDO is rejected at registration with `replace: true is deprecated in AngularJS 1.x and is not supported. Use template/templateUrl without replace; the template becomes the host element's children` — routed via `$exceptionHandler('$compile')`. The directive's other behavior (link, compile, transclude) still runs
    - [ ] `replace: false` is accepted (it's the default behavior)
    - [ ] Other DDO fields (`scope`, `compile`, `link`, `transclude`, `restrict`, `priority`, `terminal`) interact with `template`/`templateUrl` per their existing semantics — no behavior change for directives that don't declare a template

### 2.8. Compile + Link Phase Ordering with Templates

- Template installation slots into the existing compile pipeline at a well-defined point. The order matters because directives in the template need to compile against the post-template DOM.
  - **Acceptance Criteria:**
    - [ ] On a host element with N matched directives sorted by priority, the template-declaring directive's TEMPLATE is installed BEFORE any directive's `compile` function runs (including the template-declaring directive's own `compile`)
    - [ ] After template installation, every directive on the host element compiles against the post-template element (`compile(element, attrs)` sees the new DOM)
    - [ ] Directives matched on the TEMPLATE'S internal nodes (e.g., `<ng-transclude>` inside the template) collect normally during the walker's descent into the template subtree
    - [ ] Template installation happens AFTER transclude capture (when `transclude: true | { … }` is also declared on the host) — so consumer children are saved BEFORE the template overwrites them (§2.9)
    - [ ] Pre-link and post-link phases on the host element run AFTER child link of the template subtree completes — preserving spec-017's bottom-up post-link contract within the host's own boundary
    - [ ] The `Attributes` instance is shared between the host's directives and the template-declaring directive's `compile`/`link` functions — same `attrs.$set` / `attrs.$observe` semantics

### 2.9. Integration with `transclude` — The Wrapper Pattern

- When a directive declares BOTH `transclude: true | { … }` AND `template`/`templateUrl`, the canonical wrapper pattern emerges: consumer children are captured first, the template replaces the element's content, and `<ng-transclude>` markers inside the template project the captured content back. The transcluded scope is a child of the OUTER scope (spec 018 §2.5 unchanged).
  - **Acceptance Criteria:**
    - [ ] Given the markup `<my-card title="Settings"><p>{{vm.name}}</p></my-card>` and the directive:
      ```js
      $cp.directive('myCard', () => ({
        restrict: 'E',
        scope: true,
        transclude: true,
        template:
          '<div class="card"><h2>{{title}}</h2><div ng-transclude></div></div>',
      }));
      ```
      the rendered output is `<my-card title="Settings"><div class="card"><h2>{{title}}</h2><div ng-transclude><p>{{vm.name}}</p></div></div></my-card>`, with `{{title}}` resolving against the directive's child scope (`scope: true`) and `{{vm.name}}` resolving against the OUTER scope where `vm.name` is defined
    - [ ] Capture (per spec 018) runs BEFORE template installation — the consumer's `<p>` is captured into the default transclusion bucket before the template overwrites the host's children
    - [ ] `ng-transclude` inside the template projects the captured content; transcluded scope is `outerScope.$new()`, NOT a child of the host directive's `scope: true` child
    - [ ] Multi-slot transclusion + template works: `transclude: { titleSlot: 'card-title' }` + `template: '<div ng-transclude="titleSlot"></div>'` projects the named slot
    - [ ] `templateUrl` + `transclude: true` works identically — the capture is synchronous (at compile time), but the projection waits for the template fetch to resolve. The `<ng-transclude>` inside the fetched template projects the captured content once the template installs
    - [ ] If a directive declares `transclude: true` but its template does NOT include `<ng-transclude>`, the captured content is never projected and is released to GC when the host is destroyed (spec 018 §2.7 contract preserved)

### 2.10. One Template Directive Per Element

- AngularJS allows AT MOST ONE directive on a given element to declare `template` or `templateUrl`. Two directives both declaring template is a programming error — caught at link time and reported.
  - **Acceptance Criteria:**
    - [ ] Two directives on the same element both declaring `template` (or `templateUrl`, or one of each) routes `Multiple directives requesting a template on the same element: "<first>" and "<second>". Only the first wins; "<second>"'s template is ignored.` via `$exceptionHandler('$compile')` at link time
    - [ ] The FIRST template-declaring directive (in priority-sorted order, registration-order tie-break) wins — its template installs; the second's template declaration is ignored
    - [ ] The second directive's OTHER behavior (link, compile, transclude, scope) still runs — only its template is ignored
    - [ ] The error is routed once per host element per linker invocation (deterministic for a given matched-directive set)

### 2.11. Async Compile Semantics — Synchronous Linker, Deferred Subtree

- `$compile(element)(scope)` preserves the spec-017 `Linker` signature exactly. When `templateUrl` directives are present, the linker fires synchronously; the affected subtree links once templates resolve.
  - **Acceptance Criteria:**
    - [ ] `$compile(node)` returns a `Linker` (synchronous return). Calling `linker(scope)` returns the node reference synchronously, identical to spec 017
    - [ ] If the node has NO `templateUrl` directives anywhere in the subtree, link is fully synchronous — observable DOM state after the linker returns is identical to spec 017's behavior
    - [ ] If the node HAS one or more `templateUrl` directives, the element with the directive remains EMPTY immediately after `linker(scope)` returns; the rest of the subtree (parts not gated by `templateUrl`) DOES link synchronously
    - [ ] Once the template fetch resolves (in a microtask), the template is installed, child compile + link runs, and post-link runs. Bindings inside the template begin resolving from that point — `$digest` cycles after the resolution see the bound values
    - [ ] Multiple `templateUrl` directives in disjoint subtrees each resolve independently — one slow fetch does not block another. Sibling subtrees link as their respective templates arrive
    - [ ] Errors during deferred subtree compile/link route via `$exceptionHandler('$compile')` per the existing spec-017 contract; the rest of the document continues normally
    - [ ] A directive that declares both `templateUrl` AND `transclude: true` captures consumer children SYNCHRONOUSLY at compile (before the fetch starts); the projection (via `<ng-transclude>` in the template) lands once the fetch resolves
    - [ ] Tests can `await` template-load completion using `$templateCache.put(url, content)` to seed the cache — when the cache is pre-populated, `$templateRequest` resolves on the NEXT MICROTASK and the test can `await Promise.resolve()` (or use Vitest's microtask flushing) to observe the post-template DOM

### 2.12. Error Handling — Reuse `'$compile'` Cause

- No new entry is added to `EXCEPTION_HANDLER_CAUSES`. Every error site in this spec reuses the `'$compile'` token introduced in spec 017.
  - **Acceptance Criteria:**
    - [ ] **Invalid `template` value at registration:** non-string non-function values, empty string, `template` combined with `templateUrl` — all throw synchronously at the lazy `<name>Directive` provider's `$get`, routed via `$exceptionHandler('$compile')`. The directive is treated as if it failed to resolve; other directives on the same element continue
    - [ ] **Invalid `templateUrl` value at registration:** non-string non-function values, empty string — same routing
    - [ ] **`replace: true` rejection:** routes the deprecation error at registration via `$exceptionHandler('$compile')`; directive's other behavior continues
    - [ ] **Function-form `template` / `templateUrl` returns non-string:** routes at compile time via `$exceptionHandler('$compile')`; element stays empty
    - [ ] **Function-form `template` / `templateUrl` throws:** routes via `$exceptionHandler('$compile')`; element stays empty; siblings continue
    - [ ] **`templateUrl` fetch fails (network, 404, CORS):** error routed via `$exceptionHandler('$compile')` with the URL + reason in the message; element stays empty; rest of the document compiles + links normally
    - [ ] **Two template-declaring directives on the same element:** routed once via `$exceptionHandler('$compile')` at link time; first wins, second's template ignored
    - [ ] **Custom `$exceptionHandler` that itself throws:** spec-014's `invokeExceptionHandler` recursion guard catches it and falls back to `console.error`; template loading does NOT crash
    - [ ] `EXCEPTION_HANDLER_CAUSES.length` is unchanged (stays at 10 — `'$compile'` covers everything)

### 2.13. Module Layout / Exports

- The implementation strategy is left to technical-considerations. The functional spec fixes the PUBLIC surface only.
  - **Acceptance Criteria:**
    - [ ] `$templateCache` and `$templateRequest` are resolvable via `injector.get(...)` after `createInjector(['ng'])`
    - [ ] `$templateCache` is also resolvable as a provider at config phase (`$templateCacheProvider` follows the same ESM-first factory + DI shim pattern as `$sce`, `$interpolate`, `$sanitize`, `$filter`)
    - [ ] `$templateRequest` is also resolvable as a provider at config phase if any apps need to configure default fetch options — IF the implementation decides to expose configuration (technical-considerations decision)
    - [ ] The root barrel re-exports any new public types directive authors need: at minimum `TemplateCache` (the cache service type) and `TemplateRequestFn` (the `$templateRequest` signature). Existing exports unchanged in shape
    - [ ] Existing `package.json` `exports` map + `rollup.config.mjs` entries gain a new `./template` subpath OR fold into `./compiler` — implementation decision

### 2.14. Backward Compatibility

- Adding template loading is purely additive. No existing API is renamed, removed, or behavior-changed.
  - **Acceptance Criteria:**
    - [ ] All tests from specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018 continue to pass unchanged
    - [ ] Directives WITHOUT a `template` or `templateUrl` declaration behave exactly as in spec 017/018 — same matching, same compile/link order, same scope semantics, same cleanup, same transclusion behavior
    - [ ] The `Linker` signature is unchanged: `(scope: Scope) => Element | NodeList | Comment`. Spec-017 callers remain assignable
    - [ ] `EXCEPTION_HANDLER_CAUSES` is unchanged — no new entry, every error site reuses `'$compile'`
    - [ ] `injector.has('$compile') === true`, `injector.has('$compileProvider') === true` continue to hold. `injector.has('$templateCache') === true` and `injector.has('$templateRequest') === true` are NEW public observables of `ngModule`

### 2.15. Documentation

- Template loading gets the same documentation treatment as the rest of the compiler.
  - **Acceptance Criteria:**
    - [ ] `CLAUDE.md` "Modules" table is updated to mention `$templateCache` and `$templateRequest` (under the `./compiler` row or a new `./template` row depending on the layout decision)
    - [ ] `CLAUDE.md` "Non-obvious invariants" gains bullets covering: templates replace children but preserve the host element (no `replace: true`); template install happens BEFORE the per-directive compile loop on the host; transclude capture runs BEFORE template installation; `$templateRequest` deduplicates concurrent fetches; `$compile`'s `Linker` signature is unchanged, async resolution happens in microtasks; `'$compile'` cause is reused for every template-related error site
    - [ ] `CLAUDE.md` "Where to look when…" gains rows for: "How is `template`/`templateUrl` installed during compile?", "How does `$templateRequest` cache and deduplicate?", "How does a `transclude: true` + `template` wrapper directive project content?"
    - [ ] TSDoc on every new public export carries at least one runnable example. The example for `template` shows the consumer markup → template install → linked output round-trip. The example for `$templateRequest` shows the `Promise<string>` resolution + the seeded-cache pattern
    - [ ] `src/compiler/README.md` (or a new `src/template/README.md` depending on layout) gains a "Template Loading" section covering: string vs function `template`; string vs function `templateUrl`; `$templateCache` + `$templateRequest` usage; the wrapper pattern (`transclude: true` + `template` + `<ng-transclude>`); the deferred async semantics; forward-pointers to `replace: true`, `templateNamespace`, `<script type="text/ng-template">`, `*-start`/`*-end` (all deferred)

---

## 3. Scope and Boundaries

### In-Scope

- Inline `template: string` and `template: (element, attrs) => string` (function form)
- Async `templateUrl: string` and `templateUrl: (element, attrs) => string` (function form)
- `$templateCache` service — `put` / `get` / `remove` / `removeAll` / `info`
- `$templateRequest(url, ignoreRequestError?)` service over native `fetch`, with `$templateCache` integration + in-flight deduplication
- Template installation as the host element's CHILDREN (host element preserved)
- Compile + link phase ordering: template install → child compile → host directives' compile → pre-link → child link → post-link
- Integration with `transclude: true | { … }` — the wrapper pattern works end-to-end, including with `templateUrl`
- One template directive per element, with link-time error routing for the multi-template case
- Synchronous `Linker` return; deferred subtree link in a microtask after `templateUrl` resolves
- Errors during registration, fetch, function-form throw, multi-template, and non-string return route via `$exceptionHandler('$compile')` — no new `EXCEPTION_HANDLER_CAUSES` entry
- Backwards-compatible additive change; spec-017 + spec-018 tests pass unchanged
- TSDoc + `src/compiler/README.md` (or `src/template/README.md`) section + `CLAUDE.md` updates
- Tests under `src/compiler/__tests__/*.test.ts` (or a new `src/template/__tests__/` depending on layout) covering inline templates, async templates, cache, request, wrapper-pattern integration, errors

### Out-of-Scope

- **`replace: true` DDO option** — DEPRECATED in AngularJS 1.x. Rejected at registration with a clear error. Will not ship in this project unless a specific use case justifies it (unlikely)
- **`templateNamespace: 'html' | 'svg' | 'mathml'`** — namespace-aware template parsing. Defer to a future SVG-focused spec
- **`<script type="text/ng-template" id="...">` preload directive** — built-in directive that registers its `innerHTML` to `$templateCache` at compile time. Belongs to the Built-in Directives roadmap bullet; lands there
- **Multi-element `*-start` / `*-end` template handling** — `ng-repeat-start` / `ng-repeat-end` style multi-root templates. Tightly coupled to `ng-repeat`; defers with the structural-directives spec
- **`$http` integration** — Phase 3 ships `$http`. `$templateRequest` uses native `fetch` for now; a future spec MAY add a decorator that routes through `$http` when both are loaded, to honor interceptors and default headers
- **Controllers and `require` DDO** — separate roadmap bullet "Controllers (`$controller`)". The 4th link argument `controllers` stays an undefined placeholder per spec 018
- **`bindToController`, `controllerAs`** — depend on controllers; deferred with that spec
- **Isolate scope (`scope: {...}`)** — already rejected at registration in spec 017; deferred to its own spec
- **Module DSL `.directive` / `.component`** — separate roadmap bullet; this spec registers all template-bearing directives through `$compileProvider.directive(...)` from a config block, identical to spec 017's testing pattern
- **Application Bootstrap (`bootstrap`, `bootstrapInjector`, `autoBootstrap`)** — separate roadmap bullet; tests in this spec construct the injector via `createInjector([…, 'ng'])` and call `$compile(node)(scope)` explicitly
- **`templateUrl` for cross-origin resources without CORS** — out of scope; the spec assumes same-origin or properly-configured CORS responses
- **Server-side template rendering / SSR** — explicitly out of scope per `product-definition.md` §3.2
- **`$templateCache` persistence across sessions** — the cache is an in-memory `Map`; no localStorage / IndexedDB integration
- **Hot-reload / template-watching during development** — out of scope; apps that want live-reload must clear `$templateCache` manually
- **Service Text Diagrams (Phase 2 wrap-up)** — the template-loading diagram lands with that wrap-up
- **`$q`, `$timeout`, `$interval`, `$http`, Forms, Routing, Animations** — separate phases per the roadmap
