# Functional Specification: `$sanitize` — HTML Sanitization Service

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > HTML Sanitization (`$sanitize` / `ngSanitize`)
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 012 delivered `$sce` — the trust *gate* that asks "did a trusted code path mark this value as safe for this context?". For HTML payloads, the gate has only two answers today: the string is wrapped in a `TrustedHtml` (developer accepts responsibility) or it throws. There is no third path, no way to take an untrusted-but-likely-fine HTML string from a server response or user input and turn it into something the app can safely render.

**That third path is `$sanitize`.** It's the *scrubber* that complements the gate. Given an untrusted HTML string, `$sanitize` parses it, drops every tag, attribute, and URL protocol that isn't on a fixed allow-list, escapes the surviving text content, and returns a sanitized string. The classic `ng-bind-html` directive uses both: if the value is already wrapped, `$sce` unwraps; otherwise `$sanitize` cleans, then renders. The two services compose into a defense-in-depth pipeline:

```
untrusted string → $sce.getTrustedHtml → (wrapper? unwrap : $sanitize?) → element.innerHTML
```

This spec ships `$sanitize` as a **separate `ngSanitize` module** — not part of the core `ng` registration, exactly mirroring AngularJS 1.x's `angular-sanitize.js` packaging. Apps that don't render untrusted HTML never load the parser tables or pay for the attack surface. Apps that do, opt in via a single dependency on `'ngSanitize'`.

The `$sce.getTrustedHtml` fallback hook is wired automatically — if `ngSanitize` is registered when `$sce` is constructed, plain-string HTML routes through `$sanitize` instead of throwing. This matches AngularJS parity exactly. The hook uses a lazy `$injector.has('$sanitize')` lookup so `$sce` retains zero hard dependencies on `ngSanitize`.

**Success criteria:**

- `$sanitize(untrustedHtml)` parses, scrubs, and returns a safe HTML string. Dangerous tags (`<script>`, `<iframe>`, etc.), inline event handlers (`onerror=`, `onclick=`, …), and dangerous URL protocols (`javascript:`, certain `data:`) are dropped.
- `$sce.getTrustedHtml(plainString)` automatically delegates to `$sanitize` when the `ngSanitize` module is loaded.
- A dedicated mXSS-regression suite covers each historical `ngSanitize` CVE with reproduction-and-fix test vectors.
- `ngSanitize` ships as an opt-in subpath (`./sanitize`) — apps that don't import it pay no runtime cost.
- All existing tests (specs 003, 007, 008, 009, 010, 011, 012) continue to pass; `$sce` behavior is additive (the fallback only triggers when `$sanitize` is registered).

---

## 2. Functional Requirements (The "What")

### 2.1. Module Registration & Lifecycle

- `ngSanitize` is a stand-alone module — NOT registered on the core `ng` module. Apps opt in by listing `'ngSanitize'` in their dependency chain when calling `createInjector`.
  - **Acceptance Criteria:**
    - [x] `ngSanitize` is created via `createModule('ngSanitize', [])` and exported from `src/sanitize/index.ts`
    - [x] `injector.get('$sanitize')` returns a callable function only when an enclosing module's dependency chain includes `'ngSanitize'`
    - [x] `createInjector([ngModule])` (without `ngSanitize`) does NOT expose `$sanitize` — `injector.has('$sanitize') === false`
    - [x] `createInjector([ngModule, ngSanitize])` exposes `$sanitize` as a singleton — repeated `injector.get('$sanitize')` calls return the same reference
    - [x] `injector.get('$sanitizeProvider')` is only accessible during `config()` blocks, consistent with the spec 008 provider lifecycle

### 2.2. ES-Module Primary Surface

- The ESM-first factory `createSanitize(options?)` is the primary public API. The DI layer is a thin shim. Pure-ESM consumers can call `sanitize(untrustedHtml)` without any DI involvement.
  - **Acceptance Criteria:**
    - [x] `createSanitize(options?: SanitizeOptions): SanitizeService` is exported from `@sanitize/sanitize`
    - [x] `sanitize: SanitizeService` is exported as a pre-configured default instance (equivalent to `createSanitize()`)
    - [x] `SanitizeService` is callable: `(untrustedHtml: string) => string`
    - [x] `SanitizeOptions` accepts (at minimum) `validElements?`, `validAttrs?`, `validUriPattern?` for extending the default allow-lists; concrete shapes finalized in tech-considerations
    - [x] Both `createSanitize` and `sanitize` are re-exported from the root `src/index.ts` and from the `./sanitize` subpath

### 2.3. `$sanitize` Service & `$SanitizeProvider`

- The DI layer wraps the ESM factory. The provider owns only configuration state; `$get` calls `createSanitize` with the captured config.
  - **Acceptance Criteria:**
    - [x] `$SanitizeProvider` is registered on `ngSanitize` via the spec 008 `.provider()` recipe
    - [x] `$sanitizeProvider.addValidElements(elements: string[] | Record<string, string[]>)` extends the tag allow-list at config time (matches AngularJS API)
    - [x] `$sanitizeProvider.addValidAttrs(attrs: string[])` extends the attribute allow-list
    - [x] `$sanitizeProvider.enableSvg(value: boolean): this` toggles SVG element support (default `false`, matching AngularJS 1.8.x)
    - [x] `$sanitizeProvider.uriPattern(pattern: RegExp): this` overrides the URL-protocol allow regex
    - [x] Each setter validates its input synchronously (throws on non-array / non-RegExp / non-boolean) and returns `this` for fluent chaining
    - [x] `$get` produces the same `SanitizeService` shape returned by `createSanitize`, so DI-resolved `$sanitize` and ESM `sanitize` are interchangeable in consuming code

### 2.4. Tag Allow-List

- `$sanitize` ships with a fixed default allow-list of safe HTML tags, exactly mirroring AngularJS 1.8.x's `validElements` set. Tags outside the list and their contents are dropped.
  - **Acceptance Criteria:**
    - [x] The default allow-list contains the AngularJS 1.8.x safe set: `a`, `abbr`, `acronym`, `address`, `area`, `b`, `bdi`, `bdo`, `big`, `blockquote`, `br`, `caption`, `center`, `cite`, `code`, `col`, `colgroup`, `dd`, `del`, `dfn`, `dir`, `div`, `dl`, `dt`, `em`, `figcaption`, `figure`, `font`, `footer`, `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `header`, `hgroup`, `hr`, `i`, `img`, `ins`, `kbd`, `label`, `legend`, `li`, `map`, `mark`, `menu`, `nav`, `nl`, `ol`, `p`, `pre`, `q`, `s`, `samp`, `section`, `small`, `span`, `strike`, `strong`, `sub`, `summary`, `sup`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `tr`, `tt`, `u`, `ul`, `var` — the exact list to be locked down in the technical considerations against `angular/angular.js/src/ngSanitize/sanitize.js`
    - [x] Disallowed tags (e.g. `<script>`, `<iframe>`, `<object>`, `<embed>`, `<style>`, `<form>`, `<input>`, `<button>`, `<svg>` (when SVG disabled), `<math>`, `<frame>`, `<frameset>`, `<noscript>`, `<meta>`, `<link>`, `<base>`, `<head>`, `<title>`) and ALL of their contents are dropped — text content of a disallowed tag does NOT survive
    - [x] Self-closing void elements (`<br>`, `<hr>`, `<img>`, etc.) are normalized to their void form
    - [x] Tag names are matched case-insensitively but normalized to lowercase in output
    - [x] `$sanitizeProvider.addValidElements(['custom-tag'])` adds a single tag; `addValidElements(['a', 'b', 'c'])` adds a list; the new tags are accepted on subsequent calls
    - [x] `$sanitizeProvider.addValidElements({ htmlVoidElements: [...], htmlElements: [...], svgElements: [...] })` is also accepted (AngularJS shape parity)
    - [x] `enableSvg(true)` adds the AngularJS SVG safe-set (a small whitelist of `<svg>`, `<g>`, `<path>`, `<circle>`, `<rect>`, etc.); default is `false`

### 2.5. Attribute Allow-List

- Attributes are matched against a per-context allow-list. Only attributes on the list survive; everything else (including all `on*` event handlers) is dropped.
  - **Acceptance Criteria:**
    - [x] The default attribute allow-list contains AngularJS 1.8.x's `validAttrs` set: `abbr`, `align`, `alt`, `axis`, `bgcolor`, `border`, `cellpadding`, `cellspacing`, `cite`, `class`, `clear`, `color`, `cols`, `colspan`, `compact`, `coords`, `dir`, `face`, `headers`, `height`, `hreflang`, `hspace`, `ismap`, `lang`, `language`, `nohref`, `nowrap`, `rel`, `rev`, `rows`, `rowspan`, `rules`, `scope`, `scrolling`, `shape`, `size`, `span`, `start`, `summary`, `tabindex`, `target`, `title`, `type`, `usemap`, `valign`, `value`, `vspace`, `width` — exact list locked down in technical considerations
    - [x] URL-bearing attributes are listed but routed through the URI sanitizer (§ 2.6): `href`, `src`, `xlink:href`
    - [x] All `on*` attributes (`onclick`, `onerror`, `onmouseover`, …) are dropped unconditionally — they are NOT on the allow-list and cannot be added via `addValidAttrs`
    - [x] `style` attribute is dropped by default (CSS injection is a known XSS vector); not on the allow-list
    - [x] Attribute names are matched case-insensitively
    - [x] `$sanitizeProvider.addValidAttrs(['data-test'])` adds attribute names to the allow-list
    - [x] Unknown attributes on allowed tags are dropped silently — no error, no warning logged

### 2.6. URL-Protocol Safe-List (`href` / `src` / `xlink:href`)

- URL-bearing attributes are scrubbed by matching their value against a configurable URL-protocol allow regex. Values that don't match are stripped (the attribute is removed; the surrounding tag is preserved).
  - **Acceptance Criteria:**
    - [x] The default `validUriPattern` is `/^\s*(https?|s?ftp|mailto|tel|file):/` plus a special-case for relative URLs (no protocol, leading `/` or `.` or alphanumeric path segment)
    - [x] `<a href="javascript:alert(1)">x</a>` → `<a>x</a>` (the dangerous attribute is stripped; the tag and content survive)
    - [x] `<a href="data:text/html,<script>...">x</a>` → `<a>x</a>` (data: URLs of executable types are stripped)
    - [x] `<a href="data:image/png;base64,...">x</a>` is implementation-defined: the AngularJS 1.8.x default regex strips ALL `data:` URLs; matches that strict default. Future relaxation can come via `uriPattern` override.
    - [x] `<a href="http://example.com/path?q=1">x</a>` survives unchanged (matches default allow regex)
    - [x] `<a href="/relative/path">x</a>` survives (relative URLs are accepted)
    - [x] `<img src="https://cdn.example.com/x.png">` survives; `<img src="javascript:...">` becomes `<img>`
    - [x] `<a xlink:href="...">` (SVG, when enabled) is sanitized via the same regex as `href`
    - [x] `$sanitizeProvider.uriPattern(/^\s*myapp:/)` overrides the default to allow only `myapp:` URLs
    - [x] The URI check is applied AFTER trimming leading/trailing whitespace (so `'  javascript:'` is still rejected)

### 2.7. Parser Behavior (Regex-Based Tokenization)

- The HTML parser is a regex-based scanner port of AngularJS 1.x's `htmlParser` (in `src/ngSanitize/sanitize.js`). It tokenizes the input into tag-open / tag-close / text / comment events and emits sanitized output. We deliberately do NOT use `DOMParser` — full AngularJS 1.x tokenization parity (and the matching CVE-regression coverage) is the priority.
  - **Acceptance Criteria:**
    - [x] The parser handles malformed HTML gracefully: unclosed tags are auto-closed at end-of-input, mismatched closing tags are silently dropped, unknown entities are passed through verbatim
    - [x] Comments (`<!-- ... -->`) are stripped from output
    - [x] CDATA sections (in HTML mode) are treated as text and entity-escaped
    - [x] Text content surviving from allowed tags is HTML-entity-escaped (so `<` becomes `&lt;` etc.) — text content NEVER reintroduces parseable HTML
    - [x] The parser is reentrant — calling `$sanitize` from inside a parser callback (e.g. via a custom provider extension) does not corrupt internal state
    - [x] Whitespace within attribute values is preserved; whitespace between attributes is normalized to a single space
    - [x] Boolean attributes (e.g. `disabled`, `checked`) are preserved with no value (or with the AngularJS-canonical `disabled="disabled"` form, to be locked in tech-considerations)

### 2.8. `$sce.getTrustedHtml` Automatic Fallback

- When the `ngSanitize` module is registered alongside the core `ng` module, `$sce.getTrustedHtml(plainString)` routes through `$sanitize` instead of throwing. This is the classic `ng-bind-html` pipeline.
  - **Acceptance Criteria:**
    - [x] `$SceProvider.$get` performs a lazy `$injector.has('$sanitize')` check at run-phase resolution
    - [x] If `$sanitize` is registered, the `createSce({ ..., sanitize: $injector.get('$sanitize') })` call is wired automatically
    - [x] `createSce` accepts a new optional `sanitize?: (html: string) => string` callback in its options bag (additive — does not break existing callers)
    - [x] When `sanitize` is supplied AND strict mode is on AND `getTrustedHtml(value)` is called with a plain string (not a `TrustedHtml` wrapper), the value is run through `sanitize(value)` and the result is returned
    - [x] When `sanitize` is NOT supplied (e.g. `ngSanitize` not loaded), `getTrustedHtml(plainString)` continues to throw the spec-012 "value was not trusted" error
    - [x] When strict mode is OFF, `$sanitize` is NOT invoked — the plain string passes through unchanged (per spec-012 strict-off pass-through semantics)
    - [x] `getTrustedHtml(trustedWrapper)` with a `TrustedHtml` always unwraps directly; the `$sanitize` fallback is only consulted for plain strings
    - [x] `getTrustedHtml(null)` and `getTrustedHtml(undefined)` continue to pass through; `$sanitize` is not invoked on nullish input
    - [x] No other `$sce` context (`url`, `resourceUrl`, `js`, `css`) is affected by this fallback — only `getTrustedHtml`

### 2.9. Empty / Null / Undefined / Non-String Input

- `$sanitize` handles edge-case inputs predictably without throwing.
  - **Acceptance Criteria:**
    - [x] `$sanitize(null) === ''` (AngularJS parity — null is treated as empty input)
    - [x] `$sanitize(undefined) === ''`
    - [x] `$sanitize('') === ''`
    - [x] `$sanitize('   ') === '   '` (whitespace is preserved as text content)
    - [x] `$sanitize('plain text')` returns `'plain text'` unchanged (no markup → no scrubbing)
    - [x] `$sanitize(42 as unknown as string)` — the AngularJS implementation coerces via `String(input)`; we match that behavior, returning the coerced string after sanitization. Non-string inputs do NOT throw.

### 2.10. Error Behavior

- `$sanitize` is a best-effort scrubber. It does not throw on malformed HTML; it returns the cleanest output it can produce.
  - **Acceptance Criteria:**
    - [x] Pathological inputs (deeply nested unclosed tags, mismatched attributes, partial entities) DO NOT cause `$sanitize` to throw — the parser auto-recovers
    - [x] An invalid configuration applied via `$sanitizeProvider.addValidElements([42 as unknown as string])` throws synchronously at config time (provider-side validation)
    - [x] Invalid `validUriPattern` (e.g. `$sanitizeProvider.uriPattern('not a regex' as any)`) throws synchronously
    - [x] All thrown errors are `Error` instances with messages prefixed `$sanitizeProvider.…` so they're traceable

### 2.11. DOMPurify-Compat Escape Hatch

- Apps with stricter security needs may swap the built-in implementation for [DOMPurify](https://github.com/cure53/DOMPurify) without forking. The decorator pattern provides this seam.
  - **Acceptance Criteria:**
    - [x] The `$sanitize` registration is decoratable via `module.decorator('$sanitize', …)` (existing spec 008 decorator recipe)
    - [x] A documented worked example in `CLAUDE.md` (or a dedicated docs file) shows how to wrap `$sanitize` to delegate to DOMPurify, including the optional `RETURN_DOM_FRAGMENT: false, RETURN_TRUSTED_TYPE: false` config to match the string-in / string-out contract
    - [x] DOMPurify itself is NOT a dependency of `my-own-angularjs` — the example is an opt-in pattern only

### 2.12. AngularJS Parity Tests + mXSS-Regression Suite

- The test surface includes a dedicated regression suite for every historical `ngSanitize` CVE so future edits cannot regress fixed bypasses.
  - **Acceptance Criteria:**
    - [x] Test vectors are ported from `angular/angular.js/test/ngSanitize/sanitizeSpec.js` and run as a parity suite
    - [x] A separate `src/sanitize/__tests__/cve-regressions.test.ts` file holds one test per documented historical `ngSanitize` advisory: AngularJS CVE-2020-7676 (mXSS via `<noscript>` namespace confusion), CVE-2018-12116, CVE-2014-3506, and any others enumerated in the AngularJS issue tracker. Each test embeds the original payload + the expected sanitized output.
    - [x] The regression suite is part of the standard `pnpm test` run; failure is a build break

### 2.13. Backward Compatibility

- Adding `ngSanitize` and the `$sce` fallback hook must not break any existing code or test.
  - **Acceptance Criteria:**
    - [x] All tests from specs 003, 007, 008, 009, 010, 011, and 012 continue to pass unchanged
    - [x] `$sce.getTrusted('html', plainString)` continues to throw when `ngSanitize` is NOT loaded (preserves spec-012 behavior for apps that never opt in to sanitization)
    - [x] `createSce()` (no callback) continues to work as in spec 012; the new `sanitize` callback is optional and additive
    - [x] `parse()` API is not modified
    - [x] `$interpolate`, `$watch`, scope, DI, parser APIs are unchanged
    - [x] No existing public export is removed or renamed

### 2.14. Documentation

- The new module is documented for downstream developers without forcing them to read source.
  - **Acceptance Criteria:**
    - [x] `CLAUDE.md` Modules table gains a `./sanitize` row
    - [x] `CLAUDE.md` "Non-obvious invariants" gains a bullet stating that `ngSanitize` is opt-in and is automatically integrated with `$sce` via lazy injector lookup (no hard dep)
    - [x] `CLAUDE.md` "Where to look when..." gains a row pointing to `src/sanitize/sanitize.ts` for "How is untrusted HTML scrubbed?"
    - [x] Every exported member (`createSanitize`, `sanitize`, `$SanitizeProvider`, `SanitizeOptions`, `SanitizeService`) carries TSDoc with at least one usage example
    - [x] The DOMPurify swap pattern (§ 2.11) is documented either in `CLAUDE.md` or in `src/sanitize/README.md`

---

## 3. Scope and Boundaries

### In-Scope

- `ngSanitize` module registered separately from the core `ng` module (subpath `./sanitize`, alias `@sanitize`)
- ESM-first `createSanitize` factory + `sanitize` default-instance export
- `$sanitize` service + `$SanitizeProvider` thin DI shim
- AngularJS 1.8.x default tag allow-list, attribute allow-list, and URL-protocol regex
- Provider extensions: `addValidElements`, `addValidAttrs`, `enableSvg`, `uriPattern`
- Regex-based HTML parser ported from AngularJS 1.x `src/ngSanitize/sanitize.js`
- Automatic `$sce.getTrustedHtml` fallback when `ngSanitize` is registered (lazy `$injector.has` lookup; no hard dep)
- `createSce` options bag extended with optional `sanitize` callback (additive)
- Empty / null / undefined / non-string input handling (matches AngularJS)
- AngularJS parity test suite + dedicated `cve-regressions.test.ts`
- `./sanitize` added to `package.json` exports and `rollup.config.mjs` entries
- `CLAUDE.md` updates for the new module and its `$sce` integration
- DOMPurify-compat decorator pattern documented (no runtime dep)
- Continued passing of all prior spec tests (003, 007–012) and the 90% line-coverage threshold for `src/sanitize/`

### Out-of-Scope

- **`ng-bind-html` directive** — depends on `$compile` (Phase 2, not yet shipped). When directives land, `ng-bind-html` will consume `$sce.getTrustedHtml`, which will already route through `$sanitize` thanks to this spec.
- **`$compile` integration of `linky` filter** — shipped in `ngSanitize` upstream; deferred to a later spec when filters land.
- **CSS sanitization (`style` attribute scrubbing)** — `style` is dropped entirely by the default allow-list; per-property CSS sanitization is significantly more complex and out of scope.
- **Trusted Types API integration** — modern browsers' [Trusted Types](https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API) feature is a separate hardening layer; out of scope for this spec.
- **Server-side rendering or Node-without-jsdom support** — the regex parser does NOT depend on the DOM, so technically works on Node, but SSR is explicitly out-of-scope for the project per `product-definition.md` § 3.2.
- **Customizable URL-protocol allow-list per attribute** — AngularJS 1.x has a single global URI regex; we mirror that. Per-attribute regexes (e.g. different rules for `<img src>` vs. `<a href>`) can be added later if needed.
- **Bundling DOMPurify or any other third-party sanitizer** — only the swap-in pattern is documented.
- **`$exceptionHandler` integration** — `$sanitize` does not throw on malformed input (best-effort recovery), so there are no runtime exceptions to route. Provider-side validation throws synchronously (caught by the caller's `try/catch`), so no `$exceptionHandler` integration is needed in this spec.
- **Filters, Directives, HTTP, Forms, Routing, Animations, `angular` namespace** — separate phases.
