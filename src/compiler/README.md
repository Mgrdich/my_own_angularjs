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

## Isolate scope & components (spec 022)

Spec 022 lights up the second half of "Directives & DOM Compilation":
isolate scope with declarative bindings, controller-instance binding
routing, the four lifecycle hooks, controller `require`, and the
`$compileProvider.component(name, definition)` shorthand.

### The four binding kinds

| Symbol | Name | Wiring strategy | Feeds `$onChanges`? |
| --- | --- | --- | --- |
| `=` | Two-way | `parent → local` watch + reverse `local → parent` watch with last-digest-value reconciliation; non-assignable parent expressions silently degrade to one-way | no |
| `@` | One-way text | `$interpolate(attrValue, true)` evaluated against the PARENT scope, watch installed on the isolate scope | yes |
| `<` | One-way | Single `parentScope.$watch` writes to the target; initial seed at link time | yes |
| `&` | Expression / callback | Target receives `(locals?) => parentScope.$eval(expr, locals)` | no |

Modifiers — `?` makes a missing attribute leave the local undefined
(no error); a trailing identifier (`'<sourceAttr'`) aliases the source
attribute against `attrs['sourceAttr']`. Malformed binding-spec strings
throw `InvalidIsolateBindingError` at directive registration. Two
object-form-scope directives on the same element trip
`MultipleIsolateScopeError` at link time — both routed via
`$exceptionHandler('$compile')`.

`@` binding interpolates against the PARENT scope (not the isolate)
so consumer markup like `<my-dir title="{{outerName}}">` resolves
`outerName` in the outer namespace. This is the AngularJS-canonical
behaviour — a naive `attrs.$observe` against the isolate scope would
leave `outerName` undefined.

### `bindToController`

`bindToController: true` reuses the binding map declared via
`scope: { … }` but writes the bindings onto the controller INSTANCE
instead of onto the isolate scope. The `controllerAs` alias is published
on the isolate scope AFTER bindings populate, so the template's
`$ctrl.foo` reads land on the post-binding instance.

`bindToController: { … }` takes its binding map directly from the
field — no `scope: { … }` declaration is needed. UNLIKE the
`scope: { … }` declaration, this form does NOT request creation of an
isolate scope on its own — the directive consumes whatever scope the
element already has. As a consequence, a `bindToController:{}`-only
directive does NOT trigger `MultipleIsolateScopeError` when it shares
an element with a `scope: { … }` directive.

### Lifecycle hooks

A controller may implement any of `$onInit`, `$onChanges(changes)`,
`$onDestroy()`, `$postLink()`. Each hook is an opt-in
`typeof ctrl.$onX === 'function'` check — a hookless controller is
identical to spec 020's behaviour.

The canonical per-element ordering (pinned by a shared-spy ordering
test):

```
construct → stash in $$ngControllers → resolve require → wire bindings →
publish alias → $onInit → preLink → child link → postLink →
$postLink → $onDestroy
```

`$onChanges` fires for `<` and `@` bindings only — never `=` or `&`.
The initial synchronous call at link time delivers all `<`/`@`
bindings as first-change records; subsequent changes batch through a
per-digest `$$postDigest` flush. `previousValue` on the initial fire
is the frozen `UNINITIALIZED_VALUE` sentinel; consumers gate on
`isFirstChange()` instead of reading `previousValue`.

### `require`

```ts
$cp.directive('child', () => ({
  require: '^parent',                       // string form
  link: (_s, _e, _a, parentCtrl) => { /*…*/ },
}));

$cp.directive('child', () => ({
  require: ['parent', '^^outer'],           // array form
  link: (_s, _e, _a, [pCtrl, oCtrl]) => { /*…*/ },
}));

$cp.component('childCmp', {
  require: { parent: '^parentCmp' },        // object form auto-assigns
  controller: [function () {
    this.$onInit = function () {
      // `this.parent` is populated BEFORE $onInit runs.
    };
  }],
});
```

Flag semantics (order-tolerant):

- *no prefix* — own element only.
- `^` — own element, then walk `parentElement` chain.
- `^^` — `parentElement` chain only (skip own element).
- `?` — optional. A miss yields `null` instead of throwing
  `MissingRequiredControllerError`.

Resolution reads from a per-element non-enumerable
`$$ngControllers: Map<string, unknown>` planted by the controller seam
— no `MutationObserver` or DOM query. Object-form `require` is the ONLY
shape that auto-assigns onto the requiring controller's instance
before `$onInit`; string and array forms deliver controllers exclusively
via the link fn's 4th argument.

### `$compileProvider.component(name, definition)`

A component is a directive with a fixed shape. The provider translates
the {@link ComponentDefinition} into a directive factory returning a
DDO with the AngularJS 1.5+ canonical defaults:

| Default | Value |
| --- | --- |
| `restrict` | `'E'` (element only) |
| `scope` | `definition.bindings ?? {}` (always object-form → isolate scope, possibly empty) |
| `bindToController` | `true` |
| `controller` | `definition.controller ?? [function NoopController() {}]` (array-wrapped to satisfy strict `annotate`) |
| `controllerAs` | `definition.controllerAs ?? '$ctrl'` |
| `template` / `templateUrl` / `transclude` / `require` | pass-through |

The empty `NoopController` keeps stack traces clean; the array wrap is
the canonical zero-dep shape used everywhere else in the suite.
`.component` is single-name only — no bulk-map form. Name and
plain-object validation runs SYNCHRONOUSLY at registration via
`InvalidComponentDefinitionError` (matches `.directive`'s precedent);
downstream directive-normalize errors (`InvalidIsolateBindingError`,
…) still route lazily via `$exceptionHandler('$compile')` at provider
`$get` time.

### Worked example — `userCard`

```ts
import { createModule, createInjector } from 'my-own-angularjs/di';
import { ngModule, Scope } from 'my-own-angularjs/core';

const app = createModule('app', ['ng']).component('userCard', {
  bindings: { user: '<', onSelect: '&' },
  controller: ['$element', function ($element) {
    this.$onInit = () => {
      // `this.user` is populated BEFORE $onInit runs (bindToController + `<`).
      $element.setAttribute('aria-label', `Card for ${this.user.name}`);
    };
    this.pick = () => this.onSelect({ id: this.user.id });
  }],
  // Note: ng-click is deferred to the "Built-in Directives" spec.
  // Today we install the listener manually inside the controller.
  template: '<div class="card">{{ $ctrl.user.name }}</div>',
});

const injector = createInjector([ngModule, app]);
const $compile = injector.get('$compile');
const scope = Scope.create<{ pickedId?: string; me?: { id: string; name: string } }>();
scope.me = { id: 'u-1', name: 'Alice' };

const root = document.createElement('user-card');
root.setAttribute('user', 'me');
root.setAttribute('on-select', 'pickedId = id');

$compile(root)(scope);
scope.$digest();
// root.innerHTML === '<div class="card">Alice</div>'
// Calling root.querySelector('div')! and invoking $ctrl.pick() from the
// controller assigns scope.pickedId = 'u-1'.
```

For the full surface (deferred upstream cases, parity with
`componentSpec.js`, etc.) see
`src/compiler/__tests__/spec022-parity.test.ts`.

## Visibility & Binding built-ins (spec 023)

Spec 023 ships the first cohesive batch of `ngModule`-registered
built-in directives — the visibility and binding directives every
non-trivial AngularJS app reaches for. All seven are registered on
the `'ng'` module's existing `$compileProvider` config block (the same
one spec 018 introduced for `ngTransclude`); apps that declare
`'ng'` in their dependency chain get them for free. Each is also a
plain `module.directive('<name>', …)` away from being overridden or
decorated by an app — these are built-ins, not hardcoded behavior.

The directives ship as DI registrations only — there are NO new
exports from `@compiler/index`. The factory functions are file-local
exports (matches the spec 018 `ngTransclude` precedent), reachable
exclusively via `injector.get('<name>Directive')`.

### `ng-cloak`

Prevents the brief flash of un-compiled `{{ … }}` markup before
`$compile` reaches the element. A pure compile-time cleanup
directive: it removes both the `ng-cloak` attribute and the
`ng-cloak` class once the compiler touches the element, then
disappears. No watchers installed, zero per-digest cost.
`restrict: 'AC'` so consumers may write `<div ng-cloak>` (attribute)
or `<div class="ng-cloak">` (class) interchangeably. Canonical use:
wrap the page root or any `{{ … }}`-heavy region whose unrendered
form must not be visible to users.

### `ng-bind`

Single-expression text binding. `<span ng-bind="user.name">` sets
the element's `textContent` from the current value of the expression
and updates on every digest when the value changes. Coerces via
`String(value)`; `null` / `undefined` render as the empty string.
The `textContent` setter escapes HTML special characters
automatically — `<` and `>` appear LITERALLY in the rendered DOM,
which is the security-relevant difference from `ng-bind-html`.
Canonical use: bind a single scope value as text without writing an
inline `{{ }}` mustache that might briefly be visible.

### `ng-bind-template`

Multi-expression text binding via `$interpolate`.
`<span ng-bind-template="Hello {{first}} {{last}}!">` interpolates
the template string once at link time, then watches the resulting
`InterpolateFn` so the rendered `textContent` updates whenever any
referenced expression changes. Like `ng-bind`, the listener writes
to `textContent` so HTML characters are escaped automatically.
Canonical use: bind a multi-expression message as text without
writing inline mustaches.

### `ng-bind-html`

Trusted HTML binding. `<div ng-bind-html="snippet">` evaluates the
expression, routes the value through `$sce.getTrustedHtml(…)` (the
existing spec 012 SCE pipeline), and assigns the result to the
element's `innerHTML`. A `$sce.trustAsHtml(…)` wrapper short-circuits
sanitization; a plain string routes through the spec 013 `$sce` →
`$sanitize` fallback (when `ngSanitize` is loaded) or throws inside
the watch listener (when it isn't). A throw is caught by the
digest's existing `'watchListener'` path and `innerHTML` degrades
to empty — the digest continues. Canonical use: render markup
verified safe by the SCE pipeline; never use for plain text (use
`ng-bind` instead).

### `ng-show`

Visibility toggle on truthiness. `<div ng-show="visible">` adds the
`ng-hide` CSS class when the expression is FALSY and removes it
when TRUTHY. A single `scope.$watch(expr, …)` per element drives
the toggle via `classList.toggle('ng-hide', !value)`. Other classes
on the element are preserved across digests — `classList.toggle`
only touches the named class. Canonical use: hide a panel,
modal, or block conditional on application state.

### `ng-hide`

Mirror-inverse of `ng-show`. `<div ng-hide="hidden">` adds the
`ng-hide` class when the expression is TRUTHY and removes it when
FALSY. Both directives share the same `ng-hide` class name — the
canonical AngularJS idiom. Canonical use: same as `ng-show` but
the predicate reads more naturally as "is this thing hidden?"
(e.g. `<div ng-hide="!user.loggedIn">` vs `<div ng-show="user.loggedIn">`).

### `ng-non-bindable`

Opts a subtree out of compilation. `<pre ng-non-bindable>{{ literal }}</pre>`
preserves literal `{{ }}` mustaches in child text nodes and prevents
the walker from descending into the element's children at all —
no `$interpolate`, no directive matching on descendants. The
directive itself is pure metadata (`restrict: 'AC'`, `terminal: true`,
`priority: 1000`, no compile / link function); the heavy lifting
lives in the compiler walker hook (see "Terminal directives" below).
The host element's OWN attributes (`class="foo"`, …) survive
intact — only the children are pruned. Canonical use: documentation
pages, code samples, developer-tools panels that display
AngularJS-style markup as literal characters.

### Consumer-shipped CSS

`ng-show`, `ng-hide`, and `ng-cloak` rely on a small CSS block that
the framework documents but does NOT auto-inject (auto-injection
would violate the no-runtime-DOM-injection invariant). Apps drop
this verbatim into their stylesheet:

```css
.ng-hide { display: none !important; }
[ng-cloak], .ng-cloak { display: none !important; }
```

The `.ng-hide` rule is shared by `ng-show` and `ng-hide`. The
`[ng-cloak], .ng-cloak` rule hides un-compiled regions before
`$compile` strips the attribute / class.

### Animation-deferred note

Visibility transitions in spec 023 are synchronous. `$animate.enter`
and `$animate.leave` hooks integrate with `ng-show`, `ng-hide`, and
`ng-cloak` in Phase 4 (Animations roadmap item). The directive
link functions do NOT contain animation hooks today; the parity
tests pin the synchronous behavior and mark the animated variants
as `it.skip(…)` citing Phase 4.

### Spec 013 cross-reference

`ng-bind-html` consumes the existing `$sce.getTrustedHtml` pipeline
(spec 012) which transparently routes through `$sanitize` when
`ngSanitize` is loaded (spec 013 integration). The directive does
not re-implement sanitization. Apps that need a custom HTML
allow-list swap implementations via `module.decorator('$sanitize', …)`
— the swap is invisible to the `ng-bind-html` directive, which
keeps consuming the public `$sce.getTrustedHtml` surface.

## Class & Style built-ins (spec 024)

Spec 024 ships the second cohesive batch of `ngModule`-registered
built-in directives — the class and style directives every styled
AngularJS app reaches for. All four are registered on the `'ng'`
module's existing `$compileProvider` config block (the same one
that holds the spec 023 directives); apps that declare `'ng'` in
their dependency chain get them for free. Each is also a plain
`module.directive('<name>', …)` away from being overridden or
decorated by an app — these are built-ins, not hardcoded behavior.

Like the spec 023 directives, the four ship as DI registrations
only — there are NO new exports from `@compiler/index`. The
factory functions are file-local exports (matches the spec 018
`ngTransclude` precedent), reachable exclusively via
`injector.get('<name>Directive')`.

### `ng-class`

Dynamic CSS-class binding. `<div ng-class="expr">` evaluates the
expression and applies the resulting class set to the element via
`element.classList.add` / `.remove`. Three expression forms are
supported, normalized by the shared module-private
`flattenClassExpression` helper:

- **String** — `ng-class="'highlighted'"` adds the class
  `highlighted`. Multiple whitespace-separated names
  (`'class1 class2'`) add each as a separate class.
- **Array** — `ng-class="['selected', 'primary']"` adds each
  element. Array elements that are themselves plain objects follow
  the object form; string elements follow the string form. Other
  element types are silently ignored.
- **Object** — `ng-class="{ active: cond, error: hasFault }"` adds
  each key whose value is truthy and removes each key whose value
  is falsy.

A single `scope.$watchCollection(attrs.ngClass, …)` per element
drives the diff cycle. `$watchCollection` provides one-level-deep
collection diffing so `arr.push('new-class')` mutations and
`obj.active = false` flips are caught without the consumer
re-assigning the whole value. Canonical use: toggle conditional
styling (selected state, error state, …) without writing
imperative DOM code.

### `ng-class-even`

Index-gated class binding. `<li ng-class-even="expr">` evaluates
the expression using the same three forms as `ng-class`, but only
APPLIES the resulting classes when the scope's `$even` property is
truthy. The canonical pairing is with `ng-repeat` (which sets
`$even` / `$odd` on each iteration's child scope), but `ng-class-even`
works against any scope where the developer sets `$even` directly —
which is how spec 024 tests it today, before `ng-repeat` lands.
Outside `ng-repeat` (no `$even` on the scope) the directive
contributes no classes and never throws.

### `ng-class-odd`

Mirror-inverse of `ng-class-even`. `<li ng-class-odd="expr">` gates
on the scope's `$odd` property. The two directives combine on the
same element to produce zebra-stripe styling
(`<li ng-class-even="'row-even'" ng-class-odd="'row-odd'">`); each
iteration carries exactly one of the two classes.

### `ng-style`

Dynamic inline-style binding. `<div ng-style="{ color: 'red',
fontSize: '14px' }">` evaluates the expression and applies the
resulting `{ cssProperty: value }` pairs as inline styles via per-
property writes (NOT `cssText`). Only the object form is supported
— other shapes (string, array, primitive, `null`, `undefined`)
resolve to the empty property set, which clears any directive-applied
styles and writes nothing new. A single `scope.$watchCollection`
per element drives the diff cycle.

### Classes-preserved guarantee

`ng-class` tracks `appliedClasses: Set<string>` per directive
instance — the set of classes THIS directive has added on the most
recent digest. The diff cycle has two halves:

1. **Removal half:** iterate `appliedClasses`; for each class no
   longer in the new target set, call `element.classList.remove(cls)`.
2. **Addition half:** iterate the new target set; for each class
   not in `appliedClasses`, call `element.classList.add(cls)`.
   Classes already in both are untouched.

The key invariant: a class enters `appliedClasses` only when WE
called `add()`. Consumer-shipped classes — `<div class="card"
ng-class="…">`, classes added by `ng-show` / `ng-hide`
(`classList.toggle('ng-hide', …)`), classes added by app code
through `attrs.$set('class', …)` — are NEVER in our tracking set,
so the removal half can never touch them. `ng-class` plays nicely
with every other directive on the same element.

`ng-style` applies the mirror mechanism via `appliedProps:
Set<string>` — only properties THIS directive has written are
eligible for removal. A consumer-shipped `<div style="margin: 5px"
ng-style="…">` keeps the `margin` across digests unless `ng-style`
later names `margin` in its expression — at which point the
directive overwrites it and the property becomes directive-owned
(the AngularJS-canonical "ng-style wins" behavior).

### `ng-style` property-name convention

`ng-style` dispatches on hyphen-presence: kebab-case keys
(`'background-color'`) go through CSSOM's `setProperty` /
`removeProperty`; camelCase keys (`'backgroundColor'`) go through
direct IDL assignment (`element.style[name] = value`). Both forms
work. Neither path uses `cssText`, so consumer-shipped inline
styles (set via the `style="…"` attribute) are preserved unless
`ng-style`'s expression names the same property — in which case
`ng-style` wins (the "ownership transfer" described above).

The dispatch is necessary because CSSOM's `setProperty` is
specified to accept ONLY kebab-case property names per W3C;
`setProperty('fontSize', '14px')` is a spec-defined no-op (and
jsdom enforces this strictly). The IDL surface is the opposite —
`style.fontSize = '14px'` works, `style['font-size'] = '14px'` is
undefined behavior. Together the two surfaces cover every property
name a consumer can spell. The hyphen-presence test
(`name.includes('-')`) is a complete classifier: every CSS
property is either kebab-case (contains a hyphen) or camelCase
(contains no hyphen).

### Animation-deferred note

Class and style transitions in spec 024 are synchronous.
`$animate.addClass` / `$animate.removeClass` hooks integrate with
`ng-class` (and `$animate.setStyles` with `ng-style`) in Phase 4
(Animations roadmap item). The directive link functions do NOT
contain animation hooks today; the parity tests pin the
synchronous behavior and mark the animated variants as
`it.skip(…)` citing Phase 4.

### Spec 023 cross-reference

`ng-class` / `ng-class-even` / `ng-class-odd` and spec 023's
`ng-show` / `ng-hide` share the same underlying `classList` DOM
surface — `add` / `remove` for spec 024, `toggle` for spec 023.
Both batches preserve unrelated classes on the element across
every digest (the same single-class-name discipline that lets
`ng-show` and `ng-class` co-exist without stepping on each other).
The `ng-hide` class added by `ng-show` / `ng-hide` is never in any
`ng-class` instance's `appliedClasses`, so flipping `ng-class`
will not strip `ng-hide`, and vice versa.

### Terminal directives

Spec 017 implemented `terminal: true` as a same-element directive
cutoff (lower-priority directives on the same element are skipped).
Spec 023 Slice 1 broadened this to also halt child-node recursion
in the compiler walker — but ONLY when the matched directive's
normalized name is `ngNonBindable`. This narrowing is deliberate:
the spec 017 test `src/compiler/__tests__/terminal.test.ts:178`
pinned the original narrower semantic for custom `terminal: true`
directives, and broadening the no-descent behavior for all consumers
would be a breaking change. Future structural directives (`ng-if`,
`ng-repeat`, etc.) will get the no-descent semantic via dedicated
mechanisms (e.g. `transclude: 'element'`), NOT via the broadened
`terminal` flag. The walker hook lives in
`src/compiler/compile.ts` in `compileElementOrComment` — search for
`hasNonBindableTerminal`.

## Attribute helper built-ins (spec 025)

Spec 025 ships the third cohesive batch of `ngModule`-registered
built-in directives — eight directives that drive the element's
standard HTML attributes (URLs, image sources, boolean flags). All
eight are registered on the `'ng'` module's existing
`$compileProvider` config block (the same one that holds the spec
023 / 024 directives); apps that declare `'ng'` in their dependency
chain get them for free. Each is also a plain
`module.directive('<name>', …)` away from being overridden or
decorated — these are built-ins, not hardcoded behavior.

Like the spec 023 / 024 directives, the eight ship as DI
registrations only — there are NO new exports from
`@compiler/index`. The factory functions are file-local exports
(matches the spec 018 `ngTransclude` precedent), reachable
exclusively via `injector.get('<name>Directive')`. Both module-
private factory helpers (`createUrlAliasDirective`,
`createBooleanAliasDirective`) live inside
`src/compiler/ng-attribute-aliases.ts` and are NOT exported from
`@compiler/index` either.

### Why these directives exist — the browser pre-compile bug

Without `ng-href`, a browser would let users click
`<a href="{{userProfileUrl}}">` BEFORE AngularJS compiles the
template and navigate to the literal URL `"{{userProfileUrl}}"`.
Without `ng-disabled`, `<button disabled="{{ false }}">` is still
disabled because HTML5 boolean attributes work by presence, not
value. These eight directives fix both bugs.

Mechanically the fix is the same on both sides: the consumer writes
the `ng`-prefixed attribute on the element instead of the real
attribute, and the framework writes the real attribute LATER —
during the first digest, AFTER the interpolation / expression has
resolved. The browser never sees a literal `{{ … }}` URL to follow
and never sees a stale `disabled="…"` to obey.

### URL / value aliases — `ng-href`, `ng-src`, `ng-srcset`

The first pattern handles attributes that the BROWSER eagerly
resolves the moment it sees them — URLs and image sources.

```html
<a   ng-href="{{userProfileUrl}}">View profile</a>
<img ng-src="{{photoUrl}}" alt="profile photo">
<img ng-srcset="{{photoSet}}" alt="responsive photo">
```

Each directive calls `attrs.$observe(ngAttrName, listener)` against
its own `ng`-prefixed attribute. Spec 017's `$observe` lazily wires a
single `scope.$watch` on the interpolated value; the listener writes
the resolved string to the corresponding real attribute (`href` /
`src` / `srcset`) through `attrs.$set`. Before the first digest the
real attribute is absent — a click on `<a ng-href="{{url}}">` BEFORE
compile-then-digest goes nowhere instead of navigating to the literal
URL `"{{url}}"`. The "pre-compile attribute absent" guarantee falls
out of the framework's normal compile-then-digest ordering — no
explicit pre-compile work is needed.

### Boolean aliases — `ng-disabled`, `ng-checked`, `ng-readonly`, `ng-selected`, `ng-open`

The second pattern handles HTML5 BOOLEAN attributes — attributes the
browser interprets by presence, not value (`<button disabled="false">`
is still a disabled button).

```html
<button   ng-disabled="!form.$valid">Submit</button>
<input    type="checkbox" ng-checked="settings.notifications">
<input    ng-readonly="record.locked">
<option   value="b" ng-selected="choice === 'b'">B</option>
<details  ng-open="section === 'about'"><summary>…</summary></details>
```

Each directive calls `scope.$watch(attrs[ngAttrName], listener)`
against the bound expression — there's no `{{ }}` resolution step on
this side, so `$observe` would be wrong. The listener flips the
real attribute's presence through `attrs.$set` per the truthiness of
the watched value. The corresponding DOM property
(`element.disabled`, `element.checked`, …) stays in sync
automatically — browsers reflect the boolean attribute through the
property getter.

### Shared factory pattern

Both halves are generated by two module-private factory helpers
parameterized by attribute name:

```ts
// All three URL aliases.
const ngHrefDirective   = createUrlAliasDirective('href');
const ngSrcDirective    = createUrlAliasDirective('src');
const ngSrcsetDirective = createUrlAliasDirective('srcset');

// All five boolean aliases.
const ngDisabledDirective = createBooleanAliasDirective('disabled');
const ngCheckedDirective  = createBooleanAliasDirective('checked');
const ngReadonlyDirective = createBooleanAliasDirective('readonly');
const ngSelectedDirective = createBooleanAliasDirective('selected');
const ngOpenDirective     = createBooleanAliasDirective('open');
```

This mirrors AngularJS-1.x's `ngAttributeAliasDirectives` pattern —
one file, two `forEach`-style generators, eight outputs.

### The `attrs.$set` contract — important

Both helpers map their resolved value through `attrs.$set(name, value)`.
The `$set` function (from spec 017) accepts `string | null` and
removes the attribute ONLY when `value === null` — NOT for any falsy
value. An empty string `''` is treated as a valid attribute value:
`setAttribute(name, '')` produces the bare-presence form
`<button disabled>` (equivalent to `disabled=""` per HTML5).

Each helper maps its operand to `string | null` explicitly:

- **URL aliases** map empty / undefined to `null` via
  `value !== undefined && value !== '' ? value : null`. The
  functional-spec criterion "empty interpolated value → attribute
  removed" holds because the helper itself collapses the empty
  string to `null` before calling `$set`. A naive
  `attrs.$set(domAttr, value || '')` would WRITE the empty string
  and leave a useless `href=""` on the element.
- **Boolean aliases** map `value ? '' : null`. Truthy values write
  the empty string (canonical bare-presence form per HTML5); falsy
  values write `null` (which `$set` translates to
  `removeAttribute`). Passing `!!value` (a boolean) would be both a
  type error and behaviorally wrong — `setAttribute(name, true)`
  would coerce to the literal string `"true"`, producing the
  cosmetic noise `<button disabled="true">`.

Any future directive that writes attributes through `$set` must
observe this contract. Search for `$set` in
`src/compiler/attributes.ts` for the underlying implementation
(the `value === null` branch around line 273).

### Priority

URL aliases use `priority: 99`; boolean aliases use `priority: 100`
— one notch higher. Both are LOAD-BEARING for AngularJS-1.x parity
if a consumer combines these with other prioritized directives.
Both sit well above the default 0 and below `ng-non-bindable`
(1000), so the spec 017–024 directives have no priority conflict
with this batch.

### Cross-references

`attrs.$observe` and `attrs.$set` are the underlying mechanisms
(see [`Attributes.$set` and `$observe`](#attributessset-and-observe)
above). The URL aliases lean on `$observe` (interpolated values
need a per-attribute watch); the boolean aliases lean on
`scope.$watch` directly (the bound expression isn't an
interpolation). No new framework primitives, no new error classes,
no new `EXCEPTION_HANDLER_CAUSES` token — the tuple stays at 10.
URL allowlisting (the AngularJS `aHrefSanitizationTrustedUrlList`
surface) is explicitly out of scope; this batch sets URLs that the
consumer asks for and the browser's URL parser handles them.

## Event built-ins (spec 026)

Spec 026 ships the fourth cohesive batch of `ngModule`-registered
built-in directives — eighteen directives that let scope expressions
respond to native DOM events. All eighteen are registered on the
`'ng'` module's existing `$compileProvider` config block (the same
one that holds the spec 023 / 024 / 025 directives); apps that
declare `'ng'` in their dependency chain get them for free. Each is
also a plain `module.directive('<name>', …)` away from being
overridden or decorated by an app — these are built-ins, not
hardcoded behavior.

Like the spec 023 / 024 / 025 directives, the eighteen ship as DI
registrations only — there are NO new exports from `@compiler/index`.
The factory functions are file-local exports in
`src/compiler/ng-event-directives.ts`, reachable exclusively via
`injector.get('<name>Directive')`. The module-private factory helper
`createEventDirective`, the `EVENT_NAMES` tuple, and the `EventName`
union are NOT exported either.

### The eighteen directives by family

| Family | Directives |
| --- | --- |
| **Mouse** | `ng-click`, `ng-dblclick`, `ng-mousedown`, `ng-mouseup`, `ng-mouseover`, `ng-mouseout`, `ng-mousemove`, `ng-mouseenter`, `ng-mouseleave` |
| **Keyboard** | `ng-keydown`, `ng-keyup`, `ng-keypress` |
| **Clipboard** | `ng-copy`, `ng-cut`, `ng-paste` |
| **Focus** | `ng-focus`, `ng-blur` |
| **Form-lifecycle** | `ng-submit` |

### The single shared pattern

Every directive in this batch is a clone of the same mechanical
contract — only the target DOM event name and the canonical host
element differ. The factory helper `createEventDirective(eventName)`
emits the same shape eighteen times:

```ts
$compileProvider.directive('ngClick',     ngClickDirective);
$compileProvider.directive('ngDblclick',  ngDblclickDirective);
// … sixteen more, all generated by `createEventDirective('<name>')` …
$compileProvider.directive('ngSubmit',    ngSubmitDirective);
```

At link time each directive:

1. Parses the bound scope expression ONCE via
   `parse(attrs[ngAttrName])` (during the compile phase — the link fn
   closes over the parsed callable).
2. Registers a native event listener through
   `element.addEventListener(eventName, handler)`.
3. Inside the handler, builds a runner
   `() => parsed(scope, { $event: event })` and dispatches via
   `scope.$apply(run)` OR `scope.$evalAsync(run)` per the
   `$$phase`-aware rule below.
4. Registers a `scope.$on('$destroy', …)` listener that removes the
   native event listener when the scope tears down.

```html
<button ng-click="save(item, $event)">Save</button>
<input  ng-keydown="onKey($event)">
<form   ng-submit="submit(formData)">…</form>
```

### `$$phase`-aware dispatch

A native event can fire while a digest is already in flight — for
example one `ng-click` handler synthetically dispatches another
event that triggers a second `ng-click`. A naive `scope.$apply(run)`
in that scenario would throw the canonical
`'$digest already in progress'` error.

The shared handler short-circuits this via the framework's
`scope.$$phase` property:

```ts
if (scope.$$phase !== null) {
  scope.$evalAsync(run); // nested-event path — enqueue, don't re-enter
} else {
  scope.$apply(run);     // common path — run + digest
}
```

`$evalAsync` queues `run` onto the digest's outstanding async list;
the active outer `$apply` will drain the queue before returning, so
the inner expression's scope mutations are still observable after
the outer dispatch returns. This is AngularJS-canonical.

### The `$event` local

The native event object is exposed inside the bound expression as
`$event`. It is passed via the parser's locals object (the second
argument to the parsed function), so the parser's identifier
resolution looks it up there BEFORE the scope (spec 009). As a
consequence, `$event` shadows any scope property of the same name
for the duration of the single invocation — and is NOT assigned to
the scope.

```html
<input ng-keydown="lastKey = $event.key">
<button ng-click="$event.target.value = 'changed'">…</button>
```

Inside `<input ng-keydown="lastKey = $event.key">` the parser
resolves `$event` from locals; `$event.key` then walks the native
event object's `.key` property; `lastKey = …` writes the result onto
the scope.

### The `try/catch` workaround for `$apply` exception routing

**Important.** This project's `scope.$apply` lacks the upstream
AngularJS try/catch — a throw inside the runner escapes `$apply`
without reaching `$exceptionHandler`. The event directives
compensate by wrapping their own `$apply`/`$evalAsync` dispatch in a
`try/catch` and routing throws via
`invokeExceptionHandler(handler, err, 'eventListener')`. Any future
directive that calls `scope.$apply` directly must observe the same
workaround until `$apply` is patched (out of scope for spec 026;
reserved for a future scope-bug spec).

The factory signature was widened to inject `$exceptionHandler` via
DI — the array form `['$exceptionHandler', factory]` is the same
shape spec 018's `ngTransclude` uses for the same reason. Without
this wrap, a bug in the bound expression would propagate out of
`dispatchEvent` instead of landing on the framework's configured
handler.

### `ng-submit` does NOT auto-`preventDefault`

A `<form ng-submit="…" action="…">` with an action URL will still
navigate the page on submit unless the bound expression calls
`$event.preventDefault()`. The directive does NOT call
`event.preventDefault()` for the consumer. This is the
AngularJS-canonical behavior and is explicitly carved out-of-scope
by the functional spec (FS §3).

Two canonical mitigation patterns:

```html
<!-- Pattern 1: omit `action` so the browser has nothing to navigate to. -->
<form ng-submit="save(formData)">
  <input type="text" ng-model="formData.name">
  <button type="submit">Save</button>
</form>

<!-- Pattern 2: call $event.preventDefault() explicitly. -->
<form ng-submit="save(formData); $event.preventDefault()" action="/submit">
  <input type="text" ng-model="formData.name">
  <button type="submit">Save</button>
</form>
```

### The `EventName` type-safety pattern

The `EVENT_NAMES` tuple at the top of
`src/compiler/ng-event-directives.ts` is declared as:

```ts
const EVENT_NAMES = [
  'click', 'dblclick', /* … */ 'submit',
] as const satisfies readonly (keyof HTMLElementEventMap)[];

type EventName = (typeof EVENT_NAMES)[number];
```

The `as const` narrows the array to a readonly tuple of string
literals; the `satisfies` constraint enforces that every entry is a
real DOM event name. Together they form the **compile-time typo
guard** — a future maintainer who tries to add `'clikc'` to the list
gets `Type '"clikc"' is not assignable to type 'keyof HTMLElementEventMap'.`
A future spec adding a new event directive extends the tuple; the
`EventName` union narrows automatically and the 18+N
`createEventDirective('…')` call sites pass type-checked literals
without manual juggling.

### Cleanup contract

Each link fn registers `scope.$on('$destroy', () => element.removeEventListener(eventName, handler))`.
Without this hook, an element still in the DOM after its scope was
destroyed would continue firing handlers against a dead scope — a
leak and a correctness bug. The same hook covers both the explicit
`scope.$destroy()` path and the `destroyElementScope(element)`
propagation path (structural directives — `ng-if`, `ng-repeat` —
will lean on this in future specs).

### Cross-reference to spec 017's compile-then-link timing

The event listener is registered at **link time**, not compile time
— `addEventListener` runs from inside the link fn the compile fn
returns. So multiple `$compile(template)(scope)` invocations against
the same compiled subtree each register their own independent
listener bound to their own scope. This is consistent with the rest
of the framework's link-time work (watch installation, `$observe`
wiring, child-scope creation) and matters when a directive uses
`compile(...)` to share a parsed expression across multiple linker
invocations — the parse runs once but each linker gets its own
event listener.

### Test-bootstrap quirk

Re-registering `$exceptionHandler` on a local `createModule('ng', [])`
is silently shadowed by the canonical `ngModule` (loaded first in
the dependency walk), so the spy never reaches the directive's
`try/catch`. Tests that need a spy `$exceptionHandler` should
register it on a downstream module (e.g. `'app'`) instead — the
last-wins rule for service factories means the `'app'` factory
overrides the canonical `ng` factory. The spec-026 test file
(`src/compiler/__tests__/ng-event-directives.test.ts`) demonstrates
this pattern.

### No new `EXCEPTION_HANDLER_CAUSES` entry

Every event-directive error site routes through `$exceptionHandler`
with cause `'eventListener'` (the existing 6th token, originally
introduced for scope `$emit` / `$broadcast` listeners — its
semantics extend naturally to native DOM event listeners). Parse-
time errors (syntactically invalid bound expression) still route
through `'$compile'` via the existing factory `try/catch` in
`$$buildDirectiveArrayProvider`. `EXCEPTION_HANDLER_CAUSES.length`
stays at 10.

## Structural directives (spec 027)

Spec 027 ships the **structural / flow-control** batch — seven
directives that mount, swap, and tear down DOM subtrees based on
scope state. All seven are registered on the `'ng'` module's
existing `$compileProvider` config block (the same one that holds
the spec 023 / 024 / 025 / 026 directives); apps that declare
`'ng'` in their dependency chain get them for free. Each is also a
plain `module.directive('<name>', …)` away from being overridden or
decorated — these are built-ins, not hardcoded behavior.

Like the prior `ngModule`-registered batches, the seven ship as DI
registrations only — there are NO new exports from
`@compiler/index`. The factory functions are file-local exports
in `src/compiler/ng-init.ts`, `src/compiler/ng-if.ts`,
`src/compiler/ng-controller.ts`, `src/compiler/ng-switch.ts`, and
`src/compiler/ng-include.ts`, reachable exclusively via
`injector.get('<name>Directive')`.

### The seven directives

| Directive | Priority | Restrict | Purpose |
| --- | --- | --- | --- |
| `ng-init` | 450 | `AC` | Evaluate an assignment expression ONCE pre-link to seed scope state. |
| `ng-if` | 600 | `A` | Render the marked subtree only while an expression is truthy. |
| `ng-controller` | 500 | `A` | Attach a registered controller (by name) to a subtree. |
| `ng-switch` | 1200 | `EA` | Pick at most one child subtree based on the stringified value of an expression. |
| `ng-switch-when` | 1200 | `EA` | Sibling-rendered candidate inside an `ng-switch`. Inert without a parent. |
| `ng-switch-default` | 1200 | `EA` | Fallback inside `ng-switch` when no `ng-switch-when` matches. |
| `ng-include` | 400 | `ECA` | Fetch a template by URL and render it inline. |

`ng-if`, the two `ng-switch` helpers, and `ng-include` all declare
`transclude: 'element'` — the load-bearing foundation Slice 2
introduced. `ng-controller` and `ng-init` do not — they are
non-structural and operate on the host element directly.

### The `transclude: 'element'` foundation

Before spec 027, `transclude: 'element'` was REJECTED at registration
via `ElementTranscludeNotSupportedError`. Slice 2 deleted that
rejection branch in
[`src/compiler/compile-provider.ts`](compile-provider.ts) and lit up
a third `NormalizedTransclude` discriminant (alongside `'content'`
and `'slots'`):

```ts
| { kind: 'element'; slots: NormalizedTranscludeSlot[]; required: string[]; optional: string[] }
```

The slot arrays stay empty — `kind: 'element'` reuses the existing
default-bucket linker from spec 018 with a single-element bucket
`defaultBucket: [host]`.

**Comment-placeholder DOM model.** When the compiler encounters a
directive with `transclude: 'element'`, the capture pass in
[`src/compiler/transclude-capture.ts`](transclude-capture.ts):

1. Builds `placeholder = document.createComment(\` ${directiveName}: ${attrValue} \`)` (AngularJS-canonical leading/trailing spaces).
2. `host.parentNode.insertBefore(placeholder, host)`.
3. `host.parentNode.removeChild(host)` — the host element is fully detached from the live DOM.
4. Returns the captured master with `defaultBucket: [host]` — the detached host is the master fragment that subsequent `$transclude(...)` calls deep-clone.

The matched directive's `link` fn then receives the placeholder
Comment as its `element` argument (typed `Element` on the public
surface, but a `Comment` at runtime — directives verify with the
`isComment(element)` guard from `node-guards.ts` and throw on
mismatch rather than casting blindly, see `ng-if.ts` for the
pattern) and a callable `$transclude` as its 5th argument.

**Deep-clone + re-link mechanic.** Each `$transclude(cloneAttachFn)`
call invokes `Node.cloneNode(true)` on the master host element,
creates a fresh transclusion scope as a child of the OUTER scope
(the scope the directive was linked against, not whatever scope the
host was originally compiled in — preserved from spec 018), and
re-links the clone through the cloneMap indirection. Multiple
`$transclude(...)` calls produce independent clones with
independent scopes; the spec-018 multi-clone contract is preserved
unchanged.

**Single-element default-bucket reuse.** Because the bucket is
`[host]`, the existing default-bucket linker handles element-form
transclusion without a new branch — the linker walks a single
top-level node, no slot routing, exactly the behavior the
spec-018 default bucket already provided for content transclusion.

**Re-entrancy guard via `$$ngElementTranscluded`.** A non-enumerable
stamp on the master host prevents the inner `compileBuckets([host])`
from re-firing capture on the same host. Without it, recompiling
the master would infinite-loop. The recompile pass also strips
`transclude` from the directive's normalized form so the second
walk treats the host as a plain element. The `terminal` flag is
intentionally NOT stripped — `ng-if` retains its `terminal: true`
on recompile so the same-element terminal cutoff fires both
passes. (A known consequence: `<div ng-if="show" ng-controller="…">`
silently drops `ng-controller` from the recompile pass. See the
"Known gap" callout below.)

### The `runControllerSeam` widening

`ng-controller` declares NO `link` fn. Instead, it sets the
normalized `controller` field on the DDO to a sentinel:

```ts
controller: { __attributeSource: 'ngController' }
```

Spec 027 Slice 4 widened
[`runControllerSeam`](compile.ts) in `src/compiler/compile.ts` with
a third dispatch branch — keyed on the sentinel shape detected via
the file-local `isAttributeSourceController` type guard. When the
seam encounters this shape, it reads the controller name from
`attrs[__attributeSource]` (= `attrs.ngController`) at LINK time
and invokes `$controller(attrs.ngController, locals)` — no separate
`ident` arg, `$controller`'s own `parseControllerName` handles the
`'Name as alias'` syntax inside the attribute value.

The two existing branches stay unchanged:

1. **`bindToController: {…}` deferred-alias path** — uses
   `$controller(name, locals, ident, /* later */ true)` to defer
   the alias publication until after `require` resolution and
   binding wiring.
2. **Eager path** — `$controller(directive.controller, locals)` for
   directives with a non-sentinel controller (a function /
   array-form / class reference).

The widening is **non-invasive** — for non-sentinel directives, the
new resolution step (`resolvedControllerArg = directive.controller`)
is a no-op; the seam's downstream code paths are byte-identical to
their pre-spec-027 behavior. The `Directive.controller` field's
type union widened to
`ControllerInvokable | { __attributeSource: string }` to keep the
sentinel from leaking into the rest of the compiler.

```ts
// src/compiler/ng-controller.ts (paraphrased)
function ngControllerFactory(): DirectiveFactoryReturn {
  return {
    restrict: 'A',
    priority: 500,
    scope: true,
    controller: { __attributeSource: 'ngController' },
  };
}
```

No `link` fn. The seam handles instantiation, lifecycle hook
ordering (`$onInit` → preLink → child link → postLink → `$postLink`),
`$$ngControllers` stash, `require` resolution, and the `controllerAs`
alias publication via the existing spec 022 machinery. `$onChanges`
does NOT fire on `ng-controller`-attached controllers (there are no
isolate bindings to record change records from — matches AngularJS).

### The lazy `$sce` probe in `ng-include`

`ng-include` declares its DI dependencies as
`['$templateRequest', '$compile', '$injector', '$exceptionHandler', factory]`
— note `'$injector'`, not `'$sce'`. The trust check is gated on a
runtime lookup:

```ts
const trustedSrc = $injector.has('$sce')
  ? $injector.get('$sce').getTrustedResourceUrl(rawSrc)
  : rawSrc;
```

This mirrors the spec-013 `$SceProvider.$get` lazy `$sanitize`
lookup pattern: `$sce` is registered on `ngModule` so it is always
reachable when `ngInclude` is, but a stripped-down injector
lacking `$sce` (hypothetical SSR / Node environment) still
resolves `ngInclude` and treats URLs as pass-through. The factory
declares no hard dependency on `$sce`, so removing `$sce` from a
custom injector does not break `ng-include` registration.

When `$sce` IS reachable, cross-origin URLs that fail the
trusted-resource-URL safelist throw from inside
`getTrustedResourceUrl`. The throw is caught and routed via
`$exceptionHandler('$compile')`; the `$includeContentError` event
is emitted, and the slot is cleared.

### Two structural directives on the same element

The "two `transclude: 'element'` directives on the same host" rule
reuses **`MultipleTranscludeDirectivesError`** from spec 018 — no
new error class, no new cause token. When the capture pass in
[`src/compiler/transclude-capture.ts`](transclude-capture.ts)
detects two element-form transcludes on the same element
(`<div ng-if="a" ng-include="'…'">`), it throws
`MultipleTranscludeDirectivesError` routed via
`$exceptionHandler('$compile')` at compile time.

**Known gap.** Spec-017's same-element terminal cutoff in
[`src/compiler/directive-collector.ts`](directive-collector.ts)
fires BEFORE spec-018's transclude detection. So two structural
directives on the same element where one is `terminal: true` (like
`ng-if` at priority 600) silently drops the lower-priority one
instead of producing the documented `MultipleTranscludeDirectivesError`.
The canonical FS §2.6 example `<div ng-if="show" ng-controller="…">`
is therefore non-functional as-written — `ng-controller` is dropped
by the cutoff. The supported pattern is to NEST `ng-controller`
inside `ng-if`'s subtree:

```html
<div ng-if="show">
  <div ng-controller="MyCtrl as vm">
    {{ vm.greeting }}
  </div>
</div>
```

A future spec slice should re-order the passes to detect the
multi-structural conflict before the terminal cutoff fires.

### `ElementTranscludeNotSupportedError` deprecation grace

The class itself stays exported from `@compiler/index` and the root
barrel for a one-release deprecation grace period so consumers
catching it via `instanceof ElementTranscludeNotSupportedError`
keep compiling without a sudden `ReferenceError`. The two
re-export sites carry inline
`eslint-disable @typescript-eslint/no-deprecated -- one-release grace period for spec 027`
justifications. This matches the spec-022
`IsolateScopeNotSupportedError` retirement precedent. A future
spec may remove the class outright. Use
`MultipleTranscludeDirectivesError` for two-structural-on-same-element
conflicts; `transclude: 'element'` itself is now a supported value,
not an error case.

### Cleanup contract — `addElementCleanup(placeholder, …)`

Each of the three structural directives (`ng-if`, the `ng-switch`
children, `ng-include`) MUST register a cleanup callback against
its placeholder Comment on every successful `$transclude(...)`
install. Comment nodes have no `children` HTMLCollection for
`destroyElementScope` to walk, so a parent `destroyElementScope`
reaching the placeholder cannot tear the active clone down unless
the directive itself registered the callback. The callback closes
over the closure-local clone / scope refs so it always tears down
the currently-active clone (not whatever was active when the
registration ran).

`addElementCleanup` was widened in Slice 2 to accept
`Element | Comment` directly — no cast needed at the call site.

### Errors and cause tokens

No new error classes. No new `EXCEPTION_HANDLER_CAUSES` token. The
tuple stays at 10. Every error site reuses existing surfaces:

- **Fetch failure inside `ng-include`** — `$templateRequest`
  rejection (404, network failure, SCE-rejection on
  `getTrustedResourceUrl` throw) routes via
  `$exceptionHandler('$compile')`. The slot is cleared and
  `$includeContentError` is emitted.
- **Orphaned `ng-switch-when` / `ng-switch-default`** —
  `MissingRequiredControllerError` via the spec-022 Slice-4
  `require: '^ngSwitch'` resolver, routed by the per-element
  controller seam through `$exceptionHandler('$compile')`.
- **Unknown `ng-controller` name** — `UnknownControllerError` from
  the seam's `$controller(name, locals)` invocation, routed via
  `$exceptionHandler('$compile')` through the existing factory
  `try/catch`.
- **Two structural directives on the same element** —
  `MultipleTranscludeDirectivesError` from spec 018, routed via
  `$exceptionHandler('$compile')` at compile time.
- **Throwing `$watch` listeners** (`ng-if`'s expression watcher,
  `ng-switch`'s parent watcher, `ng-include`'s URL watcher) route
  via the digest's existing `'watchListener'` cause.

## List iteration directive (spec 028)

Spec 028 ships **`ng-repeat`** — the list-iteration directive that
renders one copy of its host element per item in the bound
collection. Like the spec 023 / 024 / 025 / 026 / 027 batches it is
registered on the `'ng'` module's existing `$compileProvider` config
block and ships DI-only (no `@compiler/index` factory export). The
factory function lives in [`src/compiler/ng-repeat.ts`](ng-repeat.ts)
and is reachable as `injector.get('ngRepeatDirective')` whenever an
app declares `'ng'` in its dependency chain. Apps swap or wrap it
via `module.decorator('ngRepeatDirective', …)` and
`module.directive('ngRepeat', …)` like any other DI-registered
directive.

### The `transclude: 'element'` reuse from spec 027

`ng-repeat` is a straightforward consumer of the foundation
introduced in spec 027 Slice 2. At compile time the host element
is detached and replaced by a
`<!-- ngRepeat: ITERATOR -->` Comment placeholder; each item then
gets a fresh deep-clone of the captured master, re-linked against
its own per-item child scope and inserted in document order after
the placeholder. No widening of `NormalizedTransclude`, no changes
to [`src/compiler/transclude-capture.ts`](transclude-capture.ts),
no new placeholder mechanics. The DDO is plain:

```ts
{
  restrict: 'A',
  priority: 1000,
  terminal: true,
  transclude: 'element',
  link, // declared in `ng-repeat.ts`
}
```

`priority: 1000` is deliberately set high enough to win the
same-element ordering against the other structural directives —
`ng-if` (600), `ng-include` (400) — so `<li ng-repeat="…" ng-if="…">`
runs `ng-repeat` first. The same-element conflict still surfaces the
spec 027 known gap (the spec-017 terminal cutoff silently drops the
lower-priority directive); the canonical fix is nesting
(`<li ng-repeat="…"><span ng-if="…">…</span></li>`).

### The iterator-expression grammar

The right-hand side of `ng-repeat` follows the AngularJS-canonical
grammar:

```
<ITEM> in <COLLECTION> [as <ALIAS>] [track by <EXPR>]
```

`<ITEM>` is either a single identifier (`todo`) or a parenthesized
tuple (`(key, value)` — used with the object-iteration branch).
Both `as ALIAS` and `track by EXPR` are independently optional, but
when both appear `as` always precedes `track by`.

The parser lives in
[`src/compiler/ng-repeat-iterator-parse.ts`](ng-repeat-iterator-parse.ts).
It splits the raw string into four capture groups via the top-level
regex:

```
^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$
```

then re-parses the LHS against a narrower regex to discriminate the
bare-identifier and `(key, value)` forms. Identifier tokens (item
name, key, value, alias) are validated against the shared `IDENT_RE`
from [`@controller/controller.ts`](../controller/controller.ts) so
the same identifier rule applies across the compiler / controller
surfaces. The `<COLLECTION>` and `<track by>` sub-expressions are
parsed through the project's own
[`parse()`](../parser/parse.ts) — they accept the full expression
grammar including filter chains, method calls, and property paths.

Three parse-time error classes are exported from `@compiler/index`
and the root barrel:

| Error class | Triggered by |
| --- | --- |
| `NgRepeatBadIteratorExpressionError` | Top-level regex did not match — missing `in`, wrong clause order, empty input. |
| `NgRepeatBadIdentifierError` | A token failed `IDENT_RE` — empty, leading digit, punctuation. |
| `NgRepeatBadAliasError` | Alias collides with the item / key / value name in the same expression OR with a reserved per-row local (`$index`, `$first`, `$last`, `$middle`, `$even`, `$odd`). |

All three route via the directive's own per-element `try/catch`
through `$exceptionHandler('$compile')` at link time; the list does
not render until the author fixes the expression.

### The WeakMap-based identity tracker

When the author omits `track by`, the default identity tracker in
[`src/compiler/ng-repeat-identity.ts`](ng-repeat-identity.ts)
derives a stable identity string for each item without mutating
user data. Object items go through a closure-local
`WeakMap<object, string>` paired with a monotonically-increasing
counter; primitive items map to type-prefixed sentinels
(`'string:foo'`, `'number:42'`, `'number:NaN'`, `'null:'`,
`'undefined:'`, `'boolean:true'`, `'bigint:10'`,
`'symbol:Symbol(x)'`).

**Deliberate AngularJS divergence — no `$$hashKey`.** AngularJS 1.x
injects a non-enumerable `$$hashKey: string` property onto every
iterated object; this project does not. The WeakMap approach
brings three concrete wins:

  1. **User data stays clean.** Iterating the same object with both
     `ng-repeat` and an external library (a serializer, a fetch body
     builder, a structural-clone routine) does not see a mystery
     `$$hashKey` property leak into output.
  2. **`Object.freeze`d items work transparently.** Frozen objects
     cannot accept new properties — AngularJS's `$$hashKey` injection
     throws on first encounter; the WeakMap stores the key/value
     pair externally so frozen items are first-class citizens.
  3. **GC-friendly.** When the user drops their reference (collection
     re-fetched from the server, item removed from a list), the
     WeakMap entry is reclaimable.

Identity is by reference, not by value — mutating an item in place
(`todos[0].title = 'new'`) keeps its identity. Authors wanting
structural identity supply a `track by` expression
(`track by todo.id`).

For object collections the identity formula folds the property key
in too — `key:${objKey}|${identityTracker.getIdentity(value)}` — so
the same value under two different keys (`{a: 1, b: 1}`) does NOT
falsely collide.

### Row reconciliation algorithm

The directive installs `scope.$watchCollection(parsed.collectionExpr,
listener)`. Each listener fire walks the algorithm:

  1. **Publish `as ALIAS`** on the parent scope (see below).
  2. **Normalize** the new collection.
     `Array.isArray(coll)` → array branch, `{ key: i, value: coll[i] }`
     per entry. `coll !== null && typeof coll === 'object'` → object
     branch, keys taken in alphabetical-string order via
     `Object.keys(coll).sort()` (AngularJS-canonical). Anything else
     (`null`, `undefined`, primitives, functions) → non-iterable bail:
     tear down all current rows.
  3. **Compute identity keys** for every entry via `identityFor` —
     `track by EXPR` when present, default tracker otherwise. Detect
     duplicates in the same pass (`Map<string, number>`).
  4. **Diff and apply.** Walk the new identity list in order:
     - **Identity in `currentRows`** → REUSE: scope, watchers,
       listeners, and DOM subtree are kept intact; only the per-row
       locals + item/key bindings are updated; the `cloneRoot` is
       moved via `parentNode.insertBefore(cloneRoot, anchor.nextSibling)`
       so DOM-node identity (input focus, form values, scroll
       position) survives the reorder.
     - **Identity not in `currentRows`** → FRESH BUILD via
       `$transclude(...)`; locals + bindings populated BEFORE DOM
       insertion so first-render watchers fire with correct values.
  5. **Tear down survivors** of the old map not in the new map:
     `scope.$destroy()` then `cloneRoot.remove()` (same order as
     `ng-if`).

The six framework-published per-row variables — `$index`, `$first`,
`$last`, `$middle`, `$even`, `$odd` — are assigned by the file-local
`updatePerRowLocals` helper from both the reuse and fresh-build
branches.

### The `as alias` publication contract

When the iterator carries `as VISIBLE`, the reconciler writes the
resolved collection to `parentScope[VISIBLE]` BEFORE row
reconciliation runs in the same listener fire. Sibling markup
later in the digest tree therefore sees the new value in the same
turn — the canonical empty-state pattern works without an extra
digest:

```html
<ul>
  <li ng-repeat="todo in todos | filter:q as visible">
    {{ todo.title }}
  </li>
</ul>
<p ng-if="!visible.length">No matches.</p>
```

Per-shape value contract:

  - **Array iteration** — the alias receives the raw post-filter
    array (the value the watcher resolved).
  - **Object iteration** — the alias receives the normalized
    `[{ key, value }]` array (sibling markup reads `.length`
    uniformly across shapes).
  - **Non-iterable** — the alias receives `[]` so
    `!visible.length` fires uniformly across "no matches", "not
    loaded yet", "destroyed".
  - **Duplicate-key throw AFTER publication** does NOT roll the
    alias back. Alias is the input surface, rows are the
    reconciliation surface — independent outputs.

The parser prevents the alias from colliding with the item / key /
value names in the same expression and with the six reserved
per-row locals via `NgRepeatBadAliasError`.

### Duplicate-key detection

When two entries resolve to the same identity (default tracker or
custom `track by`), the reconciler throws
`NgRepeatDuplicateKeyError` carrying both offending items and the
raw expression. The directive wraps its reconciliation block in a
local `try/catch`:

```ts
scope.$watchCollection(parsed.collectionExpr, (newCollection) => {
  try {
    reconcile(newCollection);
  } catch (err) {
    tearDownAllRows();
    invokeExceptionHandler($exceptionHandler, err, '$compile');
  }
});
```

So the throw routes via **`$exceptionHandler('$compile')`**, NOT
through the digest's `'watchListener'` cause path — the directive
captures the throw before the watcher's caller does. The
`tearDownAllRows()` in the catch branch clears any partial state
so the offending collection does not leave a half-rendered tree
behind. The list does not render until the author resolves the
duplicate (typically by adding `track by $index` or `track by item.id`).

The `EXCEPTION_HANDLER_CAUSES` tuple stays at 10 — every spec-028
error site reuses the existing `'$compile'` cause token.

### Worked examples

```html
<!-- Basic array iteration with per-row locals -->
<li ng-repeat="todo in todos">{{ $index + 1 }}. {{ todo.title }}</li>
```

```html
<!-- Custom identity via track by — DOM nodes survive reorders -->
<li ng-repeat="todo in todos track by todo.id">
  <input ng-model="todo.title" />
</li>
```

```html
<!-- as ALIAS for empty-state markup -->
<ul>
  <li ng-repeat="todo in todos | filter:q as visible track by todo.id">
    {{ todo.title }}
  </li>
</ul>
<p ng-if="!visible.length">No matches.</p>
```

```html
<!-- Object iteration with (key, value) LHS — alphabetical key order -->
<li ng-repeat="(name, age) in {alice: 30, bob: 25}">
  {{ name }} → {{ age }}
</li>
```

### `$animate` deferral

Row mutations (enter, leave, move) are synchronous today. No
`$animate.enter` / `$animate.leave` / `$animate.move` hooks. The
deferral matches the spec 023 / 024 precedent for `ng-show` /
`ng-hide` and the class directives — `$animate` integration lands
as a Phase 4 follow-up across every visibility-affecting directive
at once.

### Known gaps

Two limitations are pinned by parity / integration tests in the
suite — both are framework-side and shared with other directives,
not `ng-repeat`-specific bugs:

  - **`$watchCollection` function-form filter-injection.** The
    Scope-side `compileToWatchFn` injects `$$filter` into locals
    only for STRING-form watch inputs; the function-form path (which
    `ng-repeat` uses because the parser produces an `ExpressionFn`)
    returns the input unchanged. The interpreter then sees
    `locals.$$filter === undefined` and throws `FilterLookupError`
    at digest time whenever the collection expression contains a
    filter chain (`todos | filter:q`). The Slice 6 and Slice 7
    suites work around the gap by reassigning `scope.todos` to
    precomputed subsets — the `as alias` publication contract is
    still proven end-to-end, but the live `filter:q` chain is
    blocked until `$$filter` is threaded through the function-form
    path (or `$watchCollection` is widened to accept already-parsed
    `FlaggedWatchFn` inputs). See
    [`spec028-parity.test.ts`](__tests__/spec028-parity.test.ts) and
    [`ng-repeat.test.ts`](__tests__/ng-repeat.test.ts) for the
    inline justifications.
  - **Nested `transclude: 'element'` doesn't re-link.** The same
    foundation issue surfaced in spec 027 still affects spec 028:
    nesting two `transclude: 'element'` directives inside each
    other (`ng-repeat > ng-if`, `ng-repeat > ng-include`,
    `ng-if > ng-repeat`, `ng-repeat > ng-repeat`) does not re-fire
    the inner capture against each cloned subtree. The integration
    tests in
    [`ng-repeat-integration.test.ts`](__tests__/ng-repeat-integration.test.ts)
    pin the actually-observable behavior with inline notes;
    resolving the gap is out of scope here and lands with a future
    capture-pass hardening spec.

## Deferred items

Spec 017 deliberately stops at the compiler core. The following are
explicit roadmap items that future specs will deliver — they are
**accepted at registration time without throwing** (forward-compat) but
do not produce observable behavior in this spec:

- **Isolate scope** (`scope: { foo: '=' }`, `scope: { bar: '<' }`,
  `'@'`, `'&'`) — shipped with spec 022 (see "Isolate scope &
  components" above). The historic `IsolateScopeNotSupportedError`
  class is kept exported as `@deprecated` for one-release grace.
- **Transclusion** (`transclude: true`, multi-slot, `$transclude`,
  `<ng-transclude>`) shipped with spec 018 — see the
  [Transclusion](#transclusion) section above. `transclude: 'element'`
  (the whole-element form, foundation for structural directives)
  shipped with spec 027 — see
  [Structural directives (spec 027)](#structural-directives-spec-027)
  above. `ElementTranscludeNotSupportedError` is kept exported as
  `@deprecated` for one-release grace.
- **Template loading** (`template`, `templateUrl`,
  `<script type="text/ng-template">`) — `template` (inline string or
  function) and `templateUrl` (async string or function) shipped with
  spec 019; see [Template loading](#template-loading) below and the
  full [`src/template/README.md`](../template/README.md) for the
  worked example. `replace: true` is REJECTED at registration via
  `ReplaceTrueNotSupportedError` (deprecated in AngularJS 1.x; will
  not ship). `<script type="text/ng-template">` lands with the
  Built-in Directives roadmap bullet.
- **Controllers** (`controller`, `controllerAs`) shipped with spec 020.
  **`bindToController` + `require` + lifecycle hooks +
  `$compileProvider.component`** shipped with spec 022 — see "Isolate
  scope & components" above.
- **Built-in directives — visibility + binding subset shipped in spec
  023.** `ng-cloak`, `ng-bind`, `ng-bind-template`, `ng-bind-html`,
  `ng-show`, `ng-hide`, `ng-non-bindable` are now registered on
  `ngModule` — see "Visibility & Binding built-ins (spec 023)" above.
  **Class & style subset shipped in spec 024** (`ng-class`,
  `ng-class-even`, `ng-class-odd`, `ng-style` — see "Class & Style
  built-ins" above). **Attribute helpers shipped in spec 025**
  (`ng-href`, `ng-src`, `ng-srcset`, `ng-disabled`, `ng-checked`,
  `ng-readonly`, `ng-selected`, `ng-open` — see "Attribute helper
  built-ins" above). **Event directives shipped in spec 026**
  (`ng-click`, `ng-dblclick`, `ng-mousedown`, `ng-mouseup`,
  `ng-mouseover`, `ng-mouseout`, `ng-mousemove`, `ng-mouseenter`,
  `ng-mouseleave`, `ng-keydown`, `ng-keyup`, `ng-keypress`, `ng-copy`,
  `ng-cut`, `ng-paste`, `ng-focus`, `ng-blur`, `ng-submit` — see
  "Event built-ins" above). **Structural / flow-control subset
  shipped in spec 027** (`ng-init`, `ng-if`, `ng-controller`,
  `ng-switch`, `ng-switch-when`, `ng-switch-default`, `ng-include`
  — see "Structural directives (spec 027)" above). **List iteration
  shipped in spec 028** (`ng-repeat` — see "List iteration
  directive (spec 028)" above). The remaining built-ins
  (`ng-model`, `ng-pluralize`, and the rest) ship under their own
  roadmap items.
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
