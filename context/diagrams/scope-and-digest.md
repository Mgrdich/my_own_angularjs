# Scopes & digest cycle

## Purpose

A scope is the model object the framework dirty-checks: `$watch` registers an
expression to observe, `$digest` re-evaluates every watcher until the model settles,
and `$apply` runs a change and then triggers a digest. Scopes form a tree (`$new` /
`$destroy`) and carry an event bus (`$on` / `$emit` / `$broadcast`).

## Collaborators & call order

```text
  scope.a = 1
  scope.$apply()
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ $apply(expr?)                                                 │
  │   1. $eval(expr)   ── evaluate the change on this scope       │
  │   2. $root.$digest() ──────────────────────────────┐         │
  └────────────────────────────────────────────────────┼─────────┘
                                                        │
                                                        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ $digest()  — loops up to TTL (default 10) times               │
  │                                                               │
  │   ┌─ $$digestOnce() ─────────────────────────────────────┐    │
  │   │  for each watcher:                                    │    │
  │   │    newVal = watchFn(scope)                            │    │
  │   │      └──evaluate──▶ ┌──────────────────────────────┐  │    │
  │   │                     │ @parser compiled expression  │  │    │
  │   │                     │ (parse() → watch delegate)   │  │    │
  │   │                     └──────────────────────────────┘  │    │
  │   │    if newVal !== oldVal:  dirty = true; listenerFn()  │    │
  │   │    watchFn / listenerFn throws ──route──▶ $exceptionHandler
  │   └───────────────────────────────────────────────────────┘   │
  │                                                               │
  │   drain $$asyncQueue ($evalAsync)  ──throws route──▶ $exceptionHandler
  │   repeat while dirty || async queue non-empty                  │
  │                                                               │
  │   TTL guard: still dirty after N passes                       │
  │     ──report (cause '$digest')──▶ $exceptionHandler  then THROW│
  │                                                               │
  │   flush $$postDigestQueue ($$postDigest) ──throws──▶ $exceptionHandler
  └──────────────────────────────────────────────────────────────┘
```

Collaborators: the **`@parser`** compiled expressions backing string watchers, and
**`$exceptionHandler`**, through which every watcher / listener / async-task throw is
routed so the loop keeps running — only TTL exhaustion re-throws (after first
reporting).

## Using it the primary way

The ESM-first API: import `Scope` and create a scope directly.

```typescript
import { Scope } from 'my-own-angularjs/core';

const scope = Scope.create();

scope.$watch(
  'a + b',
  (newValue, oldValue) => {
    console.log('sum changed:', oldValue, '->', newValue);
  },
);

scope.a = 1;
scope.b = 2;
scope.$digest(); // logs: sum changed: undefined -> 3
```

`scope.$apply(() => { scope.a = 5; })` wraps a change and triggers the digest for
you. Child scopes come from `parentScope.$new()` (or `parentScope.$new(true)` for an
isolate scope); `$eval`, `$evalAsync`, and `$applyAsync` are also available on every
scope.

## Using it the dependency-injection way

The canonical DI handle for the root scope will be `$rootScope`, reached via the
injector once application bootstrap lands. **That bootstrap (`$rootScope` factory
registration) is a Phase-2 roadmap item not yet shipped**, so today scopes are not
injector-resolvable — you create them directly with `Scope.create()` and grow the
tree with `parentScope.$new()`.

```typescript
// Today (bootstrap not yet shipped): create the root scope directly.
import { Scope } from 'my-own-angularjs/core';

const $rootScope = Scope.create();
const childScope = $rootScope.$new();

// Once bootstrap lands, the same scope will be reachable as:
//   injector.get('$rootScope')
```

## Related diagrams

- [Expression parser](./expression-parser.md) — compiles the string expressions backing string watchers
- [Centralized exception handling](./exception-handler.md) — where every watcher / listener / async-task throw is routed
- [Diagram index](./README.md)
