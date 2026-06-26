<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: HTTP & Networking (`$http`)

- **Functional Specification:** `context/spec/038-http-and-networking/functional-spec.md`
- **Status:** Draft
- **Author(s):** AWOS tech workflow

---

## 1. High-Level Technical Approach

Add a new `src/http/` module exporting the `$http` service + `$HttpProvider` (config-phase `defaults` + `interceptors`), plus a small companion `src/cache/` module exporting `$cacheFactory`. They **compose existing machinery**: `$http` returns `$q` promises (so digest integration is FREE — resolving the deferred schedules a digest via `$q`'s `$rootScope.$evalAsync` seam, no `$apply` needed), the request transport is native `fetch` behind an injectable `$httpBackend` seam (the `$templateRequest` `TemplateFetcher` precedent), JSONP is a separate `<script>`-tag transport gated through `$sce.getTrustedResourceUrl`, and XSRF same-origin gating reuses the existing `isSameOrigin` from `@sce`.

No change to `EXCEPTION_HANDLER_CAUSES` (stays 13): `$http` failures surface as **promise rejections** (FS §2.7), not via `$exceptionHandler` — matching AngularJS. Everything lives behind the new `@http` / `@cache` subpaths (the `./sce` / `./async` packaging precedent); `$http`, `$httpBackend`, `$cacheFactory` register on `ngModule`.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 New modules

| File | Responsibility |
| --- | --- |
| `src/cache/cache-factory.ts` | `createCacheFactory()` → `$cacheFactory(id, options?)` producing named Map-backed caches (`put`/`get`/`remove`/`removeAll`/`removeAll`/`info`/`destroy`), mirroring `$templateCache` |
| `src/cache/cache-types.ts` | `CacheFactory`, `Cache<T>`, `CacheInfo` types |
| `src/cache/index.ts` | Barrel |
| `src/http/http.ts` | `createHttp(deps)` — the `$http` callable + the seven method shortcuts; the request pipeline (config merge → interceptors → transforms → backend → response bundle) |
| `src/http/http-provider.ts` | `$HttpProvider` — public `defaults` + `interceptors` fields (config-phase), `$get` |
| `src/http/http-backend.ts` | `createHttpBackend()` — the fetch+`AbortController` transport AND the `<script>`-tag JSONP transport |
| `src/http/http-params.ts` | Default param serializer (+ the jQuery-like variant) |
| `src/http/http-headers.ts` | Header merge (defaults/common/per-method/per-request) + raw-header parsing into a case-insensitive getter |
| `src/http/http-transforms.ts` | Default JSON request/response transforms |
| `src/http/http-xsrf.ts` | XSRF token read (injectable `$$cookieReader` seam over `document.cookie`) + same-origin gate via `isSameOrigin` |
| `src/http/http-types.ts` | `HttpService`, `HttpConfig<T>`, `HttpResponse<T>`, `HttpHeadersGetter`, `Interceptor`, `HttpDefaults`, `HttpBackend`, … |
| `src/http/index.ts` | Barrel (`createHttp`, `$HttpProvider`, types) |
| `src/{http,cache}/__tests__/*.test.ts` | Unit + parity tests |

### 2.2 `$cacheFactory` (`src/cache/`)

`createCacheFactory()` returns `$cacheFactory(id, options?)`; each call builds a closure over a `Map<string, unknown>` and returns a cache with `put`/`get`/`remove`/`removeAll`/`destroy`/`info` (shape copied from `src/template/template-cache.ts`). A registry of created caches backs `$cacheFactory.info()` / `$cacheFactory.get(id)`. Per-injector isolation: the Map and registry live in the provider `$get` closure. Registered `.factory('$cacheFactory', [() => createCacheFactory()])` on `ngModule`. (`options.capacity`/LRU is OUT of scope — documented; AngularJS's LRU is rarely used. A plain unbounded Map is shipped.)

### 2.3 `$httpBackend` (`src/http/http-backend.ts`) — the transport seam

`$httpBackend(config, { signal }) → QPromise<RawResponse>` where `RawResponse = { status, statusText, data, headers }`. Two internal paths:

- **Standard (fetch):** builds a `fetch(url, { method, headers, body, credentials, signal })`; on settle, reads `status` / `statusText` / raw header string / body (as text, or per `responseType`); resolves a `$q` deferred with the `RawResponse` (does NOT reject on non-2xx — the status classification happens in `$http`, §2.4). A network error (fetch throws) rejects with a sentinel marking "request never reached server" (FS §2.7). `AbortController.abort()` (driven by §2.9) rejects with an abort sentinel.
- **JSONP (`<script>` tag):** appends a `<script>` whose URL carries a generated callback param; the global callback resolves the deferred; load-error rejects. The URL MUST already be trusted (§2.7 gating happens in `$http` before reaching the backend). Cleanup removes the script + callback on settle.

`$httpBackend` is the **mock seam** (a future `ngMock` overrides it via decorator); it is registered `.factory('$httpBackend', [() => createHttpBackend()])` and injected into `$http`. `fetch` is called on the global directly (the `defaultFetcher` precedent), wrapped so the backend stays unit-testable.

### 2.4 `$http` request pipeline (`src/http/http.ts`)

`$http<T>(config): QPromise<HttpResponse<T>>` plus shortcuts `get`/`delete`/`head`/`jsonp` (no body) and `post`/`put`/`patch` (body). Per request, in order:

1. **Merge config** over `defaults` (method-cased headers: `common` + per-method; `paramSerializer`; `transformRequest`/`transformResponse`; `xsrf*`; `withCredentials`).
2. **Run request transforms** (default JSON-serialize a structured body + set `Content-Type: application/json`; pass-through strings) — §2.6.
3. **Serialize `params`** into the query string via the configured `paramSerializer` — §2.5.
4. **XSRF**: if same-origin (via `isSameOrigin`) attach the cookie token as a header — §2.8.
5. **Interceptor request phase** (outward→inward) — §2.10.
6. **Cache check** (GET/JSONP only, if `cache`): hit → resolve from cache; in-flight → share; miss → continue — §2.9.
7. **Backend send** via `$httpBackend` with the `AbortSignal` — §2.3 / §2.9.
8. **Classify status**: 2xx (and per AngularJS, treat status 0 with a response specially) → success; non-2xx → failure. Build `HttpResponse<T> = { data, status, statusText, headers, config }` where `headers` is a case-insensitive getter (parsed lazily). Run **response transforms** (default JSON-parse) — §2.6.
9. **Interceptor response phase** (inner→outer; `responseError` may recover) — §2.10.
10. **Resolve/reject** the `$q` deferred → digest scheduled automatically. Remove from `pendingRequests` (§2.11) and settle the cache entry (§2.9).

### 2.5 Param serialization (`http-params.ts`)

Default serializer: a structured `params` object → `key=value&…` with `encodeURIComponent` (skipping `undefined`/`null`; arrays → repeated keys; objects/Dates → JSON or ISO per AngularJS's default rule). The jQuery-like variant (`paramSerializerJQLike`, bracket notation) ships as an alternate. The serializer is swappable application-wide (`defaults.paramSerializer`) and per request. No existing helper — built from scratch on native `encodeURIComponent`.

### 2.6 JSON transforms (`http-transforms.ts`)

Default `transformRequest`: if the body is a structured object/array (not a string/Blob/FormData/…), `JSON.stringify` it and set the JSON content-type; else pass through. Default `transformResponse`: if the response looks like JSON, `JSON.parse`; else pass through. Both are **arrays** of functions (AngularJS parity) so apps can prepend/append; per-request `transformRequest`/`transformResponse` override or extend `defaults`.

### 2.7 JSONP trusted-destination gating (FS §2.12)

`$http.jsonp(url, config)` (and `$http({ method: 'JSONP' })`) routes the URL through `$sce.getTrustedResourceUrl(url)` BEFORE the backend runs — via the lazy `$injector.has('$sce')` probe (the `ng-include` precedent). An untrusted URL throws synchronously from `getTrusted` (a plain `Error` with the `$sceDelegate.getTrusted: …` message) before any network/script activity. (`$sce` is always on `ngModule`, so the probe normally resolves; the lazy form covers stripped injectors.)

### 2.8 XSRF protection (`http-xsrf.ts`, FS §2.11)

Read the token from `document.cookie` (the `defaults.xsrfCookieName`, default `XSRF-TOKEN`) via an injectable `$$cookieReader` seam (testability; mirrors `TemplateFetcher`). Attach it as `defaults.xsrfHeaderName` (default `X-XSRF-TOKEN`) **only when `isSameOrigin(url, base)` is true** (reuse the exported `@sce` `isSameOrigin`). Names are config-phase settable via `defaults`.

### 2.9 Caching + in-flight dedup (FS §2.13)

Per request with `cache` (a `Cache` object, or `true` → the provider's default cache, only for GET/JSONP): hit → resolve immediately from the stored response; in-flight → share the outstanding promise (an `inFlight: Map<url, QPromise>` exactly like `$templateRequest`); miss → send, and on success `cache.put(url, response)`. Off by default. The default cache comes from `$cacheFactory('$http')` lazily.

### 2.10 Interceptor pipeline (`$HttpProvider.interceptors`, FS §2.10)

`interceptors` is a public array on the provider of factory **names** (resolved `$injector.get(name)`) or factory **functions** (resolved `$injector.invoke(fn)`) at `$get` time (the `$FilterProvider` resolve-at-`$get` precedent; `'$injector'` is injectable per the self-registration seam). Each resolved interceptor may expose `request` / `requestError` / `response` / `responseError`. The pipeline composes them as a `$q` chain: request handlers fold **outward→inward** before the backend; response handlers **inner→outer** after; a `responseError` that returns (not rejects) **recovers**. Async handlers (returning a `QPromise`) are awaited because they're `.then`-chained. A built-in interceptor implements the §2.6/§2.8 default behavior, or those run inline in the pipeline — implementer's choice, documented.

### 2.11 Pending-request tracking (FS §2.14)

`$http.pendingRequests: HttpConfig[]` — push the config on send, splice on settle. Purely observational (busy indicators / test quiescence).

### 2.12 Cancellation & timeout (FS §2.8)

`config.timeout` accepts a **number** (ms) or a **`QPromise`**. An `AbortController` is created per request; a numeric timeout arms `setTimeout(() => controller.abort(), ms)` (reuse the `$timeout`/global-timer seam, cleared on settle); a promise timeout does `timeoutPromise.then(() => controller.abort())`. Abort rejects the `$http` promise with a cancellation outcome and aborts the underlying `fetch` via its `signal`. A response that already settled ignores a later abort (the deferred is final — `$q` guarantees this).

### 2.13 `$HttpProvider` + registration (`src/core/ng-module.ts`)

`.provider('$http', ['$provide'?, $HttpProvider])` — public mutable `defaults` (headers/common + per-method, `paramSerializer`, `transformRequest`/`transformResponse`, `xsrfCookieName`/`xsrfHeaderName`, `withCredentials`) and `interceptors: []`, both mutated by config blocks (NOT `$$`-prefixed — AngularJS parity). `$get` declares deps `['$q', '$injector', '$httpBackend', '$cacheFactory', '$sce'?]`, freezes the config, resolves interceptors, and returns the `$http` callable. Also register `.factory('$httpBackend', …)` and `.factory('$cacheFactory', …)`. Widen the `ng` `ModuleRegistry` with `$http: HttpService`, `$httpBackend: HttpBackend`, `$cacheFactory: CacheFactory`.

### 2.14 Typing (FS §2.15)

`$http<T>(config): QPromise<HttpResponse<T>>`; `HttpResponse<T> = { data: T; status: number; statusText: string; headers: HttpHeadersGetter; config: HttpConfig }`; shortcuts generic over `T`. `HttpConfig` is a typed options object so misspelled options are flagged. `$cacheFactory` and the cache are generic over the stored value.

### 2.15 Packaging (mirror `./async`) — two subpaths

For BOTH `@http` and `@cache`, the six touchpoints: `tsconfig.json` paths, `vitest.config.ts` alias, `package.json` `exports`, `rollup.config.mjs` entry + dts alias, root barrel `src/index.ts`, and the module `index.ts`. Registration lines live in `src/core/ng-module.ts`.

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `@async` (`$q` — return type + digest), `@sce` (`getTrustedResourceUrl` for JSONP, `isSameOrigin` for XSRF), `@di` (provider registration, `$injector` at `$get` for interceptors, `ModuleRegistry` typing), `@core` (`$rootScope` indirectly via `$q`). No `@compiler` dependency — `$http` is DOM-free except the JSONP `<script>` transport (which touches `document`). The `@cache` module is dependency-free.
- **Potential Risks & Mitigations:**
  - **`fetch` has no upload/download progress.** Accepted deviation (the chosen transport). Documented; if progress is later required, a `$httpBackend` swap to XHR is the seam — no `$http` change.
  - **JSONP security.** The `<script>` transport is inherently risky; mitigated by the hard `$sce.getTrustedResourceUrl` gate BEFORE any script injection (FS §2.12 / §3) and callback-name isolation + cleanup. No opt-out.
  - **XSRF cross-origin leak.** Sending the token cross-origin would leak it; mitigated by the `isSameOrigin` gate (reused, already tested) and a test asserting no token on cross-origin.
  - **Digest storms / TTL.** Many concurrent resolutions each `$evalAsync`. Mitigated because `$q` coalesces continuation processing per settlement (spec 037), and `pendingRequests` splicing is O(1)-ish; a parity test asserts N concurrent responses settle within bounded digests. `$httpProvider.useApplyAsync` (response coalescing via `$rootScope.$applyAsync`, which exists) is **deferred** (documented) — not in this spec.
  - **Header-parsing / param-serialization correctness.** Built from scratch; mitigated by porting upstream `$http` param/header test vectors.
  - **`document.cookie` / `document` access in non-browser.** Mitigated by the injectable `$$cookieReader` seam and feature-detecting `document` for JSONP (throws a clear error if JSONP is used without a DOM).
  - **No `EXCEPTION_HANDLER_CAUSES` change** — failures are promise rejections; verify the tuple stays 13.

---

## 4. Testing Strategy

- **Unit (vitest, fake timers + a stubbed `$httpBackend`/`fetch`):**
  - Methods: each shortcut + general form issue the right method/url/body; body vs bodyless.
  - Config merge + defaults: common/per-method headers, per-request override, `withCredentials`, `responseType`.
  - Param serialization: default + array/object/Date rules + custom serializer; correct escaping.
  - Transforms: default JSON request/response; string pass-through; non-JSON pass-through; custom transform arrays.
  - Outcomes: 2xx success bundle; non-2xx failure bundle (with error body); network failure distinguishable.
  - Digest integration: a stubbed-backend resolution refreshes a `$watch`-bound value with no manual `$apply`.
  - Cancellation/timeout: numeric timeout aborts + rejects; promise timeout aborts; already-settled ignores abort.
  - Interceptors: request/response/`responseError` (recovery); multi-interceptor ordering; async interceptor awaited; name-string and factory-fn resolution.
  - XSRF: same-origin attaches the cookie token; cross-origin does not; configurable names.
  - JSONP: trusted URL proceeds; untrusted throws before network; callback cleanup.
  - Caching: GET cache hit serves without backend; off by default; two concurrent identical GETs share one call.
  - `pendingRequests`: present in-flight, removed on settle.
  - `$cacheFactory`: `put`/`get`/`remove`/`removeAll`/`destroy`/`info`; named-cache isolation.
- **Type-level:** `$http<User>(...).then(r => r.data)` infers `User`; `injector.get('$http')` narrows `HttpService`; mistyped `HttpConfig` options flagged.
- **Parity tests:** port relevant upstream `$http` / `$httpProvider` / param-serializer / header-parser scenarios; mark §3 deviations (no `.success`/`.error`; hard JSONP gate) as intentional.
- **Coverage:** new `http` + `cache` modules held to the 90% per-module line threshold (global-only today; add to the architecture's enumerated set).
- **Gates:** `lint` / `format:check` / `typecheck` / `test` / `build` all green; full prior-spec suite green; `EXCEPTION_HANDLER_CAUSES.length === 13` unchanged; `./http` + `./cache` exports resolve from both `dist` roots (ESM + CJS + `.d.ts`).
