# System Architecture Overview: My Own AngularJS

---

## 1. Application & Technology Stack

- **Language:** TypeScript 6.x with strict mode (`strict`, `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess`)
- **Module System:** Dual ESM + CommonJS output for maximum consumer compatibility
- **Bundler:** Rollup — mature library bundler with excellent tree-shaking and multi-format output support
- **Runtime Target:** Modern evergreen browsers (Chrome, Firefox, Safari, Edge — latest 2 versions)
- **Package Structure:** Single package with all modules in `src/` — one unified `my-own-angularjs` npm package

### Public API Convention: ES Module Named Exports

All public APIs are exposed exclusively as ES module named exports. The framework does **not** ship a global `angular` namespace constant as its primary interface — consumers import the functions and classes they need directly:

```typescript
import { Scope } from 'my-own-angularjs';
import { parse } from 'my-own-angularjs';
import { createModule, getModule, createInjector } from 'my-own-angularjs/di';
```

**Rationale:**

- Consistent with modern TypeScript library conventions
- Better tree-shaking — consumers only pay for what they import
- Clearer dependency graphs and IDE auto-imports
- No hidden global state

**AngularJS compatibility layer (future milestone):** A dedicated roadmap item will add an `angular` constant that wraps all the ES module APIs (`angular.module()`, `angular.injector()`, etc.) for users migrating from classic AngularJS. This compatibility layer will be a thin wrapper — it will not duplicate any logic or maintain a separate registry. See the final phase of the roadmap for details.

### Module DSL Growth & Shared Registries (Invariant)

`createModule(name, requires?)` returns a module object whose registration DSL grows **in-place** as new domains come online. Each domain provider owns exactly one registry, and the corresponding module-DSL method is a thin alias onto that provider:

| Module DSL method                                                             | Underlying provider / service               | Lands in                                 |
|-------------------------------------------------------------------------------|---------------------------------------------|------------------------------------------|
| `.provider` / `.factory` / `.service` / `.value` / `.constant` / `.decorator` | `$provide`                                  | Phase 1 (already shipped — spec 007–008) |
| `.config` / `.run`                                                            | module lifecycle                            | Phase 1 (already shipped — spec 008)     |
| `.controller`                                                                 | `$controllerProvider.register`              | Phase 2 (with `$compile`)                |
| `.directive` / `.component`                                                   | `$compileProvider.directive` / `.component` | Phase 2 (with `$compile`)                |
| `.filter`                                                                     | `$filterProvider.register`                  | Phase 2 (with filter pipeline)           |
| `.animation`                                                                  | `$animateProvider.register`                 | Phase 4 (with `$animate`)                |

**Invariants:**

- **One registry per domain.** No parallel stores, no shadow state. A registration method that can't thin-wrap a provider is not allowed.
- **No API fork for compatibility.** When `angular.module` lands in Phase 5, it is a thin alias over `createModule` / `getModule` sharing the same module registry — it inherits the full DSL above automatically.
- **Domain phase owns the DSL method.** A new registration method ships in the same phase/spec as the provider it wraps — not earlier, not later.

### ng-module Parity Surface

The project targets **full AngularJS 1.x `angular.module` parity**. Every classic registration call must run unchanged against the compat layer. `createModule` is the ESM-first primary API; `angular.module` is a Phase 5 alias — both point at the same module registry and the same DSL methods.

**Parity contract (ESM ↔ classic):**

```typescript
// ESM-first (primary API — available from Phase 1 and grows per the table above)
import { createModule, createInjector } from 'my-own-angularjs/di';

createModule('app', [])
  .constant('API_URL', '/api')
  .factory('userService', ['$http', ($http) => ({ me: () => $http.get('/me') })])
  .controller('HomeCtrl', ['$scope', 'userService', ($scope, userService) => { /* … */ }])
  .directive('myWidget', () => ({ restrict: 'E', template: '<div>…</div>' }))
  .component('myPanel', { bindings: { title: '<' }, template: '<h1>{{$ctrl.title}}</h1>' })
  .filter('shout', () => (s: string) => s.toUpperCase() + '!')
  .animation('.fade', () => ({ enter: (el, done) => done() }))
  .config(['userServiceProvider', (p) => p.setRoot('/v2')])
  .run(['userService', (svc) => svc.me()]);

// Classic AngularJS 1.x (Phase 5 compat — identical semantics, identical registry)
import { angular } from 'my-own-angularjs';

angular.module('app', [])
  .constant('API_URL', '/api')
  .factory('userService', ['$http', ($http) => ({ me: () => $http.get('/me') })])
  .controller('HomeCtrl', ['$scope', 'userService', ($scope, userService) => { /* … */ }])
  .directive('myWidget', () => ({ restrict: 'E', template: '<div>…</div>' }))
  .component('myPanel', { bindings: { title: '<' }, template: '<h1>{{$ctrl.title}}</h1>' })
  .filter('shout', () => (s: string) => s.toUpperCase() + '!')
  .animation('.fade', () => ({ enter: (el, done) => done() }))
  .config(['userServiceProvider', (p) => p.setRoot('/v2')])
  .run(['userService', (svc) => svc.me()]);
```

**Parity scope:**

- **In scope:** the full method surface above, module `requires` chain, `config` / `run` phases, `angular.module(name)` retrieval (getter form), chainable returns.
- **In scope, deferred:** `.info(infoObject?)` (AngularJS 1.7+) — add only when downstream usage demands it.
- **Out of scope:** AngularJS internal hooks that were never part of the public `angular.module` surface (e.g. `$$invokeQueue` reflection, private `_runBlocks`).

**Type-safety lift over legacy AngularJS:** `createModule(...)` returns a typed module object; every registration method accepts typed factories and `$inject`-annotated arrays with matching parameter types. The `angular.module` compat alias preserves these types — classic code gets stricter typing for free without any source changes.

---

## 2. Testing & Quality Assurance

- **Test Framework:** Vitest — fast, TypeScript-native, with built-in coverage reporting
- **DOM Environment:** jsdom (via Vitest) — lightweight in-process DOM simulation for directive and compilation tests
- **Reference Implementation:** [angular/angular.js](https://github.com/angular/angular.js/) — the original AngularJS repository serves as the reference for feature behavior and test coverage. All unit tests should validate behavior parity with the original AngularJS test suite.
- **Linter:** ESLint with TypeScript parser and recommended rulesets
- **Formatter:** Prettier — enforced code formatting for consistency across the codebase
- **Coverage Target:** 90%+ on core modules (scopes, injector, compiler, parser)

---

## 3. Package & Distribution

- **Package Manager:** pnpm — fast, disk-efficient dependency management with strict resolution
- **Registry:** npm (public) — published as an installable npm package
- **Type Declarations:** Bundled `.d.ts` files generated from source via TypeScript compiler
- **Package Exports:** Dual `main` (CJS) and `module` (ESM) entry points with `exports` map in `package.json`
- **Versioning:** Semantic Versioning (SemVer)

---

## 4. CI/CD & Automation

- **CI Platform:** GitHub Actions — runs on every push and pull request
- **CI Pipeline:** Lint → Type Check → Test → Build → Coverage Report
- **Publish Workflow:** Automated npm publish on tagged releases via GitHub Actions
- **Branch Protection:** Required passing CI checks before merge to `master`

---

## 5. Development Tooling & DX

- **Editor Support:** Full TypeScript IntelliSense via `tsconfig.json` with strict settings
- **Pre-commit Hooks:** Husky + lint-staged for running linter and formatter on staged files
- **Documentation:** API docs generated from TypeScript source using TypeDoc
- **Scripts:** Standardized `pnpm` scripts for `build`, `test`, `lint`, `format`, and `dev`
