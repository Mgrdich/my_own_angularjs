# `@bootstrap` — application start entry points

Starting an app built on this framework is a one-liner. The `@bootstrap`
module ships three entry points — pick the one that fits your situation —
plus the synchronous error classes and a typed result handle. See
`CLAUDE.md` for the module surface and invariants.

| Entry point                          | Page? | Returns                                  | Use when                                  |
| ------------------------------------ | ----- | ---------------------------------------- | ----------------------------------------- |
| `bootstrapInjector(modules, config?)`| no    | `Injector`                               | tests, SSR, CLI tools, learning exercises |
| `bootstrap(element, modules, config?)`| yes  | `{ injector, rootScope, rootElement }`   | starting an app on a real page element    |
| `autoBootstrap(root?, config?)`      | yes   | `void`                                   | migrating classic `ng-app` markup         |

All three prepend the framework's own `ng` module for you — `$sce`,
`$interpolate`, the built-in filters, `$compile`, `$rootScope`, etc. resolve
out of the box. You never list `'ng'` yourself.

## The three entry points

### `bootstrapInjector` — headless

Builds the injector from your modules and returns a typed handle. No page is
required, accessed, or modified. Because there is no DOM involved, this path
is deliberately free of any `@compiler` import, so DOM-less consumers don't
pull in `$compile`.

```ts
import { bootstrapInjector, createModule } from 'my-own-angularjs';

const appModule = createModule('app', []).value('apiUrl', '/api');

const injector = bootstrapInjector([appModule]);
injector.get('$sce'); // framework built-in, narrowed
injector.get('apiUrl'); // '/api', narrowed
```

### `bootstrap` — page start

Prepares the host element and everything inside it, connects it to a fresh
root context, performs the first compile + digest so the markup is live the
moment the call returns, and hands back a bundled handle. The startup order is
fixed (AngularJS parity): guard → normalize modules → build injector (seeding
`$rootElement`) → resolve `$rootScope` → stamp the bootstrap marker → first
`$compile(element)($rootScope)` inside one `$apply` → return.

```ts
import { bootstrap, createModule, type Scope } from 'my-own-angularjs';

const appModule = createModule('app', []).run([
  '$rootScope',
  ($rootScope: Scope) => {
    ($rootScope as unknown as { name: string }).name = 'World';
  },
]);

const el = document.createElement('div');
el.innerHTML = '<p>Hello {{name}}</p>';

const { injector, rootScope, rootElement } = bootstrap(el, [appModule]);
el.textContent; // 'Hello World' — already rendered
rootScope === injector.get('$rootScope'); // true
rootElement === el; // true
```

### `autoBootstrap` — opt-in `ng-app` scan

Scans a region of the page for the FIRST element (in document order) bearing
one of the four `ng-app` attribute spellings, reads the attribute value as the
module name, and delegates to `bootstrap`. It is **opt-in**: nothing happens
until you call it. It is a silent no-op when no marker matches and when there
is no page at all (`document` is undefined in a non-browser environment).

```ts
import { autoBootstrap, createModule, type Scope } from 'my-own-angularjs';

// index.html: <div ng-app="myApp"><p>Hello {{name}}</p></div>
createModule('myApp', []).run([
  '$rootScope',
  ($rootScope: Scope) => {
    ($rootScope as unknown as { name: string }).name = 'World';
  },
]);

autoBootstrap(); // finds the marker, starts 'myApp', renders "Hello World"
```

## The four `ng-app` spellings

`autoBootstrap` recognizes the common historical spellings so existing markup
migrates without edits — probed in this order, first present attribute wins:

| Spelling       | Example markup                  |
| -------------- | ------------------------------- |
| `ng-app`       | `<div ng-app="myApp">`          |
| `data-ng-app`  | `<div data-ng-app="myApp">`     |
| `ng:app`       | `<div ng:app="myApp">`          |
| `x-ng-app`     | `<div x-ng-app="myApp">`        |

Attribute forms only — the legacy class-based form (`class="ng-app"`) is
intentionally NOT supported, matching modern AngularJS. An empty value (e.g.
`ng-app=""`) starts the app with just the framework modules. When more than
one marker is present, the first in document order wins and the rest are
ignored; an `ng-app` nested inside an already-started region hits the
double-bootstrap guard and throws `AlreadyBootstrappedError` (intended, not
suppressed).

## Intentional parity deviations (FS §2.8)

These differ from classic AngularJS on purpose — they are expected behavior,
not parity bugs:

- **Strict wiring ON by default.** `strictDi` defaults to `true` here (classic
  AngularJS defaults it OFF). This project's injector is strict by
  construction — `createInjector` rejects un-annotated factories via
  `annotate`, and there is no source-parsing fallback. The flag is therefore
  **parity-only**: passing `strictDi: false` is a no-op relax — it does NOT
  re-enable a lenient mode, because none exists. The flag is threaded purely
  for API / roadmap parity with `angular.bootstrap(..., { strictDi })`.
- **Richer page-start result.** `bootstrap` returns
  `{ injector, rootScope, rootElement }` — the service handle, the root
  context, and the started element — whereas classic AngularJS returns only
  the injector. This avoids hidden global state: hold the handle, no global
  lookup required.
- **No automatic attachment to the page element.** The framework attaches none
  of its bookkeeping to the started element by default. Attaching the
  `$injector` (the classic `element.data('$injector', …)` behavior) is opt-in
  via `config.attachToElement: true`. Because of this, the "already started"
  guard recognizes a prior start through the framework's own private
  `$$ngBootstrapped` marker — NOT through an attached injector.
- **Automatic start is opt-in.** The `ng-app` scan runs only when you call
  `autoBootstrap()`, whereas classic AngularJS scans the page automatically on
  library load.

## Clear, synchronous failures

When a start cannot proceed, the framework throws a clear, descriptive error
**directly to the caller** at the call site — never swallowed, never routed
through `$exceptionHandler` (these are programmer errors; the
`EXCEPTION_HANDLER_CAUSES` tuple stays at 10). Narrow with `instanceof` rather
than string-matching the message.

| Condition                              | Throws                          |
| -------------------------------------- | ------------------------------- |
| `element` is `null` / `undefined`      | `BootstrapTargetMissingError`   |
| `element` already started              | `AlreadyBootstrappedError`      |
| string module name never registered    | `Error: Module not found: <name>` (reused from `getModule`) |

```ts
import { bootstrap, AlreadyBootstrappedError, BootstrapTargetMissingError } from 'my-own-angularjs';

try {
  bootstrap(document.querySelector('#missing'), [appModule]);
} catch (err) {
  if (err instanceof BootstrapTargetMissingError) {
    // no host node to start on
  }
}

bootstrap(el, [appModule]);
try {
  bootstrap(el, [appModule]); // same element again
} catch (err) {
  if (err instanceof AlreadyBootstrappedError) {
    // the first, already-running start keeps working
  }
}
```

## Typed result

The handle is typed against the modules you pass — `injector.get(name)`
narrows for any service registered by your object modules or by the framework,
with no manual cast. The machinery reuses `MergeRegistries` from `@di`.
String-name module entries resolve at runtime but contribute only the
framework base registry to the static type (there is no value to read their
registry from at compile time), so they fall through to the dynamic escape
hatch.
