# Technical Specification: CSP, Template-Cache & Element-Override Directives

- **Functional Specification:** [functional-spec.md](./functional-spec.md)
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Five small built-in directives land in `src/compiler/`, registered DI-only on `ngModule` (the spec 023–029 precedent: file-local factories, `injector.get('<name>Directive')` reachable, NOT exported from `@compiler/index`):

1. **`script`** — E-restricted, `terminal: true`, compile-phase `$templateCache.put(attrs.id, element.textContent)` when `type === 'text/ng-template'`. No new resolution wiring is needed: `$templateRequest` already checks `$templateCache` before fetching (`src/template/template-request.ts:161-166`), so `ng-include` and `templateUrl` consumers resolve inline names with zero network for free.
2. **`ngRef`** — A-restricted, link-time publish of a controller (from the `$$ngControllers` element stash) or the element itself onto the scope via an assignable-expression writer, cleared on `$destroy`.
3. **`a`** — E-restricted anchor override: click-time empty-href guard + live `noopener noreferrer` hardening for `target="_blank"`.
4. **`ngCsp`** / **`ngJq`** — A-restricted metadata-only no-op DDOs (the `ngNonBindable` "pure metadata" precedent), registered so they are testable, documented in code, and decorator-swappable.

One shared refactor: the assignable-expression write machinery currently module-private in `src/compiler/isolate-bindings.ts` (`isAssignable` / `ensurePath` / `writeAssignable` / `buildParentWriter`) is **extracted** into a new compiler-internal module so `ngRef` and the `=` binding share one source of truth.

The compiler walker needs **no changes**: E-restrict matching already derives candidate names from `element.tagName.toLowerCase()` (`directive-collector.ts:112`), and both `'script'` and `'a'` pass registration-name validation. Inline template content is safe by construction — `<script>` content is raw text per HTML parsing and this compiler has no text-node `{{}}` interpolation — so `terminal: true` on `script` is upstream parity + same-element cutoff, not a content-safety requirement.

`EXCEPTION_HANDLER_CAUSES` stays at 10 — all new error sites reuse `'$compile'` (and `'eventListener'` is not needed: the anchor guard calls no `$apply`).

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 New files & responsibilities

| File | Responsibility |
| --- | --- |
| `src/compiler/script-template.ts` | `script` directive factory (`['$templateCache', factory]`), name constant |
| `src/compiler/ng-ref.ts` | `ngRef` directive factory (`['$exceptionHandler', factory]`), name constant |
| `src/compiler/html-anchor.ts` | `a` directive factory (no deps), name constant |
| `src/compiler/ng-compat-switches.ts` | `ngCsp` + `ngJq` no-op DDO factories, name constants |
| `src/compiler/expression-assign.ts` | Extracted assignable-write helpers (compiler-internal; NOT exported from `@compiler/index`) |

Registration: five `$compileProvider.directive(NAME, factory)` calls added to the existing `ngModule` config block (`src/core/ng-module.ts:255-475`).

### 2.2 `script` — inline template registration

- DDO: `restrict: 'E'`, `terminal: true` (upstream parity; cuts off other same-element directives, matching classic AngularJS), default priority 0, `compile(element, attrs)` only — no link.
- Compile body: `if (attrs.type === 'text/ng-template' && attrs.id) cache.put(attrs.id, element.textContent ?? '')`. Missing `id` → silent no-op (FS §2.1). Last-wins replacement is inherited from `$templateCache.put` Map semantics.
- The element is left in the DOM untouched (scripts render nothing; non-`ng-template` types are completely ignored, and the walker never executed script content anyway).
- SCE note: an inline name like `'hello.html'` used as an `ng-include` src passes the default `['self']` resource-URL safelist (relative names resolve same-origin against the document base — `resource-url-matcher.ts:124-171`), so no `$sce` changes are needed.

### 2.3 `ngRef` / `ngRefRead`

- DDO: `restrict: 'A'`, default priority, post-link only (controllers are stashed in `$$ngControllers` before pre-link, so post-link reliably sees them).
- **Expression validation (link time):** `parse(attrs.ngRef)`, then assignability check via the extracted `isAssignable` (Identifier | MemberExpression). Empty or non-assignable → route new `NgRefBadExpressionError` via `invokeExceptionHandler(…, '$compile')`, directive goes inert (the ng-pluralize bad-offset model). Covers the FS `ng-ref="123bad"` criterion.
- **Value selection:**
  - `ngRefRead === '$element'` → publish the native `Element` (raw-Element convention, spec 017).
  - `ngRefRead === '<directiveName>'` → `$$ngControllers.get(directiveNormalize(readName))`; a miss routes new `NgRefNoControllerError` via `'$compile'`, nothing published.
  - No `ngRefRead` → default read keyed on the element's normalized tag name (upstream parity: `<my-player ng-ref="player">` reads the `myPlayer` controller); no such controller → publish the element itself (FS §2.2 "no component controller" case).
- **Publish/clear:** write via the extracted writer (auto-creating dotted paths via `ensurePath`, same semantics as `=`). On `scope.$on('$destroy')`, clear to `null` **only if the current scope value is still the published reference** (guards against clobbering a newer publish — upstream parity). ng-if's eager clone-scope destroy (`ng-if.ts:269-273`) makes clear-on-removal deterministic; re-publish on re-link covers the toggle-true-again criterion.

### 2.4 `a` — anchor override

- DDO: `restrict: 'E'`, priority 0, non-terminal (composes with `ngClick` / `ngHref` under accumulate-per-name registration).
- **Empty-link guard:** link-time `element.addEventListener('click', handler)` + `scope.$on('$destroy', removeEventListener)` (the `ng-event-directives.ts:225-228` pattern). The handler reads `element.getAttribute('href')` **at click time** — null or `''` → `event.preventDefault()`. Click-time read makes the check live (sees `ngHref`-written values) with zero watches. No `$apply`, no scope mutation, no exception-handler wrapping needed.
- **New-tab hardening:** immediate link-time check (covers static `target="_blank"` without waiting for a digest) **plus** `attrs.$observe('target', …)` for interpolated/late-set targets. When the observed value is `'_blank'`, token-merge `noopener` + `noreferrer` into the existing `rel` attribute (preserving author tokens, e.g. `license`). Idempotent and one-way: hardening is never removed if `target` later changes (FS only requires "added to"). Write via `attrs.$set('rel', merged)`.

### 2.5 `ngCsp` / `ngJq` — no-ops

- Two A-restricted DDOs with no compile/link — pure registration artifacts. All classic value forms (`ng-csp="no-unsafe-eval"`, `ng-jq="jQuery"`, bare attributes) are inert by construction since the DDO does nothing with the attribute value.
- Rationale documented in the factories' TSDoc + compiler README: expression evaluation is a tree-walking interpreter (never `eval`), no inline style injection, no jQuery layer (Phase 5).

### 2.6 `expression-assign.ts` extraction

- Move `isAssignable`, `ensurePath`, `writeAssignable`, `buildParentWriter` (≈80 lines) out of `isolate-bindings.ts`; `isolate-bindings.ts` re-imports them. Pure move — no behavior change to `=` bindings; the existing isolate-binding test suite pins the semantics (including non-assignable silent degrade).
- The module stays compiler-internal (not exported from `@compiler/index` or the root barrel) — the parser's public surface is unchanged.

### 2.7 New error classes

| Class | Site | Routing |
| --- | --- | --- |
| `NgRefBadExpressionError` | link time, empty/non-assignable `ng-ref` value | `$exceptionHandler('$compile')`, directive inert |
| `NgRefNoControllerError` | link time, `ng-ref-read` names a directive with no controller on the element | `$exceptionHandler('$compile')`, nothing published |

Both live in `src/compiler/compile-error.ts` (existing `Ng<Directive><Problem>Error` naming), exported from `@compiler/index` and the root barrel. No new cause token.

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `$templateCache` (already on `ngModule` — `ng-module.ts:194`), `$templateRequest`'s cache-first contract, the `$$ngControllers` stash population in `compile.ts` (write sites at `compile.ts:594` / `compile.ts:693`), `attrs.$observe` / `attrs.$set` (`attributes.ts`), `parse()`'s internal `$$ast` handle, ng-if's eager clone-scope destroy.
- **Risk: `=`-binding regression from the helper extraction.** Mitigation: pure code move, zero signature changes; the isolate-binding suite (including non-assignable degrade and `ensurePath` auto-create) runs unchanged.
- **Risk: the `a` / `script` directives now match every anchor/script in compiled markup.** Per-element cost is one link-fn invocation and (for `a`) one click listener; `$observe('target')` is lazy so static anchors install at most one watch only when target is interpolated. Author-registered `a`/`script` directives accumulate rather than conflict.
- **Risk: `terminal: true` on `script` drops other same-element directives.** Accepted — exact upstream behavior; directives on a `text/ng-template` block are meaningless anyway.
- **Risk: `attrs.$set('rel', …)` interplay with author code that also writes `rel`.** The merge is recomputed on every observer fire from the current attribute value, so author tokens written before hardening are preserved; hardening tokens written after author overwrites are restored on the next target observation only — documented as a non-goal beyond the FS criteria.
- **Known-gap note:** none of the five is structural (`transclude: 'element'`), so the spec-027 terminal-cutoff gap is not implicated; `<a ng-if="…">` compositions are safe.

---

## 4. Testing Strategy

- **Framework/setup:** Vitest + jsdom, copying the canonical bootstrap from `src/compiler/__tests__/ng-pluralize.test.ts:89-114` (hand-built minimal `'ng'` module with `$exceptionHandler` spy, `createTemplateCache()`-backed `$templateCache`, no mock fetcher needed for inline-template tests).
- **`script`:** cache population assertions via `injector.get('$templateCache').get(id)`; end-to-end `ng-include` resolution of an inline name with a fetcher spy asserting **zero** network calls; no-id silence; non-ng-template types untouched; last-wins replacement; `{{…}}` content registered verbatim (not interpolated in place).
- **`ngRef`:** component controller publish + sibling `ng-click` invocation; element publish on controller-less elements; `$element` forced read; two-controller disambiguation; ng-if clear/re-publish cycle; bad-expression and no-controller error routing through the `$exceptionHandler` spy (page keeps working).
- **`a`:** `event.defaultPrevented` assertions for empty/missing href (jsdom doesn't navigate — assert on the event, not navigation); live transition once `ngHref` writes a real URL; real-href anchors untouched; rel token-merge cases (bare, with `rel="license"`, no-`_blank` untouched, interpolated `target`).
- **`ngCsp`/`ngJq`:** identical-render assertions for all five classic value forms, zero handler-spy calls.
- **Regression:** the existing isolate-bindings suite gates the extraction; coverage holds the 90% line bar.
- **Docs slice:** compiler README + CLAUDE.md updates per the established spec-NNN docs-slice habit.
