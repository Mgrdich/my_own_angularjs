# Technical Specification: Attribute Helper Directives

- **Functional Specification:** [`./functional-spec.md`](./functional-spec.md)
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Eight directives, two mechanical patterns, **one new source file**. No new framework primitives — every consumer dependency already exists from spec 017 (`attrs.$observe`, `attrs.$set`, `scope.$watch`). Same "DI registration on `ngModule`, no public exports" precedent as specs 018, 023, 024.

The work splits into three pieces:

1. **One new file `src/compiler/ng-attribute-aliases.ts`** — two internal factory-helper functions (`createUrlAliasDirective`, `createBooleanAliasDirective`) plus the 8 generated directive factories (`ngHrefDirective`, `ngSrcDirective`, `ngSrcsetDirective`, `ngDisabledDirective`, `ngCheckedDirective`, `ngReadonlyDirective`, `ngSelectedDirective`, `ngOpenDirective`).
2. **One block update in `src/core/ng-module.ts`** — 8 new `$compileProvider.directive(...)` lines.
3. **Two new test files plus one parity file.** Per-directive tests would be 8 near-identical copies of the same test plan; parametrized per-pattern files via `describe.each` is more idiomatic for this batch.

No new error classes. No new `EXCEPTION_HANDLER_CAUSES` token — every error site flows through the existing `'watchListener'` cause from `$watch` / `$observe`. The tuple stays at 10.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 `src/compiler/ng-attribute-aliases.ts` — two factory helpers + 8 directives

**Helper 1 — URL/value alias factory:**

```ts
function createUrlAliasDirective(domAttrName: 'href' | 'src' | 'srcset'): DirectiveFactoryReturn
```

Returns the directive factory `[() => ({ restrict: 'A', priority: 99, link })]`. The link fn:

- Reads the normalized ng-attribute name (`ngHref` / `ngSrc` / `ngSrcset`) — the directive's own attribute already carries the `{{ }}` interpolation, parsed by the existing `attrs.$observe` machinery.
- Calls `attrs.$observe(ngAttrName, (value: string | undefined) => attrs.$set(domAttrName, value ?? ''))`.
- The `value ?? ''` collapses null/undefined to empty string; `attrs.$set` then calls `removeAttribute(domAttrName)` (because empty string is falsy per spec 017's `$set` logic at `attributes.ts:285-307`).
- A truthy string value triggers `setAttribute(domAttrName, value)`.

Three generated factories:

```ts
export const ngHrefDirective = createUrlAliasDirective('href');
export const ngSrcDirective = createUrlAliasDirective('src');
export const ngSrcsetDirective = createUrlAliasDirective('srcset');
```

**Helper 2 — Boolean alias factory:**

```ts
function createBooleanAliasDirective(propName: 'disabled' | 'checked' | 'readonly' | 'selected' | 'open'): DirectiveFactoryReturn
```

Returns `[() => ({ restrict: 'A', priority: 100, link })]`. Priority 100 matches AngularJS-canonical (slightly higher than the URL aliases at 99). The link fn:

- Defensive `typeof attrs[ngAttrName] !== 'string'` early-return per the spec 023/024 pattern.
- Calls `scope.$watch(attrs[ngAttrName], value => attrs.$set(propName, !!value))`.
- `!!value` coerces to a strict boolean: truthy → `setAttribute(propName, true)` (which the browser serializes as `propName="true"` — AngularJS-canonical, behaviorally identical to bare-presence `propName` or `propName=""`); falsy → `removeAttribute(propName)`.

Five generated factories:

```ts
export const ngDisabledDirective = createBooleanAliasDirective('disabled');
export const ngCheckedDirective = createBooleanAliasDirective('checked');
export const ngReadonlyDirective = createBooleanAliasDirective('readonly');
export const ngSelectedDirective = createBooleanAliasDirective('selected');
export const ngOpenDirective = createBooleanAliasDirective('open');
```

File size target: under 200 LOC. Full TSDoc on each exported factory + the two helpers, with `@example` for each pattern.

### 2.2 `src/core/ng-module.ts` — 8 new registration lines

Extend the existing `$compileProvider` config block. One new import statement (pulling all 8 factories from `@compiler/ng-attribute-aliases`) and 8 new lines:

```ts
$compileProvider.directive('ngHref', ngHrefDirective);
$compileProvider.directive('ngSrc', ngSrcDirective);
// … 6 more
```

The 8 directive registrations are alphabetized within the existing block, matching the spec 023/024 ordering convention.

### 2.3 Pre-compile attribute absence — falls out for free

The functional spec's "real `href` attribute is absent before the first digest" requirement is automatic: the consumer writes `<a ng-href="{{url}}">` (no `href` attribute). The compiler reaches the element, the link fn calls `attrs.$observe('ngHref', listener)`, the interpolation framework wires a `scope.$watch` on the interpolated value. The actual `href` is only set when the listener fires (during the first digest). No explicit pre-compile work is needed — the framework's normal compile-then-digest ordering provides the guarantee.

The browser sees `<a ng-href="{{url}}">` without any `href` — a click before the digest goes nowhere (no navigation) instead of to the literal URL `"{{url}}"`. This is the AngularJS-canonical mechanism.

### 2.4 Module-boundary considerations

`ng-attribute-aliases.ts` lives in `@compiler`. The factory helpers (`createUrlAliasDirective`, `createBooleanAliasDirective`) are module-private — not exported from `@compiler/index` or the root barrel. The 8 directive factories are exported from `ng-attribute-aliases.ts` but NOT re-exported from `@compiler/index` (same DI-registration-only precedent as specs 018, 023, 024).

### 2.5 Error handling

- The factory helpers are total — neither throws.
- `attrs.$observe` listener throws (URL-alias path) bubble through the existing digest path (technically the `$evalAsync` cause for static-attribute first-fires, the `'watchListener'` cause for interpolation-driven follow-ups — both already documented).
- `scope.$watch` listener throws (boolean-alias path) bubble through the existing `'watchListener'` cause.
- No new error classes, no new `EXCEPTION_HANDLER_CAUSES` token. The tuple stays at 10.

### 2.6 Documentation

`src/compiler/README.md` gains a new section **"Attribute helper built-ins (spec 025)"** covering:

- One paragraph per pattern (URL/value vs boolean), with the list of directives in each.
- The "browser pre-compile bug" callout — why these directives exist (literal `{{ }}` navigation, literal `disabled="false"` semantics).
- The shared factory pattern — `createUrlAliasDirective` + `createBooleanAliasDirective` parameterize the pattern by attribute name.
- A cross-reference to spec 017's `attrs.$observe` / `attrs.$set` mechanisms.

`CLAUDE.md` "Modules" table — `./compiler` row extended to mention the 8 new directives. One new "Non-obvious invariants" bullet (the priority-99/100 ordering and the "pre-compile attribute absent" guarantee that falls out of the compile-then-digest ordering). 8 new "Where to look when…" rows (one per directive, all pointing at `ng-attribute-aliases.ts`).

`context/product/roadmap.md` — the "Attribute helpers" sub-bullet flips from `[ ]` to `[x]` at `/awos:verify`. Already annotated with `_(spec 025 — drafted.)_`.

---

## 3. Impact and Risk Analysis

### System Dependencies

- **`@compiler/attributes`** — consumes `attrs.$observe` and `attrs.$set` (spec 017). No changes needed.
- **`@core/scope`** — consumes `scope.$watch` (spec 002). No changes needed.
- **`@compiler`** — additive: 1 new file, 1 modified registration block. The compiler walker, terminal hook, isolate-binding wiring, and all other established infrastructure are unchanged.
- **No other `@`-modules touched.**

### Potential Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `attrs.$set('disabled', true)` writes the cosmetically-ugly `disabled="true"` rather than bare-presence `disabled` or `disabled=""`. | Cosmetic only — behaviorally identical from the browser's perspective. AngularJS-canonical. Tests verify via `element.hasAttribute(name)` or the DOM property (`element.disabled === true`), NOT the attribute's raw value string. |
| Empty-string `ng-href="{{url}}"` with `url === ''` should remove the `href` attribute entirely, not set it to `""`. | Falls out of `attrs.$set`'s falsy-handling logic at `attributes.ts:285` — empty string is falsy, triggers `removeAttribute`. Test pinned. |
| `ng-href` collides with an existing `href` attribute on the same element. | The directive only reads / writes the `href` attribute via `$set` after its `$observe` listener fires. A consumer-shipped literal `href="…"` is overwritten on the first digest. AngularJS-canonical — `ng-href` wins. Documented in TSDoc + tested. |
| Priority 99 (URL aliases) and 100 (boolean aliases) interact with other directives' priorities. | Both are well above the default 0; lower than 1000 (`ng-non-bindable`). No known conflict with spec 017–024 directives. Documented in the new CLAUDE.md invariant bullet. |
| URL allowlist (`aHrefSanitizationTrustedUrlList`) is missing — `ng-href="{{javascript:alert(1)}}"` would set a dangerous URL. | Explicitly out of scope per the functional spec's §3. The URL-allowlist infrastructure is a separate spec; this spec just sets the URL the consumer asks for. AngularJS-canonical layering. |

---

## 4. Testing Strategy

**Framework:** Vitest + jsdom (existing setup). Tests under `src/compiler/__tests__/`.

**Per-pattern parametrized test files** (instead of 8 per-directive files — the directives within each pattern are literal clones, so parametrization via `describe.each` avoids duplication):

- **`src/compiler/__tests__/ng-url-aliases.test.ts`** — covers `ng-href`, `ng-src`, `ng-srcset` via `describe.each([['ngHref','href'], ['ngSrc','src'], ['ngSrcset','srcset']])`. Tests:
  - Real attribute absent before the first digest, present after.
  - Updates when the interpolated value changes.
  - Empty-string interpolated value → real attribute removed.
  - `injector.has('<name>Directive')` registration sanity check per directive.

- **`src/compiler/__tests__/ng-boolean-aliases.test.ts`** — covers `ng-disabled`, `ng-checked`, `ng-readonly`, `ng-selected`, `ng-open` via `describe.each` for the five `[ngName, propName]` pairs. Tests:
  - Attribute added when expression truthy.
  - Attribute removed when expression falsy.
  - Transition on every truthiness flip across digests.
  - DOM property kept in sync by the browser (`element.disabled === true` etc.) — automatic, but a quick sanity check confirms it.
  - `injector.has('<name>Directive')` per directive.

- **`src/compiler/__tests__/spec025-parity.test.ts`** — focused AngularJS-canonical regression file matching the spec 022/023/024 precedent. 8 tests (one per directive) plus the literal `expect(EXCEPTION_HANDLER_CAUSES.length).toBe(10)` regression guard. No deferred `it.skip` cases — these directives have no animation surface.

- **Regression** — full specs 002–024 suite passes unchanged.
