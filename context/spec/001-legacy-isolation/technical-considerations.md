# Technical Specification: Legacy Isolation & Fresh Project Setup

- **Functional Specification:** `context/spec/001-legacy-isolation/functional-spec.md`
- **Status:** Draft
- **Author(s):** Poe (AI Assistant)

---

## 1. High-Level Technical Approach

This spec transforms the project from its current state (TypeScript 4.6, Jest, Webpack, npm) into the target architecture (TypeScript 6.x strict, Vitest, Rollup, pnpm, ESLint 9 flat config, Prettier 3). The work proceeds in six steps:

1. **Isolate legacy code** — `git mv` all `src/` contents into `legacy/src/` to preserve git history
2. **Remove old tooling** — delete Jest, Webpack, ts-jest, ts-loader, lodash, old ESLint plugins, and all associated config files
3. **Reinitialize tooling** — install and configure TypeScript 6.x strict, Vitest + jsdom, Rollup with dual ESM/CJS, ESLint 9 flat config, Prettier 3
4. **Create fresh src/ structure** — layered directories (`core/`, `di/`, `compiler/`, `parser/`) with barrel exports and subpath exports in `package.json`
5. **Set up CI** — new GitHub Actions workflow (`ci.yml`) running lint, format check, type check, and tests on Node 22 LTS
6. **Switch to pnpm** — remove `package-lock.json` and `yarn.lock`, generate `pnpm-lock.yaml`

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1. Legacy Code Migration

- Use `git mv` to relocate all files (preserves git blame/history):
  - `src/modules/` → `legacy/src/modules/`
  - `src/js_legacy/` → `legacy/src/js_legacy/`
  - `src/util/` → `legacy/src/util/`
  - `src/__tests__/` → `legacy/src/__tests__/`
  - `src/index.ts` → `legacy/src/index.ts`
  - `src/types/` → `legacy/src/types/`
- Also move to `legacy/`: `jest.config.js`, `.eslintrc`, `webpack.config.js` (if exists)
- Keep `.prettierrc` format preferences — they will be carried forward to the new config

### 2.2. Dependency Cleanup

**Remove (devDependencies):**
- Jest stack: `jest`, `@types/jest`, `ts-jest`
- Webpack stack: `webpack`, `webpack-cli`, `@webpack-cli/generators`, `ts-loader`, `clean-webpack-plugin`, `copy-webpack-plugin`, `declaration-bundler-webpack-plugin`, `@types/webpack`
- Old ESLint plugins: `@typescript-eslint/eslint-plugin@5`, `@typescript-eslint/parser@5`, `eslint@8`, `eslint-import-resolver-typescript`, `eslint-plugin-import`
- Old TypeScript: `typescript@4`
- Old Prettier: `prettier@2`

**Remove (dependencies):**
- `lodash`, `@types/node` (not needed for a browser library)

**Remove lock files:**
- `package-lock.json`
- `yarn.lock`

**Remove config files:**
- `jest.config.js` (moved to legacy)
- `.eslintrc` (moved to legacy, replaced by flat config)
- Any `webpack.config.*` files (moved to legacy)

### 2.3. New Tooling Installation

**devDependencies to install:**

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^6.0.2 | Language compiler, strict mode |
| `vitest` | ^4.1.3 | Test framework |
| `jsdom` | ^29.0.2 | DOM environment for Vitest |
| `rollup` | ^4.60.1 | Library bundler |
| `@rollup/plugin-typescript` | ^12.3.0 | TypeScript compilation in Rollup |
| `@rollup/plugin-node-resolve` | ^16.0.3 | Module resolution in Rollup |
| `rollup-plugin-dts` | ^6.4.1 | Bundle `.d.ts` declaration files |
| `eslint` | ^10.2.0 | Linter with flat config |
| `typescript-eslint` | ^8.58.1 | ESLint TypeScript integration |
| `prettier` | ^3.8.1 | Code formatter |
| `tslib` | ^2.8.1 | TypeScript runtime helpers (importHelpers) |

**No runtime dependencies** — the package ships with zero deps.

### 2.4. TypeScript Configuration (`tsconfig.json`)

| Option | Value | Rationale |
|---|---|---|
| `strict` | `true` | Enables all strict checks |
| `strictNullChecks` | `true` (via strict) | No implicit null/undefined |
| `noImplicitAny` | `true` (via strict) | All types must be explicit |
| `noUncheckedIndexedAccess` | `true` | Index signatures return `T \| undefined` |
| `target` | `ES2020` | Modern evergreen browsers baseline |
| `module` | `ESNext` | Let Rollup handle module format |
| `moduleResolution` | `bundler` | Modern resolution for Rollup |
| `declaration` | `true` | Generate `.d.ts` files |
| `declarationDir` | `./dist/types` | Separate type output |
| `outDir` | `./dist` | Build output directory |
| `rootDir` | `./src` | Source root |
| `importHelpers` | `true` | Use tslib for smaller output |
| `sourceMap` | `true` | Debugging support |

### 2.5. Rollup Configuration (`rollup.config.mjs`)

Two output targets from a single `src/index.ts` entry:

| Output | Format | File |
|---|---|---|
| ESM | `es` | `dist/esm/index.mjs` |
| CJS | `cjs` | `dist/cjs/index.cjs` |

Plugins: `@rollup/plugin-typescript`, `@rollup/plugin-node-resolve`, `rollup-plugin-dts` (separate config for type bundling).

### 2.6. ESLint Configuration (`eslint.config.js`)

Flat config format using `typescript-eslint` v8+ helper:
- Extends: `tseslint.configs.strictTypeChecked`
- Parser: automatic via `typescript-eslint`
- Ignores: `dist/`, `legacy/`, `node_modules/`
- Carry forward custom rules from old config: `no-duplicate-imports: error`

### 2.7. Prettier Configuration (`.prettierrc`)

Carry forward existing preferences:

| Option | Value |
|---|---|
| `semi` | `true` |
| `trailingComma` | `all` |
| `singleQuote` | `true` |
| `printWidth` | `120` |
| `tabWidth` | `2` |

### 2.8. Vitest Configuration (`vitest.config.ts`)

| Option | Value |
|---|---|
| `environment` | `jsdom` |
| `include` | `src/**/*.test.ts` |
| `exclude` | `legacy/**` |
| `coverage.provider` | `v8` |
| `coverage.thresholds` | `{ lines: 90 }` |

### 2.9. Fresh `src/` Directory Structure

```
src/
├── index.ts          # Barrel re-export from all layers
├── core/
│   └── index.ts      # Scope, digest cycle (empty placeholder)
├── di/
│   └── index.ts      # Dependency injection (empty placeholder)
├── compiler/
│   └── index.ts      # Directives, compilation (empty placeholder)
└── parser/
    └── index.ts      # Expressions, filters (empty placeholder)
```

Each `index.ts` starts as an empty export (`export {}`) so lint/type-check/build pass on day one.

### 2.10. Package.json Exports Map

```json
{
  "exports": {
    ".": {
      "import": "./dist/esm/index.mjs",
      "require": "./dist/cjs/index.cjs",
      "types": "./dist/types/index.d.ts"
    },
    "./core": {
      "import": "./dist/esm/core/index.mjs",
      "require": "./dist/cjs/core/index.cjs",
      "types": "./dist/types/core/index.d.ts"
    },
    "./di": {
      "import": "./dist/esm/di/index.mjs",
      "require": "./dist/cjs/di/index.cjs",
      "types": "./dist/types/di/index.d.ts"
    },
    "./compiler": {
      "import": "./dist/esm/compiler/index.mjs",
      "require": "./dist/cjs/compiler/index.cjs",
      "types": "./dist/types/compiler/index.d.ts"
    },
    "./parser": {
      "import": "./dist/esm/parser/index.mjs",
      "require": "./dist/cjs/parser/index.cjs",
      "types": "./dist/types/parser/index.d.ts"
    }
  }
}
```

### 2.11. Development Scripts

| Script | Command |
|---|---|
| `build` | `rollup -c` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `lint` | `eslint src/` |
| `format` | `prettier --write 'src/**/*.ts'` |
| `format:check` | `prettier --check 'src/**/*.ts'` |
| `typecheck` | `tsc --noEmit` |
| `dev` | `vitest` |

### 2.12. GitHub Actions CI (`.github/workflows/ci.yml`)

- **Trigger:** `push` and `pull_request` on all branches
- **Runner:** `ubuntu-latest`
- **Node:** 22 LTS (via `actions/setup-node@v4`)
- **Package manager:** pnpm (via `pnpm/action-setup@v4`)
- **Steps:** Install → Lint → Format Check → Type Check → Test
- **Note:** Existing `pr.yml` is kept as-is (will no longer pass but serves as reference)

---

## 3. Impact and Risk Analysis

**System Dependencies:**
- No external services or systems are affected — this is purely a project restructuring
- The `legacy/` folder will cause ESLint/TypeScript to error if not properly excluded via ignore patterns

**Potential Risks & Mitigations:**

| Risk | Impact | Mitigation |
|---|---|---|
| Git history loss during file moves | Blame/log won't trace back | Use `git mv` for all relocations |
| Empty barrel exports may confuse Rollup | Build fails | Ensure each `index.ts` has at least `export {}` |
| Old `pr.yml` workflow will fail on new branch | Confusing CI status | Keep but acknowledge — it runs against old Jest/npm which no longer exist |
| pnpm lockfile conflicts with npm/yarn | Contributors use wrong tool | Add `engines` field and `packageManager` field to `package.json`, add `.npmrc` with `engine-strict=true` |

---

## 4. Testing Strategy

- **Day-one validation:** After setup, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm test` must all pass with zero errors on the empty placeholder modules
- **CI validation:** Push a test commit and verify the GitHub Actions `ci.yml` workflow passes
- **Build validation:** `pnpm build` must produce `dist/esm/` and `dist/cjs/` directories with valid output and `.d.ts` declarations
- **Legacy isolation:** Verify no files from `legacy/` are included in build output, lint scope, or test runs
