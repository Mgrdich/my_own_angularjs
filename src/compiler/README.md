# `@compiler` — `$compile` service + directive registration

The DOM compiler walks an `Element` (or `NodeList` / `Comment`), matches
directives by element name, attribute, class, or comment, runs each
directive's compile and link functions in the AngularJS-canonical order,
and binds the result to a `Scope`. It is the bridge between templates and
the runtime — every other piece of the framework (scopes, parser, filters,
`$sce`, `$sanitize`, `$exceptionHandler`) finally becomes observable on a
real DOM tree through `$compile`.

Spec 017 ships the **compiler core** — the registration surface, the
walker, the four restrict modes, priority + terminal sorting, the three
linker phases, the `Attributes` class with `$set` / `$observe`, child
scopes (`scope: true`), and a cleanup contract for structural
directives. Spec 018 layers **transclusion** on top — `transclude: true`
and multi-slot forms, the `$transclude` link argument, and the
`ng-transclude` slot marker (the first built-in directive on `ngModule`).
See the [Transclusion](#transclusion) section. Isolate scope, templates,
controllers, and the built-in structural / form directives (`ng-if`,
`ng-repeat`, `ng-bind`, `ng-class`, …) are explicitly deferred — see
[Deferred items](#deferred-items).

## Registering a directive

Registration goes through `$compileProvider.directive(name, factory)` from
inside a `config()` block. The factory is a DI invokable — the array form
is the canonical shape — that returns either a function (sugar for
`{ link: fn, restrict: 'EA' }`) or a Directive Definition Object (DDO).

```ts
import { createModule, createInjector } from 'my-own-angularjs/di';
import { ngModule, Scope } from 'my-own-angularjs/core';

const app = createModule('app', ['ng']).config([
  '$compileProvider',
  ($cp) => {
    $cp.directive('greet', () => ({
      link: (_scope, element, attrs) => {
        element.textContent = `Hello, ${attrs['name']}`;
      },
    }));
  },
]);

const injector = createInjector([ngModule, app]);
const $compile = injector.get('$compile');
const scope = Scope.create();

const node = document.createElement('div');
node.setAttribute('greet', '');
node.setAttribute('name', 'World');

$compile(node)(scope);
// node.textContent === 'Hello, World'
```

The object form `$cp.directive({ a: factoryA, b: factoryB })` registers a
batch — useful when several directives share a single `config` block.
Each entry is validated and registered just like the single-form call.

**Multiple factories under the same name accumulate.** This is unique to
directives — for filters / providers / services the rule is last-wins,
but `directive('foo', factoryA)` followed by `directive('foo', factoryB)`
produces TWO directive objects that BOTH run on `<div foo>` and BOTH
participate in priority sorting independently. `injector.get('fooDirective')`
returns the array.

```ts
$cp.directive('foo', () => ({ link: () => console.log('a') }));
$cp.directive('foo', () => ({ link: () => console.log('b') }));
// $compile(<div foo>)(scope) logs 'b' then 'a'
// (post-link runs in priority-ASCENDING order on the same node;
// equal priorities use registration order so the second-registered
// directive's post-link runs first)
```

## Restrict modes (E / A / C / M)

Each character of `restrict` enables one matching strategy. The default
is `'EA'`. Order in the string is irrelevant; unknown letters are
silently ignored. All four can be combined: `restrict: 'EACM'`.

```ts
// E (Element):  <my-dir></my-dir>
$cp.directive('myDir', () => ({ restrict: 'E', link: () => {} }));

// A (Attribute): <div my-dir></div>
$cp.directive('myDir', () => ({ restrict: 'A', link: () => {} }));

// C (Class):     <div class="my-dir"></div>
//                <div class="my-dir: hello;"></div> → attrs.myDir === 'hello'
$cp.directive('myDir', () => ({ restrict: 'C', link: () => {} }));

// M (Comment):   <!-- directive: my-dir -->
//                <!-- directive: my-dir trailing value -->  → attrs.myDir === 'trailing value'
$cp.directive('myDir', () => ({ restrict: 'M', link: () => {} }));
```

**Naming normalization.** A directive registered as `myDirective` matches
`my-directive`, `data-my-directive`, `x-my-directive`, `my:directive`, and
`my_directive` (and `data-` / `x-` combined with any of those separators).
The matching uses `directiveNormalize`, an exact port of AngularJS 1.x's
algorithm. Use whichever spelling reads best in your DOM source.

## Priority + terminal

All directives matched on a single node sort by descending `priority`
(default 0). Ties break by registration order — the directive registered
first runs first within the same priority bucket.

```ts
$cp.directive('first', () => ({ priority: 100, link: () => console.log('first') }));
$cp.directive('second', () => ({ priority: 50, link: () => console.log('second') }));
// On <div first second>: post-link runs in ASCENDING order, so 'second' logs first.
// Compile and pre-link run in DESCENDING order, so 'first' goes first there.
```

A directive declaring `terminal: true` at priority N stops directives
with priority `< N` on the same node from running. Same-priority
directives still run; child nodes still compile their own directives
normally.

```ts
$cp.directive('term', () => ({ priority: 100, terminal: true, link: () => {} }));
$cp.directive('low', () => ({ priority: 50, link: () => {} }));
// On <div term low>: 'term' runs; 'low' is dropped (priority < 100).
```

## Compile vs link (when to use which)

A directive factory can return any of three shapes; the framework
normalizes them to a single internal `compile(element, attrs) => link`
form before walking. The shapes:

```ts
// 1. Sugar — factory returns a function.
//    Equivalent to { link: fn, restrict: 'EA' }; `fn` is the post-link.
$cp.directive('a', () => (scope, el, attrs) => { /* post-link */ });

// 2. DDO with `link` — function or { pre, post }.
$cp.directive('b', () => ({
  link: (scope, el, attrs) => { /* post-link */ },
}));
$cp.directive('c', () => ({
  link: {
    pre:  (scope, el, attrs) => { /* pre-link */ },
    post: (scope, el, attrs) => { /* post-link */ },
  },
}));

// 3. DDO with `compile` — runs ONCE per template; returns the link fn.
$cp.directive('d', () => ({
  compile: (element, attrs) => {
    element.classList.add('compiled'); // template-time mutation
    return (scope, el, attrs) => { /* post-link */ };
    // …or { pre, post } …or undefined for "no link".
  },
}));
```

**Post-link is what you usually want.** It runs bottom-up after children
link, so child state is already wired when the parent's post-link runs —
exactly when you want to attach event listeners, watches, or `scope.$on`
handlers. Reach for `pre-link` only when the parent must inject state
into the scope BEFORE descendants link. Reach for `compile` only when
the same template-time mutation is shared across many linker invocations
(rare in spec 017 — common only when transclusion ships).

## Transclusion

A directive declaring `transclude` captures the markup the consumer
wrote between its tags at compile time and exposes a `$transclude`
function that clones-and-links that captured master into a slot of the
directive's choosing. This is the AngularJS-canonical mechanism for
writing wrapper directives (`<my-card>...</my-card>`) where the
consumer's children eventually appear inside the directive's chrome but
still bind against the consumer's (OUTER) scope.

Two forms ship in spec 018:

```ts
// Content transclusion — one bucket of children.
$cp.directive('myCollapsible', () => ({
  transclude: true,
  link: (scope, element, _attrs, _ctrls, $transclude) => {
    $transclude((clone) => {
      for (const node of clone) element.appendChild(node);
    });
  },
}));
// <my-collapsible><p>{{outer.title}}</p></my-collapsible>
// The <p> ends up inside <my-collapsible>; {{outer.title}} resolves
// against the OUTER scope (the scope the host was linked against).

// Multi-slot transclusion — children routed by tag-name selector.
$cp.directive('myCard', () => ({
  transclude: {
    titleSlot:    'card-title',
    '?subtitleSlot': 'card-subtitle',  // ? prefix → optional
    bodySlot:     'card-body',
  },
  link: () => { /* …call $transclude(fn, null, slotName) per slot… */ },
}));
// <my-card>
//   <card-title>Hi</card-title>
//   <card-body>Body</card-body>
// </my-card>
// `titleSlot` and `bodySlot` capture their tagged children. The
// `?subtitleSlot` is optional — no error when no <card-subtitle> is
// present. Unmatched element children, text, and comments collect in
// the default slot.
```

**When to choose which.** Use `transclude: true` for "one bucket of
children" — the consumer writes whatever they want and the directive
projects that single bucket. Use the object form when the directive has
named slots that fill distinct places in its chrome (header / body /
footer).

### Multi-slot selector rules

- Each value is a kebab-case tag-name token. The match is
  case-insensitive (jsdom lowercases tag names anyway) and runs after
  `directiveNormalize`, so `<card-title>`, `<CARD-TITLE>`, and
  `<Card-Title>` all match the selector `'card-title'`.
- A leading `?` on the selector marks the slot OPTIONAL — unfilled
  optional slots return `[]` from `$transclude` and `ng-transclude`
  renders its fallback children.
- A REQUIRED slot (no `?` prefix) that the consumer left unfilled
  raises `RequiredTranscludeSlotUnfilledError` once eagerly at link
  time AND again at every `$transclude(fn, null, '<slot>')` call site.
  The directive's link STILL runs so the author can render skeleton
  chrome.
- Two slot keys mapping to the same normalized selector
  (`{ a: 'card-title', b: 'card-title' }`) is rejected at registration
  via `DuplicateTranscludeSelectorError`.

### `ng-transclude` — the slot marker

`<div ng-transclude>` (attribute form) or `<ng-transclude>` (element
form) inside a transcluding directive's manually-inserted template
marks the location where the captured content should be projected.
The marker is a built-in directive registered on `ngModule` — apps that
list `'ng'` in their dependency chain get it for free.

```ts
$cp.directive('myCard', () => ({
  transclude: { titleSlot: 'card-title', bodySlot: 'card-body' },
  link: (scope, element) => {
    const template = document.createElement('section');
    template.innerHTML = `
      <h1 class="title"><div ng-transclude="titleSlot"></div></h1>
      <div class="body"><div ng-transclude="bodySlot"></div></div>
    `;
    element.appendChild(template);
    $compile(template)(scope);
  },
}));
```

- `<div ng-transclude>` / `<ng-transclude>` (no slot name) projects the
  default slot — content transclusion's only bucket, or the multi-slot
  default bucket (unmatched children).
- `<div ng-transclude="titleSlot">` projects the named slot.
- **Fallback content.** Pre-existing children of the marker element act
  as fallback when an OPTIONAL slot is unfilled. The fallback was
  compiled and linked against the OUTER scope by the OUTER walker
  BEFORE `ng-transclude` ran, so `{{outer.x}}` interpolations inside
  fallback resolve correctly. Filled slots REPLACE the fallback;
  unfilled-optional slots keep it.
- Misuse — using `ng-transclude` outside any transcluding directive, or
  asking for a named slot under a `transclude: true` host, routes
  `NgTranscludeMisuseError` via `$exceptionHandler('$compile')`. The
  marker becomes a no-op (pre-existing children remain).

### The outer-scope rule

This is the rule every existing AngularJS tutorial leans on: expressions
inside transcluded content bind to the consumer's scope, NOT the
directive's. Mechanically, the transclusion scope is a CHILD of the
OUTER scope (the scope the directive was linked against), never of the
directive's own `scope: true` child.

```ts
$cp.directive('myCard', () => ({
  transclude: true,
  scope: true, // directive's own child scope for internal state
  link: (scope, element, _attrs, _ctrls, $transclude) => {
    (scope as { localCounter: number }).localCounter = 0; // private
    $transclude((clone) => {
      for (const node of clone) element.appendChild(node);
    });
  },
}));

// Consumer markup:
//   <my-card>
//     <p>{{outerCtrl.title}}</p>
//   </my-card>
//
// `outerCtrl.title` resolves against the OUTER scope where `outerCtrl`
// lives — the `myCard` directive's own `scope: true` child (which holds
// `localCounter`) is NEVER in the prototype chain of the transcluded
// `<p>`'s scope.
```

The implementation seam: `$transclude` is built inside the per-element
linker BEFORE the `scope: true` `$new()` runs, so its closure captures
the OUTER `parentScope`. Every clone's transclusion scope is
`parentScope.$new()` — never `directiveScope.$new()`. See
`src/compiler/compile.ts` for the build site.

### Multi-clone

`$transclude(...)` may be called more than once. Each call produces an
INDEPENDENT clone of the captured master with an independent
transclusion scope. The master fragment itself is never inserted into
the DOM — every projection comes from a deep-clone via
`Node.cloneNode(true)`.

```ts
$cp.directive('triple', () => ({
  transclude: true,
  link: (_scope, element, _attrs, _ctrls, $transclude) => {
    for (let i = 0; i < 3; i++) {
      $transclude((clone) => {
        for (const n of clone) element.appendChild(n);
      });
    }
  },
}));
// Renders the consumer's children three times, each clone bound to its
// own transclusion scope (so per-clone state doesn't leak across).
```

This is the infrastructure the future `ng-repeat` directive will lean
on — re-running `$transclude(...)` once per array item.

### Cleanup contract

Every clone's transclusion scope is pushed onto the host element's
`$$ngCleanupQueue` as `() => scope.$destroy()`. `destroyElementScope(host)`
drains the queue (destroying every clone scope) BEFORE destroying the
host's own `scope: true` child. The OUTER scope's `$destroy()` also
tears down clones via scope-tree propagation — both paths converge.

Future structural directives (`ng-if`, `ng-repeat`, …) MUST call
`destroyElementScope(element)` before removing nodes from the DOM —
the same contract spec 017 established for `scope: true` cleanup.

**Throwing `cloneAttachFn`.** A thrown error from the attach callback is
routed via `$exceptionHandler('$compile')`; the transclusion scope is
STILL created, STILL registered on the cleanup queue, and the clone is
STILL returned from `$transclude(...)`. The directive may inspect the
return value and attach manually if it has a recovery path. Note that
`Node.cloneNode(true)` does not copy event listeners attached via
`addEventListener` — only inline `on*` attributes survive. This
matches AngularJS exactly.

### Error handling

Every transclusion error site routes through `$exceptionHandler` with
cause `'$compile'`. No new `EXCEPTION_HANDLER_CAUSES` entry — the
spec-017 token covers the entire surface. The nine error classes
exported from `@compiler/index`:

| Class | Thrown at | Surface |
| --- | --- | --- |
| `InvalidTranscludeValueError` | Registration | Routed at provider `$get` |
| `ElementTranscludeNotSupportedError` | Registration | Routed at provider `$get` |
| `DuplicateTranscludeSelectorError` | Registration | Routed at provider `$get` |
| `InvalidTranscludeSlotNameError` | Registration | Routed at provider `$get` |
| `InvalidTranscludeSelectorError` | Registration | Routed at provider `$get` |
| `MultipleTranscludeDirectivesError` | Compile pre-pass | Routed at link site |
| `RequiredTranscludeSlotUnfilledError` | Link (eager) + `$transclude` call | Routed twice |
| `UndeclaredTranscludeSlotError` | `$transclude` call + `ng-transclude` link | Routed at call site |
| `NgTranscludeMisuseError` | `ng-transclude` link | Marker becomes no-op |

A custom `$exceptionHandler` that itself throws is caught by spec-014's
`invokeExceptionHandler` recursion guard and falls back to
`console.error` — transclusion does not crash on a misbehaving handler.

### Forward-pointers

The following pieces are deliberately deferred:

- **`transclude: 'element'`** — whole-element transclusion (the
  foundation for `ng-if` / `ng-repeat`) is REJECTED at registration via
  `ElementTranscludeNotSupportedError`. A future structural-directives
  spec will lift the rejection without a silent semantic change.
- **Controllers (the 4th link argument)** — `controllers` is a stable
  `undefined` placeholder today. The "Controllers (`$controller`)"
  roadmap item fills the slot. Directives MUST NOT introspect the 4th
  argument as `undefined` — the public type carries `controllers?: undefined`
  exactly to prevent that.

## Template loading

Spec 019 wires up the AngularJS-canonical template-loading model so
directives can declare their own DOM chrome instead of building it
imperatively inside `link`. Two DDO fields drive the surface:

- `template: string | (element, attrs) => string` — inline template;
  the resolved string is parsed via the HTML5 `<template>`-element
  fragment parser and replaces the host element's children at compile
  time.
- `templateUrl: string | (element, attrs) => string` — async template;
  the URL is passed to `$templateRequest` (which reads from
  `$templateCache` first, falls back to `fetch`, and deduplicates
  concurrent requests). The host's children stay empty until the
  fetch resolves; the public `Linker` signature is unchanged.

`<ng-transclude>` markers inside a template project consumer children
captured by `transclude: true | { … }` — the canonical wrapper
pattern works end-to-end with both inline and async forms. The
transcluded scope binds against the OUTER scope per the spec 018
contract.

```ts
$compileProvider.directive('myCard', () => ({
  restrict: 'E',
  scope: true,
  transclude: true,
  template: '<div class="card"><h2>{{title}}</h2><div ng-transclude></div></div>',
  link: (scope, _el, attrs) => { scope.title = attrs.title; },
}));
```

Full surface — function-form arguments, `$templateCache` seeding,
`$templateRequest` deduplication, async test discipline, the wrapper
pattern with multi-slot transclusion, and the mock-fetcher injection
pattern for tests — lives in
[`src/template/README.md`](../template/README.md). `replace: true` is
REJECTED at registration via `ReplaceTrueNotSupportedError`
(deprecated in AngularJS 1.x; will not ship).

## `Attributes.$set` and `$observe`

Every compiled element has a single `Attributes` instance, shared across
all directives on that node and passed identically to compile, pre-link,
and post-link. It exposes normalized read access plus two methods.

```ts
$cp.directive('myDir', () => ({
  link: (scope, element, attrs) => {
    // Read normalized: <div my-dir data-href="/x"> → attrs.myDir, attrs.href
    const value = attrs['myDir'];
    const original = attrs.$attr['href']; // 'data-href'

    // Mutate + sync DOM + notify observers
    attrs.$set('class', 'highlighted');
    // attrs.class === 'highlighted'; element.className === 'highlighted'

    // Observe (returns a deregistration closure)
    const stop = attrs.$observe('href', (value) => {
      console.log('href is now', value);
    });
    // stop(); // when you're done
  },
}));
```

`$observe` is wired lazily into `$interpolate` — the per-attribute watch
is installed only on the first observer registration, not eagerly for
every element. Subsequent observers on the same attribute reuse the
single watch. For interpolated attributes (`<a href="/users/{{id}}">`)
the observer fires with the resolved value at the end of each digest
where the resolved value changes; for static attributes it fires once
on the next digest with the literal value.

`$set` notifies observers SYNCHRONOUSLY when called outside a digest and
asynchronously (via `$evalAsync`) when called inside one — same pattern
AngularJS uses to avoid mid-digest re-entrancy.

## Why raw DOM `Element` instead of jqLite

The link signature is `(scope, element, attrs)` where `element` is a
native `Element` — or `Comment` for an M-restricted match. There is no
jqLite shim in spec 017; use the standard DOM API directly:

```ts
element.textContent = 'hi';
element.classList.add('foo');
element.setAttribute('data-x', '1');
element.addEventListener('click', handler);
```

This is a deliberate choice: jqLite-style sugar (`.text()`, `.addClass()`,
`.on()`, `.find()`, `.parent()`) ships nothing the native API doesn't
already do, and the type system enforces correctness when you stick to
the real `Element` surface. A future `angular.element` compat layer
(Phase 5 roadmap) may layer on top **without changing the link signature**
— directives written today against raw `Element` will continue to work
unchanged when that layer ships.

## Element cleanup contract

A directive declaring `scope: true` causes the compiler to create a
**single child scope per element** via `parentScope.$new()`. All
directives on that element receive the same child scope; descendants
with `scope: false` share it; descendants with `scope: true` create
another nested child off it.

The compiler stashes the child scope on the element (non-enumerable
`element.$$ngScope`) and exposes a tiny cleanup API:

```ts
import {
  setElementScope,
  getElementScope,
  addElementCleanup,
  destroyElementScope,
} from 'my-own-angularjs/compiler';
```

**Future structural directives (`ng-if`, `ng-repeat`, …) MUST call
`destroyElementScope(element)` before removing nodes from the DOM.** The
helper recurses depth-first through descendants, runs each element's
cleanup queue in insertion order, then calls `$destroy()` on its stored
scope. Without that call, scopes from removed subtrees stay attached to
the parent's watcher tree forever. The compiler does not auto-detect
removals (no `MutationObserver`) — the contract is explicit so structural
directives can sequence the work around their own animations / queries.

## Error handling

A throwing directive factory, `compile` function, pre-link, post-link,
or `$set`-driven `$observe` callback is caught and reported via
`$exceptionHandler` with cause `'$compile'` (the 10th entry in
`EXCEPTION_HANDLER_CAUSES`). Sibling directives, sibling nodes, and
ancestor traversal all continue per the AngularJS-canonical "log and
continue" contract — a single broken directive never crashes the
walker. The default handler is `console.error`; apps override it via
`module.factory('$exceptionHandler', […])` or `module.decorator(…)`.

Programmer errors raised by `$compileProvider.directive(name, factory)`
itself (`InvalidDirectiveNameError` for malformed names,
`InvalidDirectiveFactoryError` for falsy factories) stay synchronous —
they surface to the caller in the offending `config()` block, NOT
through `$exceptionHandler`, because the offending code is the
registration call itself. `IsolateScopeNotSupportedError` is the
exception to that rule: it fires lazily at first directive lookup
(matches AngularJS where DDO validation runs at compile time, not at
registration), so it routes through `$exceptionHandler('$compile')` like
any other compile-time error.

## Deferred items

Spec 017 deliberately stops at the compiler core. The following are
explicit roadmap items that future specs will deliver — they are
**accepted at registration time without throwing** (forward-compat) but
do not produce observable behavior in this spec:

- **Isolate scope** (`scope: { foo: '=' }`, `scope: { bar: '<' }`,
  `'@'`, `'&'`) — REJECTED at lookup time with
  `IsolateScopeNotSupportedError`. Substantial complexity warranting its
  own spec.
- **Transclusion** (`transclude: true`, multi-slot, `$transclude`,
  `<ng-transclude>`) shipped with spec 018 — see the
  [Transclusion](#transclusion) section above. `transclude: 'element'`
  (the whole-element form, foundation for structural directives) is
  REJECTED at registration via `ElementTranscludeNotSupportedError`.
- **Template loading** (`template`, `templateUrl`,
  `<script type="text/ng-template">`) — `template` (inline string or
  function) and `templateUrl` (async string or function) shipped with
  spec 019; see [Template loading](#template-loading) below and the
  full [`src/template/README.md`](../template/README.md) for the
  worked example. `replace: true` is REJECTED at registration via
  `ReplaceTrueNotSupportedError` (deprecated in AngularJS 1.x; will
  not ship). `<script type="text/ng-template">` lands with the
  Built-in Directives roadmap bullet.
- **Controllers** (`controller`, `controllerAs`, `bindToController`,
  `require`, `$controller` service, `$controllerProvider`) — separate
  roadmap bullet.
- **Built-in directives** — `ng-if`, `ng-repeat`, `ng-class`, `ng-show`,
  `ng-hide`, `ng-bind`, `ng-bind-html`, `ng-click`, `ng-model`, `ng-href`,
  `ng-src`, `ng-srcset`, and the rest. None ship with spec 017; user
  code registers its own directives inline.
- **Multi-element directives** (`multiElement: true`, `*-start` /
  `*-end` pairs) — deferred; lands alongside `ng-repeat`.
- **Module DSL `.directive(...)` shorthand** on `createModule` —
  registration in spec 017 is config-block-only via
  `$compileProvider.directive`. The `module.directive` shorthand is a
  separate roadmap bullet.
- **`$compileProvider` toggles** — `commentDirectivesEnabled`,
  `cssClassDirectivesEnabled`, `aHrefSanitizationTrustedUrlList`,
  `imgSrcSanitizationTrustedUrlList`, `debugInfoEnabled`. Comment and
  class directives are always on in spec 017; the URL-sanitization
  toggles config the future `a` / `ng-href` / `ng-src` directives.
- **String-input compilation** — `$compile('<my-dir></my-dir>')` is NOT
  supported. Callers parse strings to DOM nodes themselves
  (`new DOMParser().parseFromString(...)` or a `<template>` element).
- **jqLite (`angular.element`)** — a Phase 5 compatibility-layer concern
  that will layer on top of the existing link signature without
  changing it.
- **`$rootScope` registration on `ngModule`** — separate roadmap bullet
  under "Application Bootstrap". Spec 017 tests construct
  `Scope.create()` directly.
- **`ng-bind-html` directive integration** — explicitly deferred under
  the HTML Sanitization roadmap pending `$compile`. Spec 017 delivers
  the compiler pieces; the directive itself ships separately.
