# Built-in directives

## Purpose

The framework ships fifty-plus built-in directives (`ng-if`, `ng-repeat`, `ng-class`,
`ng-click`, `ng-bind`, `ng-href`, …) registered on the core `ng` module. They are all
ordinary directives — there is no privileged code path — so this diagram first shows
the **shared mechanism** every directive flows through in `$compile`, then gives a
per-category sub-section for the distinctive behavior of each family. The directives
are DI-only registrations (`injector.get('<name>Directive')` when an app declares
`'ng'` in its deps); the factory functions are file-local, not barrel-exported.

## Collaborators & call order

The shared mechanism — how ANY built-in directive plugs into the compiler. (See
[compile.md](./compile.md) for the full walk/link picture; this is the directive's-eye
view.)

```text
  $compileProvider.directive('ngIf', factory)   ── config phase
       │   (ACCUMULATES per name — two registrations both run)
       ▼
  <name>Directive provider  ── lazy $get returns normalized Directive[]

  ── compile phase (once per template) ──
  ┌──────────────────────────────────────────────────────────────┐
  │ for each element/text node:                                  │
  │   collect directives by restrict mode:                       │
  │     'E' element name · 'A' attribute · 'C' class · 'M' comment│
  │   normalize names: (x|data)[:\-_] prefix strip + camelCase   │
  │   sort: priority DESC, then registration order               │
  │   terminal: true → cut off lower-priority same-element dirs   │
  │           │                                                   │
  │           ▼                                                   │
  │   directive.compile(element, attrs) → returns link fn(s)      │
  └───────────────────────────────────┬──────────────────────────┘
                                       ▼
  ── link phase (once per scope) ──
  ┌──────────────────────────────────────────────────────────────┐
  │   scope kind: none | true (child $new()) | {…} (isolate)      │
  │   PRE-LINK  (parent → child)                                  │
  │   child recursion                                            │
  │   POST-LINK (child → parent)  ← most built-ins wire here     │
  │           │                                                   │
  │           ▼ typical post-link body                            │
  │   scope.$watch(expr, listener)  ──or──  addEventListener      │
  │           │                          (event directives)       │
  │           ▼                                                   │
  │   mutate DOM / scope on change                               │
  │   throws ──route (cause '$compile' | 'watchListener')────────┼─▶ exception-handler.md
  └──────────────────────────────────────────────────────────────┘
```

Two representative examples of the shared mechanism:

```text
  ng-bind (leaf writer, restrict 'A', post-link only)
    scope.$watch('user.name', v => element.textContent = String(v))

  ng-if (structural, restrict 'A', transclude:'element', priority 600)
    captures host ─▶ <!-- ngIf: expr --> Comment placeholder
    scope.$watch('expr', v => v ? $transclude(clone) : clone.$destroy())
```

### Category: structural / flow-control

`ngIf`, `ngSwitch` (+ `ngSwitchWhen` / `ngSwitchDefault`), `ngInclude`, `ngInit`,
`ngController`, plus `ngRepeat`. These use `transclude: 'element'`: the host is swapped
for a `<!-- directiveName: attr -->` Comment placeholder and the captured master is
deep-cloned + re-linked on demand. `ngRepeat` (priority 1000) reconciles rows in place
on `$watchCollection`, preserving DOM-node identity on reuse. Cloned-subtree teardown
goes via `addElementCleanup(placeholder, …)`, not parent-scope propagation alone. Two
structural directives on one element → `MultipleTranscludeDirectivesError` via
`'$compile'`. `ngController` reuses the controller seam through a sentinel
`controller: { __attributeSource: 'ngController' }`.

### Category: visibility & binding

`ngShow` / `ngHide` (`classList.toggle('ng-hide', …)` — depends on consumer-shipped
`.ng-hide { display: none }` CSS), `ngCloak` (compile-time attribute strip), `ngBind`
(single `$watch` → `textContent`), `ngBindTemplate` (link-time `$interpolate`),
`ngBindHtml` (routes through `$sce.getTrustedHtml` → `$sanitize` when loaded — see
[sce.md](./sce.md)), `ngNonBindable` (`terminal: true` + halts child descent so its
subtree is never compiled/interpolated).

### Category: class & style

`ngClass` / `ngClassEven` / `ngClassOdd` (shared `installClassWatcher` engine; tracks
an `appliedClasses` set so consumer classes are never removed) and `ngStyle`
(hyphen-presence dispatch: kebab keys → CSSOM `setProperty`, camelCase → IDL
assignment). All run their diff inside a `$watchCollection` listener
(`'watchListener'` cause).

### Category: attribute helpers

URL aliases `ngHref` / `ngSrc` / `ngSrcset` (priority 99, `$observe` → `$set`, empty →
attribute removed; route through the compiler-level `$$sanitizeUri`) and boolean
aliases `ngDisabled` / `ngChecked` / `ngReadonly` / `ngSelected` / `ngOpen`
(priority 100, `$watch` → bare-presence attribute via the `$set` empty-string mapping).
They exist so a pre-digest browser never sees a literal `{{url}}` or a half-true
boolean.

### Category: event directives

The eighteen native-event directives — Mouse (`ngClick`, `ngDblclick`, `ngMousedown`,
`ngMouseup`, `ngMouseover`, `ngMouseout`, `ngMousemove`, `ngMouseenter`,
`ngMouseleave`), Keyboard (`ngKeydown`, `ngKeyup`, `ngKeypress`), Clipboard (`ngCopy`,
`ngCut`, `ngPaste`), Focus (`ngFocus`, `ngBlur`), Form-lifecycle (`ngSubmit`) — share
`createEventDirective(eventName)`. Each parses its expression once at compile, registers
a native listener at link, and dispatches via `scope.$apply(run)` OR `scope.$evalAsync(run)`
based on `scope.$$phase` (avoids "$digest already in progress"). The `$event` local
exposes the native event. Throws route via `'eventListener'` (common path) or
`'$evalAsync'` (nested path) — see [scope-and-digest.md](./scope-and-digest.md).

### Category: pluralization / i18n

`ngPluralize` — a leaf text-writer in the `ng-bind-template` family. Exact `String(count)`
keys match the RAW count; category selection uses `$locale.pluralCat(count - offset)`
(the [filters.md](./filters.md) `$locale` seam) and the `{}` placeholder uses count −
offset. A switching watch pair keeps exactly one active message watch per key transition;
missing-rule reports route via `'$compile'` once per key transition.

### Category: CSP / template-cache / element overrides

`script` (element-name; compile-phase `$templateCache.put` of an inline
`<script type="text/ng-template" id>`; halts child descent — see
[template-loading.md](./template-loading.md)), `a` (live click-time empty-`href`
`preventDefault` guard + one-way `noopener noreferrer` rel hardening), `ngRef`
(publishes a controller/element reference onto the surrounding scope), and the
documented no-ops `ngCsp` / `ngJq` (the tree-walking interpreter is CSP-safe by
construction; there is no jqLite layer).

## Using it the primary way

There is no standalone import-and-call surface for built-in directives: they are not
exported from `@compiler/index` or the root barrel. The factory functions are
file-local (matching the `ngTransclude` precedent). The "primary" way to author your
OWN directive is the `$compileProvider.directive` / `createCompile` surface documented
in [compile.md](./compile.md) — a built-in directive is just an instance of that shape.
This section is intentionally non-applicable for the built-ins; see the DI way below
for how to reach or override them.

```text
(not applicable — built-in directives have no ESM named export;
 author custom directives via the $compile surface in compile.md)
```

## Using it the dependency-injection way

Built-in directives are reached only through DI. An app gets them by listing `'ng'` in
its module dependency chain; the compiler matches them on elements automatically.
Individual ones are resolvable as `injector.get('<name>Directive')` (returns the
normalized `Directive[]`), and are swapped via `module.decorator('<name>Directive', …)`
or override-registered via `module.directive('<name>', …)`.

```typescript
import { createModule, createInjector } from 'my-own-angularjs/di';

// Built-ins are active once 'ng' is in the deps chain — no explicit import.
createModule('app', ['ng'])
  // Override / wrap a built-in by decorating its <name>Directive provider:
  .decorator('ngClickDirective', [
    '$delegate',
    ($delegate: unknown) => $delegate, // wrap or filter the directive array
  ]);

const injector = createInjector(['ng', 'app']);
const ngIf = injector.get('ngIfDirective'); // the normalized Directive[]
```

## Related diagrams

- [DOM compiler ($compile)](./compile.md) — the walk / collect / sort / three-phase link mechanism every built-in flows through
- [Strict Contextual Escaping ($sce)](./sce.md) — `ng-bind-html` and the URL attribute aliases route through trust contexts
- [Opt-in HTML sanitization (ngSanitize)](./sanitize.md) — where `ng-bind-html` delegates untrusted HTML
- [String & template interpolation](./interpolate.md) — `ng-bind-template` / `ng-pluralize` and attribute `{{ }}`
- [Filters & the filter pipeline](./filters.md) — `$locale.pluralCat` for `ng-pluralize`
- [Template loading ($templateCache / $templateRequest)](./template-loading.md) — `script` template registration and `ng-include`
- [Scopes & digest cycle](./scope-and-digest.md) — the `$watch` / `$apply` / `$evalAsync` dispatch the directives lean on
- [Controllers ($controller / $controllerProvider)](./controller.md) — `ng-controller`'s sentinel controller seam
- [Centralized exception handling](./exception-handler.md) — `'$compile'` / `'watchListener'` / `'eventListener'` error routing
- [Diagram index](./README.md)
