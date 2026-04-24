# Product Roadmap: My Own AngularJS

_This roadmap outlines our strategic direction based on the product definition. It focuses on the "what" and "why," not the technical "how."_

---

### Phase 0 — Legacy Migration & Fresh Start

_Move existing code to a legacy folder, reimplement from scratch in clean TypeScript, validate parity, then remove legacy._

- [x] **Legacy Isolation**
  - [x] **Move Existing Code:** Relocate all current source files (`src/modules/Scope/`, `src/js_legacy/`, `src/util/`) into a `legacy/` folder for reference.
  - [x] **Move Existing Tests:** Relocate current test files (`src/__tests__/`) into `legacy/` alongside the source they test.
  - [x] **Set Up Fresh Project Structure:** Initialize a clean `src/` directory with the new TypeScript strict configuration, Vitest, and Rollup build pipeline.

- [x] **Basic CI Pipeline**
  - [x] **GitHub Actions Workflow:** Set up a CI workflow that runs on every push and pull request.
  - [x] **CI Steps:** Lint (ESLint) → Format Check (Prettier) → Type Check (tsc) → Test (Vitest) — all must pass before merge.

- [x] **Reimplement Existing Features (from scratch)**
  - [x] **Scopes & Digest Cycle:** Rewrite the full Scope module in clean TypeScript — `$watch`, `$watchGroup`, `$watchCollection`, `$digest`, `$apply`, `$eval`, `$evalAsync`, `$applyAsync`, scope hierarchy, events (`$on`, `$emit`, `$broadcast`), and lifecycle (`$new`, `$destroy`).
  - [x] **Expression Parser:** Rewrite the lexer, AST builder, and expression compiler in TypeScript with full type safety.
  - [x] **Utility Functions:** Rewrite helper/utility functions in TypeScript.

- [x] **Validate & Remove Legacy**
  - [x] **Test Parity:** Ensure all new implementations pass equivalent tests to the legacy code, using the original AngularJS test suite as reference.
  - [x] **Remove Legacy Folder:** Once parity is confirmed, delete the `legacy/` folder entirely.

---

### Phase 1 — Core Runtime Foundation

_Complete the essential building blocks that everything else depends on._

- [x] **Scopes & Digest Cycle (remaining)**
  - [x] **Phase tracking:** Implement `$beginPhase`, `$clearPhase`, and `$$postDigest` hooks.
  - [x] **TTL configuration:** Support configurable digest TTL and cycle detection.

- [x] **Dependency Injection**
  - [x] **Module System:** Implement `createModule()` / `getModule()` (ES module style) with support for dependencies between modules. (spec 007)
  - [x] **Injector:** Implement the injector with `invoke`, `get`, `has`, `annotate`, and support for `$inject` annotations and array-style DI. (spec 007)
  - [x] **Providers & Recipes:** Implement `provider`, `factory`, `service`, `value`, `constant`, and `decorator`. _(spec 007 covers `value`, `constant`, `factory`; `service`/`provider`/`decorator` deferred to spec 008)_
  - [x] **Config & Run Blocks:** Support module-level `config()` and `run()` lifecycle hooks. _(spec 008)_

---

### Phase 2 — Expressions, Filters & DOM

_The layer that connects the runtime to templates and the DOM._

- [ ] **Expressions & Parser**
  - [x] **Expression Parser:** Implement a full expression parser supporting property access, method calls, operators, literals, and assignments and all the supported features of AngularJS 1.x, integration with scope.
  - [x] **One-Time Bindings:** Support `::` prefix for expressions that unwatch after stabilization.
  - [x] **Interpolation:** Implement `$interpolate` service for `{{expression}}` resolution in strings and templates.

- [x] **Security ($sce)**
  - [x] **$sce Service:** Implement Strict Contextual Escaping with `trustAsHtml`, `trustAsUrl`, `trustAsResourceUrl`, `trustAsJs`, `trustAsCss`, `getTrusted`, and the security contexts.
  - [x] **$interpolate Integration:** Wire the `trustedContext` parameter on `$interpolate` to `$sce.getTrusted(...)` — resolves the `TODO(spec-$sce)` marker in `src/interpolate/interpolate.ts` left by spec 011.
  - [x] **$sceProvider:** Support config-phase `enabled(value?)` to toggle strict mode.

- [ ] **HTML Sanitization ($sanitize / ngSanitize)**
  - [ ] **Separate `ngSanitize` module:** Ship as a dedicated module, NOT part of core `ng`. Mirrors AngularJS 1.x `angular-sanitize.js` packaging so apps that don't need sanitization don't pay for its parser tables or attack surface. New `src/sanitize/` subpath + `@sanitize/*` alias + `./sanitize` in `package.json` exports and `rollup.config.mjs` entries, following the `./sce` / `./interpolate` layout.
  - [ ] **ESM-first `createSanitize` / `sanitize` factory:** Pure `(untrustedHtml: string) => string` pipeline with no DI dependency — usable standalone and via `$sanitize` DI registration. Follows the `createSce` / `sce` precedent.
  - [ ] **`$sanitize` service + `$SanitizeProvider`:** DI-layer thin shim registered on `ngSanitize`; provider owns only the allow-list extensions (see below). `$get` depends on the ESM factory — zero duplicate logic.
  - [ ] **HTML parser + tag allow-list:** Token-walker with a fixed whitelist of safe block/inline tags (`div`, `span`, `p`, `h1`–`h6`, `ul`, `ol`, `li`, `a`, `b`, `i`, `em`, `strong`, `br`, `img`, `table`/`tr`/`td`, etc.). Disallowed tags (`script`, `iframe`, `object`, `embed`, `style`, `svg` by default, …) and their contents are dropped; text content is preserved and entity-escaped.
  - [ ] **Attribute allow-list per tag:** Fixed whitelist (`href`, `src`, `alt`, `title`, `class`, `id`, …) with tag-specific constraints (e.g. `target` only on `<a>`). Disallowed attributes (including all `on*` event handlers) are stripped.
  - [ ] **URL-protocol safe-list for `href` / `src`:** Same allow-list regex used by `$compileProvider.aHrefSanitizationTrustedUrlList` — defaults to `/^\s*(https?|s?ftp|mailto|tel|file):/` plus relative URLs. `javascript:` and dangerous `data:` URIs are stripped. Configurable via `$sanitizeProvider.addValidAttrs` / `.addValidElements` extensions.
  - [ ] **`$sce.getTrustedHtml` fallback integration:** When a value reaches `$sce.getTrustedHtml(...)` WITHOUT being wrapped AND `$sanitize` is available on the injector, delegate to `$sanitize(value)` instead of throwing. Keeps the spec-012 strict-mode contract intact (plain strings still throw when `$sanitize` isn't loaded) and matches AngularJS 1.x `ng-bind-html` behavior. Small coordination edit in `src/sce/sce.ts` gated behind an optional dependency lookup.
  - [ ] **`ng-bind-html` directive integration:** Lands with the Directives & DOM Compilation roadmap item below — `ng-bind-html="expr"` evaluates `expr`, runs through `$sce.getTrustedHtml` (which now routes to `$sanitize` when appropriate), and sets `innerHTML`.
  - [ ] **AngularJS parity tests + documented CVE regressions:** Port test vectors from `angular/angular.js/test/ngSanitize/sanitizeSpec.js`. Include a dedicated mXSS-regression suite covering each historical `ngSanitize` CVE (tag confusion, attribute-context breaks, etc.) so future edits can't regress.
  - [ ] **DOMPurify-compat escape hatch:** Document how to swap the built-in implementation for DOMPurify via a decorator (`.decorator('$sanitize', () => domPurifyBackedImpl)`). No hard dependency; purely a documented pattern so teams with stricter security posture can opt in.

- [ ] **Exception Handling ($exceptionHandler)**
  - [ ] **$exceptionHandler Service:** Default implementation that delegates to `console.error`; overridable via DI for custom logging / reporting.
  - [ ] **Digest Integration:** Route watch, listener, `$evalAsync`, and `$applyAsync` exceptions through `$exceptionHandler` instead of the current inline `console.error` in `src/core/scope.ts` — resolves the runtime-error deferral from spec 011 §2.10.
  - [ ] **$interpolate Integration:** Route render-time expression exceptions through `$exceptionHandler` when an interpolation fn is used inside a digest.

- [ ] **Filters**
  - [ ] **Filter Registration & Pipeline:** Implement the filter system with `$filterProvider` and chained filter expressions.
  - [ ] **Module DSL `.filter(name, factory)`:** Expose `.filter` on `createModule(...)` as a thin wrapper over `$filterProvider.register` — ng-module parity, shared registry, no duplicated state.
  - [ ] **Built-in Filters:** Implement core filters (`filter`, `orderBy`, `limitTo`, `currency`, `number`, `date`, `uppercase`, `lowercase`, `json`).

- [ ] **Directives & DOM Compilation**
  - [ ] **Compiler ($compile):** Implement directive collection, sorting by priority, and terminal directives.
  - [ ] **Linking (Pre & Post):** Implement the compile-link separation with pre-link and post-link functions.
  - [ ] **Transclusion:** Support basic and multi-slot transclusion.
  - [ ] **Template Loading:** Support inline templates and `templateUrl` with async loading.
  - [ ] **Controllers ($controller):** Implement `$controller` service and `$controllerProvider.register` so named controllers can be instantiated by the compiler and bound to scopes.
  - [ ] **Module DSL `.directive` / `.component` / `.controller`:** Expose `.directive(name, fn)`, `.component(name, def)` (AngularJS 1.5+ sugar), and `.controller(name, fn)` on `createModule(...)` as thin wrappers over `$compileProvider.directive` / `.component` and `$controllerProvider.register` — ng-module parity, shared registries, no duplicated state.
  - [ ] **Built-in Directives:** Implement the full AngularJS 1.x core-directive surface (sourced from `angular/angular.js/src/ng/directive/*`). Form-element directives (`form`, `input`, `select`, `textarea`) and `ng-model` live under Forms & Validation in Phase 3.
    - [ ] **Structural / flow control:** `ng-if`, `ng-repeat`, `ng-switch` (plus `ng-switch-when`, `ng-switch-default`), `ng-include`, `ng-transclude`, `ng-init`, `ng-controller`.
    - [ ] **Visibility:** `ng-show`, `ng-hide`, `ng-cloak`.
    - [ ] **Binding:** `ng-bind`, `ng-bind-template`, `ng-bind-html` (delegates to `$sce.getTrustedHtml`; falls back to `$sanitize` when `ngSanitize` is loaded), `ng-non-bindable`.
    - [ ] **Class / style:** `ng-class`, `ng-class-even`, `ng-class-odd`, `ng-style`.
    - [ ] **Attribute helpers (interpolation-safe booleans and URLs):** `ng-href`, `ng-src`, `ng-srcset`, `ng-disabled`, `ng-checked`, `ng-readonly`, `ng-selected`, `ng-open`.
    - [ ] **Mouse events:** `ng-click`, `ng-dblclick`, `ng-mousedown`, `ng-mouseup`, `ng-mouseover`, `ng-mouseout`, `ng-mousemove`, `ng-mouseenter`, `ng-mouseleave`.
    - [ ] **Keyboard events:** `ng-keydown`, `ng-keyup`, `ng-keypress`.
    - [ ] **Clipboard / focus / form-lifecycle events:** `ng-copy`, `ng-cut`, `ng-paste`, `ng-focus`, `ng-blur`, `ng-submit`.
    - [ ] **Pluralization / i18n:** `ng-pluralize`.
    - [ ] **CSP / template-cache / element overrides:** `ng-csp` (config-time CSP hint for the compiler), `ng-jq` (opt into a specific jqLite implementation), `ng-ref` (1.7+; publishes a controller reference onto scope), `script` (registers `<script type="text/ng-template">` in `$templateCache`), `a` (empty-`href` guard + target-attribute safety for the anchor element).

- [ ] **Service Text Diagrams (Phase 2 wrap-up)**
  - [ ] **Per-service ASCII / text diagrams:** For each service shipped through Phase 2 (Scope & digest, Injector & module system, Parser, `$interpolate`, `$sce` / `$sceDelegate`, Filters, `$compile`, `$controller`, built-in directives), produce a text diagram that shows the inner working (collaborators and call order), the supported usage patterns (ES-module primary API vs. DI-layer API), and how to call the service from both paths (with minimal example snippets). Diagrams live under `context/diagrams/` (one file per service, kebab-case) and are linked from `CLAUDE.md` "Where to look when…".

- [ ] **Application Bootstrap**
  - [ ] **`bootstrapInjector(modules, config?)`:** Headless DI-only bootstrap — creates the injector from `[ngModule, ...userModules]`, no DOM, no `$compile`. Ships ahead of the DOM compiler so tests, SSR, CLI tools, and learning exercises can drive the runtime without a browser. Default `strictDi: true` (ESM + TypeScript context makes explicit `$inject` annotations idiomatic).
  - [ ] **`$rootScope` registration on `ngModule`:** Register `Scope.create()` as `$rootScope` via `.factory('$rootScope', () => Scope.create())` so `bootstrap` can resolve it and downstream services (`$watch` etc.) have a canonical root.
  - [ ] **`bootstrap(element, modules, config?)`:** DOM bootstrap composing `bootstrapInjector` + `$compile(element)($rootScope)` + `$rootScope.$apply()`. Returns `{ injector, rootScope, rootElement }` — typed result object; no hidden global state, no mandatory DOM data attachment. Ships WITH `$compile` (depends on it). Optional `attachToElement: true` flag for AngularJS-parity consumers who want `element.data('$injector', injector)`.
  - [ ] **`autoBootstrap(root?)` via `ng-app`:** Opt-in scanner that finds the first `ng-app` attribute in the subtree, resolves the named module, and calls `bootstrap`. Browser-only (no-op when `document` is unavailable). Honors the classic `ng-app`, `data-ng-app`, `ng:app`, `x-ng-app` prefix variants for migration parity.
  - [ ] **Type-safe injector return:** `bootstrap` / `bootstrapInjector` generics over the `modules` tuple so `result.injector.get('$sce')` has the correct return type — reuses the existing `MergeRegistries` machinery from `@di/di-types`.
  - [ ] **Module layout:** New `src/bootstrap/` subpath + `@bootstrap/*` alias + `./bootstrap` in `package.json` exports and `rollup.config.mjs` entries — mirrors the `./sce` / `./interpolate` pattern.

---

### Phase 3 — Services, HTTP & Forms

_High-level services that enable real application development._

- [ ] **Promises & Async**
  - [ ] **$q Promise Implementation:** Implement `$q` with `defer`, `resolve`, `reject`, `all`, `race`, and `when`.
  - [ ] **$timeout & $interval:** Implement digest-integrated timer services with cancellation support.

- [ ] **HTTP & Networking**
  - [ ] **$http Service:** Implement request methods (`GET`, `POST`, `PUT`, `DELETE`), default headers, and parameter serialization.
  - [ ] **Interceptors:** Support request/response interceptors and transformations.

- [ ] **Forms & Validation**
  - [ ] **ngModel:** Implement two-way data binding for form elements with `$viewValue` / `$modelValue` pipeline.
  - [ ] **Form-element directives:** Implement `form` and `ng-form` (nested-form support), `input` (with every HTML5 type: `text`, `number`, `email`, `url`, `date`, `datetime-local`, `time`, `week`, `month`, `radio`, `checkbox`, `range`, `hidden`, `button`, `submit`, `reset`), `select`, `textarea`. Each form element registers itself with the enclosing `FormController`.
  - [ ] **ngModel helpers:** Implement `ng-model-options` (debounce, `updateOn`, `getterSetter`, timezone, etc.), `ng-options` (typed `<option>` generation for `<select>`), `ng-list` (comma-separated-list viewValue ↔ array modelValue transformation), `ng-change` (on-`$viewValue`-change callback).
  - [ ] **Form & NgModelController:** Implement `$dirty`, `$pristine`, `$valid`, `$invalid`, `$touched`, `$untouched` state tracking.
  - [ ] **Built-in Validators:** Implement `required` (also available as the `ng-required` attribute directive), `minlength`, `maxlength`, `pattern`, `email`, `number`, `url`.
  - [ ] **Custom Validators:** Support `$validators` and `$asyncValidators` pipeline.

---

### Phase 4 — Routing, Animations & Polish

_Features that complete the full framework experience._

- [ ] **Routing**
  - [ ] **$routeProvider:** Implement route configuration with `when`, `otherwise`, and parameterized URL patterns.
  - [ ] **ng-view:** Implement the view directive that renders route templates.
  - [ ] **Route Lifecycle:** Support `resolve`, route change events (`$routeChangeStart`, `$routeChangeSuccess`, `$routeChangeError`), and `$routeParams`.

- [ ] **Animations**
  - [ ] **$animate Service:** Implement animation hooks for `enter`, `leave`, `move`, `addClass`, `removeClass`.
  - [ ] **CSS Animations:** Support CSS transition and keyframe-based animations triggered by directive lifecycle.
  - [ ] **JavaScript Animations:** Support programmatic animation definitions via `$animateProvider.register`.
  - [ ] **Module DSL `.animation(name, fn)`:** Expose `.animation` on `createModule(...)` as a thin wrapper over `$animateProvider.register` — ng-module parity, shared registry, no duplicated state.

- [ ] **Package & Distribution**
  - [ ] **npm Package:** Bundle and publish as an installable npm package with full TypeScript type declarations.
  - [ ] **API Documentation:** Generate API docs from the typed source code.
  - [ ] **Examples Folder:** Create an `examples/` directory at the project root with working applications that consume the published library, demonstrating real-world AngularJS usage patterns.
    - [ ] **Basic Starter:** Minimal "Hello World" example showing scope binding, watchers, and the digest cycle.
    - [ ] **TodoMVC:** A full TodoMVC implementation — the standard framework showcase app — demonstrating directives, two-way binding, and filtering.
    - [ ] **Form Validation Demo:** A form with validation rules demonstrating `ngModel`, built-in and custom validators, and form state tracking (`$dirty`, `$valid`, etc.).
    - [ ] **SPA with Routing:** A multi-page single-page application using `$routeProvider`, `ng-view`, route parameters, and navigation.

---

### Phase 5 — AngularJS Compatibility Layer

_A final milestone that wraps the entire ES-module-first framework under a classic `angular` namespace, providing a familiar surface for developers migrating from original AngularJS 1.x._

Throughout Phases 0–4, every feature is built and exposed as ES module named exports (`Scope`, `parse`, `createModule`, `createInjector`, `$http`, etc.) — there is no global `angular` object during development. This final phase adds a compatibility layer that wraps all of those APIs under a single `angular` constant so that code written against the classic AngularJS 1.x API can run with minimal changes. The `createModule` DSL grows in-place during Phases 1–4 (each new registration method lands alongside its domain); `angular.module` in this phase is a thin alias over `createModule` / `getModule` and inherits the full DSL for free._

- [ ] **`angular` Namespace Constant**
  - [ ] **Core helpers:** Expose `angular.isString`, `angular.isNumber`, `angular.isArray`, `angular.isObject`, `angular.isFunction`, `angular.isDefined`, `angular.equals`, `angular.copy`, `angular.forEach`, `angular.extend`, `angular.noop` — all delegating to the existing typed utility functions.
  - [ ] **Module system (`angular.module`):** `angular.module(name, requires?)` — thin wrapper over `createModule` / `getModule`, sharing the same module registry (no duplicate state). The returned module object exposes the full AngularJS 1.x DSL:
    - `.provider`, `.factory`, `.service`, `.value`, `.constant`, `.decorator` — already available via `createModule` (spec 007–008).
    - `.config`, `.run` — already available via `createModule` (spec 008).
    - `.controller`, `.directive`, `.component`, `.filter` — wired into `createModule` during Phase 2 (alongside `$compileProvider`, `$controllerProvider`, `$filterProvider`); `angular.module` inherits them automatically.
    - `.animation` — wired into `createModule` during Phase 4 (alongside `$animateProvider`); inherited automatically.
    - `.info(infoObject?)` — **deferred**. Add if/when AngularJS 1.7+ module-info metadata is needed downstream; not in the initial parity surface.
  - [ ] **Injector:** `angular.injector(modules)` — thin wrapper over `createInjector`.
  - [ ] **Bootstrap:** `angular.bootstrap(element, modules, config?)` — DOM-based application startup using the existing injector and compiler.
  - [ ] **Element wrapper:** `angular.element` — a lightweight jqLite-style wrapper (or re-export jQuery if present).
  - [ ] **Version:** `angular.version` — compatibility version string.

- [ ] **Classic API Compatibility Tests**
  - [ ] **Snippet parity:** Run small classic AngularJS code snippets (from the official AngularJS docs) against the compatibility layer and verify they produce identical results.
  - [ ] **Migration guide:** Document which classic AngularJS APIs are supported, which are deferred, and any behavioral differences.

- [ ] **No Duplication**
  - [ ] **Thin wrapper only:** Every entry on the `angular` namespace must delegate to an existing ES module export. No duplicated implementation, no parallel registries, no additional state.
