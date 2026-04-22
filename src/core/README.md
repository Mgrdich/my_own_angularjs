# `@core` — Scopes, Digest, Utilities

The runtime heart of the library: scope hierarchy, dirty-checking digest loop, and a small kit of shared type guards and value helpers.

## Entry points

```ts
import { Scope, isEqual, copy, forEach } from 'my-own-angularjs/core';
```

| Export                                                                       | Where                      | Purpose                                                                    |
|------------------------------------------------------------------------------|----------------------------|----------------------------------------------------------------------------|
| `Scope.create<T>(options?)`                                                  | `scope.ts`                 | Create a root scope. Optional `ttl` (default 10) bounds digest iterations. |
| `$watch / $watchGroup / $watchCollection`                                    | `scope.ts`                 | Register dirty-check watchers. Returns a deregister fn.                    |
| `$digest / $apply / $eval / $evalAsync / $applyAsync`                        | `scope.ts`                 | Propagate model changes.                                                   |
| `$new / $destroy`                                                            | `scope.ts`                 | Scope hierarchy management. Supports isolate scopes.                       |
| `$on / $emit / $broadcast`                                                   | `scope.ts`                 | Event channel with upward (emit) and downward (broadcast) propagation.     |
| `constantWatchDelegate / oneTimeWatchDelegate / oneTimeLiteralWatchDelegate` | `scope-watch-delegates.ts` | Internal watch-strategy selectors driven by AST flags.                     |
| `isString / isNumber / isObject / isArray / isFunction / …`                  | `utils.ts`                 | Type guards that narrow in conditionals.                                   |
| `isEqual, copy, forEach, createMap, range, noop`                             | `utils.ts`                 | Value helpers.                                                             |

Types live in `scope-types.ts` (`Watcher`, `WatchFn`, `ListenerFn`, `ScopeEvent`, `ScopeOptions`, `ScopePhase`, …).

## Key invariants

- **Configurable digest TTL.** `Scope.create({ ttl: 20 })` overrides the default; on breach, the thrown error includes the watch function source.
- **Errors never abort the digest.** Watch/listener exceptions are logged with `console.error` and the loop continues.
- **Expression-string watches delegate to `@parser/index`** (`parse()`) and pick a specialized delegate based on AST flags — `literal` → one-time, `constant` → stop watching after the first stable value, otherwise a normal dirty check.

## Dependencies

- `utils.ts` and `scope-types.ts` are leaves (no cross-module imports).
- `scope.ts` imports `@parser/index` for expression-string watches. This is intentional and is the single edge from `core` into another submodule.
