<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: Application Bootstrap

- **Functional Specification:** `context/spec/036-application-bootstrap/functional-spec.md`
- **Status:** Draft
- **Author(s):** AWOS tech workflow

---

## 1. High-Level Technical Approach

Add a new `src/bootstrap/` module exporting three ESM-first entry points — `bootstrapInjector` (headless), `bootstrap` (DOM), `autoBootstrap` (`ng-app` scan) — that **compose existing machinery** (`createInjector`, `ngModule`, `Scope.create`, `$compile`). No new runtime services or compiler features. Two small, additive touches to existing code are required: register `$rootScope` on `ngModule`, and extend `createInjector`'s existing seed seam to also seed `$rootElement` for the DOM path. Everything else lives behind the new subpath, mirroring the `./sce` / `./interpolate` layout (alias, `package.json` export, Rollup entry, vitest alias).

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 New module: `src/bootstrap/`

| File | Responsibility |
| --- | --- |
| `src/bootstrap/index.ts` | Barrel: `bootstrapInjector`, `bootstrap`, `autoBootstrap`, types |
| `src/bootstrap/bootstrap.ts` | The three entry points + shared module-list normalization |
| `src/bootstrap/element-marker.ts` | Non-enumerable `$$ngBootstrapped` element marker + double-bootstrap guard (mirrors the `cleanup.ts` `$$ngScope` pattern) |
| `src/bootstrap/bootstrap-error.ts` | Error classes (`AlreadyBootstrappedError`, `BootstrapTargetMissingError`, …) |
| `src/bootstrap/__tests__/*.test.ts` | Unit + parity tests (jsdom for DOM paths) |

### 2.2 Entry-point contracts

| Entry point | Signature (shape) | DOM? | Returns |
| --- | --- | --- | --- |
| `bootstrapInjector` | `(modules, config?) → Injector` | No | `Injector<MergeRegistries<…>>` |
| `bootstrap` | `(element, modules, config?) → result` | Yes | `{ injector, rootScope, rootElement }` |
| `autoBootstrap` | `(root?) → void` | Yes (browser) | `void` |

- **`modules`** accepts `(AnyModule | string)[]`. Strings are resolved via `getModule(name)` (throws `Module not found: <name>` today — reused). Normalization (resolve strings → objects, prepend `ngModule`) happens in the bootstrap layer, so `createInjector` stays object-only.
- **`config`**: `{ strictDi?: boolean; attachToElement?: boolean }`. `strictDi` defaults `true`.
- **Typed return:** the generic is over the statically-known **object** entries of `modules` (reusing `MergeRegistries` from `@di/di-types`); string-name entries resolve at runtime but contribute only the base registry to the type. Documented limitation.

### 2.3 `strictDi` semantics (parity-only, per decision)

`config.strictDi` is accepted and defaults to `true`. Because the injector is already strict by construction (`annotate` throws on any un-annotated function; **no source-parsing fallback** — an existing documented invariant), passing `false` does **not** enable a lenient mode. The value is threaded for API/roadmap parity and forward-compatibility; behavior stays strict regardless. This is called out in docs and asserted by a test (`strictDi: false` still rejects an un-annotated factory).

### 2.4 `$rootScope` registration (touch: `src/core/ng-module.ts`)

Register `$rootScope` on `ngModule` via `.factory('$rootScope', [() => Scope.create()])` (array-wrapped to satisfy strict `annotate`). Makes `$rootScope` a canonical, injector-resolvable singleton (FS 2.4). Widens the `ng` module's typed registry with `$rootScope: Scope`.

### 2.5 `$rootElement` seeding (touch: `src/di/injector.ts`)

The DOM path must make the started element injectable as `$rootElement` (AngularJS parity) without polluting the global module registry. Extend `createInjector`'s **existing seed seam** (the spot that already seeds `$injector` into `providerCache`, architecture.md) to accept an optional internal seed map and seed `$rootElement` when `bootstrap` provides it. `bootstrapInjector` (headless) does not seed it. No new global state; no registry collision on re-bootstrap.

### 2.6 Startup order (`bootstrap`, DOM path) — fixed, AngularJS-parity

1. Guard: throw `AlreadyBootstrappedError` if the element already carries the `$$ngBootstrapped` marker (2.8).
2. Normalize modules (resolve strings, prepend `ngModule`).
3. `createInjector(normalizedModules, { seed: { $rootElement: element } })` → runs config blocks, then run blocks.
4. Resolve `$rootScope`.
5. Stamp the `$$ngBootstrapped` marker on the element; if `attachToElement`, also attach `$injector` to the element (opt-in).
6. `$rootScope.$apply(() => $compile(element)($rootScope))` — first compile + digest.
7. Return `{ injector, rootScope, rootElement: element }`.

### 2.7 `autoBootstrap`

- Scans `root ?? document` for the first element (document order) bearing one of `ng-app`, `data-ng-app`, `ng:app`, `x-ng-app` (attribute forms only). Uses `querySelectorAll` over the four selectors, picks the document-order-first match.
- Reads the attribute value as the module name; calls `bootstrap(el, value ? [value] : [], config)`.
- No match → silent no-op. `document` undefined (non-browser) → no-op. (Both per FS 2.3.)

### 2.8 Double-bootstrap guard (`element-marker.ts`)

Non-enumerable `$$ngBootstrapped` marker set on the root element at step 5. The guard reads it at step 1 and throws `AlreadyBootstrappedError` ("App already bootstrapped with this element '<tag>'", parity with `ng:btstrpd`). Because attachment is opt-in (2.6 / FS 2.8), the marker — not an attached `$injector` — is the source of truth. An `autoBootstrap` landing inside an already-started region hits the same guard.

### 2.9 Errors (synchronous, per FS 2.5/2.6)

New error classes in `bootstrap-error.ts`, all **thrown synchronously** to the caller (no `$exceptionHandler` routing — consistent with this project's `$apply` having no try/catch): `AlreadyBootstrappedError`, `BootstrapTargetMissingError` (null/absent element). Unregistered-module errors reuse `getModule`'s existing `Module not found: <name>` throw. No new `EXCEPTION_HANDLER_CAUSES` token.

### 2.10 Packaging (mirror `./sce`)

- `tsconfig.json`: add `@bootstrap/*` path.
- `vitest.config.ts`: add `@bootstrap` alias.
- `package.json`: add `./bootstrap` to `exports`.
- `rollup.config.mjs`: add the `src/bootstrap/index.ts` entry (ESM + CJS + `.d.ts`).
- Root barrel (`src/index.ts`): re-export the three entry points + types.

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `@di` (`createInjector`, `getModule`, `MergeRegistries`), `@core` (`Scope.create`, `ngModule`), `@compiler` (`$compile` for the DOM path). The DOM path requires `$compile`; the headless path must not import it (keep the bundles separate so DOM-less consumers don't pay for the compiler).
- **Risks & Mitigations:**
  - _Touching `createInjector`_ (seed seam) could regress DI. **Mitigation:** additive optional param defaulting to no seed; full existing `@di` suite is the regression gate.
  - _`$rootScope` on `ngModule`_ — a new always-on factory. **Mitigation:** lazy factory (`Scope.create()` only on first `get`); verify no existing test assumed `$rootScope` absent.
  - _Typed-return erosion for string-name modules._ **Mitigation:** document that object entries drive typing; provide an object-list example as the recommended form.
  - _jsdom DOM-attach / `querySelectorAll` parity._ **Mitigation:** jsdom covers attributes + `element` data; tests assert all four `ng-app` spellings and first-wins ordering.
  - _Re-bootstrap registry pollution_ (the reason we seed rather than prepend a module). **Mitigation:** the seed seam avoids `createModule` entirely for `$rootElement`.

---

## 4. Testing Strategy

- **Unit (vitest, jsdom):** per entry point — headless `get` resolves framework + user services; page start renders + first-digest reflects data; `autoBootstrap` honors all four prefixes, first-in-document-order wins, silent no-op when absent / non-browser.
- **Parity tests:** double-bootstrap throws (`AlreadyBootstrappedError` ≈ `ng:btstrpd`); unregistered module throws naming it; missing target throws; `strictDi:false` still rejects an un-annotated factory (no-op-relax); `$rootElement` injectable on DOM path but not headless; `attachToElement` opt-in attaches `$injector`, default does not.
- **Typed-return:** type-level check that `bootstrapInjector([ngModule, app]).get('$sce')` narrows correctly (object-list form).
- **Coverage:** new `bootstrap` module held to the 90% line threshold (added to the per-module coverage set in `vitest.config.ts` if enumerated).
- **Gates:** `pnpm lint` / `format:check` / `typecheck` / `test` / `build` all green; full prior-spec suite green; `EXCEPTION_HANDLER_CAUSES.length` unchanged.
