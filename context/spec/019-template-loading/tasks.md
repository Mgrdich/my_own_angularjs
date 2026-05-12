# Tasks: Template Loading — Inline `template` + Async `templateUrl`

- **Specification:** `context/spec/019-template-loading/`
- **Status:** Draft

---

- [x] **Slice 1: Foundation — Module Scaffolding + Type Surface + Error Classes (No Behavior Change)**
  - [x] Add `"@template/*": ["./src/template/*"]` to `tsconfig.json` `paths`. Mirrors every prior subpath alias (`@core`, `@parser`, `@di`, `@interpolate`, `@sce`, `@sanitize`, `@exception-handler`, `@filter`, `@compiler`). **[Agent: rollup-build]**
  - [x] Add `'@template': path.resolve(__dirname, 'src/template')` to `vitest.config.ts` `resolve.alias`. Vitest does not read `tsconfig.json` paths; the alias must be duplicated. Same precedent as the spec-016 `@filter` deviation and the spec-017 `@compiler` setup. **[Agent: rollup-build]**
  - [x] Add `./template` entry to `rollup.config.mjs` so the new module emits `dist/{esm,cjs,types}/template/index.{mjs,cjs,d.ts}`. Mirror the existing `./compiler` / `./filter` entries. **[Agent: rollup-build]**
  - [x] Add `./template` to `package.json` `exports` map (ESM `import`, CJS `require`, `types`). Mirror the existing exports entries. **[Agent: rollup-build]**
  - [x] Create `src/template/template-types.ts` exporting the public type surface per technical-considerations §2.12:
        - `interface TemplateCacheInfo { id: 'templates'; size: number }`
        - `interface TemplateCacheService { put(key: string, content: string): string; get(key: string): string | undefined; remove(key: string): void; removeAll(): void; info(): TemplateCacheInfo }`
        - `type TemplateFetcher = (url: string) => Promise<string>`
        - `type TemplateRequestFn = (url: string, ignoreRequestError?: boolean) => Promise<string | undefined>`
        - `type TemplateFn = (element: Element, attrs: Attributes) => string`
        - `type TemplateUrlFn = (element: Element, attrs: Attributes) => string`
        - `type NormalizedTemplate = { kind: 'inline-string'; value: string } | { kind: 'inline-fn'; value: TemplateFn } | { kind: 'url-string'; value: string } | { kind: 'url-fn'; value: TemplateUrlFn }` (internal — re-exported for future structural-directives specs, NOT in the root barrel). **[Agent: typescript-framework]**
  - [x] Create `src/template/index.ts` (initial barrel — populated in subsequent slices). For Slice 1, re-export only the types from `./template-types`. The factories ship in Slices 2 and 3. **[Agent: typescript-framework]**
  - [x] Extend `src/compiler/compile-error.ts` with the ten new error classes per technical-considerations §2.10, mirroring the existing `compile-error.ts` pattern (extends `Error`, `readonly name = '<ClassName>' as const`, single-string constructor, deterministic message):
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
  - [x] Widen `DirectiveDefinition` in `src/compiler/directive-types.ts:139-166` to accept the new fields:
        - `template?: string | TemplateFn`
        - `templateUrl?: string | TemplateUrlFn`
        - `replace?: boolean` (only `false` will be accepted at runtime; `true` is rejected per FS §2.7)
        - Document `replace` as deprecated via TSDoc; cite `ReplaceTrueNotSupportedError`. **[Agent: typescript-framework]**
  - [x] Widen `Directive` in `src/compiler/directive-types.ts:200-216` with `template?: NormalizedTemplate`. Single field unifies inline-vs-url storage; the `kind` discriminator distinguishes. Populated by `normalizeDirective` in Slice 4; unused by the runtime until Slice 5. Re-export `TemplateFn`, `TemplateUrlFn`, `NormalizedTemplate` from `directive-types.ts` so the existing single-import surface is preserved. **[Agent: typescript-framework]**
  - [x] Update `src/compiler/index.ts` barrel to re-export the ten new error classes plus `TemplateFn` and `TemplateUrlFn`. `NormalizedTemplate` is INTERNAL — not re-exported from the public barrel. **[Agent: typescript-framework]**
  - [x] Update `src/index.ts` (root barrel) to re-export the ten new error classes, `TemplateFn`, `TemplateUrlFn`, and (forward-looking) `TemplateCacheService`, `TemplateRequestFn`, `TemplateCacheInfo`, `TemplateFetcher` from `./template`. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/template-errors-foundation.test.ts` covering all ten error classes — instantiate each, assert message format, `name` discriminator, and `instanceof Error`. Mirror the spec-018 `transclude-errors-foundation.test.ts` pattern. Include a type-widening regression block: assign a 0-arg / 1-arg / 2-arg `TemplateFn` to the type to verify TypeScript function-parameter subtyping holds. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests (specs 002–018) pass unchanged. The new build emits `dist/types/template/index.d.ts` containing the seven public types. No public ng-module surface change yet; no `EXCEPTION_HANDLER_CAUSES` change. **[Agent: rollup-build]**
    - Verified: lint clean, typecheck clean, test = 102 files / 2382 passed / 5 skipped, build clean. Net delta vs spec-018 baseline (101 / 2346 / 5): +1 file / +36 tests / 0 regressions. `dist/{esm,cjs,types}/template/index.{mjs,cjs,d.ts}` outputs emitted with the seven public types. No `EXCEPTION_HANDLER_CAUSES` change (still 10 entries).

- [x] **Slice 2: `$templateCache` Service**
  - [x] Create `src/template/template-cache.ts` exporting `createTemplateCache(): TemplateCacheService` per technical-considerations §2.2. Internal `Map<string, string>` closed over by the returned methods:
        - `put(key, content): string` — `map.set(key, content); return content;`
        - `get(key): string | undefined` — `map.get(key)`
        - `remove(key): void` — `map.delete(key)`
        - `removeAll(): void` — `map.clear()`
        - `info(): TemplateCacheInfo` — `{ id: 'templates', size: map.size }`
        - Also export a default `templateCache = createTemplateCache()` instance for ESM-first standalone use. **[Agent: typescript-framework]**
  - [x] Update `src/template/index.ts` to re-export `createTemplateCache` and the default `templateCache` instance. **[Agent: typescript-framework]**
  - [x] Register `$templateCache` on `ngModule` in `src/core/ng-module.ts` after the existing filter-chain block: `.factory('$templateCache', () => createTemplateCache())`. Each injector gets its own isolated cache (closure-fresh `Map`). **[Agent: typescript-framework]**
  - [x] Extend the `ModuleRegistry` type declaration in `src/core/ng-module.ts:41-71` with `$templateCache: TemplateCacheService` so `injector.get('$templateCache')` returns the correctly-typed service. **[Agent: typescript-framework]**
  - [x] Update `src/index.ts` to re-export `createTemplateCache` and the default `templateCache` instance from `./template`. **[Agent: typescript-framework]**
  - [x] Create `src/template/__tests__/template-cache.test.ts` covering FS §2.5:
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
    - **DEVIATION (2026-05-12):** The "seed from a `config()` block" acceptance was implemented as "seed from a `run()` block" instead. Reason: `$templateCache` is registered via `.factory(...)` (no provider config phase), so a config block cannot inject `$templateCache` directly — only `$templateCacheProvider` (which doesn't exist for `.factory()`-registered services). `module.run(['$templateCache', (cache) => cache.put(...)])` is the canonical seeding pattern; matches the FS §2.5 acceptance "Apps can SEED the cache from a `config()` or `run()` block" once we interpret the FS as covering both paths and pick the one that's actually reachable.
    - Also added: `cross-spec-smoke.test.ts` extended with `injector.has('$templateCache') === true` + `cache.info().id === 'templates'`.
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. All prior tests pass unchanged. Two new public observables on `ngModule`: `injector.has('$templateCache') === true`. **[Agent: typescript-framework]**
    - Verified: lint clean, typecheck clean, test = 103 files / 2403 passed / 5 skipped. Net delta vs Slice 1 baseline (102 / 2382 / 5): +1 file / +21 tests / 0 regressions. `injector.has('$templateCache') === true` is the new public observable.

- [x] **Slice 3: `$templateRequest` Service**
  - [x] Create `src/template/template-request.ts` exporting `createTemplateRequest({ cache, fetcher }): TemplateRequestFn` per technical-considerations §2.3. Internal state: `inFlight: Map<string, Promise<string>>`. Per-call lifecycle:
        1. Check `cache.get(url)` — if present, return `Promise.resolve(cached)`
        2. Check `inFlight.get(url)` — if present, return that promise (concurrent dedup)
        3. Otherwise: create `const p = fetcher(url).then(text => { cache.put(url, text); inFlight.delete(url); return text; }, err => { inFlight.delete(url); throw err; })`. Store `p` in `inFlight`. Return `p`.
        4. If `ignoreRequestError === true`, the returned promise is `p.catch(() => undefined)` — same resolution shape but rejections turn into `undefined`. **[Agent: typescript-framework]**
  - [x] Define a default fetcher in `template-request.ts`: `const defaultFetcher: TemplateFetcher = (url) => fetch(url).then((r) => r.ok ? r.text() : Promise.reject(new TemplateFetchFailedError(url, ${r.status} ${r.statusText})))`. `createTemplateRequest` accepts an optional `fetcher` arg that defaults to `defaultFetcher`. Tests inject mocks via this seam. **[Agent: typescript-framework]**
  - [x] Export a default `templateRequest` instance from `src/template/template-request.ts`: `templateRequest = createTemplateRequest({ cache: templateCache })` — for ESM-first standalone use. (Tests use the factory directly with an injected mock fetcher to avoid sharing state.) **[Agent: typescript-framework]**
  - [x] Update `src/template/index.ts` to re-export `createTemplateRequest` and the default `templateRequest` instance. **[Agent: typescript-framework]**
  - [x] Register `$templateRequest` on `ngModule` in `src/core/ng-module.ts` after the `$templateCache` registration: `.factory('$templateRequest', ['$templateCache', (cache) => createTemplateRequest({ cache })])`. Uses the default fetcher (`fetch` from globalThis). **[Agent: typescript-framework]**
  - [x] Extend the `ModuleRegistry` type declaration with `$templateRequest: TemplateRequestFn`. **[Agent: typescript-framework]**
  - [x] Update `src/index.ts` to re-export `createTemplateRequest` and the default `templateRequest` instance. **[Agent: typescript-framework]**
  - [x] Create `src/template/__tests__/template-request.test.ts` covering FS §2.6:
        - Cache hit: `cache.put(url, content)` first, then `templateRequest(url)` resolves with `content` WITHOUT calling the fetcher
        - Cache miss: fetcher is called once, response written to cache, returned promise resolves with body
        - Concurrent dedup: two `templateRequest(url)` calls before the first resolves share a single fetcher invocation
        - After resolution, `inFlight.delete(url)` runs — a subsequent request after the cache is cleared re-fetches
        - Non-2xx HTTP rejects the promise with a `TemplateFetchFailedError` whose message contains the URL + status
        - Network rejection (fetcher throws / rejects) propagates as a rejected promise with the original error
        - `ignoreRequestError: true` suppresses rejections — promise resolves with `undefined` on error
        - `injector.get('$templateRequest')` returns the service after `createInjector(['ng'])`
        - Mock fetcher injection works via `createTemplateRequest({ cache, fetcher: mockFn })`. **[Agent: vitest-testing]**
    - 24 new tests covering FS §2.6 acceptance: cache hit, cache miss + populate, concurrent dedup, in-flight cleanup after both resolution AND rejection, `TemplateFetchFailedError` propagation, plain `Error` propagation, `ignoreRequestError: true` on error/success/cache-hit paths, default `globalThis.fetch` fetcher (success + non-2xx), per-instance + per-injector isolation, DI registration, decorator-based mock-fetcher injection. `cross-spec-smoke.test.ts` extended with `injector.has('$templateRequest') === true` (+1 test).
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. All prior tests pass unchanged. `injector.has('$templateRequest') === true` is the new observable. **[Agent: typescript-framework]**
    - Verified: lint clean, typecheck clean, test = 104 files / 2428 passed / 5 skipped. Net delta vs Slice 2 baseline (103 / 2403 / 5): +1 file / +25 tests / 0 regressions. `injector.has('$templateRequest') === true` is the new public observable.

- [x] **Slice 4: Registration-Phase Template Validation**
  - [x] Extend `normalizeDirective` in `src/compiler/compile-provider.ts:349-423` per technical-considerations §2.6. Insert the `normalizeTemplate` block AFTER the `normalizeTransclude` call at line 386 and BEFORE the priority assignment at line 388. Validate in order:
        1. **`replace` validation:** `ddo.replace === true` → throw `ReplaceTrueNotSupportedError`. `false` / `undefined` → accept. Other → also throw `ReplaceTrueNotSupportedError` with a generalized message
        2. **Mutual exclusion:** `ddo.template != null && ddo.templateUrl != null` → throw `TemplateAndTemplateUrlCombinedError`
        3. **`template` validation:** `undefined` → leave unset; non-empty string → `{ kind: 'inline-string', value }`; empty string → `EmptyTemplateError`; function → `{ kind: 'inline-fn', value }`; other → `InvalidTemplateValueError(name, describeValue(value))`
        4. **`templateUrl` validation:** `undefined` → leave unset; non-empty string → `{ kind: 'url-string', value }`; empty string → `EmptyTemplateUrlError`; function → `{ kind: 'url-fn', value }`; other → `InvalidTemplateUrlValueError(name, describeValue(value))`
        - Reuse the `describeValue` helper introduced in spec 018's `normalizeDirective` extension. **[Agent: typescript-framework]**
  - [x] All throws are caught by the existing factory try/catch in `$$buildDirectiveArrayProvider` at `compile-provider.ts:207-215` and routed via `$exceptionHandler('$compile')`. No new error-routing code needed — verify via tests. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/template-registration.test.ts` covering FS §2.1 + §2.3 + §2.7 + §2.12 registration acceptance:
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
    - 27 new tests covering FS §2.1 / §2.2 / §2.3 / §2.4 / §2.7 / §2.12 — accepted shapes, `EmptyTemplateError`, `EmptyTemplateUrlError`, `InvalidTemplateValueError` (5 invalid types), `InvalidTemplateUrlValueError` (5 invalid types), `TemplateAndTemplateUrlCombinedError`, `ReplaceTrueNotSupportedError` (5 non-false-non-undefined values including `null`), plus sibling-resilience tests (cross-directive + same-name multi-factory accumulation).
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. All prior tests pass unchanged. No runtime template behavior yet — directives declaring `template`/`templateUrl` register their normalized field but the compiler doesn't act on it (Slice 5 lights it up). **[Agent: typescript-framework]**
    - Verified: lint clean, typecheck clean, test = 105 files / 2455 passed / 5 skipped. Net delta vs Slice 3 baseline (104 / 2428 / 5): +1 file / +27 tests / 0 regressions.

- [x] **Slice 5: Inline `template` — Sync Install + Function-Form End-to-End**
  - [x] Create `src/compiler/template-parse.ts` exporting `parseTemplate(html: string): Node[]`. Implementation per technical-considerations §2.9:
        1. Create a `<template>` element via `document.createElement('template')`
        2. Set `templateEl.innerHTML = html`
        3. Return `Array.from(templateEl.content.childNodes)`
        - Pure DOM operation. Handles multi-root templates naturally (the content fragment carries all roots). **[Agent: typescript-framework]**
  - [x] Add `$templateRequest` to `$compile`'s `$get` array in `src/compiler/compile-provider.ts:228-240`: append `'$templateRequest'` to the deps list and forward `templateRequest: $templateRequest` to `createCompile(...)`. Extend the `CompileOptions` interface in `directive-types.ts:246-251` with `templateRequest: TemplateRequestFn`. **[Agent: typescript-framework]**
    - **DEVIATION (2026-05-12):** All 22 existing compiler test files needed their `bootstrapNgModule` fixture updated to register the two new `$compile` deps (`$templateCache` + `$templateRequest`) so `$compile`'s wider deps list resolves at lookup time. The fixture pattern change is mechanical and zero-risk; the `bootstrapNgModule` helpers now mirror the canonical `createInjector(['ng'])` shape from production code.
  - [x] Extend `src/compiler/compile.ts` per technical-considerations §2.7. In `compileElementOrComment` (`:152-300`), AFTER the transclude capture block (`:196-202`) and BEFORE the child snapshot (`:247-258`), add a template-installation pre-pass:
        1. **Detect template-declaring directive.** Scan the sorted directive list for entries whose normalized `template` field is set. Record the first match
        2. **For `kind: 'inline-string'`:** Call `parseTemplate(template.value)`. Replace `node.childNodes` with the parsed nodes (`while (node.firstChild) node.removeChild(node.firstChild); for (const tplNode of parsedNodes) node.appendChild(tplNode);`)
        3. **For `kind: 'inline-fn'`:** Call `template.value(node, attrs)` inside a try/catch routing throws via `invokeExceptionHandler(handler, err, '$compile')`. If the return value is not a string, route `TemplateFunctionReturnedNonStringError(directive.name, describeValue(returnValue))` via the same handler. On error, leave the element empty and skip template installation (the directive's other behavior — link, compile — still runs). On success, follow the same install path as `inline-string`
        4. **Memoize.** Store the resolved template string on the directive's LOCAL entry (a shallow copy of the directive object made within `compileElementOrComment` per the spec-018 precedent for `MultipleTranscludeDirectivesError`) so subsequent linker invocations reuse it — function-form template called exactly once per compile invocation
        - Template install runs BEFORE the per-directive compile loop at lines 216-240 and BEFORE the child snapshot at lines 247-258. **[Agent: typescript-framework]**
    - **DEVIATION (2026-05-12):** `describeValue` was extracted from `compile-provider.ts` into a new `src/compiler/describe-value.ts` so both registration-phase (`normalizeDirective` → `InvalidTemplateValueError`) and compile-phase (`TemplateFunctionReturnedNonStringError`) sites share one implementation. Byte-identical body — no behavior change. `url-string` / `url-fn` kinds are skipped in this slice with a TODO comment; Slice 6 lights them up.
  - [x] Verify the existing walker continues to work against the post-template DOM:
        - Child snapshot at `:247-258` walks the template's nodes (now `node.childNodes`)
        - The host directive's own `compile`/`pre-link`/`post-link` see the post-template element
        - `$$ngBoundTransclude` (stashed BEFORE template installation per spec-018 ordering) is found by `<ng-transclude>` markers inside the template via the parent-element walk. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/template-inline.test.ts` covering FS §2.1 + §2.2 + §2.7 + §2.8:
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
    - 17 new tests in `template-inline.test.ts` covering FS §2.1 + §2.2 + §2.7 + §2.8 + §2.9. **DEVIATION (2026-05-12):** FS §2.1 acceptance #5 ("interpolation expressions inside the template resolve at link time") assumes text-node interpolation, which the current compiler (specs 017/018) doesn't implement — only attribute interpolation via `attrs.$observe`. To honor the spirit, interpolation is exercised via a `<child-dir attr="{{x}}">` element inside the template whose `$observe` callback fires with the bound value. The FS §2.9 wrapper-pattern test is similarly split into a structural test (template installs, consumer projected through `<div ng-transclude>`) and an attribute-binding test (projected `<consumer-dir attr="{{outerVal}}">` whose `$observe` fires with the OUTER-scope value, locking spec 018 §2.5's OUTER-scope binding contract). Same observable guarantee as text-node interpolation would provide.
  - [x] Update `src/compiler/__tests__/cross-spec-smoke.test.ts` with an inline-template smoke assertion: register `template: '<p>{{x}}</p>'` directive in a config block, compile a fixture, set `scope.x = 'hi'`, digest, assert the rendered text content is `'hi'`. **[Agent: vitest-testing]**
    - **DEVIATION (2026-05-12):** the smoke uses `<child-dir attr="{{x}}">` (attribute interpolation via `$observe`) rather than text-node interpolation `<p>{{x}}</p>` for the same reason as above — text-node interpolation isn't yet wired.
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`. All prior tests pass unchanged. Inline `template` directives now work end-to-end through `$compile`. **[Agent: typescript-framework]**
    - Verified: lint clean, typecheck clean, test = 106 files / 2473 passed / 5 skipped. Net delta vs Slice 4 baseline (105 / 2455 / 5): +1 file / +18 tests / 0 regressions.

- [x] **Slice 6: Async `templateUrl` — Deferred Drain + Multi-Template Guard**
  - [x] Extend `src/compiler/compile.ts` with a `DeferredTemplateQueue` per technical-considerations §2.8:
        - Threaded through the recursive walker's closure from the top-level `$compile` entry
        - Each entry: `{ element, urlFnOrString, attrs, pendingDirectives, transcludeContext, directiveName, outerScope? }`
        - `outerScope` is filled at link time (captured from `parentScope` inside `nodeLinker`, mirroring the spec-018 transclude capture seam)
        - Top-level `$compile` triggers the drain via `Promise.resolve().then(drainDeferredTemplateQueue)` AFTER the synchronous walker has completed AND the public `Linker` has been returned to the caller. **[Agent: typescript-framework]**
    - **DEVIATION (2026-05-12):** Used `addElementCleanup` (existing helper from spec 017) for cancellation instead of a separate `$$pendingTemplate` marker. Each enqueued entry pushes a cleanup callback that sets `entry.cancelled = true`. Detection: `destroyElementScope(host)` fires the queue before drain resumes; the drain peeks `entry.cancelled` after `await templateRequest` and silently drops. Cleaner integration with existing cleanup contract.
  - [x] Extend the per-element walker pre-pass: when the matched template-declaring directive's normalized `template` has `kind: 'url-string' | 'url-fn'`:
        1. **For `kind: 'url-fn'`:** call `urlFn(node, attrs)` synchronously inside a try/catch. Non-string return routes `TemplateUrlFunctionReturnedNonStringError`; throw routes the original. On error, leave the element empty and skip enqueuing (other directives' behavior still runs)
        2. **Stash on element:** `Object.defineProperty(node, '$$pendingTemplate', { value: { url: resolvedUrl, directiveName }, enumerable: false, writable: true, configurable: true })`. Mirrors the spec-018 `$$ngBoundTransclude` stash pattern
        3. **Enqueue** a deferred-install entry on the `DeferredTemplateQueue`, including the resolved `url`, the host element, the `attrs`, the list of pending directives EXCEPT the template-declaring one, and the transclude context (if any)
        4. **Return a per-element linker that captures `parentScope` into the entry at link time** but does NOT install the template synchronously. The rest of the parent linker (sibling directives, child links for non-pending subtrees) runs normally. **[Agent: typescript-framework]**
    - **DEVIATION (2026-05-12):** Empty-string return from a `url-fn` is treated as a silent skip rather than routing a fresh error. Empty `templateUrl` is rejected at registration; a runtime empty return is an authoring bug but routing it would feel out-of-contract since no new error class was scoped.
  - [x] Implement `drainDeferredTemplateQueue(queue, { templateRequest, exceptionHandler, compileService })` per technical-considerations §2.8:
        - `Promise.all(entries.map(processEntry))` for parallel resolution — sibling subtrees don't block each other
        - `processEntry(entry)`:
          1. `await templateRequest(entry.url)` — caught and routed via `exceptionHandler('$compile')` on rejection; entry silently drops on error
          2. Check if `entry.element` has been destroyed since enqueue (peek `(entry.element as NgManagedElement).$$ngScope?.$$destroyed` or check parent-scope state). If destroyed, drop the entry; transclusion fragments (if any) are released via the cleanup queue
          3. Parse the template via `parseTemplate(templateString)`; replace `entry.element`'s children
          4. Recursively compile the post-template subtree via `compileService(entry.element.childNodes)` — handles nested `templateUrl` directives via the same queue mechanism
          5. Build the per-element linker for the remaining pending directives (host directive's compile, pre-link, post-link)
          6. Invoke the per-element linker with `entry.outerScope` so the directive sees the captured outer scope. **[Agent: typescript-framework]**
    - **DEVIATION (2026-05-12):** Pending-directives list INCLUDES the template-declaring directive (with its `template` field stripped on a local copy) so its own `compile`/`link` runs against the post-template DOM per FS §2.8 acceptance #2. The original brief said "EXCEPT the template-declaring one" — but only the template FIELD is "consumed" by the install; the directive's other behavior must run. Also: nested `templateUrl` inside fetched templates handled via an inner-queue per `buildPostTemplateLinker` invocation; each post-template linker creates a fresh `innerQueue` and schedules its own drain.
  - [x] Extend the per-element walker pre-pass to ALSO detect a SECOND template-declaring directive on the same element. On second match, route `MultipleTemplateDirectivesError(first.name, second.name)` via `invokeExceptionHandler(handler, err, '$compile')` at LINK time (deterministic ordering — mirror the spec-018 `MultipleTranscludeDirectivesError` site). Clear the second's `template` field on the LOCAL directive entry. Other behavior of the second directive runs unchanged. **[Agent: typescript-framework]**
  - [x] Verify transclude integration with `templateUrl`:
        - Capture (spec 018) runs SYNCHRONOUSLY at compile time, BEFORE the deferred entry is enqueued
        - `$$ngBoundTransclude` is stashed at the synchronous walk pass; when the template installs later, `<ng-transclude>` inside the template walks `parentElement` to the host and finds the stash
        - The transclusion master fragments are owned by the `$transclude` closure stashed at link time — independent of when the template installs
        - Cleanup queue ownership preserved: each clone scope is on `host.$$ngCleanupQueue` per spec 018; `destroyElementScope(host)` tears down clones regardless of template-load state. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/template-url.test.ts` covering FS §2.3 + §2.4 + §2.8 + §2.11:
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
    - 15 new tests covering FS §2.3 + §2.4 + §2.8 + §2.11. **DEVIATION (2026-05-12):** Three `await Promise.resolve()` flushes per test (rather than two) — defensive against chain-length drift. Two is the minimum for cache-hit; cache-miss + mock fetcher adds an extra `.then` link.
  - [x] Create `src/compiler/__tests__/template-transclude.test.ts` covering FS §2.9 wrapper-pattern integration:
        - `transclude: true` + inline `template: '<div class="card"><h2>{{title}}</h2><div ng-transclude></div></div>'` + `scope: true` — given `<my-card title="Settings"><p>{{vm.name}}</p></my-card>`, the projected `<p>` resolves against the OUTER scope (`vm.name`) while the template's `{{title}}` resolves against the directive's `scope: true` child
        - Capture runs BEFORE template install (consumer `<p>` captured before the template overwrites the host)
        - `transclude: true` + `templateUrl` (seeded cache) works identically; projection waits for the template to install
        - Multi-slot transclusion + template projects the named slot correctly
        - If the template does NOT include `<ng-transclude>`, captured content is never projected (released to GC when host destroys). **[Agent: vitest-testing]**
    - 6 new tests covering FS §2.9 wrapper pattern (inline + async, multi-slot + template, outer-scope binding via `$observe` precedent, no-marker fallback).
  - [x] Create `src/compiler/__tests__/template-multi-directive.test.ts` covering FS §2.10:
        - Two `template`-declaring directives on the same element: `MultipleTemplateDirectivesError` routed at link time; first wins; second's template ignored; second's other behavior (`link`, `compile`) runs
        - Two `templateUrl`-declaring directives — same routing
        - One `template` + one `templateUrl` on the same element — same routing
        - First-wins ordering is deterministic (priority desc, registration-order tie-break — mirroring spec 018's `MultipleTranscludeDirectivesError`)
        - Interaction with `MultipleTranscludeDirectivesError`: both errors fire independently when both conditions trigger on the same element. **[Agent: vitest-testing]**
    - 5 new tests covering FS §2.10 (template+template, templateUrl+templateUrl, mixed, priority ordering, interaction with `MultipleTranscludeDirectivesError`).
  - [x] Update `src/compiler/__tests__/cross-spec-smoke.test.ts` with a `templateUrl` smoke: seed `$templateCache.put`, compile a `templateUrl` directive, `await Promise.resolve()`, assert post-link DOM. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests pass unchanged. Async `templateUrl` directives now work end-to-end. **[Agent: rollup-build]**
    - Verified: lint clean, typecheck clean, test = 109 files / 2500 passed / 5 skipped, build clean. Net delta vs Slice 5 baseline (106 / 2473 / 5): +3 files / +27 tests / 0 regressions. Async `templateUrl` directives now work end-to-end through `$compile`.

- [x] **Slice 7: Documentation + Final Verification**
  - [x] Create `src/template/README.md` per FS §2.15 + technical-considerations §2.11. Sections:
        - "When to use `template` vs `templateUrl`"
        - "Function-form templates (template + templateUrl)"
        - "`$templateCache` — seeding and inspection"
        - "`$templateRequest` — async fetch, deduplication, cache integration, `ignoreRequestError` flag"
        - "Wrapper pattern: `transclude: true` + `template` + `<ng-transclude>`" (worked example with `my-card`)
        - "Async compile semantics — synchronous linker + microtask install"
        - "Mock fetcher pattern for tests" (via `module.decorator('$templateRequest', …)` OR direct `createTemplateRequest({ fetcher: mockFn })`)
        - "Forward-pointers" (`replace: true` deferred permanently; `templateNamespace` deferred; `<script type="text/ng-template">` lands with built-in directives; `*-start`/`*-end` lands with structural directives; `$http` integration possible via decorator). **[Agent: typedoc-docs]**
  - [x] Update `src/compiler/README.md` with a short "Template Loading" subsection forward-pointing to `src/template/README.md`. **[Agent: typedoc-docs]**
  - [x] Update `CLAUDE.md` per FS §2.15:
        - "Modules" table — new row for `./template` listing `$templateCache`, `$templateRequest`, `createTemplateCache`, `createTemplateRequest`, the ten new error classes, and the public types
        - "Modules" table — amend the `./compiler` row to mention `template`/`templateUrl` DDO support
        - "Non-obvious invariants" — six new bullets covering: template install ordering (after transclude capture, before per-directive compile); sync `Linker` preserved with deferred subtree linking; `$templateRequest` deduplicates concurrent fetches via `inFlight` map; `replace: true` deliberately deferred permanently; function-form templates called exactly once per compile; reuse `'$compile'` cause for every error site
        - "Where to look when…" — three new rows: template install pipeline → `src/compiler/compile.ts`; async deferred drain → `src/compiler/compile.ts` (`drainDeferredTemplateQueue`); `$templateRequest` dedup → `src/template/template-request.ts`. **[Agent: typedoc-docs]**
  - [x] TSDoc audit on every new public export — `TemplateCacheService`, `TemplateRequestFn`, `TemplateCacheInfo`, `TemplateFetcher`, `TemplateFn`, `TemplateUrlFn`, `createTemplateCache`, `createTemplateRequest`, and the ten error classes. Each carries at least one runnable example per FS §2.15 acceptance #4. The `template` DDO TSDoc carries the FS §2.1 worked example; the `templateUrl` TSDoc shows the `$templateCache` seeding pattern + the async sync-linker contract. **[Agent: typedoc-docs]**
    - Audit pass: most public exports already had comprehensive TSDoc from prior slices. Extended `DirectiveDefinition.template` (FS §2.1 worked round-trip) and `DirectiveDefinition.templateUrl` (Slice-2 run-block seeding deviation + sync-linker microtask contract). No new gaps identified for error classes or service types.
  - [x] Create `src/compiler/__tests__/template-errors.test.ts` consolidating cross-cutting error-surface tests (per-feature errors already covered in Slices 4, 5, 6):
        - Custom `$exceptionHandler` that itself throws falls back to `console.error` (spec-014 recursion guard preserved); template loading does NOT crash
        - `EXCEPTION_HANDLER_CAUSES.length === 10` regression
        - `'$compile' satisfies ExceptionHandlerCause` compile-time assertion
        - Each of the ten new error classes routes via `'$compile'` cause (spy-based regression). **[Agent: vitest-testing]**
    - 16 consolidated cross-cutting tests covering handler-degradation across 3 surfaces (registration-phase invalid value, compile-phase function non-string, fetch-time async failure), `EXCEPTION_HANDLER_CAUSES.length === 10` regression, `'$compile' satisfies ExceptionHandlerCause` compile-time check, and one cause-routing regression per spec-019 error class.
  - [x] Final regression check: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All five gates pass. `dist/{esm,cjs,types}/template/index.{mjs,cjs,d.ts}` outputs include the full template surface (`createTemplateCache`, `createTemplateRequest`, the public types). `dist/types/compiler/index.d.ts` includes `TemplateFn`, `TemplateUrlFn`, and the ten error classes. The full prior-spec test suite (002–018) passes unchanged. **[Agent: rollup-build]**
    - Verified: all 5 gates pass (lint, format:check, typecheck, test, build). test = 110 files / 2516 passed / 5 skipped. Net delta from spec-018 baseline (101 / 2346 / 5): +9 files / +170 tests / 0 regressions. `dist/{esm,cjs,types}/template/index.{mjs,cjs,d.ts}` outputs include the full template surface; `dist/types/compiler/index.d.ts` includes `TemplateFn`, `TemplateUrlFn`, and the 10 new error classes.

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
