# `@exception-handler` — centralized exception routing

Spec 014 — runtime error reporting service for the framework.

## Why

Specs 011 (§2.10) and 013 (§2.10) deferred runtime error routing — six
`console.error` swallowing sites lived inline in `src/core/scope.ts`, and
`$interpolate` render-time errors bubbled unguarded. There was no single
seam an app could wire into to capture, log, or report runtime errors.

`$exceptionHandler` is that seam. The default forwards to `console.error`,
so observable behavior is unchanged. Apps override the registration in
their module wiring to ship errors to Sentry, Datadog, or a custom logger.
The recursion guard ensures a buggy custom handler never crashes the
digest.

## Public surface

| Export | Kind | Purpose |
| --- | --- | --- |
| `ExceptionHandler` | type | `(exception: unknown, cause?: string) => void` — the public callable contract |
| `ExceptionHandlerCause` | type | Union of the eight cause-descriptor strings (derived from `EXCEPTION_HANDLER_CAUSES`) |
| `EXCEPTION_HANDLER_CAUSES` | value | Frozen tuple of all cause tokens — runtime mirror of the union |
| `consoleErrorExceptionHandler` | value | Default handler — `console.error('[$exceptionHandler]', exception, cause)` |
| `noopExceptionHandler` | value | `() => {}` — for tests only; do NOT use in production |
| `exceptionHandler` | value | Default-instance alias; equivalent to `consoleErrorExceptionHandler` |
| `invokeExceptionHandler` | value | Recursion-guarded dispatcher — wraps the handler call in try/catch |

## Cause descriptors

Every framework-internal call site passes a cause token so handlers can
route, filter, or annotate based on origin. The list is frozen at eight
tokens — future specs that add new internal call sites must extend
`EXCEPTION_HANDLER_CAUSES` as a public-API change.

| Token | When it fires |
| --- | --- |
| `'watchFn'` | A `$watch` watch-function throws during a digest pass |
| `'watchListener'` | A `$watch` listener throws after a value-change detection |
| `'$evalAsync'` | A `$evalAsync` queue task throws while draining at the start of a digest pass |
| `'$applyAsync'` | A `$applyAsync` queue task throws during flush |
| `'$$postDigest'` | A `$$postDigest` callback throws after the digest cycle completes |
| `'eventListener'` | An `$on` listener throws during `$emit` / `$broadcast` propagation |
| `'$digest'` | TTL exhaustion — the constructed `Error` is reported via the handler before being re-thrown to the `$apply` caller |
| `'$interpolate'` | An interpolated `{{expr}}` evaluation throws inside the render fn |

## Override paths

Two registration paths work today. Both rely on the `@di` array-form recipe
(plain-function form silently fails — see `src/di/annotate.ts`).

### `module.factory` — last-registration-wins

Replace the default with a custom handler when registering a module. The
last `factory('$exceptionHandler', …)` registration wins, so the app's
module overrides the core `ng` module's default.

```ts
import { createModule, createInjector } from 'my-own-angularjs/di';
import { ngModule } from 'my-own-angularjs/core';

const myApp = createModule('myApp', ['ng']).factory('$exceptionHandler', [
  () => (exception: unknown, cause?: string) => {
    // Hypothetical Sentry integration — the import is the app's concern.
    Sentry.captureException(exception, { extra: { cause } });
  },
]);

const injector = createInjector([ngModule, myApp]);
```

The `.factory()` second argument MUST be an array, not a plain function —
the codebase's `annotate()` runtime requires array form.

### `module.decorator` — wrap the default

Add side-effects without losing the default's `console.error` logging.
The decorator receives the original handler as `$delegate`; calling it
preserves the existing log and lets you layer additional behavior on top.

```ts
const myApp = createModule('myApp', ['ng']).decorator('$exceptionHandler', [
  '$delegate',
  ($delegate: (e: unknown, c?: string) => void) =>
    (exception: unknown, cause?: string) => {
      myAnalytics.recordError(exception, cause);
      $delegate(exception, cause); // default still logs to console.error
    },
]);
```

This is the recommended path when you want to *add* error reporting
without giving up the existing console output. The decorator surface is
the spec-008 recipe — see `src/di/__tests__/decorator.test.ts` for parity
tests.

## Recursion guard

If a custom handler itself throws, the framework's `invokeExceptionHandler`
helper catches the secondary throw and logs both errors to `console.error`
directly with the prefix `[$exceptionHandler] handler threw while reporting:`.
It does NOT re-invoke the configured handler recursively — that risks an
infinite loop. The digest, event loop, and interpolation render continue
normally.

This means a buggy `$exceptionHandler` registration can never crash the
framework: the worst case is that errors fall through to `console.error`,
which is exactly what the framework did before the service existed.

## ESM-only path

For test code or pure-ESM consumers that bypass the injector, pass the
handler directly via the options bag on `Scope.create` or
`createInterpolate`:

```ts
import { Scope } from 'my-own-angularjs/core';
import { createInterpolate } from 'my-own-angularjs/interpolate';
import { exceptionHandler, noopExceptionHandler } from 'my-own-angularjs/exception-handler';

const scope = Scope.create({ exceptionHandler: noopExceptionHandler }); // silence digest errors in tests
const interpolate = createInterpolate({ exceptionHandler }); // default = console.error
```

The injector wiring uses the same seam internally — `$rootScope` and
`$interpolate` both read `$exceptionHandler` from the injector and pass
it through to the underlying factory.

## Why not `$provide.factory`?

The canonical AngularJS-style `$provide.factory` registration is not
supported by this codebase yet — `$provide` is reserved for a future
spec. Until then, `module.factory` and `module.decorator` are the two
working paths. The README and CLAUDE.md will pick up `$provide.factory`
once that spec lands.
