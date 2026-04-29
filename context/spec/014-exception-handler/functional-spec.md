# Functional Specification: `$exceptionHandler` — Centralized Exception Routing

- **Roadmap Item:** Phase 2 — Expressions, Filters & DOM > Exception Handling (`$exceptionHandler`)
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Spec 011 (§2.10) and spec 013 (§2.10) both deferred runtime error routing with a note that "for now they bubble" or "are logged inline via `console.error`". That deferral lands here. Today, six sites in `src/core/scope.ts` swallow exceptions with hand-written `console.error` calls, and the `$interpolate` render function lets expression-evaluation errors bubble unguarded. There is no single seam an application can wire into to capture, log, or report runtime errors from the framework.

**`$exceptionHandler` is that seam.** It is the one-line service that AngularJS 1.x expects every framework-internal try/catch to call into. Its default implementation forwards to `console.error` — observable today's behavior is preserved exactly. Apps that want to ship errors to Sentry, Datadog, or a custom logger override the registration in a `config()` block via `$provide.factory('$exceptionHandler', …)`. There is no provider class — `$exceptionHandler` is just a function, replaceable like any other DI-registered factory.

This spec ships three things in one slice:

1. The service itself — typed, ESM-first, DI-registered on the core `ng` module.
2. **Digest integration** — every `console.error` site in `scope.ts` (six of them, plus the TTL exhaustion error) routes through `$exceptionHandler`. The digest still does not abort on a single watcher/listener failure; that contract is preserved.
3. **`$interpolate` integration** — render-time expression-evaluation errors are caught inside the render fn and routed via `$exceptionHandler`, then a sentinel value (`undefined`) is returned for that expression slot so the rest of the template still renders. This matches the AngularJS 1.x `$interpolate` pipeline.

After this lands, the runtime-error deferrals from spec 011 and spec 013 are resolved, and downstream services (`$compile`, `$http`, `$q`, etc.) have a canonical place to send exceptions when they ship.

**Success criteria:**

- `injector.get('$exceptionHandler')` returns a callable `(exception, cause?) => void` whose default implementation logs to `console.error`.
- Apps override the handler via `$provide.factory('$exceptionHandler', () => myHandler)` in a `config()` block — no other public API changes are needed.
- Every existing `console.error('Error in …', e)` line in `scope.ts` is replaced by `$exceptionHandler(e, '<descriptor>')` — the digest still continues on watcher/listener failures.
- The digest TTL exhaustion error is reported to `$exceptionHandler(ttlError, '$digest')` and re-thrown.
- `$interpolate` render-time evaluation errors are caught and routed to `$exceptionHandler`; the failed expression renders as the empty string, surrounding text and other expressions render normally.
- A custom `$exceptionHandler` that itself throws does NOT crash the digest — the recursion guard falls back to `console.error`.
- `Scope.create({ exceptionHandler })` and `createInterpolate({ exceptionHandler })` accept a custom handler in the pure-ESM path; default remains `console.error`.
- All existing tests (specs 003, 007, 008, 009, 010, 011, 012, 013) continue to pass; behavior is additive (default is `console.error`, observable output unchanged unless the test asserts on the new routing path).

---

## 2. Functional Requirements (The "What")

### 2.1. Module Registration & Lifecycle

- `$exceptionHandler` is registered on the core `ng` module — apps that depend on `ng` (the standard root) get it for free. There is no provider class; the registration is a plain `.factory(…)`.
  - **Acceptance Criteria:**
    - [ ] `injector.get('$exceptionHandler')` returns a callable function for any injector created with the `ng` module in its dependency chain
    - [ ] Calling `injector.get('$exceptionHandler')` repeatedly returns the same singleton reference (factory recipe semantics)
    - [ ] No `$exceptionHandlerProvider` is exposed — overriding is via `$provide.factory('$exceptionHandler', factory)` inside a `config()` block, mirroring AngularJS 1.x
    - [ ] An override registered in a `config()` block fully replaces the default (the default factory is not chained or wrapped)
    - [ ] `injector.get('$exceptionHandler')` is available in `run()` blocks and at runtime resolution; `config()` blocks see the provider-side override seam (`$provide`) but cannot directly resolve `$exceptionHandler` itself

### 2.2. ES-Module Primary Surface

- The pure-ESM API is a typed function alias plus two ready-made implementations. No `createExceptionHandler` factory — there is nothing to configure beyond the function itself.
  - **Acceptance Criteria:**
    - [ ] `ExceptionHandler` is exported from `@exception-handler/index` as `type ExceptionHandler = (exception: unknown, cause?: string) => void`
    - [ ] `consoleErrorExceptionHandler: ExceptionHandler` is exported and forwards to `console.error('[$exceptionHandler]', exception, cause ?? '')` — the exact log format is locked down in technical considerations
    - [ ] `noopExceptionHandler: ExceptionHandler` is exported (a `() => {}` constant) — for tests that want to assert no error was reported, or to silence logging entirely
    - [ ] `exceptionHandler: ExceptionHandler` is exported as the default instance (= `consoleErrorExceptionHandler`) — symmetrical with the `sce` / `sanitize` / `interpolate` default-export pattern
    - [ ] All four exports (`ExceptionHandler`, `consoleErrorExceptionHandler`, `noopExceptionHandler`, `exceptionHandler`) are re-exported from the root `src/index.ts` and from the `./exception-handler` subpath

### 2.3. `$exceptionHandler` Service — DI Registration

- The DI shim is a one-line factory on the `ng` module. Returning the ESM `consoleErrorExceptionHandler` keeps zero duplicate logic.
  - **Acceptance Criteria:**
    - [ ] `ngModule.factory('$exceptionHandler', () => consoleErrorExceptionHandler)` is the registration line
    - [ ] The factory has zero dependencies — `$exceptionHandler` MUST be resolvable before any other service that consumes it (notably `$rootScope` and `$interpolate`)
    - [ ] `injector.get('$exceptionHandler')` is a `(exception: unknown, cause?: string) => void` callable
    - [ ] Calling `injector.get('$exceptionHandler')(new Error('boom'), 'test')` invokes the registered handler synchronously
    - [ ] The TypeScript registry (`@di/di-types`) augmentation registers `$exceptionHandler` under the `ng` module shape so `injector.get('$exceptionHandler')` is correctly typed

### 2.4. Default Handler Implementation

- The default `consoleErrorExceptionHandler` writes to `console.error` so today's observable behavior is preserved unchanged.
  - **Acceptance Criteria:**
    - [ ] `consoleErrorExceptionHandler(error)` calls `console.error` exactly once
    - [ ] `consoleErrorExceptionHandler(error, 'watchFn')` calls `console.error` exactly once with both the exception and the cause descriptor visible in the output
    - [ ] The exact log format is `console.error('[$exceptionHandler]', exception, cause)` when `cause` is provided; when `cause` is omitted, the trailing `cause` argument is omitted (no `undefined` in the log) — final format locked down in technical considerations
    - [ ] Calling `consoleErrorExceptionHandler` with a non-`Error` exception (string, plain object, `null`, `undefined`) does not throw — the handler is total over its input domain
    - [ ] The default handler does NOT re-throw the exception (callers expect it to be terminal)

### 2.5. Custom Handler Override Path

- Apps replace the default via `$provide.factory('$exceptionHandler', factory)` inside a `config()` block. This is the canonical AngularJS pattern and reuses the spec 008 decorator/factory recipe — no new DI machinery.
  - **Acceptance Criteria:**
    - [ ] Registering `$provide.factory('$exceptionHandler', () => mySpy)` in a `config()` block makes `mySpy` the resolved handler for the rest of the injector lifetime
    - [ ] `module.factory('$exceptionHandler', () => mySpy)` (registered before `createInjector` runs) achieves the same override
    - [ ] `module.decorator('$exceptionHandler', ($delegate) => (e, c) => { mySpy(e, c); $delegate(e, c); })` wraps the default — the spec 008 decorator recipe works on `$exceptionHandler` like any other service
    - [ ] An overridden handler is invoked from every integration site listed below (§2.7–§2.12) — verified end-to-end by integration tests that swap in a spy
    - [ ] Overriding the handler does NOT change the digest's "log and continue" contract — if the custom handler returns normally, the digest proceeds; if it throws, the recursion guard (§2.6) fires

### 2.6. Recursion Guard (Custom Handler That Itself Throws)

- A custom `$exceptionHandler` that throws must NOT crash the digest, the interpolation render, or the event-broadcast loop. The framework wraps every call to the handler in a small guard that falls back to `console.error` on the secondary exception.
  - **Acceptance Criteria:**
    - [ ] When the configured `$exceptionHandler` throws inside its body, the framework catches the secondary exception and writes BOTH the original exception and the secondary exception to `console.error` with a clear `[$exceptionHandler] handler threw while reporting:` prefix
    - [ ] The guard is applied at every call site — scope's six try/catches, the digest TTL site, `$interpolate`'s render-time catch, and the post-digest queue
    - [ ] After the secondary exception is logged, control returns to the calling integration site as if the original exception had been handled normally — the digest continues, the event loop continues, the interpolation render continues
    - [ ] The guard does NOT recurse — it does NOT call `$exceptionHandler` again with the secondary exception (only `console.error`)
    - [ ] The guard is documented as part of the contract — apps overriding `$exceptionHandler` are reminded that throwing from inside the handler is supported but degrades to `console.error`

### 2.7. Scope Integration — Watch Function & Watch Listener

- The two try/catches inside `$digestOnce` route their captured exceptions through `$exceptionHandler` instead of `console.error`. The "log and continue" contract is preserved exactly.
  - **Acceptance Criteria:**
    - [ ] The watch-function catch at `src/core/scope.ts:283-286` becomes `$exceptionHandler(e, 'watchFn')` (cause string finalized in technical considerations — the spec commits to a short, stable token)
    - [ ] The watch-listener catch at `src/core/scope.ts:273-276` becomes `$exceptionHandler(e, 'watchListener')`
    - [ ] When a watch fn throws, the digest continues to the next watcher in the list — no early termination, no re-throw
    - [ ] When a watch listener throws, the digest continues — the watcher's `last` value is still updated (the dirty-flag bookkeeping that already runs before the listener call is unaffected)
    - [ ] An integration test registers a watcher whose `watchFn` throws on every tick; it verifies the spy handler is called once per digest pass (until TTL is exceeded), the digest still terminates via TTL, and other clean watchers in the list still run

### 2.8. Scope Integration — `$evalAsync` / `$applyAsync` / `$$postDigest`

- The three remaining digest-side try/catches route through `$exceptionHandler` with stable cause descriptors.
  - **Acceptance Criteria:**
    - [ ] The `$evalAsync` queue-drain catch at `src/core/scope.ts:314-318` becomes `$exceptionHandler(e, '$evalAsync')`
    - [ ] The `$applyAsync` queue-drain catch at `src/core/scope.ts:790-794` becomes `$exceptionHandler(e, '$applyAsync')`
    - [ ] The `$$postDigest` queue-drain catch at `src/core/scope.ts:346-350` becomes `$exceptionHandler(e, '$$postDigest')`
    - [ ] In each case, the queue drain continues — a single failing task does NOT abort the rest of the queue
    - [ ] An integration test enqueues five `$evalAsync` tasks where the third throws; the spy handler is called exactly once with cause `'$evalAsync'`; tasks 1, 2, 4, 5 all evaluated; the digest terminates normally (no TTL breach)

### 2.9. Scope Integration — Event Listeners (`$emit` / `$broadcast`)

- The event-dispatch loop in `$$fireEventOnScope` routes listener exceptions through `$exceptionHandler`.
  - **Acceptance Criteria:**
    - [ ] The catch at `src/core/scope.ts:772-776` becomes `$exceptionHandler(e, 'eventListener')`
    - [ ] Other listeners on the same event continue to fire after a sibling throws — no early termination of the listener list
    - [ ] `event.stopPropagation()` semantics are unchanged — a thrown listener does NOT implicitly stop propagation
    - [ ] An integration test registers three listeners on the same event; the middle one throws; the spy handler is called exactly once with cause `'eventListener'`; the first and third listeners still execute

### 2.10. Scope Integration — Digest TTL Exhaustion

- The TTL exhaustion error at `src/core/scope.ts:330` is reported to `$exceptionHandler(ttlError, '$digest')` BEFORE being thrown. Apps see it via the configured handler AND the throw still propagates to the `$apply` caller.
  - **Acceptance Criteria:**
    - [ ] When TTL is reached, `$exceptionHandler(ttlError, '$digest')` is invoked exactly once with the constructed `Error('… digest iterations reached. Aborting!…')` instance
    - [ ] The same `Error` is re-thrown immediately after the handler returns — `$digest()` and the wrapping `$apply()` propagate the error to their caller
    - [ ] The handler is invoked even when `$$lastDirtyWatch` is null (e.g., a runaway `$evalAsync` queue) — the cause descriptor is `'$digest'` regardless
    - [ ] If the custom handler itself throws inside the TTL path, the recursion guard (§2.6) logs to `console.error` and the original TTL `Error` is still re-thrown — handler failure does NOT mask the TTL signal
    - [ ] An integration test sets `ttl: 2`, registers a watcher that always reports dirty, verifies (a) the spy handler is called once with cause `'$digest'`, (b) `$apply` re-throws the TTL error to the test, (c) `$$lastDirtyWatch` info is present in the error message

### 2.11. Scope ESM Path — `Scope.create({ exceptionHandler? })`

- The pure-ESM `Scope.create()` accepts an optional `exceptionHandler` in its config bag. Default is `consoleErrorExceptionHandler`. The DI registration on `$rootScope` (when `bootstrap` lands) wires `$exceptionHandler` through this same option.
  - **Acceptance Criteria:**
    - [ ] `Scope.create()` (no args) — handler is `consoleErrorExceptionHandler`; observable behavior unchanged from today
    - [ ] `Scope.create({ ttl: 5 })` — handler is still `consoleErrorExceptionHandler`; existing TTL-only call sites are unaffected
    - [ ] `Scope.create({ exceptionHandler: spy })` — `spy` is invoked at every site listed in §2.7–§2.10
    - [ ] `Scope.create({ ttl: 5, exceptionHandler: spy })` — both options are honored together
    - [ ] The handler is captured at scope construction time and shared with all child scopes created via `$new` — child scopes do NOT each store their own copy; the root's handler is canonical
    - [ ] Replacing the handler after `Scope.create()` is NOT supported in this spec — the option is read-only after construction (the DI override path covers the runtime-replacement use case)
    - [ ] All existing tests that create `Scope.create()` without specifying `exceptionHandler` continue to pass unchanged

### 2.12. `$interpolate` Render-Time Integration

- The `createInterpolate` factory accepts an `exceptionHandler` option (similar to how spec 012 added `sceGetTrusted` / `sceIsEnabled`). At render time, each `parsedFn(context)` call is wrapped in try/catch; on failure, the handler is invoked and the failed expression renders as the empty string.
  - **Acceptance Criteria:**
    - [ ] `createInterpolate({ exceptionHandler? })` accepts an optional `ExceptionHandler` (default = `consoleErrorExceptionHandler`)
    - [ ] The DI shim (`$interpolate`'s registration in `src/interpolate/ng-module.ts` or equivalent) is updated to depend on `$exceptionHandler` and forward it as the `exceptionHandler` option to `createInterpolate`
    - [ ] When a parsed expression throws inside the render fn, the handler is invoked once with `(error, '$interpolate')` (cause descriptor finalized in technical considerations) — the failed expression slot renders as `''`
    - [ ] The remaining text segments and remaining expressions in the same template continue to render — a single failing expression does NOT poison the whole render
    - [ ] When `allOrNothing === true` AND any expression throws, the entire render returns `undefined` (matches the §2.6 spec-011 semantics for `undefined` results — a throw is treated equivalently to `undefined` for the purpose of `allOrNothing` short-circuiting)
    - [ ] When `oneTime === true` AND any expression throws, the throw is reported via `$exceptionHandler` and the render returns `undefined` for that pass; the watcher does NOT deregister on a throw (deregistration still requires a non-`undefined` resolution per spec 010)
    - [ ] Compile-time errors from `parse()` (caused by malformed expressions in `{{a +}}`) continue to throw synchronously at the `$interpolate(text)` call site — those errors are NOT routed through `$exceptionHandler` (they are programming errors surfaced at compile time, not runtime evaluation errors)
    - [ ] The strict-trust compile-time errors from spec 012 (§2.8) also continue to throw synchronously — `$exceptionHandler` does NOT swallow them
    - [ ] An integration test invokes `$interpolate('a {{x.y.z}} b')` (where `x` is undefined, so `x.y` throws) and verifies (a) the spy handler is called once with cause `'$interpolate'`, (b) the render returns `'a  b'` (failed expression slot is empty), (c) other expressions in the template still render

### 2.13. Cause Descriptor Vocabulary

- Cause descriptors are short, stable string tokens. They are part of the public contract — apps that switch on `cause` to route different exceptions to different sinks rely on them being stable.
  - **Acceptance Criteria:**
    - [ ] The exhaustive vocabulary shipped in this spec is: `'watchFn'`, `'watchListener'`, `'$evalAsync'`, `'$applyAsync'`, `'$$postDigest'`, `'eventListener'`, `'$digest'`, `'$interpolate'` — exactly eight tokens, locked down here
    - [ ] Every framework call to `$exceptionHandler` from inside `src/` MUST use one of the eight tokens — no ad-hoc strings
    - [ ] Tokens are exported as a frozen `const` (e.g., `EXCEPTION_HANDLER_CAUSES`) from `@exception-handler/index` so apps can reference them type-safely
    - [ ] A TypeScript union type `ExceptionHandlerCause` is exported and matches the eight tokens
    - [ ] Future specs that add new framework-internal `$exceptionHandler` call sites MUST extend this list — the addition is a public-API change that lands with that spec

### 2.14. Backward Compatibility

- Adding `$exceptionHandler` and rewiring the existing call sites must not break any prior test or change the observable default behavior.
  - **Acceptance Criteria:**
    - [ ] All tests from specs 003, 007, 008, 009, 010, 011, 012, and 013 continue to pass unchanged
    - [ ] The default observable output (`console.error` writes for swallowed digest errors) is preserved exactly — tests that asserted on `console.error` calls before this spec continue to assert successfully
    - [ ] No existing public export is removed or renamed — `Scope.create`, `parse`, `createInjector`, `createInterpolate`, `createSce`, `createSanitize` all retain their current signatures (the new `exceptionHandler` options are optional additions)
    - [ ] No existing DI registration is replaced or decorated by this spec — `$rootScope`, `$interpolate`, `$sce`, `$sanitize` continue to be registered as before; only their internal implementations are updated to call `$exceptionHandler` where they previously called `console.error` (or where they previously let errors bubble)
    - [ ] `injector.has('$exceptionHandler')` returns `true` on any injector with the `ng` module — apps that previously assumed it was absent must now account for its presence (this is documented as a breaking change to the injector surface, but the impact is limited to apps that explicitly probed for its absence — none today)

### 2.15. Documentation

- The new module is documented for downstream developers without forcing them to read source.
  - **Acceptance Criteria:**
    - [ ] `CLAUDE.md` Modules table gains an `./exception-handler` row listing `ExceptionHandler`, `consoleErrorExceptionHandler`, `noopExceptionHandler`, `exceptionHandler` (default), `EXCEPTION_HANDLER_CAUSES`, `ExceptionHandlerCause`
    - [ ] `CLAUDE.md` "Non-obvious invariants" gains a bullet stating that the digest "log and continue" contract is preserved through `$exceptionHandler`, and that the default handler logs to `console.error` exactly as before
    - [ ] `CLAUDE.md` "Where to look when…" gains a row pointing to `src/exception-handler/exception-handler.ts` for "How are runtime errors routed?"
    - [ ] Every exported member carries TSDoc with at least one usage example (custom handler registration in a `config()` block; ESM `Scope.create({ exceptionHandler })` usage)
    - [ ] A short `src/exception-handler/README.md` documents the override pattern, the eight cause descriptors, and the recursion-guard contract

---

## 3. Scope and Boundaries

### In-Scope

- New `src/exception-handler/` subpath + `@exception-handler/*` alias + `./exception-handler` entry in `package.json` exports and `rollup.config.mjs` build entries
- ESM-first exports: `ExceptionHandler` type, `consoleErrorExceptionHandler`, `noopExceptionHandler`, `exceptionHandler` (default), `EXCEPTION_HANDLER_CAUSES`, `ExceptionHandlerCause`
- DI registration: `$exceptionHandler` on the core `ng` module via plain `.factory()` (no provider class)
- Override path: `$provide.factory('$exceptionHandler', factory)` in a `config()` block; `module.decorator('$exceptionHandler', …)` wrap pattern
- Recursion guard: framework-internal wrapper that falls back to `console.error` if the configured handler itself throws
- Digest integration: replace all six `console.error` sites in `src/core/scope.ts` (watch fn, watch listener, `$evalAsync`, `$applyAsync`, `$$postDigest`, event listener) with `$exceptionHandler(e, '<descriptor>')` calls
- TTL routing: `$exceptionHandler(ttlError, '$digest')` invoked before re-throwing the TTL `Error`
- Scope ESM path: `Scope.create({ exceptionHandler? })` option (default = `consoleErrorExceptionHandler`); shared with all child scopes
- `$interpolate` integration: `createInterpolate({ exceptionHandler? })` option; render-time `parsedFn(context)` calls wrapped in try/catch; failed expressions render as `''`; `allOrNothing` and `oneTime` semantics preserved
- DI shim updates: `$interpolate`'s registration depends on `$exceptionHandler` and wires it through to `createInterpolate`
- Cause descriptor vocabulary locked: eight tokens (`watchFn`, `watchListener`, `$evalAsync`, `$applyAsync`, `$$postDigest`, `eventListener`, `$digest`, `$interpolate`)
- TypeScript registry augmentation in `@di/di-types` registering `$exceptionHandler` under the `ng` shape
- AngularJS parity tests + integration tests covering each call site with a spy handler
- 90% line-coverage threshold satisfied for `src/exception-handler/`
- `CLAUDE.md` updates and a `src/exception-handler/README.md`

### Out-of-Scope

- **`$exceptionHandlerProvider` class** — AngularJS 1.x does not have one; overrides go through `$provide.factory` / `module.decorator`. Not adding one here.
- **`$log` service** — AngularJS 1.x has both `$log` and `$exceptionHandler`; `$log` is a separate logging abstraction (info/warn/error/debug). Out of scope for this spec; will be specified separately if and when the roadmap calls for it.
- **`$compile` integration** — directives don't exist yet (Phase 2, not yet shipped). When `$compile` lands, its directive-link errors will route through `$exceptionHandler`; the integration call site is added in that spec.
- **`$http` / `$q` / `$timeout` / `$interval` integration** — those services are Phase 3. They will use `$exceptionHandler` when they ship; not part of this spec.
- **Refactoring `src/core/scope.ts`** — the file is already a refactor candidate per `CLAUDE.md` (827 lines). This spec touches the six call sites surgically; it does NOT split or restructure the file. Refactoring is a separate effort.
- **Async-error reporting (unhandled promise rejection, `window.onerror`)** — `$exceptionHandler` is a synchronous service that callers explicitly invoke. Hooking into the runtime's global async-error stream is a separate concern.
- **Source-map / stack-trace enrichment** — the handler receives the `Error` instance unchanged. Apps that want enriched stack traces can do that themselves inside their custom handler.
- **Per-cause handler routing in the framework** — the framework calls a single `$exceptionHandler` with a `cause` descriptor; routing to multiple sinks based on `cause` is the app's responsibility (a custom handler can switch on `cause`).
- **`Scope.create` runtime-replaceable handler** — the option is captured at construction; mutation after the fact is not supported. Apps that need runtime replacement use the DI override path.
- **Filters, Directives, Controllers, Bootstrap, HTTP, Forms, Routing, Animations, `angular` namespace** — separate phases per the roadmap.
