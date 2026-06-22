# String & template interpolation

## Purpose

Interpolation turns a template string containing `{{ }}` markers into a function
that resolves those expressions against a scope and returns the rendered string.
`$interpolate(text, mustHaveExpression?, trustedContext?)` compiles each embedded
expression once through the parser, and the returned `InterpolateFn` stringifies and
concatenates the results on every call. When a `trustedContext` is supplied (e.g. a
`URL` attribute), the rendered value is routed through `$sce.getTrusted(...)` before
it reaches the DOM, enforcing Strict Contextual Escaping.

## Collaborators & call order

```text
  interpolate('Hi {{user.name}}', false, undefined)
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ interpolate(text, mustHaveExpression?, trustedContext?)       │
  │   — compiles ONCE per template string                         │
  │                                                               │
  │   1. validate trustedContext (unknown context → throw)        │
  │   2. scan text → literal segments + {{ expr }} segments        │
  │           │                                                   │
  │           ▼  per embedded expression                          │
  │      parse(expr) ──────────▶ ┌──────────────────────────────┐ │
  │                              │ @parser compiled ExpressionFn │ │
  │                              └──────────────────────────────┘ │
  │   3. strictTrustActive =                                       │
  │        trustedContext set && $sce.isEnabled() && getTrusted   │
  │      if strictTrustActive && expressions.length > 0:          │
  │        ENFORCE single-binding rule (exactly one {{expr}},     │
  │        no surrounding text) ── else throw at compile time     │
  │   4. if mustHaveExpression && no expressions → return undefined│
  └───────────────────────────────────────┬──────────────────────┘
                                           │ returns InterpolateFn
                                           ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ render(scope)  — runs EVERY digest pass                       │
  │   for each segment:                                           │
  │     value = expressionFn(scope, locals?)                      │
  │     if strictTrustActive:                                     │
  │       value = $sce.getTrusted(trustedContext, value) ─────────┼─▶ see sce.md
  │     append String(value)  (null/undefined → '')              │
  │   a throw here ──route (cause '$interpolate'/'$filter')──────┼─▶ $exceptionHandler
  └──────────────────────────────────────────────────────────────┘
```

Collaborators: the **`@parser`** compiled expressions backing each `{{ }}` segment,
**`$sce`** (via the injected `getTrusted` / `isEnabled` callbacks) when a
`trustedContext` is in force, and **`$exceptionHandler`**, through which a render-time
throw is routed (cause `'$interpolate'`, or `'$filter'` for a `FilterLookupError`) so a
single bad expression does not crash the digest. Without an injector the `$sce`
callbacks are absent, so `trustedContext` is accepted but unenforced
(graceful-degradation parity).

## Using it the primary way

The ESM-first API: import the pre-configured `interpolate` (default `{{` / `}}`
delimiters) or call `createInterpolate({ … })` for custom symbols.

```typescript
import { interpolate } from 'my-own-angularjs/interpolate';

const fn = interpolate('Hi {{user.name}}, you have {{count}} messages');

fn({ user: { name: 'Ada' }, count: 3 });
// 'Hi Ada, you have 3 messages'

// mustHaveExpression: a template with NO {{ }} returns undefined instead of ''
interpolate('static text', true); // undefined
```

`createInterpolate(options)` accepts an `exceptionHandler`, custom start/end symbols,
and the `$sce` `getTrusted` / `isEnabled` callbacks through its options bag — that is
how the default instance is wired without an injector.

## Using it the dependency-injection way

Reached as `$interpolate` through the injector. The provider wires the `$sce`
callbacks automatically, so a `trustedContext` argument is fully enforced under DI.
Apps override or wrap it via `module.decorator('$interpolate', …)`.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', []);

const injector = createInjector(['ng', 'app']);
const $interpolate = injector.get('$interpolate');

// A trusted URL context: the rendered value passes through $sce.getTrusted.
const hrefFn = $interpolate('{{link}}', true, 'url');
const scope = { link: 'https://example.com' };
hrefFn(scope); // enforced single-binding URL — see sce.md
```

## Related diagrams

- [Expression parser](./expression-parser.md) — compiles each `{{ expr }}` segment into an evaluable function
- [Strict Contextual Escaping ($sce)](./sce.md) — where a trusted-context render value is routed through `getTrusted`
- [DOM compiler ($compile)](./compile.md) — the compiler calls `$interpolate` for text-node and attribute `{{ }}`
- [Centralized exception handling](./exception-handler.md) — where a render-time throw is routed (cause `'$interpolate'` / `'$filter'`)
- [Diagram index](./README.md)
