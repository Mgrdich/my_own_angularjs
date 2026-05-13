# Technical Specification: Template Loading — Inline `template` + Async `templateUrl`

- **Functional Specification:** [`functional-spec.md`](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Spec 019 extends `$compile` (spec 017) and the transclusion pipeline (spec 018) with the AngularJS-canonical template-loading model. Implementation introduces a **new first-party module** under `src/template/` for the two new services (`$templateCache`, `$templateRequest`) and threads a template-installation phase into the existing recursive compile walker.

Three integration seams in the current compiler carry the change:

1. **Template installation as the LAST step of the per-element pre-pass.** The existing `compileElementOrComment` pre-pass at `src/compiler/compile.ts:159-208` runs `MultipleTranscludeDirectivesError` detection (lines 166-185) and transclude capture (lines 196-202) BEFORE the per-directive compile loop at lines 216-240. Template installation slots in immediately AFTER transclude capture and BEFORE the child-snapshot at `:247-258`. For inline `template` (string + function form), installation is synchronous: parse the template string into nodes and replace the host element's children. For async `templateUrl`, the per-element linker is converted into a **deferred installer** that records the URL on the element via a private `$$pendingTemplate` marker, returns a synchronous no-op linker, and enqueues the deferred install on a per-`$compile`-call queue.

2. **`$compile` gains a per-invocation deferred-install queue.** When the recursive walker encounters a `templateUrl`-declaring directive, it pushes `{ element, urlFnOrString, attrs, pendingDirectives, transcludeContext }` onto a queue scoped to the top-level `$compile(node)` call. The synchronous `Linker` returned to the caller fires immediately; per-subtree linking for `templateUrl`-gated elements is deferred. The queue drains in a `Promise.then` chain: each entry calls `$templateRequest(url)`, awaits the fetch, installs the template via the same node-replacement helper, runs the host's per-directive compile loop against the post-template DOM, builds the child linker for the template subtree, and runs the link phases against the current scope. Multiple entries resolve independently — sibling subtrees do not block each other.

3. **`$templateRequest` and `$templateCache` are core services on `ngModule`.** Two ESM-first factories under a new `src/template/` subpath:
   - `createTemplateCache(): TemplateCacheService` — Map-backed key-value store with `put`/`get`/`remove`/`removeAll`/`info`.
   - `createTemplateRequest({ cache, fetcher })` — `(url, ignoreRequestError?) => Promise<string>`. Reads `cache.get(url)` first; on miss, calls `fetcher(url)` (defaults to `globalThis.fetch`); writes the response into the cache; returns the body. Concurrent requests for the same URL share a single in-flight promise via an `inFlight: Map<string, Promise<string>>`. Tests inject a mock `fetcher` to avoid network access.

Cross-cutting integrations:

- **`'$compile'` cause token is reused for every error site.** Per FS §2.12, `EXCEPTION_HANDLER_CAUSES.length` stays at 10. New error classes (`InvalidTemplateValueError`, `InvalidTemplateUrlValueError`, `TemplateAndTemplateUrlCombinedError`, `EmptyTemplateError`, `EmptyTemplateUrlError`, `ReplaceTrueNotSupportedError`, `TemplateFunctionReturnedNonStringError`, `TemplateUrlFunctionReturnedNonStringError`, `MultipleTemplateDirectivesError`, `TemplateFetchFailedError`) all route via `invokeExceptionHandler(handler, err, '$compile')`.
- **`DirectiveDefinition` and `Directive` types are widened in `directive-types.ts:139-166` and `:200-216`** to accept the new `template` / `templateUrl` / `replace` fields. Both are validated and normalized by `normalizeDirective` in `compile-provider.ts:349-423` (the same site that already validates `transclude` and rejects isolate scope at line 376).
- **Transclude integration is automatic.** Because template installation slots AFTER capture and BEFORE the child snapshot, the `transclude: true` + `template` wrapper pattern works without additional plumbing — the child snapshot at `:247` walks the template (not the original consumer content), and the captured fragment is available to the template's `<ng-transclude>` markers via the existing `$$ngBoundTransclude` stash.
- **Public `Linker` signature unchanged.** Per FS §2.11, `(scope: Scope) => Element | NodeList | Comment` is preserved. Async resolution happens internally; spec-017 callers remain assignable.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. Module Layout

**New first-party module under `src/template/`** following the ESM-first factory + DI provider shim pattern already proven by `interpolate`, `sce`, `sanitize`, `filter`:

| File | Responsibility |
| --- | --- |
| `index.ts` | Public barrel: re-exports `createTemplateCache`, `createTemplateRequest`, default `templateCache` / `templateRequest` instances (pure-fetch ESM for tests/SSR), all template-related types |
| `template-cache.ts` | `createTemplateCache(): TemplateCacheService` — pure Map-backed factory. The default exported `templateCache` is just `createTemplateCache()` — fresh state for every consumer that imports it (tests + standalone usage) |
| `template-request.ts` | `createTemplateRequest({ cache, fetcher, exceptionHandler? }): TemplateRequestFn` — closes over the cache + fetcher; manages `inFlight: Map<string, Promise<string>>` for dedup |
| `template-types.ts` | `TemplateCacheService`, `TemplateRequestFn`, `TemplateCacheInfo`, `TemplateFetcher` (the injectable fetch function shape) |

**Modified existing files:**

| File | Change |
| --- | --- |
| `src/compiler/directive-types.ts` | Widen `DirectiveDefinition` (`:139-166`) with `template?: string \| TemplateFn` and `templateUrl?: string \| TemplateUrlFn` and `replace?: boolean`. Widen `Directive` (`:200-216`) with the normalized internal forms: `template?: NormalizedTemplate` (where `NormalizedTemplate = { kind: 'inline' \| 'url'; value: string \| TemplateFn \| TemplateUrlFn }`). New public types `TemplateFn`, `TemplateUrlFn` re-exported. |
| `src/compiler/compile-error.ts` | Add ten new error classes (listed in §2.10) following the existing pattern (extends `Error`, `readonly name = '<ClassName>' as const`, single-string constructor, deterministic message). |
| `src/compiler/compile-provider.ts` | (a) Extend `normalizeDirective` (`:349-423`) with template validation right after the `normalizeTransclude` call at `:386`. (b) Inject `$templateRequest` into the `$get` array (`:228-240`) and forward it to `createCompile(...)`. (c) Extend `CompileOptions` interface accordingly. |
| `src/compiler/compile.ts` | (a) In `compileElementOrComment` (`:152-300`), after the transclude capture block (`:196-202`), insert a template-installation block that handles inline templates synchronously and queues `templateUrl` directives for deferred install. (b) Introduce a per-`$compile`-call `DeferredTemplateQueue` that the recursive walker passes through its closure. (c) After the synchronous walk completes, the top-level `$compile` entry triggers the queue drain via `Promise.resolve().then(...)`. |
| `src/core/ng-module.ts` | Register `$templateCache` and `$templateRequest` factories AFTER the existing filter-chain block (around `:79-90`). Extend the `ModuleRegistry` type declaration (`:41-71`) with the two new service names. |
| `src/index.ts` | Re-export `TemplateCacheService`, `TemplateRequestFn`, `TemplateFn`, `TemplateUrlFn`, and the ten new error classes via the existing compiler-re-export pattern. |
| `tsconfig.json` | Add `"@template/*": ["./src/template/*"]` to `paths`. |
| `vitest.config.ts` | Add `'@template': path.resolve(__dirname, 'src/template')` to `resolve.alias`. |
| `rollup.config.mjs` | Add a new entry for `./template` (mirrors the existing `./compiler` / `./sanitize` entries). |
| `package.json` | Add `./template` to the `exports` map (ESM + CJS + types). |

**New tests under `src/compiler/__tests__/`** and **`src/template/__tests__/`:**

| Test file | Concern |
| --- | --- |
| `src/template/__tests__/template-cache.test.ts` | `$templateCache` API surface — `put`/`get`/`remove`/`removeAll`/`info`; singleton behavior; programmatic seeding |
| `src/template/__tests__/template-request.test.ts` | `$templateRequest` — cache hit, cache miss + fetch + populate, concurrent dedup, non-2xx HTTP rejection, network rejection, `ignoreRequestError` flag, mock fetcher injection |
| `src/compiler/__tests__/template-inline.test.ts` | String `template` install, function-form `template`, multi-root templates, empty-template rejection, non-string rejection, function-return-non-string rejection, function-throw routing, template installs BEFORE child compile, multi-link reuses computed template (function called once per compile) |
| `src/compiler/__tests__/template-url.test.ts` | String `templateUrl`, function-form `templateUrl`, async install, deferred subtree linking, sync linker contract preserved, `templateUrl` + `template` mutual exclusion rejection, fetch-failure routing |
| `src/compiler/__tests__/template-transclude.test.ts` | Wrapper-pattern integration — `transclude: true` + `template` with `<ng-transclude>` in the template; `transclude: true` + `templateUrl`; multi-slot + template; outer-scope binding for projected content (spec 018 §2.5 preserved) |
| `src/compiler/__tests__/template-multi-directive.test.ts` | Two template directives on same element → `MultipleTemplateDirectivesError`; first wins; second's template ignored; second's other behavior runs |
| `src/compiler/__tests__/template-replace.test.ts` | `replace: true` rejection at registration; `replace: false` accepted; non-boolean values |
| `src/compiler/__tests__/template-errors.test.ts` | Consolidated error-surface tests (10 error classes); `EXCEPTION_HANDLER_CAUSES.length === 10` regression; `'$compile' satisfies ExceptionHandlerCause` |
| `src/compiler/__tests__/cross-spec-smoke.test.ts` | Extended with `injector.has('$templateCache') === true` + `injector.has('$templateRequest') === true` + an end-to-end template-loading smoke |

### 2.2. `createTemplateCache` ESM Factory

Signature (described, not coded):

- Inputs: none (no config surface needed in this spec).
- Output: `TemplateCacheService` object:
  - `put(key: string, content: string): string` — stores; returns `content` for chaining.
  - `get(key: string): string | undefined` — reads; returns `undefined` on miss.
  - `remove(key: string): void` — removes the entry.
  - `removeAll(): void` — clears the map.
  - `info(): { id: 'templates'; size: number }` — AngularJS-canonical introspection.

Internal state: a single `Map<string, string>` closed over by the returned methods. The exported default `templateCache` instance is constructed once at module load — but the DI factory (per §2.5) invokes `createTemplateCache()` afresh per injector, so each injector gets its own isolated cache.

### 2.3. `createTemplateRequest` ESM Factory

Signature:

- Inputs:
  - `cache: TemplateCacheService` — typically the result of `createTemplateCache()` (or the injected `$templateCache`).
  - `fetcher?: TemplateFetcher` — defaults to `(url) => fetch(url).then(r => r.ok ? r.text() : Promise.reject(new TemplateFetchFailedError(url, r.status, r.statusText)))`. Tests inject a mock.
  - `exceptionHandler?: ExceptionHandler` — optional; only used if the factory is configured to route errors directly (currently the caller routes — keep this optional and unused by default).
- Output: `TemplateRequestFn` = `(url: string, ignoreRequestError?: boolean) => Promise<string | undefined>`.

Per-call lifecycle:

1. Check `cache.get(url)` — if present, return `Promise.resolve(cached)` (microtask resolution).
2. Check `inFlight.get(url)` — if present, return that promise (concurrent dedup).
3. Otherwise: create `const p = fetcher(url).then(text => { cache.put(url, text); inFlight.delete(url); return text; }, err => { inFlight.delete(url); throw err; })`. Store `p` in `inFlight`. Return `p`.
4. If `ignoreRequestError === true`, the returned promise is `p.catch(() => undefined)` — same resolution shape, but rejections turn into `undefined`.

Implementation detail: the `inFlight` map ensures only ONE network request is in flight per URL. Once the fetch resolves (success or failure), the entry is removed so a subsequent request can re-fetch if the cache was cleared.

### 2.4. `$templateCache` / `$templateRequest` DI Registration

`src/core/ng-module.ts` gains two `.factory(...)` registrations after the existing filter chain at `:79-90`:

```
ngModule
  .factory('$templateCache', () => createTemplateCache())
  .factory('$templateRequest', [
    '$templateCache',
    (cache) => createTemplateRequest({ cache }),
  ]);
```

The `ModuleRegistry` type declaration at `ng-module.ts:41-71` gains `$templateCache: TemplateCacheService` and `$templateRequest: TemplateRequestFn` so `injector.get('$templateCache')` returns the correctly-typed service.

No `$XxxProvider` class is needed in this spec — both services are stateless factories with no config-phase configuration surface. If a future spec needs config (e.g., default `fetch` options or auth headers), it adds a provider via decorator. The TSDoc on `createTemplateRequest` documents the `fetcher` injection seam as the canonical way to swap implementations.

### 2.5. `$compile` Dependency on `$templateRequest`

`compile-provider.ts:228-240` `$get` array gains `'$templateRequest'`:

```
$get = [
  '$injector', '$interpolate', '$exceptionHandler', '$templateRequest',
  ($injector, $interpolate, $exceptionHandler, $templateRequest) => createCompile({
    getDirectivesByName: ...,
    injector: $injector,
    interpolate: $interpolate,
    exceptionHandler: $exceptionHandler,
    templateRequest: $templateRequest,
  }),
] as const;
```

`CompileOptions` in `directive-types.ts:246-251` gains `templateRequest: TemplateRequestFn`. `createCompile(...)` closes over `templateRequest` and threads it into the `DeferredTemplateQueue` machinery in `compile.ts` (see §2.7).

### 2.6. `normalizeDirective` Validation Extension

Extend `compile-provider.ts:349-423` `normalizeDirective`. After the `normalizeTransclude` call at line 386 and before the priority assignment at line 388, add a `normalizeTemplate` block:

1. **`replace` validation:**
   - `ddo.replace === true` → throw `new ReplaceTrueNotSupportedError(name)`.
   - `ddo.replace === false` / `undefined` → accept (default).
   - Any other value → throw `new ReplaceTrueNotSupportedError(name)` with a generalized message (the spec rejects truthy replace regardless of shape).

2. **`template` and `templateUrl` mutual exclusion:**
   - If `ddo.template != null && ddo.templateUrl != null` → throw `new TemplateAndTemplateUrlCombinedError(name)`.

3. **`template` validation:**
   - `undefined` → leave normalized `template` field unset.
   - `typeof template === 'string'` and `template.length > 0` → set normalized `template` to `{ kind: 'inline-string', value: template }`.
   - `typeof template === 'string'` and `template.length === 0` → throw `new EmptyTemplateError(name)`.
   - `typeof template === 'function'` → set normalized `template` to `{ kind: 'inline-fn', value: template }`. Function-return validation is deferred to compile time (it's per-element).
   - Any other value → throw `new InvalidTemplateValueError(name, describeValue(template))`.

4. **`templateUrl` validation:**
   - `undefined` → leave normalized `templateUrl` field unset.
   - `typeof templateUrl === 'string'` and `templateUrl.length > 0` → set normalized `template` to `{ kind: 'url-string', value: templateUrl }`. (Stored under the SAME `template` field as inline templates; the `kind` discriminates.)
   - `typeof templateUrl === 'string'` and `templateUrl.length === 0` → throw `new EmptyTemplateUrlError(name)`.
   - `typeof templateUrl === 'function'` → set normalized to `{ kind: 'url-fn', value: templateUrl }`.
   - Any other value → throw `new InvalidTemplateUrlValueError(name, describeValue(templateUrl))`.

All throws are caught by the existing factory try/catch in `$$buildDirectiveArrayProvider` at `compile-provider.ts:207-215` and routed via `$exceptionHandler('$compile')`. The directive is dropped from the array; siblings continue. Matches every other spec-017/018 validation rejection.

### 2.7. Walker Extension — Inline Template Installation

Per the architecture investigation, `compileElementOrComment` (`compile.ts:152-300`) is extended with a template-installation block AFTER transclude capture (`:196-202`) and BEFORE the child snapshot (`:247-258`):

1. **Detect template-declaring directive in the sorted directive list.** Scan the matched directives for entries whose normalized `template` field is set. Record the first match. If a SECOND match exists, route `MultipleTemplateDirectivesError(first.name, second.name)` via `invokeExceptionHandler(handler, err, '$compile')` at LINK time (mirroring how `MultipleTranscludeDirectivesError` is handled). Clear the second's `template` field on the LOCAL directive entry; other behavior runs.

2. **Inline template install (`kind: 'inline-string' | 'inline-fn'`):**
   - For `kind: 'inline-fn'`: call the function with `(node, attrs)` inside a try/catch routing throws via `$exceptionHandler('$compile')`. If the return is not a string, route `TemplateFunctionReturnedNonStringError`. Both error paths leave the element empty and skip the rest of template processing (the directive's other behavior still runs).
   - Memoize the resolved template string on the directive's local entry so subsequent linker invocations reuse it (one function call per compile, even if `linker(scope1); linker(scope2)`).
   - Parse the template string into a `Node[]` via a private `parseTemplate(html): Node[]` helper that uses a `<template>` element and `innerHTML` (HTML5 fragment parsing — no manual wrapMap workarounds in this spec; cells/rows/tables are deferred until specific test coverage demands them).
   - Replace `node.childNodes` with the parsed nodes: `while (node.firstChild) node.removeChild(node.firstChild); for (const tplNode of parsedNodes) node.appendChild(tplNode);`.

3. **Walker continues against the post-template DOM.** The child snapshot at `:247-258` now walks the template's nodes. Child compile + link runs against the new subtree. The host directive's own `compile`/`pre`/`post` link functions see the post-template element.

4. **`$$ngBoundTransclude` (from spec 018) was already stashed BEFORE template installation** — so `<ng-transclude>` markers inside the template find the bound function via the parent-element walk and project the captured consumer content correctly. No extra wiring needed.

### 2.8. Walker Extension — Async `templateUrl` Install

The async path is the new complexity. The walker MUST return synchronously even though the template-install work is deferred. Approach:

1. **Detect `templateUrl` directive.** Same pre-pass scan as §2.7.

2. **Resolve the URL string (if function form).** Call the function with `(node, attrs)` inside a try/catch; route throws / non-string returns via `$exceptionHandler('$compile')`. If the URL can't be resolved, the element stays empty; the directive's other behavior runs without a template.

3. **Defer the install.** Push an entry onto a `DeferredTemplateQueue` that's threaded through the walker's closure from the top-level `$compile` entry. Each entry carries:
   - `element: Element` — the host
   - `url: string` — the resolved URL
   - `attrs: Attributes` — the populated attribute bag (same instance shared with the directive's link functions)
   - `pendingDirectives: Directive[]` — the matched directives on the host EXCEPT the template-declaring one (which is "consumed" by the template install)
   - `transcludeContext: { bound: BoundTranscludeFn | undefined; capturedMaster: ...; ... } | undefined` — passed through so the template's `<ng-transclude>` markers find the captured content after install
   - `outerScope: Scope` — captured at link time when the deferred entry is enqueued (see step 5)

4. **Return a per-element linker that, when invoked at link time, does NOT install the template.** Instead, it captures the OUTER `parentScope` (mirroring the spec-018 `buildTranscludeFn` capture seam) into the deferred entry and pushes the entry onto the queue. The rest of the parent linker (sibling directives' pre-/post-link, sibling-element linking) runs normally.

5. **Top-level `$compile` triggers the queue drain.** After the synchronous walk completes and the public `Linker` has been returned to the caller, the `$compile` entry calls `Promise.resolve().then(() => drainDeferredTemplateQueue())`. The `drainDeferredTemplateQueue` function iterates the queue, awaits each `$templateRequest(url)`, and on resolution:
   - Parses the template string via `parseTemplate(html)`.
   - Replaces the host element's children with the parsed nodes.
   - Recursively compiles the post-template subtree via the same `compileNodes` entry (which handles further nested `templateUrl` directives via the same queue mechanism).
   - Builds the per-element linker for the host's remaining pending directives (the ones that weren't the template-declaring directive).
   - Invokes the per-element linker with the captured `outerScope`. The directive's `compile` runs on the post-template element; `pre-link` and `post-link` run in spec-017 order.

6. **Errors during the deferred drain** route via `$exceptionHandler('$compile')`. The element stays empty; sibling subtrees and other entries in the queue continue to resolve independently.

7. **Concurrent drain of multiple entries** — the queue is iterated in parallel via `Promise.all(entries.map(processEntry))` rather than sequential `await`s. Each entry's promise resolves independently; one slow fetch doesn't block another (FS §2.11 acceptance).

8. **Template + transclude integration via `templateUrl`** — `$$ngBoundTransclude` is stashed at the SYNCHRONOUS walk pass (immediately after capture, before the deferred entry is queued). When the template installs later, any `<ng-transclude>` markers inside it find the stash by walking `parentElement` to the host element — which still has `$$ngBoundTransclude` set. FS §2.9 acceptance #6 lands naturally.

### 2.9. `parseTemplate(html: string): Node[]` Helper

Pure function in `src/compiler/template-parse.ts`:

1. Create a `<template>` element via `document.createElement('template')`.
2. Set `templateEl.innerHTML = html` — HTML5 fragment parsing handles most cases correctly.
3. Return `Array.from(templateEl.content.childNodes)`.

The browser/jsdom HTML5 parser handles malformed HTML gracefully (mismatched tags, unclosed tags) by producing best-effort node trees. We do NOT throw on parse errors — AngularJS doesn't either. Authors who want stricter parsing can run their own validation upstream.

Special-case fragment handling for `<tr>`, `<td>`, `<th>`, `<tbody>`, `<col>` (which require a `<table>` ancestor in HTML5 parsing) is DEFERRED to a future spec — out of scope for the AngularJS-parity surface this spec ships, and unblocked by the `<template>` element which handles most cases correctly per the HTML5 spec.

### 2.10. Error Surface (`compile-error.ts`)

Ten new error classes following the existing pattern at `compile-error.ts:29-80` (extends `Error`, `readonly name`, single-string constructor, deterministic message):

| Class | Thrown at | Routed by |
| --- | --- | --- |
| `InvalidTemplateValueError(name, description)` | `normalizeDirective` | Factory try/catch at `compile-provider.ts:207-215` → `$exceptionHandler('$compile')` |
| `InvalidTemplateUrlValueError(name, description)` | `normalizeDirective` | Same |
| `EmptyTemplateError(name)` | `normalizeDirective` | Same |
| `EmptyTemplateUrlError(name)` | `normalizeDirective` | Same |
| `TemplateAndTemplateUrlCombinedError(name)` | `normalizeDirective` | Same |
| `ReplaceTrueNotSupportedError(name)` | `normalizeDirective` | Same |
| `TemplateFunctionReturnedNonStringError(name, description)` | Inline template install (compile.ts) | Direct `invokeExceptionHandler(handler, err, '$compile')` at the call site |
| `TemplateUrlFunctionReturnedNonStringError(name, description)` | Async template install (compile.ts) | Same |
| `MultipleTemplateDirectivesError(firstName, secondName)` | Per-element walker pre-pass | Same |
| `TemplateFetchFailedError(url, statusOrReason)` | `createTemplateRequest` fetcher | Routed by the caller (compile.ts) when the deferred-install promise rejects |

All thrown via the existing `invokeExceptionHandler(handler, err, '$compile')` helper from `src/exception-handler/exception-handler.ts`. **No new entry to `EXCEPTION_HANDLER_CAUSES`** — the `'$compile'` token added in spec 017 already covers this surface, exactly as FS §2.12 requires.

The spec-014 recursion guard in `invokeExceptionHandler` already handles the "custom `$exceptionHandler` that itself throws" case (FS §2.12 acceptance #8) — template loading inherits the contract for free.

### 2.11. Documentation Updates

- **`src/template/README.md`** — new file mirroring `src/sanitize/README.md` and `src/filter/README.md`. Sections: "When to use `template` vs `templateUrl`"; "Function-form templates"; "`$templateCache` — seeding and inspection"; "`$templateRequest` — async fetch + dedup + cache integration"; "Wrapper pattern: `transclude: true` + `template` + `<ng-transclude>`"; "Async compile semantics — synchronous linker + microtask install"; "Forward-pointers (`replace: true` deferred permanently; `templateNamespace` deferred; `<script type=\"text/ng-template\">` lands with built-in directives; `*-start`/`*-end` lands with structural directives; `$http` integration possible via decorator)".
- **`src/compiler/README.md`** — add a short "Template Loading" subsection in the existing structure that forward-points to `src/template/README.md` for full docs.
- **`CLAUDE.md` updates** per FS §2.15:
  - "Modules" table — new row for `./template` with `$templateCache`, `$templateRequest`, `createTemplateCache`, `createTemplateRequest`, ten new error classes, and the public types (`TemplateCacheService`, `TemplateRequestFn`, `TemplateFn`, `TemplateUrlFn`).
  - "Modules" table — amend the `./compiler` row to mention `template`/`templateUrl` DDO support.
  - "Non-obvious invariants" — six new bullets covering: template install slots AFTER transclude capture + BEFORE per-directive compile loop; sync `Linker` preserved, async resolved via per-`$compile`-call deferred queue; `$templateRequest` deduplicates concurrent fetches via `inFlight` map; `replace: true` deliberately deferred permanently (deprecated upstream); function-form templates called exactly once per compile; reuse `'$compile'` cause for every error site.
  - "Where to look when…" — three new rows: template install pipeline → `src/compiler/compile.ts` (post-capture block); async deferred drain → `src/compiler/compile.ts` `drainDeferredTemplateQueue`; `$templateRequest` dedup logic → `src/template/template-request.ts`.
- **TSDoc on every new public export** — `TemplateCacheService`, `TemplateRequestFn`, `TemplateFn`, `TemplateUrlFn`, `createTemplateCache`, `createTemplateRequest`, ten new error classes. The `template` DDO TSDoc carries the FS §2.1 worked example (consumer markup → template install → linked output round-trip). The `templateUrl` DDO TSDoc shows the `$templateCache` seeding pattern + the async sync-linker contract.

### 2.12. Public API Surface — Barrel Updates

`src/template/index.ts` (new):

- `createTemplateCache`, `createTemplateRequest` — factory exports.
- Default `templateCache`, `templateRequest` instances for ESM-first standalone usage (tests/SSR without DI).
- Types: `TemplateCacheService`, `TemplateRequestFn`, `TemplateCacheInfo`, `TemplateFetcher`.

`src/compiler/index.ts`:

- New exports: `TemplateFn`, `TemplateUrlFn` (the DDO function-form types), `NormalizedTemplate` (internal — re-exported for future structural-directives specs).
- New error classes: all ten listed in §2.10.

`src/index.ts` (root barrel):

- Re-export everything from `./template` (mirrors the existing compiler / filter / sce / sanitize / interpolate / exception-handler re-export pattern).
- Re-export the new `TemplateFn`, `TemplateUrlFn`, and ten error classes from `./compiler`.

---

## 3. Impact and Risk Analysis

### System Dependencies

**Modules touched:**

- `src/template/` — new module (4 new files + tests).
- `src/compiler/` — modifies `directive-types.ts`, `compile-error.ts`, `compile-provider.ts`, `compile.ts`, `index.ts`. New `template-parse.ts` helper. New test files.
- `src/core/ng-module.ts` — registers `$templateCache` and `$templateRequest` factories; extends `ModuleRegistry` type.
- `src/index.ts` — re-exports new public types + error classes.
- Build/config: `tsconfig.json`, `vitest.config.ts`, `rollup.config.mjs`, `package.json` (exports map) — all gain `@template` / `./template` entries.

**Modules unchanged:**

- `Scope`, `parser`, `injector`, `module`, `interpolate`, `sce`, `sanitize`, `exception-handler`, `filter` — no source changes.
- `EXCEPTION_HANDLER_CAUSES` tuple — unchanged. FS §2.12 explicit constraint.
- Existing test suites for specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018 — pass unchanged.

**Public-API surface additions (changelog-worthy):**

- New types: `TemplateCacheService`, `TemplateRequestFn`, `TemplateFn`, `TemplateUrlFn`, `NormalizedTemplate`, `TemplateFetcher`.
- New error classes (10): listed in §2.10.
- New services: `$templateCache`, `$templateRequest` on `ngModule`.
- Widened `DirectiveDefinition` accepts `template`, `templateUrl`, `replace`.
- New `./template` subpath in `package.json` exports.

**Run-phase dependency graph:**

- `$compile` and `$compileProvider` gain `$templateRequest` as a new run-phase dep.
- `$templateRequest` depends on `$templateCache`.
- No circular deps — `$templateCache` is a leaf service.

### Potential Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `<template>` element parsing has subtle differences from `innerHTML` on a `<div>` (e.g., `<tr>` requires `<table>` parent, `<option>` requires `<select>`) — some real-world templates may not parse correctly | Med | Med | `<template>` is the HTML5-spec-compliant fragment parser and handles the vast majority of cases. Documented limitation: cells/rows/cols inside a template must be wrapped in their proper ancestors (`<table><tr>...</tr></table>` rather than bare `<tr>`). Future spec can add the AngularJS `wrapMap` workaround when test coverage demands it. |
| Async deferred drain runs in microtask — tests may need to `await Promise.resolve()` (or use Vitest's `vi.runAllTimersAsync`) to observe post-template DOM | Med | Low | Documented test pattern: `await Promise.resolve()` (or two — for the cache-hit + chained `.then`) flushes the microtask queue. `vi.useFakeTimers` is available if needed for timing-sensitive tests. The `template-url.test.ts` file establishes the pattern; downstream specs reuse it. |
| `$templateRequest` rejection on non-2xx status — apps may expect `fetch`-like behavior where 4xx/5xx resolve with the body | Low | Med | The FS §2.6 acceptance is explicit: non-2xx HTTP rejects the promise. `ignoreRequestError: true` is the documented opt-out for directives that want a fallback. Documented in `src/template/README.md`. |
| Multiple `templateUrl` directives in the same subtree could create complex resolution ordering | Med | Med | Resolution is parallel via `Promise.all` — each fetch independently resolves and triggers its own install. Within a single host element, only ONE template directive is allowed (`MultipleTemplateDirectivesError`). Tests cover sibling templates resolving in arbitrary order. |
| `parseTemplate` runs in jsdom (test env) and produces slightly different output than browser DOM in edge cases (e.g., implicit `<tbody>` insertion) | Low | Low | jsdom's HTML5 parser is spec-compliant for the common cases. Edge cases (table structure, namespaced elements) are explicitly out of scope per FS §3 Out-of-Scope. The deferred specs (`templateNamespace`) will revisit. |
| Function-form template called per-element AND per-link could thrash perf for large repeat-style usage | Low | Med | Memoized per compile invocation — function called ONCE per host element, regardless of how many times the linker is invoked. FS §2.2 acceptance #3 + §2.4 acceptance #3 lock this. |
| `$templateCache` is per-injector — apps that re-bootstrap (test isolation) may unexpectedly re-fetch templates | Low | Low | Documented in `src/template/README.md` and `CLAUDE.md` invariants. Tests that share templates across `createInjector` calls must seed the cache via `$templateCache.put` in the test setup. |
| Deferred drain interacts with `$rootScope.$destroy()` — if the host is destroyed before the template resolves, the install would target a detached element | Med | Med | The drain checks `(hostElement as NgManagedElement).$$ngScope?.$$destroyed` (or the parent scope) before installing. If destroyed, the entry is silently dropped; the captured transclusion fragments (if any) are released to GC via the cleanup queue. Tested in `template-url.test.ts`. |
| `fetch` not available in older test environments | Low | Low | jsdom supports `fetch` (via undici) since v22. Vitest config already targets modern Node. The default `fetcher` checks for `globalThis.fetch` and throws a descriptive error if missing — apps with non-standard environments can inject a custom fetcher via the `createTemplateRequest({ fetcher })` factory. |
| `replace: true` deprecation might surprise users porting AngularJS apps | Low | Med | Clear error message at registration. README documents the migration path: drop `replace: true`; the host element wraps the template content. Most AngularJS apps that used `replace: true` did so for `<my-component>` → `<div class="component">…` shape changes, which are not behavior-breaking when the host element is preserved. |
| `templateUrl` + `transclude: true` ordering — capture must run synchronously BEFORE the fetch starts (so the consumer's children aren't reparented or destroyed mid-fetch) | Med | High | The capture seam at `compile.ts:198` runs at compile time, BEFORE the deferred entry is enqueued. The captured fragment is owned by the `$transclude` closure stashed at link time. The deferred entry doesn't touch capture state; it only installs the template. Tested explicitly in `template-transclude.test.ts`. |
| Spec-018's `MultipleTranscludeDirectivesError` pre-pass and Spec-019's `MultipleTemplateDirectivesError` pre-pass interact when BOTH error classes fire on the same element (e.g., two directives that BOTH declare transclude AND template) | Low | Low | The two checks are independent — same matched-directive list, two separate scans. Both errors route. The order of routing is deterministic (transclude first, then template) based on the pre-pass order in `compileElementOrComment`. Tested in `template-multi-directive.test.ts`. |

---

## 4. Testing Strategy

### Test Framework and Environment

- **Framework:** Vitest (already configured).
- **DOM:** jsdom (already configured at `vitest.config.ts:19`). jsdom supports `fetch` (undici) and `<template>` element parsing — both required for `templateUrl` and inline-template tests.
- **Async pattern:** `await Promise.resolve()` (or `await new Promise(r => setTimeout(r, 0))`) to flush microtasks/macrotasks. Vitest fake timers (`vi.useFakeTimers` + `vi.runAllTimersAsync`) available for timing-sensitive tests but not needed by default.
- **Coverage:** 90%+ on `src/template/` AND existing `src/compiler/` coverage maintained.
- **Reference:** Test vectors ported from `angular/angular.js/test/ng/compileSpec.js` `template` / `templateUrl` describe blocks where applicable.

### Test Organization

One test file per concern (table in §2.1). Test fixture pattern for inline templates:

```ts
const module = createModule('test', ['ng']);
module.config(['$compileProvider', ($cp) => {
  $cp.directive('myCard', () => ({
    template: '<div class="card"><h2>{{title}}</h2></div>',
    scope: true,
  }));
}]);
const injector = createInjector(['test']);
const $compile = injector.get('$compile');
const scope = injector.get('$rootScope').$new() ?? Scope.create();

const node = document.createElement('my-card');
$compile(node)(scope);
scope.title = 'Hi';
scope.$digest();

expect(node.querySelector('h2').textContent).toBe('Hi');
```

For `templateUrl`:

```ts
const module = createModule('test', ['ng']);
module.config(['$compileProvider', '$templateCache', ($cp, $templateCache) => {
  $templateCache.put('/tpl/card.html', '<div class="card"><h2>{{title}}</h2></div>');
  $cp.directive('myCard', () => ({ templateUrl: '/tpl/card.html', scope: true }));
}]);
// ... compile + link as above
await Promise.resolve(); // flush the microtask queue
scope.title = 'Hi';
scope.$digest();
expect(node.querySelector('h2').textContent).toBe('Hi');
```

### Coverage by Concern

- **`src/template/__tests__/template-cache.test.ts`** — `put`/`get`/`remove`/`removeAll`/`info`; chainable `put` return; missing-key undefined return; singleton instance per injector; programmatic seeding from `config()` blocks.
- **`src/template/__tests__/template-request.test.ts`** — cache hit (no fetch), cache miss (fetch + populate), concurrent dedup (two calls → one fetch), non-2xx rejection, network rejection, `ignoreRequestError: true` resolves with `undefined`, mock fetcher injection, error message includes URL.
- **`src/compiler/__tests__/template-inline.test.ts`** — string template install + post-template DOM; function-form invoked once per compile; multi-root templates; empty string rejection; non-string rejection; function-return-non-string at compile; function throw routing; template install BEFORE child compile (child directives in template register); multi-link reuses computed template.
- **`src/compiler/__tests__/template-url.test.ts`** — string `templateUrl` async install; function-form; cache integration (seed → no fetch); deferred subtree linking (linker returns sync, child link runs after fetch resolves); fetch-failure routing; subsequent compile reuses cache; sibling subtrees resolve independently; host-destroyed-before-resolve silently drops the install.
- **`src/compiler/__tests__/template-transclude.test.ts`** — wrapper pattern with `transclude: true` + `template`; with `templateUrl`; multi-slot + template; outer-scope binding preserved.
- **`src/compiler/__tests__/template-multi-directive.test.ts`** — `MultipleTemplateDirectivesError` routing; first wins; second's other behavior runs; interaction with `MultipleTranscludeDirectivesError`.
- **`src/compiler/__tests__/template-replace.test.ts`** — `replace: true` rejection; `replace: false` accepted; non-boolean rejection.
- **`src/compiler/__tests__/template-errors.test.ts`** — consolidated tests for all 10 error classes; `EXCEPTION_HANDLER_CAUSES.length === 10` regression; `'$compile' satisfies ExceptionHandlerCause` type check; handler-degradation path preserved.

### Cross-Spec Regression

- All existing tests for specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018 continue to pass without modification.
- `cross-spec-smoke.test.ts` extended with `injector.has('$templateCache') === true`, `injector.has('$templateRequest') === true`, and an end-to-end template-loading smoke (register `template: '<p>{{x}}</p>'` directive; compile; assert post-link DOM).
- `EXCEPTION_HANDLER_CAUSES` regression: length stays at 10; no new token.

### Special Considerations

- **No real browser tests** — jsdom is sufficient. `<template>` parsing + `fetch` both work in jsdom.
- **No performance benchmarks** — FS §3 Out-of-Scope (clarity over performance).
- **Async test discipline** — every test that compiles a `templateUrl` directive `await`s `Promise.resolve()` (or two — once for the cache write, once for the install promise chain). The pattern is documented in `src/template/README.md` and the first template-url test file.
- **TypeScript type-level tests** — instantiate string + function `template` and `templateUrl` to lock the widened `DirectiveDefinition` contract. Mirror the spec-018 type-widening regression block.
- **Mock `fetch`** — `createTemplateRequest({ fetcher: vi.fn() })` is the canonical way to mock fetches in tests. Avoid touching `globalThis.fetch` directly (would leak between tests).
