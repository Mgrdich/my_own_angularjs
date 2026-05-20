# Functional Specification: Components & Isolate Scope

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Directives & DOM Compilation (Components & isolate scope — `$compileProvider.component` + `.component` DSL)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Today a directive can share its parent's scope (`scope: false`) or get a child scope that still inherits everything from the parent (`scope: true`) — but it cannot get a genuinely *isolated* scope. The object form `scope: { … }` is rejected outright at registration. This means every directive's internal state leaks into, and is polluted by, whatever scope it happens to land on. There is no way to declare "these are my inputs, this is my output, and nothing else crosses the boundary."

Controllers (shipped in spec 020) attach behaviour to an element, but they receive their inputs only by reaching into the shared scope or reading raw attributes; they have no structured input declaration, no lifecycle notifications, and no way to talk to a controller on an ancestor element.

This specification adds the full AngularJS component model — the missing half of "Directives & DOM Compilation":

1. **Isolate scope** — a directive declares a typed boundary (`scope: { … }`) and gets a scope that does not inherit from its parent. Four binding kinds cross that boundary: two-way (`=`), one-way text (`@`), one-way (`<`), and expression/callback (`&`).
2. **`bindToController`** — the same bindings can be delivered onto the controller instance instead of the scope, so a controller is a self-contained unit with its inputs as properties.
3. **Lifecycle hooks** — a controller can implement `$onInit`, `$onChanges`, `$onDestroy`, and `$postLink` to run code at well-defined moments instead of guessing from link timing.
4. **`require`** — a directive or component can ask for the controller of another directive on its own element or an ancestor, and receive it wired in automatically.
5. **`$compileProvider.component(name, def)`** — the AngularJS 1.5+ shorthand that bundles "isolate scope + controller + template + bindToController" into one concise definition object, with sensible defaults.
6. **`.component(name, def)`** — the module-builder shortcut for it, matching the `.directive` / `.controller` / `.filter` family.

**Success looks like:** a developer can write

```js
createModule('app', ['ng']).component('userCard', {
  bindings: { user: '<', onSelect: '&' },
  controller: ['$element', function ($element) {
    this.$onInit = () => { /* this.user is ready */ };
    this.pick = () => this.onSelect({ id: this.user.id });
  }],
  template: '<div class="card" ng-click="$ctrl.pick()">{{ $ctrl.user.name }}</div>',
});
```

…and observe a `<user-card user="someExpr" on-select="handler(id)">` element get its own isolated scope, its `user` input kept in sync one-way, its `onSelect` output callable, its controller exposed to the template as `$ctrl`, and its `$onInit` fired once the inputs are ready.

---

## 2. Functional Requirements (The "What")

### 2.1 Isolate scope with bindings

- **As a directive author**, I want my directive to declare an isolated scope so its internal state neither leaks into nor is polluted by the surrounding scope.
  - **Acceptance Criteria:**
    - [x] A directive whose definition includes `scope: { … }` (the object form) is accepted at registration — it no longer produces an "isolate scope is not supported" error.
    - [x] An element matched by such a directive gets a scope that does **not** prototypically inherit from its parent scope: a name defined on the parent scope is not visible on the isolate scope unless an explicit binding brings it in.
    - [x] If two directives on the same element both request an isolate scope, the developer sees a clear, human-readable error naming the conflict.
    - [x] A directive with an isolate scope still links its own template and children against that isolate scope; sibling and ancestor elements are unaffected.

- **As a directive author**, I want four kinds of binding so I can declare exactly how each input or output crosses the isolate boundary.
  - **Acceptance Criteria:**
    - [x] **Two-way (`=`)** — `scope: { value: '=' }` keeps the local `value` and the parent expression in sync in both directions: a change on either side is reflected on the other.
    - [x] **One-way text (`@`)** — `scope: { label: '@' }` sets the local `label` to the interpolated string value of the matching attribute, and updates it whenever that interpolated value changes. Writing to the local does not affect the attribute.
    - [x] **One-way (`<`)** — `scope: { item: '<' }` sets the local `item` to the value of the parent expression and updates it when the parent value changes; writing to the local does not propagate back to the parent.
    - [x] **Expression / callback (`&`)** — `scope: { onDone: '&' }` makes the local `onDone` a function that, when called, evaluates the parent expression; the caller may pass a map of local values the parent expression can reference.
    - [x] **Optional bindings (`?`)** — a binding marked optional (e.g. `'<?'`) does not error when the corresponding attribute is absent; the local is simply left unset.
    - [x] **Attribute aliasing** — a binding may name a different source attribute than the local name (e.g. `scope: { localName: '<sourceAttr' }`), binding the local to the `source-attr` attribute.
    - [x] A malformed binding declaration produces a clear, human-readable error explaining the expected `=`, `@`, `<`, `&` (with optional `?` and alias) format.

### 2.2 `bindToController`

- **As a directive/component author**, I want my declared bindings delivered onto the controller instance instead of the scope, so the controller is a self-contained unit with its inputs as its own properties.
  - **Acceptance Criteria:**
    - [x] A directive with `bindToController: true` and a `scope: { … }` (or `bindings: { … }`) map exposes every binding as a property on the controller instance rather than on the isolate scope.
    - [x] A directive with `bindToController: { … }` (the object form) takes the binding map from `bindToController` directly.
    - [x] When `bindToController` is in effect, all bindings are populated on the controller instance **before** the controller's `$onInit` hook runs.

### 2.3 Lifecycle hooks

- **As a controller author**, I want well-defined lifecycle moments so I can run setup, react to input changes, and clean up without inferring timing from link functions.
  - **Acceptance Criteria:**
    - [x] **`$onInit()`** — if the controller defines it, it is called once after the controller is constructed and its bound inputs are populated, and before the element's post-link runs.
    - [x] **`$onChanges(changes)`** — if the controller defines it, it is called once initially and again whenever a one-way input (`<` or `@`) changes; `changes` maps each changed binding name to an object exposing the current value, the previous value, and a way to tell whether this is the first change.
    - [x] **`$onDestroy()`** — if the controller defines it, it is called when the controller's scope is destroyed.
    - [x] **`$postLink()`** — if the controller defines it, it is called after the element and all its child elements have been linked.
    - [x] A controller that defines none of these hooks behaves exactly as it does today — the hooks are entirely opt-in.

### 2.4 `require` — referencing other controllers

- **As a directive/component author**, I want to ask for the controller of another directive on my element or an ancestor, and receive it wired in automatically.
  - **Acceptance Criteria:**
    - [x] `require: 'someDirective'` (string form), `require: ['a', 'b']` (array form), and `require: { alias: 'someDirective' }` (object form) are all accepted.
    - [x] A plain name requires the controller on the **same element**; the `^` prefix searches the element and its ancestors; the `^^` prefix searches ancestors only; the `?` prefix marks the requirement optional.
    - [x] The resolved controllers are passed to the requiring directive's link function as an additional argument; when the requiring directive has its own controller, the resolved controllers are also assigned onto that controller (under the array index or object alias) before `$onInit` runs. *(Implementation deviation: object form auto-assigns onto the requiring controller's instance; string and array forms deliver the resolved controllers exclusively via the link fn's 4th argument. Documented in `tasks.md` "Slice 4 Implementation Notes" — matches the AngularJS-canonical reading where the meaningful "alias" exists only in the object form.)*
    - [x] A required controller that cannot be found, and was **not** marked optional with `?`, produces a clear, human-readable error naming the missing requirement.
    - [x] An optional (`?`) requirement that cannot be found yields an empty/absent value instead of an error.

### 2.5 `$compileProvider.component`

- **As a developer**, I want a concise way to define a component without spelling out the full directive definition every time.
  - **Acceptance Criteria:**
    - [x] `$compileProvider.component(name, definition)` registers a component and returns the provider so the call can be chained.
    - [x] The component definition object accepts `template` / `templateUrl`, `controller`, `controllerAs`, `bindings`, `transclude`, and `require`.
    - [x] A component is, by default: restricted to element form, given an isolate scope, has its `bindings` bound to the controller, and exposes its controller to the template under `controllerAs` — which defaults to `$ctrl` when not specified.
    - [x] A component registered this way is matched, linked, and behaves identically to the equivalent hand-written directive definition.
    - [x] An invalid component definition produces a clear, human-readable error.

### 2.6 `.component` module DSL

- **As a developer**, I want to register a component directly on the module builder, consistent with `.directive` / `.controller` / `.filter`.
  - **Acceptance Criteria:**
    - [x] `module.component('myThing', definition)` registers the component and returns the module builder so the call can be chained.
    - [x] A component registered this way is stored in the same registry and behaves identically to one registered through `$compileProvider.component` in a configuration block.
    - [x] `.component` chains freely with every other module-builder method in any order.

---

## 3. Scope and Boundaries

### In-Scope

- Isolate scope (`scope: { … }`) with all four binding kinds — `=`, `@`, `<`, `&` — plus the optional (`?`) modifier and attribute aliasing.
- `bindToController` (both the `true` and object forms).
- The four controller lifecycle hooks: `$onInit`, `$onChanges`, `$onDestroy`, `$postLink`.
- The `require` field — string / array / object forms, with the `^`, `^^`, and `?` flags.
- `$compileProvider.component(name, def)` and the `.component(name, def)` module-DSL wrapper, with the AngularJS 1.5+ component defaults.

### Out-of-Scope

- **The `ng-controller` built-in directive** — separate "Built-in Directives" roadmap item.
- **All other built-in directives** (`ng-if`, `ng-repeat`, `ng-class`, …) — separate roadmap item.
- **Multi-element directives** (`*-start` / `*-end`) — not introduced here.
- **Application bootstrap, `$q`, `$http`, forms, routing, animations, and the `angular.*` compatibility layer** — later roadmap items.
