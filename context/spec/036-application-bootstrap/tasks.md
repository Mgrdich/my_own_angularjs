# Tasks: Application Bootstrap

- **Specification:** `context/spec/036-application-bootstrap/`
- **Status:** Draft

---

- [x] **Slice 1: Headless `bootstrapInjector` + module packaging**
  - [x] Scaffold `src/bootstrap/`: create `index.ts` barrel and add packaging wiring — `@bootstrap/*` in `tsconfig.json`, `@bootstrap` alias in `vitest.config.ts`, `./bootstrap` in `package.json` `exports`, the `src/bootstrap/index.ts` entry in `rollup.config.mjs`, and a root-barrel re-export in `src/index.ts`. **[Agent: rollup-build]**
  - [x] Implement `bootstrapInjector(modules, config?)` in `src/bootstrap/bootstrap.ts`: normalize the `(AnyModule | string)[]` list (resolve string names via `getModule`, prepend `ngModule`), accept `config.strictDi` (default `true`, no-op-relax), return `createInjector(normalized)` typed via `MergeRegistries` over the object entries. **[Agent: typescript-framework]**
  - [x] Create `src/bootstrap/__tests__/bootstrap-injector.test.ts`: headless `get` resolves framework services (`$sce`) + a user module's service; string-name + object forms both work; unregistered module name throws `Module not found`; `strictDi:false` still rejects an un-annotated factory; no DOM accessed. Add a type-level check that `.get('$sce')` narrows. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. New `./bootstrap` entry emits ESM+CJS+`.d.ts`. **[Agent: rollup-build]**

- [x] **Slice 2: `$rootScope` on `ngModule`**
  - [x] Register `$rootScope` on `ngModule` (`src/core/ng-module.ts`) via `.factory('$rootScope', [() => Scope.create()])`; widen the `ng` typed registry with `$rootScope: Scope`. **[Agent: typescript-framework]**
  - [x] Extend `src/core/__tests__` (or a new `ng-module-rootscope.test.ts`): `injector.get('$rootScope')` returns a `Scope`, is a singleton (same ref across `get`), and `bootstrapInjector([...]).get('$rootScope')` resolves; confirm no prior test assumed `$rootScope` absent. **[Agent: vitest-testing]**
  - [x] Run all five gates; full `@core` + `@di` suites green. **[Agent: rollup-build]**

- [x] **Slice 3: `$rootElement` seed seam in `createInjector`**
  - [x] Extend `createInjector` (`src/di/injector.ts`) with an additive optional internal seed map (defaulting to none), seeding `$rootElement` into the same place `$injector` is seeded into `providerCache`. Headless callers pass nothing → behavior unchanged. **[Agent: typescript-framework]**
  - [x] Test (`src/di/__tests__/injector-seed.test.ts`): with a seed, `injector.get('$rootElement')` returns the seeded element; without, `$rootElement` is unknown/absent; `$injector` self-seed still works; no regression in module-load order. **[Agent: vitest-testing]**
  - [x] Run all five gates; full `@di` suite green. **[Agent: rollup-build]**

- [x] **Slice 4: DOM `bootstrap` + double-bootstrap guard + errors**
  - [x] Implement `src/bootstrap/element-marker.ts` (non-enumerable `$$ngBootstrapped` set/read, mirroring `cleanup.ts`) and `src/bootstrap/bootstrap-error.ts` (`AlreadyBootstrappedError`, `BootstrapTargetMissingError`); re-export errors from the barrel + root. **[Agent: typescript-framework]**
  - [x] Implement `bootstrap(element, modules, config?)`: the fixed 7-step order (guard → normalize → `createInjector` with `$rootElement` seed → resolve `$rootScope` → stamp marker (+ opt-in `attachToElement`) → `$rootScope.$apply(() => $compile(element)($rootScope))` → return `{ injector, rootScope, rootElement }`). Throw synchronously on null/missing target and on re-bootstrap. **[Agent: typescript-framework]**
  - [x] Create `src/bootstrap/__tests__/bootstrap-dom.test.ts` (jsdom): page start compiles + first digest reflects data (e.g. an interpolation renders); returns the `{ injector, rootScope, rootElement }` handle; `$rootScope` from handle === `injector.get('$rootScope')`; `$rootElement` injectable; default does NOT attach `$injector` to the element, `attachToElement:true` does; double-bootstrap throws `AlreadyBootstrappedError`; missing target throws `BootstrapTargetMissingError`. **[Agent: vitest-testing]**
  - [x] Run all five gates. **[Agent: rollup-build]**

- [x] **Slice 5: `autoBootstrap` (`ng-app` scan)**
  - [x] Implement `autoBootstrap(root?)`: scan `root ?? document` for the first (document-order) element bearing `ng-app` / `data-ng-app` / `ng:app` / `x-ng-app`; read the attribute value as the module name; delegate to `bootstrap`. Silent no-op when no match or when `document` is undefined. **[Agent: typescript-framework]**
  - [x] Create `src/bootstrap/__tests__/auto-bootstrap.test.ts` (jsdom): each of the four prefixes triggers a start; multiple markers → first in document order wins, rest ignored; no marker → silent no-op (nothing thrown, nothing rendered); non-browser (`document` undefined) → no-op; an `ng-app` nested inside an already-started region throws via the shared guard. **[Agent: vitest-testing]**
  - [x] Run all five gates. **[Agent: rollup-build]**

- [x] **Slice 6: Docs, coverage & final regression**
  - [x] Add `src/bootstrap/README.md` (the three entry points, the four `ng-app` spellings, the intentional deviations from §2.8, worked headless + DOM + auto examples). Update `CLAUDE.md` (`./bootstrap` Modules row + "Non-obvious invariants" bullets: strictDi no-op-relax, `$rootElement` seed seam, `$$ngBootstrapped` guard, synchronous throws) and the "Where to look when…" table. Tick the Application Bootstrap roadmap items in `context/product/roadmap.md`. **[Agent: typedoc-docs]**
  - [x] TSDoc audit on the new public surface (`bootstrapInjector`, `bootstrap`, `autoBootstrap`, the two error classes, the result type), each with a runnable `@example`. Add `bootstrap` to the per-module 90% coverage set in `vitest.config.ts` if modules are enumerated there. **[Agent: typedoc-docs]**
  - [x] Final regression: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` — all green; full prior-spec suite (017–035) green; `EXCEPTION_HANDLER_CAUSES.length` unchanged; `./bootstrap` exports resolve from both `dist` root entries. **[Agent: rollup-build]**

---

## Notes for the Implementation Agent

- **Keep the headless path free of `@compiler`** — only the DOM `bootstrap` / `autoBootstrap` paths may import `$compile`, so DOM-less consumers don't pull in the compiler.
- **`strictDi` is parity-only** — accepted, default `true`; `false` does not enable source-parsing (none exists). Document + test the no-op-relax.
- **The double-bootstrap guard uses the `$$ngBootstrapped` marker**, not an attached `$injector` (attachment is opt-in).
- **All bootstrap failures throw synchronously** — no `$exceptionHandler` routing; `EXCEPTION_HANDLER_CAUSES` tuple stays at 10.
- **Tick task checkboxes in the SAME commit as the implementation** per `CLAUDE.md`.
