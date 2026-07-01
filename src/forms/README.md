# `@forms` — forms & validation: `ngModel`, `form`, validators

The `@forms` module is the interactive layer: it lets a control capture
user input and feed it back into the app's data (**two-way binding**),
groups controls into forms that report their own validity, and validates
input with built-in and custom rules — synchronous and asynchronous —
mirroring the state-class conventions AngularJS established.

Unlike most modules, `@forms` exposes almost no callable API. Its
directives (`ngModel`, `input`, `select`, `textarea`, `form`, `ngForm`,
the validators, `ngModelOptions`, `ngOptions`, `ngList`, `ngChange`) are
**core `ng` directives** — registered on `ngModule` via a config block
(the `ngTransclude` / event-directive precedent), reachable for free by
any app that lists `'ng'` in its dependency chain. What `@forms/index`
publishes is the **contract types** a developer types against:
`NgModelController`, `FormController`, `NgModelOptions` / `ModelOptions`,
`SelectController`, and the `SyncValidator` / `AsyncValidator` /
`ModelParser` / `ModelFormatter` transform types.

```ts
const injector = createInjector(['ng']);
const $compile = injector.get('$compile');
const $rootScope = injector.get('$rootScope');

const el = document.createElement('div');
el.innerHTML = '<input ng-model="user.name">';
$compile(el.firstElementChild!)($rootScope);
$rootScope.$digest();
// Typing into the input now updates $rootScope.user.name (intermediates created).
```

## The controllers

Two controllers carry the whole surface.

### `NgModelController` — the per-control engine

Every `ng-model` control publishes an `NgModelController`, stashed on the
element under the `ngModel` key. Collaborating directives (the input-type
handlers, validators, `ngChange`) reach it via `require: 'ngModel'` /
`require: '?ngModel'`. It owns:

- **the value pipeline** — `$viewValue` (what the screen shows) and
  `$modelValue` (what binds to the data), the `$parsers` /
  `$formatters` transform lists, `$render`, and the programmatic
  `$setViewValue` / `$commitViewValue` / `$rollbackViewValue` entry
  points;
- **state** — `$dirty` / `$pristine`, `$touched` / `$untouched`,
  `$valid` / `$invalid`, plus `$setPristine` / `$setDirty` /
  `$setTouched` / `$setUntouched`;
- **validation** — `$validators` / `$asyncValidators`, `$validate()`,
  `$setValidity`, `$error`, `$pending`, and the overridable `$isEmpty`.

### `FormController` — the aggregation engine

Every `<form>` / `<ng-form>` publishes a `FormController` that
aggregates the validity + dirty + submitted state of every control and
nested sub-form beneath it. It does NOT store a boolean per control — it
counts, **per validation key**, how many controls currently fail that
key (`$setValidity(key, isValid, control)` pushes / removes the control
from the key's failure set). That makes control removal correct for
free: dropping a control (via `ng-if`) removes it from every key's set,
so a form invalid only because of a since-removed control flips back to
valid on its own.

A named form (`<form name="myForm">`) publishes onto the surrounding
scope, and named controls publish onto the form instance, so an
expression reads `myForm.$invalid` and `myForm.email.$invalid`. A
form-less `ngModel` (`<input ng-model>` with no enclosing form) targets a
shared no-op `nullFormCtrl`, so no call site needs a null-check.

## The value pipeline

```
  user types                                    model changes in code
      │                                                   │
   $setViewValue(v)                              scope.$watch(modelExpr)
      │                                                   │
   $parsers (forward, registration order)        $formatters (REVERSE order)
      │                                                   │
   $$runValidators ── valid? ── write model      $render → DOM control
      │
   $viewChangeListeners (backs ng-change)
```

- **`$parsers`** run view → model in **registration order** on every
  committed view change; a parser returning `undefined` short-circuits
  the rest (a failed parse — the `parse` validity key fails and the
  value is kept out of the model).
- **`$formatters`** run model → view in **reverse** registration order
  whenever the bound model changes; the final string feeds `$render`.
- The model write-back is built with `buildParentWriter`
  (`@compiler/expression-assign` — the same assignable-write machinery
  `ngRef` / the `=` isolate binding use), so a dotted `ng-model="a.b.c"`
  auto-creates its intermediate objects. A **non-assignable** model
  (`ng-model="a + b"`, `ng-model="fn()"`) routes
  `NgModelNonAssignableError` via `$exceptionHandler('$compile')` and the
  directive goes inert.
- A **model→view feedback guard** on the model watch runs the pipeline
  only when the scope model actually diverges from the cached
  `$modelValue`, so the watch never clobbers a live keystroke and async
  validators do not fire twice per keystroke.

## State + CSS classes

Every state is reflected onto the element as a CSS class so an app styles
validation feedback with plain CSS
(`.ng-invalid.ng-touched { border-color: red; }`). The full parity
surface:

| Pair / class | Meaning |
| --- | --- |
| `ng-valid` / `ng-invalid` | no failing rules / at least one |
| `ng-pristine` / `ng-dirty` | unchanged / changed by the user |
| `ng-untouched` / `ng-touched` | not visited / focused-then-blurred |
| `ng-empty` / `ng-not-empty` | `$isEmpty($viewValue)` |
| `ng-pending` | at least one async validator is outstanding |
| `ng-valid-<rule>` / `ng-invalid-<rule>` | per-rule validity (key dasherized) |
| `ng-submitted` (form) | a submit has been attempted |

Class toggling is **append-only and synchronous**: the framework only
ever toggles classes it manages and its mutually-exclusive partner —
author classes (`<input class="form-control">`) are never stripped (the
`ng-class` guarantee). There is **no `$animate` integration** — visibility
/ validation transitions are synchronous today; `$animate` lands with the
Animations roadmap item (Phase 4). Per-rule class names are dasherized
(`maxLength` → `ng-invalid-max-length`) via the AngularJS
`snake_case(name, '-')` rule.

## The input-type matrix

A **single** `input` directive matches every `<input>` and dispatches on
`attrs.type` into an internal handler registry (AngularJS parity — not
one directive per type). `textarea` delegates to the `text` handler.
Unknown / absent types fall back to `text`.

| `type` | Model value | Notes |
| --- | --- | --- |
| `text` / `search` / `tel` / `password` | string | baseline |
| `email` | string | ALSO wires the `email` shape validator |
| `url` | string | ALSO wires the `url` shape validator |
| `number` | number | bad input → `number` invalid, not a bad model |
| `range` | number | clamps to `min` / `max` / `step` |
| `checkbox` | boolean | `ng-true-value` / `ng-false-value` overrides; `$isEmpty` = unchecked |
| `radio` | selected value | a group shares the model; `$render` sets `.checked` |
| `date` / `datetime-local` / `time` / `month` / `week` | `Date` | per-type parse/format, honors `ngModelOptions.timezone` |
| `hidden` / `button` / `submit` / `reset` | — | no-model no-ops |
| `<select>` | value | `multiple` binds an **array** |

`number` / `date` controls read the native `validity.badInput` flag: the
browser reports `value === ''` when it could not sanitize the raw input,
so `badInput` is the only signal the garbage is still present.

## Validators

Built-in validators are attribute directives; each `require: '?ngModel'`
and pushes a rule onto the control's `$validators` map under a fixed key,
so a failure surfaces `ng-invalid-<key>` + `$error[key]` and bubbles to
the enclosing form. Length / pattern validators **pass on an empty
value** — emptiness is `required`'s concern alone, so `required` +
`ng-minlength` compose.

| Directive | Key | Rule |
| --- | --- | --- |
| `required` / `ng-required="expr"` | `required` | non-empty (conditional form gates on `expr`) |
| `ng-minlength` / `ng-maxlength` | `minlength` / `maxlength` | text length bound |
| `pattern` / `ng-pattern` | `pattern` | regex match (literal `/…/`, expression `RegExp`, or string) |
| `min` / `max` (on `number` / `range` / date) | `min` / `max` | numeric / `Date` range |
| `email` / `number` / `url` (type) | `email` / `number` / `url` | wired by the input-type handler, not a standalone attribute |

Each re-validates when its bound parameter changes: the native attribute
is `$observe`d when present, otherwise the `ng-*` expression is
`$watch`ed (observing a missing attribute would fire a spurious one-shot
`undefined`).

### Custom validators + `$pending`

```ts
// A synchronous rule (require: 'ngModel' → the controller):
ctrl.$validators['evenLength'] = (modelValue, viewValue) => String(viewValue).length % 2 === 0;

// An asynchronous rule — resolves for valid, rejects for invalid:
ctrl.$asyncValidators['unique'] = (modelValue) =>
  $http.get(`/check?name=${modelValue}`).then((res) => {
    if (res.data.taken) return $q.reject();
    return true;
  });
```

The validation engine (`validation.ts`) runs in **three stages**:

1. **Parse** — a failed `$parsers` chain fails only the `parse` key and
   skips every validator.
2. **Sync** — every `$validators` rule runs against
   `(modelValue, viewValue)`; if any fails, async is skipped.
3. **Async** — reached only when every sync rule passes. Each async key
   is marked pending (`$setValidity(key, undefined)` — the tri-state),
   `ng-pending` goes on, and `$q.all(...)` awaits. On settle each key
   resolves valid / invalid by whether its promise resolved / rejected.

`$setValidity` is **tri-state**: `true` (valid) / `false` (invalid) /
`undefined` (pending) — the three maps (`$error`, `$$success`,
`$pending`) are mutually exclusive per key. A monotonic
`$$currentValidationRunId` **cancels stale async passes**: a slow server
check that resolves after the user has typed again captures the id at
start and no-ops if a newer pass has begun. By default an invalid value
is kept **out of the model** (`$modelValue → undefined`);
`ngModelOptions.allowInvalid` flips that.

## `ngModelOptions`

`ng-model-options="{ … }"` tunes how and when a descendant `ng-model`
commits and reads/writes:

| Option | Effect |
| --- | --- |
| `updateOn` | which DOM events COMMIT (e.g. `'blur'`); non-committing events still BUFFER the pending value |
| `debounce` | delay (ms) before commit — a number, or a per-event map (`{ default: 300, blur: 0 }`) |
| `allowInvalid` | write invalid values to the model |
| `getterSetter` | the `ng-model` expression is a function used both to read (`fn()`) and write (`fn(v)`) |
| `timezone` | how date/time controls interpret + display their value |

Resolution is a **`$$ngControllers` stash walk** (not a
`require: '^^?ngModelOptions'` — a deliberate parity departure): the
control's link walks its own element's stash then the `parentElement`
chain for the nearest resolved `ngModelOptions`, because same-element
`require` resolution runs too early to see the fully-inherited options.
A nested `ngModelOptions` inherits its ancestor's options unless the
special `'*'` token appears in `updateOn` (which resets inheritance).
`debounce` is backed by `$timeout` (`$$phase`-guarded, cancelled on
`$destroy` / supersession).

## `ngOptions` + `ngList` + `ngChange`

- **`ngOptions`** generates `<option>`s from an array or object per the
  AngularJS grammar
  (`select [as label] [group by g] [disable when d] for (k,v) in coll [track by t]`),
  regenerating on a `$watchCollection`. It lets a `<select>` bind
  objects / numbers, not just strings.
- **`ngList`** adds a `$parser` (split → trimmed array) + `$formatter`
  (join) so `<input ng-model="tags" ng-list>` turns a delimited string
  into an **array**. The delimiter is the attribute value (default `,`);
  a `/…/` value is a regex split.
- **`ngChange`** registers its expression into `$viewChangeListeners`, so
  it fires ONLY on a committed **user** change — never on a programmatic
  model change.

## `form` / `ngForm` submit + native suppression

A `<form>` auto-creates a form group. Its `submit` listener calls
`$setSubmitted()` (inside a `$$phase`-guarded `$apply` / `$evalAsync`) and,
when the form has **no `action` attribute**, `preventDefault()`s the
native submit — so a `<form ng-submit="…">` no longer navigates by
default. (This supersedes the earlier "`ng-submit` does not
`preventDefault`" note: the `form` directive now owns suppression +
`$setSubmitted`. The `ngSubmit` directive still runs the expression and
does NOT `preventDefault`; the `form` directive does not double-run it.)

## Worked example — a validated login form

```html
<form name="login" novalidate>
  <input name="email" type="email" ng-model="creds.email" required
         ng-model-options="{ updateOn: 'default blur', debounce: { default: 300, blur: 0 } }" />
  <span ng-show="login.email.$touched && login.email.$invalid">
    <span ng-show="login.email.$error.required">Email is required.</span>
    <span ng-show="login.email.$error.email">That is not a valid email.</span>
  </span>

  <input name="password" type="password" ng-model="creds.password"
         ng-minlength="8" required />
  <span ng-show="login.password.$error.minlength">At least 8 characters.</span>

  <button type="submit" ng-disabled="login.$invalid">Sign in</button>
</form>
```

- `login.$invalid` disables the button until every control is valid.
- `login.email.$error.email` / `login.password.$error.minlength` surface
  per-rule failures for targeted messages.
- The email field commits 300 ms after the last keystroke, but instantly
  on blur (`{ default: 300, blur: 0 }`).
- Add a custom async check to `login.email` by pushing onto
  `$asyncValidators` from a directive `require`-ing `ngModel`: the field
  reports `ng-pending` while the check runs and the model is not written
  until it settles.

## Notes / deviations

- **Errors route through `'$compile'`.** A non-assignable `ng-model`, a
  malformed `ngOptions` expression, and a native-listener throw all route
  via `$exceptionHandler('$compile')` — no new cause token.
  `EXCEPTION_HANDLER_CAUSES` stays at **13**.
- **`$animate` deferred** — class toggles are synchronous now.
- **Single `input` directive + internal type registry** — parity;
  `textarea` delegates to `text`.
- **`byPriority` name tie-break** — a compiler-level parity fix: same
  priority directives now tie-break on directive NAME before collection
  index, so `ngModel` links before `select` and `select`'s
  `require: '?ngModel'` resolves.
