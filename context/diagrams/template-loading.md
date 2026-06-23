# Template loading ($templateCache / $templateRequest)

## Purpose

The template-loading module turns a template URL into a string of markup, with a
cache in front of the network. `$templateCache` is a `Map`-backed key-value store
(`put` / `get` / `remove` / `removeAll` / `info`). `$templateRequest(url)` is the
async fetch-and-cache pipeline: a cache hit short-circuits the network; a miss kicks
off exactly one `fetch`, writes the body back into the cache, and resolves the string.
Concurrent requests for the same URL share one in-flight promise, so only one network
call happens per URL while a request is outstanding. This pair backs `$compile`'s
`template` / `templateUrl` DDO support.

## Collaborators & call order

```text
  $compile (templateUrl directive) ──$templateRequest(url)──▶
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ $templateRequest(url, ignoreRequestError?)                   │
  │                                                              │
  │   1. cached = $templateCache.get(url)                        │
  │        cached !== undefined?                                 │
  │          └─▶ return Promise.resolve(cached)  (ZERO network)  │
  │                                                              │
  │   2. pending = inFlight.get(url)                             │
  │        pending !== undefined?                                │
  │          └─▶ return pending  (dedup — share the same chain)  │
  │                                                              │
  │   3. (miss + not in flight) ── fetcher(url) ───────────────┐ │
  │        pending = fetcher(url).then(                        │ │
  │          text  → { $templateCache.put(url, text);          │ │
  │                     inFlight.delete(url); return text }     │ │
  │          err   → { inFlight.delete(url); throw err }        │ │
  │        )                                                    │ │
  │        inFlight.set(url, pending)                           │ │
  │                                                            ┌─┘ │
  │   4. ignoreRequestError === true?                          │   │
  │        └─▶ pending.catch(() => undefined)  (→ undefined)   │   │
  └────────────────────────────────────────────────────────────┼──┘
                                                               │
              ┌────────────────────────────────────────────────┘
              ▼  default fetcher
  ┌──────────────────────────────────────────────────────────────┐
  │ defaultFetcher(url) ── globalThis.fetch(url) ──▶ response      │
  │   response.ok?  → response.text()                             │
  │   else          → throw TemplateFetchFailedError(url, status) │
  └──────────────────────────────────────────────────────────────┘

  $templateCache  ── Map<string, string> ──▶
     put / get / remove / removeAll / info
     (cache-write side effect lives in $templateRequest's resolve handler)
```

Collaborators: the **`$templateCache`** (`Map`-backed; the cache-first check and the
resolve-time `put` write are the two seams where `$templateRequest` touches it), the
injected **`fetcher`** (defaults to a `globalThis.fetch`-based implementation that
converts non-2xx statuses into a rejected `TemplateFetchFailedError`; tests inject a
mock fetcher via `createTemplateRequest({ cache, fetcher })`), the per-closure
**`inFlight: Map<string, Promise<string>>`** that deduplicates concurrent requests and
is cleared after settlement so a later request can re-fetch, and the upstream consumer
**`$compile`**, which calls `$templateRequest` to resolve `templateUrl` directives
(inline `<script type="text/ng-template">` templates pre-seed `$templateCache`, so they
resolve with zero network via step 1).

## Using it the primary way

The ESM-first API: `createTemplateCache` builds a fresh cache; `createTemplateRequest`
wraps a cache (and an optional fetcher) into the request function. Default singletons
`templateCache` / `templateRequest` are exported for standalone use.

```typescript
import { createTemplateCache, createTemplateRequest } from 'my-own-angularjs/template';

const cache = createTemplateCache();
const request = createTemplateRequest({
  cache,
  fetcher: async (url: string) => `<p>${url}</p>`, // inject a mock in tests
});

const html = await request('/tpl/card.html'); // '<p>/tpl/card.html</p>'
cache.get('/tpl/card.html'); // '<p>/tpl/card.html</p>' — written on resolution

// Pre-seeding the cache short-circuits the network entirely:
cache.put('/inline.html', '<b>cached</b>');
await request('/inline.html'); // '<b>cached</b>' — fetcher never called
```

`createTemplateRequest({ cache, fetcher })` constructs a fresh `inFlight` map per call,
so two requests built from the same factory invocation share dedup state while
separate invocations stay isolated.

## Using it the dependency-injection way

Reached as the `$templateCache` and `$templateRequest` services through the injector.
The DI factory registered on `ngModule` constructs a per-injector `$templateRequest`
closure backed by that injector's `$templateCache` (and the default
`globalThis.fetch`-based fetcher), so the `inFlight` map and cache are never shared
across injectors.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', []).run([
  '$templateCache',
  ($templateCache: { put(k: string, v: string): void }) => {
    // Pre-seed a template so $templateRequest resolves it with zero network.
    $templateCache.put('/tpl/header.html', '<header>Hi</header>');
  },
]);

const injector = createInjector(['ng', 'app']);
const $templateRequest = injector.get('$templateRequest');

$templateRequest('/tpl/header.html').then((html) => {
  // '<header>Hi</header>' — served straight from $templateCache
});
```

Mixing the DI services with the standalone `templateRequest` / `templateCache`
singletons in the same app means two independent `inFlight` maps and two independent
caches — usually a bug. Pick one path.

## Related diagrams

- [Injector & module system](./injector-and-modules.md) — how `$templateCache` / `$templateRequest` are registered and resolved per injector
- [Diagram index](./README.md)
