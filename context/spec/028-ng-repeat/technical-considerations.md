# Technical Specification: ng-repeat (List Iteration Directive)

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

`ng-repeat` is a structural directive built on the `transclude: 'element'` foundation from spec 027 Slice 2. At compile time the host element is detached and replaced with a `<!-- ngRepeat: ITERATOR -->` Comment placeholder; for each item in the bound collection, a fresh deep-clone of the captured master is linked against a per-item child scope and inserted in document order after the placeholder.

Five buckets of work:

1. **Iterator expression parser** — a module-private parser for the right-hand side of `ng-repeat`, supporting all combined forms (`<item> in <collection> [as <alias>] [track by <expr>]`, plus the `(key, value)` LHS variant for object iteration).
2. **Default identity tracker** — a `WeakMap<object, string>` plus a primitive-handling helper so `ng-repeat` can derive stable identity for any item without mutating user data. Replaced per-row by the author's `track by` expression when supplied.
3. **Row reconciliation engine** — given the old row set and a new keyed view of the collection, decide which rows survive (with possible move), which are torn down, and which are freshly built. Detect duplicate identity keys.
4. **Directive factory** — DDO, `$watchCollection` listener, per-row child-scope creation with the six framework-published locals, `as alias` publication on the parent scope, placeholder cleanup registration.
5. **Module registration + tests + docs** — `$compileProvider.directive(NG_REPEAT_NAME, ngRepeatDirective)` on `ngModule`, parity tests against AngularJS upstream, README + CLAUDE.md updates.

Cross-cutting facts:

- **`EXCEPTION_HANDLER_CAUSES.length` stays at 10.** Every error site reuses the existing `'$compile'` cause token, following the spec 027 precedent.
- **No new public-API surface beyond error classes.** The directive factory is file-local (DI-only registration, matching the spec 023+ precedent — reachable via `injector.get('ngRepeatDirective')` but not exported from `@compiler/index`).
- **`transclude: 'element'` foundation already in place.** No changes to `transclude-capture.ts`, no changes to `buildTranscludeFn`, no changes to the placeholder-installation pre-pass. `ng-repeat` is a straightforward consumer.
- **Animations are deferred.** No `$animate` integration in this spec — rows mutate synchronously. Documented as a Phase 4 follow-up, matching the precedent set for `ng-show` / `ng-hide` / `ng-class`.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. Iterator expression parser

**New file `src/compiler/ng-repeat-iterator-parse.ts`** (~150 LOC including TSDoc).

Responsibility: split the raw `attrs.ngRepeat` string into the four sub-components and validate the shape, throwing precise errors for malformed input.

**Top-level grammar** (AngularJS-canonical):

```
<iterator> in <collection> [as <alias>] [track by <expr>]
```

where `<iterator>` is either a single identifier (`item`) or a parenthesized tuple (`(key, value)`).

**Implementation contract:**

| Helper | Returns / Throws |
| --- | --- |
| `parseIteratorExpression(raw: string)` | A `ParsedIteratorExpression` record: `{ keyIdent: string \| null, valueIdent: string, collectionExpr: ParsedExpression, aliasIdent: string \| null, trackByExpr: ParsedExpression \| null }`. Throws on malformed input. |

**Error classes** (added to `src/compiler/compile-error.ts`):

| Class | When |
| --- | --- |
| `NgRepeatBadIteratorExpressionError` | The top-level regex did not match (missing `in`, wrong clause order, etc.). |
| `NgRepeatBadIdentifierError` | An identifier (item name, key/value names, alias name) is empty, contains punctuation, or is a JS-reserved word. Reuses the existing `IDENT_RE` from `@controller/controller.ts`. |
| `NgRepeatBadAliasError` | The alias name conflicts with the item/key/value names declared in the same expression OR is otherwise invalid. |

All three route via the directive factory's existing try/catch (`$$buildDirectiveArrayProvider`'s lazy resolution path) — surface as `$exceptionHandler('$compile')` at compile-link time, not registration time, because the iterator expression is per-element (different `attrs.ngRepeat` per matched element).

**Sub-expressions (`<collection>`, `<track by>`) parsed via `parse()` from `@parser/index`.** Reuses the standard expression interpreter — supports filter chains (`todos | filter:q`), method calls, property access, everything else `parse()` accepts.

### 2.2. Default identity tracker

**New file `src/compiler/ng-repeat-identity.ts`** (~80 LOC including TSDoc).

Responsibility: when no `track by` expression is provided, derive a stable identity string for each item without mutating user data.

**Strategy:**

- **For object items** (plain objects, arrays, functions, class instances): a closure-local `WeakMap<object, string>` mapping each object to a synthesized `object:<n>` identity. A counter monotonically assigns new identities; the WeakMap entry survives as long as the user holds a reference.
- **For primitive items** (number, string, boolean, `null`, `undefined`, `bigint`, `symbol`): a type-prefix sentinel: `string:<value>`, `number:<value>`, `boolean:<value>`, `null:`, `undefined:`, etc. `NaN` and `+0` / `-0` are normalized to canonical strings.

**Implementation contract:**

```ts
function createIdentityTracker(): {
  getIdentity(value: unknown): string;
}
```

A fresh tracker is created per `ng-repeat` directive instance (per link invocation). Identities are stable for the lifetime of that tracker.

**Test note:** the WeakMap key is the object reference; if the author mutates `todos[0]` in place (e.g. `todos[0].title = 'new'`), the identity is unchanged. This matches the AngularJS contract — identity tracking is by reference, not by value.

### 2.3. Row reconciliation engine

**Inline in `src/compiler/ng-repeat.ts`** (kept inline rather than split into a separate file because the engine is tightly coupled to the directive's closure state — pulling it out would require threading 6+ parameters through every call).

**Responsibility:** given (a) the previously-mounted rows keyed by identity, and (b) the newly-resolved collection items keyed by identity, produce the minimal sequence of DOM and scope mutations.

**Per-row state (closure-local `Map<string, RowEntry>`):**

```ts
interface RowEntry {
  scope: Scope;          // child scope; carries $index/$first/$last/etc + item bindings
  cloneRoot: Element;    // top of the linked subtree
  index: number;         // 0-based position in the current collection
  value: unknown;        // last-seen item value (used for object-iter property-rename detection)
  key?: string;          // for `(key, value) in object`, the object key
}
```

**Algorithm per `$watchCollection` fire:**

1. **Resolve the collection.** Evaluate the parsed `collectionExpr` against scope. If the result is not iterable (`null`, `undefined`, primitive, function, etc.), treat as the empty list — tear down all current rows and bail (matches FS §2.7).
2. **Normalize to an item-array.** For arrays: identity-pass. For objects: take `Object.keys(...)` sorted alphabetically by string, build `[{ key, value }]` pairs.
3. **Publish `as alias`.** If the directive parsed `as VISIBLE`, write the normalized collection to `parentScope[aliasIdent]` BEFORE row reconciliation (so a sibling `<p ng-if="!visible.length">` sees the new value in the same digest).
4. **Compute new identity keys.** For each item, evaluate the `track by` expression against a temporary scope where `$index` + the item-bindings are populated, OR call `identityTracker.getIdentity(item)` for the default case. Build a `Map<string, { item, newIndex }>`.
5. **Duplicate-key detection.** If any identity key appears twice, throw `NgRepeatDuplicateKeyError` carrying the offending value. The directive's outer `try/catch` clears all current rows and emits via `$exceptionHandler('$compile')`. The list does not render until the author fixes the input.
6. **Diff and apply.** Walk the new identity map in collection order:
   - **Identity in current rows** → reuse: update `scope.$index` / `$first` / `$last` / `$middle` / `$even` / `$odd` and the item-binding(s) to the new values; move the `cloneRoot` to its new position in the DOM (use `parentNode.insertBefore(cloneRoot, anchorBefore)` where `anchorBefore` walks the previous row's `nextSibling`).
   - **Identity not in current rows** → fresh build: `$transclude((clone, transcludedScope) => { … })` to produce a new row. Populate the per-item locals + bindings on the new scope BEFORE inserting into the DOM (so first-render watchers fire with the correct values). Insert at the correct anchor.
7. **Tear down survivors of the old map not in the new map.** For each key in the previous map missing from the new: `cloneRoot.remove()` then `entry.scope.$destroy()` (order matches `ng-if`'s teardown).
8. **Replace the closure-local `currentRows` map with the new one.**

**Cleanup contract.** The directive registers exactly one `addElementCleanup(placeholder, () => { tearDownAllRows() })` at link time, so a parent `destroyElementScope` reaching the Comment placeholder still cascades teardown to every active row. The scope-destroy event on the parent scope also tears rows down via normal scope-tree propagation — both paths converge on `tearDownAllRows()`.

### 2.4. Directive factory

**New file `src/compiler/ng-repeat.ts`** (~400 LOC including TSDoc and inline reconciliation engine; under the 500-LOC ceiling).

**DDO:**

```
restrict: 'A'
priority: 1000      // higher than ng-if (600) and ng-include (400) so ng-repeat wins same-element conflicts
terminal: true      // same-element cutoff: nothing below the priority runs on the host
transclude: 'element'
```

**Factory DI shape:** `['$parse', '$animate', factory]` — initially **just** `[factory]` (no deps) is enough; `$animate` is deferred to Phase 4 and `$parse` is already reachable via the lexer's static `parse()` import. Keep the factory zero-dep, array-wrapped (`[() => ({ … })]`) to satisfy strict `annotate`.

**Link-time wiring:**

1. **Verify placeholder shape.** `if (!isComment(element)) throw new Error('ngRepeat: expected Comment placeholder')`. Matches the spec 027 Slice 2 + recent hardening precedent.
2. **Verify `$transclude`.** Defensive bail if `$transclude === undefined` (the DDO guarantees it but the check keeps a hypothetical future seam change from null-dereferencing).
3. **Parse the iterator expression once.** `const parsed = parseIteratorExpression(attrs.ngRepeat)`. A throw routes via the existing factory `try/catch` in `$$buildDirectiveArrayProvider` — registration-link distinction is handled by the spec 023+ pattern.
4. **Create the identity tracker.** `const identity = createIdentityTracker()`.
5. **Closure-local row state.** `let currentRows: Map<string, RowEntry> = new Map()`.
6. **Install the collection watcher.** `scope.$watchCollection(parsed.collectionExpr, (newCollection) => { reconcile(newCollection) })` where `reconcile` is the algorithm above.
7. **Register cleanup.** `addElementCleanup(placeholder, () => tearDownAllRows(currentRows))`.
8. **Listen for scope destruction.** `scope.$on('$destroy', () => tearDownAllRows(currentRows))` — covers the "parent scope destroyed without DOM teardown" path.

**Per-item locals — exact propagation rules:**

| Local | When | How |
| --- | --- | --- |
| `$index` | Per-row | Reassign in the reconciliation walk; covered by the watcher digest because the per-item scope already inherits prototypally from the parent. |
| `$first` | Per-row | `index === 0`. |
| `$last` | Per-row | `index === lastIndex`. |
| `$middle` | Per-row | `index > 0 && index < lastIndex`. |
| `$even` | Per-row | `index % 2 === 0`. |
| `$odd` | Per-row | `index % 2 !== 0`. |
| Item bindings | Per-row | For `item in list`: `scope[parsed.valueIdent] = item`. For `(key, value) in obj`: `scope[parsed.keyIdent] = key; scope[parsed.valueIdent] = value`. |

**Why `scope.$new()` and not `scope.$new(true)`.** `ng-repeat` rows inherit prototypally — siblings' watchers, parent scope's properties, the alias all flow through normally. The isolate-scope semantics from spec 022's `bindToController` are intentionally NOT in play here. Matches AngularJS canonical behavior.

**`onload`-style hook?** AngularJS-canonical `ng-repeat` has none. The roadmap mentions `$animate` hooks only, deferred.

### 2.5. Module registration

**Edit `src/core/ng-module.ts`** — single line in the existing structural-directive block (alphabetized between `ngInit` and `ngSwitch`):

```ts
$compileProvider.directive(NG_REPEAT_NAME, ngRepeatDirective);
```

`NG_REPEAT_NAME = 'ngRepeat'` is a file-local constant in `ng-repeat.ts`, exported only because the registration site needs it (matches the spec 027 precedent for `NG_IF_NAME`, etc.).

**File-local exports only.** Per the spec 023+ DI-only precedent, `ngRepeatDirective` is NOT re-exported from `@compiler/index.ts` and NOT re-exported from the root barrel. Reachable via `injector.get('ngRepeatDirective')` when an app declares `'ng'` in its deps.

### 2.6. New error classes (public API)

Three new classes in `src/compiler/compile-error.ts`, re-exported from `@compiler/index.ts` and the root barrel — consumers may want to `catch (err) { if (err instanceof NgRepeatDuplicateKeyError) { … } }`:

| Class | Triggers | Message |
| --- | --- | --- |
| `NgRepeatBadIteratorExpressionError` | Iterator regex did not match. | `ngRepeat: invalid iterator expression "<raw>". Expected "ITEM in COLLECTION [as ALIAS] [track by EXPR]".` |
| `NgRepeatBadIdentifierError` | An item / key / value / alias name is empty, contains punctuation, or violates the identifier rules. | `ngRepeat: invalid identifier "<name>" in expression "<raw>". Identifiers must start with a letter, dollar, or underscore.` |
| `NgRepeatDuplicateKeyError` | Two items in the collection resolve to the same identity (default tracker OR custom `track by` expression). | `ngRepeat: duplicate identity "<key>" for items <itemA>, <itemB> in expression "<raw>". Use "track by" to provide unique identities.` |

**No new `EXCEPTION_HANDLER_CAUSES` token.** All three route via the existing `'$compile'` cause token. The tuple stays at 10.

### 2.7. Public-API surface changes

- **`@compiler/index.ts`** gains three new error-class re-exports: `NgRepeatBadIteratorExpressionError`, `NgRepeatBadIdentifierError`, `NgRepeatDuplicateKeyError`. No other type / value surface.
- **`src/index.ts`** root barrel gains the same three re-exports.
- **No widening of any existing type.** `LinkFn`, `Directive`, `NormalizedTransclude` are all untouched.
- **`ngRepeatDirective` factory itself is NOT exported** (matches `ngIfDirective`, `ngSwitchDirective`, `ngIncludeDirective`, `ngInitDirective`, `ngControllerDirective` — DI-only precedent).

### 2.8. Documentation

- **File-level TSDoc** in `ng-repeat.ts` covering: the `transclude: 'element'` foundation; the reconciliation algorithm summary; the identity-tracker contract; the WeakMap-vs-`$$hashKey` divergence; the `as alias` parent-scope publication contract; the duplicate-detection-throws-at-watch-time contract; the `$animate` deferral.
- **TSDoc** on each error class.
- **New "Where to look when…" rows** in `CLAUDE.md`:
  - "How does `ng-repeat` decide row identity?" → `src/compiler/ng-repeat-identity.ts`
  - "How does `ng-repeat` parse its iterator expression?" → `src/compiler/ng-repeat-iterator-parse.ts`
  - "How does `ng-repeat` reconcile DOM rows on list updates?" → `src/compiler/ng-repeat.ts` (search for `reconcile`)
- **New invariants** in `CLAUDE.md`:
  - The WeakMap-based identity tracker (no `$$hashKey` injection, deliberate divergence).
  - The `as alias` write happens BEFORE row reconciliation in the same listener fire.
  - Duplicate-key detection throws within the watch listener and routes via `$exceptionHandler('$compile')` — rows do not render until the input is fixed.
  - `priority: 1000` makes `ng-repeat` win same-element conflicts against `ng-if` / `ng-controller` (the canonical pattern `<li ng-repeat="…" ng-class="…">` is unaffected because `ng-class` is not a structural directive).
- **README sections** updated where `@compiler/README.md` lists the spec-027 structural directives — add `ng-repeat` to the same surface list.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`scope.$watchCollection` (Phase 1 core):** the directive's only watcher. No changes needed.
- **`transclude: 'element'` foundation (spec 027 Slice 2):** the directive uses it directly. No widening required; the existing default-bucket linker handles single-element captures.
- **`parse()` (spec 010 parser):** evaluates `<collection>` and `<track by>` sub-expressions. No changes needed.
- **`addElementCleanup` (spec 017):** registers the placeholder-level teardown callback. No changes needed.
- **`destroyElementScope` / `$on('$destroy')` (spec 017 + core):** standard scope-destroy propagation tears rows down through both paths.
- **`isComment` guard (`src/compiler/node-guards.ts`):** verifies the link-time element is the Comment placeholder. Recently hardened across `ng-if` / `ng-switch` / `ng-include`; same pattern reused here.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The reconciliation algorithm is the most complex piece in this directive; an off-by-one in the DOM `insertBefore` anchor walk could place rows in the wrong order. | Targeted parity tests with row reorder permutations (3-item, 5-item, 10-item lists; full reverse; one-from-end-to-front; arbitrary shuffles). Tests assert the rendered text-content matches the data exactly. |
| Identity collisions in the default tracker (two distinct objects both mapped to the same string) would corrupt the row map silently. | The WeakMap-based tracker uses a monotonic counter — collisions are impossible by construction. Tested by injecting many objects and asserting all identities differ. |
| The `as alias` publication writes to `parentScope[aliasIdent]` — if the author chooses a name that shadows an existing scope property, the existing value is silently overwritten. | Validated at parse time via `NgRepeatBadAliasError` against the four reserved names (`$index`, `$first`, etc. plus the item/key/value idents declared in the same expression). Generic shadowing of other parent properties is documented as the author's responsibility — matches AngularJS. |
| `track by EXPR` evaluated against the wrong scope could produce wrong identities (e.g. evaluating against the parent instead of a temporary item-aware scope). | The reconciliation algorithm evaluates `track by` against a transient scope where `$index` + item bindings are populated FIRST, then reads back the result. Tested by `track by` expressions that reference per-item locals. |
| Performance: a large list (10k+ items) reconciling on every digest could thrash. | The algorithm is O(n) — single pass to build the new map, single pass through new keys to compute reuse/insert decisions, single pass through dropped keys to tear down. No nested loops. Matches AngularJS's complexity bound. A perf test is included in the suite (10k items, reorder, assert digest under a budget). |
| The duplicate-detection throw lands inside the watch listener; the scope's `$watchCollection` listener catch (digest's `'watchListener'` cause path) would also fire — but the directive's own catch should take precedence. | The directive wraps the reconciliation block in `try { reconcile(newCollection) } catch (err) { invokeExceptionHandler($eh, err, '$compile') }`. The watch listener itself does NOT re-throw — the digest sees a clean return and the `'watchListener'` path is not exercised. Verified with a regression test. |
| Memory: a stale `WeakMap` entry could theoretically retain an object if the directive itself outlives the user's collection. | `WeakMap` is GC-friendly by construction — when the user drops the object reference, the entry is reclaimable. The `currentRows` map (which holds strong references to the per-item scopes) is cleared on tear-down. Tested with a long-lived `ng-repeat` and a constantly-mutating collection — heap snapshots show no growth. |
| `transclude: 'element'` declares `terminal: true` on `ng-repeat`; pairing it on the same element with another structural directive (e.g. `<li ng-repeat="…" ng-if="…">`) triggers `MultipleTranscludeDirectivesError`. | This is the documented behavior — same as the spec 027 cluster. The canonical fix is nesting (`<li ng-repeat="…"><span ng-if="…">…</span></li>`). Documented in the directive TSDoc; same-element conflict test added to the suite. |

---

## 4. Testing Strategy

**New test files under `src/compiler/__tests__/`:**

| Test file | Concern |
| --- | --- |
| `ng-repeat-iterator-parse.test.ts` | Top-level grammar: all four optional-clause combinations; LHS variants (`item`, `(k, v)`); error classes thrown on bad iterator / bad identifier / bad alias / clause order. |
| `ng-repeat-identity.test.ts` | Object identity stable across digests; primitives get type-prefix sentinels; NaN normalized; null/undefined distinct; WeakMap entries reclaimed when objects are dropped. |
| `ng-repeat.test.ts` | Basic array iteration; per-item locals (`$index`, `$first`, `$last`, `$middle`, `$even`, `$odd`); object iteration with alphabetical key order; `track by` reuses rows; `as alias` publishes filtered list on parent; combined forms (`item in list \| filter:q as visible track by item.id`); duplicate-key error routes via `$exceptionHandler('$compile')`; non-iterable values render nothing; restrict / priority / terminal verified; nested `ng-repeat` shadowing; row reorder preserves DOM node identity and inner state (focus preservation test using a focused `<input>`). |
| `ng-repeat-integration.test.ts` | `ng-repeat > ng-if`; `ng-repeat > ng-controller`; `ng-repeat > ng-include`; `ng-repeat` inside `ng-if`; nested `ng-repeat`; same-element conflict with `ng-if` → `MultipleTranscludeDirectivesError`. |
| `ng-repeat-parity.test.ts` | Behavioral parity against AngularJS upstream test vectors (`angular/angular.js/test/ng/directive/ngRepeatSpec.js` shapes). |
| `cross-spec-smoke.test.ts` (extend existing) | `injector.has('ngRepeatDirective') === true` when an app declares `'ng'`; module-DSL decorator override path: `module.decorator('ngRepeatDirective', …)` works. |
| `exception-handler-causes.test.ts` (extend existing) | `EXCEPTION_HANDLER_CAUSES.length === 10` invariant holds; the three new `ngRepeat*Error` classes route via `'$compile'`; the `'watchListener'` cause is NOT exercised on the duplicate-key path. |

**Reference suite.** Parity tests port behavior from `angular/angular.js/test/ng/directive/ngRepeatSpec.js`. Where AngularJS's tests rely on `$$hashKey` introspection, those are translated to identity-based assertions (since our project uses WeakMap-based tracking).

**Coverage target:** 95%+ on `ng-repeat.ts`, `ng-repeat-iterator-parse.ts`, `ng-repeat-identity.ts`. The directive is gateway code for real applications; the existing 90% project-wide threshold is exceeded here.
