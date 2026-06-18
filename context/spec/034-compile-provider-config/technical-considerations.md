<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: `$compileProvider` Configuration Methods

- **Functional Specification:** `context/spec/034-compile-provider-config/functional-spec.md`
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Add six config-phase getter/setter methods to the existing `$CompileProvider` class. Each stores a value on a private `$$` field read at `$get` / compile / link time. The provider's `$get` already builds the `CompileService` via `createCompile({...})` — we widen its options with the new settings and thread each to its single relevant site:

| Method | Stored as | Read at | Effect site |
| --- | --- | --- | --- |
| `aHrefSanitizationTrustedUrlList(re?)` | `$$aHrefSanitizationTrustedUrlList` | URL-attribute write | new compiler-level `sanitizeUri` (href) |
| `imgSrcSanitizationTrustedUrlList(re?)` | `$$imgSrcSanitizationTrustedUrlList` | URL-attribute write | new compiler-level `sanitizeUri` (img/media src) |
| `commentDirectivesEnabled(bool?)` | `$$commentDirectivesEnabled` | directive collection | `directive-collector.ts` comment pass |
| `cssClassDirectivesEnabled(bool?)` | `$$cssClassDirectivesEnabled` | directive collection | `directive-collector.ts` class pass |
| `strictComponentBindingsEnabled(bool?)` | `$$strictComponentBindingsEnabled` | isolate-binding wiring | `isolate-bindings.ts` required-binding check |
| `debugInfoEnabled(bool?)` | `$$debugInfoEnabled` | link | `compile.ts` debug-metadata attach |

Each method follows the AngularJS getter/setter idiom: called with an argument → set + `return this` (chainable); called with none → return current value.

**Notable design decision (URL sanitization is NEW behavior).** Today `$sceDelegate.getTrusted(URL, str)` passes plain URL strings through unchanged (sce-delegate.ts:123-126 — a deliberate simplification). AngularJS additionally runs a **compiler-level** `$$sanitizeUri` that prefixes non-matching URLs with `unsafe:`. This project has no such layer, so spec 034 introduces it (configured by the two list methods) and wires it at the compiler's URL-attribute write path — independent of, and additive to, the `$sce` URL pass-through.

**Affected systems:** `@compiler` (`compile-provider.ts`, `compile.ts`, `directive-collector.ts`, `attributes.ts`, `isolate-bindings.ts`, + a new `sanitize-uri.ts`). No change to `@sce`.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Provider surface — `src/compiler/compile-provider.ts`

| Change | Detail |
| --- | --- |
| Six getter/setter methods | Add the six methods to `$CompileProvider`, each backed by a `$$` field initialized to its default. Setter validates type (RegExp for the URL lists, boolean for the toggles) and returns `this`; getter returns the field. Config-phase only (the provider is only reachable in `config`). |
| Thread into `$get` | The `$get` array's factory passes the current field values into `createCompile({ … })` via new `CompileOptions` fields. Because `$get` runs once after config, the values are frozen at run-phase start (AngularJS parity — these are config-time settings). |

### 2.2 URL sanitization — new `src/compiler/sanitize-uri.ts` + `src/compiler/attributes.ts`

| Change | Detail |
| --- | --- |
| `sanitizeUri(uri, isMediaUrl, pattern)` helper | Returns the URI unchanged when it matches `pattern`, else returns it prefixed with `unsafe:` (AngularJS parity). Pure function, unit-testable in isolation. |
| Wire at the URL-attribute write path | The attribute-interpolation write site (spec 031, `attributes.ts`) and the `ng-href`/`ng-src`/`ng-srcset` aliases (spec 025) route `a/area[href]` through the href pattern and `img[src]` (+ media) through the img pattern before writing the DOM attribute. |
| Defaults | Default both patterns to the **AngularJS-standard** safe-URL regex (allows `http(s)`, `ftp`, `mailto`, `tel`, `file`, and relative URLs; neutralizes `javascript:` and dangerous `data:`). **This is a behavior change** — see Risk Analysis — chosen for true parity + a security improvement over today's pass-through. |

### 2.3 Comment / class directive toggles — `src/compiler/directive-collector.ts`

| Change | Detail |
| --- | --- |
| Gate the two passes | `collectDirectives` skips the `collectCommentDirectives` call when `commentDirectivesEnabled === false`, and skips `collectClassDirectives` when `cssClassDirectivesEnabled === false`. The flags arrive via the `CompileOptions` already threaded to the collector. Defaults `true` (today's behavior). |
| Perf note | When disabled, the corresponding scan is skipped entirely — matching AngularJS's perf/attack-surface rationale. |

### 2.4 Strict component bindings — `src/compiler/isolate-bindings.ts`

| Change | Detail |
| --- | --- |
| Required-binding check | When `strictComponentBindingsEnabled === true`, `wireIsolateBindings` reports a clear error (new `MissingComponentBindingError` in `compile-error.ts`, routed via `'$compile'`) if a non-optional binding (`<`, `=`, `@`, `&` without the `?` modifier) has no corresponding attribute on the element. Default `false` → today's lenient behavior (missing attribute leaves the local undefined / one-way degrade). |

### 2.5 Debug info — `src/compiler/compile.ts` (+ `cleanup.ts` helpers)

| Change | Detail |
| --- | --- |
| Attach debug metadata when enabled | When `debugInfoEnabled === true` (default), the per-element linker adds the AngularJS marker classes: `ng-scope` on elements that get a new (non-isolate) scope, `ng-isolate-scope` on isolate-scope elements, and `ng-binding` on elements carrying an interpolation / `ng-bind` binding. Scope retrieval is already available via the existing `getElementScope` (`$$ngScope`); document it as the inspection hook. |
| Disabled → clean output | When `false`, none of the marker classes are added — production DOM stays clean and slightly lighter. No scope data is attached beyond the existing non-enumerable `$$ngScope` (which is internal, not part of the debug surface). |

### 2.6 Logic / contracts (shared)

- **Config-phase only**, frozen at `$get`. No runtime mutation path (AngularJS parity).
- **One new error class** (`MissingComponentBindingError`), routed via the existing `'$compile'` cause. `EXCEPTION_HANDLER_CAUSES` stays at 10.
- **Defaults preserve today's behavior for the toggles** (`commentDirectivesEnabled`/`cssClassDirectivesEnabled` true, `strictComponentBindingsEnabled` false, `debugInfoEnabled` true). The **URL-list defaults are the one deliberate behavior change** (see below).

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `compile-provider.ts`, `compile.ts`, `directive-collector.ts`, `attributes.ts`, `isolate-bindings.ts`, new `sanitize-uri.ts`, `compile-error.ts`. Interacts with spec 025 (`ng-href`/`ng-src`) and spec 031 (interpolated `href`/`src`).
- **Potential Risks & Mitigations:**
  - **URL-sanitization default is a behavior change (DECIDED).** Defaulting to the AngularJS safe-URL pattern means a `javascript:`/unsafe-`data:` URL written to `href`/`src` now gets an `unsafe:` prefix where today it passes through. **Decision: ship the AngularJS-standard pattern as the default** (true parity + security improvement). *Mitigation:* document it prominently in the changelog/README; the config method relaxes it for apps that need to; add explicit tests that the default neutralizes `javascript:` and a regression note so the behavior change is intentional and visible.
  - **`debugInfoEnabled` adds new classes by default** — could surprise tests asserting exact `class` attributes. *Mitigation:* marker classes match AngularJS names; audit existing compiler tests for class assertions; they append (never replace) consumer classes.
  - **`strictComponentBindingsEnabled` is off by default** — no impact unless opted in; when on, surfaces previously-silent missing bindings. *Mitigation:* covered by tests both on and off.
  - **Settings frozen at `$get`** — a config block mutating after `$get` has no effect. *Mitigation:* documented; matches AngularJS.
  - **Scope/size:** six methods across five sites — slice the implementation (URL lists, comment/class toggles, strict bindings, debug info) so each lands runnable.

---

## 4. Testing Strategy

- **Framework:** Vitest + jsdom; maintain 90%+ coverage on `compiler`.
- **Reference parity:** AngularJS `compileSpec.js` (`$compileProvider` config sections) + `$$sanitizeUri` vectors.
- **Coverage mapped to acceptance criteria:**
  - **URL lists:** custom pattern changes which `href`/`src` URLs survive vs. get `unsafe:`-prefixed; matching URL unchanged; getter returns current; default neutralizes `javascript:`/dangerous `data:`; `sanitize-uri.ts` unit tests in isolation.
  - **Comment/class toggles:** disabling stops comment-form / class-form directives from matching (assert a directive that only matches via comment/class no longer fires); enabling (default) keeps them; getters return current.
  - **Strict bindings:** with it on, a component missing a required (non-`?`) binding routes `MissingComponentBindingError` via `'$compile'`; optional bindings don't error; off (default) tolerates; getter returns current.
  - **Debug info:** enabled (default) adds `ng-scope`/`ng-isolate-scope`/`ng-binding` marker classes appropriately + `getElementScope` retrieves the scope; disabled adds none; getter returns current.
  - **No-regression:** full prior-spec suite green; chainable getter/setter calls in a `config` block compose; `EXCEPTION_HANDLER_CAUSES.length === 10`.
