# `@di` — Dependency Injection

Modules, injector, and provider recipes modeled after AngularJS 1.x — with strong TypeScript generics so that `injector.get('name')` narrows to the registered type.

## Entry points

```ts
import { createModule, createInjector } from 'my-own-angularjs/di';

const app = createModule('app', [])
  .value('greeting', 'hello')
  .factory('greeter', ['greeting', (g: string) => () => g]);

const injector = createInjector([app]);
injector.get('greeter')(); // "hello"
```

| Export                                                                                                         | Where         | Purpose                                                                                                                 |
|----------------------------------------------------------------------------------------------------------------|---------------|-------------------------------------------------------------------------------------------------------------------------|
| `createModule(name, requires)` / `Module` / `getModule` / `resetRegistry`                                      | `module.ts`   | Register and look up modules; returns a typed module API whose type accumulates registrations.                          |
| `createInjector(modules)`                                                                                      | `injector.ts` | Instantiate an injector from a list of modules; runs config blocks, then exposes `get/has/invoke/instantiate/annotate`. |
| `annotate(fn)`                                                                                                 | `annotate.ts` | Resolve a function's dependency names via array-annotation, `fn.$inject`, or inline comment syntax.                     |
| Types: `Annotated`, `Injector`, `Invokable`, `ModuleAPI`, `ProviderArray`, `ProviderService`, `ResolveDeps`, … | `di-types.ts` | Generics backing the typed module/injector API.                                                                         |

## Provider recipes

| Recipe                        | Registered as | What you get                                                               |
|-------------------------------|---------------|----------------------------------------------------------------------------|
| `.value(name, v)`             | value         | `v` directly.                                                              |
| `.constant(name, v)`          | constant      | Same as value, but available during `config` blocks.                       |
| `.factory(name, ['dep', fn])` | factory       | `fn(dep)` — invoked once, cached.                                          |
| `.service(name, ClassCtor)`   | service       | `new ClassCtor(...deps)` — instantiated once, cached.                      |
| `.provider(name, providerFn)` | provider      | `providerFn.$get(...deps)` — full provider lifecycle; visible in `config`. |

## Lifecycle

1. Register modules and their recipes.
2. `createInjector([app])` — the returned injector runs all `config` blocks (with `$injector`/providers), then all `run` blocks (with instances), and finally exposes the runtime API.
3. `get` / `invoke` / `instantiate` resolve names from the cache; unresolved names throw `UnknownProviderError` with the dependency chain for debuggability.

## Override patterns

Two paths register services. They share the same backing maps and the same
last-wins semantics — pick the one that fits the call site.

### Chain-time module DSL

The `module.factory` / `module.decorator` chain runs **before**
`createInjector(...)` does — registrations are pushed onto the module's
`$$invokeQueue` and drained when the injector boots. Use this when the
override is statically known at module-definition time:

```ts
import { createModule, createInjector } from 'my-own-angularjs/di';
import { ngModule } from 'my-own-angularjs/core';

const myApp = createModule('myApp', ['ng'])
  .factory('$exceptionHandler', [() => myHandler])
  .decorator('$http', ['$delegate', ($delegate) => wrap($delegate)]);

const injector = createInjector([ngModule, myApp]);
```

### Config-phase `$provide`

Inside a `config()` block, `'$provide'` resolves to a service with the
same six recipes. Use this when the override depends on other config-phase
state, when porting AngularJS migration-guide code verbatim, or when the
override lives alongside other config-time setup:

```ts
import type { ProvideService } from 'my-own-angularjs/di';

const myApp = createModule('myApp', ['ng']).config([
  '$provide',
  ($provide: ProvideService) => {
    $provide.factory('$exceptionHandler', [() => myHandler]);
    $provide.decorator('$http', [
      '$delegate',
      ($delegate) => wrap($delegate),
    ]);
  },
]);
```

`$provide` resolves only inside `config()` blocks; calling any of its
methods from a run block, a factory, or a captured-reference invocation
after bootstrap throws synchronously with
`$provide.<method> is only callable during the config phase; calling it after the run phase begins is not supported`.

### Constant-override guard

`.constant(name, value)` reserves `name` against any later override.
Whether the attempt comes from the module DSL or from `$provide`, a
`value` / `factory` / `service` / `provider` / `decorator` recipe targeting
a name already registered as a `.constant` throws synchronously:

```text
Cannot override constant "<name>" — already registered via .constant(...)
```

The guard fires uniformly through both registration paths — see
`applyRegistrationRecord` in `registration.ts`.

### Last-wins eviction

Within the unified registration timeline (the `$$invokeQueue` drain
followed by every `config()` block in module-graph order), a new
**producer** recipe (`value` / `factory` / `service` / `provider`) wipes
prior producer entries for the same name from the other backing maps. The
run-phase resolver returns the most-recent producer's value, not a stale
earlier one. **Decorators are not evicted** — they stack on whatever
producer is current at resolution time, so `module.decorator('foo', …)`
followed by `$provide.factory('foo', …)` still applies the decorator to
the new factory's output.

## Dependencies

Only `@core/utils` (`isArray`, `isFunction`). No dependency on `@core/scope` or `@parser`.
