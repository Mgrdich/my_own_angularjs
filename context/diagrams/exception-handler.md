# Centralized exception handling

## Purpose

`$exceptionHandler` is the single sink every framework-internal "log and continue"
call site routes runtime errors through, so one failing watcher, listener, async
task, or interpolation never crashes the digest. The default implementation logs to
`console.error`; apps override it to forward errors to Sentry, Datadog, or any other
reporter.

## Collaborators & call order

```text
  A throw at a framework-internal call site
  (watch fn, watch listener, $evalAsync task, $on listener,
   $$postDigest callback, interpolation render, filter lookup,
   directive compile/link, TTL exhaustion)
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ invokeExceptionHandler(handler, exception, cause?)            │
  │   — the recursion-guarded dispatcher EVERY call site uses     │
  │                                                               │
  │   try {                                                        │
  │     handler(exception, cause) ──▶ ┌──────────────────────────┐│
  │   }                               │ configured $exceptionHandler│
  │   catch (secondary) {             │  default:                │ │
  │     console.error(handler-threw,  │  consoleErrorExceptionHandler│
  │       secondary, original)        │  → console.error(...)    │ │
  │     // NOT re-invoked — no loop   └──────────────────────────┘ │
  │   }                                                           │
  └──────────────────────────────────────────────────────────────┘

  cause is one of the 10 frozen EXCEPTION_HANDLER_CAUSES tokens:
    watchFn · watchListener · $evalAsync · $applyAsync · $$postDigest
    eventListener · $digest · $interpolate · $filter · $compile

  Caller flow after dispatch:
    digest / interpolate / compile  ── continues ──▶ next watcher/expr
    (only TTL exhaustion re-THROWS, after first reporting via the handler)
```

The collaborator is the configured handler value itself — by default
`consoleErrorExceptionHandler`. The crucial contract is the **recursion guard** in
`invokeExceptionHandler`: a custom handler that itself throws is caught, both errors
are logged to `console.error`, and the handler is **not** re-invoked — so a buggy
`$exceptionHandler` can never crash the digest. Callers (the digest in `@core`, the
render loop in `@interpolate`, the compiler in `@compiler`) supply one of the ten
`EXCEPTION_HANDLER_CAUSES` cause tokens; future internal call sites must extend that
frozen tuple as a public-API change.

## Using it the primary way

The ESM-first API: import the value exports directly. `consoleErrorExceptionHandler`
is the default handler, `exceptionHandler` is its default-instance alias,
`noopExceptionHandler` is a test-only silencer, and `invokeExceptionHandler` is the
recursion-guarded dispatcher any third-party service can reuse.

```typescript
import {
  consoleErrorExceptionHandler,
  invokeExceptionHandler,
} from 'my-own-angularjs/exception-handler';
import type { ExceptionHandler } from 'my-own-angularjs/exception-handler';

const handler: ExceptionHandler = consoleErrorExceptionHandler;

// Route a caught error through the dispatcher with the same recursion
// safety the framework uses internally.
try {
  throw new Error('boom');
} catch (err) {
  invokeExceptionHandler(handler, err, 'watchFn');
}
```

`Scope.create({ exceptionHandler })` and `createInterpolate({ exceptionHandler })`
accept a handler through their ESM options bag, which is how the default is wired
without an injector.

## Using it the dependency-injection way

This is a **DI-only service** — it is reached as `$exceptionHandler` through the
injector and there is no other "primary" injector handle to it. Apps override it by
registering a replacement on a module, either wholesale via
`module.factory('$exceptionHandler', …)` or by wrapping the current one via
`module.decorator('$exceptionHandler', …)`.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';
import type { ExceptionHandler } from 'my-own-angularjs/exception-handler';

createModule('app', [])
  // Replace the default handler entirely.
  .factory('$exceptionHandler', [
    () => {
      const handler: ExceptionHandler = (exception, cause) => {
        // forward to your reporter here
        console.error('[app]', cause, exception);
      };
      return handler;
    },
  ]);

const injector = createInjector(['app']);
const $exceptionHandler = injector.get('$exceptionHandler');
$exceptionHandler(new Error('reported'), '$digest');
```

## Related diagrams

- [Scopes & digest cycle](./scope-and-digest.md) — the digest routes every watcher / listener / async-task throw here, and re-throws only on TTL exhaustion
- [String & template interpolation](./interpolate.md) — render-time throws route here (cause `'$interpolate'` / `'$filter'`)
- [Filters & the filter pipeline](./filters.md) — unknown-filter `FilterLookupError` routes here at digest time (cause `'$filter'`)
- [Injector & module system](./injector-and-modules.md) — how `$exceptionHandler` is registered and overridden
- [Diagram index](./README.md)
