# Tasks: Template Loading — Inline `template` + Async `templateUrl`

- **Specification:** `context/spec/019-template-loading/`
- **Status:** Draft

---

- [ ] **Slice 1: Foundation — Module Scaffolding + Type Surface + Error Classes (No Behavior Change)**
  - [ ] Add `"@template/*": ["./src/template/*"]` to `tsconfig.json` `paths`. Mirrors every prior subpath alias (`@core`, `@parser`, `@di`, `@interpolate`, `@sce`, `@sanitize`, `@exception-handler`, `@filter`, `@compiler`). **[Agent: rollup-build]**
  - [ ] Add `'@template': path.resolve(__dirname, 'src/template')` to `vitest.config.ts` `resolve.alias`. Vitest does not read `tsconfig.json` paths; the alias must be duplicated. Same precedent as the spec-016 `@filter` deviation and the spec-017 `@compiler` setup. **[Agent: rollup-build]**
  - [ ] Add `./template` entry to `rollup.config.mjs` so the new module emits `dist/{esm,cjs,types}/template/index.{mjs,cjs,d.ts}`. Mirror the existing `./compiler` / `./filter` entries. **[Agent: rollup-build]**
  - [ ] Add `./template` to `package.json` `exports` map (ESM `import`, CJS `require`, `types`). Mirror the existing exports entries. **[Agent: rollup-build]**
  - [ ] Create `src/template/template-types.ts` exporting the public type surface per technical-considerations §2.12:
        - `interface TemplateCacheInfo { id: 'templates'; size: number }`
        - `interface TemplateCacheService { put(key: string, content: string): string; get(key: string): string | undefined; remove(key: string): void; removeAll(): void; info(): TemplateCacheInfo }`
        - `type TemplateFetcher = (url: string) => Promise<string>`
        - `type TemplateRequestFn = (url: string, ignoreRequestError?: boolean) => Promise<string | undefined>`
        - `type TemplateFn = (element: Element, attrs: Attributes) => string`
        - `type TemplateUrlFn = (element: Element, attrs: Attributes) => string`
        - `type NormalizedTemplate = { kind: 'inline-string'; value: string } | { kind: 'inline-fn'; value: TemplateFn } | { kind: 'url-string'; value: string } | { kind: 'url-fn'; value: TemplateUrlFn }` (internal — re-exported for future structural-directives specs, NOT in the root barrel). **[Agent: typescript-framework]**
  - [ ] Create `src/template/index.ts` (initial barrel — populated in subsequent slices). For Slice 1, re-export only the types from `./template-types`. The factories ship in Slices 2 and 3. **[Agent: typescript-framework]**
  - [ ] Extend `src/compiler/compile-error.ts` with the ten new error classes per technical-considerations §2.10, mirroring the existing `compile-error.ts` pattern (extends `Error`, `readonly name = '<ClassName>' as const`, single-string constructor, deterministic message):
        - `InvalidTemplateValueError(directiveName: string, description: string)` → `Invalid template value for directive <name>: <description>`
        - `InvalidTemplateUrlValueError(directiveName: string, description: string)` → `Invalid templateUrl value for directive <name>: <description>`
        - `EmptyTemplateError(directiveName: string)` → `Invalid template for directive <name>: empty string`
        - `EmptyTemplateUrlError(directiveName: string)` → `Invalid templateUrl for directive <name>: empty string`
        - `TemplateAndTemplateUrlCombinedError(directiveName: string)` → `Cannot combine template and templateUrl on directive <name>; choose one`
        - `ReplaceTrueNotSupportedError(directiveName: string)` → `replace: true is deprecated in AngularJS 1.x and is not supported. Use template/templateUrl without replace; the template becomes the host element's children. Directive: <name>`
        - `TemplateFunctionReturnedNonStringError(directiveName: string, description: string)` → `Template function for directive <name> returned a non-string value: <description>`
        - `TemplateUrlFunctionReturnedNonStringError(directiveName: string, description: string)` → `templateUrl function for directive <name> returned a non-string value: <description>`
        - `MultipleTemplateDirectivesError(firstDirectiveName: string, secondDirectiveName: string)` → `Multiple directives requesting a template on the same element: "<first>" and "<second>". Only the first wins; "<second>"'s template is ignored.`
        - `TemplateFetchFailedError(url: string, reason: string)` → `Failed to load template "<url>": <reason>`. **[Agent: typescript-framework]**
  - [ ] Widen `DirectiveDefinition` in `src/compiler/directive-types.ts:139-166` to accept the new fields:
        - `template?: string | TemplateFn`
        - `templateUrl?: string | TemplateUrlFn`
        - `replace?: boolean` (only `false` will be accepted at runtime; `true` is rejected per FS §2.7)
        - Document `replace` as deprecated via TSDoc; cite `ReplaceTrueNotSupportedError`. **[Agent: typescript-framework]**
  - [ ] Widen `Directive` in `src/compiler/directive-types.ts:200-216` with `template?: NormalizedTemplate`. Single field unifies inline-vs-url storage; the `kind` discriminator distinguishes. Populated by `normalizeDirective` in Slice 4; unused by the runtime until Slice 5. Re-export `TemplateFn`, `TemplateUrlFn`, `NormalizedTemplate` from `directive-types.ts` so the existing single-import surface is preserved. **[Agent: typescript-framework]**
  - [ ] Update `src/compiler/index.ts` barrel to re-export the ten new error classes plus `TemplateFn` and `TemplateUrlFn`. `NormalizedTemplate` is INTERNAL — not re-exported from the public barrel. **[Agent: typescript-framework]**
  - [ ] Update `src/index.ts` (root barrel) to re-export the ten new error classes, `TemplateFn`, `TemplateUrlFn`, and (forward-looking) `TemplateCacheService`, `TemplateRequestFn`, `TemplateCacheInfo`, `TemplateFetcher` from `./template`. **[Agent: typescript-framework]**
  - [ ] Create `src/compiler/__tests__/template-errors-foundation.test.ts` covering all ten error classes — instantiate each, assert message format, `name` discriminator, and `instanceof Error`. Mirror the spec-018 `transclude-errors-foundation.test.ts` pattern. Include a type-widening regression block: assign a 0-arg / 1-arg / 2-arg `TemplateFn` to the type to verify TypeScript function-parameter subtyping holds. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests (specs 002–018) pass unchanged. The new build emits `dist/types/template/index.d.ts` containing the seven public types. No public ng-module surface change yet; no `EXCEPTION_HANDLER_CAUSES` change. **[Agent: rollup-build]**

- [ ] **Slice 2: `$templateCache` Service**
  - [ ] Create `src/template/template-cache.ts` exporting `createTemplateCache(): TemplateCacheService` per technical-considerations §2.2. Internal `Map<string, string>` closed over by the returned methods:
        - `put(key, content): string` — `map.set(key, content); return content;`
        - `get(key): string | undefined` — `map.get(key)`
        - `remove(key): void` — `map.delete(key)`
        - `removeAll(): void` — `map.clear()`
        - `info(): TemplateCacheInfo` — `{ id: 'templates', size: map.size }`
        - Also export a default `templateCache = createTemplateCache()` instance for ESM-first standalone use. **[Agent: typescript-framework]**
  - [ ] Update `src/template/index.ts` to re-export `createTemplateCache` and the default `templateCache` instance. **[Agent: typescript-framework]**
  - [ ] Register `$templateCache` on `ngModule` in `src/core/ng-module.ts` after the existing filter-chain block: `.factory('$templateCache', () => createTemplateCache())`. Each injector gets its own isolated cache (closure-fresh `Map`). **[Agent: typescript-framework]**
  - [ ] Extend the `ModuleRegistry` type declaration in `src/core/ng-module.ts:41-71` with `$templateCache: TemplateCacheService` so `injector.get('$templateCache')` returns the correctly-typed service. **[Agent: typescript-framework]**
  - [ ] Update `src/index.ts` to re-export `createTemplateCache` and the default `templateCache` instance from `./template`. **[Agent: typescript-framework]**
  - [ ] Create `src/template/__tests__/template-cache.test.ts` covering FS §2.5:
        - `put` stores; `get` retrieves; `put` returns the content for chaining
        - `get` of a missing key returns `undefined`
        - `remove` removes a single entry
        - `removeAll` clears all entries
        - `info().size` reflects entry count
        - `info().id === 'templates'`
        - Two `createTemplateCache()` instances are independent (closure-fresh state)
        - `injector.get('$templateCache')` returns the service after `createInjector(['ng'])`
        - Two injectors get independent cache instances
        - `$templateCache.put('/k', '<p>')` from a `config()` block survives into run phase. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. All prior tests pass unchanged. Two new public observables on `ngModule`: `injector.has('$templateCache') === true`. **[Agent: typescript-framework]**

- [ ] **Slice 3: `$templateRequest` Service**
  - [ ] Create `src/template/template-request.ts` exporting `createTemplateRequest({ cache, fetcher }): TemplateRequestFn` per technical-considerations §2.3. Internal state: `inFlight: Map<string, Promise<string>>`. Per-call lifecycle:
        1. Check `cache.get(url)` — if present, return `Promise.resolve(cached)`
        2. Check `inFlight.get(url)` — if present, return that promise (concurrent dedup)
        3. Otherwise: create `const p = fetcher(url).then(text => { cache.put(url, text); inFlight.delete(url); return text; }, err => { inFlight.delete(url); throw err; })`. Store `p` in `inFlight`. Return `p`.
        4. If `ignoreRequestError === true`, the returned promise is `p.catch(() => undefined)` — same resolution shape but rejections turn into `undefined`. **[Agent: typescript-framework]**
  - [ ] Define a default fetcher in `template-request.ts`: `const defaultFetcher: TemplateFetcher = (url) => fetch(url).then((r) => r.ok ? r.text() : Promise.reject(new TemplateFetchFailedError(url, ${r.status} ${r.statusText})))`. `createTemplateRequest` accepts an optional `fetcher` arg that defaults to `defaultFetcher`. Tests inject mocks via this seam. **[Agent: typescript-framework]**
  - [ ] Export a default `templateRequest` instance from `src/template/template-request.ts`: `templateRequest = createTemplateRequest({ cache: templateCache })` — for ESM-first standalone use. (Tests use the factory directly with an injected mock fetcher to avoid sharing state.) **[Agent: typescript-framework]**
  - [ ] Update `src/template/index.ts` to re-export `createTemplateRequest` and the default `templateRequest` instance. **[Agent: typescript-framework]**
  - [ ] Register `$templateRequest` on `ngModule` in `src/core/ng-module.ts` after the `$templateCache` registration: `.factory('$templateRequest', ['$templateCache', (cache) => createTemplateRequest({ cache })])`. Uses the default fetcher (`fetch` from globalThis). **[Agent: typescript-framework]**
  - [ ] Extend the `ModuleRegistry` type declaration with `$templateRequest: TemplateRequestFn`. **[Agent: typescript-framework]**
  - [ ] Update `src/index.ts` to re-export `createTemplateRequest` and the default `templateRequest` instance. **[Agent: typescript-framework]**
  - [ ] Create `src/template/__tests__/template-request.test.ts` covering FS §2.6:
        - Cache hit: `cache.put(url, content)` first, then `templateRequest(url)` resolves with `content` WITHOUT calling the fetcher
        - Cache miss: fetcher is called once, response written to cache, returned promise resolves with body
        - Concurrent dedup: two `templateRequest(url)` calls before the first resolves share a single fetcher invocation
        - After resolution, `inFlight.delete(url)` runs — a subsequent request after the cache is cleared re-fetches
        - Non-2xx HTTP rejects the promise with a `TemplateFetchFailedError` whose message contains the URL + status
        - Network rejection (fetcher throws / rejects) propagates as a rejected promise with the original error
        - `ignoreRequestError: true` suppresses rejections — promise resolves with `undefined` on error
        - `injector.get('$templateRequest')` returns the service after `createInjector(['ng'])`
        - Mock fetcher injection works via `createTemplateRequest({ cache, fetcher: mockFn })`. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. All prior tests pass unchanged. `injector.has('$templateRequest') === true` is the new observable. **[Agent: typescript-framework]**

- [ ] **Slice 4: Registration-Phase Template Validation**
  - [ ] Extend `normalizeDirective` in `src/compiler/compile-provider.ts:349-423` per technical-considerations §2.6. Insert the `normalizeTemplate` block AFTER the `normalizeTransclude` call at line 386 and BEFORE the priority assignment at line 388. Validate in order:
        1. **`replace` validation:** `ddo.replace === true` → throw `ReplaceTrueNotSupportedError`. `false` / `undefined` → accept. Other → also throw `ReplaceTrueNotSupportedError` with a generalized message
        2. **Mutual exclusion:** `ddo.template != null && ddo.templateUrl != null` → throw `TemplateAndTemplateUrlCombinedError`
        3. **`template` validation:** `undefined` → leave unset; non-empty string → `{ kind: 'inline-string', value }`; empty string → `EmptyTemplateError`; function → `{ kind: 'inline-fn', value }`; other → `InvalidTemplateValueError(name, describeValue(value))`
        4. **`templateUrl` validation:** `undefined` → leave unset; non-empty string → `{ kind: 'url-string', value }`; empty string → `EmptyTemplateUrlError`; function → `{ kind: 'url-fn', value }`; other → `InvalidTemplateUrlValueError(name, describeValue(value))`
        - Reuse the `describeValue` helper introduced in spec 018's `normalizeDirective` extension. **[Agent: typescript-framework]**
  - [ ] All throws are caught by the existing factory try/catch in `$$buildDirectiveArrayProvider` at `compile-provider.ts:207-215` and routed via `$exceptionHandler('$compile')`. No new error-routing code needed — verify via tests. **[Agent: typescript-framework]**
  - [ ] Create `src/compiler/__tests__/template-registration.test.ts` covering FS §2.1 + §2.3 + §2.7 + §2.12 registration acceptance:
        - `template: '<p>hi</p>'` registers; `directive.template === { kind: 'inline-string', value: '<p>hi</p>' }`
        - `template: () => '<p>hi</p>'` registers; `directive.template === { kind: 'inline-fn', value: fn }`
        - `templateUrl: '/tpl.html'` registers; `directive.template === { kind: 'url-string', value: '/tpl.html' }`
        - `templateUrl: () => '/tpl.html'` registers; `directive.template === { kind: 'url-fn', value: fn }`
        - Omitting both leaves the field unset
        - `template: ''` routes `EmptyTemplateError`
        - `templateUrl: ''` routes `EmptyTemplateUrlError`
        - `template: 42` / `template: null` / `template: {}` / `template: []` routes `InvalidTemplateValueError`
        - `templateUrl: 42` / `templateUrl: null` / `templateUrl: {}` / `templateUrl: []` routes `InvalidTemplateUrlValueError`
        - `template: '...' + templateUrl: '...'` routes `TemplateAndTemplateUrlCombinedError`
        - `replace: true` routes `ReplaceTrueNotSupportedError`
        - `replace: false` is accepted
        - `replace: 'yes'` / `replace: 1` routes `ReplaceTrueNotSupportedError` (any non-false-non-undefined value)
        - Each error routes through `$exceptionHandler('$compile')` (verify via spy)
        - The directive is dropped from the array on validation error; sibling directives on the same element continue normally. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. All prior tests pass unchanged. No runtime template behavior yet — directives declaring `template`/`templateUrl` register their normalized field but the compiler doesn't act on it (Slice 5 lights it up). **[Agent: typescript-framework]**

- [ ] **Slice 5: Inline `template` — Sync Install + Function-Form End-to-End**
  - [ ] Create `src/compiler/template-parse.ts` exporting `parseTemplate(html: string): Node[]`. Implementation per technical-considerations §2.9:
        1. Create a `<template>` element via `document.createElement('template')`
        2. Set `templateEl.innerHTML = html`
        3. Return `Array.from(templateEl.content.childNodes)`
        - Pure DOM operation. Handles multi-root templates naturally (the content fragment carries all roots). **[Agent: typescript-framework]**
  - [ ] Add `$templateRequest` to `$compile`'s `$get` array in `src/compiler/compile-provider.ts:228-240`: append `'$templateRequest'` to the deps list and forward `templateRequest: $templateRequest` to `createCompile(...)`. Extend the `CompileOptions` interface in `directive-types.ts:246-251` with `templateRequest: TemplateRequestFn`. **[Agent: typescript-framework]**
  - [ ] Extend `src/compiler/compile.ts` per technical-considerations §2.7. In `compileElementOrComment` (`:152-300`), AFTER the transclude capture block (`:196-202`) and BEFORE the child snapshot (`:247-258`), add a template-installation pre-pass:
        1. **Detect template-declaring directive.** Scan the sorted directive list for entries whose normalized `template` field is set. Record the first match
        2. **For `kind: 'inline-string'`:** Call `parseTemplate(template.value)`. Replace `node.childNodes` with the parsed nodes (`while (node.firstChild) node.removeChild(node.firstChild); for (const tplNode of parsedNodes) node.appendChild(tplNode);`)
        3. **For `kind: 'inline-fn'`:** Call `template.value(node, attrs)` inside a try/catch routing throws via `invokeExceptionHandler(handler, err, '$compile')`. If the return value is not a string, route `TemplateFunctionReturnedNonStringError(directive.name, describeValue(returnValue))` via the same handler. On error, leave the element empty and skip template installation (the directive's other behavior — link, compile — still runs). On success, follow the same install path as `inline-string`
        4. **Memoize.** Store the resolved template string on the directive's LOCAL entry (a shallow copy of the directive object made within `compileElementOrComment` per the spec-018 precedent for `MultipleTranscludeDirectivesError`) so subsequent linker invocations reuse it — function-form template called exactly once per compile invocation
        - Template install runs BEFORE the per-directive compile loop at lines 216-240 and BEFORE the child snapshot at lines 247-258. **[Agent: typescript-framework]**
  - [ ] Verify the existing walker continues to work against the post-template DOM:
        - Child snapshot at `:247-258` walks the template's nodes (now `node.childNodes`)
        - The host directive's own `compile`/`pre-link`/`post-link` see the post-template element
        - `$$ngBoundTransclude` (stashed BEFORE template installation per spec-018 ordering) is found by `<ng-transclude>` markers inside the template via the parent-element walk. **[Agent: typescript-framework]**
  - [ ] Create `src/compiler/__tests__/template-inline.test.ts` covering FS §2.1 + §2.2 + §2.7 + §2.8:
        - String `template: '<p>hi</p>'` installs on `<my-dir></my-dir>` — host element preserved, `<p>hi</p>` becomes its only child
        - Existing consumer children REPLACED by template (no `transclude` declaration)
        - Multi-root template `<h2>a</h2><p>b</p>` installs both roots as siblings
        - Template with interpolation `'<p>{{x}}</p>'` resolves against the host directive's scope at link time
        - Function-form `template: (el, attrs) => '<p>' + attrs.label + '</p>'` installs with attribute values interpolated at compile time
        - Function-form called exactly ONCE per compile (assert via spy across two linker invocations `linker(scope1); linker(scope2)`)
        - Function-form returning non-string (e.g., `undefined`, `42`) routes `TemplateFunctionReturnedNonStringError`; element stays empty; other behavior runs
        - Function-form that throws routes the thrown error via `$exceptionHandler('$compile')`; element stays empty; siblings continue
        - Template installs BEFORE host directive's `compile` (host directive's `compile` sees post-template element)
        - Template installs BEFORE walker descends into children (child directives in template register and link)
        - Host element attributes preserved (`id`, `class`, `data-*`, inline event handlers) — only children are replaced
        - Text-only template (`'just text'`) replaces children with a single text node. **[Agent: vitest-testing]**
  - [ ] Update `src/compiler/__tests__/cross-spec-smoke.test.ts` with an inline-template smoke assertion: register `template: '<p>{{x}}</p>'` directive in a config block, compile a fixture, set `scope.x = 'hi'`, digest, assert the rendered text content is `'hi'`. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. All prior tests pass unchanged. Inline `template` directives now work end-to-end through `$compile`. **[Agent: typescript-framework]**

- [ ] **Slice 6: Async `templateUrl` — Deferred Drain + Multi-Template Guard**
  - [ ] Extend `src/compiler/compile.ts` with a `DeferredTemplateQueue` per technical-considerations §2.8:
        - Threaded through the recursive walker's closure from the top-level `$compile` entry
        - Each entry: `{ element, urlFnOrString, attrs, pendingDirectives, transcludeContext, directiveName, outerScope? }`
        - `outerScope` is filled at link time (captured from `parentScope` inside `nodeLinker`, mirroring the spec-018 transclude capture seam)
        - Top-level `$compile` triggers the drain via `Promise.resolve().then(drainDeferredTemplateQueue)` AFTER the synchronous walker has completed AND the public `Linker` has been returned to the caller. **[Agent: typescript-framework]**
  - [ ] Extend the per-element walker pre-pass: when the matched template-declaring directive's normalized `template` has `kind: 'url-string' | 'url-fn'`:
        1. **For `kind: 'url-fn'`:** call `urlFn(node, attrs)` synchronously inside a try/catch. Non-string return routes `TemplateUrlFunctionReturnedNonStringError`; throw routes the original. On error, leave the element empty and skip enqueuing (other directives' behavior still runs)
        2. **Stash on element:** `Object.defineProperty(node, '$$pendingTemplate', { value: { url: resolvedUrl, directiveName }, enumerable: false, writable: true, configurable: true })`. Mirrors the spec-018 `$$ngBoundTransclude` stash pattern
        3. **Enqueue** a deferred-install entry on the `DeferredTemplateQueue`, including the resolved `url`, the host element, the `attrs`, the list of pending directives EXCEPT the template-declaring one, and the transclude context (if any)
        4. **Return a per-element linker that captures `parentScope` into the entry at link time** but does NOT install the template synchronously. The rest of the parent linker (sibling directives, child links for non-pending subtrees) runs normally. **[Agent: typescript-framework]**
  - [ ] Implement `drainDeferredTemplateQueue(queue, { templateRequest, exceptionHandler, compileService })` per technical-considerations §2.8:
        - `Promise.all(entries.map(processEntry))` for parallel resolution — sibling subtrees don't block each other
        - `processEntry(entry)`:
          1. `await templateRequest(entry.url)` — caught and routed via `exceptionHandler('$compile')` on rejection; entry silently drops on error
          2. Check if `entry.element` has been destroyed since enqueue (peek `(entry.element as NgManagedElement).$$ngScope?.$$destroyed` or check parent-scope state). If destroyed, drop the entry; transclusion fragments (if any) are released via the cleanup queue
          3. Parse the template via `parseTemplate(templateString)`; replace `entry.element`'s children
          4. Recursively compile the post-template subtree via `compileService(entry.element.childNodes)` — handles nested `templateUrl` directives via the same queue mechanism
          5. Build the per-element linker for the remaining pending directives (host directive's compile, pre-link, post-link)
          6. Invoke the per-element linker with `entry.outerScope` so the directive sees the captured outer scope. **[Agent: typescript-framework]**
  - [ ] Extend the per-element walker pre-pass to ALSO detect a SECOND template-declaring directive on the same element. On second match, route `MultipleTemplateDirectivesError(first.name, second.name)` via `invokeExceptionHandler(handler, err, '$compile')` at LINK time (deterministic ordering — mirror the spec-018 `MultipleTranscludeDirectivesError` site). Clear the second's `template` field on the LOCAL directive entry. Other behavior of the second directive runs unchanged. **[Agent: typescript-framework]**
  - [ ] Verify transclude integration with `templateUrl`:
        - Capture (spec 018) runs SYNCHRONOUSLY at compile time, BEFORE the deferred entry is enqueued
        - `$$ngBoundTransclude` is stashed at the synchronous walk pass; when the template installs later, `<ng-transclude>` inside the template walks `parentElement` to the host and finds the stash
        - The transclusion master fragments are owned by the `$transclude` closure stashed at link time — independent of when the template installs
        - Cleanup queue ownership preserved: each clone scope is on `host.$$ngCleanupQueue` per spec 018; `destroyElementScope(host)` tears down clones regardless of template-load state. **[Agent: typescript-framework]**
  - [ ] Create `src/compiler/__tests__/template-url.test.ts` covering FS §2.3 + §2.4 + §2.8 + §2.11:
        - String `templateUrl: '/tpl.html'` — seed `$templateCache.put('/tpl.html', '<p>hi</p>')`; compile; `await Promise.resolve()` (twice for chained `.then`); assert `<p>hi</p>` is the host's only child
        - Function-form `templateUrl: (el, attrs) => '/tpl/' + attrs.kind + '.html'` resolves the URL from attributes
        - Function-form called exactly ONCE per compile
        - Function-form returning non-string routes `TemplateUrlFunctionReturnedNonStringError`; element stays empty
        - Function-form that throws routes via `$exceptionHandler('$compile')`; element stays empty
        - On first compile, `fetcher` (mocked via `module.decorator('$templateRequest', …)` OR a `$templateCache.put(url, content)` pre-seed) is called once; subsequent compiles read from cache (assert via spy on fetcher)
        - `$compile(node)(scope)` returns SYNCHRONOUSLY; the host element's children are EMPTY immediately after linker return
        - After `await Promise.resolve()` (twice for the chained drain), the template is installed and child link has run
        - Multiple `templateUrl` directives in disjoint subtrees resolve INDEPENDENTLY — one slow fetch doesn't block another
        - Fetch failure (non-2xx HTTP, network error) routes `TemplateFetchFailedError` via `$exceptionHandler('$compile')`; element stays empty; sibling subtrees continue
        - Host destroyed before resolution: drop the entry silently; no error
        - Concurrent compiles before the first fetch resolves share a single in-flight fetch (assert via spy). **[Agent: vitest-testing]**
  - [ ] Create `src/compiler/__tests__/template-transclude.test.ts` covering FS §2.9 wrapper-pattern integration:
        - `transclude: true` + inline `template: '<div class="card"><h2>{{title}}</h2><div ng-transclude></div></div>'` + `scope: true` — given `<my-card title="Settings"><p>{{vm.name}}</p></my-card>`, the projected `<p>` resolves against the OUTER scope (`vm.name`) while the template's `{{title}}` resolves against the directive's `scope: true` child
        - Capture runs BEFORE template install (consumer `<p>` captured before the template overwrites the host)
        - `transclude: true` + `templateUrl` (seeded cache) works identically; projection waits for the template to install
        - Multi-slot transclusion + template projects the named slot correctly
        - If the template does NOT include `<ng-transclude>`, captured content is never projected (released to GC when host destroys). **[Agent: vitest-testing]**
  - [ ] Create `src/compiler/__tests__/template-multi-directive.test.ts` covering FS §2.10:
        - Two `template`-declaring directives on the same element: `MultipleTemplateDirectivesError` routed at link time; first wins; second's template ignored; second's other behavior (`link`, `compile`) runs
        - Two `templateUrl`-declaring directives — same routing
        - One `template` + one `templateUrl` on the same element — same routing
        - First-wins ordering is deterministic (priority desc, registration-order tie-break — mirroring spec 018's `MultipleTranscludeDirectivesError`)
        - Interaction with `MultipleTranscludeDirectivesError`: both errors fire independently when both conditions trigger on the same element. **[Agent: vitest-testing]**
  - [ ] Update `src/compiler/__tests__/cross-spec-smoke.test.ts` with a `templateUrl` smoke: seed `$templateCache.put`, compile a `templateUrl` directive, `await Promise.resolve()`, assert post-link DOM. **[Agent: vitest-testing]**
  - [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests pass unchanged. Async `templateUrl` directives now work end-to-end. **[Agent: rollup-build]**

- [ ] **Slice 7: Documentation + Final Verification**
  - [ ] Create `src/template/README.md` per FS §2.15 + technical-considerations §2.11. Sections:
        - "When to use `template` vs `templateUrl`"
        - "Function-form templates (template + templateUrl)"
        - "`$templateCache` — seeding and inspection"
        - "`$templateRequest` — async fetch, deduplication, cache integration, `ignoreRequestError` flag"
        - "Wrapper pattern: `transclude: true` + `template` + `<ng-transclude>`" (worked example with `my-card`)
        - "Async compile semantics — synchronous linker + microtask install"
        - "Mock fetcher pattern for tests" (via `module.decorator('$templateRequest', …)` OR direct `createTemplateRequest({ fetcher: mockFn })`)
        - "Forward-pointers" (`replace: true` deferred permanently; `templateNamespace` deferred; `<script type="text/ng-template">` lands with built-in directives; `*-start`/`*-end` lands with structural directives; `$http` integration possible via decorator). **[Agent: typedoc-docs]**
  - [ ] Update `src/compiler/README.md` with a short "Template Loading" subsection forward-pointing to `src/template/README.md`. **[Agent: typedoc-docs]**
  - [ ] Update `CLAUDE.md` per FS §2.15:
        - "Modules" table — new row for `./template` listing `$templateCache`, `$templateRequest`, `createTemplateCache`, `createTemplateRequest`, the ten new error classes, and the public types
        - "Modules" table — amend the `./compiler` row to mention `template`/`templateUrl` DDO support
        - "Non-obvious invariants" — six new bullets covering: template install ordering (after transclude capture, before per-directive compile); sync `Linker` preserved with deferred subtree linking; `$templateRequest` deduplicates concurrent fetches via `inFlight` map; `replace: true` deliberately deferred permanently; function-form templates called exactly once per compile; reuse `'$compile'` cause for every error site
        - "Where to look when…" — three new rows: template install pipeline → `src/compiler/compile.ts`; async deferred drain → `src/compiler/compile.ts` (`drainDeferredTemplateQueue`); `$templateRequest` dedup → `src/template/template-request.ts`. **[Agent: typedoc-docs]**
  - [ ] TSDoc audit on every new public export — `TemplateCacheService`, `TemplateRequestFn`, `TemplateCacheInfo`, `TemplateFetcher`, `TemplateFn`, `TemplateUrlFn`, `createTemplateCache`, `createTemplateRequest`, and the ten error classes. Each carries at least one runnable example per FS §2.15 acceptance #4. The `template` DDO TSDoc carries the FS §2.1 worked example; the `templateUrl` TSDoc shows the `$templateCache` seeding pattern + the async sync-linker contract. **[Agent: typedoc-docs]**
  - [ ] Create `src/compiler/__tests__/template-errors.test.ts` consolidating cross-cutting error-surface tests (per-feature errors already covered in Slices 4, 5, 6):
        - Custom `$exceptionHandler` that itself throws falls back to `console.error` (spec-014 recursion guard preserved); template loading does NOT crash
        - `EXCEPTION_HANDLER_CAUSES.length === 10` regression
        - `'$compile' satisfies ExceptionHandlerCause` compile-time assertion
        - Each of the ten new error classes routes via `'$compile'` cause (spy-based regression). **[Agent: vitest-testing]**
  - [ ] Final regression check: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All five gates pass. `dist/{esm,cjs,types}/template/index.{mjs,cjs,d.ts}` outputs include the full template surface (`createTemplateCache`, `createTemplateRequest`, the public types). `dist/types/compiler/index.d.ts` includes `TemplateFn`, `TemplateUrlFn`, and the ten error classes. The full prior-spec test suite (002–018) passes unchanged. **[Agent: rollup-build]**

---

## Notes for the Implementation Agent

- **`$compile`'s `Linker` signature is unchanged.** Spec-017 + spec-018 callers must remain assignable. Async work is internal — never surfaces in the public type.
- **No new `EXCEPTION_HANDLER_CAUSES` entry.** The `'$compile'` token from spec 017 covers every template-related error site per FS §2.12. The tuple stays at 10 entries.
- **`replace: true` is REJECTED permanently** at registration. AngularJS 1.x officially deprecated it; this project will not ship it unless a specific use case justifies the correctness debt.
- **`<template>` element parsing is the chosen mechanism** (`parseTemplate(html)` in §2.9). HTML5-spec-compliant fragment parsing. Special-case wrapping for `<tr>`/`<td>`/`<col>` is DEFERRED — out of scope; AngularJS-canonical `wrapMap` workaround can land in a future spec.
- **`fetch` not available in older test environments** — jsdom v22+ supports it via undici. Default fetcher checks `globalThis.fetch` and throws if missing. Tests can inject a mock fetcher via `createTemplateRequest({ fetcher })`.
- **Async test discipline** — every test that compiles a `templateUrl` directive `await`s `Promise.resolve()` (possibly twice — once for cache resolution, once for chained `.then`). Vitest fake timers are available but not needed by default.
- **Module-DSL `.directive` is still OUT of scope.** All directive registration goes through `$compileProvider.directive(...)` from a config block, consistent with specs 017/018.
- **`$rootScope` is still NOT registered on `ngModule`.** Tests construct `Scope.create()` directly. Deferred to "Application Bootstrap".
- **No browser tests.** jsdom is sufficient — `<template>`, `fetch`, and `Node.cloneNode(true)` all work as expected.
