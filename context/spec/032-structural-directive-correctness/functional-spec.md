# Functional Specification: Structural-Directive Correctness

- **Roadmap Item:** Directives & DOM Compilation — structural-directive correctness cleanup.
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

The structural directives — `ng-if`, `ng-repeat`, `ng-switch`, `ng-include` — work and produce correct output today, but two latent correctness issues remain in how they compose and re-render:

1. **Two structural directives on the same element silently misbehave.** Writing `<div ng-if="a" ng-repeat="x in xs">` should be a clear, immediate error (these two cannot both own the same element). Instead the framework silently drops one of them and renders the wrong thing. This was documented as a known gap when the structural directives shipped.

2. **Normal rendering emits spurious internal errors.** Every time a structural directive renders a piece of content (each `ng-repeat` row, each `ng-if` mount), the framework currently raises a framework-internal error that it catches and swallows. The visible output is correct, but the app's error handler / logs receive this internal noise on completely normal usage — which makes genuine application errors harder to spot. (This surfaced during the spec 031 verification work.)

**The problem we're solving:** Developers either get silently-wrong behavior (issue 1) or noisy logs full of framework-internal errors during normal use (issue 2). Both undermine trust in the framework and make debugging real problems harder.

**Desired outcome:** Misusing two structural directives on one element fails loudly and clearly; correct structural-directive usage produces **zero** error-handler noise.

**How we measure success:**

- `<div ng-if ng-repeat>` produces a clear error instead of silent wrong rendering.
- A correct, ordinary `ng-repeat` / `ng-if` page invokes the app's error handler zero times.

---

## 2. Functional Requirements (The "What")

- **As a** developer, **I want** a clear error when I accidentally place two structural directives on one element, **so that** I fix the mistake immediately instead of debugging silently-wrong output.
  - **Acceptance Criteria:**
    - [x] `<div ng-if="show" ng-repeat="x in xs">` reports a clear error that names the conflicting directives; it does **not** silently render with only one of them applied.
    - [x] The same clear error appears for any pairing of two structural directives on one element (e.g. `ng-if` + `ng-include`, `ng-repeat` + `ng-switch-when`).
    - [x] The canonical workaround — nesting the directives on separate elements (`<div ng-if="show"><div ng-repeat="x in xs">…</div></div>`) — continues to work correctly.

- **As a** developer, **I want** correct structural-directive usage to generate no internal error noise, **so that** my error handler and logs only show real problems.
  - **Acceptance Criteria:**
    - [x] A correct `<li ng-repeat="x in xs">{{x}}</li>` rendering several rows invokes the app's error handler **zero** times.
    - [x] The same zero-noise guarantee holds for `ng-if`, `ng-switch`, and `ng-include` across mount, update, and teardown.
    - [x] The rendered DOM, live updates on data change, and teardown behavior are all unchanged from today — this is a correctness cleanup, not a behavior change to output.
    - [x] Item reorder / reuse in `ng-repeat` (preserving focus, form values, and scroll position inside reused rows) continues to behave exactly as before.

---

## 3. Scope and Boundaries

### In-Scope

- Reporting a clear error when two structural directives are placed on the same single element (closing the documented spec-027 gap).
- Eliminating the framework-internal error noise emitted during normal structural-directive rendering (the clone re-link issue uncovered during spec 031 verification).
- Preserving all existing correct output, updates, teardown, and row-reuse behavior.

### Out-of-Scope

- Multi-element / ranged directives (separate spec 033). _Note: this spec is a natural prerequisite for 032, since ranged structural directives reuse the same clone/relink machinery being cleaned up here._
- `$compileProvider` configuration methods (separate spec 034).
- New directives or new structural behavior.
- All other roadmap items outside Directives & DOM Compilation.
