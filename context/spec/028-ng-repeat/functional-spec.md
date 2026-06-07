# Functional Specification: ng-repeat (List Iteration Directive)

- **Roadmap Item:** `ng-repeat` — iteration over arrays/objects with `track by`, per-item locals, animation hooks deferred to Phase 4. Phase 2 → Directives & DOM Compilation → Built-in Directives.
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

### 1.1 The user pain
Template authors regularly need to render a chunk of markup once for every item in a collection (a todo list, search results, a message thread, table rows, a navigation menu). Without a list-rendering directive the only options are:

- Hand-writing one HTML element per item — impossible when the collection is dynamic or comes from data.
- Building the markup in code and inserting it manually — bypasses the framework's bindings and lifecycle and breaks the unified mental model the rest of the framework offers.

### 1.2 What this delivers
`ng-repeat` lets an author write a template once and bind it to a collection. The framework renders one copy of the template for each item, and keeps the rendered output in sync as the collection changes (items added, removed, reordered, replaced).

### 1.3 Why now
Lists are the single most common UI shape in real applications. Phase 2 has shipped all other structural directives (`ng-if`, `ng-switch`, `ng-include`, `ng-init`, `ng-controller`); `ng-repeat` is the last piece needed before the framework can back any non-trivial application.

### 1.4 Success
- An author can write any iteration shape that AngularJS 1.x supports and see the same rendered result (1:1 parity).
- Existing AngularJS 1.x applications using `ng-repeat` run unmodified against this framework.
- List mutations (add, remove, reorder, replace) update only the affected rows; rows whose items survive the update keep their DOM nodes and the state inside them (input focus, form values).

---

## 2. Functional Requirements (The "What")

### 2.1 Basic iteration: `item in list`
For each entry in the bound collection, the framework renders one copy of the template, with the per-item name bound to that entry.

- **AC1.1** — Given `todos = [{title: 'A'}, {title: 'B'}, {title: 'C'}]` and `<li ng-repeat="todo in todos">{{ todo.title }}</li>`, three `<li>` rows appear, showing "A", "B", "C" in that order.
- **AC1.2** — When the author appends an item to the list, a new row appears at the end and the existing rows are not rebuilt.
- **AC1.3** — When the author removes an item, only that row is removed and the surrounding rows are untouched.
- **AC1.4** — When the author replaces the entire collection, rows for items that survive are reused at their new positions, rows for items that disappeared are removed, and new items get freshly built rows.

### 2.2 Object iteration: `(key, value) in object`
For each property of the bound object, the framework renders one copy of the template with two per-item names bound: the property name and its value.

- **AC2.1** — Keys are visited in alphabetical string order. Given `{'10': 'a', '2': 'b', '1': 'c'}`, rows appear in the order `1 → c`, `10 → a`, `2 → b`.
- **AC2.2** — When a property is added to the object, a new row appears in its sorted position.
- **AC2.3** — When a property is removed, only that row is removed.
- **AC2.4** — When a property value changes (e.g. `people.alex` becomes `31` from `30`), the existing `alex` row updates in place; the row is not torn down.

### 2.3 Custom identity: `track by EXPR`
The author tells the framework how to identify each item across updates. The framework uses the value of the `track by` expression (evaluated per row) to decide which existing row maps to which incoming item.

- **AC3.1** — Given a list replaced by a new list where each new item has a `todo.id` matching one of the old items, rows are reused: surrounding state inside each row (input focus, form values, scroll position) survives.
- **AC3.2** — `track by $index` makes the framework match rows by position. This is the documented escape hatch for lists whose item values legitimately repeat.
- **AC3.3** — Any expression the framework can evaluate is accepted for `track by`, including method calls (`track by todo.identityKey()`) and property paths (`track by todo.metadata.id`).

### 2.4 Filtered-list alias: `as VISIBLE`
The author names the post-filter collection so sibling markup can read it — typically to show an empty-state message.

- **AC4.1** — Given `<li ng-repeat="todo in todos | filter:q as visible">…</li>` followed by `<p ng-if="!visible.length">No matches.</p>`, the empty-state message appears whenever the filter produces zero rows.
- **AC4.2** — When the filter expression changes, `visible` updates to reflect the new filtered view on the next render.
- **AC4.3** — `visible` is published on the scope OUTSIDE the repeated rows, so it is reachable by sibling elements (`<p>` in AC4.1) but does not pollute the per-row template.
- **AC4.4** — If the alias name is not a valid identifier (contains spaces, punctuation, etc.), a console error appears and no rows render.

### 2.5 Combined forms
The optional clauses may be combined in this order: `<item> in <collection> [as <alias>] [track by <expr>]`. Both `as` and `track by` are independently optional.

- **AC5.1** — `todo in todos | filter:q as visible track by todo.id` works: filter is applied, alias is published, identity is tracked by `todo.id`.
- **AC5.2** — A misordered expression (e.g. `track by` before `as`) is treated as malformed: a console error appears, no rows render.

### 2.6 Per-item variables (item locals)
Inside the repeated template, six framework-published variables are available alongside the item itself:

| Variable | Meaning |
|---|---|
| `$index` | 0-based position of the row |
| `$first` | `true` only for the first row |
| `$last` | `true` only for the last row |
| `$middle` | `true` for every row except the first and the last |
| `$even` | `true` on even-indexed rows (0, 2, 4, …) |
| `$odd` | `true` on odd-indexed rows (1, 3, 5, …) |

- **AC6.1** — `<li ng-repeat="t in todos">{{ $index + 1 }}. {{ t.title }}</li>` over a three-item list renders as `1. A`, `2. B`, `3. C`.
- **AC6.2** — `<li ng-class="{ first: $first, last: $last }" ng-repeat="t in todos">` applies the `first` class only to the first row and the `last` class only to the last.
- **AC6.3** — When the list mutates such that a row's position changes, that row's `$index` / `$first` / `$last` / `$middle` / `$even` / `$odd` update to reflect the new position, and any sibling template logic that reads them re-renders.
- **AC6.4** — Nested `ng-repeat` shadows the outer per-item variables: in `<ul ng-repeat="dept in depts"><li ng-repeat="emp in dept.employees">{{ $index }}</li></ul>`, the inner `$index` refers to the employee row, not the department row. The outer variables are no longer reachable inside the inner template.

### 2.7 Non-iterable values render nothing
When the value the author bound is not a list or object (e.g. `null`, `undefined`, a number, a function), no rows render and no error appears.

- **AC7.1** — Given `todos = undefined` initially and `<li ng-repeat="t in todos">`, no rows render and the console is clean.
- **AC7.2** — When `todos` later becomes `[A, B]`, two rows appear.
- **AC7.3** — When `todos` returns to `null`, all rows disappear; no error.

### 2.8 Duplicate items without `track by`
When the same value appears more than once in a list AND the author has not provided a `track by` clause, the framework surfaces a clear error explaining the problem and pointing at `track by`. No rows render for the offending list.

- **AC8.1** — `<li ng-repeat="n in [1, 2, 2, 3]">` produces a console error referencing `ng-repeat`, the offending value, and suggesting `track by`. The list does not render.
- **AC8.2** — Adding `track by $index` resolves the error and all four rows render.
- **AC8.3** — The same rule applies to object duplicates (the same object reference appearing twice in the list).

### 2.9 Row reuse on list mutation
On each list update, the framework reconciles existing rows with the new collection:

1. Items whose identity is unchanged keep their existing row (the same DOM node). The row may move to a new position in the document if the order changed.
2. Items new to the list get freshly built rows.
3. Items that disappeared have their rows removed and any state inside torn down.

- **AC9.1** — Given rows for `[A, B, C]` where the `B` row contains a focused `<input>`, reordering to `[B, A, C]` preserves the focus.
- **AC9.2** — Replacing `[A, B, C]` with `[A, C]` removes only the `B` row; the `A` and `C` rows are untouched.
- **AC9.3** — Replacing `[A, B, C]` with `[A, B, C, D]` appends one new row for `D` without rebuilding the others.

### 2.10 Malformed iterator expression
When the right-hand side of `ng-repeat` cannot be parsed (missing `in` keyword, unknown clause order, invalid identifier names), a console error appears citing the directive and the offending expression. No rows render.

- **AC10.1** — `<li ng-repeat="todos.length">` (no `in` keyword) produces a console error. The list does not render.
- **AC10.2** — `<li ng-repeat="(a, b, c) in obj">` (three-name pattern in the iterator) produces a console error. The list does not render.

---

## 3. Scope and Boundaries

### In-Scope
- Basic array iteration: `item in list`.
- Object iteration with key/value: `(key, value) in object`, alphabetical key order.
- Custom identity: `track by EXPR`.
- Filtered-list alias: `as VISIBLE`, published on the parent scope.
- All combined forms (e.g. `item in collection as visible track by item.id`).
- All six per-item variables: `$index`, `$first`, `$last`, `$middle`, `$even`, `$odd`.
- Row reuse across list updates — stable DOM identity per item identity.
- Console errors for duplicate items without `track by`, malformed iterator expressions, and invalid alias / identifier names.
- Synchronous DOM updates — rows appear, disappear, and move instantly with no transition.
- Nested `ng-repeat` (per-item variable shadowing).

### Out-of-Scope
- **Animation hooks (`enter` / `leave` / `move`)** — deferred to Phase 4 when the animation engine ships. Rows update synchronously today.
- **All other Phase 2 roadmap items still pending:** Module DSL `.directive` / `.controller`, `ng-pluralize`, `ng-csp` / `ng-jq` / `ng-ref` / `<script>` / `<a>` overrides, Service Text Diagrams, Application Bootstrap. Separate specs.
- **All Phase 3+ items:** Promises & Async, HTTP, Forms & Validation, Routing, Animations, Package & Distribution, AngularJS Compatibility Layer. Separate specs.
