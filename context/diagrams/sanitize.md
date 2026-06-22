# Opt-in HTML sanitization (ngSanitize)

## Purpose

`$sanitize` scrubs untrusted HTML against a fixed allow-list: it parses the input,
drops any tag, attribute, or URI scheme not on the allow-list, and re-serializes the
surviving structure as a safe, escaped HTML string. It is the companion to `$sce` —
when `ngSanitize` is loaded, `$sce.getTrustedHtml(plainString)` routes through it
automatically. It is **opt-in**: it is never registered on the core `ng` module, so an
app must list `'ngSanitize'` in its dependency chain to get it.

## Collaborators & call order

```text
  sanitize('<a href="javascript:x" onclick="y">hi</a><script>z</script>')
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ sanitize(input)  — pure closure, frozen allow-lists           │
  │   1. coerce: null/undefined → '';  non-string → String(input) │
  │           │                                                   │
  │           ▼                                                   │
  │   2. htmlParser(input, handler)  (sanitize-tokenizer.ts)      │
  │      regex tokenizer → start / end / text / comment tokens    │
  │           │                                                   │
  │           ▼  per token, the TokenHandler gates it             │
  │   ┌──────────────────────────────────────────────────────┐   │
  │   │ start tag <t a=…>:                                     │   │
  │   │   t ∉ validElements  → enter DROP subtree, skip        │   │
  │   │   per attribute a:                                     │   │
  │   │     a ∉ validAttrs            → drop attribute         │   │
  │   │     a is URI-bearing (href/src/…):                     │   │
  │   │       scheme ∉ valid protocols → drop attribute        │   │
  │   │     else → keep, value HTML-escaped                    │   │
  │   │   emit sanitized <t …> (self-close void elements)      │   │
  │   │ text:  HTML-escape, append                             │   │
  │   │ end tag </t>: emit only for an allowed, non-void tag   │   │
  │   │ comment: dropped                                       │   │
  │   └──────────────────────────────────────────────────────┘   │
  │           │                                                   │
  │           ▼                                                   │
  │   3. return concatenated escaped output                       │
  └──────────────────────────────────────────────────────────────┘

  result: '<a>hi</a>'   (javascript: href, onclick, and <script> all stripped)
```

Collaborators are all **internal to `@sanitize`**: the regex **tokenizer**
(`src/sanitize/sanitize-tokenizer.ts`) that drives the `TokenHandler` closure, and the
three frozen allow-lists resolved once at factory-call time — `validElements`,
`validAttrs` (URI attrs ∪ HTML attrs), and the URI-protocol allow-list. `$sanitize`
takes **no** `$exceptionHandler` and no other service: it is a pure string-to-string
transform. Its only cross-service role is being the target of `$sce`'s lazy
`$injector.has('$sanitize')` probe on the HTML path.

## Using it the primary way

The ESM-first API: import the pre-configured `sanitize` (default allow-lists) or call
`createSanitize({ … })` to extend the element allow-list / enable SVG.

```typescript
import { sanitize } from 'my-own-angularjs/sanitize';

sanitize('<a href="javascript:alert(1)" onclick="bad()">click</a>');
// '<a>click</a>' — dangerous scheme + event handler stripped

sanitize('<p>keep <b>this</b></p><script>drop()</script>');
// '<p>keep <b>this</b></p>' — script element removed
```

`createSanitize({ extraValidElements: ['custom-tag'] })` returns an independent
service with a widened element allow-list; the allow-lists are frozen for the lifetime
of the returned closure.

## Using it the dependency-injection way

Reached as `$sanitize` through the injector, but **only when `'ngSanitize'` is in the
app's dependency chain** — it is deliberately absent from the core `ng` module. The
`$SanitizeProvider` shim is DI-only and not on the root barrel. Swap in DOMPurify (or
any sanitizer) via `module.decorator('$sanitize', …)`; the swap is transparently
visible through `$sce.getTrustedHtml`.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', ['ngSanitize']); // opt in to $sanitize

const injector = createInjector(['ng', 'ngSanitize', 'app']);
const $sanitize = injector.get('$sanitize');
$sanitize('<img src="x" onerror="hack()">'); // event handler stripped
```

## Related diagrams

- [Strict Contextual Escaping ($sce)](./sce.md) — the HTML-plain-string path delegates here via the lazy `$injector.has('$sanitize')` probe
- [String & template interpolation](./interpolate.md) — trusted HTML reaches the DOM via `$sce`, which leans on `$sanitize`
- [Injector & module system](./injector-and-modules.md) — `ngSanitize` is an opt-in module that registers `$sanitize`
- [Diagram index](./README.md)
