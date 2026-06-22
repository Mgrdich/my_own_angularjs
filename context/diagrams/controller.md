# Controllers ($controller / $controllerProvider)

## Purpose

A controller is the per-view JavaScript that backs a piece of markup. The pair is
split across the two DI phases: `$controllerProvider.register(name, fn)` is the
config-phase registry write (last-wins on duplicate names, mirroring services and
filters), and `$controller(nameOrFn, locals?, ident?, later?)` is the run-phase
instantiator. Instantiation is AngularJS-canonical: parse any `'Name as alias'`
suffix, `Object.create(constructor.prototype)`, `injector.invoke` the function with the
prototype-instance as `this` and the resolved DI locals, apply return-value
replacement (a non-null object return REPLACES the instance), then publish the
`controllerAs` alias onto `locals.$scope`. The `later: true` fourth-argument form is the
compiler's seam — it returns `{ instance, identifier }` and SKIPS the alias publish so
the compiler can flow `bindToController` bindings onto the instance first.

## Collaborators & call order

```text
  ── config phase ──
  $controllerProvider.register('Greeter', ['$scope', GreeterFn])
       │  (last-wins on duplicate name; 'hasOwnProperty' reserved)
       ▼
  $$registry: Map<string, ControllerInvokable>

  ── run phase ──
  $controller('Greeter as vm', { $scope }, ident?, later?)
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ $controller(nameOrFn, locals?, ident?, later?)               │
  │                                                              │
  │   1. typeof nameOrFn === 'string'?                           │
  │        parseControllerName('Greeter as vm')                  │
  │          → { name: 'Greeter', ident: 'vm' }                  │
  │        reject 'hasOwnProperty' (prototype-pollution guard)    │
  │        entry = $$registry.get('Greeter')                     │
  │          undefined? ──▶ throw UnknownControllerError          │
  │      else (function | array): instantiate directly           │
  │                                                              │
  │   2. instantiate(injector, entry, locals):                  │
  │        ctor    = trailing fn of array / the bare fn          │
  │        instance = Object.create(ctor.prototype)             │
  │        returned = injector.invoke(fn, instance, locals) ─────┼─▶ see injector-and-modules.md
  │        (resolves '$scope', '$element', other DI deps)        │
  │        returned is non-null object? ──▶ REPLACE instance     │
  │                                                              │
  │   3. resolve alias: explicit `ident` SUPERSEDES 'as vm'      │
  │        (both validated against IDENT_RE)                     │
  │                                                              │
  │   4a. later === true (compiler seam):                        │
  │         return { instance, identifier: alias }  ── NO publish │
  │   4b. legacy 1–3 arg path:                                   │
  │         bindAlias(locals.$scope, alias, instance)            │
  │           scope[alias] = instance  ──────────────────────────┼─▶ see scope-and-digest.md
  │         return instance                                      │
  └──────────────────────────────────────────────────────────────┘

  ── the compiler's later:true seam (per controlled element) ──
  $compile constructs ──▶ $controller(name, locals, ident, true)
       │  → { instance, identifier }
       ▼
  stash in $$ngControllers ─▶ resolve `require` ─▶ wire bindToController
       │                                            bindings onto instance
       ▼
  publish scope[identifier] = instance ─▶ $onInit ─▶ pre/post link ─▶ $onDestroy
```

Collaborators: the **`$injector`** (`injector.invoke` resolves each controller's DI
dependencies — un-annotated bare functions are rejected, so `$inject` arrays or the
array-wrap form are required), **`$controllerProvider`**'s readonly `$$registry` Map
(handed to `createController` at `$get`), the **scope** the alias is published onto
(`locals.$scope`; absent → the alias is silently skipped), and the **`$compile`**
orchestrator, which drives the `later: true` deferred-alias path so `require`
resolution and `bindToController` binding can run BEFORE the alias is published. A
direct `$controller('Bad', {})` call propagates `UnknownControllerError` to the caller;
the compile-time path routes the SAME error through `$exceptionHandler('$compile')` — a
deliberate AngularJS-parity asymmetry (direct callers own their `try/catch`).

## Using it the primary way

The ESM-first API is `createController({ injector, registry })`. Unlike
`interpolate`, there is no default singleton — the factory needs an injector (and
`createInjector` is a factory, not a singleton), so it ships factory-only. In
practice controllers are reached through DI; the factory export exists for the
provider's `$get` and for focused unit tests.

```typescript
import { createController } from 'my-own-angularjs/controller';

// A registry is normally the $controllerProvider's $$registry Map.
const registry = new Map([['Greeter', ['$scope', GreeterFn]]]);
const $controller = createController({ injector, registry });

const scope = { /* a Scope */ } as never;

// Registered name with alias suffix → scope.vm === instance:
$controller('Greeter as vm', { $scope: scope });

// Inline array-style annotation with explicit ident:
$controller(['$scope', ($scope: unknown) => ({})], { $scope: scope }, 'vm');
```

`$ControllerProvider` (the DI shim) stays out of the root barrel — matching the
`$SanitizeProvider` / `$CompileProvider` precedent — but is exported from
`my-own-angularjs/controller` for advanced wiring.

## Using it the dependency-injection way

The normal path. `$controllerProvider.register(...)` runs in a `config` block (or via
the `module.controller(...)` DSL sugar, which forwards verbatim to the provider —
last-wins, no extra validation). `$controller` is then resolved through the injector
at run time. The compiler does this for you for every directive declaring a
`controller` and for `ng-controller`.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', [])
  // DSL sugar → forwards to $controllerProvider.register (config-phase, last-wins):
  .controller('Greeter', [
    '$scope',
    function Greeter($scope: { greeting: string }) {
      $scope.greeting = 'hello';
    },
  ]);

const injector = createInjector(['ng', 'app']);
const $controller = injector.get('$controller');

// Run-phase: instantiate and publish the alias onto the scope.
$controller('Greeter as vm', { $scope: someScope });
```

`register` is config-phase only — even a `$controllerProvider` reference captured
during config and called from a `run()` block trips the phase guard. Bare-function
controllers without `$inject` throw at instantiation (no source-parsing fallback); ES
classes must be wrapped in a factory (`['$scope', ($s) => new MyClass($s)]`).

## Related diagrams

- [DOM compiler ($compile)](./compile.md) — drives the `later: true` deferred-alias seam, `require` resolution, and `bindToController` wiring per controlled element
- [Injector & module system](./injector-and-modules.md) — how `$controllerProvider` registers and how `injector.invoke` resolves a controller's DI dependencies
- [Scopes & digest cycle](./scope-and-digest.md) — the scope the `controllerAs` alias is published onto, and `locals.$scope`
- [Diagram index](./README.md)
