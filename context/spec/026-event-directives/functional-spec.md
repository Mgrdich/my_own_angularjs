# Functional Specification: Event Directives

- **Roadmap Item:** Phase 2 → Directives & DOM Compilation → Built-in Directives (Mouse + Keyboard + Clipboard/focus/form-lifecycle event subsets — three sub-bullets bundled)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Specs 023, 024, and 025 shipped the **declarative** half of the built-in directive surface — drive visible state from scope expressions, drive class lists and styles, drive URL/boolean attributes. What's still missing is the **imperative** half: directives that let a template react to user interaction by running scope expressions.

Eighteen directives ship in this batch, all built on a single mechanical pattern: register a native DOM event listener; when the event fires, evaluate the bound scope expression inside `scope.$apply()` so the resulting state changes flow through the digest cycle and reach the rest of the application. The native event object is made available as `$event` inside the expression, so handlers can read event properties like `target`, `key`, or `clientX` without writing custom JavaScript wrappers.

The eighteen directives, organized by event family:

**Mouse events** (9 directives):

1. **`ng-click`** — element clicked.
2. **`ng-dblclick`** — element double-clicked.
3. **`ng-mousedown`** — mouse button pressed.
4. **`ng-mouseup`** — mouse button released.
5. **`ng-mouseover`** — mouse pointer moves over.
6. **`ng-mouseout`** — mouse pointer leaves.
7. **`ng-mousemove`** — mouse pointer moves within.
8. **`ng-mouseenter`** — mouse enters (doesn't bubble).
9. **`ng-mouseleave`** — mouse leaves (doesn't bubble).

**Keyboard events** (3 directives):

10. **`ng-keydown`** — key pressed.
11. **`ng-keyup`** — key released.
12. **`ng-keypress`** — key typed (deprecated browser-side, but AngularJS still ships it).

**Clipboard events** (3 directives):

13. **`ng-copy`** — clipboard copy.
14. **`ng-cut`** — clipboard cut.
15. **`ng-paste`** — clipboard paste.

**Focus events** (2 directives):

16. **`ng-focus`** — element gains focus.
17. **`ng-blur`** — element loses focus.

**Form-lifecycle events** (1 directive):

18. **`ng-submit`** — `<form>` submitted.

**Why one spec for all eighteen.** The roadmap explicitly notes these "may bundle" because they share exactly one mechanical pattern. Implementing each as a separate spec would mean 18 near-identical artifacts. Bundling them as one spec, one source file, and one factory helper (parameterized by event name) is the AngularJS-canonical approach — the upstream framework uses a single `forEach` over the event-name list to generate the directives.

**Success looks like:** a developer can write `<button ng-click="save(item, $event)">` or `<input ng-keydown="handleKey($event)">` and observe correct behavior — the expression runs on every event, gets the native event object as `$event`, and any scope changes made by the handler are picked up by the next digest without manual `$apply` calls.

---

## 2. Functional Requirements (The "What")

### 2.1 The single event-binding pattern

- **As a template author**, I want to bind a scope expression to a native DOM event on an element, so the expression runs whenever the user triggers that event.
  - **Acceptance Criteria:**
    - [x] Each of the eighteen directives, when written as an attribute on an element (e.g. `<button ng-click="save()">`), registers a listener for the corresponding native DOM event on that element.
    - [x] When the event fires, the directive evaluates the bound expression with the scope as its context.
    - [x] The expression is evaluated **inside `scope.$apply(...)`** — state changes made by the expression trigger a digest, so other parts of the application that watch related state see the update.
    - [x] If the expression throws, the error is reported through the framework's exception handler (the digest's standard error-routing path); the listener does not crash the page, and subsequent events still fire correctly.
    - [x] The directive only matches **as an attribute** — `<ng-click>` (element form) and class-based forms (`<button class="ng-click: …">`) do not trigger it. This is the AngularJS-canonical restriction.

### 2.2 The `$event` local

- **As a template author**, I want to read properties of the native event (e.g. the pressed key, the target element, the mouse coordinates) inside the handler expression, so I can branch behavior on the event details without writing a separate JavaScript helper.
  - **Acceptance Criteria:**
    - [x] Inside the bound expression, the identifier `$event` resolves to the native DOM event object that fired the listener.
    - [x] `$event` is **local to the expression evaluation** — it is not assigned to the scope and does not persist beyond that single invocation.
    - [x] The expression can pass `$event` to a scope function: `<button ng-click="handle($event)">` calls `scope.handle(theNativeEvent)`.
    - [x] The expression can read properties directly: `<input ng-keydown="key = $event.key">` assigns the pressed key to a scope property.

### 2.3 Listener cleanup

- **As a framework consumer**, I want event listeners attached by these directives to clean up automatically when the surrounding scope is destroyed, so the application does not leak listeners or fire handlers against destroyed scopes.
  - **Acceptance Criteria:**
    - [x] When the element's scope is destroyed (via the standard scope-destruction mechanism), the event listener is removed from the element.
    - [x] After scope destruction, a subsequently-fired event on the same element (if any reference to it persists) does not invoke the expression.

### 2.4 Multiple event directives on the same element

- **As a template author**, I want to attach multiple event handlers to the same element via different `ng-*` directives, so a single button can respond to clicks, mouseovers, and keyboard focus independently.
  - **Acceptance Criteria:**
    - [x] An element with multiple event directives (e.g. `<button ng-click="a()" ng-mouseover="b()" ng-focus="c()">`) registers each as an independent listener.
    - [x] Each listener fires only for its own event and runs only its own bound expression.
    - [x] The relative order of listener registration matches the order the directives are listed on the element (mirrors AngularJS-canonical).

### 2.5 Module integration

- **As a framework consumer**, I want all eighteen directives available without doing anything special — loading the core framework should make them work.
  - **Acceptance Criteria:**
    - [x] All eighteen directives are registered automatically when an app's module declares a dependency on the core framework module.
    - [x] A developer can replace any of them via the standard module-DSL mechanisms (`.directive`, `.decorator`) — these are built-ins, not hardcoded behavior.

---

## 3. Scope and Boundaries

### In-Scope

- The eighteen directives listed above.
- The single shared mechanical pattern (register native listener, evaluate expression in `$apply`, expose `$event`).
- Automatic listener cleanup on scope destruction.

### Out-of-Scope

- **The `event` global alias** — AngularJS 1.x's expression context also allowed an unprefixed `event` reference to the native event object as a synonym for `$event`. This spec ships only `$event`; the `event` alias is deferred (it conflicts with the global `window.event` and is not idiomatic).
- **Automatic `preventDefault` / `stopPropagation`** — these directives DO NOT auto-call `preventDefault` or `stopPropagation` on the native event. If a `<form ng-submit="…">` should not reload the page, the consumer either omits the form's `action` attribute (the browser then has nothing to navigate to) or calls `$event.preventDefault()` in their handler expression.
- **Drag-and-drop events** (`dragstart`, `drop`, etc.) — AngularJS 1.x does not ship `ng-drag*` directives in its core; consumers use the upstream `ngTouch` module or write custom directives. Out of scope here.
- **Touch events** (`touchstart`, `touchend`, etc.) — these are part of the upstream `ngTouch` module, not core. Out of scope.
- **Structural / flow-control directives** (`ng-if`, `ng-repeat`, `ng-switch`, `ng-include`, `ng-init`, `ng-controller`) — separate "Structural / flow control" sub-bullet.
- **Form-element directives** (`form`, `input`, `select`, `textarea`, `ng-model`, `ng-options`) — Phase 3, Forms & Validation roadmap item.
- **`ng-pluralize`**, **`ng-csp`** / **`ng-jq`** / **`ng-ref`**, **`<script>` template registration**, **`<a>` empty-href guard** — separate sub-bullets.
- **Application bootstrap, `$q`, `$http`, routing, animations, the `angular.*` compat layer** — later roadmap items.
