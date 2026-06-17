# Functional Specification: Multi-element / Ranged Directives (`*-start` / `*-end`)

- **Roadmap Item:** Directives & DOM Compilation — multi-element (`directiveName-start` / `directiveName-end`) ranged directives.
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Some directives need to apply across a **range of sibling elements**, not just a single element. In certain HTML contexts there is no legal element to wrap siblings in — `<tr>` rows inside a `<table>`, `<option>`s inside a `<select>`, `<dt>`/`<dd>` pairs inside a `<dl>` — so there is no single host element for `ng-repeat`, `ng-if`, or `ng-show`.

AngularJS solves this with paired `-start` / `-end` suffixes: you put `directive-start` on the first element of the group and `directive-end` on the last, and the directive applies to the start element, the end element, and **everything between them**, treated as one unit.

**The problem we're solving:** Today this project has no support for ranged directives, so a developer cannot repeat or conditionally render a group of sibling elements when those siblings cannot share a wrapper. The canonical example — repeating two `<tr>` rows together for each record — is simply impossible.

**Desired outcome:** A developer can write `directive-start` / `directive-end` on two sibling elements and have the directive operate over the whole range, matching AngularJS behavior.

**How we measure success:**

- `<tr ng-repeat-start="r in rows">…</tr><tr ng-repeat-end>…</tr>` repeats both rows together, once per record.
- `ng-if` / `ng-show` / `ng-hide` / `ng-switch-when` / `ng-switch-default` / `ng-class` all work in the ranged form, matching AngularJS.

---

## 2. Functional Requirements (The "What")

- **As a** developer, **I want to** mark a start and an end element with `directive-start` / `directive-end`, **so that** the directive applies to that whole range of sibling elements as a single group.
  - **Acceptance Criteria:**
    - [x] `<tr ng-repeat-start="item in items">…</tr><tr ng-repeat-end>…</tr>` repeats the **entire** start→end group once per item, preserving order.
    - [x] Elements that sit **between** the start and end elements (not only the two endpoints) are part of the group and are repeated / toggled / styled with it.
    - [x] `ng-if-start` / `ng-if-end` mounts and unmounts the whole range together; toggling the condition adds or removes every element in the range.
    - [x] `ng-show-start` / `ng-show-end` and `ng-hide-start` / `ng-hide-end` show or hide every element in the range together.
    - [x] `ng-switch-when-start` / `ng-switch-when-end` and `ng-switch-default-start` / `ng-switch-default-end` select the whole range as one case.
    - [x] `ng-class-start` / `ng-class-end` applies the computed classes to every element in the range.
    - [x] Other directives — including nested ranged directives — placed **inside** the range continue to work normally.
    - [x] If a `-start` element has no matching `-end` sibling, the framework reports a clear error that identifies the unterminated directive (AngularJS parity).
    - [x] The ordinary single-element form of every one of these directives continues to work exactly as before — the ranged form is purely additive.
    - [x] A custom (developer-authored) directive can opt in to ranged support and behave the same way.

---

## 3. Scope and Boundaries

### In-Scope

- The `directiveName-start` / `directiveName-end` grouping mechanism in the compiler.
- Ranged support for the full AngularJS-parity set of built-ins: `ng-repeat`, `ng-if`, `ng-show`, `ng-hide`, `ng-switch-when`, `ng-switch-default`, `ng-class`.
- The opt-in capability for custom directives to support the ranged form.
- A clear error when a `-start` has no matching `-end`.

### Out-of-Scope

- New directives.
- `$compileProvider` configuration methods (separate spec 034).
- Structural-directive correctness fixes — the same-element conflict error and clone-relink internal-error cleanup (separate spec 032). _Note: spec 032 is a natural prerequisite, since ranged structural directives lean on the same clone/relink machinery._
- All other roadmap items outside Directives & DOM Compilation.
