<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: Template Interpolation in the Compiler (Text & Attribute Bindings)

- **Functional Specification:** `context/spec/031-template-interpolation/functional-spec.md`
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

AngularJS implements `{{ }}` via two synthetic directives the compiler injects automatically: `addTextInterpolateDirective` (text nodes) and `addAttrInterpolateDirective` (attribute values). We mirror that, but adapted to this codebase's existing seams rather than adding synthetic directives:

1. **Text nodes** — stop skipping `Text` nodes in the walker. Add a `compileTextNode` branch that, when the node's text contains `{{ }}`, returns a linker installing one `scope.$watch(interpolateFn, …)` that writes the rendered string to the node's `textContent`.
2. **Attribute values** — extend the already-existing-but-lazy attribute-interpolation machinery so it runs **eagerly at link time for every attribute** (in `bindAttrsToScope`), installing the interpolation `$watch` that writes the resolved value to the real DOM attribute (`$set(name, value, true)`), and routing security-sensitive `href`/`src` through `$interpolate`'s existing trusted-context support.

Both reuse the `interpolate` collaborator already threaded through the walker and the `Attributes` instance — no new DI dependency on `$compile`, no new exception-handler cause token. Custom delimiters and null/undefined-as-empty are inherited from `$interpolate` for free.

**Affected systems:** `@compiler` only (the walker + `Attributes`). `@interpolate`, `@sce`, `@core` are consumed unchanged.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Text-node interpolation — `src/compiler/compile.ts` (+ new `src/compiler/text-interpolate.ts`)

| Change | Detail |
| --- | --- |
| Un-skip text nodes | `compileNode` (`compile.ts:810`) gains a `isText(node)` branch → `compileTextNode(node, …)`; falls through to `noopLinker` only for other node types (e.g. processing instructions). |
| Child enumeration | The four child-collection loops that filter to `isElement(child) || isComment(child)` (`compile.ts:1227, 1259, 1749`) and the clone parallel-walk (`compile.ts:1983`) widen to also include `Text` nodes so text bindings compile and clone-relink. |
| New `compileTextNode` | Calls `interpolate(node.textContent ?? '', true)`. `undefined` → static text → `noopLinker` (zero cost, no watch). `InterpolateFn` → returns a `NodeLinker` that, against the link-time scope (resolved through the existing `cloneMap` indirection), installs `scope.$watch(interpolateFn, (v) => { textNode.textContent = typeof v === 'string' ? v : ''; })`. |
| New file | `src/compiler/text-interpolate.ts` holds the `compileTextNode` factory + an `isText` guard (kept out of the already-oversized `compile.ts`; imported by it). `isText` joins the guards in `node-guards.ts`. |
| Cleanup | No element-cleanup-queue entry needed — the watch lives on the linked scope and is torn down by normal `scope.$destroy()` propagation. Transcluded clones get an independent watch per clone via the cloneMap walk, torn down with the clone's transclusion scope. |

### 2.2 Attribute interpolation — `src/compiler/attributes.ts`

| Change | Detail |
| --- | --- |
| Eager classification | `bindAttrsToScope` (called at link time, `compile.ts:1519/1872`, **before** directive pre-link) gains a pass over the element's own normalized attributes: for each, call `interpolate(value, true, ctx?)`. Static → cache `null`. Dynamic → cache the `InterpolateFn` **and** install exactly one `scope.$watch(interpolateFn, (v) => attrs.$set(name, v ?? null, true))`. |
| DOM ownership change | The interpolation watch now writes the real DOM attribute (`writeAttr: true`), replacing the current lazy `$observe` install that used `writeAttr: false`. This is what makes `<div title="{{x}}">` update the live attribute. |
| `$observe` reuse | The lazy classification block in `$observe` (`attributes.ts:435-458`) no longer installs its own watch when the shared `$$interpolators` cache already holds an `InterpolateFn` (populated by the eager pass) — guaranteeing **one** watch per attribute. Observers still fire via the existing `$set` → `$$observers` iteration. |
| Security routing (§2.3) | A small static map resolves a trusted context per `(tagName, attrName)`: `a/area[href] → URL`, `img[src] → URL` (project has no `MEDIA_URL`). When present, pass it as the 3rd arg to `interpolate(value, true, ctx)`, so `$interpolate`'s already-wired SCE callbacks enforce/route trust. Other attributes get no context (plain text). |

### 2.3 Logic / contracts (shared)

- **Empty / non-string values** → `''`, via `$interpolate`'s `toInterpolationString`; no extra coercion.
- **Custom delimiters** → honored by `$interpolate` (configured start/end symbols); the compiler passes raw text through unchanged.
- **First-render flash** → accepted (parity); `ng-cloak`/`ng-bind`/`ng-href`/`ng-src` remain the flash-free options.
- **No new error cause** — per-expression throws already route through `$interpolate`'s handler as `'$interpolate'` / `'$filter'`; `$set` observer-notification throws route as `'$compile'`. `EXCEPTION_HANDLER_CAUSES` stays at 10.
- **Public surface unchanged** — `$compile`'s `Linker` signature, `Attributes`, and `$compileProvider` are untouched; this is purely additive walker/link behavior.

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `@interpolate` (already a collaborator), `@sce` (indirectly via `$interpolate`'s wired callbacks), `@core` `$watch`/`$destroy`, `Attributes.$set`/`$observe`.
- **Potential Risks & Mitigations:**
  - **Transclusion clone re-linking of text nodes** — text bindings must clone per `$transclude(...)` call. *Mitigation:* widen the cloneMap parallel-walk filter consistently with the child-enumeration loops; add explicit `ng-repeat`/`ng-if` + `{{ }}` tests.
  - **Double-watch on attributes** (eager + lazy `$observe`) — *Mitigation:* shared `$$interpolators` cache is the single source of truth; `$observe` reuses, never re-installs.
  - **Behavioral change to existing `$observe` consumers** (write now `true`) — *Mitigation:* `ng-href`/`ng-src` observe the `ng-*` normalized name (not the real `href`/`src`), so no DOM-write conflict on the real attribute; existing spec-025 parity tests guard this.
  - **Strict-trust single-binding rule** — interpolated URL attributes with surrounding literal text (`href="/u/{{id}}"`) are subject to `$interpolate`'s existing "exactly one expression, no surrounding text in trusted context" rule when SCE strict mode is on. **Documented as a known limitation** (matches the spec-012 contract); plain (non-URL) attributes are unaffected.
  - **`compile.ts` size** — already ~2000 lines (a flagged refactor candidate). *Mitigation:* new logic lives in `text-interpolate.ts` / `attributes.ts`, not piled onto `compile.ts`.

---

## 4. Testing Strategy

- **Framework:** Vitest + jsdom; 90%+ coverage on `compiler`.
- **Reference parity:** port relevant vectors from AngularJS `compileSpec.js` (text/attr interpolation) and `interpolateSpec.js`.
- **Unit/integration coverage mapped to acceptance criteria:**
  - **Text:** single/multiple expressions, literal preservation, static-text no-watch, non-string coercion, undefined/null → empty, whitespace preservation, live update on digest.
  - **Attributes:** arbitrary attribute names, mixed literal+expression, multiple expressions, static no-watch, `$observe` notified with computed value + on change (one watch only), undefined/null → empty.
  - **Security:** interpolated `a[href]`/`img[src]` route through trusted context; safe URL renders; (limitation) surrounding-text URL under strict mode.
  - **Delimiters:** custom start/end honored for text + attributes.
  - **Errors:** throwing expression reported via handler, rest of template keeps rendering.
  - **Transclusion:** `{{ }}` inside `ng-if` / `ng-repeat` clones binds per clone and tears down with the clone.
