# Functional Specification: Forms & Validation

- **Roadmap Item:** Forms & Validation — `ngModel` two-way binding, form-element directives, `ngModel` helpers, Form & control state tracking, built-in validators, custom validators.
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Today a developer using this framework can render data into the page (interpolation, `ng-bind`), react to events (`ng-click` and friends), and structure the DOM (`ng-if`, `ng-repeat`). What they **cannot** do is capture input from the user and feed it back into their data — there is no two-way data binding, no form controls, and no validation. This is the single largest remaining gap before the framework can power a real interactive application (the TodoMVC / form-validation demos on the roadmap depend on it).

This change delivers the complete forms layer: a developer can bind any form control to a piece of their data so that typing in a field updates the data and changing the data updates the field; group controls into forms that report their own validity; validate input with both built-in rules and their own custom rules (synchronous and asynchronous); and style controls based on their state (touched, dirty, valid, pending, …) using the same state-class conventions AngularJS established.

**Success is measured by:** a developer can build a non-trivial validated form — text, numeric, date, checkbox, radio, and dropdown controls bound to their data, with required/length/pattern/format rules plus a custom async rule — and the form behaves identically to the same markup running on AngularJS 1.x (same model values, same validity, same state classes, same timing).

---

## 2. Functional Requirements (The "What")

### 2.1 Two-way binding with `ng-model`

- **As a** developer, **I want to** bind a form control to a property of my data with `ng-model="…"`, **so that** user input and my data stay in sync automatically.
  - **Acceptance Criteria:**
    - [x] Given `<input ng-model="user.name">`, when the user types "Ada", then the bound property becomes "Ada" without any extra wiring.
    - [x] Given the bound property is changed in code, when the next update cycle runs, then the control on screen shows the new value.
    - [x] The binding target may be a nested path (`a.b.c`); intermediate objects are created as needed when the user first types.
    - [x] When `ng-model` points at an expression that cannot be assigned to (e.g. a literal or a function call), the developer sees a clear error explaining the field is not assignable.

- **The value pipeline:** each control exposes a controller (the "model controller") with two ordered transformation lists — one that runs when the user's input travels **toward** the data, and one that runs when the data travels **toward** the screen — plus a render step and a programmatic "the user changed the value" entry point.
  - **Acceptance Criteria:**
    - [x] A developer can register a transformation that converts the on-screen text into the stored value (e.g. trim whitespace) and see it applied on every keystroke commit.
    - [x] A developer can register a transformation that converts the stored value into what is shown (e.g. format a number) and see it applied whenever the data changes.
    - [x] The on-screen value and the stored value are exposed separately so a developer can read either.
    - [x] Calling the "value changed" entry point with a new on-screen value runs the toward-data transformations, runs validation, and (when valid, or when configured to allow invalid) writes the result to the data.

### 2.2 Control state tracking & state CSS classes

- **As a** developer, **I want** each control and form to track whether it has been visited, changed, and whether it is valid, **so that** I can show validation feedback at the right moment.
  - **Acceptance Criteria:**
    - [x] A fresh control reports itself as untouched, pristine, and (absent failing rules) valid; the form reflects the same.
    - [x] After the user focuses then leaves a control, it reports itself touched.
    - [x] After the user changes a control's value, it reports itself dirty (and no longer pristine).
    - [x] A developer can reset a control/form back to pristine programmatically.
    - [x] **State classes (full parity), toggled synchronously:** the control element carries `ng-valid`/`ng-invalid`, `ng-dirty`/`ng-pristine`, `ng-touched`/`ng-untouched`, `ng-empty`/`ng-not-empty`, and `ng-pending` while async validation is running.
    - [x] **Per-rule classes:** for each named rule, the element carries `ng-valid-<rule>` or `ng-invalid-<rule>` (e.g. `ng-invalid-required`, `ng-valid-maxlength`); rule names with separators are dasherized consistently with AngularJS.
    - [x] A form element additionally carries `ng-submitted` once a submit has been attempted.
    - [x] Classes only ever added by the framework are removed when their condition flips; classes the developer put on the element themselves are never removed.

### 2.3 Forms and the form controller

- **As a** developer, **I want** to group controls inside a `<form>` (or `ng-form` for nested groups) that aggregates their state, **so that** I can enable/disable a submit button on overall validity.
  - **Acceptance Criteria:**
    - [x] A `<form>` automatically becomes a form group without extra attributes; `ng-form` provides the same for nesting a group inside another form.
    - [x] A form is invalid if any control inside it is invalid, and valid only when all are valid; the form is dirty if any control is dirty.
    - [x] A named form (`<form name="myForm">`) and named controls (`<input name="email">`) are reachable by name so a developer can read their state in expressions (e.g. show a message when `myForm.email` is invalid and touched).
    - [x] Nested forms contribute their validity up to the parent form; removing a control or sub-form from the page removes its contribution.
    - [x] Submitting the form marks it submitted and runs any `ng-submit` handler; by default the browser's native submit/navigation is suppressed.
    - [x] A developer can programmatically mark the form submitted, reset it to pristine, and reset which controls are considered "submitted".

### 2.4 Form-element directives & input types

- **As a** developer, **I want** every standard form control to work with `ng-model`, **so that** I can bind text, numbers, dates, choices, and free text.
  - **Acceptance Criteria (typed model values — full parity):**
    - [x] `<textarea ng-model>` and `<input type="text|email|url|password|search|tel">` bind a **string**.
    - [x] `<input type="number">` and `<input type="range">` bind a **number**; non-numeric input makes the control invalid rather than storing a bad value.
    - [x] `<input type="checkbox">` binds a **boolean**; the true/false values are overridable via `ng-true-value` / `ng-false-value`.
    - [x] `<input type="radio">` binds the **value of the selected radio** among a group sharing the same model.
    - [x] `<input type="date|datetime-local|time|month|week">` binds a **date value**; the displayed text follows the input type's format and honors a configured timezone.
    - [x] `<input type="hidden|button|submit|reset">` behave as standard controls (no model parsing surprises).
    - [x] `<select ng-model>` binds the chosen option's value; a `multiple` select binds an **array** of chosen values.
    - [x] Empty input maps to an empty model value consistently (e.g. empty text → empty string/undefined per parity), and the `ng-empty`/`ng-not-empty` classes reflect it.

### 2.5 `ng-model` helpers

- **As a** developer, **I want** fine control over when and how the model updates and how options are generated, **so that** I can tune UX (debounce, update-on-blur) and build dropdowns from data.
  - **Acceptance Criteria:**
    - [x] **`ng-model-options` (full parity):**
      - [x] `updateOn` lets the developer choose which events commit the value (e.g. only on `blur`), instead of every keystroke.
      - [x] `debounce` delays the commit by a number of milliseconds, optionally per-event (`{ default: 300, blur: 0 }`).
      - [x] `allowInvalid` lets invalid values still be written to the data.
      - [x] `getterSetter` lets the bound expression be a function used both to read and write the value.
      - [x] `timezone` controls how date/time controls interpret and display their value.
    - [x] **`ng-options`** generates `<option>`s for a `<select>` from an array or object, supporting label/value/grouping/`track by`/`disable when` per AngularJS grammar.
    - [x] **`ng-list`** transforms a delimited string in the field into an **array** in the data (and back), with a configurable delimiter.
    - [x] **`ng-change`** runs a developer-supplied expression whenever the committed on-screen value changes (not merely when the data changes in code).

### 2.6 Built-in validators

- **As a** developer, **I want** ready-made validation rules I can attach with attributes, **so that** I don't hand-write common checks.
  - **Acceptance Criteria:** for each rule, an invalid value makes the control (and its form) invalid, surfaces the matching `ng-invalid-<rule>` class, and (unless `allowInvalid`) keeps the bad value out of the data:
    - [x] **`required`** (also as the `ng-required="expr"` conditional form) — fails when the control is empty.
    - [x] **`ng-minlength` / `ng-maxlength`** — fail when the text is too short / too long.
    - [x] **`ng-pattern`** (and the native `pattern` attribute) — fails when the text doesn't match the supplied pattern.
    - [x] **`email`** type — fails on a malformed email address.
    - [x] **`number`** type — fails on non-numeric input.
    - [x] **`url`** type — fails on a malformed URL.
    - [x] **`min` / `max`** on number/range/date controls — fail when the value is out of range.
    - [x] Each rule re-evaluates whenever its input or its own bound parameter changes (e.g. changing the `ng-minlength` expression re-validates the current value).

### 2.7 Custom validators

- **As a** developer, **I want** to add my own synchronous and asynchronous rules, **so that** I can enforce app-specific constraints (including server checks).
  - **Acceptance Criteria:**
    - [x] A developer can register a **synchronous** rule under a name; returning false marks the control invalid under that name (`ng-invalid-<name>`), and the rule runs on every value change.
    - [x] A developer can register an **asynchronous** rule under a name that resolves/rejects; while any async rule is outstanding the control reports **pending** and carries `ng-pending`, and the data is not written until async rules settle (per parity).
    - [x] Async rules only run after all synchronous rules pass (parity ordering).
    - [x] A developer can read the per-rule pass/fail map and the overall pending state from the model controller.
    - [x] A developer can force re-validation programmatically.

### 2.8 Error routing & timing (developer-visible behavior)

- **Acceptance Criteria:**
    - [x] Programming errors in form setup (e.g. a non-assignable `ng-model`, a malformed `ng-options` expression) surface as clear, named errors through the framework's existing error-reporting path — they do not silently no-op.
    - [x] State-class updates and validity changes are applied within the normal update cycle (synchronously with respect to animations, which are deferred to a later phase) so feedback appears at the same time as the rest of the page updates.

---

## 3. Scope and Boundaries

### In-Scope

- `ng-model` two-way binding and the model controller value pipeline (toward-data / toward-screen transforms, render, programmatic value-changed entry point, on-screen vs stored value).
- Per-control and per-form state tracking (touched/untouched, dirty/pristine, valid/invalid, empty/not-empty, pending, submitted) and the **full** AngularJS state-class surface including per-rule classes.
- Form-element directives: `form`, `ng-form` (nested forms) and the form controller; `input` for every listed HTML5 type; `select` (including `multiple`); `textarea`. Typed model values (number/boolean/Date/array) per AngularJS parity.
- `ng-model` helpers: `ng-model-options` (full parity set — `updateOn`, `debounce`, `allowInvalid`, `getterSetter`, `timezone`), `ng-options`, `ng-list`, `ng-change`.
- Built-in validators: `required`/`ng-required`, `ng-minlength`, `ng-maxlength`, `ng-pattern`/`pattern`, `email`, `number`, `url`, `min`/`max`.
- Custom validators: synchronous and asynchronous rule pipelines, pending state, per-rule result map, programmatic re-validation.

### Out-of-Scope

- **Animations on state changes** — class toggles are synchronous now; `$animate` integration lands with the Animations roadmap item (Phase 4).
- **Routing, `$http`-backed form submission helpers** — separate roadmap items; this spec only provides the validation/binding building blocks (a custom async validator may call `$http`, but no form-specific networking is added).
- **All other roadmap items** are out of scope for this spec: Routing, Animations, Package & Distribution, and the entire Phase 5 AngularJS Compatibility Layer.
- **Legacy/IE quirks** and non-modern-browser input behaviors (consistent with the project's stated non-goals).
