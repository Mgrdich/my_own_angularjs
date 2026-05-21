# Technical Specification: Visibility & Binding Directives

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Seven directives, all layered onto the existing `@compiler` pipeline — no new module subpath. Six are simple post-link directives (`ng-show`, `ng-hide`, `ng-cloak`, `ng-bind`, `ng-bind-template`, `ng-bind-html`); the seventh (`ng-non-bindable`) requires a small additive extension to the compiler's child-descent decision so that a `terminal: true` directive also halts recursion into children — the AngularJS-canonical semantic that spec 017 only implemented half of.

The work splits into three areas:

1. **`@compiler` — bulk of the work.** Seven new `src/compiler/ng-<name>.ts` files (one per directive). One additive line in `src/compiler/compile.ts`'s `compileNode` to honor `terminal` as a no-descent signal. One new section in `src/compiler/README.md` documenting the consumer-shipped CSS rules.
2. **`@core` — one registration block.** Extend the existing `$compileProvider` config block in `src/core/ng-module.ts` (the same block that already registers `ngTransclude` from spec 018) to register all seven new directives.
3. **No `@di`, `@parser`, `@sce`, `@sanitize`, `@controller`, `@template` changes.** Every consumed service already exists. `ng-bind-html`'s `$sce.getTrustedHtml` → `$sanitize` fallback is the existing spec-013 integration; this spec only consumes it.

Error routing reuses the existing `'$compile'` cause token — `EXCEPTION_HANDLER_CAUSES` stays at 10. No new error classes.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 `src/compiler/ng-show.ts` and `src/compiler/ng-hide.ts`

Each file exports a directive factory. The two are mirror images — same shape, inverted truthiness:

**Shape:** `restrict: 'A'`, no isolate scope, no controller, no transclusion. Single post-link function:

- Reads the expression from `attrs.ngShow` / `attrs.ngHide`.
- Calls `scope.$watch(expr, value => …)`.
- The listener calls `element.classList.toggle('ng-hide', shouldHide)`.
- For `ng-show`: `shouldHide = !value`.
- For `ng-hide`: `shouldHide = !!value`.

Both factories return the canonical array-form `[() => ({ restrict, link })]` (zero deps, matches spec 022's component-translation precedent for the `annotate` helper).

The `ng-hide` CSS class is treated as a string constant — no need to extract it to a shared module. Other classes on the element are preserved because `classList.toggle` only touches the named class.

### 2.2 `src/compiler/ng-cloak.ts`

Single shortest directive in the batch: `restrict: 'AC'`, no watch, no link. A `compile(element)` function that does:

- `element.removeAttribute('ng-cloak')` (idempotent — `removeAttribute` on a missing attr is a no-op).
- `element.classList.remove('ng-cloak')` (idempotent — `classList.remove` on a missing class is a no-op).
- Returns no link function (or returns an empty one — the compile-only pattern is supported by spec 017's three-phase linker).

`restrict: 'AC'` lets consumers use either `<div ng-cloak>` (attribute form) or `<div class="ng-cloak">` (class form). The directive runs at compile time only, so no digest cost.

### 2.3 `src/compiler/ng-bind.ts`

`restrict: 'A'`, post-link function:

- Reads the expression from `attrs.ngBind`.
- `scope.$watch(expr, value => element.textContent = value == null ? '' : String(value))`.

The `value == null` check covers both `null` and `undefined`. Non-string values are coerced via `String()` — matches AngularJS-canonical behavior (numbers, booleans, etc. all stringify).

The `textContent` setter handles HTML escaping automatically — any `<`, `&`, `>` etc. in the value appear literally in the rendered DOM. This is the security-relevant difference from `ng-bind-html`.

### 2.4 `src/compiler/ng-bind-template.ts`

`restrict: 'A'`, post-link function with one extra step:

- Resolves the `$interpolate` service via DI (injected into the factory as `['$interpolate', $interpolate => ({…})]`).
- At link time, calls `$interpolate(attrs.ngBindTemplate)` ONCE to get an `InterpolateFn`.
- `scope.$watch(interpolateFn, value => element.textContent = value)`.

The interpolated value is already a string (per existing `$interpolate` semantics) so no extra coercion needed. Empty templates produce empty strings.

### 2.5 `src/compiler/ng-bind-html.ts`

`restrict: 'A'`, post-link with two service deps:

- Factory: `['$sce', '$parse', ($sce, $parse) => ({…})]`.
- At link time, parse the expression once via `$parse(attrs.ngBindHtml)` to get an evaluator.
- `scope.$watch(evaluator, rawValue => element.innerHTML = rawValue == null ? '' : $sce.getTrustedHtml(rawValue))`.

The single-watch shape (raw value as the watched expression, `getTrustedHtml` applied in the listener) is simpler than AngularJS's two-watch split and equivalent in observable behavior — the throw if the value is untrusted-and-no-`$sanitize` happens inside the listener, routed via the digest's existing watch-listener exception path (`'watchListener'` cause). Setting `innerHTML = ''` on the failure path is the AngularJS-canonical safe state.

When `ngSanitize` is loaded, `$sce.getTrustedHtml` falls back to `$sanitize` automatically (spec 013 wiring) — this directive consumes the existing behavior, does not re-implement it.

**Note on `$parse` dependency:** `$parse` is the project's expression-evaluation primitive (`parse` from `@parser/index`, exposed via DI). If `$parse` isn't already registered on `ngModule` (need to verify during implementation), the directive can fall back to `scope.$watch(attrs.ngBindHtml, …)` which accepts an expression string directly. The `$parse` form is cleaner and matches AngularJS-canonical; the `$watch(expr, …)` form is equivalent. Defer the final choice to the implementation agent based on what's already available — if `$parse` doesn't yet exist as a DI service, use `$watch(attrs.ngBindHtml, …)`.

### 2.6 `src/compiler/ng-non-bindable.ts` + compiler extension

The directive itself is trivial: `restrict: 'AC'`, `terminal: true`, `priority: 1000`, no compile or link function (empty link). It exists purely to participate in the compiler's directive-collection pass and signal "don't recurse into children."

**The compiler extension** lives in `src/compiler/compile.ts`. In the `compileNode` function (the recursive walker), find the point where the walker descends into `element.childNodes`. Add a check: if any matched directive on the current element has `terminal === true`, **skip the child recursion**. The existing same-element terminal cutoff in `directive-collector.ts` is unchanged; this is an additional check at the walker level, equivalent to AngularJS's canonical behavior.

This is a one-line change but it's behaviorally observable for any future user of `terminal: true`. Document it in:

- `src/compiler/README.md` under a new "Terminal directives" sub-section.
- `CLAUDE.md` as a new "Non-obvious invariants" bullet: "A directive with `terminal: true` ALSO stops the compiler from descending into child nodes — spec 023 broadened the spec-017 same-element terminal cutoff to the canonical AngularJS semantic. Any directive that opts into `terminal: true` to stop sibling directives must now expect children to remain uncompiled. The existing transclude/template-loading paths are unaffected because they don't set `terminal`."

The compiler test suite from spec 017 needs a quick audit to ensure no test pinned the OLD "terminal does not stop child descent" behavior. (Almost certainly no such test exists — the case is contrived without a real consumer like `ng-non-bindable`.)

### 2.7 Module registration

Extend the existing `$compileProvider` config block in `src/core/ng-module.ts` (the spec-018 block that already registers `ngTransclude`). The block adds seven more `$compileProvider.directive(...)` calls, one per directive. Order doesn't matter — the compiler's priority + accumulation rules handle ordering at compile time.

Each directive registers under its camelCase name (`ngShow`, `ngHide`, `ngCloak`, `ngBind`, `ngBindTemplate`, `ngBindHtml`, `ngNonBindable`) so the existing `directiveNormalize` helper translates `ng-show` → `ngShow` etc. transparently.

### 2.8 Documentation

`src/compiler/README.md` gains a **"Visibility & Binding built-ins (spec 023)"** section covering:

- The seven directives + when to use each (one paragraph per directive).
- The consumer-shipped CSS block:
  ```css
  .ng-hide { display: none !important; }
  [ng-cloak], .ng-cloak { display: none !important; }
  ```
- A note that `ng-show`/`ng-hide` transitions are synchronous in this spec — animations are Phase 4.
- A cross-reference to spec 013 for the `ng-bind-html` → `$sce` → `$sanitize` integration.
- A note on the terminal-extension impact (see §2.6).

`CLAUDE.md` "Modules" table — `./compiler` row updated to mention the seven new directives. New "Non-obvious invariants" bullet for the terminal extension. "Where to look when…" rows for each of the seven directives.

`context/product/roadmap.md` — the two sub-bullets (Visibility + Binding) already cite "spec 023 — drafted." On spec close-out, both flip to `[x]` with the same citation.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`@core/scope`** — `$watch` is the primary integration point. No scope changes needed.
- **`@compiler`** — bulk of the change. The terminal-extension is the only invasive part; the seven new files are additive.
- **`@interpolate`** — `ng-bind-template` consumes `$interpolate`. No changes needed.
- **`@sce`** — `ng-bind-html` consumes `$sce.getTrustedHtml`. No changes needed.
- **`@sanitize`** — consumed indirectly via the spec-013 `$sce` → `$sanitize` fallback. Apps without `ngSanitize` get the existing trust-or-throw behavior.
- **`@parser`** — consumed indirectly via `scope.$watch`. No new dependency.
- **`@exception-handler`** — no change; `'$compile'` cause reused, no new tokens.

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The terminal-extension breaks a spec 017–022 test that pinned the old "terminal stops same-element only" behavior. | The change is additive (extends the semantic, doesn't shrink it). Audit the full test suite for tests that assert `terminal: true` AND check children were compiled. Expected zero matches — `terminal` has no live consumers besides this spec. If a test fails, narrow the change to apply only when the directive is `ng-non-bindable` (less canonical but safer). |
| `ng-bind-html` throws when `ngSanitize` isn't loaded AND the value is plain string. | This is the documented spec 013 behavior. The directive's `scope.$watch` listener catches the throw via the digest's `'watchListener'` cause; the value-display degrades to empty string for safety. Tests cover both with-`ngSanitize` and without-`ngSanitize` paths. |
| Pre-compilation flash of `ng-cloak` content if consumer forgets the CSS. | Documented in README. The directive itself can't auto-inject CSS (would violate the no-runtime-DOM-injection invariant). |
| `$parse` not yet registered as a DI service, blocking `ng-bind-html`'s clean implementation. | Use `scope.$watch(attrs.ngBindHtml, …)` form instead — scope accepts expression strings directly via the parser. Equivalent semantics. Tech-considerations §2.5 documents the fallback. |
| `ng-show`/`ng-hide` digest churn when expression value is frequently changing but the boolean truthiness is stable. | Standard `$watch` identity check handles this — if `value === lastValue`, no listener call. The truthiness check happens inside the listener only when there's an actual value change. |
| Class-list manipulation conflicts with `ng-class` (when it ships in a later spec). | `ng-class` is a separate spec slice; both will use `classList` so they don't trample each other. Concrete coordination is deferred to the `ng-class` spec. |

---

## 4. Testing Strategy

**Framework:** Vitest + jsdom (existing setup). Tests under `src/compiler/__tests__/`.

- **`ng-show.test.ts`** — class added when expression is falsy, removed when truthy; updates on digest; preserves other classes; null/undefined/0/'' all falsy; string `'false'` is truthy (per JS).
- **`ng-hide.test.ts`** — mirror inverse of `ng-show`.
- **`ng-cloak.test.ts`** — attribute form removed after compile; class form removed after compile; idempotent on re-compile; no watch installed.
- **`ng-bind.test.ts`** — textContent set; updates on change; null/undefined → empty; numbers/booleans stringified; HTML chars escaped (`<` appears literally).
- **`ng-bind-template.test.ts`** — interpolated string set; multiple expressions; updates when any expression changes; empty template accepted; HTML chars escaped.
- **`ng-bind-html.test.ts`** — trusted value renders as HTML; null/undefined → empty innerHTML; updates on change. Two test groups: one with `ngSanitize` loaded (untrusted plain string sanitized + rendered), one without (untrusted plain string throws and degrades to empty).
- **`ng-non-bindable.test.ts`** — children with `{{ }}` are not interpolated; child directives don't run; the element's own attributes still resolve; siblings and ancestors compile normally. Plus a same-element regression: a lower-priority directive on the same element does NOT run (existing terminal-cutoff behavior preserved).
- **`terminal-no-descent.test.ts`** (new) — directly tests the compiler extension: a custom directive with `terminal: true` blocks child compilation. Pins the broadened invariant.
- **AngularJS parity port** — small file `spec023-parity.test.ts` mirroring relevant cases from `angular/angular.js/test/ng/directive/ngBind*Spec.js`, `ngShowHideSpec.js`, `ngCloakSpec.js`, `ngBindHtmlSpec.js`, `ngNonBindableSpec.js`. Document deferred upstream cases (animation-related, mostly) as `it.skip(...)` with citations.
- **Regression** — full specs 002–022 suite passes unchanged. `EXCEPTION_HANDLER_CAUSES.length === 10` regression guard reasserted in `spec023-parity.test.ts`.
