# System Architecture Overview: My Own AngularJS

---

## 1. Application & Technology Stack

- **Language:** TypeScript 5.x with strict mode (`strict`, `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess`)
- **Module System:** Dual ESM + CommonJS output for maximum consumer compatibility
- **Bundler:** Rollup — mature library bundler with excellent tree-shaking and multi-format output support
- **Runtime Target:** Modern evergreen browsers (Chrome, Firefox, Safari, Edge — latest 2 versions)
- **Package Structure:** Single package with all modules in `src/` — one unified `my-own-angularjs` npm package

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
