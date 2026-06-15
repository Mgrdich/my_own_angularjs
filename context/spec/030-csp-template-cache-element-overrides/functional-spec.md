# Functional Specification: CSP, Template-Cache & Element-Override Directives

- **Roadmap Item:** Built-in Directives — CSP / template-cache / element overrides: `ng-csp`, `ng-jq`, `ng-ref`, `script`, `a`
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

This is the **final batch of built-in directives** on the Phase 2 roadmap. It closes out the classic AngularJS core-directive surface with five small pieces that don't fit the earlier thematic batches:

- **Reusable inline templates** (`<script type="text/ng-template">`): today, every reusable template must be fetched from a separate file. Classic AngularJS lets authors embed named template blocks directly in the page and reference them anywhere a template name is accepted — no network round-trip, everything in one file. Pages migrated from AngularJS rely on this heavily.
- **Element references** (`ng-ref`, AngularJS 1.7+): a component's surrounding markup sometimes needs to call into it (e.g. a "play" button next to an audio player component). `ng-ref` publishes the component's interface under an author-chosen name so sibling markup can reach it declaratively, without custom plumbing.
- **Anchor safety** (`a` override): authors write `<a href="">` or href-less anchors as click handles; without intervention, clicking one reloads the page and silently destroys application state. The override makes such clicks inert. We additionally harden "open in new tab" links against the well-known reverse-tabnabbing attack — a deliberate modern improvement over classic AngularJS.
- **Migration compatibility switches** (`ng-csp`, `ng-jq`): in classic AngularJS these reconfigure engine internals (expression compilation under Content-Security-Policy; jQuery selection). This framework never had those internals to reconfigure — it is CSP-safe by construction and uses the plain DOM. Both attributes are accepted as **documented no-ops** so migrated pages work unchanged.

**Success criteria:**

- A page migrated from classic AngularJS that uses inline named templates, `ng-ref`, placeholder anchors, `ng-csp`, or `ng-jq` renders and behaves correctly with no template changes.
- New-tab links are protected against reverse tabnabbing automatically.
- Behavior covered by the standard test suite at the usual coverage bar.

---

## 2. Functional Requirements (The "What")

### 2.1. Reusable inline templates (`<script type="text/ng-template">`)

- **As a** template author, **I want to** define a named template inline in my page, **so that** views, includes, and components can use it by name without a separate file or network fetch.
- A `<script>` block with type `text/ng-template` and a name (its `id` attribute) registers its content as a template under that name when the framework processes the markup containing it.
- The block's content is **never executed as code** and **never rendered** where it stands — it only becomes available under its name.
- Anywhere a template name is accepted (`ng-include`, a directive's template-by-name), the registered name resolves to the inline content with **no network request**.
- A `text/ng-template` script **without a name is ignored** (nothing registered, no error).
- Regular scripts (no type, or any other type) are completely unaffected.
- A block registered later under an already-used name **replaces** the earlier content (last wins).

**Acceptance Criteria:**

- [x] Given `<script type="text/ng-template" id="hello.html">Hello {{name}}!</script>` in processed markup, an `<div ng-include="'hello.html'">` elsewhere on the page displays "Hello Igor!" (with `name` = "Igor") without any network fetch.
- [x] The script block itself displays nothing where it is written.
- [x] A directive whose template name matches a registered inline template renders the inline content.
- [x] A normal `<script>` (e.g. `type="text/javascript"`) in processed markup is untouched and still behaves as a regular script.
- [x] A `text/ng-template` script with no `id` registers nothing and produces no error.

### 2.2. Element references (`ng-ref` / `ng-ref-read`)

- **As a** template author, **I want to** publish a component's interface under a name, **so that** sibling markup can interact with it (read values, call its operations) declaratively.
- `ng-ref="someName"` on a component publishes that component's controller into the surrounding data under `someName`, from the moment the component is set up.
- On an element with **no** component controller, `ng-ref` publishes the **element itself**.
- `ng-ref-read="directiveName"` selects WHICH directive's controller to publish when several are present; `ng-ref-read="$element"` forces publishing the element itself.
- When the referenced element is removed (e.g. its enclosing `ng-if` turns false), the published name is **cleared** so stale references aren't left behind.
- The chosen name must be a valid assignable name (a simple name or dotted path). An invalid or empty name is reported through the framework's standard error-reporting channel and nothing is published.

**Acceptance Criteria:**

- [x] Given `<my-player ng-ref="player">` and a sibling `<button ng-click="player.play()">`, clicking the button invokes the component's `play()`.
- [x] `<span ng-ref="el">` (no controller) publishes the span element itself under `el`.
- [x] `ng-ref-read="$element"` on a component publishes the element, not the controller.
- [x] With two directives carrying controllers on one element, `ng-ref-read="<one of their names>"` publishes that specific controller.
- [x] When the element sits inside `ng-if` and the condition turns false, the published name becomes empty/cleared; turning it true again re-publishes.
- [x] `ng-ref="123bad"` reports an error through the configured error handler and publishes nothing; the rest of the page keeps working.

### 2.3. Anchor override — empty-link guard

- **As a** user of the app, **I want** clicking a placeholder link (no destination) to do nothing, **so that** the page doesn't reload and lose my work.
- Clicking an anchor whose destination is missing or empty **at the moment of the click** is made inert (no navigation, no reload). The check is live: a link that later receives a real destination (e.g. via `ng-href` once data loads) navigates normally from then on.
- Anchors with a real destination are completely unaffected.

**Acceptance Criteria:**

- [x] Given `<a href="">Click</a>` in processed markup, clicking it causes no navigation/reload.
- [x] Given `<a ng-href="{{url}}">` while `url` is still empty, clicking does nothing; after `url` becomes "https://example.com", clicking navigates there.
- [x] A normal `<a href="https://example.com">` behaves exactly as it would without the framework.

### 2.4. Anchor override — new-tab safety

- **As a** user of the app, **I want** links that open in a new tab to be protected, **so that** the opened page cannot take control of (redirect) the page I came from — the "reverse tabnabbing" attack.
- Any processed anchor that opens in a new browsing context (`target="_blank"`) automatically receives the protective relationship attributes (`noopener` and `noreferrer`), **added to** — never replacing — whatever relationship values the author already set. (Deliberate improvement over classic AngularJS.)
- Anchors without a new-tab target are untouched.

**Acceptance Criteria:**

- [x] Given `<a href="https://example.com" target="_blank">` in processed markup, the rendered link carries `rel` values including `noopener` and `noreferrer`.
- [x] Given the same link with `rel="license"` already present, the rendered link keeps `license` and gains `noopener noreferrer`.
- [x] A link without `target="_blank"` gets no `rel` changes.

### 2.5. Compatibility switches (`ng-csp`, `ng-jq`) — documented no-ops

- **As a** developer migrating a classic AngularJS app, **I want** `ng-csp` and `ng-jq` attributes to be accepted without errors, **so that** my templates work unchanged.
- Both attributes are recognized and deliberately do nothing — no behavior change, no warning, no error — in any of their classic value forms (`ng-csp`, `ng-csp="no-unsafe-eval"`, `ng-csp="no-inline-style"`, `ng-jq`, `ng-jq="jQuery"`).
- The user-facing documentation states **why**: this framework never compiles expressions via `eval`-like mechanisms and never injects inline styles (CSP-safe by construction), and it operates on the plain DOM (no jQuery layer to select; a compatibility wrapper is a separate future roadmap item).

**Acceptance Criteria:**

- [x] A page whose root element carries `ng-csp` renders identically to the same page without it, with no errors or warnings.
- [x] The same holds for `ng-csp="no-unsafe-eval"`, `ng-csp="no-inline-style"`, `ng-jq`, and `ng-jq="jQuery"`.
- [x] The project documentation explains both attributes' no-op status and the rationale.

---

## 3. Scope and Boundaries

### In-Scope

- Inline named-template registration via `<script type="text/ng-template" id="…">` and its resolution through every name-accepting template consumer.
- `ng-ref` with full `ng-ref-read` support (specific controller by name, `$element`), publish-on-setup, clear-on-removal, invalid-name error reporting.
- The anchor override: live empty-destination click guard + automatic `noopener noreferrer` for new-tab links.
- `ng-csp` and `ng-jq` as accepted, documented no-ops in all classic value forms.

### Out-of-Scope

- **Other roadmap items** (separate specifications): Service Text Diagrams, Application Bootstrap, all of Phase 3 (forms, HTTP, promises), Phase 4 (routing, animations, packaging), and Phase 5 (the `angular` compatibility namespace and element wrapper — which is also where `ng-jq` could ever gain real meaning).
- **Making `ng-csp` configure anything** — there is nothing to configure; the framework's CSP safety is structural.
- **A jQuery/jqLite layer** — Phase 5.
- **Form-element directives** (`form`, `input`, `select`, `textarea`) and `ng-model` — Phase 3, per the roadmap.
- **Blocking or rewriting link destinations** — URL trust/sanitization is already covered by the existing security layer; this spec only adds the click guard and new-tab relationship attributes.
