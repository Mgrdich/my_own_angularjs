# Technical Specification: Class & Style Directives

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Four directives, all layered onto the existing `@compiler` pipeline. Same "DI registration on `ngModule`, no public exports" precedent as spec 023. No new infrastructure required — `$watchCollection` already exists in `@core/scope` (spec 002), `classList.toggle` is the same DOM surface spec 023's `ng-show`/`ng-hide` use.

The work splits into three parts:

1. **Two new directive files** — `src/compiler/ng-class.ts` (covering `ng-class`, `ng-class-even`, `ng-class-odd`) and `src/compiler/ng-style.ts`.
2. **One shared helper file** — `src/compiler/class-expression.ts` exposes `flattenClassExpression(value): Set<string>` that normalizes the three expression forms (string / array / object) into a single class-name set. Used by all three `ng-class*` directives.
3. **One registration block update** — extend the existing `$compileProvider` config block in `src/core/ng-module.ts` (the same block that now holds 8 prior directives) with 4 new `$compileProvider.directive(...)` calls.

The directives are simple watchers: each installs a `scope.$watchCollection` on the expression and applies a diff-based DOM update in the listener. No new error classes. No new `EXCEPTION_HANDLER_CAUSES` token — every error site flows through the existing `'watchListener'` cause inherited from `$watchCollection`. The tuple stays at 10.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 `src/compiler/class-expression.ts` — shared helper

Single exported function:

- **`flattenClassExpression(value: unknown): Set<string>`**
  - String form: split on whitespace (`value.trim().split(/\s+/)`), filter empties, return each as a set entry. `''` returns an empty set.
  - Array form: walk each element; if it's a string, apply the string-form rule; if it's a plain object, apply the object-form rule (truthy keys included); other types are ignored.
  - Object form: include each key whose value is truthy.
  - `null` / `undefined` / other primitives: return an empty set.

The helper is pure and synchronous. Returns a fresh `Set<string>` each call (no shared mutable state across directives or invocations).

File size target: under 100 LOC. Full TSDoc with `@example` for each form.

### 2.2 `src/compiler/ng-class.ts` — three directives

One file exporting **three** named factories: `ngClassDirective`, `ngClassEvenDirective`, `ngClassOddDirective`. All share an internal helper:

- **`installClassWatcher(scope, element, expr, gate?)`** — installs the watch + diff cycle:
  1. Track `appliedClasses: Set<string>` on the closure (the classes WE added on the last digest).
  2. `scope.$watchCollection(expr, value => { … })`.
  3. In the listener: compute `targetClasses = gate?.(scope) === false ? new Set() : flattenClassExpression(value)`. (The `gate` predicate is how `ng-class-even` / `ng-class-odd` gate on `$even` / `$odd`.)
  4. Diff: classes in `appliedClasses` but not in `targetClasses` → `element.classList.remove(cls)`. Classes in `targetClasses` but not in `appliedClasses` → `element.classList.add(cls)`. Classes in both → untouched.
  5. Update `appliedClasses = targetClasses`.

- **`ngClassDirective`** — `restrict: 'A'`, zero-dep array-form factory. Link fn calls `installClassWatcher(scope, element, attrs.ngClass)` (no gate).
- **`ngClassEvenDirective`** — same shape, gate fn is `(scope) => !!scope.$even`. Plus a second `scope.$watch('$even', …)` to re-fire the diff when `$even` flips (without the expression itself changing).
- **`ngClassOddDirective`** — mirror of `ngClassEven` gated on `$odd`.

The classes-preserved guarantee falls out of the diff: we only ever `remove` classes that were in `appliedClasses` (i.e. classes WE added). Consumer-shipped classes (e.g. `<div class="card" ng-class="…">`) were never in `appliedClasses` and never get removed.

File size target: under 200 LOC. Full TSDoc on each exported factory + the shared helper, with `@example` for each directive.

### 2.3 `src/compiler/ng-style.ts`

One exported factory `ngStyleDirective`. Same shape as `ng-class.ts` but for inline styles:

- Track `appliedProps: Set<string>` (the CSS property names WE set on the last digest).
- `scope.$watchCollection(attrs.ngStyle, value => { … })`.
- In the listener: `newProps = (value && typeof value === 'object') ? new Set(Object.keys(value)) : new Set()`. Diff:
  - Properties in `appliedProps` but not in `newProps` → `element.style.removeProperty(propName)`.
  - Properties in `newProps` → `element.style.setProperty(propName, String(value[propName]))`. (Always set, not just on change — `$watchCollection` already filters out no-op digests.)
- Update `appliedProps = newProps`.

The preserve-other-styles guarantee falls out of the diff: we only ever call `removeProperty` on properties that were in `appliedProps`. A consumer-shipped `<div style="margin: 5px" ng-style="…">` keeps the `margin` unless `ng-style` names `margin` in its expression (in which case `ng-style` wins by writing to the same property — AngularJS-canonical behavior).

Property names are read as-is from the object's keys. Kebab-case → camelCase conversion is the consumer's responsibility (consistent with AngularJS-canonical behavior; `setProperty` accepts both forms anyway).

File size target: under 150 LOC. Full TSDoc with `@example`.

### 2.4 `src/core/ng-module.ts`

Extend the existing `$compileProvider` config block. Four new imports + four new lines:

```ts
$compileProvider.directive('ngClass', ngClassDirective);
$compileProvider.directive('ngClassEven', ngClassEvenDirective);
$compileProvider.directive('ngClassOdd', ngClassOddDirective);
$compileProvider.directive('ngStyle', ngStyleDirective);
```

Imports alphabetized within the `@compiler/ng-*` group, matching the spec 023 convention.

### 2.5 Watch-type choice

All four directives use `scope.$watchCollection`, not `scope.$watch`:

- **`ng-class` string form** — `$watchCollection` falls back to identity comparison for primitives. Slightly heavier than `$watch` but the unified watch site keeps the code simpler. The string-form watch fires only on identity change, same as `$watch`.
- **`ng-class` array form** — `$watchCollection` compares array elements one level deep (length + identity-per-index). Catches `arr.push('new-class')` mutations.
- **`ng-class` object form** — `$watchCollection` compares object keys one level deep. Catches `obj.active = !obj.active` mutations.
- **`ng-style`** — same one-level-deep object diffing.

For `ng-class-even` / `ng-class-odd`, the `$even` / `$odd` flip is observed via a separate `scope.$watch('$even', refire)` / `scope.$watch('$odd', refire)` — the gate predicate alone doesn't trigger the collection watcher.

### 2.6 Module-boundary considerations

All four directives live in `@compiler` (existing convention from spec 023). No new module subpaths. The shared `class-expression.ts` helper stays inside `@compiler` and is consumed only by `ng-class.ts`. It is NOT exported from `@compiler/index` — same DI-registration-only precedent as the directives themselves.

### 2.7 Error handling

- The `flattenClassExpression` helper is total — it never throws. Unrecognized expression forms (e.g. a number, a function) return an empty set silently.
- `$watchCollection` listener throws bubble through the existing digest `'watchListener'` cause path. No new error classes, no new `EXCEPTION_HANDLER_CAUSES` token.

### 2.8 Documentation

`src/compiler/README.md` gains a new section **"Class & Style built-ins (spec 024)"** covering:

- One paragraph per directive — purpose + canonical use case.
- The classes-preserved guarantee — explicit callout of the diff-cycle implementation that makes it work.
- The `ng-style` property-name convention (read as-is from the object's keys; `setProperty` accepts both kebab-case and camelCase).
- The "no `$animate` integration" note — animation hooks deferred to Phase 4 (same as spec 023).
- Cross-reference to spec 023's `ng-show` / `ng-hide` for the underlying `classList` manipulation pattern.

`CLAUDE.md` "Modules" table — `./compiler` row extended to mention the four new directives. Add 1–2 new "Non-obvious invariants" bullets (the diff-cycle pattern for preservation; the unified `$watchCollection` choice). Add 4 new "Where to look when…" rows (one per directive).

`context/product/roadmap.md` — the "Class / style" sub-bullet flips from `[ ]` to `[x]` at `/awos:verify`. Already annotated with `_(spec 024 — drafted)_`.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`@core/scope`** — consumes `$watchCollection` (spec 002). No changes needed.
- **`@compiler`** — additive: 3 new files, 1 modified registration block. The compiler walker, terminal hook, isolate-binding wiring, and all other established infrastructure is unchanged.
- **No other `@`-modules touched.**

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `ng-class`'s diff cycle removes a class the consumer added via `attrs.$set('class', …)` mid-digest. | The `appliedClasses` set is maintained per `ng-class` instance and only ever contains classes WE added. A consumer setting a class via `$set` doesn't enter our tracking set, so it never gets removed by our diff. Covered by a dedicated test. |
| `ng-style`'s diff removes a consumer-shipped inline style with the same property name. | This is the documented "`ng-style` wins" behavior. Test pinned. |
| `$watchCollection` overhead for the string form of `ng-class` is wasteful. | The overhead is a single property comparison per digest — negligible. The unified watch shape is worth the small cost. If profiling later reveals this as a hotspot, a future spec can fork string-form into `$watch`. |
| `ng-class-even` / `ng-class-odd` need to re-fire when `$even` / `$odd` flips but the expression itself didn't change. | The `installClassWatcher` helper installs a SECOND watch on `$even` / `$odd` (when a gate is provided) that re-runs the diff against the cached expression value. Covered by a dedicated test. |
| Array form with mixed string + object elements is rare; the helper might mishandle it. | The `flattenClassExpression` helper is dispatch-based — array elements are recursively classified. Explicit test cases for mixed arrays. |
| Object-form `ng-style` with a key that's a kebab-case CSS property (e.g. `'background-color'`). | `element.style.setProperty('background-color', 'red')` works directly. CamelCase forms (`backgroundColor`) also work via the same call (browsers accept both). No special-casing needed. Documented in README. |

---

## 4. Testing Strategy

**Framework:** Vitest + jsdom (existing setup). Tests under `src/compiler/__tests__/`.

- **`class-expression.test.ts`** — pure unit tests for the helper:
  - String form (single class, multi-class, leading/trailing whitespace, empty string).
  - Array form (strings, nested objects, mixed, empty array, sparse array).
  - Object form (truthy/falsy values, no keys).
  - Edge: `null` / `undefined` / number / function → empty set.

- **`ng-class.test.ts`** — integration tests via real `$compile`:
  - All three forms produce the expected class set.
  - Diff cycle on change — removed classes removed, new classes added, common classes untouched.
  - Consumer-shipped classes preserved across multiple expression changes.
  - `null` / `undefined` → all directive-applied classes cleared.
  - `injector.has('ngClassDirective') === true`.

- **`ng-class-even.test.ts`** — `$even`-gated tests:
  - Classes apply when `$even` is true, not when false.
  - Re-fire when `$even` flips (with expression unchanged).
  - Re-fire when expression changes (with `$even` unchanged).
  - Combined with `ng-class` on the same element — both contribute classes.
  - Outside of `ng-repeat` (no `$even` on scope) — directive contributes no classes, no error.

- **`ng-class-odd.test.ts`** — mirror-inverse of `ng-class-even`.

- **`ng-style.test.ts`** — integration tests:
  - Property set from expression.
  - Property cleared when key removed from the expression.
  - Property updated when value changes.
  - Consumer-shipped inline style preserved unless directive names the same property.
  - `null` / `undefined` → all directive-applied styles cleared.
  - Kebab-case and camelCase property names both work.
  - `injector.has('ngStyleDirective') === true`.

- **`spec024-parity.test.ts`** — focused AngularJS-canonical regression file (matches spec 022/023 precedent):
  - Each directive's flagship behavior pinned in a 1–3-test describe block.
  - Literal `expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10)` regression guard.
  - Deferred upstream cases (animations, `$animate.addClass` hooks) marked as `it.skip(...)` with citations.

- **Regression** — full specs 002–023 suite passes unchanged.
