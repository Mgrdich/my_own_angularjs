# DOM compiler ($compile)

## Purpose

`$compile` is the central orchestrator. `$compile(element)` walks the DOM once,
collects the directives that match each node, runs their compile functions, and
returns a `Linker` — a function `link(scope)` that wires the compiled template to a
live scope. Linking is three-phase: parent pre-link, recursive child link, then
child-to-parent post-link. Along the way the linker pulls in nearly every other
service: `$controller` (the controller seam), `$interpolate` (text- and
attribute-`{{ }}`), `$sce` (URL trusted contexts), `$templateRequest` (`templateUrl`),
the isolate-binding wiring, the lifecycle hooks, and `$exceptionHandler` (cause
`'$compile'`) as the common error sink. `$compileProvider.directive(name, factory)` /
`.component(name, def)` are the config-phase registration surface.

## Collaborators & call order

### 1 — compile: walk, collect, sort, compile

```text
  $compile(element)
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ compileNode(node)  — recursive descent, runs ONCE per node    │
  │                                                              │
  │   Element/Comment ─▶ collect directives                      │
  │     · attribute / element / class / comment matches          │
  │       resolved via <name>Directive providers (lazy $get) ────┼─▶ see injector-and-modules.md
  │     · sort by priority (desc), then registration order       │
  │     · terminal: true → cut off lower-priority same-element    │
  │       directives (transclude !== undefined survives — 032)    │
  │                                                              │
  │   per-element pre-pass (in this order):                      │
  │     a. transclude capture (content / slots / 'element')      │
  │          'element' → swap host for <!-- name: attr --> Comment│
  │     b. template / templateUrl install                        │
  │          templateUrl ──$templateRequest(url)──────────────────┼─▶ see template-loading.md
  │          (async drain after the sync walk returns)           │
  │     c. run each matched directive's compile(el, attrs)       │
  │                                                              │
  │   Text node ─▶ compileTextNode                               │
  │     {{ }} present? interpolate(text, true) ──────────────────┼─▶ see interpolate.md
  │     (no {{ }} → no-op linker, zero watches)                  │
  │                                                              │
  │   directive factory throw / template error                  │
  │     ──route (cause '$compile')──────────────────────────────┼─▶ see exception-handler.md
  └───────────────────────────────────┬──────────────────────────┘
                                       │ returns Linker
                                       ▼
                                  link(scope)
```

### 2 — link: three-phase wiring against a scope

```text
  link(scope)   — per element bearing matched directives
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ scope selection                                              │
  │   scope: true  → scope.$new()      (child scope)             │
  │   scope: {…}   → scope.$new(true)  (isolate; host stashed) ──┼─▶ see scope-and-digest.md
  │                                                              │
  │ controller seam — runControllerSeam (per `controller` DDO)  │
  │   $controller(name, locals, ident, later:true) ─────────────┼─▶ see controller.md
  │     → stash in $$ngControllers                              │
  │     → resolve `require` (^ / ^^ / ? ancestor walk)          │
  │     → wireIsolateBindings: = / @ / < / & onto target        │
  │         @ interpolates against parent scope ────────────────┼─▶ see interpolate.md
  │     → publish controllerAs alias on (isolate) scope         │
  │                                                              │
  │ attribute interpolation (eager, link-time)                  │
  │   bindAttrsToScope: one shared watch per {{ }} attribute     │
  │     a[href]/img[src] → $interpolate URL trusted context ────┼─▶ see sce.md
  │                                                              │
  │ ── PRE-LINK  (parent → child)  ────────────────────────────  │
  │      directive.link.pre / $onInit                           │
  │ ── child recursion: link each child node ─────────────────  │
  │ ── POST-LINK (child → parent)  ────────────────────────────  │
  │      directive.link.post / $postLink                        │
  │                                                              │
  │   transclusion: $transclude(cloneScope, attachFn) deep-      │
  │     clones the captured master + re-links the clone         │
  │                                                              │
  │   any phase throws ──route (cause '$compile')───────────────┼─▶ see exception-handler.md
  │   $onDestroy fires on scope teardown                        │
  └──────────────────────────────────────────────────────────────┘
```

Collaborators: **`$controller`** (the per-element controller seam, driven via the
`later: true` deferred-alias path so `require` and `bindToController` run first),
**`$interpolate`** (every `{{ }}` in text nodes and attribute values — the eager
link-time attribute pass installs one shared watch per dynamic attribute),
**`$sce`** (interpolated `a`/`area[href]` and `img[src]` route through `$interpolate`'s
URL trusted context, and the compiler-level `$$sanitizeUri` neutralizes dangerous
schemes by default), **`$templateRequest`** (resolves `templateUrl` directives, with
inline `<script type="text/ng-template">` pre-seeding the cache for zero-network
resolution), and **`$exceptionHandler`** (the `'$compile'` cause token sinks directive
factory, compile, pre-link, post-link, controller-seam, template, and isolate-binding
throws so a single bad directive never crashes the walk). The fifty-one-plus built-in
directives register on `ngModule` and are reached through this same walk.

## Using it the primary way

The ESM-first API is `createCompile({ … })`, which wires the collaborators
(`$controller`, `interpolate`, `$sce`, `$templateRequest`, `$exceptionHandler`, the
directive registry) into a `$compile` function. Like `$controller`, there is no
default singleton — the factory needs its collaborators, so it ships factory-only and
is normally consumed through DI. `$CompileProvider` (the config-phase registration
shim) is exported from `my-own-angularjs/compiler` but stays out of the root barrel.

```typescript
import { createCompile } from 'my-own-angularjs/compiler';

// In practice the collaborators come from the injector; createCompile is the seam.
const $compile = createCompile({
  /* directives registry, $controller, interpolate, $sce, $templateRequest,
     $exceptionHandler, $$sanitizeUri, config flags … */
} as never);

const linker = $compile(document.querySelector('#app')!);
linker(scope); // wire the compiled template to a live scope
```

## Using it the dependency-injection way

The normal path. Directives and components register in a `config` block (or via the
`module.directive(...)` / `module.component(...)` DSL sugar — `.directive`
ACCUMULATES per name, unlike last-wins services), then `$compile` is resolved through
the injector at run time.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', [])
  // DSL sugar → forwards to $compileProvider.directive (accumulates per name):
  .directive('myWidget', [
    () => ({
      restrict: 'E',
      scope: { title: '@' },
      template: '<h1>{{ title }}</h1>',
    }),
  ])
  // Component shorthand → translated to an isolate-scope directive:
  .component('myCard', { bindings: { item: '<' }, template: '<div>{{ $ctrl.item }}</div>' });

const injector = createInjector(['ng', 'app']);
const $compile = injector.get('$compile');

const linker = $compile(document.querySelector('#app')!);
linker(injector.get('$rootScope') /* once bootstrap lands */);
```

`$compileProvider`'s six config getter/setters (`aHrefSanitizationTrustedUrlList`,
`imgSrcSanitizationTrustedUrlList`, `commentDirectivesEnabled`,
`cssClassDirectivesEnabled`, `strictComponentBindingsEnabled`, `debugInfoEnabled`) are
frozen at `$get` — mutating a value after the config phase has no effect.

## Related diagrams

- [Built-in directives](./built-in-directives.md) — the fifty-plus `ng` directives, all instances of this same walk/link mechanism
- [Controllers ($controller / $controllerProvider)](./controller.md) — the per-element controller seam, driven via the `later: true` deferred-alias path
- [String & template interpolation](./interpolate.md) — text-node and attribute `{{ }}` compile through `$interpolate`
- [Strict Contextual Escaping ($sce)](./sce.md) — interpolated `href` / `src` route through `$interpolate`'s URL trusted context
- [Template loading ($templateCache / $templateRequest)](./template-loading.md) — `templateUrl` directives resolve their markup through `$templateRequest`
- [Scopes & digest cycle](./scope-and-digest.md) — `scope: true` / `scope: {…}` child and isolate scopes, and where binding watches run
- [Injector & module system](./injector-and-modules.md) — how `$compileProvider` registers directives via `<name>Directive` providers
- [Centralized exception handling](./exception-handler.md) — every compile / link / controller / template throw routes here (cause `'$compile'`)
- [Diagram index](./README.md)
