# Functional Specification: DOM Compiler — `$compile` with Pre/Post Linking

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Directives & DOM Compilation (Compiler `$compile` + Linking Pre & Post)
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

The compiler is the bridge between templates and the runtime. Today scopes can dirty-check, the parser can evaluate expressions, filters can format values, `$sce` can mark trusted strings, and `$sanitize` can scrub untrusted HTML — but there is no way to attach any of that to actual DOM. Every binding lives only in JavaScript:

```ts
// What works today
const scope = Scope.create();
scope.$watch('user.name', name => /* nothing observable on the page */);

// What should work after this spec
appModule.config(['$compileProvider', ($cp) => {
  $cp.directive('greet', () => ({
    link: (scope, element, attrs) => {
      element.textContent = `Hello, ${attrs.name}`;
    },
  }));
}]);

const node = document.querySelector('#root');
$compile(node)(scope);
// <div greet name="World"></div>  →  <div greet name="World">Hello, World</div>
```

This spec closes the first two sub-bullets of the **Directives & DOM Compilation** roadmap line end-to-end:

1. **`$compile` service.** A tree walker that takes a DOM node (or `NodeList`), collects directives applied to each node by element name, attribute, class, or comment, sorts the matched directives deterministically, runs their compile functions in document order, and returns a linker function. Calling the linker with a scope runs pre-link top-down and post-link bottom-up, attaching the directives to the live tree.
2. **`$compileProvider` registration.** The config-phase entry point: `$compileProvider.directive(name, factory)` registers a directive factory; the object form `$compileProvider.directive({ a: factoryA, b: factoryB })` registers a batch. Multiple factories registered under the same name accumulate (AngularJS parity), each producing a directive object that participates in priority sorting independently.
3. **Compile + link separation.** `compile(element, attrs)` runs once per template and may mutate the element (its return value becomes the link function). `pre-link(scope, element, attrs)` runs top-down before children link. `post-link(scope, element, attrs)` runs bottom-up after children link — this is the default phase developers reach for and the AngularJS-canonical "the link function" when the others are unspecified.
4. **Restrict modes E, A, C, M with default `'EA'`.** Element (`<my-dir>`), Attribute (`<div my-dir>`), Class (`<div class="my-dir">`), and Comment (`<!-- directive: my-dir value -->`) — full AngularJS-canonical matching surface.
5. **Naming normalization with AngularJS-canonical prefixes.** `myDirective` registered in JS matches `my-directive`, `data-my-directive`, `x-my-directive`, `my:directive`, `my_directive` in the DOM — same `directiveNormalize` rules AngularJS 1.x has shipped for a decade.
6. **Priority ordering with terminal short-circuit.** Directives sort by descending `priority`, ties broken by registration order. A directive declaring `terminal: true` at priority N prevents any directive with priority `< N` on the same node from running.
7. **`Attributes` object with full surface.** Read normalized values via `attrs.myAttr`, mutate via `attrs.$set('class', 'foo')` (DOM in sync, observers notified), and react to interpolated attributes via `attrs.$observe('href', newVal => …)` — wired into the existing `$interpolate` service from spec 011.
8. **Two scope modes — `false` (default) and `true` (child scope).** Isolate scope (`{...}`) with binding modes `=`, `<`, `@`, `&` is genuinely complex and warrants a dedicated spec slice — explicitly deferred.
9. **Errors routed through `$exceptionHandler` with a new `'$compile'` cause.** A throwing directive factory, compile function, or link function is reported via the configured handler with cause `'$compile'`; compilation of sibling nodes continues. Adding `'$compile'` to `EXCEPTION_HANDLER_CAUSES` is a public-API change called out in the changelog (same pattern as spec 016 added `'$filter'`).

**Success criteria:**

- `appModule.config(['$compileProvider', $cp => $cp.directive('greet', () => ({ link: (s, el, attrs) => { el.textContent = `Hi ${attrs.name}`; } }))])` plus `$compile(node)(scope)` mutates `<div greet name="World"></div>` to `<div greet name="World">Hi World</div>`.
- Multiple directives on the same node run in priority order; same priority falls back to registration order.
- `terminal: true` at priority 100 prevents directives at priority < 100 on the same node from running.
- All four restrict modes match: `<my-dir>` (E), `<div my-dir>` (A), `<div class="my-dir">` (C), `<!-- directive: my-dir -->` (M).
- `attrs.$observe('href', fn)` invokes `fn` initially with the resolved interpolated value, then again whenever the underlying scope expression changes inside a digest.
- A directive factory throws → reported via `$exceptionHandler(err, '$compile')`; sibling nodes still compile.
- A `link` function throws → same routing; subsequent linkers in the queue still run.
- `parse('a || b')`, `$filter('uppercase')`, `Scope.create()`, `$interpolate('{{x}}')`, `$sce.trustAsHtml(...)`, `$sanitize('<p>…</p>')` continue to work unchanged.
- All tests from prior specs (002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016) continue to pass; behavior is purely additive.

---

## 2. Functional Requirements (The "What")

### 2.1. `$compile` Service — Tree-Walking Public API

- `$compile` is a service registered on the `ng` module. Calling `$compile(node)` walks the node and its descendants, collecting and matching directives, and returns a **linker function**. Calling the linker with a scope runs the pre-link and post-link phases, returning the linked node(s).
  - **Acceptance Criteria:**
    - [ ] `injector.get('$compile')` returns a function
    - [ ] `$compile(element)` accepts a single `Element` and returns a linker `(scope) => Element`
    - [ ] `$compile(nodeList)` accepts a `NodeList` (or array of `Node`s) and returns a linker that links each top-level node and returns the same collection
    - [ ] `$compile(commentNode)` accepts a `Comment` node directly (so comment-restricted directives can be compiled out of context)
    - [ ] `$compile(node)(scope)` returns the same node reference (or collection) — the compiler does NOT clone or replace the input by default
    - [ ] `$compile(node)(scope)` invokes pre-link top-down then post-link bottom-up across the entire walked subtree
    - [ ] `$compile(node)` is idempotent for the COMPILE phase — calling it once and storing the linker, then calling the linker multiple times with different scopes, links each scope independently (the compiler's matched-directive list is reusable; linker invocations are not)
    - [ ] Whitespace-only `Text` nodes between elements are walked but contribute no directive matches (they're plain text — no compile work)
    - [ ] Non-element / non-comment nodes (e.g., `Text`) match zero directives but are walked correctly when interleaved with element children

### 2.2. `$compileProvider` — Config-Phase Registration

- `$compileProvider` is a provider registered on the `ng` module. It exposes a single registration surface: `directive(name, factory)` and the batch object form `directive({ name1: factory1, … })`. Factories are annotated and invoked via `$injector.invoke(...)` lazily on first compile of a matching node.
  - **Acceptance Criteria:**
    - [ ] `appModule.config(['$compileProvider', ($cp) => $cp.directive('myDir', () => ({ link: () => {} }))])` — `<div my-dir></div>` is matched and linked at run-phase
    - [ ] Array-style annotations: `$compileProvider.directive('myDir', ['$rootScope', ($rootScope) => ({ link: …})])` resolves `$rootScope` from the registry
    - [ ] Object form: `$compileProvider.directive({ a: factoryA, b: factoryB })` registers each key as a separate directive
    - [ ] `directive(...)` returns `$compileProvider` to allow chaining: `$cp.directive('a', …).directive('b', …)`
    - [ ] `$compileProvider` is resolvable in any module's `config()` block as long as the module depends (transitively) on `ng`
    - [ ] Calling `$compileProvider.directive(...)` after the run phase throws `$provide.<recipe> is only callable during the config phase…` — inherits the spec-015 phase guard since registration goes through `$provide.provider`
    - [ ] Registering a directive with a name that is not a valid camelCase JavaScript identifier throws `Invalid directive name: <name>` synchronously at registration time (e.g., names starting with a digit, containing whitespace, or containing reserved characters)
    - [ ] Registering a directive with a falsy factory (`null`, `undefined`, empty string) throws `Invalid directive factory for <name>` synchronously

### 2.3. Multiple Directives Per Name — AngularJS Parity

- Calling `$compileProvider.directive('foo', factoryA)` followed by `$compileProvider.directive('foo', factoryB)` does NOT replace `factoryA`. Both factories are retained; both directives match `<foo>` / `<div foo>` / etc., and both participate in priority sorting on the matched node.
  - **Acceptance Criteria:**
    - [ ] Two factories registered under the same name produce two directive objects; both are returned by the internal `getDirective('foo')` lookup
    - [ ] Both directives run on a single matching node, in priority order (then registration order on ties)
    - [ ] Internally, the per-directive provider registers as `<name>Directive` whose `$get` returns the ARRAY of compiled directive objects — mirrors AngularJS exactly
    - [ ] `injector.get('myDirDirective')` returns the array of directive objects for `myDir`
    - [ ] `$compileProvider.directive({ foo: factoryA, foo: factoryB })` is semantically equivalent to two single-form calls (object literal collapses duplicate keys, so practically only the second wins; documented limitation)
    - [ ] Decorators on `<name>Directive` wrap the WHOLE array; the decorator receives the array as `$delegate` and may filter / wrap individual entries

### 2.4. Directive Definition Object (DDO) — Supported Properties

- A directive factory returns either a `link` function (sugar for `{ link: fn, restrict: 'EA' }`) or a Directive Definition Object. The DDO properties supported in this spec:

| Property | Type | Purpose | Default |
| --- | --- | --- | --- |
| `restrict` | `'E' \| 'A' \| 'C' \| 'M' \| 'EA' \| 'EAC' \| 'EACM' \| …` | Match modes | `'EA'` |
| `priority` | `number` | Sort order (descending) | `0` |
| `terminal` | `boolean` | Stop directives at priority < this from running on same node | `false` |
| `compile` | `(element, attrs) => link \| { pre, post } \| void` | Runs once per template | `undefined` |
| `link` | `(scope, element, attrs) => void \| { pre, post }` | Sugar for `compile: () => link` | `undefined` |
| `scope` | `false \| true` | Use parent (`false`) or new child scope (`true`) | `false` |
| `name` | `string` | Override registered name (rarely useful) | registration name |

- **Acceptance Criteria:**
  - [ ] Factory returning a function (e.g., `() => function postLink(scope, el, attrs) { … }`) is treated as `{ link: fn, restrict: 'EA', priority: 0 }`
  - [ ] Factory returning an object without `restrict` is treated as `restrict: 'EA'`
  - [ ] Factory returning an object without `priority` is treated as `priority: 0`
  - [ ] Factory returning an object without `terminal` is treated as `terminal: false`
  - [ ] Unknown DDO properties are accepted silently (forward-compat with future specs that add `controller`, `template`, `transclude`, `require`, etc.)
  - [ ] `link` and `compile` are mutually exclusive in PRACTICE — if both are given, `compile` wins and `link` is silently ignored (matches AngularJS)
  - [ ] Properties explicitly OUT-OF-SCOPE for this spec (`controller`, `controllerAs`, `require`, `template`, `templateUrl`, `transclude`, `replace`, `multiElement`, `bindToController`) are ACCEPTED at registration time without throwing (forward-compat) but do not produce observable behavior in this spec — documented as such
  - [ ] `scope: {}` (isolate-scope object form) is REJECTED at registration time with `Isolate scope is not yet supported (spec 017 ships only scope: false | true)` so that a future spec can add it without silent semantic changes

### 2.5. Restrict Modes — E, A, C, M

- Each character in `restrict` enables one matching strategy. Default is `'EA'` (Element + Attribute). The matcher visits each node and asks: does this node match the directive under any of the active restrict letters?
  - **Acceptance Criteria:**
    - **E (Element):**
      - [ ] `<my-dir></my-dir>` matches a directive registered as `myDir` with `restrict: 'E'` or `'EA'`
      - [ ] `<div></div>` does NOT match `myDir` under E mode
    - **A (Attribute):**
      - [ ] `<div my-dir></div>` matches `myDir` with `restrict: 'A'` or `'EA'`
      - [ ] `<div data-my-dir></div>`, `<div x-my-dir></div>`, `<div my:dir></div>`, `<div my_dir></div>` all match (full normalization — see §2.6)
      - [ ] Boolean attribute presence matches even with empty value: `<div my-dir>` → `attrs.myDir === ''`
      - [ ] Attribute with value: `<div my-dir="some-value">` → `attrs.myDir === 'some-value'`
    - **C (Class):**
      - [ ] `<div class="my-dir"></div>` matches `myDir` with `restrict: 'C'`
      - [ ] `<div class="foo my-dir bar"></div>` matches (class can be one of many)
      - [ ] Class with value: `<div class="my-dir: some-value;"></div>` — the value is exposed as `attrs.myDir === 'some-value'` (AngularJS-canonical class-with-value syntax)
      - [ ] Class without `'C'` in `restrict`: `<div class="my-dir"></div>` does NOT match a directive registered with `restrict: 'EA'`
    - **M (Comment):**
      - [ ] `<!-- directive: my-dir -->` matches `myDir` with `restrict: 'M'`
      - [ ] `<!-- directive: my-dir some value -->` matches and exposes the trailing text as `attrs.myDir === 'some value'`
      - [ ] `<!-- not a directive -->` does NOT match
      - [ ] `<!-- directive:my-dir -->` (no space after colon) ALSO matches — whitespace around the colon is optional
      - [ ] Without `'M'` in `restrict`, the comment does not match
    - **Combined restricts:**
      - [ ] `restrict: 'EACM'` matches under any of the four strategies on the same node
      - [ ] `restrict: 'EA'` is the default when `restrict` is omitted
      - [ ] Each character is independent — order in the string is irrelevant: `'AE'` is equivalent to `'EA'`
      - [ ] Unknown letters in `restrict` (e.g., `'X'`) are ignored silently (matches AngularJS leniency)

### 2.6. Naming Normalization — AngularJS-Canonical

- A directive registered in JavaScript as `myDirective` (camelCase identifier) matches the following equivalent DOM forms after normalization:
  - **Acceptance Criteria:**
    - [ ] Bare kebab-case: `<my-directive></my-directive>` and `<div my-directive>` (E and A)
    - [ ] `data-` prefix: `<data-my-directive>` and `<div data-my-directive>`
    - [ ] `x-` prefix: `<x-my-directive>` and `<div x-my-directive>`
    - [ ] `data:` separator after prefix: `<div data:my-directive>`
    - [ ] `x:` separator after prefix: `<div x:my-directive>`
    - [ ] `data_` separator after prefix: `<div data_my-directive>`
    - [ ] `x_` separator after prefix: `<div x_my-directive>`
    - [ ] Internal separators `-`, `:`, `_` all normalize: `<div my:directive>`, `<div my_directive>`, `<div my-directive>` all match `myDirective`
    - [ ] Mixed separators in the same name normalize: `<div my:dir-name>` → `myDirName`
    - [ ] Normalization is case-insensitive on the prefix and separators: `<div DATA-my-directive>` matches; the directive name itself is camelCase and case-significant
    - [ ] The exact `directiveNormalize` algorithm matches AngularJS 1.x: strip the prefix `(x|data)[:\-_]`, then split on `[:\-_]` and uppercase the first letter of each subsequent segment
    - [ ] `attrs` exposes the NORMALIZED name as the property key: `<div data-my-directive="x">` produces `attrs.myDirective === 'x'`
    - [ ] `attrs.$attr` map records the ORIGINAL, un-normalized attribute name as it appeared in the DOM: `attrs.$attr.myDirective === 'data-my-directive'` (used by `$set` to update the DOM in the form the developer wrote)

### 2.7. Priority Ordering and Terminal Short-Circuit

- All directives matched on a single node are sorted by descending `priority`. Ties are broken by registration order — the directive registered first runs first within the same priority bucket. Each directive's `compile` (or its derived `link`) runs in this sorted order.
  - **Acceptance Criteria:**
    - [ ] Two directives on the same node with priorities 100 and 50 — priority-100 compile/link runs before priority-50
    - [ ] Two directives on the same node with the same priority (both 0) — registration order determines execution order
    - [ ] Directive matched via element name AND attribute on the same node (e.g., `<my-dir my-dir-other>`) — both are collected and sorted together
    - [ ] `terminal: true` at priority N stops collection of any directive with priority `< N` on the same node — those directives do NOT compile and do NOT link on this node
    - [ ] Directives with the same priority as a terminal directive STILL run (they're not "below" it)
    - [ ] Terminal short-circuit affects only the same node — child nodes still compile their own directives normally
    - [ ] `terminal: true` with no explicit priority defaults to priority 0 — meaning it stops nothing else with priority 0 (registration-order ties still run together) and only blocks priority `< 0` directives (rare in practice)
    - [ ] Priority is a `number`; `Infinity` is supported; `NaN` is rejected at registration time with `Invalid priority for directive <name>: NaN`

### 2.8. Compile Phase

- Once directives are matched and sorted on a node, the compiler invokes each directive's `compile` function (or its sugar `link` form). The `compile` function runs ONCE per template — its purpose is template-time DOM mutation that should not be repeated per scope. Its return value is the link function (or `{ pre, post }`).
  - **Acceptance Criteria:**
    - [ ] `compile: (element, attrs) => link` — the returned function becomes the post-link function for that directive
    - [ ] `compile: (element, attrs) => ({ pre, post })` — separate pre-link and post-link functions
    - [ ] `compile: (element, attrs) => undefined` — directive contributed nothing to linking; element has been mutated, and that's enough
    - [ ] Compile receives the raw `Element` (matches §2.10) and the `Attributes` object built for the node
    - [ ] Compile is allowed to mutate the element: `compile: (el) => { el.classList.add('compiled'); }` — the class is present in every linked instance
    - [ ] Compile runs in priority order across all matched directives on the node BEFORE any link function runs on the same node
    - [ ] Compile runs BEFORE the compiler descends into the node's children (enabling parent-template mutation that affects child compilation)
    - [ ] A directive declared with `link: fn` (no `compile`) is treated as `compile: () => fn` — the link reference returned is the same function across all linker invocations

### 2.9. Pre-Link Phase

- After the entire subtree's compile phase finishes, the linker walks the tree top-down and runs each directive's pre-link function (if present). Pre-link executes BEFORE descending into children.
  - **Acceptance Criteria:**
    - [ ] Pre-link runs in priority order (descending) on a single node
    - [ ] Pre-link runs top-down across the tree: parent's pre-link runs before any child's pre-link
    - [ ] Pre-link signature: `pre(scope, element, attrs)` — receives the bound scope, raw `Element`, and `Attributes` object
    - [ ] Mutations to `attrs` via `$set` inside pre-link ARE visible to descendant pre-link/post-link calls
    - [ ] Pre-link is OPTIONAL — directives that only need a post-link omit `pre`
    - [ ] An unhandled exception in a pre-link function is routed through `$exceptionHandler(err, '$compile')`; subsequent pre-link functions on the same node and downstream still run

### 2.10. Post-Link Phase

- After the entire subtree's pre-link + child-link work finishes, the linker runs each directive's post-link function bottom-up. Post-link is the default phase developers reach for; the function passed to `link: fn` is post-link.
  - **Acceptance Criteria:**
    - [ ] Post-link runs in REVERSE priority order on a single node — lower priority first, higher priority last (mirrors AngularJS)
    - [ ] Post-link runs bottom-up across the tree: a node's children all post-link before that node post-links
    - [ ] Post-link signature: `post(scope, element, attrs)` — same arguments as pre-link
    - [ ] Sugar form: a factory returning a function (`() => fn`) registers `fn` as the post-link
    - [ ] DDO `link: fn` is post-link
    - [ ] DDO `link: { pre, post }` defines both phases
    - [ ] Post-link is the canonical place to attach event listeners, `scope.$watch` callbacks, or `scope.$on` handlers — semantics match AngularJS exactly
    - [ ] An unhandled exception in a post-link function is routed through `$exceptionHandler(err, '$compile')`; subsequent post-link functions and ancestor traversals still run

### 2.11. `Attributes` Object — Read + `$set` + `$observe`

- Each compiled element has a single shared `Attributes` instance, passed identically to all directives on that node (compile, pre-link, post-link). It exposes normalized read access plus two methods.
  - **Acceptance Criteria:**
    - **Read access:**
      - [ ] `attrs.myAttr` returns the string value of the `my-attr` / `data-my-attr` / `my:attr` / `my_attr` attribute, normalized to camelCase
      - [ ] Boolean-presence attributes (`<div my-attr>`) yield `attrs.myAttr === ''`
      - [ ] Missing attributes yield `attrs.myAttr === undefined`
      - [ ] `attrs.$attr` is a record mapping each normalized name to the original DOM attribute name as it appeared in the source (`attrs.$attr.myAttr === 'data-my-attr'`)
      - [ ] Iterating `attrs` (e.g., `for (const k in attrs)` or `Object.keys(attrs)`) yields the normalized names of attributes present on the element, plus internally-managed entries (`$$element`, `$attr`) marked non-enumerable so they don't appear
    - **`$set(name, value)`:**
      - [ ] `attrs.$set('class', 'foo')` updates `attrs.class` to `'foo'`, sets `element.setAttribute('class', 'foo')`, and fires any registered observers for `class`
      - [ ] `attrs.$set('href', 'https://example.com')` works identically — the original DOM-form name is looked up via `$attr` so a `data-href` attribute is updated as `data-href`, not duplicated as `href`
      - [ ] `$set(name, value, writeAttr)` — if `writeAttr === false`, the in-memory `attrs[name]` updates and observers fire, but the DOM is NOT touched (matches AngularJS, used to suppress redundant DOM writes during interpolated-attribute evaluation)
      - [ ] `$set(name, null)` removes the attribute from `attrs` and from the DOM, and notifies observers with `undefined`
      - [ ] `$set` notifies observers SYNCHRONOUSLY when called outside a digest, and ASYNCHRONOUSLY (via `$evalAsync`) when called inside one — matches AngularJS to avoid mid-digest re-entrancy
    - **`$observe(name, fn)`:**
      - [ ] `attrs.$observe('href', (value) => …)` registers `fn` as an observer; returns a deregistration function
      - [ ] When the element has an interpolated attribute (`<a href="/users/{{userId}}">`), `$observe('href', fn)` fires `fn` initially with the resolved value AT THE END of the current digest, and again on every digest cycle where the resolved value changes
      - [ ] When the element has a static attribute (`<a href="/static">`), `$observe('href', fn)` fires `fn` initially with `'/static'` ON the first digest after registration, and never again
      - [ ] When `$set(name, value)` is called explicitly, registered observers receive the new value (independent of any interpolation)
      - [ ] The deregistration function returned by `$observe` removes the observer; further `$set` or interpolation changes do NOT call the deregistered fn
      - [ ] Observer exceptions are routed through `$exceptionHandler(err, '$compile')`; other observers for the same attribute still run
      - [ ] `$observe` integrates with the existing `$interpolate` service — interpolated attributes on every linked element are scanned ONCE at link time and wired into a per-attribute watch when at least one observer registers (lazy)

### 2.12. Scope Option — `false` (Default) and `true` (Child Scope)

- Directives may declare `scope: false` (default — share the parent scope) or `scope: true` (create a new child scope via `parent.$new()`). The chosen scope is the one passed into all link functions on that node and its descendants.
  - **Acceptance Criteria:**
    - **`scope: false`:**
      - [ ] Default when omitted
      - [ ] `link(scope, …)` receives the SAME scope reference as the parent's link
      - [ ] Two sibling directives on the same node — one with `scope: false`, one without — both receive the parent scope reference
      - [ ] Mutations to `scope.foo` in the directive ARE visible to siblings and descendants — AngularJS-canonical shared-scope behavior
    - **`scope: true`:**
      - [ ] Compiler creates ONE child scope per element (not per directive) via `parentScope.$new()` BEFORE link functions run
      - [ ] All directives on that element receive the SAME child scope reference; if multiple directives request `scope: true`, only one child scope is created (AngularJS parity)
      - [ ] The child scope inherits prototypically from the parent — `childScope.parentVar` is visible
      - [ ] Mutations on the child scope (`childScope.foo = 'x'`) do NOT leak to the parent
      - [ ] A descendant element with `scope: false` shares its parent's child scope; a descendant with `scope: true` creates ANOTHER child of that child scope
      - [ ] Element destruction (e.g., when a future `ng-if` removes the node) calls `childScope.$destroy()` automatically — wired in this spec via the post-link cleanup hook on the element
    - **Mixed siblings:**
      - [ ] Two directives on the same node with `scope: true` and `scope: false` — exactly one child scope is created; both directives receive it (the `true` request wins)
    - **Isolate scope (`scope: {...}`) — REJECTED:**
      - [ ] Registering a directive with `scope: { foo: '=' }` throws `Isolate scope is not yet supported (spec 017 ships only scope: false | true)` synchronously at registration time
      - [ ] Documented in the directive-definition-object section as deferred to a future spec

### 2.13. Element Argument — Raw DOM `Element`

- All link functions and compile functions receive the raw DOM node reference. There is no jqLite wrapper. Developers use the native DOM API directly.
  - **Acceptance Criteria:**
    - [ ] `link(scope, element, attrs)` — `element` is `Element` (or `Comment` for an M-restricted comment match)
    - [ ] `element.textContent`, `element.classList.add`, `element.setAttribute`, `element.addEventListener` are the canonical ergonomics
    - [ ] No `.text()`, `.html()`, `.addClass()`, `.removeClass()`, `.attr()`, `.on()`, `.find()`, `.parent()` jqLite shortcuts ship — using them is a TypeScript compile error (the `Element` type doesn't have them) and a runtime `TypeError` if cast to `any`
    - [ ] Documented as a deliberate decision: future jqLite-compat wrapper from Phase 5 (`angular.element`) may layer on top WITHOUT changing the link signature
    - [ ] For comment directives (`restrict: 'M'`), `element` is the matched `Comment` node — directives that need to insert siblings call `element.parentNode.insertBefore(...)`

### 2.14. Comment Directive Syntax — AngularJS-Canonical

- Comment directives use the exact AngularJS 1.x syntax: `<!-- directive: name value -->`, where `name` is the kebab-case directive name (or any normalization variant) and `value` is the optional remaining text.
  - **Acceptance Criteria:**
    - [ ] `<!-- directive: my-dir -->` matches `myDir` with `restrict: 'M'`
    - [ ] `<!-- directive: my-dir hello world -->` matches and exposes `attrs.myDir === 'hello world'`
    - [ ] `<!-- directive:my-dir hello -->` (no space after colon) matches; whitespace around the colon is optional
    - [ ] `<!--   directive: my-dir   -->` (leading/trailing whitespace) matches; leading/trailing whitespace inside the comment text is trimmed before parsing
    - [ ] `<!-- not a directive -->` does NOT match — the comment text must START with `directive:`
    - [ ] `<!-- DIRECTIVE: my-dir -->` does NOT match — `directive:` is case-sensitive (matches AngularJS)
    - [ ] Multiple comment directives in a single file each match independently — each `Comment` node is its own match site

### 2.15. Class Directive Syntax

- Class directives match when the directive name (in any normalization) appears in the element's `class` attribute. AngularJS additionally supports `class="my-dir: value;"` for class-with-value syntax.
  - **Acceptance Criteria:**
    - [ ] `<div class="my-dir"></div>` matches `myDir` with `restrict: 'C'`; `attrs.myDir === ''`
    - [ ] `<div class="foo my-dir bar"></div>` matches; `attrs.myDir === ''`
    - [ ] `<div class="my-dir: hello;"></div>` matches; `attrs.myDir === 'hello'` (the value between `:` and `;`)
    - [ ] Multiple semicolon-separated class-value pairs: `<div class="my-dir: a; other-dir: b;">` — each is parsed independently
    - [ ] Whitespace inside the class-value syntax is trimmed: `<div class="my-dir : hello ;">` → `attrs.myDir === 'hello'`
    - [ ] Without `'C'` in `restrict`, `<div class="my-dir">` does NOT match a directive registered with `restrict: 'EA'`
    - [ ] Class normalization respects the same prefix/separator rules: `<div class="data-my-dir">` matches `myDir` with `restrict: 'C'`

### 2.16. Error Handling — `'$compile'` Cause Token

- A new token `'$compile'` is added to `EXCEPTION_HANDLER_CAUSES`. Errors thrown during directive registration (when the factory itself throws), compile, pre-link, post-link, and `$observe` callbacks are caught and reported via `$exceptionHandler(err, '$compile')`. Compilation of sibling directives, sibling nodes, and ancestor cleanup continues.
  - **Acceptance Criteria:**
    - [ ] `EXCEPTION_HANDLER_CAUSES` gains a new entry `'$compile'` — public-API additive change called out in the changelog
    - [ ] A throwing factory (`$compileProvider.directive('bad', () => { throw new Error('boom'); })`) at compile-time of a matched node — error is reported via `$exceptionHandler(err, '$compile')`; the directive is treated as if it returned `undefined` (no compile, no link); other directives on the same node continue
    - [ ] A throwing `compile` function — error is reported; the directive contributes no link function; other directives continue
    - [ ] A throwing `pre-link` function — error is reported; subsequent pre-link functions on the same node still run; descendant traversal still happens
    - [ ] A throwing `post-link` function — error is reported; subsequent post-link functions still run; ancestor post-link still runs
    - [ ] A throwing `$observe` callback — error is reported; other observers for the same attribute still fire; the digest continues
    - [ ] A throwing `compile` function during the WALK phase does NOT cause the linker to be unreturnable — the linker is still produced; calling it links whatever directives DID compile successfully
    - [ ] Outside any digest context, errors during `$compile(node)` (the walk phase) are still routed through `$exceptionHandler` — the registered handler is resolved at the start of `$compile` via `injector.get('$exceptionHandler')`
    - [ ] Spec-014 contract preserved: a custom `$exceptionHandler` that itself throws is caught by `invokeExceptionHandler` and degrades to `console.error` — `$compile` does not crash on a misbehaving handler

### 2.17. `$compileProvider.directive` — Object Form

- The object form `$compileProvider.directive({ a: factoryA, b: factoryB })` registers each key as a separate directive. Used for AngularJS-canonical batch registration and for the future module DSL `.directive` (deferred) to delegate cleanly.
  - **Acceptance Criteria:**
    - [ ] `$compileProvider.directive({ foo: factoryA, bar: factoryB })` registers two directives identically to two single-form calls
    - [ ] Object-form values must be valid factory shapes (function or array-style annotation); invalid entries throw `Invalid directive factory for <name>` synchronously
    - [ ] Object-form keys must be valid camelCase identifiers per §2.2; invalid keys throw `Invalid directive name: <name>`
    - [ ] Object-form returns `$compileProvider` for chaining: `$cp.directive({ a: …, b: … }).directive('c', …)`
    - [ ] Empty object `{}` is accepted as a no-op (matches AngularJS leniency)
    - [ ] Duplicate keys in the object literal collapse per JS semantics — only the last entry survives. This is a documented limitation of the object form; for accumulation of multiple factories under the same name, use repeated single-form calls (§2.3)

### 2.18. Module Layout / Exports

- The existing empty `src/compiler/` subpath becomes a real module. Followed the existing pattern of `src/sce/`, `src/interpolate/`, `src/sanitize/`, `src/filter/`.
  - **Acceptance Criteria:**
    - [ ] `src/compiler/compile.ts` houses the `createCompile` ESM-first factory and tree-walker
    - [ ] `src/compiler/compile-provider.ts` houses `$CompileProvider` (DI-only)
    - [ ] `src/compiler/directive-normalize.ts` houses the `directiveNormalize` function (kebab/camelCase + prefix stripping)
    - [ ] `src/compiler/attributes.ts` houses the `Attributes` class with `$set` / `$observe`
    - [ ] `src/compiler/directive-types.ts` houses the public-API TypeScript types (`Directive`, `DirectiveFactory`, `LinkFn`, `CompileFn`, `Attributes`, etc.)
    - [ ] TypeScript path alias `@compiler/*` resolves to `src/compiler/*` (already present)
    - [ ] `package.json` `exports` map gains a `./compiler` entry pointing at the built `.mjs`/`.cjs`/`.d.ts` (already present — empty barrel — populated in this spec)
    - [ ] `rollup.config.mjs` `./compiler` build entry is already present
    - [ ] The root barrel re-exports the public surface: `createCompile`, `compile` default, `Attributes` type, `Directive` / `DirectiveFactory` / `LinkFn` / `CompileFn` types, `directiveNormalize` helper
    - [ ] `$compile` and `$compileProvider` register on the `ng` module by default
    - [ ] Tests live under `src/compiler/__tests__/*.test.ts` — one file per concern: `compile.test.ts`, `compile-provider.test.ts`, `directive-normalize.test.ts`, `restrict-modes.test.ts`, `priority-and-terminal.test.ts`, `compile-phase.test.ts`, `pre-link.test.ts`, `post-link.test.ts`, `attributes.test.ts`, `attributes-observe.test.ts`, `scope-true.test.ts`, `multiple-directives.test.ts`, `comment-directives.test.ts`, `class-directives.test.ts`, `exception-handler.test.ts`

### 2.19. Backward Compatibility

- Adding the compiler is purely additive. No existing API is renamed, removed, or behavior-changed.
  - **Acceptance Criteria:**
    - [ ] All tests from specs 002, 003, 006, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016 continue to pass unchanged
    - [ ] `Scope.create()`, `parse()`, `createInjector()`, `createModule()`, `interpolate`, `sce`, `sanitize`, `$exceptionHandler`, the nine built-in filters all continue to work without modification
    - [ ] The `ng` module gains `$compile` and `$compileProvider`; no existing entry is renamed or removed
    - [ ] The `EXCEPTION_HANDLER_CAUSES` token list gains exactly one new entry (`'$compile'`); existing tokens are unchanged in name and meaning
    - [ ] `injector.has('$compile') === true` and `injector.has('$compileProvider') === true` after `ng` loads
    - [ ] No public type alias from `@core`, `@parser`, `@di`, `@interpolate`, `@sce`, `@sanitize`, `@exception-handler`, `@filter` is changed
    - [ ] `package.json` `exports` map and `rollup.config.mjs` already include the `./compiler` entry — no new build entry is added (the entry transitions from re-exporting an empty barrel to re-exporting the real surface)

### 2.20. Documentation

- The compiler gets the same documentation treatment as `$sce`, `$sanitize`, `$exceptionHandler`, and filters.
  - **Acceptance Criteria:**
    - [ ] `CLAUDE.md` "Modules" table updates the `./compiler` row from "empty barrel" to listing the public exports (`createCompile`, `compile`, `Attributes`, directive types, etc.)
    - [ ] `CLAUDE.md` "Non-obvious invariants" gains bullets covering: directive registration accumulates per name (no last-wins on directives, unlike filters/providers); compile-phase mutation runs once per template, link-phase mutation runs once per scope; `$observe` integrates with `$interpolate` lazily — only attributes with at least one observer register a watch; `'$compile'` cause token added to `EXCEPTION_HANDLER_CAUSES`; isolate scope is intentionally rejected at registration time (deferred to a future spec); element argument is the raw DOM `Element` (no jqLite wrapper)
    - [ ] `CLAUDE.md` "Where to look when…" gains rows for: "How does `$compile` walk the tree?" → `src/compiler/compile.ts`; "How are directive names normalized?" → `src/compiler/directive-normalize.ts`; "How does `attrs.$observe` wire into `$interpolate`?" → `src/compiler/attributes.ts`
    - [ ] TSDoc on every public export (the `createCompile` factory, `$compileProvider.directive`, the `Attributes` class, the directive types) carries at least one usage example
    - [ ] `src/compiler/README.md` documents: directive registration patterns, the four restrict modes with examples, priority + terminal semantics, compile-vs-link guidance (when to use which), `$set`/`$observe` patterns, the deliberate raw-`Element` choice (with a forward-pointer to Phase 5's `angular.element`), and the deferred items (isolate scope, transclusion, templates, controllers, multi-element)

---

## 3. Scope and Boundaries

### In-Scope

- `$compile` service that walks an `Element`, `NodeList`, or `Comment` and returns a linker function
- `$compileProvider` with `directive(name, factory)` and `directive({...})` object-form registration on the `ng` module
- Multiple factories per directive name (AngularJS parity); internal provider naming `<name>Directive` returning the array
- Restrict modes E, A, C, M with default `'EA'`; full match logic for each
- AngularJS-canonical name normalization: bare camelCase ↔ kebab-case plus `data-`/`x-` prefixes and `:`/`_`/`-` separators
- Priority sorting (descending); registration-order tie-break; `terminal: true` short-circuit
- Compile + link separation: `compile` runs once per template; `pre-link` top-down; `post-link` bottom-up; sugar form (factory returns a function) treated as post-link
- `Attributes` object: normalized read access, `$attr` for original DOM names, `$set(name, value, writeAttr?)`, `$observe(name, fn)` with `$interpolate` integration
- Scope option `false` (default) and `true` (child scope via `parent.$new()`); child-scope `$destroy` on element removal; isolate scope `{...}` REJECTED at registration time
- Comment-directive syntax `<!-- directive: name value -->` with whitespace tolerance and case sensitivity on `directive:`
- Class-directive syntax including class-with-value form `class="my-dir: value;"`
- Errors during factory invocation, compile, pre-link, post-link, and `$observe` callbacks routed through `$exceptionHandler` with new cause token `'$compile'`; sibling/ancestor work continues
- Element argument is the raw DOM `Element` (or `Comment` for M-restricted matches)
- New `src/compiler/` real module: `compile.ts`, `compile-provider.ts`, `directive-normalize.ts`, `attributes.ts`, `directive-types.ts`; tests under `src/compiler/__tests__/*.test.ts`
- Root barrel re-exports for `createCompile`, `compile`, `Attributes`, directive types
- TSDoc + `src/compiler/README.md` + `CLAUDE.md` updates
- All prior spec test suites continue to pass

### Out-of-Scope

- **Module DSL `.directive(name, factory)` on `createModule`** — separate roadmap bullet under "Module DSL `.directive` / `.component` / `.controller`"; in this spec, registration is config-block-only via `$compileProvider.directive`
- **Module DSL `.component` and `.controller`** — same module-DSL bullet; deferred
- **Isolate scope `{...}` with binding modes `=`, `<`, `@`, `&`** — substantial complexity warranting its own spec slice; rejected at registration time so future addition is non-breaking
- **Transclusion (`transclude` DDO option, `$transclude` link argument, `ng-transclude`)** — separate roadmap bullet "Transclusion"
- **Template loading (`template`, `templateUrl`, `replace` DDO options; `<script type="text/ng-template">`)** — separate roadmap bullet "Template Loading"
- **Controllers (`controller`, `controllerAs`, `bindToController`, `require` DDO options; `$controller` service; `$controllerProvider`)** — separate roadmap bullet "Controllers (`$controller`)"
- **Built-in directives** (`ng-if`, `ng-repeat`, `ng-class`, `ng-show`, `ng-bind`, `ng-bind-html`, `ng-click`, `ng-model`, etc.) — separate roadmap bullet "Built-in Directives"
- **Multi-element directives (`multiElement: true`, `*-start`/`*-end` pairs)** — deferred; will land alongside `ng-repeat` in a future spec
- **`$compileProvider.commentDirectivesEnabled(bool)` and `.cssClassDirectivesEnabled(bool)` toggles** — comment and class directives are always on in this spec; toggles deferred
- **`$compileProvider.aHrefSanitizationTrustedUrlList(regex)` and `.imgSrcSanitizationTrustedUrlList(regex)`** — config for the future `a` / `ng-href` / `ng-src` / `ng-srcset` directives, all of which are deferred
- **`$compileProvider.debugInfoEnabled(bool)`** — adds debug-only `ng-scope` / `ng-isolate-scope` CSS classes; pure debug aid; deferred
- **String-input compilation** — `$compile('<my-dir></my-dir>')` is NOT supported; callers parse strings to DOM nodes themselves (`new DOMParser().parseFromString(...)` or a `<template>` element). Adding string input is a small future addition if demand surfaces
- **jqLite (`angular.element`)** — Phase 5 compatibility-layer concern; this spec passes raw DOM nodes deliberately. The future jqLite-compat wrapper may layer on top without changing the link signature
- **`$rootScope` registration on `ngModule`** — separate roadmap bullet "Application Bootstrap > `$rootScope` registration on `ngModule`"; in this spec, tests construct `Scope.create()` directly
- **Application Bootstrap (`bootstrapInjector`, `bootstrap`, `autoBootstrap`)** — separate roadmap bullet; this spec lands ahead of bootstrap, so tests instantiate the injector via `createInjector([…, 'ng'])` and call `$compile(node)(scope)` explicitly
- **Service Text Diagrams (Phase 2 wrap-up)** — separate roadmap bullet; the per-service text diagram for `$compile` will land with that wrap-up
- **`ng-bind-html` directive integration** — explicitly deferred under "HTML Sanitization" pending `$compile`; this spec only delivers the compiler pieces, not the directive itself
- **Phase 5 `angular.module` namespace** — `angular.module(...).directive(...)` (when `.directive` ships) lands automatically because it'll be a thin wrapper over `createModule`; no extra wiring in this spec
- **`$q`, `$timeout`, `$interval`, `$http`, Forms, Routing, Animations** — separate phases per the roadmap
- **Performance optimizations** — straightforward implementations using native DOM APIs (no virtual DOM, no diffing). No memoization beyond the directive-singleton caching already provided by `$injector` and the per-template compile-phase work that runs once
