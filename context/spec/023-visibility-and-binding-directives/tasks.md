# Tasks: Visibility & Binding Directives

- **Specification:** `context/spec/023-visibility-and-binding-directives/`
- **Status:** Draft

---

- [x] **Slice 1: Compiler extension — `terminal: true` halts child descent**
  - [x] In `src/compiler/compile.ts`'s `compileNode` walker, add the additive check per technical-considerations §2.6: when any matched directive on the current element has `terminal === true`, skip recursion into `element.childNodes`. The existing same-element terminal cutoff in `directive-collector.ts` stays unchanged. This is the AngularJS-canonical broader semantic, foundational for spec 023's `ng-non-bindable`. **[Agent: typescript-framework]** _(Implementation deviation — narrowed to `directive.name === 'ngNonBindable'` only, per the audit below.)_
  - [x] Audit the full existing test suite (specs 002–022) for any test that pinned the OLD "terminal does not stop child descent" behavior — i.e. a test that sets `terminal: true` on a directive AND asserts a child directive runs. Expected zero matches. If a match is found, narrow the §2.6 change to apply only when the matched directive's name is `ngNonBindable` and report it. **[Agent: typescript-framework]** _(Audit FOUND a match: `src/compiler/__tests__/terminal.test.ts:178–228` pins the old narrower semantic with a custom `terminal: true` directive. The §2.6 change was narrowed to `name === 'ngNonBindable'` as instructed.)_
  - [x] Create `src/compiler/__tests__/terminal-no-descent.test.ts` — directly tests the compiler extension via a custom directive with `terminal: true` + a child directive that would otherwise compile; assert the child does NOT run. Pins the broadened invariant independent of `ng-non-bindable`. **[Agent: vitest-testing]** _(Test uses a surrogate directive registered as `ngNonBindable` to exercise the narrowed hook before Slice 6 ships the real factory.)_
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior specs (002–022) pass unchanged. `EXCEPTION_HANDLER_CAUSES.length === 10` holds. **[Agent: rollup-build]**

- [x] **Slice 2: `ng-cloak` — compile-time cleanup**
  - [x] Create `src/compiler/ng-cloak.ts` exporting the `ngCloakDirective` factory per technical-considerations §2.2: `restrict: 'AC'`, a `compile(element)` function that calls `element.removeAttribute('ng-cloak')` and `element.classList.remove('ng-cloak')` then returns an empty link. Zero deps, array-form factory (`[() => ({...})]`). Full TSDoc with `@example`. **[Agent: typescript-framework]**
  - [x] Extend the existing `$compileProvider` config block in `src/core/ng-module.ts` (the spec-018 block that registers `ngTransclude`) to also register `ngCloak`. Import `ngCloakDirective` from `@compiler/ng-cloak`. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/ng-cloak.test.ts` — attribute form removed after compile (`<div ng-cloak>` no longer has the attribute); class form removed after compile (`<div class="ng-cloak">` no longer has the class); idempotent on re-compile of a clean element (no throw); no watch is installed (assert no `$watch` registered on the scope after link). **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests + Slice 1 pass unchanged. `EXCEPTION_HANDLER_CAUSES.length === 10`. **[Agent: rollup-build]**

- [x] **Slice 3: `ng-bind` + `ng-bind-template` — text binding**
  - [x] Create `src/compiler/ng-bind.ts` per technical-considerations §2.3: `restrict: 'A'`, post-link function that calls `scope.$watch(attrs.ngBind, value => element.textContent = value == null ? '' : String(value))`. Zero deps, array-form factory. Full TSDoc. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/ng-bind-template.ts` per technical-considerations §2.4: `restrict: 'A'`, factory `['$interpolate', $interpolate => ({...})]`. Link fn calls `$interpolate(attrs.ngBindTemplate)` once to get an `InterpolateFn`, then `scope.$watch(interpolateFn, value => element.textContent = value)`. Full TSDoc. **[Agent: typescript-framework]**
  - [x] Extend the `$compileProvider` config block in `src/core/ng-module.ts` to register both `ngBind` and `ngBindTemplate`. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/ng-bind.test.ts` — `textContent` set from the expression; updates on digest when the value changes; `null` and `undefined` → empty string; numbers/booleans stringified (`String(42)` → `'42'`); HTML special chars escaped (a value of `'<script>'` renders as literal `'<script>'` text, not as a tag). **[Agent: vitest-testing]**
  - [x] Create `src/compiler/__tests__/ng-bind-template.test.ts` — interpolated string set as text; multiple `{{ }}` segments resolved; updates when any referenced expression changes; empty template renders empty string; HTML special chars escaped. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests pass unchanged. **[Agent: rollup-build]**

- [x] **Slice 4: `ng-show` + `ng-hide` — visibility toggles**
  - [x] Create `src/compiler/ng-show.ts` per technical-considerations §2.1: `restrict: 'A'`, post-link calls `scope.$watch(attrs.ngShow, value => element.classList.toggle('ng-hide', !value))`. Zero deps, array-form factory. Full TSDoc with `@example` mentioning the consumer-shipped `.ng-hide { display: none !important; }` CSS rule. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/ng-hide.ts` — mirror of `ng-show` with inverted truthiness: `element.classList.toggle('ng-hide', !!value)`. Full TSDoc. **[Agent: typescript-framework]**
  - [x] Extend the `$compileProvider` config block in `src/core/ng-module.ts` to register `ngShow` and `ngHide`. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/ng-show.test.ts` — `.ng-hide` class added when expression is falsy, removed when truthy; toggles correctly on digest as the watched value flips; other classes already on the element are preserved; falsy values exercised (`null`, `undefined`, `0`, `''`, `false`, `NaN`); truthy values exercised (string `'false'` is truthy, non-empty array/object). **[Agent: vitest-testing]**
  - [x] Create `src/compiler/__tests__/ng-hide.test.ts` — mirror-inverse of the `ng-show` suite: class added when truthy, removed when falsy. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests pass unchanged. **[Agent: rollup-build]**

- [x] **Slice 5: `ng-bind-html` — trusted HTML binding**
  - [x] Create `src/compiler/ng-bind-html.ts` per technical-considerations §2.5: `restrict: 'A'`, factory `['$sce', $sce => ({...})]` (drop the `$parse` dep — use `scope.$watch(attrs.ngBindHtml, …)` form per the §2.5 fallback note; verify whether `$parse` exists as a DI service during implementation and choose accordingly). Link fn: `scope.$watch(attrs.ngBindHtml, rawValue => element.innerHTML = rawValue == null ? '' : $sce.getTrustedHtml(rawValue))`. Full TSDoc cross-referencing spec 013's `$sce` → `$sanitize` fallback. **[Agent: typescript-framework]** _(`$parse` confirmed NOT a DI service; used the `scope.$watch(expr, …)` fallback form.)_
  - [x] Extend the `$compileProvider` config block in `src/core/ng-module.ts` to register `ngBindHtml`. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/ng-bind-html.test.ts` — TWO describe-blocks per technical-considerations §2.5: (a) with `ngSanitize` loaded (untrusted plain string is sanitized and rendered with disallowed tags stripped — pattern from `src/sanitize/__tests__/sanitize-sce.test.ts`); (b) without `ngSanitize` (untrusted plain string causes the trust error to surface, listener catches via digest's existing `'watchListener'` path, `innerHTML` degrades to empty). PLUS shared cases across both: a trusted value (from `$sce.trustAsHtml`) renders as actual HTML; `null`/`undefined` → empty innerHTML; updates on change. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests pass unchanged. `EXCEPTION_HANDLER_CAUSES.length === 10` holds. **[Agent: rollup-build]**

- [x] **Slice 6: `ng-non-bindable` — leverages Slice 1's compiler extension**
  - [x] Create `src/compiler/ng-non-bindable.ts` per technical-considerations §2.6: `restrict: 'AC'`, `terminal: true`, `priority: 1000`, no link function (or an empty link). Zero deps, array-form factory. Full TSDoc explaining the interaction with the Slice 1 compiler extension. **[Agent: typescript-framework]**
  - [x] Extend the `$compileProvider` config block in `src/core/ng-module.ts` to register `ngNonBindable`. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/ng-non-bindable.test.ts` — children with `{{ }}` are NOT interpolated (literal mustaches preserved in text); child directives don't run (set up a custom directive on a child that would otherwise add a class — assert the class is NOT added); the element's own attributes still resolve (e.g. `class="foo"` is preserved); siblings and ancestors compile normally; same-element regression — a lower-priority directive on the same element does NOT run (existing terminal-cutoff behavior). **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All prior tests + Slices 1–5 pass unchanged. **[Agent: rollup-build]**

- [x] **Slice 7: Documentation, AngularJS parity port, final regression**
  - [x] Create `src/compiler/__tests__/spec023-parity.test.ts` — port canonical-pattern tests from AngularJS 1.x for each directive. Do NOT clone the upstream repo; write focused tests covering the documented AngularJS behaviors (e.g. `ng-bind` escapes HTML, `ng-bind-html` requires SCE trust, `ng-show` toggles `.ng-hide`, `ng-non-bindable` halts child compilation). Mark animation-related upstream cases as `it.skip(...)` with citations to the Phase 4 Animations roadmap item. Include a literal `expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10)` regression guard. **[Agent: vitest-testing]**
  - [x] Update `src/compiler/README.md` — new "Visibility & Binding built-ins (spec 023)" section per technical-considerations §2.8: one paragraph per directive, the consumer-shipped CSS block (`.ng-hide { display: none !important; }` + `[ng-cloak], .ng-cloak { display: none !important; }`), animation-deferred note, spec 013 cross-reference. Plus a new "Terminal directives" sub-section documenting the Slice 1 broadened semantic. **[Agent: typedoc-docs]**
  - [x] Update `CLAUDE.md` — amend the `./compiler` Modules row to mention the seven new directives; add a new "Non-obvious invariants" bullet for the broadened `terminal: true` semantic from Slice 1; add 7 new "Where to look when…" rows (one per directive). **[Agent: typedoc-docs]**
  - [x] TSDoc audit on every new public export from `@compiler/index` — the seven new directive factories. Each carries at least one runnable `@example`. **[Agent: typedoc-docs]**
  - [x] Final regression check: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All five gates pass. Full prior-spec test suite (002–022) passes unchanged. `EXCEPTION_HANDLER_CAUSES.length === 10` invariant held. New observable: `<div ng-show>`, `<div ng-hide>`, `<div ng-cloak>`, `<span ng-bind="…">`, `<span ng-bind-template="…">`, `<div ng-bind-html="…">`, `<pre ng-non-bindable>` all work end-to-end. **[Agent: rollup-build]**

---

## Notes for the Implementation Agent

- **No new `EXCEPTION_HANDLER_CAUSES` entry.** The `'$compile'` and `'watchListener'` tokens cover every Slice 1–7 error site. The tuple stays at 10.
- **The Slice 1 compiler extension is foundational** — `ng-non-bindable` (Slice 6) depends on it. Do not reorder.
- **Both `ng-show` and `ng-hide` use `.ng-hide`** — the class name is the same; the truthiness check is inverted. This is the AngularJS-canonical idiom.
- **`ng-bind-html` consumes the existing spec 013 `$sce` → `$sanitize` fallback** — do not re-implement sanitization in the directive.
- **Each directive registers via the same `$compileProvider` config block** in `src/core/ng-module.ts` that spec 018 introduced for `ngTransclude`. Append to the block, don't create new ones.
- **All seven factories are array-form `[() => ({...})]`** (or `['$dep', $dep => ({...})]` when a service is needed) — the `annotate` helper rejects bare functions without `$inject`.
- **Tick task checkboxes in the SAME commit as the implementation** per `CLAUDE.md` — the co-modification of `tasks.md` + `src/` in one commit is the traceability signal the audit looks for.
