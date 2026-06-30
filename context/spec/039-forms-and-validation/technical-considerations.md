# Technical Specification: Forms & Validation

- **Functional Specification:** `context/spec/039-forms-and-validation/functional-spec.md`
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Forms ships as a **new `src/forms/` subpath** (`@forms/*` alias, `./forms` in `package.json` exports + `rollup.config.mjs`), mirroring how `./controller` and `./async` are packaged. The directives themselves are **core `ng` directives** — they register on `ngModule` via `.config(['$compileProvider', …])` blocks (DI-only, exactly like every other built-in directive), so an app reaching `'ng'` gets them for free. The subpath exists for code organization and to **export the controller/type contracts** (`NgModelController`, `FormController`, `NgModelOptions`, `ModelValidators`, …) so consumers can type against them.

The centerpiece is **`NgModelController`** — a per-control controller (published via the existing `$$ngControllers` element stash so `require: 'ngModel'` resolves it) implementing the bidirectional value pipeline (`$formatters` / `$parsers` / `$render` / `$setViewValue` / `$validate`). Form-element directives (`input`, `textarea`, `select`) `require: '?ngModel'` and wire type-specific format/parse/render + native DOM event listeners onto it. **`FormController`** (from `form` / `ngForm`) aggregates child control + sub-form validity and publishes itself under its `name` on scope. Validators attach to `NgModelController.$validators` / `$asyncValidators`; async validators use **`$q`**. Model write-back reuses **`buildParentWriter`** from `@compiler/expression-assign`. No new `EXCEPTION_HANDLER_CAUSES` token — directive-side errors reuse `'$compile'` (the established precedent; tuple stays at 13).

`$animate` is **not** wired — all state-class toggles are synchronous via `classList`, consistent with `ng-show`/`ng-hide` and deferred to Phase 4.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Module layout & packaging

New subpath `src/forms/` (register on `ngModule`, barrel exports the public contracts):

| File | Responsibility |
| --- | --- |
| `src/forms/index.ts` | Barrel: re-export public types + `forms-register.ts` wiring; **no** directive factories in the public surface (DI-only, matches `ngTransclude` precedent) |
| `src/forms/ng-model-controller.ts` | `NgModelController` class — the value pipeline + state + validation engine |
| `src/forms/ng-model.ts` | `ngModel` directive — instantiates the controller, installs the model `$watch`, wires `ngChange` |
| `src/forms/ng-model-options.ts` | `ngModelOptions` directive + the resolved-options helper (`updateOn` / `debounce` / `allowInvalid` / `getterSetter` / `timezone`) |
| `src/forms/form-controller.ts` | `FormController` class — child registration + validity aggregation + `$setSubmitted`/`$setPristine` |
| `src/forms/form.ts` | `form` + `ngForm` directives (share one factory); submit handling; name publishing |
| `src/forms/input.ts` | the single `input` directive (`restrict: 'E'`, `require: '?ngModel'`) dispatching on `type` |
| `src/forms/input-types.ts` | the internal `inputType` registry (text/number/date-family/checkbox/radio/url/email/range/…) |
| `src/forms/input-date.ts` | date/time family parse/format helpers + `timezone` handling |
| `src/forms/select.ts` | `select` directive + `SelectController` (option registration, `multiple`) |
| `src/forms/ng-options.ts` | `ngOptions` directive — grammar parse + option generation |
| `src/forms/validators.ts` | built-in validator directives (`required`/`ngRequired`, `ngMinlength`/`ngMaxlength`, `pattern`/`ngPattern`, `min`/`max`) + the `email`/`number`/`url` type validators (registered through `input-types`) |
| `src/forms/ng-list.ts` | `ngList` directive (string ↔ array transform) |
| `src/forms/forms-register.ts` | the `.config([...])` blocks registering every directive on `ngModule` |
| `src/forms/state-classes.ts` | shared CSS-class toggling helper (`ng-valid`/`ng-dirty`/per-key/…), append-only, consumer-class-safe |

**Build wiring:** add `"./forms"` to `package.json` exports, `@forms/*` to `tsconfig.json` paths, a `{ name: 'forms/index', input: 'src/forms/index.ts' }` rollup entry + the `tsPathAliases` mirror, and `./forms` to the coverage-threshold module list.

### 2.2 `NgModelController` (the value pipeline)

Contract (method/field names are public API — AngularJS parity):

| Member | Purpose |
| --- | --- |
| `$viewValue` / `$modelValue` | current on-screen value / current stored value |
| `$parsers: Array<(v) => unknown>` | view → model transforms (run in order on `$setViewValue`) |
| `$formatters: Array<(v) => unknown>` | model → view transforms (run reverse on model change) |
| `$validators` / `$asyncValidators` | sync rule map (`(modelValue, viewValue) => boolean`) / async rule map (`=> QPromise`) |
| `$viewChangeListeners` | callbacks fired after a committed view change (backs `ngChange`) |
| `$render()` | directive-supplied; writes `$viewValue` to the DOM control |
| `$setViewValue(value, trigger?)` | entry point from the control; runs parsers → validate → write-back (honoring `updateOn`/`debounce`) |
| `$validate()` | re-run all validators against current model/view value |
| `$commitViewValue()` / `$rollbackViewValue()` | debounce/updateOn buffer flush + revert |
| `$setValidity(key, isValid)` | set a single rule's result; updates `$error`/`$pending`, toggles `ng-valid-<key>`/`ng-invalid-<key>` |
| `$error` / `$pending` | failing-rule map / outstanding-async-rule map |
| `$setPristine()`/`$setDirty()`/`$setTouched()`/`$setUntouched()` | state transitions |
| `$dirty`/`$pristine`/`$touched`/`$untouched`/`$valid`/`$invalid` | booleans mirrored to state classes |
| `$isEmpty(value)` | overridable emptiness test (drives `ng-empty`/`required`) |

- Instantiated in the `ngModel` directive's controller seam; published on the element so `require: 'ngModel'` resolves it (LinkFn 4th arg).
- Model→view: `ngModel` installs `scope.$watch(modelExpr, …)`; on change runs `$formatters` reverse, sets `$viewValue`, calls `$render()`.
- View→model write-back: parsed model expression → `buildParentWriter(parsedModelExpr)` from `@compiler/expression-assign`; non-assignable model surfaces the existing assignability error via `'$compile'`. `getterSetter` mode wraps read/write through the bound function instead.

### 2.3 Validation engine & timing

- `$setViewValue` / model-change → `$$runValidators(modelValue, viewValue, doneCallback)`: run `$validators` synchronously (set each key), then — only if all sync pass — run `$asyncValidators`, marking `$pending` and `ng-pending` until the `$q.all(...)` settles. A newer run **cancels** an in-flight async pass (generation counter) so stale resolutions don't write validity.
- `allowInvalid` (from `ngModelOptions`) decides whether an invalid parse/validation still writes `$modelValue` to scope; default keeps invalid values out (model set to `undefined`).
- Built-in validators register as **directives** that push onto `$validators`/`$parsers` (e.g. `ngMinlength` adds a `minlength` validator and `$observe`s its attribute to re-validate); the `number`/`email`/`url`/`date` **type** validators are wired by the corresponding `inputType` handler.

### 2.4 `input` directive + type registry

One `input` directive (`restrict: 'E'`, `require: '?ngModel'`, link no-op when no `ngModel`). Link dispatches `attrs.type` (default/unknown → `text`) into the internal `inputType` map:

| Type(s) | Model value | Notes |
| --- | --- | --- |
| `text`, `search`, `tel`, `password`, (`textarea` reuses) | string | baseline format/parse + `input`/`change` listeners |
| `email` / `url` | string | add `email`/`url` validators |
| `number` / `range` | number | numeric parse + `min`/`max`/`step` validators; `range` clamps |
| `date`/`datetime-local`/`time`/`month`/`week` | `Date` | per-type parse/format via `input-date.ts`, honoring `ngModelOptions.timezone`; `min`/`max` as dates |
| `checkbox` | boolean | `ng-true-value`/`ng-false-value` overrides; `$isEmpty` = not-checked |
| `radio` | the radio's value | group shares the model; `$render` sets `checked` |
| `hidden`/`button`/`submit`/`reset` | n/a | no model parsing |

`textarea` is a thin directive delegating to the `text` handler. Default `updateOn` is `input change`.

### 2.5 `select`, `ngOptions`, `ngList`

- `select`: `SelectController` tracks registered `<option>` values; single-select binds the chosen value, `multiple` binds an **array**; unknown-value renders an "unknown option" per parity.
- `ngOptions`: parse the AngularJS grammar (`select [as label] [group by g] [disable when d] for (k,v) in coll [track by t]`) into a small descriptor; regenerate options on a `$watchCollection` over the collection; integrate with `SelectController`.
- `ngList`: a `$parser` (split on delimiter → trimmed array) + `$formatter` (join), delimiter from the attribute (default `,`).

### 2.6 `FormController` (`form` / `ngForm`)

| Member | Purpose |
| --- | --- |
| `$addControl` / `$removeControl` | child control + sub-form registration |
| `$setValidity(key, isValid, control)` | bubble a child's validity; aggregate into form `$error`/`$pending` |
| `$setDirty()` / `$setPristine()` | propagate up to parent form; toggle `ng-dirty`/`ng-pristine` |
| `$setSubmitted()` | mark submitted (+ `ng-submitted`), propagate to parent |
| `$valid`/`$invalid`/`$dirty`/`$pristine`/`$pending`/`$submitted` | aggregate state |
| `$$renameControl` | support changing a control's `name` |

- `form`/`ngForm` share one factory; `require: '?^^form'` for nesting; a `nullFormCtrl` lets `ngModel` work without an enclosing form.
- Named form publishes itself on scope (`buildParentWriter`-style assignment under `attrs.name`); named controls publish onto the form instance so `myForm.email.$invalid` reads in expressions.
- `form` adds a `submit` listener that calls `$setSubmitted()` + runs `ngSubmit`, and `preventDefault`s native submit when there's no `action` (parity).

### 2.7 State CSS classes

Shared `state-classes.ts` helper toggles via `classList` (append-only; never strips author classes — same guarantee as `ng-class`): `ng-valid`/`ng-invalid`, `ng-dirty`/`ng-pristine`, `ng-touched`/`ng-untouched`, `ng-empty`/`ng-not-empty`, `ng-pending`, per-rule `ng-valid-<key>`/`ng-invalid-<key>` (key dasherized), and `ng-submitted` on forms.

### 2.8 DI registration & dependencies

- All directives registered through `forms-register.ts` `.config` blocks on `ngModule` (in `src/core/ng-module.ts` import + invoke, matching the existing built-in registration site).
- Factory deps: `ngModel`/validators need `$parse` (or `@parser` `parse`), `$q` (async validators), `$exceptionHandler` (error routing), and the date helpers; resolved via the standard array-form DI.

### 2.9 Proposed implementation slices (for `/awos:tasks`)

1. **NgModelController + ngModel + text `input`/`textarea`** — pipeline, state, classes, write-back, `ngChange`.
2. **FormController + `form`/`ngForm`** — aggregation, naming, submit, `ng-submitted`, nullFormCtrl.
3. **Input type matrix** — number/range, checkbox, radio, date/time family (+ timezone).
4. **`select` + `ngOptions` + `ngList`.**
5. **Validators** — built-in (`required`/length/pattern/min/max + email/number/url) and custom `$validators`/`$asyncValidators` + `$pending`.
6. **`ngModelOptions`** — `updateOn`/`debounce`/`allowInvalid`/`getterSetter`/`timezone` threaded through the controller.

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `$compile` (controller seam, `require`, `$observe`/`$set`), `@parser` (`parse` + `expression-assign` write-back), `$q` (async validators), `$exceptionHandler`, core `Scope` (`$watch`/`$on('$destroy')`/`$evalAsync`/`$$phase`). No changes to those modules' public contracts are anticipated.
- **Potential Risks & Mitigations:**
  - *Two-way binding feedback loops* (model watch ↔ view write). Mitigation: AngularJS's last-value guard — `$render` only on model-vs-view divergence; commit path sets `$modelValue` before writing scope.
  - *Async validator races / leaks.* Mitigation: per-run generation counter cancels stale passes; deregister on `$destroy`.
  - *Date parsing/timezone correctness* is the highest-fidelity-risk area. Mitigation: port upstream `input.js` date specs verbatim; isolate logic in `input-date.ts`.
  - *`debounce`/`updateOn` timers* must integrate with the digest and cancel on destroy. Mitigation: route through `$evalAsync`/`$applyAsync` patterns already used elsewhere; clear timers on `$destroy`.
  - *`$$phase` reentrancy* when events fire mid-digest. Mitigation: the established `$$phase`-guarded `$apply` vs `$evalAsync` dispatch used by event directives.
  - *Subpath build wiring* (4 coordinated edits). Mitigation: follow the `./async` precedent exactly; a build smoke check.
  - *Same-element conflicts* (e.g. `ngModel` requiring a missing control). Mitigation: `require: '?ngModel'` optional flags + clear `'$compile'`-routed errors.

---

## 4. Testing Strategy

- **Unit (Vitest + jsdom), parity-first:** port test vectors from `angular/angular.js/test/ng/directive/` (`ngModelSpec.js`, `inputSpec.js`, `formSpec.js`, `selectSpec.js`, `ngOptionsSpec.js`, validators) and `test/ng/` for the controller. Each slice lands its own `src/forms/__tests__/*.test.ts`.
- **Coverage:** add `forms` to the 90%-line-threshold module set in `vitest.config.ts`.
- **Behavioral focus areas:** typed model values per input type; state-class toggling (incl. per-key + `ng-pending` + `ng-submitted`); validation ordering (sync before async) and `$pending`; `ngModelOptions` timing (debounce/updateOn) with fake timers; date/timezone round-trips; nested-form aggregation and control add/remove on `ng-if`/`ng-repeat` teardown.
- **Type-level:** assert the exported `NgModelController` / `FormController` / `NgModelOptions` contracts compile against representative consumer usage (compile-only test file).
