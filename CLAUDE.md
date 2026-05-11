# my-own-angularjs — AI context

A from-scratch TypeScript reimplementation of AngularJS. Goal: **clarity over performance**. Every feature goes through the AWOS spec-driven workflow before code.

## Commands

```bash
pnpm test          # vitest (jsdom env, 90% line-coverage threshold)
pnpm typecheck     # tsc --noEmit, strict + noUncheckedIndexedAccess
pnpm lint          # ESLint strictTypeChecked preset
pnpm format        # Prettier (semi, singleQuote, printWidth 120)
pnpm build         # Rollup dual ESM+CJS with .d.ts for each subpath
```

CI (`.github/workflows/ci.yml`) gates on: lint → format:check → typecheck → test. `build` is not yet in CI.

## Modules (public surface via `package.json` exports)

| Subpath | Purpose | Key exports |
| --- | --- | --- |
| `.` (root) | Aggregate barrel | re-exports everything below |
| `./core` | Scopes & digest cycle | `Scope.create`, `$watch`, `$watchGroup`, `$watchCollection`, `$digest`, `$apply`, `$eval`, `$evalAsync`, `$applyAsync`, `$on/$emit/$broadcast`, `$new`, `$destroy`, `isEqual`, `copy`, type guards |
| `./parser` | Expression parser | `parse(expr)` → `ParsedExpression` (lexer → AST → tree-walking interpreter) |
| `./di` | Dependency injection (incl. config-phase `$provide` injectable) | `createModule`, `createInjector`, `annotate`, `ProvideService` (type) |
| `./interpolate` | String & template interpolation (`{{expr}}` resolution) | `createInterpolate`, `interpolate` (default), `InterpolateFn`, `InterpolateService`, `InterpolateOptions`, `ngModule` |
| `./sce` | Strict Contextual Escaping — trust wrappers for HTML / URL / resource URL / JS / CSS | `createSce`, `sce` (default), `createSceDelegate`, `sceDelegate`, `SCE_CONTEXTS`, `TrustedHtml`/`TrustedUrl`/`TrustedResourceUrl`/`TrustedJs`/`TrustedCss`, `isTrustedValue`, `isTrustedFor`, `isValidSceContext` |
| `./sanitize` | Opt-in HTML sanitization (companion to `$sce`) — parses + scrubs untrusted HTML against a fixed allow-list | `createSanitize`, `sanitize` (default), `$SanitizeProvider` (DI-only, not in root barrel), `ngSanitize`, `SanitizeService`, `SanitizeOptions`, `AddValidElementsArg` |
| `./exception-handler` | Centralized exception routing — replaces inline `console.error` swallowing in scope and routes `$interpolate` render-time errors. Default handler logs to `console.error` (observable behavior unchanged); apps override via `module.factory('$exceptionHandler', […])` or `module.decorator(...)`. | `ExceptionHandler` (type), `consoleErrorExceptionHandler`, `noopExceptionHandler`, `exceptionHandler` (default), `invokeExceptionHandler`, `EXCEPTION_HANDLER_CAUSES`, `ExceptionHandlerCause` |
| `./filter` | Filters: pipe-syntax `value \| filterName : args`, `$filterProvider` registration, `$filter` lookup, nine built-in filters (`filter`, `orderBy`, `limitTo`, `currency`, `number`, `date`, `uppercase`, `lowercase`, `json`), and `$locale` (en-US default, swappable). | `createFilter`, `$FilterProvider`, `defaultLocale`, the nine built-in factories (`uppercaseFilterFactory`, `lowercaseFilterFactory`, `jsonFilterFactory`, `limitToFilterFactory`, `currencyFilterFactory`, `numberFilterFactory`, `dateFilterFactory`, `filterFilterFactory`, `orderByFilterFactory`), `FilterFn`, `FilterFactory`, `FilterService`, `IFilterProvider`, `LocaleService`, `FilterLookupError` |
| `./compiler` | DOM compiler — `$compile` tree walker, `$compileProvider` registration, four restrict modes (E/A/C/M), priority + terminal sorting, three-phase linking (compile / pre-link / post-link), `Attributes` with `$set` / `$observe`, `scope: true` child scopes, element cleanup contract for future structural directives. | `createCompile`, `$CompileProvider`, `AttributesImpl`, `directiveNormalize`, `setElementScope`, `getElementScope`, `addElementCleanup`, `destroyElementScope`, `InvalidDirectiveNameError`, `InvalidDirectiveFactoryError`, `IsolateScopeNotSupportedError`, types `Attributes`, `CompileFn`, `CompileOptions`, `CompileService`, `Directive`, `DirectiveDefinition`, `DirectiveFactory`, `DirectiveFactoryReturn`, `Linker`, `LinkFn` |

## Non-obvious invariants

- **No `new Function()` / no `eval()`** — the expression parser uses a **tree-walking interpreter** deliberately. This avoids CSP violations and is part of the project's security posture. Don't "optimize" by generating code strings.
- **Digest TTL contract** — configurable via `Scope.create({ ttl: 20 })` (default 10). TTL breach throws with the watch function source in the error to help identify unstable watchers.
- **One-time bindings & constant watches** (spec 010) — the parser attaches `literal` / `constant` / `oneTime` flags on AST nodes. Scope wires `oneTimeWatchDelegate` (literal) or `oneTimeLiteralWatchDelegate` for `::expr` expressions; constant expressions use `constantWatchDelegate`. When modifying the watcher wiring, preserve those delegate selections.
- **Module boundary rule** — `parser/*` and `di/*` depend only on `@core` (prefer importing from `@core/index`, not `@core/utils` directly). `core/scope.ts` intentionally depends on `@parser/index` because scopes evaluate expression strings. `compiler/` has no dependencies yet.
- **Error handling in digest** — listener/watch exceptions are logged with `console.error('...', e)` and the digest continues. Don't swallow silently and don't abort the digest loop on a single listener failure.
- **Strict mode is frozen after the config phase** — `$sceProvider.enabled(false)` is the only way to disable SCE. Once the injector finishes config, `$sce.isEnabled()` is permanent. Strict-OFF turns both `trustAs*` and `getTrusted*` into total pass-throughs (no wrapper classes are constructed).
- **Trusted values are per-context nominal classes** — `TrustedResourceUrl extends TrustedUrl`, so a trusted resource URL is accepted where a trusted URL is expected (not vice-versa). Identity is checked via `instanceof`, not a string-based brand. Do NOT "optimize" to a single branded wrapper — the subtype rule matters for AngularJS parity.
- **`ngSanitize` is opt-in, never registered on the core `ng` module** — apps must list `'ngSanitize'` in their dependency chain. When loaded, `$sce.getTrustedHtml(plainString)` automatically routes through `$sanitize` via a lazy `$injector.has('$sanitize')` lookup in `$SceProvider.$get` — no hard dependency from `$sce` to `ngSanitize`, no decoration. Removing the `$injector` dep from `$SceProvider.$get` would silently break this integration; the regression test in `src/sanitize/__tests__/sanitize-sce.test.ts` is the guard.
- **The digest's "log and continue" contract is preserved through `$exceptionHandler`.** A failing watcher / listener / async task is reported via the configured handler and the digest proceeds; only TTL exhaustion re-throws (after first reporting via the handler, cause `'$digest'`). The default handler is `console.error`, so today's logs continue to appear unchanged. A custom handler that itself throws is caught by `invokeExceptionHandler` and degrades to `console.error` — the digest still does not crash. The nine `EXCEPTION_HANDLER_CAUSES` tokens are part of the public contract; future specs that add framework-internal call sites must extend the list as a public-API change.
- **`$provide` is config-phase only** — the six methods (`factory`, `service`, `value`, `constant`, `provider`, `decorator`) throw synchronously with `$provide.<method> is only callable during the config phase; calling it after the run phase begins is not supported` whenever they're invoked outside a `config()` block, including via a `$provide` reference captured during config and called later. This out-of-phase error is a programming error and is **not** routed through `$exceptionHandler` — it surfaces directly to the caller. Constants are protected by an override guard: `value` / `factory` / `service` / `provider` / `decorator` (whether through the module DSL or `$provide`) targeting a name already registered as a `.constant` throw `Cannot override constant "<name>" — already registered via .constant(...)`. Within the unified registration timeline, a new producer recipe wipes prior producer entries for the same name from the other backing maps so the run-phase resolver returns the most-recent producer's value; decorators stack on the current producer and are NOT evicted.
- **Filters internally registered as `<name>Filter` providers.** `module.filter('currency', factory)` is functionally equivalent to `module.provider('currencyFilter', { $get: factory })` — `injector.get('currencyFilter') === $filter('currency')` (same reference). The `<name>Filter` naming makes decorators work for free: `module.decorator('currencyFilter', ['$delegate', …])` wraps the underlying filter and is visible through both lookup paths. The `$stateful = true` flag on a filter function (not the factory) opts the filter out of the digest's input-identity short-circuit; all nine built-ins are stateless. `$locale` is a single `module.factory('$locale', () => myLocale)` swap — `currency`/`number`/`date` read it lazily on each invocation, so config-time replacement takes immediate effect at run-time. Unknown filters surface as `Unknown filter: <name>` (a `FilterLookupError` instance) routed through `$exceptionHandler` with cause `'$filter'` at digest time; the digest continues. `parse(expr)` conservatively marks any filter-containing expression as `constant: false` at parse time; scope re-checks at watch install once `$filter` is reachable, upgrading to a constant-watch when the input/args are structurally constant AND no filter in the chain is `$stateful`.
- **Directive registration accumulates per name (no last-wins).** Two `$compileProvider.directive('foo', factoryA)` + `.directive('foo', factoryB)` calls produce TWO directives that both run on `<div foo>`. Mirrors AngularJS exactly. For services / filters / providers the rule is last-wins; for directives it is accumulation. Internally each name is a `<name>Directive` provider whose `$get` returns the array of normalized directive objects, so `injector.get('fooDirective')` returns both factories' resolved entries. Decorators on `<name>Directive` wrap the WHOLE array — the `$delegate` is the array, and the decorator may filter or wrap individual entries.
- **Compile-phase mutation runs once per template.** Compile fns run during the walker's recursive descent and return link functions; the same compiled subtree can be linked against different scopes by re-invoking the linker, but compile runs exactly once. Directives that need template-time DOM mutation (adding classes, setting attributes that affect child compilation) put it in `compile`, not `link`. The `Attributes` instance is created during compile and shared across every link invocation — state stored on `attrs` (e.g. observers from `$observe`) accumulates across linker calls, so re-linking the same template against multiple scopes is supported but uncommon.
- **`$observe` lazily installs the per-attribute watch on first observer registration.** A directive that calls `attrs.$observe('href', fn)` triggers `$interpolate(attrs.href, true)` exactly once; if interpolated, a single `scope.$watch(interpolateFn, listener)` is installed and reused for all subsequent observers of the same attribute name. Static attributes get a one-shot `$evalAsync` notification per observer — no watch is wired. Without `$observe` registrations, no per-attribute watches exist at all, so an element with hundreds of static-looking attributes costs zero digest time.
- **`'$compile'` cause token is the 10th `EXCEPTION_HANDLER_CAUSES` entry.** Public-API additive change introduced in spec 017 (the `'$filter'` precedent from spec 016 is the prior pattern). Used for directive factory invocation (lazy at `<name>Directive` provider `$get`), compile, pre-link, post-link, and the `$set`-driven `$observe` callback notification path. The static-attribute `$observe` first-fire (scheduled via `$evalAsync`) routes through the standard `'$evalAsync'` cause — both surfaces are documented and tested.
- **Isolate scope intentionally rejected at registration.** `scope: { foo: '=' }` (or any object form) throws `IsolateScopeNotSupportedError` lazily when the `<name>Directive` provider's `$get` runs, routed via `$exceptionHandler('$compile')`. The rejection is a deliberate forward-compat seam — a future spec will lift it without a silent semantic change. `scope: false` (default) and `scope: true` (one child scope per element via `parent.$new()`) are the only supported forms.
- **Raw `Element` argument is the deliberate choice.** No jqLite shim ships in spec 017; the link signature is `(scope, element, attrs)` where `element` is a native `Element` — or a `Comment` for an M-restricted match. The Phase 5 `angular.element` compat layer may layer on top without changing the link signature, so directives written today against raw `Element` will keep working when jqLite-style sugar lands.
- **Child-scope cleanup via private element properties.** When `scope: true` is requested, the compiler stashes the child scope on `(element as any).$$ngScope` and lets directives push cleanup callbacks onto `(element as any).$$ngCleanupQueue` — both non-enumerable. Future structural directives (`ng-if`, `ng-repeat`, …) MUST call `destroyElementScope(element)` before removing nodes; there is no `MutationObserver` or auto-detection. Without that call, removed-subtree scopes stay attached to the parent's watcher tree forever.

## Coding conventions

- **TypeScript strict** (`strict: true` + `noUncheckedIndexedAccess`). No `any` — the single existing cast in `src/core/utils.ts:229` is the ceiling, not a precedent.
- **Every `eslint-disable` comment must carry an inline justification** (`-- reason`). CI enforces lint.
- **No explicit return types** when TS inference handles them — let inference do the work. Annotate only on exported public-API boundaries where the declared shape is part of the contract.
- **Imports**: use path aliases (`@core`, `@parser`, `@di`, `@compiler`). `no-restricted-imports` blocks `../*` relative climbing.
- **File naming**: kebab-case (`scope-watch-delegates.ts`, `ast-flags.ts`). Tests under `src/<module>/__tests__/*.test.ts`.
- **File size target**: under 500 lines per source file. Refactor candidates today: `src/core/scope.ts` (827), `src/di/module.ts` (776), `src/di/injector.ts` (734).

## Git + spec workflow

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`). Reference the spec in feat commits, e.g. `feat: implement unary operators in expression parser (spec 009 slice 1)`.
- Every feature runs through `context/spec/<NNN>-<slug>/` with the AWOS triad: `functional-spec.md`, `technical-considerations.md`, `tasks.md`.
- **Tick task checkboxes in the SAME commit as the implementation** — not after the fact. The co-modification of `tasks.md` + `src/` in one commit is the traceability signal the audit looks for.
- Sub-tasks in `tasks.md` must carry `**[Agent: name]**` annotations. Verification/test tasks go to `vitest-testing`; framework code to `typescript-framework`; build/packaging to `rollup-build`.
- AWOS slash commands live at `.claude/commands/awos/*.md`: `/awos:product`, `/awos:roadmap`, `/awos:architecture`, `/awos:spec`, `/awos:tech`, `/awos:tasks`, `/awos:implement`, `/awos:verify`, `/awos:hire`.

## Published-library notes

- `package.json` declares `main`, `module`, `types`, and a subpath `exports` map (`.`, `./core`, `./parser`, `./di`, `./compiler`, `./interpolate`, `./sce`, `./sanitize`, `./exception-handler`, `./filter`). Each build entry emits `.mjs`, `.cjs`, and `.d.ts` via Rollup.
- `packageManager` is pinned (`pnpm@10.6.2`), Node pinned via `.nvmrc`. `pnpm-lock.yaml` is committed.
- No runtime env vars (`process.env`) — this is a pure library.

## Where to look when…

| Question | File |
| --- | --- |
| How does the digest loop decide when to stop? | `src/core/scope.ts` — search for `ttl` and `dirty` |
| What AST node types exist? | `src/parser/ast.ts` + `src/parser/ast-flags.ts` |
| How are watch delegates selected? | `src/core/scope-watch-delegates.ts` |
| How does `$injector` resolve `$inject` arrays / minified fns? | `src/di/annotate.ts` |
| How are services registered from inside config blocks? | `src/di/provide.ts` (the injectable), `src/di/registration.ts` (the shared recipe handler) |
| How does `$sce` decide whether a resource URL is allowed? | `src/sce/resource-url-matcher.ts` |
| How is untrusted HTML scrubbed? | `src/sanitize/sanitize.ts` (factory) + `src/sanitize/sanitize-tokenizer.ts` (regex parser) |
| How do I swap `$sanitize` for DOMPurify? | `src/sanitize/README.md` (decorator pattern + ESM-first equivalent) |
| How is the `{{expr}}` single-binding rule for trusted contexts enforced? | `src/interpolate/interpolate.ts` — search for `strictTrustActive` |
| How are runtime errors routed? | `src/exception-handler/exception-handler.ts` (default + recursion guard); `src/core/scope.ts` (six digest call sites + TTL throw at the bottom of `$digest`); `src/interpolate/interpolate.ts` (render-time catch in the per-expression loop) |
| How is `<expr> \| filter` parsed? | `src/parser/ast.ts` — search for `filterChain` |
| How are filters registered from a module? | `src/filter/filter-provider.ts` (`$FilterProvider`) + `src/di/module.ts` (`.filter`) |
| How does the `date` filter format tokens? | `src/filter/format-date.ts` |
| How does `$compile` walk the tree? | `src/compiler/compile.ts` (recursive `compileNode` + per-element three-phase linker) |
| How does `$compileProvider` register directives? | `src/compiler/compile-provider.ts` (`directive(name, factory)` + object form + `<name>Directive` provider) |
| How are directive names normalized? | `src/compiler/directive-normalize.ts` (AngularJS-canonical `(x\|data)[:\-_]` prefix strip + camelize separators) |
| How does `attrs.$observe` wire into `$interpolate`? | `src/compiler/attributes.ts` (lazy classification cache + per-attribute `$watch`) |
| How is child-scope cleanup wired? | `src/compiler/cleanup.ts` (non-enumerable `$$ngScope` / `$$ngCleanupQueue` + `destroyElementScope`) |
| Why is a commit structured this way? | the corresponding `context/spec/<NNN>-*/` directory |
