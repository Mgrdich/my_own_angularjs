# `@template` — template loading: `$templateCache` + `$templateRequest`

Template loading is the AngularJS-canonical mechanism for letting a
directive declare its own DOM chrome rather than building it imperatively
inside a link function. Two DDO fields drive the surface — `template`
(inline string or function) and `templateUrl` (async string or function)
— and two services back them on `ngModule`: `$templateCache` (a
Map-backed key-value store) and `$templateRequest` (async fetch over
native `fetch`, with cache integration and in-flight deduplication).

The `@template` module ships the two services as ESM-first factories
(`createTemplateCache`, `createTemplateRequest`) and DI registrations on
`ngModule`. The DDO-side wiring (parsing, install, deferred drain) lives
in `@compiler` — see `src/compiler/README.md` for the registration
surface and `src/compiler/compile.ts` for the template-install pre-pass
and `drainDeferredTemplateQueue`.

## When to use `template` vs `templateUrl`

Reach for inline `template` when the template is small, static, and
co-located with the directive's logic — under roughly 20 lines of HTML.
The string is parsed eagerly at compile time; no extra network round
trip; tests don't need microtask flushing.

```ts
$compileProvider.directive('myBadge', () => ({
  restrict: 'E',
  template: '<span class="badge">{{label}}</span>',
  scope: true,
  link: (scope, _el, attrs) => {
    scope.label = attrs.label;
  },
}));
```

Reach for `templateUrl` when the template is larger, shared across
multiple directives, or authored by non-engineers in a separate `.html`
file. The first compile fetches via `$templateRequest`; subsequent
compiles for the same URL read from `$templateCache` with no network
call.

```ts
$compileProvider.directive('myCard', () => ({
  restrict: 'E',
  templateUrl: '/tpl/card.html',
  scope: true,
}));
```

Both forms preserve the host element — `<my-card></my-card>` becomes
`<my-card><div class="card">…</div></my-card>` (the template replaces
children; the host's tag, attributes, and listeners stay). The
AngularJS 1.x `replace: true` option is REJECTED at registration via
`ReplaceTrueNotSupportedError`; see Forward-pointers below.

## Function-form templates

Both `template` and `templateUrl` accept a function whose signature is
`(element: Element, attrs: Attributes) => string`. The function runs
exactly once at compile time per host element with the raw host element
and the populated `Attributes` instance, and its return value is
memoized — subsequent linker invocations against the compiled tree reuse
the resolved string. Useful when the template depends on attribute
values or runtime detection.

```ts
// Inline function-form: template depends on an attribute value.
$compileProvider.directive('myAlert', () => ({
  restrict: 'E',
  template: (_element, attrs) => `<div class="alert alert-${attrs.kind ?? 'info'}">…</div>`,
}));

// Async function-form: URL computed from an attribute value.
$compileProvider.directive('myCard', () => ({
  restrict: 'E',
  templateUrl: (_element, attrs) => `/tpl/${attrs.kind ?? 'default'}.html`,
}));
```

A function-form template that throws or returns a non-string value
routes via `$exceptionHandler('$compile')` —
`TemplateFunctionReturnedNonStringError` / `TemplateUrlFunctionReturnedNonStringError`
— and leaves the host element empty. The directive's other behavior
(link, compile) still runs; siblings continue normally.

## `$templateCache` — seeding and inspection

The service exposes five methods: `put` / `get` / `remove` / `removeAll`
/ `info`. `put(key, content)` stores the content and returns it for
chaining; `get(key)` returns `string | undefined`; `info()` returns
`{ id: 'templates', size: number }` for AngularJS-canonical introspection.
Each injector gets its own isolated cache instance (the DI factory
invokes `createTemplateCache()` fresh per injector), so test isolation
does not require `removeAll()` between cases — a fresh
`createInjector(['ng'])` starts empty.

Programmatic seeding pattern — pre-warm the cache from a `run()` block
to avoid the first-compile network round trip:

```ts
const app = createModule('app', ['ng']).run([
  '$templateCache',
  ($templateCache) => {
    $templateCache.put('/tpl/card.html', '<div class="card"><h2>{{title}}</h2></div>');
    $templateCache.put('/tpl/badge.html', '<span class="badge">{{label}}</span>');
  },
]);
```

Inspection — sanity-check how many templates have been cached over the
lifetime of the app:

```ts
const $templateCache = injector.get('$templateCache');
$templateCache.info();
// → { id: 'templates', size: 2 }
```

Config-phase access — `$templateCache` is registered through a
`$TemplateCacheProvider` DI shim, so apps can resolve the provider from a
`config()` block with `module.config(['$templateCacheProvider', (p) => …])`.
The shim carries no config-phase API in this spec (e.g. no eviction
policy, no preload setter); the block is a forward-compat seam — future
specs may attach setters without changing the registration shape. The
run-phase seeding pattern above is still the canonical way to
pre-populate the cache today.

## `$templateRequest` — async fetch, deduplication, cache integration

Signature: `(url: string, ignoreRequestError?: boolean) => Promise<string | undefined>`.

Per-call lifecycle:

1. Read `$templateCache.get(url)` — if set, resolve on the next
   microtask with the cached content. No network call.
2. Otherwise check the internal `inFlight: Map<string, Promise<string>>`
   — if a request for the same URL is already pending, return that
   promise so concurrent callers share the chain (and the cache-write
   side effect on resolution).
3. Otherwise call the fetcher (`globalThis.fetch` by default), write
   the response body to `$templateCache` on success, clear the in-flight
   entry, and resolve with the body. On failure, clear the in-flight
   entry and re-throw so the next caller can retry.
4. If `ignoreRequestError === true`, attach `.catch(() => undefined)` so
   the returned promise resolves with `undefined` on error rather than
   rejecting — directives that want to render a fallback skip the error
   path entirely.

The in-flight deduplication ensures only ONE network request is
outstanding per URL while a fetch is pending, even if dozens of
directives are compiled concurrently against templates that all live at
that URL.

```ts
const $templateRequest = injector.get('$templateRequest');

// First call hits the network; the response is written to the cache.
const html = await $templateRequest('/tpl/card.html');

// Subsequent calls hit the cache (no network).
const cached = await $templateRequest('/tpl/card.html');

// Fall back to undefined on error (don't reject):
const maybe = await $templateRequest('/maybe-missing.html', true);
if (maybe === undefined) {
  // …render a fallback…
}
```

Config-phase access — `$templateRequest` is registered through a
`$TemplateRequestProvider` DI shim, so apps can resolve the provider from
a `config()` block with `module.config(['$templateRequestProvider', (p) => …])`.
As with `$templateCacheProvider`, the shim carries no config-phase API
in this spec; the most likely future addition is a `fetcher(fn?)` setter
that surfaces the existing `createTemplateRequest({ fetcher })` seam
through DI. Adding such setters is purely additive.

Non-2xx HTTP statuses become a rejected promise carrying a
`TemplateFetchFailedError` whose message includes the URL and the
status. Network failures (DNS, CORS, offline) propagate the underlying
error. The compiler's deferred-template-queue routes both via
`$exceptionHandler('$compile')` — the host element stays empty; sibling
subtrees and other deferred entries continue independently.

## Wrapper pattern: `transclude: true` + `template` + `<ng-transclude>`

The canonical AngularJS pattern for writing wrapper directives. The
consumer's children are captured at compile time (spec 018), the
template overwrites the host's content, and an `<ng-transclude>` marker
inside the template projects the captured content back into the slot of
the directive's choosing. The transcluded scope binds against the OUTER
scope per spec 018 §2.5 — `{{outerCtrl.x}}` resolves against the
consumer's scope, not the directive's `scope: true` child.

```ts
// Directive (chrome lives in the template; consumer fills the slot).
$compileProvider.directive('myCard', () => ({
  restrict: 'E',
  scope: true,
  transclude: true,
  template: `
    <div class="card">
      <h2>{{title}}</h2>
      <div ng-transclude></div>
    </div>
  `,
  link: (scope, _el, attrs) => {
    scope.title = attrs.title;
  },
}));

// Consumer markup.
// <my-card title="Account settings">
//   <p>{{vm.description}}</p>
// </my-card>
//
// After compile + link:
// <my-card title="Account settings">
//   <div class="card">
//     <h2>Account settings</h2>      ← directive's child scope
//     <div ng-transclude>
//       <p>{{vm.description}}</p>    ← bound to OUTER scope (vm)
//     </div>
//   </div>
// </my-card>
```

The exact same pattern works with `templateUrl` — capture is
synchronous at compile time (BEFORE the deferred entry is enqueued), so
the consumer's children are safely stashed by the time the template
fetch resolves. The `<ng-transclude>` marker inside the fetched
template walks up to the host element to find the captured content
once installed.

```ts
$compileProvider.directive('myCard', () => ({
  restrict: 'E',
  scope: true,
  transclude: true,
  templateUrl: '/tpl/card.html',
}));

// /tpl/card.html (seeded via $templateCache or fetched on first compile):
//   <div class="card">
//     <h2>{{title}}</h2>
//     <div ng-transclude></div>
//   </div>
```

Multi-slot transclusion works identically — declare slots on the DDO
and use named `<ng-transclude="slotName">` markers inside the template:

```ts
$compileProvider.directive('myCard', () => ({
  transclude: { titleSlot: 'card-title', bodySlot: 'card-body' },
  template: `
    <div class="card">
      <h1 class="title"><div ng-transclude="titleSlot"></div></h1>
      <div class="body"><div ng-transclude="bodySlot"></div></div>
    </div>
  `,
}));
```

See `src/compiler/README.md` "Transclusion" for the full multi-slot
surface including selector rules, optional `?` prefixes, and fallback
content.

## Async compile semantics — synchronous linker + microtask install

`$compile(element)(scope)` returns a synchronous linker even when
`templateUrl` directives exist in the compiled subtree. The public
`Linker` signature is unchanged from spec 017 / 018:
`(scope: Scope) => Element | NodeList | Comment`. Spec-017 callers
remain assignable without modification.

For elements gated by `templateUrl`, the linker returns immediately
with the host node; the host's children are EMPTY at that moment. The
top-level `$compile` schedules a `Promise.resolve().then(drain)`
microtask after the synchronous walker completes. When the drain runs,
each deferred entry awaits `$templateRequest(url)`, installs the
resolved template via the same node-replacement helper used by inline
`template`, recursively compiles the post-template subtree, and links
it against the captured outer scope.

Tests that compile a `templateUrl` directive MUST flush the microtask
queue to observe the post-install DOM. Two `await Promise.resolve()`
calls suffice for a cache-hit path; a third defends against
chain-length drift across cache-hit and mock-fetcher paths.

```ts
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

cache.put('/tpl/card.html', '<div class="card">…</div>');
const linker = $compile(host);
const result = linker(scope); // returns synchronously

expect(result).toBe(host);
expect(host.firstChild).toBeNull(); // empty immediately

await flushMicrotasks();

expect(host.firstElementChild?.className).toBe('card'); // now installed
```

Multiple `templateUrl` directives in disjoint subtrees resolve
independently — sibling subtrees do not block each other. The drain
uses `Promise.all(entries.map(processEntry))` so a slow fetch on one
host does not delay another host whose fetch resolves quickly.

If a host's scope is destroyed before its template resolves (e.g. an
ancestor structural directive tore down the subtree), the deferred
entry is silently dropped — no error, no orphan install against a
detached element. The element-cleanup contract from spec 017 / 018
covers cancellation; structural directives that remove a subtree call
`destroyElementScope(element)` and the pending template entries on
that subtree see the destroyed flag at drain time.

## Mock fetcher pattern for tests

Tests inject a mock fetcher in one of two ways. Either replace the
`$templateRequest` factory directly via `module.factory(...)`:

```ts
const fetcher = vi.fn<TemplateFetcher>((url) => Promise.resolve(`<p>${url}</p>`));

resetRegistry();
createModule('ng', [])
  // …other ng services…
  .factory('$templateCache', [() => createTemplateCache()])
  .factory('$templateRequest', [
    '$templateCache',
    (cache: TemplateCacheService): TemplateRequestFn =>
      createTemplateRequest({ cache, fetcher }),
  ])
  .provider('$compile', ['$provide', $CompileProvider]);
```

…or decorate the default service with `module.decorator(...)` after
registration, swapping the underlying fetcher while preserving the
real `$templateCache` integration:

```ts
const app = createModule('app', ['ng']).decorator('$templateRequest', [
  '$templateCache',
  ($templateCache: TemplateCacheService): TemplateRequestFn => {
    const fetcher = vi.fn<TemplateFetcher>(async () => '<p>mocked</p>');
    return createTemplateRequest({ cache: $templateCache, fetcher });
  },
]);
```

Both patterns avoid touching `globalThis.fetch` directly, which would
leak across test cases. The factory-replacement approach is more
common in this repo because it gives each test a fresh
`$templateRequest` closure with its own `inFlight` map.

The default fetcher routes through `globalThis.fetch` and converts
non-2xx HTTP statuses into a rejected promise carrying a
`TemplateFetchFailedError`. Environments without a global `fetch`
(older Node, restricted sandboxes) must inject a custom fetcher; the
default implementation throws a `ReferenceError` at first use if
`fetch` is missing.

## Forward-pointers

The following AngularJS 1.x template-loading features are deliberately
out of scope:

- **`replace: true`** — DEPRECATED in AngularJS 1.x. Rejected at
  registration via `ReplaceTrueNotSupportedError`. Will NOT ship in
  this project. Templates always become the host element's children;
  the host element itself is preserved.
- **`templateNamespace: 'html' | 'svg' | 'mathml'`** — namespace-aware
  template parsing. Deferred to a future SVG-focused spec. The
  `<template>`-element fragment parser used in this spec handles the
  common HTML5 cases correctly.
- **`<script type="text/ng-template" id="...">`** — a built-in
  directive that registers its `innerHTML` to `$templateCache` at
  compile time. Lands with the Built-in Directives roadmap bullet, not
  here. Apps can replicate it today via a run-block
  `$templateCache.put(...)` seed.
- **Multi-element `*-start` / `*-end` templates** — tightly coupled to
  `ng-repeat`; lands with the structural-directives spec.
- **`$http` integration** — Phase 3 ships `$http`. `$templateRequest`
  uses native `fetch` for now; a future spec MAY add a decorator that
  routes through `$http` when both are loaded, to honor interceptors
  and default headers. The `createTemplateRequest({ fetcher })` seam is
  exactly the surface that hookup would target.
- **Cross-origin without CORS** — out of scope. The spec assumes
  same-origin URLs or properly-configured CORS responses.
- **`$templateCache` persistence** — the cache is an in-memory `Map`;
  no `localStorage` / `IndexedDB` integration. Hot-reload during
  development requires the app to clear the cache manually
  (`$templateCache.removeAll()` from a debug hook).
