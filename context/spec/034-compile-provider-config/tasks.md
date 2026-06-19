# Tasks: `$compileProvider` Configuration Methods

- **Specification:** `context/spec/034-compile-provider-config/`
- **Status:** Draft

---

- [x] **Slice 1: `commentDirectivesEnabled` / `cssClassDirectivesEnabled` (establishes the getter/setter + option-threading pattern)**
  - [x] Add `commentDirectivesEnabled(value?)` and `cssClassDirectivesEnabled(value?)` to `$CompileProvider` (`src/compiler/compile-provider.ts`), each backed by a `$$`-field defaulting to `true`. Setter validates boolean + returns `this` (chainable); no-arg returns the current value. Thread both values into `createCompile({…})` via new `CompileOptions` fields (`src/compiler/directive-types.ts`). **[Agent: typescript-framework]**
  - [x] Gate the two passes in `src/compiler/directive-collector.ts` `collectDirectives`: skip `collectCommentDirectives` when `commentDirectivesEnabled === false`, skip `collectClassDirectives` when `cssClassDirectivesEnabled === false`. Thread the flags from `CompileOptions` to the collector. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/compile-provider-config-directives.test.ts`: getter/setter semantics (arg → set + chainable; no-arg → returns current); `commentDirectivesEnabled(false)` makes a `<!-- directive: foo -->` (restrict `'M'`) directive no longer match; `cssClassDirectivesEnabled(false)` makes a class-form (restrict `'C'`) directive no longer match; both default `true` → match as today. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Spec 017 comment/class-directive suites green. **[Agent: rollup-build]**

- [x] **Slice 2: `aHrefSanitizationTrustedUrlList` / `imgSrcSanitizationTrustedUrlList` + compiler-level URL sanitizer**
  - [x] Create `src/compiler/sanitize-uri.ts` — `sanitizeUri(uri, isMediaUrl, pattern)`: returns the URI unchanged when it matches `pattern`, else prefixes `unsafe:` (AngularJS parity). Pure, unit-testable. **[Agent: typescript-framework]**
  - [x] Add `aHrefSanitizationTrustedUrlList(value?)` and `imgSrcSanitizationTrustedUrlList(value?)` to `$CompileProvider`, each backed by a `$$`-field defaulting to the **AngularJS-standard safe-URL regex** (allows `http(s)`/`ftp`/`mailto`/`tel`/`file` + relative; neutralizes `javascript:` + dangerous `data:`). Setter validates RegExp + returns `this`; no-arg returns current. Thread both into `createCompile` via `CompileOptions`. **[Agent: typescript-framework]**
  - [x] Wire `sanitizeUri` at the URL-attribute write path: the spec-031 interpolated-attribute write in `src/compiler/attributes.ts` and the spec-025 `ng-href`/`ng-src`/`ng-srcset` aliases in `src/compiler/ng-attribute-aliases.ts` route `a`/`area[href]` through the href pattern and `img[src]` (+ media) through the img pattern before writing the DOM attribute. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/sanitize-uri.test.ts` (unit) + extend integration coverage: `sanitizeUri` matches/prefixes correctly in isolation; default neutralizes `<a href="{{'javascript:alert(1)'}}">` (→ `unsafe:…`) and `<img ng-src>` with a dangerous URL; a safe URL passes through unchanged; a **custom** pattern set via the config method changes which URLs survive; getters return current. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **Regression gate:** spec 025 (`ng-href`/`ng-src`/`ng-srcset`) + spec 031 (interpolated `href`/`src`) suites green — safe URLs unchanged; update any assertion that relied on a dangerous URL passing through (document the intentional behavior change). **[Agent: rollup-build]**

- [x] **Slice 3: `strictComponentBindingsEnabled` + required-binding check**
  - [x] Add `strictComponentBindingsEnabled(value?)` to `$CompileProvider` (`$$`-field default `false`); thread into `createCompile`. Add `MissingComponentBindingError` to `src/compiler/compile-error.ts` (message names the missing binding + directive/component); re-export from `src/compiler/index.ts` + the root barrel. **[Agent: typescript-framework]**
  - [x] In `src/compiler/isolate-bindings.ts` `wireIsolateBindings`, when the strict flag is on, report `MissingComponentBindingError` via `$exceptionHandler('$compile')` for any non-optional binding (`<`/`=`/`@`/`&` without `?`) whose attribute is absent on the element. Default `false` → today's lenient degrade. Thread the flag from `CompileOptions` to the wiring site. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/strict-component-bindings.test.ts`: with it on, a `.component`/directive used without a required (non-`?`) binding routes `MissingComponentBindingError` via `'$compile'` naming the input; optional (`?`) bindings don't error; off (default) tolerates a missing binding; getter returns current. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Spec 022 (components/isolate scope) suite green. **[Agent: rollup-build]**

- [x] **Slice 4: `debugInfoEnabled` + debug-metadata attachment**
  - [x] Add `debugInfoEnabled(value?)` to `$CompileProvider` (`$$`-field default `true`); thread into `createCompile`. In `src/compiler/compile.ts`, when enabled, the per-element linker adds marker classes: `ng-scope` on elements that get a new (non-isolate) child scope, `ng-isolate-scope` on isolate-scope elements, and `ng-binding` on elements carrying an interpolation / `ng-bind` binding. Classes **append** (never replace) consumer classes. When disabled, none are added. Document `getElementScope` (`$$ngScope`) as the existing scope-inspection hook. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/debug-info.test.ts`: enabled (default) → `ng-scope` on a `scope: true` element, `ng-isolate-scope` on an isolate-scope component element, `ng-binding` on an interpolated/`ng-bind` element; `getElementScope` retrieves the scope; disabled → none of the marker classes appear; consumer classes preserved in both modes; getter returns current. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **Regression gate:** audit existing compiler tests for exact-`class`-attribute assertions — the new default-on markers append, but update any test that asserted a class attribute is absent/exact. **[Agent: rollup-build]**

- [x] **Slice 5: Docs & final regression**
  - [x] Update `src/compiler/README.md` — new "`$compileProvider` configuration methods (spec 034)" section: the six getter/setters, the compiler-level `sanitizeUri` (+ the AngularJS-default behavior change vs. today's pass-through), the comment/class toggles, strict component bindings, and the debug-info markers; worked `config(['$compileProvider', …])` example. **[Agent: typedoc-docs]**
  - [x] Update `CLAUDE.md`: amend the `./compiler` Modules row (add the six methods + `MissingComponentBindingError`); add "Non-obvious invariants" bullets — (a) the six config methods are config-phase getter/setters frozen at `$get`; (b) the new compiler-level `sanitizeUri` (`unsafe:` prefixing) is separate from `$sce`'s URL pass-through and **defaults to the AngularJS-standard pattern — a deliberate behavior change** neutralizing `javascript:`/dangerous-`data:` in `href`/`src`; (c) `debugInfoEnabled` (default on) attaches `ng-scope`/`ng-isolate-scope`/`ng-binding` markers; (d) `strictComponentBindingsEnabled` (default off) → `MissingComponentBindingError` via `'$compile'` (tuple stays at 10); add "Where to look when…" rows for `sanitize-uri.ts` and the config methods. Tick the spec-034 roadmap item in `context/product/roadmap.md`. **[Agent: typedoc-docs]**
  - [x] TSDoc audit on the new public surface (the six `$compileProvider` methods, `sanitizeUri`, `MissingComponentBindingError`), each with a runnable `@example`. **[Agent: typedoc-docs]**
  - [x] Final regression: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All five gates pass; full prior-spec suite (017–033) green; `EXCEPTION_HANDLER_CAUSES.length === 10` in source + built output; `MissingComponentBindingError` exported from both `dist` root entries. **[Agent: rollup-build]**

---

## Notes for the Implementation Agent

- **Config-phase only, frozen at `$get`.** The settings are read once when `$get` builds the `CompileService`; a config block mutating after `$get` has no effect (AngularJS parity).
- **One new error class, no new cause token.** `MissingComponentBindingError` routes via the existing `'$compile'`. `EXCEPTION_HANDLER_CAUSES` stays at 10.
- **URL-list default is a deliberate behavior change.** Defaulting to the AngularJS safe-URL pattern means `javascript:`/dangerous-`data:` URLs in `href`/`src` now get `unsafe:`-prefixed (they passed through before). This is intended — document it; the config method relaxes it.
- **`debugInfoEnabled` defaults on** and adds marker classes that **append** to consumer classes — never replace. Audit class-assertion tests.
- **Tick task checkboxes in the SAME commit as the implementation** per `CLAUDE.md`.
