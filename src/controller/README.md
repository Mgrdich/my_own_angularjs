# `@controller` — controllers and the `$controller` service

Controllers are the AngularJS-canonical answer to "where does the per-view
JavaScript live?" A controller is an ordinary function (typically used as a
constructor) that receives an injected scope — and any other services it
asks for — and exposes the properties and methods that a template
consumes. The `@controller` module ships the run-phase `$controller`
service that instantiates controllers on demand and the config-phase
`$controllerProvider` that registers them by name.

The module mirrors the project's `@filter` / `@compiler` / `@template`
layout: an ESM-first factory at the bottom (`createController`) and a
thin DI shim on top (`$ControllerProvider`) that wires the factory into
`ngModule` and owns the name registry.

## The dual surface — `createController` vs. `$controller`

`createController({ injector, registry })` is the ESM-first primary API.
It is a pure factory — no DI dependency of its own — that returns the
run-phase `(nameOrFn, locals?, ident?) => instance` function. All name
parsing, alias resolution, dependency injection, and instantiation logic
lives here, so the factory is unit-testable against a hand-rolled fake
injector and a real `Map`.

```ts
import { createController } from 'my_own_angularjs/controller';

const services = new Map<string, unknown>([['$log', console]]);
const registry = new Map([
  [
    'Greeter',
    [
      '$scope',
      '$log',
      function ($scope, $log) {
        ($scope as { greeting: string }).greeting = 'hi';
        ($log as Console).info('Greeter constructed');
      },
    ],
  ],
]);

// Hand-rolled fake injector — see `src/controller/__tests__/controller.test.ts`
// for the full helper. The real `$injector` satisfies the same surface.
const fakeInjector = makeFakeInjector(services);

const $controller = createController({ injector: fakeInjector, registry });
const scope = { greeting: '' };
$controller('Greeter', { $scope: scope });
// scope.greeting === 'hi'
```

`$controller` is the same function reached through DI in an app
configured with `ngModule`. Registration goes through
`$controllerProvider.register(...)` from a `config()` block; the resolved
service is accessible from a `run()` block (or any service that injects
`$controller`):

```ts
import { createModule, createInjector } from 'my_own_angularjs/di';
import { ngModule } from 'my_own_angularjs/core';
import { Scope } from 'my_own_angularjs/core';

const app = createModule('app', ['ng']).config([
  '$controllerProvider',
  ($cp) => {
    $cp.register('Greeter', [
      '$scope',
      function ($scope) {
        ($scope as { greeting: string }).greeting = 'hi';
      },
    ]);
  },
]);

const injector = createInjector([ngModule, app]);
const $controller = injector.get('$controller');
const scope = Scope.create();
$controller('Greeter', { $scope: scope });
// (scope as { greeting: string }).greeting === 'hi'
```

The two surfaces produce the same instance via the same code path. Use
`createController` when wiring a unit test (no `createInjector`
overhead); use the DI shim everywhere else.

## The `'Name as alias'` parser

A registered controller name may carry a `' as <alias>'` suffix. The
alias becomes a property name on `locals.$scope` after construction:

```ts
$controller('Greeter as vm', { $scope: scope });
// scope.vm === instance
```

The parse is run against the single regex `CONTROLLER_NAME_ALIAS_RE =
/^(\S+?)(\s+as\s+([\w$]+))?\s*$/`. The bare name is group 1; the alias
is group 3 (optional). Alias shape is enforced by `IDENT_RE =
/^[A-Za-z_$][\w$]*$/` — the first character must be a letter, `_`, or
`$`; subsequent characters may also include digits. Failures throw
`MalformedControllerAliasError` at the parse site.

A scope-absent call silently skips the alias bind (no error):

```ts
const instance = $controller('Greeter as vm', {}); // no $scope
// returns the instance; no alias is bound
```

### `ident` argument supersedes the suffix

The third positional argument `ident` is treated as an explicit alias and
wins over any alias the name string carries:

```ts
const instance = $controller('Greeter as suffix', { $scope: scope }, 'explicit');
// scope.explicit === instance
// scope.suffix === undefined
```

This precedence rule mirrors AngularJS 1.x and is what makes the
directive integration's `controllerAs` field compose cleanly with
registered names: the directive's DDO controls the alias regardless of
how the controller was registered.

## Instantiation — `Object.create` + invoke + return-value replacement

`createController` constructs each instance via the AngularJS-canonical
pattern:

1. Pick the "constructor" — the trailing function of an array-style
   annotation or the bare function itself.
2. Create a prototype-instance via `Object.create(constructor.prototype)`.
   `instanceof` checks see the right answer, and methods stashed on the
   constructor's `prototype` are visible on `this` from inside the body.
3. Invoke the function with `self = instance` and the resolved DI locals
   (`$injector.invoke(fn, instance, locals)`).
4. Apply return-value replacement: if the invoke returned a non-null
   object, that return value REPLACES the prototype-instance.

```ts
function ReplacingCtrl() {
  return { explicit: true };
}
ReplacingCtrl.$inject = [];

const instance = $controller(ReplacingCtrl, {});
// instance === { explicit: true }
// instance instanceof ReplacingCtrl === false
```

This semantic matches the standard `new` operator and AngularJS's
`$injector.instantiate`. A constructor that returns `undefined`, a
primitive, or `null` keeps the prototype-instance as the result.

### ES-class footnote

ES classes throw `TypeError: Class constructor X cannot be invoked
without 'new'` when called as a plain function. The factory's
`injector.invoke(fn, instance, locals)` does exactly that — it calls
`fn.apply(instance, deps)`, not `new fn(...deps)`. Wrap the class in a
factory function or array annotation:

```ts
class GreeterCls {
  constructor(public $scope: Scope) {
    ($scope as { greeting: string }).greeting = 'hi';
  }
}

// WRONG — throws TypeError at first instantiation:
// $controllerProvider.register('Greeter', GreeterCls);

// Correct — wrap in a plain function:
$controllerProvider.register('Greeter', [
  '$scope',
  function ($scope) {
    return new GreeterCls($scope as Scope);
  },
]);
```

The factory function returns the `new`-constructed instance, which the
return-value-replacement rule promotes to the result. This is the
canonical pattern for class-style controllers in projects that prefer
classes over function constructors.

## Last-wins on duplicate `register(name, ...)`

A second `register('Foo', fnB)` call OVERWRITES any earlier
`register('Foo', fnA)`. Matches services and filters; contrasts with
directives, which ACCUMULATE per name (two `directive('foo', factoryA)`
plus `directive('foo', factoryB)` calls produce two directives that both
run on `<div foo>`).

```ts
$cp.register('Greeter', fnA);
$cp.register('Greeter', fnB);
$cp.has('Greeter');           // true
$controller('Greeter', { $scope }); // runs fnB only
```

The internal `$$registry: Map<string, ControllerInvokable>` calls
`.set(name, fn)` on every registration; no accumulation array is built.

## `$compile` integration

When a directive's DDO declares `controller`, the compiler invokes
`$controller(...)` once per matched element, AFTER `$transclude` setup,
BEFORE the directive's own pre-link function (and therefore before any
pre-link or post-link on the same element). Locals passed to the
controller are `{ $scope, $element, $attrs, $transclude }`; the
`$transclude` key is present only on transcluding hosts.

```ts
$compileProvider.directive('myCard', () => ({
  restrict: 'E',
  scope: true,
  controller: [
    '$scope',
    '$element',
    function ($scope, $element) {
      this.title = ($element as Element).getAttribute('title') ?? '';
    },
  ],
  controllerAs: 'vm',
  template: '<div class="card"><h2>{{vm.title}}</h2></div>',
}));

// Consumer markup:
//   <my-card title="Account settings"></my-card>
//
// After $compile(host)(scope) + $digest():
//   <my-card title="Account settings">
//     <div class="card"><h2>Account settings</h2></div>
//   </my-card>
```

`controllerAs` exposes the constructed instance on the directive's scope
(or the `scope: true` child scope, when present) under the alias. The
alias resolves through the same `IDENT_RE` shape rule as the
`'Name as alias'` suffix.

### Who creates the scope — the compiler, not `$controller`

A common mental-model slip is to think the controller "owns" a scope it
creates and keeps. The direction is the opposite: **the compiler creates
the scope and hands it *into* `$controller`.** `$controller` never calls
`Scope.create` or `parent.$new()` — it only ever *receives* a scope
through `locals.$scope`.

What triggers scope creation is the `scope` field on a directive's DDO,
read by the compiler during its tree walk:

| DDO `scope` value | What the compiler does |
| --- | --- |
| `false` (default) | No new scope — the element keeps the scope it was linked against. |
| `true` | One child scope per element via `parent.$new()` — prototypally inherits from the parent. |
| `{ … }` (object) | **Rejected** with `IsolateScopeNotSupportedError` (isolate scope lands in a later spec). |

The full per-element flow, from DDO declaration to constructed instance:

```
<div my-directive>          DDO: { scope: true, controller: 'Foo', controllerAs: 'vm' }
       │
       ▼
  $compile walks the element
       │
       ├─ sees  scope: true ───────────►  parent.$new()        ◄── THE NEW SCOPE
       │                                       │                   IS BORN HERE
       │                            stashed on element.$$ngScope
       │                                       │
       ├─ runControllerSeam ───────────►  $controller('Foo', {
       │   (after $transclude setup,            $scope:     <that child scope>,
       │    before this directive's             $element,   $attrs,  $transclude
       │    own pre-link)                     })
       │                                       │
       │                            Object.create(proto) + injector.invoke + return-replace
       │                                       │
       │                            controller body runs  ── EXACTLY ONCE ──
       │                                       │
       │                            controllerAs ⇒  scope['vm'] = instance
       ▼
  pre-link / post-link        (the controller instance already exists)
```

Ownership and lifetime run the other way round from the slip above —
**the scope outlives the controller instance**, not vice-versa:

```
  COMPILER ──creates──►  child scope  ──persists──►  digest after digest …
                              │
                              │  passed in once as locals.$scope
                              ▼
                         $controller  ──invokes once──►  controller instance
                              │                                │
              never creates a scope                attached to the scope
              (only receives one)                  via controllerAs, then idle
```

The controller body is a constructor: it runs **once**, at instantiation,
and is never re-invoked on digest. The scope it was handed keeps running
digests long after. Cleanup is manual — a structural directive that
removes the element MUST call `destroyElementScope(element)` (see the
`@compiler` cleanup contract), or the child scope leaks: it stays wired
into the parent's watcher tree forever.

There is no `ng-controller` built-in directive yet (see
[Intentionally-deferred items](#intentionally-deferred-items)). When it
lands it will be a *thin* directive — `{ restrict: 'A', scope: true,
controller: '@' }` — and the **compiler's existing machinery above** does
all the real work. The directive is a declaration; the compiler is the
engine.

### `controllerAs` without `controller` is REJECTED AT REGISTRATION

The pair must always travel together. A directive that declares
`controllerAs: 'vm'` with no `controller` field is rejected by
`normalizeDirective` at directive-registration time (when the
`<name>Directive` provider's `$get` first runs), throwing
`ControllerAsWithoutControllerError`. The error routes via the existing
factory `try/catch` in `$$buildDirectiveArrayProvider` through
`$exceptionHandler('$compile')` — sibling directives on the same
element still run; only this directive fails to resolve.

```ts
$compileProvider.directive('bad', () => ({ controllerAs: 'vm' }));
// At injector resolution time:
//   $exceptionHandler(ControllerAsWithoutControllerError, '$compile')
```

The registration-time check is deliberate: it catches the misuse before
a page is ever compiled, so the failure surfaces at app boot rather than
the first directive match.

## Direct-call vs. compile-time exception asymmetry

Exception routing differs by call site (FS §2.5 acceptance #4 vs. #5):

- **Direct call** — `$controller('Bad', {})` propagates the throw to the
  caller. NO `$exceptionHandler` interception. The caller owns the
  `try/catch`.
- **Compile-time** — `$compile`'s per-element seam wraps the
  `$controller(...)` call in a `try/catch` that routes throws via
  `invokeExceptionHandler(handler, err, '$compile')` and continues with
  the next directive.

```ts
// Direct-call path — error surfaces to the caller:
try {
  $controller('NotRegistered', {});
} catch (err) {
  // err instanceof UnknownControllerError
}

// Compile-time path — same error routed through $exceptionHandler:
$compileProvider.directive('myDir', () => ({ controller: 'NotRegistered' }));
$compile(element)(scope);
// $exceptionHandler(UnknownControllerError, '$compile')
// pre/post-link on the same element still run; siblings unaffected
```

The asymmetry mirrors AngularJS 1.x exactly. The rationale is the same
both projects landed on: direct callers know their call site and can
wrap appropriately, while the compiler's log-and-continue contract
requires every per-directive failure to route through the centralized
exception handler so the rest of the page still renders.

## Footguns

> **`'hasOwnProperty'` is REJECTED at registration.** Registering a
> controller under the name `'hasOwnProperty'` throws
> `InvalidControllerNameError`. The defensive lookup-time guard in
> `createController` also rejects it even if a back door stashed the
> entry through a `ReadonlyMap`-defeating cast. This is the AngularJS
> prototype-pollution guard — keeping the name reserved prevents an
> attacker from registering a controller whose name shadows the
> `Object.prototype` lookup path.

> **`controllerAs: 'vm'` silently OVERWRITES `$scope.vm`.** If the
> consumer scope already has a `vm` property, the alias bind replaces
> it with the controller instance. No warning, no error. This matches
> AngularJS 1.x. Avoid alias names that collide with scope properties
> set elsewhere — the convention is short, controller-local names like
> `vm`, `ctrl`, or a domain abbreviation.

> **Bare-function controllers without `$inject` throw at instantiation.**
> The project's `$injector.invoke` rejects un-annotated bare functions —
> there is no source-parsing fallback. Use the array-style annotation
> (`['$scope', function ($scope) { ... }]`) or set `$inject` explicitly
> on the function. The same rule applies to inline-function controllers
> passed directly to `$controller(fn, locals)`. Every test in this
> module uses array-style annotation as the canonical minification-safe
> form.

## Intentionally-deferred items

The following AngularJS 1.x controller features are out of scope for
this spec. Each entry names the roadmap item that will revisit it.

- **`require:` — inter-directive controller injection.** A directive
  asking for another directive's controller (including the `^` / `?` /
  `^^` flag combinations). Deferred to the future "Controllers —
  `require:` field" roadmap item. The `$controller` signature today
  returns the bare instance; that signature gets a 4th `later: boolean`
  argument returning `{ instance, identifier }` when `require:` lands —
  additive, no breaking change.
- **`$onInit` / `$onChanges` / `$onDestroy` / `$postLink` — lifecycle
  hooks.** Deferred to the future "Component lifecycle hooks" roadmap
  item. The per-element seam runs the constructor and discards the
  return; hook dispatch is layered on later.
- **`bindToController` — isolate-scope-bound locals.** Depends on
  isolate scope, which is rejected at directive registration today (see
  the "Isolate scope intentionally rejected" invariant in `CLAUDE.md`).
  Lands with the future "Isolate scope" roadmap item.
- **`allowGlobals` (window scanning) — PERMANENTLY OUT.** AngularJS 1.x
  optionally allowed `$controller('Path.To.Ctor', ...)` to walk
  `window.Path.To.Ctor` as a fallback when no registered name matched.
  This project will NOT ship the opt-in on security grounds: it is a
  prototype-pollution vector and a code-splitting hazard. The behavior
  is documented here so future audits don't try to add it.
- **`.controller(name, fn)` module DSL.** The shortcut on
  `createModule(...)` that mirrors `.directive` / `.filter` / `.factory`.
  Deferred to the separate "Module DSL `.directive` / `.component` /
  `.controller`" roadmap item. All registration today goes through
  `$controllerProvider.register(...)` from a `config()` block.
- **`ng-controller` built-in directive.** Lands separately under the
  "Built-in Directives" roadmap item. Apps that want a directive-style
  attach point today write a one-off directive whose `controller` field
  references a registered name.
- **Default ESM binding.** The `interpolate`-style default-binding
  pattern (`export const interpolate = createInterpolate()`) needs a
  sensible default for every dependency. `createController` requires an
  `Injector`, and `@di` does not export a default `injector` singleton
  (`createInjector` is a factory). Rather than fabricate an empty
  `createInjector([])` just to default against, this module exports the
  factory alone. Apps reach the run-phase service through DI; tests
  that want an ESM-first surface call `createController({ injector,
  registry })` against a fake injector — the precedent the unit tests
  in `__tests__/controller.test.ts` follow.

## Where to look next

| Question | File |
| --- | --- |
| How is the alias parser implemented? | `src/controller/controller.ts` (`CONTROLLER_NAME_ALIAS_RE` + `parseControllerName`) |
| How does `$controllerProvider.register` enforce the config-phase guard? | `src/controller/controller-provider.ts` (`$$getPhase` thunk captured from `$provide`) |
| How does the per-element compile seam invoke `$controller`? | `src/compiler/compile.ts` (`runControllerSeam` helper, called from the inline-link path and the post-template-install path) |
| How does `controllerAs` shape validation share the alias regex? | `src/controller/controller.ts` exports `IDENT_RE`; consumed by `normalizeDirective` in `src/compiler/compile-provider.ts` |
| What does each error message say? | `src/controller/controller-errors.ts` — six classes, each with a deterministic message and a runnable `@example` |
