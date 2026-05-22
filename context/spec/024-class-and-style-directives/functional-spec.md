# Functional Specification: Class & Style Directives

- **Roadmap Item:** Phase 2 → Directives & DOM Compilation → Built-in Directives (Class / style subset)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 023 shipped the **content** half of static-content directives — binding text and HTML into elements, hiding them, and opting out of compilation. This spec ships the **styling** half: dynamically driving an element's CSS classes and inline styles from a scope expression. After this spec, a developer can write a template that responds to application state by toggling visual styling — without ever touching the DOM directly.

Four directives ship in this batch:

1. **`ng-class`** — add or remove CSS classes based on an expression that evaluates to a string (`"highlighted"`), an array (`["selected", "primary"]`), or an object (`{ active: isActive, error: hasError }`).
2. **`ng-class-even`** — same as `ng-class` but the classes only apply on **even-indexed** iterations inside an `ng-repeat`. Reads `$even` from scope.
3. **`ng-class-odd`** — same but for **odd-indexed** iterations. Reads `$odd` from scope.
4. **`ng-style`** — set an element's inline styles based on an expression that evaluates to an object of `{ cssProperty: value }` pairs (`{ color: 'red', fontSize: '14px' }`).

**Why this batch.** These four directives share three properties that group them naturally:

- They all manipulate the element's visual presentation via either `classList` or `element.style` — the same DOM surfaces as `ng-show` / `ng-hide`.
- They all use a watch-and-diff cycle to keep DOM state in sync with scope state: the expression's value is watched (via `$watchCollection` for the structured forms of `ng-class` / `ng-style`), and the diff between previous and current value drives `add`/`remove` operations.
- Like spec 023's visibility directives, they have **no animation hooks** — the toggle is synchronous. `$animate` integration with `ng-class` is deferred to Phase 4 (Animations).

**Why ship `ng-class-even` / `ng-class-odd` now, before `ng-repeat` exists.** These two directives are thin wrappers around `ng-class` that gate on `$even` / `$odd`. They work today against any scope where the developer manually sets `$even` or `$odd` — the `ng-repeat` use case is the canonical one but not the only one. Shipping them now keeps the "Class / style" sub-bullet a single cohesive spec rather than partially deferring to a future structural-directives spec.

**Success looks like:** a developer can write `<div ng-class="{ active: isSelected, error: hasFault }">` and see the `active` / `error` classes toggle automatically as `isSelected` and `hasFault` change in scope — without writing any imperative DOM code.

---

## 2. Functional Requirements (The "What")

### 2.1 `ng-class` — three expression forms

- **As a template author**, I want to add or remove CSS classes on an element based on the value of a scope expression, so the visible styling reflects the application's state without me writing DOM code.
  - **Acceptance Criteria:**
    - [x] **String form** — `ng-class="'highlighted'"` adds the class `highlighted` to the element. A string with multiple whitespace-separated names (`ng-class="'class1 class2'"`) adds each as a separate class.
    - [x] **Array form** — `ng-class="['selected', 'primary']"` adds each array element as a class. Array elements that are themselves objects follow the object-form rule (see below); array elements that are strings follow the string-form rule.
    - [x] **Object form** — `ng-class="{ active: isActive, error: hasError }"` adds the class named in each key whenever its associated value is truthy, and removes the class whenever the value is falsy. Multiple keys can apply or be removed independently.
    - [x] When the expression's value **changes**, the rendered class set transitions from the previous set to the new set on the next digest: classes that left the set are removed, classes that entered are added, and classes that are still in both are untouched.
    - [x] Classes that were already on the element when the directive ran (e.g. `<div class="card" ng-class="…">`) are preserved and never removed by `ng-class`.
    - [x] When the expression evaluates to `null` or `undefined`, no classes are added (and any previously-added classes from the previous evaluation are removed).

### 2.2 `ng-class-even` and `ng-class-odd` — index-gated class application

- **As a template author** (typically inside an `ng-repeat`), I want a class to apply only on even-indexed or odd-indexed elements, so I can produce striped lists or alternating styles without writing manual index checks.
  - **Acceptance Criteria:**
    - [x] `ng-class-even="expr"` evaluates `expr` (using the same three forms as `ng-class`) and applies the resulting classes **only when** the scope's `$even` property is truthy.
    - [x] `ng-class-odd="expr"` does the same gated on `$odd` being truthy.
    - [x] When `$even` / `$odd` changes (or when `expr` itself changes), the rendered class set updates accordingly on the next digest.
    - [x] When neither `$even` nor `$odd` is set on scope (e.g. when the directive is used outside `ng-repeat`), the gated expression simply contributes no classes — the directive does not produce an error.
    - [x] `ng-class-even` and `ng-class-odd` can be combined on the same element with each other and with `ng-class` — each contributes its own class set, and the final rendered set is the union of all three.

### 2.3 `ng-style` — inline-style binding

- **As a template author**, I want to drive an element's inline styles from a scope expression, so I can express dynamic styling (size, color, position) without writing DOM code.
  - **Acceptance Criteria:**
    - [x] `ng-style="{ color: 'red', fontSize: '14px' }"` sets each key in the object as an inline CSS property with its associated value. Property names are read as-is from the object's keys.
    - [x] When a property's value changes, the rendered style updates on the next digest. When a property is removed from the expression's value (the key no longer appears), the corresponding inline style is cleared from the element.
    - [x] When the expression evaluates to `null` or `undefined`, all styles previously applied by `ng-style` are cleared.
    - [x] Inline styles set by the consumer directly on the element (e.g. `<div style="margin: 5px" ng-style="…">`) are preserved unless `ng-style`'s expression names the same property — in which case `ng-style` wins.

### 2.4 Module integration

- **As a framework consumer**, I want all four directives available without doing anything special — loading the core framework should make them work.
  - **Acceptance Criteria:**
    - [x] All four directives are registered automatically when an app's module declares a dependency on the core framework module.
    - [x] A developer can replace any of them via the standard module-DSL mechanisms (`.directive`, `.decorator`) — these are built-ins, not hardcoded behavior.

---

## 3. Scope and Boundaries

### In-Scope

- The four directives listed above: `ng-class`, `ng-class-even`, `ng-class-odd`, `ng-style`.
- All three expression forms of `ng-class` (string / array / object) including nested object-form elements inside arrays.
- The classes-preserved guarantee — `ng-class` never removes a class the directive didn't add.

### Out-of-Scope

- **Animations / `$animate` integration** — toggling classes via `ng-class` does not run any add/remove animation hooks in this spec. Animations are a separate Phase 4 roadmap item.
- **Structural / flow-control directives** (`ng-if`, `ng-repeat`, `ng-switch`, `ng-include`, `ng-init`, `ng-controller`) — separate "Structural / flow control" sub-bullet under Built-in Directives. `ng-class-even` and `ng-class-odd` ship here despite their canonical pairing with `ng-repeat`; the structural-directives spec will provide the canonical use case but does not block this one.
- **Attribute helpers** (`ng-href`, `ng-src`, `ng-srcset`, `ng-disabled`, `ng-checked`, `ng-readonly`, `ng-selected`, `ng-open`) — separate sub-bullet.
- **Event directives** (`ng-click`, `ng-keydown`, `ng-focus`, etc.) — separate sub-bullet.
- **Form-element directives** (`form`, `input`, `select`, `textarea`, `ng-model`, `ng-options`) — Phase 3, Forms & Validation roadmap item.
- **`ng-pluralize`**, **`ng-csp`** / **`ng-jq`** / **`ng-ref`**, **`<script>` template registration**, **`<a>` empty-href guard** — separate sub-bullets.
- **Application bootstrap, `$q`, `$http`, routing, animations, the `angular.*` compat layer** — later roadmap items.
