# Functional Specification: Legacy Isolation & Fresh Project Setup

- **Roadmap Item:** Phase 0 — Legacy Migration & Fresh Start > Legacy Isolation
- **Status:** Completed
- **Author:** Poe (AI Assistant)

---

## 1. Overview and Rationale (The "Why")

The project currently has existing JavaScript and TypeScript implementations of Scopes (`src/modules/Scope/`, `src/js_legacy/Scope.js`), an expression parser (`src/js_legacy/parse.js`), and utility functions (`src/util/`). These were built as learning exercises but do not follow the target architecture (TypeScript 5.x strict, Vitest, Rollup, pnpm).

Before any new feature work can begin, the existing code must be isolated into a `legacy/` folder for reference, and the project must be re-initialized with a clean structure, modern tooling, and the target architecture. The legacy code serves only as a behavioral reference — it does not need to remain runnable. Once new implementations achieve parity, the legacy folder will be deleted (git history preserves the original code).

**Success criteria:** A developer can clone the repo, run `pnpm install`, and immediately begin writing new TypeScript modules with Vitest tests, Rollup builds, ESLint linting, and Prettier formatting — all working out of the box.

---

## 2. Functional Requirements (The "What")

### 2.1. Move Existing Code to Legacy Folder

- All existing source files must be relocated to a `legacy/` directory at the project root, preserving their original relative paths.
  - **Acceptance Criteria:**
    - [x] `src/modules/Scope/` moves to `legacy/src/modules/Scope/`
    - [x] `src/js_legacy/` moves to `legacy/src/js_legacy/`
    - [x] `src/util/` moves to `legacy/src/util/`
    - [x] `src/__tests__/` moves to `legacy/src/__tests__/`
    - [x] No source files remain in `src/` after migration
    - [x] The `legacy/` folder is committed to git

### 2.2. Move Existing Tests to Legacy Folder

- All existing test files must be relocated alongside their source within `legacy/`.
  - **Acceptance Criteria:**
    - [x] All Jest test files (`.test.ts`, `.test.js`) are inside `legacy/`
    - [x] Legacy tests are for reading/reference only — they do not need to be runnable

### 2.3. Set Up Fresh Project Structure

- Initialize a clean `src/` directory organized by architectural layer.
  - **Acceptance Criteria:**
    - [x] `src/core/` directory exists (for scope, digest cycle modules)
    - [x] `src/di/` directory exists (for dependency injection modules)
    - [x] `src/compiler/` directory exists (for directives, compilation)
    - [x] `src/parser/` directory exists (for expression parser, filters)
    - [x] `src/index.ts` exists as a barrel export file
    - [x] Each layer folder contains an `index.ts` for subpath exports

### 2.4. Replace Build and Test Tooling

- Remove all existing Jest configuration and old build scripts. Set up the target toolchain from scratch.
  - **Acceptance Criteria:**
    - [x] Jest is removed from `devDependencies` and all Jest config files are deleted
    - [x] Vitest is installed and configured with jsdom environment
    - [x] Rollup is installed and configured for dual ESM + CJS output
    - [x] ESLint is installed with TypeScript parser and recommended rules
    - [x] Prettier is installed with a `.prettierrc` configuration
    - [x] TypeScript `tsconfig.json` is configured with strict mode (`strict`, `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess`)
    - [x] pnpm is the package manager (lockfile is `pnpm-lock.yaml`)
    - [x] Old `package-lock.json` or `yarn.lock` files are removed if present

### 2.5. Set Up Development Scripts

- Standardized scripts must be available for all common workflows.
  - **Acceptance Criteria:**
    - [x] `pnpm build` — compiles TypeScript and bundles with Rollup
    - [x] `pnpm test` — runs Vitest test suite
    - [x] `pnpm lint` — runs ESLint on all TypeScript files
    - [x] `pnpm format` — runs Prettier on the codebase
    - [x] `pnpm dev` — runs Vitest in watch mode for development
    - [x] All scripts execute successfully on a clean checkout after `pnpm install`

### 2.6. Set Up Basic CI Pipeline

- A GitHub Actions workflow must run on every push and pull request to enforce code quality from day one. This should be set up as soon as tooling and scripts are in place, before any new code is written.
  - **Acceptance Criteria:**
    - [x] A workflow file exists at `.github/workflows/ci.yml`
    - [x] The workflow triggers on `push` and `pull_request` events
    - [x] The workflow runs the following steps in order: Lint (ESLint) → Format Check (Prettier `--check`) → Type Check (`tsc --noEmit`) → Test (Vitest)
    - [x] All four steps must pass for the workflow to succeed
    - [x] The workflow uses `pnpm` for dependency installation
    - [x] The workflow runs on `ubuntu-latest` with a current Node.js LTS version

### 2.7. Configure Package Exports

- The package must support both a single barrel import and per-module subpath imports.
  - **Acceptance Criteria:**
    - [x] `package.json` has an `exports` map with `"."` pointing to `src/index.ts` (built output)
    - [x] `package.json` has subpath exports: `"./core"`, `"./di"`, `"./compiler"`, `"./parser"`
    - [x] Both ESM (`import`) and CJS (`require`) conditions are configured in exports
    - [x] Bundled `.d.ts` type declarations are generated for all entry points

---

## 3. Scope and Boundaries

### In-Scope

- Moving all existing source and test files to `legacy/`
- Removing Jest and old tooling configuration
- Setting up Vitest, Rollup, ESLint, Prettier, and TypeScript strict mode
- Creating the `src/` directory structure organized by layer
- Configuring `package.json` with dual exports and pnpm scripts
- Ensuring a clean, working development environment from scratch
- Setting up a basic GitHub Actions CI pipeline (lint, format check, type check, test)

### Out-of-Scope

- **Reimplement Existing Features** — reimplementing Scopes, Parser, or utilities in the new structure (separate roadmap item in Phase 0)
- **Validate & Remove Legacy** — testing parity and deleting `legacy/` (separate roadmap item in Phase 0)
- **Dependency Injection** — implementing modules, injector, providers (Phase 1)
- **Expressions & Parser** — implementing expression parser, filters (Phase 2)
- **Directives & DOM Compilation** — implementing compiler, linking (Phase 2)
- **HTTP, Routing, Forms, Animations** — all Phase 3 and Phase 4 items
- **Advanced CI/CD** — automated npm publishing, release workflows (will be addressed separately)
- **Pre-commit hooks** — Husky + lint-staged setup (will be addressed separately)
