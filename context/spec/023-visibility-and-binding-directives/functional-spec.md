# Functional Specification: Visibility & Binding Directives

- **Roadmap Item:** Phase 2 → Directives & DOM Compilation → Built-in Directives (Visibility + Binding subsets)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 022 closed the directive-authoring half of "Directives & DOM Compilation": you can now write your own directives, components, isolate scopes, and lifecycle hooks. But for an app to actually _use_ the framework, it needs the built-in directives that handle the day-to-day mechanics: showing/hiding elements, binding text into the DOM, escaping content the framework should not interpret, and dropping a literal HTML chunk under a controlled trust boundary.

This specification ships the first cohesive batch of those built-ins — the **visibility** and **binding** directives:

1. **`ng-show`** / **`ng-hide`** — toggle an element's visibility based on whether an expression is truthy or falsy.
2. **`ng-cloak`** — prevent the brief flash of un-rendered `{{ expression }}` markup before the framework finishes compiling the page.
3. **`ng-bind`** / **`ng-bind-template`** — set an element's text content from a single expression or a template string, without writing `{{ }}` mustaches inline.
4. **`ng-bind-html`** — set an element's _HTML_ content from an expression, routed through the strict-contextual-escaping pipeline so untrusted strings don't sneak in.
5. **`ng-non-bindable`** — mark a subtree as "don't compile this" so literal `{{ }}` and directive-looking text inside it is preserved verbatim (e.g. for documentation pages, code samples).

**Why this batch first.** These seven directives share three properties that make them a natural opening slice:

- They depend only on services that already exist: `$compile`, `$interpolate`, `$sce` (and optionally `$sanitize`). No new infrastructure required.
- They are all **non-structural** — they don't add, remove, or repeat DOM nodes. Structural directives (`ng-if`, `ng-repeat`, `ng-switch`, `ng-include`) are deferred to a follow-up spec because each one is substantial on its own.
- They cover the most common templating needs for any non-trivial app: hide a panel, bind a value, render trusted markup. Without them, the framework can't be meaningfully used to build a page.

**Success looks like:** a developer can write a page that uses each of these directives and observe the documented behavior — visibility toggling, text/HTML binding, untrusted-HTML routing through `$sce`, and pre-compilation hiding — without any further framework work.

---

## 2. Functional Requirements (The "What")

### 2.1 `ng-show` and `ng-hide` — visibility toggles

- **As a template author**, I want to declaratively show or hide an element based on an expression, so the visible UI reflects the current application state.
  - **Acceptance Criteria:**
    - [x] `ng-show="expr"` adds the CSS class `ng-hide` to the element whenever `expr` evaluates to a falsy value, and removes it whenever `expr` is truthy.
    - [x] `ng-hide="expr"` is the inverse: the class is added when `expr` is **truthy**, removed when **falsy**.
    - [x] The class transition is observed every digest — a change to the expression's referenced state is reflected on the next digest cycle without any manual refresh.
    - [x] Other classes already on the element are preserved when `ng-hide` is added or removed.
    - [x] The framework documents (in the compiler README) the small CSS rule that gives `ng-hide` its visual effect (`.ng-hide { display: none !important; }`), and notes that consumers ship it themselves — no CSS file is auto-injected by the framework.

### 2.2 `ng-cloak` — prevent uncompiled-template flash

- **As a template author**, I want my un-compiled `{{ … }}` markup to stay hidden until the framework has rendered the page, so users don't briefly see literal mustaches before initial render.
  - **Acceptance Criteria:**
    - [x] An element written with `ng-cloak` (as either an attribute, `<div ng-cloak>…</div>`, or a class, `<div class="ng-cloak">…</div>`) has both the `ng-cloak` attribute and the `ng-cloak` class removed once the framework's compiler reaches it.
    - [x] The directive does not watch any expression — its only job is the one-shot cleanup at compile time.
    - [x] The framework documents (in the compiler README) the CSS rule that hides cloaked elements before compilation (`[ng-cloak], .ng-cloak { display: none !important; }`), and notes that consumers ship it themselves.

### 2.3 `ng-bind` — bind a single expression's value as text

- **As a template author**, I want to set an element's text content from an expression in a way that doesn't briefly show the un-compiled expression, so the page can never show literal `{{ user.name }}` to a user.
  - **Acceptance Criteria:**
    - [x] `<span ng-bind="expr"></span>` sets the element's text content to the current string value of `expr`.
    - [x] When the value referenced by `expr` changes, the text content updates on the next digest.
    - [x] The text content is **escaped** — any HTML special characters in the value appear literally in the rendered text (no markup is interpreted).
    - [x] When `expr` evaluates to `null` or `undefined`, the rendered text is the empty string (no literal `"null"` or `"undefined"` appears).

### 2.4 `ng-bind-template` — bind an interpolated template string as text

- **As a template author**, I want to bind a string that mixes literal text with multiple expressions, without sprinkling `{{ }}` mustaches into the DOM where they could briefly appear before compilation.
  - **Acceptance Criteria:**
    - [x] `<span ng-bind-template="Hello {{name}}, today is {{day}}"></span>` sets the element's text content to the interpolated string (with each `{{ … }}` segment replaced by its current expression value).
    - [x] When any referenced expression's value changes, the text content updates on the next digest.
    - [x] Like `ng-bind`, the rendered content is text — HTML special characters are escaped, not interpreted.
    - [x] An empty template string is accepted and renders as an empty string.

### 2.5 `ng-bind-html` — bind an expression's value as trusted HTML

- **As a template author**, I want to render the result of an expression as actual HTML (so a string like `"<b>hi</b>"` becomes bold text), but only when the framework can verify the HTML is safe to insert.
  - **Acceptance Criteria:**
    - [x] `<div ng-bind-html="expr"></div>` evaluates `expr`, hands the value through the framework's HTML-trust pipeline, and sets the element's `innerHTML` to the resulting string.
    - [x] The trust pipeline is the existing `$sce.getTrustedHtml(value)` — the directive does not invent its own check.
    - [x] When the framework's HTML-sanitization module is loaded (`ngSanitize`), an untrusted plain string is sanitized and rendered with disallowed tags / attributes stripped (the existing $sce-to-$sanitize integration).
    - [x] When the framework's HTML-sanitization module is **not** loaded and the value is an untrusted plain string, the existing trust error surfaces — `ng-bind-html` does not silently render unverified HTML.
    - [x] When the value referenced by `expr` changes, the rendered HTML updates on the next digest.

### 2.6 `ng-non-bindable` — opt a subtree out of compilation

- **As a template author**, I want to mark a subtree of the page (e.g. a code sample, a documentation block, a developer-tools panel) as content the framework should leave alone, so literal `{{ }}` and directive-looking text appears verbatim.
  - **Acceptance Criteria:**
    - [x] `<pre ng-non-bindable>{{ this stays literal }}</pre>` renders with the `{{ }}` text preserved exactly as written — no expression evaluation, no directive matching on the children.
    - [x] Directives declared on **child** elements inside an `ng-non-bindable` subtree do not run.
    - [x] The element bearing `ng-non-bindable` itself still respects directives declared on it directly (e.g. the developer can put `class="foo"` on it and the class is preserved).
    - [x] Siblings and ancestors of the `ng-non-bindable` element are unaffected — the opt-out is scoped to the subtree.

### 2.7 Module integration

- **As a framework consumer**, I want all seven directives available without doing anything special — loading the core framework should make them work.
  - **Acceptance Criteria:**
    - [x] All seven directives are registered automatically when an app's module declares a dependency on the core framework module.
    - [x] A developer can replace any one of them via the standard module-DSL mechanisms (`.directive`, `.decorator`) — these are built-ins, not hardcoded behavior.

---

## 3. Scope and Boundaries

### In-Scope

- The seven directives listed above: `ng-show`, `ng-hide`, `ng-cloak`, `ng-bind`, `ng-bind-template`, `ng-bind-html`, `ng-non-bindable`.
- Documentation of the consumer-shipped CSS rules required for `ng-show`/`ng-hide`/`ng-cloak` to produce their visual effects.

### Out-of-Scope

- **Animations / `$animate` integration** — toggling `ng-hide` does not run any enter/leave animation hooks. Animations are a separate Phase 4 roadmap item; visibility transitions are synchronous in this spec.
- **A bundled CSS file** — the framework documents the small CSS rules consumers need, but does not auto-inject any stylesheet at runtime.
- **The `ng-bind-html-unsafe` directive** — AngularJS 1.x deprecated this years ago; this project will not ship it.
- **Class- and style-related directives** (`ng-class`, `ng-class-even`, `ng-class-odd`, `ng-style`) — separate "Class / style" sub-bullet under Built-in Directives.
- **Structural / flow-control directives** (`ng-if`, `ng-repeat`, `ng-switch`, `ng-switch-when`, `ng-switch-default`, `ng-include`, `ng-init`, `ng-controller`) — separate "Structural / flow control" sub-bullet.
- **Attribute-helper directives** (`ng-href`, `ng-src`, `ng-srcset`, `ng-disabled`, `ng-checked`, `ng-readonly`, `ng-selected`, `ng-open`) — separate "Attribute helpers" sub-bullet.
- **Event directives** (`ng-click`, `ng-keydown`, `ng-focus`, etc.) — separate sub-bullet.
- **Form-element directives** (`form`, `input`, `select`, `textarea`, `ng-model`, `ng-options`) — Phase 3, Forms & Validation roadmap item.
- **`ng-pluralize`** — separate sub-bullet.
- **`ng-csp`, `ng-jq`, `ng-ref`** — separate sub-bullet.
- **Application bootstrap, `$q`, `$http`, routing, animations, the `angular.*` compat layer** — later roadmap items.
