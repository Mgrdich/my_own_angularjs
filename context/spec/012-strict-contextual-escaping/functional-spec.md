# Functional Specification: `$sce` — Strict Contextual Escaping

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Security ($sce)
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 011 delivered `$interpolate`: developers can now render templates like `<span>Hello {{user.name}}</span>` and the expression parser does the rest. That service was designed with an escape hatch — a `trustedContext` parameter — that is currently a no-op stub (`TODO(spec-$sce)` in `src/interpolate/interpolate.ts`). This spec delivers the missing piece: a Strict Contextual Escaping (`$sce`) service that decides whether a particular value may be used in a particular sensitive context (HTML, URL, resource URL, JS, or CSS).

**The user pain today** is that nothing stops a developer from accidentally feeding arbitrary data into a place where the browser will interpret it as code. AngularJS 1.x's famous defense is `$sce`: by default, any value destined for a sensitive context must have been explicitly marked as trusted by application code, or it is rejected outright. Developers opt in to trust via a small, typed API (`$sce.trustAsHtml(value)`, `$sce.trustAsResourceUrl(value)`, …) and consumers ask for a trusted value via `$sce.getTrusted(context, value)`. For resource URLs, an additional allow-list / block-list lets developers pre-approve families of URLs (e.g. `https://api.myapp.com/**`) so those pass through without explicit wrapping.

After this spec lands:

- The `TODO(spec-$sce)` marker in `$interpolate` is removed and interpolation inside a trusted context actually enforces trust.
- Downstream roadmap items (directives like `ng-bind-html`, `ng-src`, `ng-include`) have a safe foundation to build on.
- The published library offers the same security default as AngularJS 1.x: secure out of the box, with a documented opt-out.

**Success criteria:**

- Any value going into one of the five sensitive contexts (`html`, `url`, `resourceUrl`, `js`, `css`) is either explicitly trusted, matched by the resource-URL allow-list, or rejected with a descriptive error.
- `$sceProvider.enabled(value?)` lets an application disable strict mode at config time; when disabled, `$sce` behaves as a full pass-through (AngularJS 1.x parity).
- `$interpolate(text, false, 'html')` refuses to render unless the entire interpolation consists of a single `{{trustedValue}}` binding.
- All existing tests (specs 003, 007, 008, 009, 010, 011) continue to pass, and at least 90% line coverage is maintained.

---

## 2. Functional Requirements (The "What")

### 2.1. Service Registration & Lifecycle

- `$sce` and `$sceProvider` are registered on the core (`ng`) module and obtained via DI, consistent with the provider lifecycle delivered in spec 008. `$sceDelegate` and `$sceDelegateProvider` are the lower-level services that `$sce` delegates to, also registered on the core module.
  - **Acceptance Criteria:**
    - [ ] `injector.get('$sce')` returns an object exposing the methods in §§ 2.3–2.6
    - [ ] `injector.get('$sceDelegate')` returns the underlying delegate (§ 2.7)
    - [ ] `injector.get('$sceProvider')` is only accessible during `config()` blocks
    - [ ] `injector.get('$sceDelegateProvider')` is only accessible during `config()` blocks
    - [ ] Requesting either provider after the injector is fully created throws, per spec 008 provider lifecycle
    - [ ] Both `$sce` and `$sceDelegate` are singletons — repeated `injector.get` calls return the same instance

### 2.2. Security Contexts

- The service recognizes exactly five sensitive contexts, identified by string keys. These keys appear everywhere `$sce` is used.
  - **Acceptance Criteria:**
    - [ ] The recognized context keys are: `'html'`, `'url'`, `'resourceUrl'`, `'js'`, `'css'`
    - [ ] A sixth "any" pseudo-context (`'$$ANY$$'`) exists internally so that `trustAs('$$ANY$$', v)` produces a value usable in any context (AngularJS 1.x parity — used by trusted helpers that don't know their eventual consumer)
    - [ ] Passing any string other than the six recognized contexts to `trustAs` / `getTrusted` throws a descriptive error naming the invalid context
    - [ ] The six context keys are exported as a typed constant (e.g. `SCE_CONTEXTS`) so library consumers do not have to hard-code strings

### 2.3. Marking Values as Trusted

- Developers mark a value as trusted for a specific context via `trustAs` or one of the five per-context shortcuts.
  - **Acceptance Criteria:**
    - [ ] `$sce.trustAs(ctx, value)` returns a "trusted wrapper" that pairs the value with the context
    - [ ] `$sce.trustAsHtml(value)` is equivalent to `$sce.trustAs('html', value)`
    - [ ] `$sce.trustAsUrl(value)` is equivalent to `$sce.trustAs('url', value)`
    - [ ] `$sce.trustAsResourceUrl(value)` is equivalent to `$sce.trustAs('resourceUrl', value)`
    - [ ] `$sce.trustAsJs(value)` is equivalent to `$sce.trustAs('js', value)`
    - [ ] `$sce.trustAsCss(value)` is equivalent to `$sce.trustAs('css', value)`
    - [ ] `$sce.trustAs('html', null)` returns `null` unchanged; `$sce.trustAs('html', undefined)` returns `undefined` unchanged (no wrapper created for nullish values)
    - [ ] `$sce.trustAs('html', 42)` (non-string input) throws a descriptive error — only strings may be wrapped
    - [ ] Trusting an already-trusted value re-wraps it for the requested context (AngularJS 1.x parity: the context on the outer wrapper wins)
    - [ ] Trusted wrappers, when coerced to a string (e.g. via `String(wrapper)` or template concatenation), return the original string value (so accidental stringification does not leak a `[object Object]` representation)
    - [ ] When strict mode is OFF, `trustAs` returns the value unchanged (no wrapper is created)

### 2.4. Retrieving Trusted Values

- Consumers retrieve a value for a sensitive context via `getTrusted` or one of the five per-context shortcuts. This is the checkpoint that decides whether a value is safe for the requested context.
  - **Acceptance Criteria:**
    - [ ] `$sce.getTrusted(ctx, trustedWrapper)` returns the underlying string IF the wrapper was created for the same context OR for the "any" pseudo-context
    - [ ] `$sce.getTrustedHtml(v)` is equivalent to `$sce.getTrusted('html', v)`; matching shortcuts exist for `url`, `resourceUrl`, `js`, `css`
    - [ ] With strict mode ON, passing a plain string to `getTrusted('html', plainString)` throws a descriptive error identifying the `html` context
    - [ ] With strict mode ON, passing a wrapper from a MISMATCHED context (e.g. a `url` wrapper into `getTrusted('html', ...)`) throws a descriptive error
    - [ ] An "any"-context wrapper (`trustAs('$$ANY$$', v)`) unwraps for every `getTrusted` call
    - [ ] `getTrusted` on `null` or `undefined` returns the value unchanged (no error)
    - [ ] When strict mode is OFF, `getTrusted(ctx, value)` returns the value unchanged regardless of whether it was wrapped — the service becomes a pass-through
    - [ ] **Special case for the `url` context:** a plain string may be treated as trusted when it passes basic URL safety (AngularJS 1.x treats all strings as trusted for the `url` context because URLs in `href` / `src` are not code-executing in modern browsers). Confirmed parity with AngularJS 1.7.x.
    - [ ] **Special case for the `resourceUrl` context:** see § 2.7 — the allow-list / block-list is consulted before the trust-wrapper check

### 2.5. Parsing Expressions with a Trusted Context

- `$sce.parseAs(ctx, expression)` takes an expression source string and returns a function `(scope) => safeValue` that evaluates the expression and then runs the result through `getTrusted(ctx, ...)`. Per-context shortcuts exist for each of the five contexts.
  - **Acceptance Criteria:**
    - [ ] `$sce.parseAs('html', 'user.bio')(scope)` returns the unwrapped string when `scope.user.bio` is a trusted-HTML wrapper
    - [ ] `$sce.parseAs('html', "'plain'")(scope)` (strict mode ON) throws when evaluation yields a plain string not suitable for the HTML context
    - [ ] `$sce.parseAsHtml(expr)` is equivalent to `$sce.parseAs('html', expr)`; matching shortcuts exist for the other four contexts
    - [ ] `$sce.parseAs` returns the same function identity when called twice with identical arguments only if the underlying `parse()` does (no additional memoization is required)
    - [ ] Metadata from the parsed expression (e.g. `.literal`, `.constant`, `.oneTime` from spec 010) is preserved on the returned function

### 2.6. Strict-Mode Toggle (`$sceProvider.enabled`)

- Strict mode is ON by default and can only be toggled at config time.
  - **Acceptance Criteria:**
    - [ ] `$sceProvider.enabled()` with no args returns the current strict-mode boolean; default is `true`
    - [ ] `$sceProvider.enabled(false)` disables strict mode; returns the provider (fluent)
    - [ ] `$sceProvider.enabled(true)` explicitly enables strict mode; returns the provider (fluent)
    - [ ] After a `config()` block calls `$sceProvider.enabled(false)`, all `$sce.trustAs*` / `getTrusted*` calls behave as pass-through (per §§ 2.3, 2.4)
    - [ ] `$sce.isEnabled()` returns the final strict-mode boolean; there is no runtime setter
    - [ ] Attempting to call `$sceProvider.enabled(value)` after the injector has finished the config phase throws a descriptive "provider not available post-config" error, consistent with spec 008

### 2.7. Delegate Layer (`$sceDelegate`) and Resource-URL Allow-/Block-Lists

- `$sceDelegate` is the lower-level service that actually performs trust wrapping and unwrapping; `$sce` is a thin façade over it. The separation exists so that the resource-URL allow-list / block-list configuration lives on `$sceDelegateProvider` at a known, swappable layer.
  - **Acceptance Criteria:**
    - [ ] `$sceDelegate` exposes `trustAs(ctx, value)`, `getTrusted(ctx, value)`, and `valueOf(value)` (returns the underlying string of a trusted wrapper, or the value itself if not wrapped)
    - [ ] `$sceDelegateProvider.trustedResourceUrlList(list?)` reads or sets the allow-list; default is `['self']`
    - [ ] `$sceDelegateProvider.bannedResourceUrlList(list?)` reads or sets the block-list; default is `[]` (empty — nothing blocked)
    - [ ] Each list accepts an array whose entries may be: the literal string `'self'` (meaning "same origin as the document loading the application"), a string pattern using `**` (matches zero or more of any characters including `/`) and `*` (matches zero or more characters excluding `/` and `:`), or a `RegExp`
    - [ ] For the `resourceUrl` context, `getTrusted('resourceUrl', value)` in strict mode returns the URL (unwrapped if it was a wrapper) IF the URL matches an allow-list entry AND does NOT match any block-list entry; otherwise it throws a descriptive error naming the URL and the list check that failed
    - [ ] Block-list matches take precedence over allow-list matches (a URL matching both is rejected)
    - [ ] String patterns match against the full URL including protocol, host, path, and query string (AngularJS 1.x parity)
    - [ ] `'self'` matches when the URL's protocol + host + port equals the document's protocol + host + port; protocol-relative URLs (`//other.com/x`) are resolved against the current document
    - [ ] Calling `trustedResourceUrlList` / `bannedResourceUrlList` after config phase throws, consistent with provider lifecycle

### 2.8. `$interpolate` Integration

- The stubbed `trustedContext` parameter on `$interpolate` (spec 011 § 2.8) is wired to `$sce.getTrusted(...)`. The `TODO(spec-$sce)` comment in `src/interpolate/interpolate.ts` is resolved.
  - **Acceptance Criteria:**
    - [ ] With strict mode ON and a non-empty `trustedContext`, the interpolation must consist of **exactly one** `{{expr}}` binding with **no** surrounding literal text (and no other expressions). Any violation — literal prefix, literal suffix, or multiple expressions — causes `$interpolate(text, false, ctx)` to throw a descriptive "interpolations allow-only-single-expression" error at compile time
    - [ ] When the single-binding constraint is met, the rendered value is produced by evaluating the embedded expression and then passing the result through `$sce.getTrusted(ctx, ...)` — a trust violation surfaces at render time
    - [ ] An interpolation of only literal text (no bindings) with a `trustedContext` argument is allowed — the literal renders as-is (no trust check, because there is no dynamic value)
    - [ ] With strict mode OFF, `trustedContext` is ignored (pass-through), preserving behavior across the mode toggle
    - [ ] `mustHaveExpression`, `allOrNothing`, and one-time (`::`) behaviors from spec 011 continue to work alongside `trustedContext`
    - [ ] The `trustedContext` argument accepts only the six valid context strings from § 2.2; any other string throws at `$interpolate(text, …)` call time

### 2.9. Error Messages

- All errors produced by `$sce` are descriptive enough that a developer reading only the message can understand what went wrong.
  - **Acceptance Criteria:**
    - [ ] An error thrown by `getTrusted(ctx, plainString)` includes the context name (e.g. `'html'`) and a hint that the value must be produced by a matching `trustAs*` call
    - [ ] An error thrown by `getTrusted('resourceUrl', url)` for a list-reject includes the URL and states whether it failed the allow-list (no match) or matched the block-list
    - [ ] An error thrown by a `trustAs` call with a non-string input includes the received `typeof`
    - [ ] An error thrown by `$interpolate` for the single-binding violation in a trusted context names the offending text and the context
    - [ ] All errors are thrown as `Error` instances (not returned as values); they are catchable via standard `try/catch`

### 2.10. Backward Compatibility

- Adding `$sce` must not break any existing code or test.
  - **Acceptance Criteria:**
    - [ ] All tests from specs 003, 007, 008, 009, 010, and 011 continue to pass unchanged
    - [ ] The `parse()` API signature is not modified
    - [ ] The `$interpolate` service signature is not modified; the stub parameter now has real behavior when `trustedContext` is supplied, but omitting it yields the spec-011 behavior
    - [ ] `$watch`, `$watchGroup`, `$watchCollection`, `$eval`, `$apply`, `$evalAsync`, `$applyAsync` signatures are unchanged
    - [ ] No existing public export is removed or renamed
    - [ ] The TypeScript type for the `InterpolateService`'s `trustedContext` parameter narrows to the six valid context strings (plus `undefined`)

### 2.11. Documentation

- The addition is documented so that downstream developers can adopt it without reading the source.
  - **Acceptance Criteria:**
    - [ ] `CLAUDE.md` in the repository root mentions `$sce` under the Modules table and under "Non-obvious invariants" if any (e.g. resource-URL list rules, strict-mode default)
    - [ ] The `$sce` and `$sceProvider` public API has TSDoc comments on every exported member
    - [ ] At least one example in the TSDoc shows configuring the allow-list for a typical cross-origin API host
    - [ ] At least one example shows using `$sce.trustAsHtml(value)` together with `$interpolate(text, false, 'html')`

---

## 3. Scope and Boundaries

### In-Scope

- `$sce` service, `$sceProvider`, `$sceDelegate`, and `$sceDelegateProvider` registered on the core `ng` module
- The six context keys (`html`, `url`, `resourceUrl`, `js`, `css`, plus the internal "any" pseudo-context)
- Generic `trustAs` / `getTrusted` / `parseAs` plus all five per-context shortcut methods for each
- `$sceProvider.enabled(value?)` config-time strict-mode toggle (default ON)
- `$sce.isEnabled()` read-only runtime query
- `$sceDelegateProvider.trustedResourceUrlList(list?)` and `.bannedResourceUrlList(list?)` with string patterns (`**`/`*`), `'self'`, and `RegExp` entries
- Default resource-URL allow-list of `['self']` and block-list of `[]`
- Full allow-list / block-list enforcement for the `resourceUrl` context, with block-list precedence
- Pass-through semantics when strict mode is disabled (trust wrappers not created; retrieval returns the value unchanged)
- Pass-through handling of `null` / `undefined` for both `trustAs` and `getTrusted`
- `$interpolate` integration: wire `trustedContext` to `$sce.getTrusted(...)`, enforce the single-binding rule for trusted contexts, remove the `TODO(spec-$sce)` marker
- Descriptive error messages for every rejection path
- TSDoc on the public API and a `CLAUDE.md` entry
- Continued passing of all prior spec tests and maintenance of the 90% line-coverage threshold

### Out-of-Scope

- **`$sanitize` service** — sanitizing untrusted HTML into safe HTML is a separate feature, conventionally a separate module; will be specified later if added to the roadmap
- **`$exceptionHandler` routing** — the `$sce` errors surface synchronously to the caller; integration with `$exceptionHandler` is Phase 2 / deferred (roadmap item `Exception Handling ($exceptionHandler)`)
- **Filters, `ng-bind-html`, `ng-src`, `ng-include`, `ng-href`, and other directives that would consume `$sce`** — separate Phase 2 roadmap items
- **`$compile` / `$controller` integration** — separate Phase 2 roadmap items
- **Promises, HTTP, Forms, Routing, Animations** — separate Phase 3 / Phase 4 roadmap items
- **The `angular.module` / `angular` namespace compatibility shim** — Phase 5 roadmap item
- **Memoization / perf optimization of `parseAs`** — can be added later if measurements justify it
- **Runtime `enabled(...)` setter on `$sce`** — strict mode is frozen after the config phase by design (AngularJS 1.x parity)
- **Advanced CSP integration beyond avoiding `new Function()` / `eval()`** — the parser already complies (tree-walking interpreter); no further CSP features in this spec
