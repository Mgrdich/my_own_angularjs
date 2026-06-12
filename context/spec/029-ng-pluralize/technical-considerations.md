# Technical Specification: Pluralization Directive (`ng-pluralize`)

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

`ng-pluralize` ships as one new built-in directive file, `src/compiler/ng-pluralize.ts`, following the established DI-only built-in pattern (specs 018/023–028): factory exported from the file, registered on `ngModule` via one line in `src/core/ng-module.ts`, **not** exported from `@compiler/index`, reachable as `injector.get('ngPluralizeDirective')`.

The directive is a leaf text-writer in the `ng-bind-template` family — no transclusion, no terminal, no child compilation — with two twists:

1. A **message-table build step at link time**: the `when` map plus per-key `when-…` attributes are folded into one record of message strings; each message has its `{}` placeholders rewritten to an interpolation of `(countExpr) - offset` and is compiled to an `InterpolateFn` exactly once.
2. A **switching watch pair**: a primary `scope.$watch` on the count expression picks the active message (exact key, else locale category); on each pick change it deregisters the previous message watch and installs `scope.$watch(chosenInterpolateFn, writeText)` — the pattern upstream ngPluralize uses, directly supported by `$watch`'s returned deregistration fn (`src/core/scope.ts:182-186`).

The one cross-module change: `LocaleService` gains a **required** `pluralCat(num): string` member (the number → plural-category rule), with the en-US implementation added to `defaultLocale`. This is the seam that makes pluralization locale-driven — apps swapping `$locale` via `module.factory('$locale', …)` bring their own rules.

Affected modules: `compiler` (new directive + 2 error classes), `filter` (locale interface + default), `core` (`ng-module.ts` registration line). No parser, scope, DI, or interpolate changes.

## 2. Proposed Solution & Implementation Plan

### 2.1. `LocaleService.pluralCat` (filter module)

| Change | Location | Shape |
| --- | --- | --- |
| Interface widening | `src/filter/locale-types.ts:137-141` | add `readonly pluralCat: (num: number) => string` (required) |
| Default implementation | `src/filter/locale.ts:139-143` (`defaultLocale`) | en-US rule: `num === 1 → 'one'`, everything else (incl. decimals, negatives, ±∞) → `'other'`. Stays inside the recursively frozen literal. |
| Test-literal updates | `src/filter/__tests__/locale.test.ts:154` and `:236` | the two custom-locale literals each gain a `pluralCat` member |

- No registry change needed — `$locale: LocaleService` is already declared in the `declare module '@di/di-types'` block at `src/core/ng-module.ts:116`; the widened interface flows through.
- Existing consumers (`currency`, `number`, `date`, `format-number`, `format-date`) read only `NUMBER_FORMATS` / `DATETIME_FORMATS` — unaffected.
- Category names are unconstrained strings (CLDR uses `zero`/`one`/`two`/`few`/`many`/`other`); the directive treats the return value as an opaque lookup key, so custom locales can use any names that match their `when` keys.

### 2.2. Directive definition (`src/compiler/ng-pluralize.ts`)

| Aspect | Decision |
| --- | --- |
| Exports | `NG_PLURALIZE_NAME = 'ngPluralize'` + `ngPluralizeDirective` (file-local, not on `@compiler/index`) |
| Factory DI | `['$interpolate', '$locale', '$exceptionHandler', ngPluralizeFactory]` — all three resolvable on `ngModule` (`ng-module.ts:152/155/169`) |
| DDO | `restrict: 'EA'`, priority 0 (default), link-only (no compile fn, no scope flag) |
| Element form | `<ng-pluralize>` tagName normalizes via `directiveNormalize` to `ngPluralize` — E-matching confirmed in `src/compiler/directive-collector.ts:111-117` |

### 2.3. Link-time message-table build

1. Read raw (uninterpolated — the `Attributes` constructor stores `attr.value` verbatim) inputs: `attrs.count` (the count expression string), `attrs.when`, `attrs.offset`.
2. `offset = attrs.offset` present ? `parseFloat(attrs.offset)` : `0`. A present-but-non-numeric offset routes `NgPluralizeBadOffsetError` via `$exceptionHandler('$compile')` and the directive renders blank (no watches installed).
3. `whens = scope.$eval(attrs.when)` once at link (upstream behavior — the map is static); non-object result → `{}`.
4. Scan the enumerable keys of `attrs` (enumeration yields only normalized attribute names — `$attr`/`$set`/internals are non-enumerable, `src/compiler/attributes.ts:127-190`) with the upstream rule `/^when(Minus)?(.+)$/`: key = `(minus ? '-' : '') + lowercase(rest)`. So `when-one` → `whenOne` → key `one`; `when-1` → `when1` → key `1`; `when-minus-1` → `whenMinus1` → key `-1`. Per-attribute entries **override** same-key `when`-map entries (functional spec §2.7).
5. For each message: `message.replace(/{}/g, startSym + '(' + countExpr + ')-' + offset + endSym)` using the `$interpolate.startSymbol()` / `endSymbol()` accessors (`src/interpolate/interpolate-types.ts:140-141`), then compile with `$interpolate(rewritten)` once. **Deliberate micro-deviation from upstream:** the count expression is parenthesized before `- offset` is appended (upstream concatenates bare, which mis-parses counts like `a ? b : c`); semantics for all upstream-legal inputs are identical.

### 2.4. Watch wiring (link)

- **Primary watch** on the count expression. Listener: `count = parseFloat(String(newVal))` (so numeric text `"3"` behaves as `3`, per functional spec §2.8).
  - `NaN` → clear text, deregister any active message watch, no report (functional spec §2.8). A NaN→NaN transition is a no-op (upstream's `lastCount` guard).
  - Otherwise resolve the message key: exact match (`String(count)` in the message table) wins; else `$locale.pluralCat(count - offset)`.
  - Key unchanged since last fire → no-op. Key changed → deregister the previous message watch; if the key has a message, install `scope.$watch(messageInterpolateFn, write)`; if not, clear text and route `NgPluralizeNoRuleDefinedError` (carrying the resolved key and the `when` attr source) via `invokeExceptionHandler($exceptionHandler, err, '$compile')` — the ng-repeat in-listener routing precedent (`src/compiler/ng-repeat.ts:462-469`). The report fires once per key transition, not per digest.
- **Message watch** listener writes `element.textContent = value ?? ''` — the `ng-bind-template` write shape (`src/compiler/ng-bind-template.ts:78-103`). Embedded `{{expr}}` bindings inside the active message update through this watch for free.
- No explicit `$destroy` cleanup — watch lifetime is scope lifetime, matching `ng-bind`/`ng-bind-template`; the switching deregistration prevents stale-watch accumulation within a live scope.

### 2.5. Error classes (`src/compiler/compile-error.ts`)

| Class | Thrown when | Routing |
| --- | --- | --- |
| `NgPluralizeNoRuleDefinedError` | valid numeric count resolves to a key with no message | `$exceptionHandler`, cause `'$compile'`, element blanked, page keeps running |
| `NgPluralizeBadOffsetError` | `offset` attribute present but not parseable as a number | `$exceptionHandler`, cause `'$compile'`, at link time, directive inert |

Both follow the `NgRepeat*Error` conventions (`readonly name` const, exported from `src/compiler/index.ts` + root barrel). **`EXCEPTION_HANDLER_CAUSES` stays at 10** — no new cause token; this substitutes for upstream's `$log.debug` (this project has no `$log` service — documented divergence).

### 2.6. Registration & docs

- `src/core/ng-module.ts`: import at the top, rationale comment block + `$compileProvider.directive(NG_PLURALIZE_NAME, ngPluralizeDirective);` inside the existing `.config(['$compileProvider', …])` block (lines 254-455) — byte-for-byte the spec-028 pattern.
- `CLAUDE.md`: extend the compiler-module row + "Where to look when…" table (house convention).
- Roadmap: tick the `ng-pluralize` item in the same commit series.

## 3. Impact and Risk Analysis

- **System dependencies:** consumes `$interpolate` (incl. custom start/end symbols), `$locale`, `$exceptionHandler`, `scope.$watch` / `$eval` — all stable shipped surfaces. Nothing depends on the new directive.
- **`LocaleService` required-field break:** any consumer who typed a custom locale against the published `.d.ts` gets a compile error until they add `pluralCat`. Accepted deliberately (pre-1.0; upstream parity — every AngularJS locale file ships `pluralCat`; an optional field would silently fall back to English rules, a worse failure mode). Mitigation: the interface TSDoc documents the addition and the en-US reference implementation is one line to copy.
- **Attribute normalization of digit segments:** the scan assumes `when-1` → `when1` and `when-minus-1` → `whenMinus1` under `directiveNormalize`. Verify against `src/compiler/directive-normalize.ts` early in implementation (a digit cannot be uppercased — expected to hold); a dedicated unit test pins it.
- **Same-element structural directives:** `ng-pluralize` is not `transclude: 'element'` and not terminal, so it composes with `ng-if`/`ng-repeat` hosts like `ng-class` does — the spec-027 known gap is not widened.
- **Static `when` map:** evaluated once at link (upstream parity). Authors who mutate the map at runtime see no effect — documented in the directive's TSDoc, not an error.
- **Missing-rule report cadence:** keyed to key *transitions*, so a digest-heavy app can't flood the handler; a count oscillating between two uncovered keys reports on each transition (acceptable — it is a development-time signal).

## 4. Testing Strategy

New suite `src/compiler/__tests__/ng-pluralize.test.ts`, using the `ng-bind-template.test.ts` bootstrap pattern (`resetRegistry()` / `createModule('app', ['ng'])` / `createInjector([ngModule, appModule])` / `$compile(el)(scope)` + `scope.$digest()`), mapping 1:1 onto the functional spec's acceptance criteria:

- **Category & exact-match selection** (§2.1): 0/1/3 message-map walk; exact `"1"` beats `"one"`.
- **Placeholder** (§2.2): single and repeated `{}`; offset-adjusted value.
- **Embedded expressions** (§2.3): `{{person1}}` initial render + live update without count change.
- **Offset quintet** (§2.4): counts 0–4 against the canonical "people viewing" table.
- **Locale dispatch** (§2.5): default en-US (1 → one; 0/2/1.5/−1 → other); swapped `$locale` with a custom `pluralCat` via `module.factory('$locale', [() => customLocale])` (precedent: `src/filter/__tests__/locale.test.ts:221-224`).
- **Live updates** (§2.6): variant switch on boundary cross; placeholder refresh within a category — asserting the old message watch is gone (no double-writes).
- **Authoring forms** (§2.7): element vs attribute parity; pure `when-…`-attribute form; attribute-overrides-map; `when-minus-1`; registration smoke `injector.has('ngPluralizeDirective')`.
- **Unusable count** (§2.8): missing / `"abc"` → blank, no handler call; valid→unusable clears text; numeric text `"3"`.
- **Missing rule** (§2.9): blank + handler spy receives `NgPluralizeNoRuleDefinedError` with cause `'$compile'`; page keeps digesting; one report per key transition.
- **Errors:** bad offset routes `NgPluralizeBadOffsetError`; custom interpolation symbols (`$interpolateProvider`) still rewrite `{}` correctly.
- **Filter module:** `defaultLocale.pluralCat` unit cases (1, 0, 2, 1.5, −1, NaN-adjacent) in the existing locale suite; the two updated custom-locale literals keep `pnpm typecheck` green.

Coverage stays under the existing 90% Vitest gate; lint/format/typecheck via the standard CI pipeline.
