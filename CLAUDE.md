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
| `./di` | Dependency injection | `createModule`, `createInjector`, `annotate` |
| `./interpolate` | String & template interpolation (`{{expr}}` resolution) | `createInterpolate`, `interpolate` (default), `InterpolateFn`, `InterpolateService`, `InterpolateOptions`, `ngModule` |
| `./sce` | Strict Contextual Escaping — trust wrappers for HTML / URL / resource URL / JS / CSS | `createSce`, `sce` (default), `createSceDelegate`, `sceDelegate`, `SCE_CONTEXTS`, `TrustedHtml`/`TrustedUrl`/`TrustedResourceUrl`/`TrustedJs`/`TrustedCss`, `isTrustedValue`, `isTrustedFor`, `isValidSceContext` |
| `./sanitize` | Opt-in HTML sanitization (companion to `$sce`) — parses + scrubs untrusted HTML against a fixed allow-list | `createSanitize`, `sanitize` (default), `$SanitizeProvider` (DI-only, not in root barrel), `ngSanitize`, `SanitizeService`, `SanitizeOptions`, `AddValidElementsArg` |
| `./compiler` | Reserved for future DOM compiler | empty barrel |

## Non-obvious invariants

- **No `new Function()` / no `eval()`** — the expression parser uses a **tree-walking interpreter** deliberately. This avoids CSP violations and is part of the project's security posture. Don't "optimize" by generating code strings.
- **Digest TTL contract** — configurable via `Scope.create({ ttl: 20 })` (default 10). TTL breach throws with the watch function source in the error to help identify unstable watchers.
- **One-time bindings & constant watches** (spec 010) — the parser attaches `literal` / `constant` / `oneTime` flags on AST nodes. Scope wires `oneTimeWatchDelegate` (literal) or `oneTimeLiteralWatchDelegate` for `::expr` expressions; constant expressions use `constantWatchDelegate`. When modifying the watcher wiring, preserve those delegate selections.
- **Module boundary rule** — `parser/*` and `di/*` depend only on `@core` (prefer importing from `@core/index`, not `@core/utils` directly). `core/scope.ts` intentionally depends on `@parser/index` because scopes evaluate expression strings. `compiler/` has no dependencies yet.
- **Error handling in digest** — listener/watch exceptions are logged with `console.error('...', e)` and the digest continues. Don't swallow silently and don't abort the digest loop on a single listener failure.
- **Strict mode is frozen after the config phase** — `$sceProvider.enabled(false)` is the only way to disable SCE. Once the injector finishes config, `$sce.isEnabled()` is permanent. Strict-OFF turns both `trustAs*` and `getTrusted*` into total pass-throughs (no wrapper classes are constructed).
- **Trusted values are per-context nominal classes** — `TrustedResourceUrl extends TrustedUrl`, so a trusted resource URL is accepted where a trusted URL is expected (not vice-versa). Identity is checked via `instanceof`, not a string-based brand. Do NOT "optimize" to a single branded wrapper — the subtype rule matters for AngularJS parity.
- **`ngSanitize` is opt-in, never registered on the core `ng` module** — apps must list `'ngSanitize'` in their dependency chain. When loaded, `$sce.getTrustedHtml(plainString)` automatically routes through `$sanitize` via a lazy `$injector.has('$sanitize')` lookup in `$SceProvider.$get` — no hard dependency from `$sce` to `ngSanitize`, no decoration. Removing the `$injector` dep from `$SceProvider.$get` would silently break this integration; the regression test in `src/sanitize/__tests__/sanitize-sce.test.ts` is the guard.

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

- `package.json` declares `main`, `module`, `types`, and a subpath `exports` map (`.`, `./core`, `./parser`, `./di`, `./compiler`, `./interpolate`, `./sce`, `./sanitize`). Each build entry emits `.mjs`, `.cjs`, and `.d.ts` via Rollup.
- `packageManager` is pinned (`pnpm@10.6.2`), Node pinned via `.nvmrc`. `pnpm-lock.yaml` is committed.
- No runtime env vars (`process.env`) — this is a pure library.

## Where to look when…

| Question | File |
| --- | --- |
| How does the digest loop decide when to stop? | `src/core/scope.ts` — search for `ttl` and `dirty` |
| What AST node types exist? | `src/parser/ast.ts` + `src/parser/ast-flags.ts` |
| How are watch delegates selected? | `src/core/scope-watch-delegates.ts` |
| How does `$injector` resolve `$inject` arrays / minified fns? | `src/di/annotate.ts` |
| How does `$sce` decide whether a resource URL is allowed? | `src/sce/resource-url-matcher.ts` |
| How is untrusted HTML scrubbed? | `src/sanitize/sanitize.ts` (factory) + `src/sanitize/sanitize-tokenizer.ts` (regex parser) |
| How do I swap `$sanitize` for DOMPurify? | `src/sanitize/README.md` (decorator pattern + ESM-first equivalent) |
| How is the `{{expr}}` single-binding rule for trusted contexts enforced? | `src/interpolate/interpolate.ts` — search for `strictTrustActive` |
| Why is a commit structured this way? | the corresponding `context/spec/<NNN>-*/` directory |
