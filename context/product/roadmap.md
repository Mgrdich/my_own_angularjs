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

- [ ] **Reimplement Existing Features (from scratch)**
  - [x] **Scopes & Digest Cycle:** Rewrite the full Scope module in clean TypeScript — `$watch`, `$watchGroup`, `$watchCollection`, `$digest`, `$apply`, `$eval`, `$evalAsync`, `$applyAsync`, scope hierarchy, events (`$on`, `$emit`, `$broadcast`), and lifecycle (`$new`, `$destroy`).
  - [ ] **Expression Parser:** Rewrite the lexer, AST builder, and expression compiler in TypeScript with full type safety.
  - [ ] **Utility Functions:** Rewrite helper/utility functions in TypeScript.

- [ ] **Validate & Remove Legacy**
  - [ ] **Test Parity:** Ensure all new implementations pass equivalent tests to the legacy code, using the original AngularJS test suite as reference.
  - [ ] **Remove Legacy Folder:** Once parity is confirmed, delete the `legacy/` folder entirely.

---

### Phase 1 — Core Runtime Foundation

_Complete the essential building blocks that everything else depends on._

- [ ] **Scopes & Digest Cycle (remaining)**
  - [ ] **Phase tracking:** Implement `$beginPhase`, `$clearPhase`, and `$$postDigest` hooks.
  - [ ] **TTL configuration:** Support configurable digest TTL and cycle detection.

- [ ] **Dependency Injection**
  - [ ] **Module System:** Implement `angular.module()` with support for dependencies between modules.
  - [ ] **Injector:** Implement the injector with `invoke`, `get`, `has`, `annotate`, and support for `$inject` annotations and array-style DI.
  - [ ] **Providers & Recipes:** Implement `provider`, `factory`, `service`, `value`, `constant`, and `decorator`.
  - [ ] **Config & Run Blocks:** Support module-level `config()` and `run()` lifecycle hooks.

---

### Phase 2 — Expressions, Filters & DOM

_The layer that connects the runtime to templates and the DOM._

- [ ] **Expressions & Parser**
  - [ ] **Expression Parser:** Implement a full expression parser supporting property access, method calls, operators, literals, and assignments and all the supported features of AngularJS 1.x, integration with scope.
  - [ ] **One-Time Bindings:** Support `::` prefix for expressions that unwatch after stabilization.
  - [ ] **Interpolation:** Implement `$interpolate` service for `{{expression}}` resolution in strings and templates.

- [ ] **Filters**
  - [ ] **Filter Registration & Pipeline:** Implement the filter system with `$filterProvider` and chained filter expressions.
  - [ ] **Built-in Filters:** Implement core filters (`filter`, `orderBy`, `limitTo`, `currency`, `number`, `date`, `uppercase`, `lowercase`, `json`).

- [ ] **Directives & DOM Compilation**
  - [ ] **Compiler ($compile):** Implement directive collection, sorting by priority, and terminal directives.
  - [ ] **Linking (Pre & Post):** Implement the compile-link separation with pre-link and post-link functions.
  - [ ] **Transclusion:** Support basic and multi-slot transclusion.
  - [ ] **Template Loading:** Support inline templates and `templateUrl` with async loading.
  - [ ] **Built-in Directives:** Implement `ng-if`, `ng-show`, `ng-hide`, `ng-repeat`, `ng-class`, `ng-style`, `ng-click`, `ng-bind`, `ng-switch`, `ng-include`.

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
  - [ ] **Form & NgModelController:** Implement `$dirty`, `$pristine`, `$valid`, `$invalid`, `$touched`, `$untouched` state tracking.
  - [ ] **Built-in Validators:** Implement `required`, `minlength`, `maxlength`, `pattern`, `email`, `number`, `url`.
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
  - [ ] **JavaScript Animations:** Support programmatic animation definitions via `.animation()`.

- [ ] **Package & Distribution**
  - [ ] **npm Package:** Bundle and publish as an installable npm package with full TypeScript type declarations.
  - [ ] **API Documentation:** Generate API docs from the typed source code.
  - [ ] **Examples Folder:** Create an `examples/` directory at the project root with working applications that consume the published library, demonstrating real-world AngularJS usage patterns.
    - [ ] **Basic Starter:** Minimal "Hello World" example showing scope binding, watchers, and the digest cycle.
    - [ ] **TodoMVC:** A full TodoMVC implementation — the standard framework showcase app — demonstrating directives, two-way binding, and filtering.
    - [ ] **Form Validation Demo:** A form with validation rules demonstrating `ngModel`, built-in and custom validators, and form state tracking (`$dirty`, `$valid`, etc.).
    - [ ] **SPA with Routing:** A multi-page single-page application using `$routeProvider`, `ng-view`, route parameters, and navigation.
