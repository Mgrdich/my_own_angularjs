# Injector & module system

## Purpose

The dependency-injection system is two cooperating pieces: a **module** is a named,
declarative collection of service registrations (`createModule('app')` plus recipe
methods like `.value` / `.factory` / `.provider`), and the **injector**
(`createInjector([...])`) walks the module dependency graph, runs the config phase,
then resolves and caches services lazily on each `injector.get(name)`.

## Collaborators & call order

```text
  createModule('app')
       │  .constant(...) / .value(...) / .factory(...) / .service(...)
       │  .provider(...) / .decorator(...) / .config(...) / .run(...)
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ Module                                                        │
  │   $$invokeQueue:  [recipeType, name, value][]  (registrations)│
  │   $$configBlocks: config(...) blocks                          │
  │   $$runBlocks:    run(...) blocks                             │
  │   requires:       names of other modules to load first        │
  └───────────────────────────────┬──────────────────────────────┘
                                   │
  createInjector([appModule])      │
       │                           ▼
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ createInjector(modules)                                       │
  │                                                               │
  │   1. load graph: for each module, recurse `requires` first    │
  │      (Set<string> guard ⇒ each module loaded at most once)    │
  │           │                                                   │
  │           ▼                                                   │
  │   2. drain $$invokeQueue ──▶ applyRegistrationRecord(...)     │
  │      (providers/constants registered; producers most-recent-  │
  │       wins, decorators stack)                                 │
  │           │                                                   │
  │           ▼                                                   │
  │   3. CONFIG PHASE                                             │
  │      self-register $provide ──▶ run $$configBlocks            │
  │      ($provide.factory/value/constant/provider/decorator      │
  │       callable ONLY here)                                     │
  │      then delete $provide, flip phase 'config' ──▶ 'run'      │
  │           │                                                   │
  │           ▼                                                   │
  │   4. RUN PHASE — run $$runBlocks                              │
  └───────────────────────────────┬──────────────────────────────┘
                                   │ returns Injector
                                   ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ injector.get('name')                                          │
  │   cache hit?  ── yes ──▶ return singleton                     │
  │       │ no                                                    │
  │       ▼                                                       │
  │   annotate(fn) ─▶ read $inject / ['$dep', fn] array form      │
  │       │                                                       │
  │       ▼                                                       │
  │   resolve deps (recursive get) ─▶ invoke producer ─▶ cache    │
  └──────────────────────────────────────────────────────────────┘

  injector.has('name') ⌁  ── lazy presence probe (no instantiation),
                            used by optional-dependency call sites
```

Collaborators inside `@di`: `annotate` (reads `$inject` arrays / `['$dep', fn]`
minification-safe forms), `applyRegistrationRecord` (the shared per-record recipe
handler), and the config-phase `$provide` injectable. `@di` depends only on
`@core`; module-DSL sugar like `.directive` / `.controller` / `.filter` forwards to
other providers through `import type`-only references, so `@di` keeps zero runtime
dependency on `@compiler` / `@controller`.

## Using it the primary way

The ESM-first API: import `createModule` and `createInjector` as named exports, wire
a module, then resolve services through the injector.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', [])
  .constant('apiUrl', 'https://api.example.com')
  .factory('http', ['apiUrl', (apiUrl: string) => ({ base: apiUrl })]);

const injector = createInjector(['app']);

injector.get('apiUrl'); // 'https://api.example.com'
injector.get('http'); // { base: 'https://api.example.com' } — cached singleton
injector.has('http'); // true (no instantiation side effect)
```

## Using it the dependency-injection way

This module **is** the DI system, so the "DI way" is the config-phase path: the
`$provide` injectable (and the module-DSL methods that forward to it) registering
services from inside a `config(...)` block. `$provide` is reachable **only during
config** — its six methods throw synchronously if called after the run phase begins.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';
import type { ProvideService } from 'my-own-angularjs/di';

createModule('app', [])
  .provider('clock', { $get: () => ({ now: () => Date.now() }) })
  .config([
    '$provide',
    ($provide: ProvideService) => {
      // Config-phase registration — same recipe surface as the module DSL.
      $provide.value('greeting', 'hello');
      // Decorate an already-registered service.
      $provide.decorator('clock', [
        '$delegate',
        ($delegate: { now: () => number }) => ({ ...$delegate, label: 'wrapped' }),
      ]);
    },
  ]);

const injector = createInjector(['app']);
injector.get('greeting'); // 'hello'
```

## Related diagrams

- [Scopes & digest cycle](./scope-and-digest.md) — `$rootScope` will be an injector-resolvable service once bootstrap lands
- [Expression parser](./expression-parser.md) — a plain ESM utility, not (yet) a `$parse` DI service
- [Centralized exception handling](./exception-handler.md) — `$exceptionHandler` is a DI-only service registered through this system
- [Strict Contextual Escaping ($sce)](./sce.md) — `$sceProvider` configures the strict-mode flag during the config phase
- [Opt-in HTML sanitization (ngSanitize)](./sanitize.md) — `ngSanitize` is an opt-in module registering `$sanitize`
- [Diagram index](./README.md)
