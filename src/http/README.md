# `@http` — networking: `$http` + `$httpBackend` + `$HttpProvider`

`$http` is the framework's networking service: a callable that issues an HTTP
request and returns a `$q` promise carrying a typed response. Because it
returns a `$q` promise, **digest integration is free** — resolving the promise
schedules a digest via the `$q` → `$rootScope.$evalAsync` seam, so content
bound to the response data refreshes on its own. You never call `$apply` after
an `$http` call.

The module ships three pieces, all registered on `ngModule`:

- **`$http`** — the request pipeline (general form + `get` / `delete` / `head`
  / `post` / `put` / `patch` / `jsonp` shortcuts), built by the pure
  `createHttp` factory.
- **`$httpBackend`** — the transport seam (native `fetch` + a `<script>`-tag
  JSONP path), built by the pure `createHttpBackend` factory. This is the
  single point a future `ngMock` decorates and the seam tests stub.
- **`$HttpProvider`** — the config-phase configurator holding the mutable
  `defaults` and `interceptors`.

```ts
const injector = createInjector(['ng']);
const $http = injector.get<HttpService>('$http');

$http.get<User>('/api/me').then((res) => res.data); // a digest runs on its own
```

## The digest-integration contract

`$http` builds its result on a `$q` deferred. When the backend settles, `$http`
resolves (2xx) or rejects (non-2xx / network) that deferred, which schedules a
digest through `$q`'s injected `scheduleDigest` seam (`ngModule` binds it to
`$rootScope.$evalAsync`). That digest both drains the `.then` continuations AND
re-evaluates watchers — so a `$watch`-bound value the success callback sets
refreshes automatically, even though the work originated outside any digest.

```ts
$rootScope.$watch('user.name', (v) => {
  /* render v */
});

$http.get<User>('/api/me').then((res) => {
  $rootScope.user = res.data; // the watch fires on the scheduled digest — no $apply
});
```

## The response bundle

Both the success and failure follow-ups receive the same `HttpResponse<T>`
shape:

```ts
$http<User>({ method: 'GET', url: '/api/me' }).then(
  (res) => {
    res.data; // User (after response transforms)
    res.status; // 200
    res.statusText; // 'OK'
    res.headers('Content-Type'); // case-insensitive getter
    res.config; // the merged request description
  },
  (res) => {
    res.status; // a non-2xx server status, OR -1 for a network failure
  },
);
```

A 2xx status (plus status `0`, the file-protocol / opaque-response rule) is a
success; everything else rejects. A request that never reached the server (a
`fetch` throw) rejects with `status: -1`, distinguishable from any
server-reported status.

## The request pipeline (per request)

1. **JSONP trust gate** (JSONP only) — the URL is routed through
   `$sce.getTrustedResourceUrl` BEFORE anything else; an untrusted destination
   throws here, so no `<script>` is ever injected (see below).
2. **Header merge** — `defaults.headers.common` < the per-method bag (e.g.
   `defaults.headers.post`) < the per-request `config.headers`, layered
   later-wins with case-insensitive de-dup.
3. **Request transforms** — the default JSON-serializes a structured body and
   sets a JSON `Content-Type`; a string / `Blob` / `FormData` / `File` /
   `ArrayBuffer` / `URLSearchParams` / `Date` body passes through. A per-request
   `transformRequest` REPLACES the default.
4. **Param serialization** — `config.params` is serialized onto the URL by the
   configured serializer (default: sorted keys, repeated array keys, ISO dates,
   JSON for nested objects). Swappable via `defaults.paramSerializer` or
   per-request `config.paramSerializer`.
5. **XSRF** — the per-session token is read from a cookie and echoed back in a
   header, but ONLY for same-origin requests (see below).
6. **Cache check** (GET only, opt-in) — a hit serves a clone immediately; a
   concurrent identical GET shares the single outstanding request.
7. **Send** via `$httpBackend`, wired to an `AbortController` for
   cancellation / timeout.
8. **Response transforms** — the default `JSON.parse`s a JSON-looking body. A
   per-request `transformResponse` REPLACES the default.
9. **Classify** — 2xx (or 0) resolves, else rejects; a 2xx success is stored in
   the cache when caching is on.

A throwing transform REJECTS the promise — it is NOT routed through
`$exceptionHandler` (AngularJS parity).

## Interceptors

Register interceptor FACTORIES on `$HttpProvider.interceptors` — either a
factory NAME (resolved via `$injector.get`) or a factory FUNCTION (an injector
invokable, resolved via `$injector.invoke`). Both are resolved ONCE at `$get`
time.

```ts
createModule('app', ['ng']).config(['$httpProvider', (p) => {
  p.interceptors.push('authInterceptor'); // a registered factory name
  p.interceptors.push([
    '$q',
    ($q: QService): Interceptor => ({
      request(config) {
        config.headers = { ...config.headers, 'X-Trace': 'on' };
        return config;
      },
      responseError(rejection) {
        return $q.reject(rejection); // re-reject to keep failing
      },
    }),
  ]);
}]);
```

Each interceptor exposes any subset of `request` / `requestError` / `response`
/ `responseError`. The pipeline `.then`-chains them, so an async handler
(returning a `QPromise`) is awaited before the next stage. **Ordering** mirrors
AngularJS exactly:

- **Request phase runs OUTWARD→INWARD** — the LAST-registered interceptor's
  `request` runs FIRST.
- **Response phase runs INNER→OUTER** — the FIRST-registered interceptor's
  `response` runs LAST.

`requestError` / `responseError` ARE the rejection branch of `.then`: return a
value to RECOVER (a `responseError` returning a response turns a failure into a
success), or re-reject to keep failing.

## XSRF protection (same-origin gated)

The server leaves a per-session token in a cookie (default `XSRF-TOKEN`);
`$http` reads it fresh per request and echoes it back in a header (default
`X-XSRF-TOKEN`) — but ONLY when the request URL is SAME-ORIGIN. Sending the
token cross-origin would leak it, so the `isSameOrigin` gate (reused from
`@sce`) is the security-critical guard. The cookie read goes through the
injectable `$$cookieReader` seam (feature-detects `document`, so a non-browser
environment yields no token rather than throwing). The names are config-phase
settable via `defaults.xsrfCookieName` / `defaults.xsrfHeaderName`.

## JSONP — hard-gated, no opt-out

`$http.jsonp(url)` issues the legacy cross-origin `<script>`-tag action. The
URL is HARD-GATED through `$sce.getTrustedResourceUrl` BEFORE any `<script>` is
injected — an untrusted destination rejects the promise with NO network / DOM
activity. There is no opt-out; this reflects the project's security posture
(a §3 intentional deviation). Write the `JSON_CALLBACK` placeholder into the
URL where the generated callback name should be substituted (if absent, a
`callback=<name>` param is appended):

```ts
$http.jsonp<Feed>('https://api.example.com/feed?callback=JSON_CALLBACK').then((res) => res.data);
```

The `$sce` probe is lazy (`$injector.has('$sce')`) — `$sce` is always on
`ngModule`, so the gate is normally active; a stripped injector lacking `$sce`
passes JSONP URLs through (mirroring `ng-include`).

## Response caching + dedup (GET-only, opt-in)

Opt a GET into caching with `cache: true` (the lazily-created `$http` default
cache) or a `Cache` object from `$cacheFactory` (see `@cache`):

```ts
$http.get<User>('/api/me', { cache: true }); // first call hits the network
$http.get<User>('/api/me', { cache: true }); // served from cache, no network
```

A hit serves a CLONE, so a caller mutating the delivered bundle cannot corrupt
the stored entry. Two concurrent identical cacheable GETs share a single
outstanding request (the `inFlight` dedup). Caching applies to GET only — a
POST/PUT/etc. is never cached even with `cache` set.

## Observability + cancellation

- `$http.pendingRequests` — the live array of in-flight request configs
  (pushed on send, spliced on settle). Observational only (a busy indicator /
  test quiescence check).
- `config.timeout` — a number (ms) arms a timer that aborts the request; a
  `QPromise` aborts when it settles. Cancellation is driven by a per-request
  `AbortController` whose signal is wired into `fetch`.

## Configuring defaults

`$HttpProvider.defaults` is public and mutable from config blocks (AngularJS
parity — not `$$`-prefixed, because the app is meant to write it):

```ts
createModule('app', ['ng']).config(['$httpProvider', (p) => {
  p.defaults.headers.common['Authorization'] = 'Bearer token';
  p.defaults.paramSerializer = paramSerializerJQLike; // swap the serializer
}]);
```

## Intentional deviations (§3 — DELIBERATE, not parity gaps)

- **No `.success()` / `.error()` shorthands.** The result is a standard `$q`
  promise — use `.then` / `.catch` / `.finally`. The legacy AngularJS
  promise-specific callbacks are intentionally absent (the modern, type-safe
  shape).
- **JSONP is hard-gated through `$sce` with no opt-out** (above).

## Deferred (documented, NOT this spec)

- **`$httpProvider.useApplyAsync`** — batching response delivery through
  `$rootScope.$applyAsync` is not implemented; responses settle through the
  standard `$q` → `$evalAsync` path.
- **`$cacheFactory` LRU / `capacity`** — the response cache is unbounded (see
  `@cache`).
- **Upload / download progress** — `fetch` does not expose request-body upload
  progress, so progress notifications are out of scope.

## Forward-pointers

- **`@cache`** — the `$cacheFactory` store backing response caching.
- **`@async`** — `$q` is the promise toolkit `$http` returns; its README covers
  the digest-integration contract in depth.
- **`ngMock` `$httpBackend`** — a future testing module decorates the transport
  seam; today, stub `$httpBackend` (or inject a `fetchFn`) directly.
