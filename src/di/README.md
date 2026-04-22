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

## Dependencies

Only `@core/utils` (`isArray`, `isFunction`). No dependency on `@core/scope` or `@parser`.
