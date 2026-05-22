# Functional Specification: Attribute Helper Directives

- **Roadmap Item:** Phase 2 → Directives & DOM Compilation → Built-in Directives (Attribute helpers subset)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 023 and spec 024 shipped the **content** half of static directives (binding text/HTML, hiding elements) and the **styling** half (driving classes and inline styles). What's still missing is the third foundational category: directives that drive the element's standard HTML attributes — URLs, image sources, and boolean flags like `disabled` and `checked`.

These directives exist because of two specific bugs in the way browsers handle un-compiled AngularJS templates:

1. **Browsers eagerly resolve URLs before the framework compiles the template.** A literal `<a href="{{userProfileUrl}}">` will let the user navigate to the literal URL `"{{userProfileUrl}}"` if they click before compilation finishes. Same for `<img src="{{photoUrl}}">` — the browser fires a network request for `"{{photoUrl}}"`, which 404s. The fix is a parallel attribute: `<a ng-href="{{userProfileUrl}}">` — the actual `href` is set after the framework resolves the interpolation, so a pre-compile click goes nowhere instead of to a bad URL.

2. **HTML5 treats boolean attributes by presence, not by value.** `<button disabled="false">` is a disabled button, because the `disabled` attribute is _present_. Setting the attribute to the string `"false"` doesn't unset it. AngularJS's `ng-disabled="expr"` solves this by adding/removing the attribute based on the truthiness of `expr`.

Eight directives ship in this batch, in two patterns:

**Interpolation-safe URL/value attributes** (three directives):

1. **`ng-href`** — `<a ng-href="{{url}}">` watches the interpolated value of the attribute and updates the real `href` after each digest. Avoids the pre-compile-navigation bug.
2. **`ng-src`** — same for `<img ng-src="{{url}}">`. Avoids the pre-compile network-fetch bug.
3. **`ng-srcset`** — same for `<img ng-srcset="{{set}}">` (responsive-image source set).

**Boolean attribute toggles** (five directives):

4. **`ng-disabled`** — `<button ng-disabled="isLoading">` adds the `disabled` attribute when the expression is truthy, removes it when falsy.
5. **`ng-checked`** — same for `<input type="checkbox" ng-checked="isSelected">`.
6. **`ng-readonly`** — same for `<input ng-readonly="isLocked">`.
7. **`ng-selected`** — same for `<option ng-selected="isActiveOption">`.
8. **`ng-open`** — same for `<details ng-open="isExpanded">`.

**Why this batch.** All eight directives share two properties that group them naturally:

- They consume infrastructure that already exists: `attrs.$observe` (for the URL/value directives, watching the interpolated string) and `scope.$watch` + `attrs.$set` (for the boolean toggles, watching the expression and writing the attribute). No new framework primitives needed.
- They are **non-structural** and **non-isolate** — they don't add/remove DOM nodes, don't create scopes, and don't run controllers. The simplest directive shape in the framework.

**Success looks like:** a developer can write `<a ng-href="{{userProfileUrl}}">` and `<button ng-disabled="!form.$valid">` and see correct behavior across the entire template lifecycle — no pre-compile navigation to literal URLs, no spurious "disabled" buttons because someone wrote `disabled="false"`.

---

## 2. Functional Requirements (The "What")

### 2.1 `ng-href`, `ng-src`, `ng-srcset` — interpolation-safe URL/value attributes

- **As a template author**, I want to bind a URL or image source to an attribute via the interpolation syntax (`{{ }}`) without the browser acting on the literal un-compiled value, so users never navigate to or fetch the literal `"{{url}}"` string.
  - **Acceptance Criteria:**
    - [x] `<a ng-href="{{url}}">` interpolates the value of `ng-href` and sets the real `href` attribute to the resulting string after each digest.
    - [x] `<img ng-src="{{url}}">` does the same for the `src` attribute.
    - [x] `<img ng-srcset="{{set}}">` does the same for the `srcset` attribute.
    - [x] Before the first digest completes, the real `href` / `src` / `srcset` attribute is **absent** — the browser sees no URL to navigate to or fetch.
    - [x] When the interpolated value changes (e.g. because a referenced scope expression changes), the real attribute updates on the next digest.
    - [x] When the interpolated value resolves to an empty string, the real attribute is **removed** entirely — not set to `""`.

### 2.2 `ng-disabled`, `ng-checked`, `ng-readonly`, `ng-selected`, `ng-open` — boolean attribute toggles

- **As a template author**, I want to bind a boolean HTML attribute to the truthiness of a scope expression, so the attribute is present when the expression is truthy and absent when falsy.
  - **Acceptance Criteria:**
    - [x] `<button ng-disabled="expr">` watches `expr` and **adds** the `disabled` attribute whenever `expr` is truthy, **removes** it whenever `expr` is falsy.
    - [x] `<input ng-checked="expr">` does the same for the `checked` attribute.
    - [x] `<input ng-readonly="expr">` does the same for the `readonly` attribute.
    - [x] `<option ng-selected="expr">` does the same for the `selected` attribute.
    - [x] `<details ng-open="expr">` does the same for the `open` attribute.
    - [x] The attribute transition happens on every digest where the expression's truthiness flips — not just on identity changes.
    - [x] When the boolean attribute is **added**, the corresponding DOM property (`element.disabled`, `element.checked`, etc.) is also `true`. The browser keeps the property and attribute in sync automatically; the directive does not need to write the property explicitly.

### 2.3 Module integration

- **As a framework consumer**, I want all eight directives available without doing anything special — loading the core framework should make them work.
  - **Acceptance Criteria:**
    - [x] All eight directives are registered automatically when an app's module declares a dependency on the core framework module.
    - [x] A developer can replace any of them via the standard module-DSL mechanisms (`.directive`, `.decorator`) — these are built-ins, not hardcoded behavior.

---

## 3. Scope and Boundaries

### In-Scope

- The eight directives listed above: `ng-href`, `ng-src`, `ng-srcset`, `ng-disabled`, `ng-checked`, `ng-readonly`, `ng-selected`, `ng-open`.
- The "interpolation-safe URL" pattern (real attribute absent before compile, set after) for `ng-href` / `ng-src` / `ng-srcset`.
- The "boolean attribute presence/absence" pattern for the five boolean toggles.

### Out-of-Scope

- **URL sanitization (`$compileProvider.aHrefSanitizationTrustedUrlList` and friends)** — the existing AngularJS URL-allowlist for `href` / `src` / `action` attributes is its own configuration surface. `ng-href` simply sets the URL; the browser's URL parser handles it. URL-allowlist configuration is a separate spec.
- **`ng-multiple` and `ng-required`** — boolean attributes that AngularJS also exposes. `ng-required` lives under Forms & Validation (Phase 3); `ng-multiple` is paired with `<select>` form-element work, also Phase 3.
- **Event directives** (`ng-click`, `ng-keydown`, `ng-focus`, etc.) — separate "Mouse events" / "Keyboard events" / "Clipboard / focus / form-lifecycle events" sub-bullets.
- **Structural / flow-control directives** (`ng-if`, `ng-repeat`, `ng-switch`, `ng-include`, `ng-init`, `ng-controller`) — separate sub-bullet.
- **Form-element directives** (`form`, `input`, `select`, `textarea`, `ng-model`, `ng-options`) — Phase 3, Forms & Validation roadmap item.
- **`ng-pluralize`**, **`ng-csp`** / **`ng-jq`** / **`ng-ref`**, **`<script>` template registration**, **`<a>` empty-href guard** — separate sub-bullets.
- **Application bootstrap, `$q`, `$http`, routing, animations, the `angular.*` compat layer** — later roadmap items.
