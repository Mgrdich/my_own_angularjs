# Strict Contextual Escaping ($sce)

## Purpose

`$sce` is the trust gate between application data and security-sensitive DOM sinks
(HTML, URL, resource URL, JS, CSS). `trustAs(context, value)` wraps a value in a
per-context nominal trust class; `getTrusted(context, value)` unwraps it only if it
was trusted for that context, otherwise it throws (strict mode) or sanitizes (the
HTML path, when `ngSanitize` is loaded). The `$sceDelegate` underneath enforces the
resource-URL allow/block lists. Strict mode is frozen after the config phase.

## Collaborators & call order

```text
  sce.getTrusted('html', value)
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ getTrusted(ctx, value)  — strict dispatch                     │
  │   if !enabled → return delegate.valueOf(value)  (pass-through) │
  │   validate ctx (unknown → throw)                              │
  │           │                                                   │
  │           ▼                                                   │
  │   ┌─ ctx === 'html' && value is a plain string ────────────┐  │
  │   │   ⌁ lazy $injector.has('$sanitize') probe              │  │
  │   │       ├─ present (ngSanitize loaded):                  │  │
  │   │       │     value = $sanitize(value) ──────────────────┼──┼─▶ see sanitize.md
  │   │       └─ absent: strict throw (untrusted HTML)         │  │
  │   └────────────────────────────────────────────────────────┘  │
  │           │  (other contexts, or a trusted wrapper)          │
  │           ▼                                                   │
  │   delegate.getTrusted(ctx, value) ───────────────────────────┐│
  └──────────────────────────────────────────────────────────────┼┘
                                                                  │
                                                                  ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ $sceDelegate.getTrusted(ctx, value)                          │
  │   - trusted wrapper for ctx (or any-context)? → unwrap, allow │
  │   - ctx === 'resourceUrl' (no wrapper)?                       │
  │       compile-time matchers (resource-url-matcher.ts):        │
  │         block-list match  → THROW (block-first precedence)    │
  │         allow-list match  → allow raw URL                     │
  │         neither           → THROW (untrusted resource URL)    │
  │   - other contexts (no wrapper) → THROW                       │
  └──────────────────────────────────────────────────────────────┘

  trustAs(ctx, value):  enabled → wrap in per-context TrustedValue class
                        disabled → return value unchanged (no wrapper built)
```

Collaborators: the **`$sceDelegate`** (the always-strict engine `$sce` delegates to),
the **resource-URL matcher** (`src/sce/resource-url-matcher.ts`) that enforces the
allow/block lists with block-first precedence, and — only on the HTML-plain-string
path — **`$sanitize`** reached through the marked `⌁` lazy `$injector.has('$sanitize')`
probe. That probe is the zero-coupling seam: `$sce` never imports the sanitize module;
it degrades to a strict throw when `ngSanitize` is not loaded. Trust classes are
nominal (`TrustedResourceUrl extends TrustedUrl`), so a trusted resource URL is
accepted where a trusted URL is expected, checked via `instanceof`.

## Using it the primary way

The ESM-first API: import the pre-configured `sce` (strict, default lists) or build
your own with `createSce` / `createSceDelegate`.

```typescript
import { sce, createSce } from 'my-own-angularjs/sce';

// Wrap an author-controlled fragment as trusted HTML, then unwrap it.
const trusted = sce.trustAsHtml('<p>hello <b>world</b></p>');
sce.getTrustedHtml(trusted); // '<p>hello <b>world</b></p>'

// A plain (untrusted) string in strict mode throws unless $sanitize is wired.
// Custom delegate with an explicit resource-URL allow-list:
const custom = createSce({ enabled: true });
custom.isEnabled(); // true
```

`createSceDelegate({ trustedResourceUrlList, bannedResourceUrlList })` builds a
delegate whose matchers are compiled once; `createSce({ delegate, enabled, sanitize })`
wraps it with the strict-mode flag and the optional HTML-sanitizer callback.

## Using it the dependency-injection way

Reached as `$sce` at run time; configured through `$sceProvider` during `config()`.
`$sceProvider.enabled(false)` is the only way to disable strict mode, and the flag is
frozen at `$get`. When `ngSanitize` is in the dependency chain, the provider's lazy
`$injector.has('$sanitize')` probe auto-wires the HTML-sanitizer fallback.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', []).config([
  '$sceProvider',
  ($sceProvider: { enabled(flag: boolean): unknown }) => {
    // $sceProvider.enabled(false); // disable strict mode app-wide (frozen at $get)
  },
]);

const injector = createInjector(['ng', 'app']);
const $sce = injector.get('$sce');
$sce.getTrustedResourceUrl($sce.trustAsResourceUrl('https://api.example.com/data'));
```

## Related diagrams

- [String & template interpolation](./interpolate.md) — routes trusted-context render values through `getTrusted`
- [Opt-in HTML sanitization (ngSanitize)](./sanitize.md) — where the HTML-plain-string path delegates via the `⌁` lazy probe
- [Injector & module system](./injector-and-modules.md) — how `$sceProvider` is configured and the flag is frozen at `$get`
- [Centralized exception handling](./exception-handler.md) — strict-mode trust failures surface to the caller; render-time ones route here
- [Diagram index](./README.md)
