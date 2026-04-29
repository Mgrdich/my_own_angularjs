# `@sanitize` — opt-in HTML scrubber

`createSanitize` / `sanitize` (ESM-first) and `$sanitize` / `$SanitizeProvider`
(DI compat) faithfully port the AngularJS 1.8.3 `ngSanitize` regex tokenizer
plus its frozen tag / attribute / URI allow-lists. See `CLAUDE.md` for the
module surface and invariants. This file documents the swap-in pattern for
replacing the built-in implementation with [DOMPurify](https://github.com/cure53/DOMPurify).

## Why swap?

The built-in scrubber is a faithful AngularJS 1.x port — useful for parity
with legacy apps and for keeping the dependency surface small, but it has a
fixed allow-list and the same defensive posture as upstream. Apps with
stricter security needs (or that already vet DOMPurify on their threat model)
can route `$sanitize` through DOMPurify instead. **DOMPurify is not bundled
or declared as a dependency of `my-own-angularjs`** — installing it is the
caller's responsibility.

The two requirements DOMPurify needs to honor for the swap to be safe:

- **`RETURN_DOM_FRAGMENT: false`** — `$sanitize` is contractually
  string-in / string-out (`SanitizeService = (input: unknown) => string`).
  Returning a fragment would break every downstream consumer, including
  `$sce.getTrustedHtml`'s `typeof value === 'string'` guard.
- **`RETURN_TRUSTED_TYPE: false`** — same reason. The Trusted Types polyfill
  output is not a plain string and would break the `String` contract.

## DI swap (decorator pattern)

Inside any application module, decorate `$sanitize` to delegate to DOMPurify.
The decorator receives the original service as `$delegate`; it can ignore it
or fall back to it on errors.

```ts
import DOMPurify from 'dompurify'; // peer of the app, NOT this library
import { ngModule } from 'my-own-angularjs/core';
import { createInjector } from 'my-own-angularjs/di';
import { ngSanitize } from 'my-own-angularjs/sanitize';
import type { SanitizeService } from 'my-own-angularjs/sanitize';
import { createModule } from 'my-own-angularjs/di';

const purifyOptions = {
  RETURN_DOM_FRAGMENT: false,
  RETURN_TRUSTED_TYPE: false,
} as const;

const myApp = createModule('myApp', ['ngSanitize']).decorator('$sanitize', [
  '$delegate',
  (_$delegate: SanitizeService): SanitizeService => {
    return (input: unknown): string => {
      if (input === null || input === undefined) return '';
      const html = typeof input === 'string' ? input : String(input);
      return DOMPurify.sanitize(html, purifyOptions);
    };
  },
]);

const injector = createInjector([ngModule, ngSanitize, myApp]);
const $sce = injector.get('$sce');

// $sce.getTrustedHtml(plainString) now routes through DOMPurify, because
// $SceProvider.$get's lazy `$injector.has('$sanitize')` lookup picks up
// the decorated service.
$sce.getTrustedHtml('<img src=x onerror=alert(1)>'); // → '<img src="x">'
```

The `'$delegate'` array recipe is the spec-008 decorator surface (see
`src/di/__tests__/decorator.test.ts` for parity tests). The decorated
`$sanitize` is a drop-in replacement — `$sce.getTrustedHtml(plainString)`,
`ng-bind-html` (when directives land), and any direct `injector.get('$sanitize')`
caller all see the swapped implementation.

## ESM-first swap

For pure-ESM consumers that do not use the injector, wire DOMPurify through
the `sanitize` option on `createSce` directly:

```ts
import DOMPurify from 'dompurify';
import { createSce } from 'my-own-angularjs/sce';

const sceWithPurify = createSce({
  sanitize: (html: string): string =>
    DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: false,
      RETURN_TRUSTED_TYPE: false,
    }),
});

sceWithPurify.getTrustedHtml('<img src=x onerror=alert(1)>'); // → '<img src="x">'
```

This is the same seam the DI layer uses — `$SceProvider.$get` calls
`createSce({ sanitize: $injector.get('$sanitize') })` when `ngSanitize` is
loaded — so the two surfaces are interchangeable.

## What you give up

- **AngularJS parity test vectors** stop applying. The `parity-spec.test.ts`
  and `cve-regressions.test.ts` suites in this repo pin the AngularJS-port
  output. DOMPurify makes different (often stricter) decisions, so those
  expectations no longer hold.
- **`$sanitizeProvider.addValidElements` / `addValidAttrs` / `enableSvg` /
  `uriPattern`** lose their effect — the decorator replaces the entire
  service, so the provider's accumulated extras are ignored. If you need
  per-app extensions, configure DOMPurify directly via its `ADD_TAGS` /
  `ADD_ATTR` options inside the decorator closure.

## Why a decorator and not a custom provider?

The decorator path leaves `ngSanitize` in the injector as the registration
site (so `$injector.has('$sanitize')` still returns `true` and the `$sce`
fallback wires up automatically). Replacing the provider entirely would
require the consumer to re-implement the AngularJS-style provider lifecycle,
which is unnecessary churn for what is conceptually a one-line replacement.
