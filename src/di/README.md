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

| Export                                                                                                         | Where         | Purpose                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `createModule(name, requires)` / `Module` / `getModule` / `resetRegistry`                                      | `module.ts`   | Register and look up modules; returns a typed module API whose type accumulates registrations.              |
| `createInjector(modules)`                                                                                      | `injector.ts` | Instantiate an injector from a list of modules; runs config blocks, then exposes `get/has/invoke/annotate`. |
| `annotate(fn)`                                                                                                 | `annotate.ts` | Resolve a function's dependency names via array-annotation, `fn.$inject`, or inline comment syntax.         |
| Types: `Annotated`, `Injector`, `Invokable`, `ModuleAPI`, `ProviderArray`, `ProviderService`, `ResolveDeps`, … | `di-types.ts` | Generics backing the typed module/injector API.                                                             |

## Provider recipes

| Recipe                        | Registered as | What you get                                                               |
| ----------------------------- | ------------- | -------------------------------------------------------------------------- |
| `.value(name, v)`             | value         | `v` directly.                                                              |
| `.constant(name, v)`          | constant      | Same as value, but available during `config` blocks.                       |
| `.factory(name, ['dep', fn])` | factory       | `fn(dep)` — invoked once, cached.                                          |
| `.service(name, ClassCtor)`   | service       | `new ClassCtor(...deps)` — instantiated once, cached.                      |
| `.provider(name, providerFn)` | provider      | `providerFn.$get(...deps)` — full provider lifecycle; visible in `config`. |

### `.provider` is the base recipe; the rest are specializations

A single `.provider('x', …)` call registers **two** names:

- **`xProvider`** — the configurable provider _instance_, injectable **only**
  during `config` (where you tune it, e.g. `gp.prefix = '> '`).
- **`x`** — the _service_ it produces: the return value of the provider's
  `$get`, built lazily in the run phase and cached.

Conceptually every other recipe is a `.provider` whose `$get` is written for
you — they produce the service `x` but skip the configurable `xProvider`:

| Shorthand             | Conceptually equivalent provider `$get`                         |
| --------------------- | --------------------------------------------------------------- |
| `.factory('x', fn)`   | `$get = fn` → `fn(...deps)`                                     |
| `.service('x', Ctor)` | `$get` does `new Ctor(...deps)`                                 |
| `.value('x', v)`      | `$get = () => v` (no deps, no build)                            |
| `.constant('x', v)`   | like `value`, but also readable in `config` and override-locked |

This is the same `<name>Provider` convention behind `<name>Filter`
(`./filter`) and `<name>Directive` (`./compiler`).

> **Implementation note.** For clarity, each recipe has its own backing map and
> its own branch in `get` — they do **not** literally desugar into a `.provider`
> registration the way AngularJS does internally. The table describes the
> _observable_ equivalence, not the wiring; the one real difference is that only
> `.provider` exposes a `<name>Provider` object for the config phase.

## Build & resolution flow

The system has two halves: a **module builder** that only _records intent_,
and an **injector** that _executes_ that intent across three phases and then
resolves names lazily. Nothing is instantiated until you ask for it.

The three diagrams below all trace this one module — a `greeter` whose
prefix is configured before the service is built, then wrapped by a
decorator:

```ts
import { createModule, createInjector } from 'my-own-angularjs/di';
import { ngModule } from 'my-own-angularjs/core';

const app = createModule('app', ['ng'])
  .constant('apiUrl', 'https://api.example.com')
  .value('greeting', 'hello')
  .provider(
    'greeter',
    class GreeterProvider {
      prefix = '';
      // `$get` reads the `greeting` value; `this` is the provider instance.
      $get = [
        'greeting',
        function (this: GreeterProvider, greeting: string) {
          return () => this.prefix + greeting;
        },
      ];
    },
  )
  .decorator('greeter', ['$delegate', (greet: () => string) => () => greet().toUpperCase()])
  .config([
    'greeterProvider',
    (gp: { prefix: string }) => {
      gp.prefix = '> ';
    },
  ])
  .run(['greeter', (greet: () => string) => console.log(greet())]);

createInjector([ngModule, app]); // logs "> HELLO"
```

### 1. Declaration — the builder records, it does not run

Each call appends to one of three queues and returns the module, so the
chain just accumulates intent:

```text
createModule('app', ['ng'])
  .constant('apiUrl', '…')   ─┐
  .value('greeting','hello')  ┼─► $$invokeQueue:
  .provider('greeter', …)     │     [ ['constant','apiUrl','…'],
  .decorator('greeter', …)   ─┘       ['value','greeting','hello'],
  │                                    ['provider','greeter', GreeterProvider],
  │                                    ['decorator','greeter', upper] ]
  │
  .config(['greeterProvider', gp => gp.prefix = '> '])  ─► $$configBlocks: [block]
  .run(['greeter', greet => greet()])                   ─► $$runBlocks:    [block]
```

Nothing has executed — `GreeterProvider` is not constructed, `greeting` is
not yet in any map. `.directive` / `.controller` / `.filter` (not used here)
own no registry; they are pure `.config` sugar forwarding to
`$compileProvider` / `$controllerProvider` / `$filterProvider`.

### 2. Boot — `createInjector([ngModule, app])` drains the queues in three phases

```text
createInjector([ngModule, app])
   │  wire backing maps; self-register $injector and $provide
   ▼
 Phase 1  loadModule(app)   (requires 'ng' → getModule('ng') loads first)
   │  drain app.$$invokeQueue via applyRegistrationRecord:
   │     'apiUrl'   → providerCache               (+ constantNames)
   │     'greeting' → providerCache
   │     'greeter'  → providerInstances['greeterProvider'] = new GreeterProvider()
   │                  providerGetInvokables['greeter']      = that instance's $get
   │     decorator  → decorators['greeter'] = [upper]
   │  collect $$configBlocks + $$runBlocks
   ▼
 Phase 2  config:  providerInjector.invoke(['greeterProvider', gp => gp.prefix='> '])
   │     looks up providerInstances['greeterProvider'], sets .prefix = '> '
   │     (config can see apiUrl/greeting + any <name>Provider + $provide —
   │      but NOT greeter itself; the service is not built yet)
   ▼
   │  validate decorators: 'greeter' has a producer ✓
   │  phase = 'run'  ;  delete $provide from cache
   ▼
 Phase 3  run:  runInjector.invoke(['greeter', greet => greet()])
   │     triggers get('greeter')  — see diagram 3
   ▼
 return runInjector  ── this is your $injector
```

The post-order walk + a `loadedModules` set means shared, diamond, and
circular _module-level_ dependencies each load exactly once. The phase flip
is one-way: after it, `$provide` is gone and the now-configured
`greeterProvider` can no longer be mutated.

### 3. Resolution — `get('greeter')` is lazy, ordered, and cached

The run block asks for `greeter`, which is the first time anything resolves
it. `get` tries the producer maps in order and takes the first hit:

```text
get('greeter')              push 'greeter' onto the resolution stack
   │  already on the stack?  no   (if yes → throw "Circular dependency: greeter <- … <- greeter")
   ▼
   1. providerCache['greeter']?          miss
   2. factoryInvokables['greeter']?      miss
   3. serviceCtors['greeter']?           miss
   4. providerGetInvokables['greeter']?  HIT
        │  $get = ['greeting', fn]  →  annotate → deps = ['greeting']
        │  resolve deps:  get('greeting')
        │       └─ providerCache['greeting']  HIT → 'hello'
        │  fn.apply(greeterProvider, ['hello'])     →  () => '> hello'
        ▼
   applyDecoratorChain('greeter', () => '> hello')
        └─ upper:  $delegate = () => '> hello'  →  () => $delegate().toUpperCase()
                                                →  () => '> HELLO'
        ▼
   providerCache['greeter'] = () => '> HELLO'      (cached singleton)
   drop providerGetInvokables['greeter'] + decorators['greeter']
   pop 'greeter'  →  return
```

Then the run block calls `greet()` → `'> HELLO'`. `annotate` supplies the
`['greeting']` dep list from the array form (never by parsing
`fn.toString()`, so it survives minification). Because the result is cached
in `providerCache` and the producer entry dropped, a second `get('greeter')`
short-circuits at step 1 and returns the same function.

### `get(name)` in plain words

Think of the injector as a kitchen that cooks each dish **once** and keeps it
warm. `get(name)` runs four checks, in order:

1. **Already on the counter?** If `name` is in `providerCache`, hand it back —
   done. Values, constants, and anything built earlier all live here.
2. **Already cooking it?** If `name` is on the resolution stack, you asked for
   something that is still being made → that is a loop → throw
   `Circular dependency: a <- b <- a`.
3. **Have a recipe?** Look for a producer for `name` — factory, then service,
   then a provider's `$get`. To run it: fetch each ingredient first by calling
   `get` on every dependency (the same four steps, recursively), run the
   recipe, pipe the result through any decorators, put the finished dish on the
   counter (`providerCache`), and hand it back. Every later request now stops
   at step 1.
4. **Never heard of it?** Throw `Unknown provider: <name>`.

That is the whole resolver: return the cached value, detect loops, otherwise
build-once-and-cache, or fail with a clear name. The same `get` is what run
blocks call during boot and what you call later via `injector.get(...)` — one
function, one code path.

### Why building is deferred to `get` (and not done in `createInjector`)

`createInjector` only **registers** recipes (the drain) and then runs config
and run blocks. It never loops over every registration to build it. Services
are built lazily by `get`, on first request. `createInjector` reaches building
**only** through run blocks — a `.run(['greeter', …])` forces `get('greeter')`
during Phase 3 — so the eager surface is exactly "whatever the run blocks pull
in," nothing more.

This laziness is deliberate. Eager building during the drain would break three
things:

1. **Registration order would start to matter.** Recipes can reference names
   that are registered later, in another file or another module. Deferring the
   build until after the whole module graph is loaded means every name exists
   by the time anything resolves, so factories/modules stay reorderable:

   ```ts
   createModule('app', [])
     .factory('userApi', ['http', (http) => …]) // needs http, registered first
     .factory('http', ['apiUrl', (url) => …]) // http comes after
     .value('apiUrl', 'https://api'); // apiUrl comes last
   // Building userApi eagerly at drain time would crash — http isn't registered yet.
   ```

2. **Config must run before services are built.** A provider is configured in
   the config phase, then its service is built in the run phase. If the service
   were built during the drain, config could not tune it. In the `greeter`
   example the service is built _after_ `gp.prefix = '> '`, which is the only
   reason it returns `'> HELLO'` instead of `'hello'`.

3. **Pay only for what you use.** A service nobody `get`s is never built — no
   wasted work, no side effects, and an unused service with a missing
   dependency never throws. Eager building would force every registration to
   resolve at boot and surface errors for code nobody calls.

The payoff is the AngularJS model: order-independent registration, a real
config seam, and singletons created on first use.

## Lifecycle

1. Register modules and their recipes.
2. `createInjector([app])` — the returned injector runs all `config` blocks (with `$injector`/providers), then all `run` blocks (with instances), and finally exposes the runtime API.
3. `get` / `invoke` resolve names lazily — a producer runs once and the result is cached, then reused. An unknown name throws a plain `Error: Unknown provider: <name>`; a dependency cycle throws `Error: Circular dependency: a <- b <- a` (only the cycle error carries the chain).

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
    $provide.decorator('$http', ['$delegate', ($delegate) => wrap($delegate)]);
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
