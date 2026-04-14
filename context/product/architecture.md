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
