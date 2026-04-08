# Tasks: Legacy Isolation & Fresh Project Setup

---

## Slice 1: Isolate legacy code and switch to pnpm

_After this slice: all old code is in `legacy/`, old lock files are removed, pnpm is the package manager. `pnpm install` works._

- [x] **Slice 1: Move existing code to legacy and switch to pnpm**
  - [x] Create `legacy/` directory and `git mv` all `src/` contents into `legacy/src/` (modules, js_legacy, util, __tests__, index.ts, types) **[Agent: general-purpose]**
  - [x] `git mv` old config files to `legacy/`: `jest.config.js`, `.eslintrc` **[Agent: general-purpose]**
  - [x] Remove `package-lock.json` and `yarn.lock` **[Agent: general-purpose]**
  - [x] Remove all old dependencies from `package.json`: Jest stack, Webpack stack, old ESLint plugins, old TypeScript, old Prettier, lodash **[Agent: general-purpose]**
  - [x] Remove old `lint-staged` config and old scripts from `package.json` **[Agent: general-purpose]**
  - [x] Add `packageManager` field to `package.json` and create `.npmrc` with `engine-strict=true` **[Agent: general-purpose]**
  - [x] Run `pnpm install` to generate `pnpm-lock.yaml` **[Agent: general-purpose]**
  - [x] **Verify:** `legacy/src/` contains all original files, `src/` is empty or absent, `pnpm install` succeeds, no old lock files remain **[Agent: general-purpose]**

---

## Slice 2: TypeScript strict + fresh src/ structure + Prettier

_After this slice: `pnpm typecheck` and `pnpm format:check` pass on the empty placeholder modules._

- [x] **Slice 2: Set up TypeScript strict, directory structure, and Prettier**
  - [x] Install `typescript@^6.0.2`, `tslib@^2.8.1`, `prettier@^3.8.1` via pnpm **[Agent: typescript-framework]**
  - [x] Create `tsconfig.json` with strict mode, ES2020 target, ESNext module, bundler resolution, declarationDir, rootDir/outDir per tech spec **[Agent: typescript-framework]**
  - [x] Create fresh `src/` directory structure: `src/index.ts`, `src/core/index.ts`, `src/di/index.ts`, `src/compiler/index.ts`, `src/parser/index.ts` — each with `export {}` **[Agent: typescript-framework]**
  - [x] Update `.prettierrc` to match tech spec (semi, trailingComma, singleQuote, printWidth 120, tabWidth 2) **[Agent: typescript-framework]**
  - [x] Add `typecheck` and `format:check` scripts to `package.json` **[Agent: typescript-framework]**
  - [x] **Verify:** Run `pnpm typecheck` — passes with zero errors. Run `pnpm format:check` — passes with zero errors. **[Agent: typescript-framework]**

---

## Slice 3: ESLint flat config + lint script

_After this slice: `pnpm lint` passes on the empty placeholder modules._

- [x] **Slice 3: Set up ESLint with flat config**
  - [x] Install `eslint@^10.2.0` and `typescript-eslint@^8.58.1` via pnpm **[Agent: typescript-framework]**
  - [x] Create `eslint.config.js` with flat config: `tseslint.configs.strictTypeChecked`, ignores for `dist/`, `legacy/`, `node_modules/`, carry forward `no-duplicate-imports: error` **[Agent: typescript-framework]**
  - [x] Add `lint` script to `package.json`: `eslint src/` **[Agent: typescript-framework]**
  - [x] **Verify:** Run `pnpm lint` — passes with zero errors. **[Agent: typescript-framework]**

---

## Slice 4: Vitest + test scripts

_After this slice: `pnpm test` passes (no tests yet, but zero errors). `pnpm dev` starts watch mode._

- [x] **Slice 4: Set up Vitest with jsdom**
  - [x] Install `vitest@^4.1.3` and `jsdom@^29.0.2` via pnpm **[Agent: vitest-testing]**
  - [x] Create `vitest.config.ts` with jsdom environment, include `src/**/*.test.ts`, exclude `legacy/**`, coverage provider v8, threshold 90% lines **[Agent: vitest-testing]**
  - [x] Add `test`, `test:watch`, and `dev` scripts to `package.json` **[Agent: vitest-testing]**
  - [x] **Verify:** Run `pnpm test` — passes with zero errors (no test files, clean exit). Run `pnpm dev` — starts Vitest watch mode without errors (ctrl+c to exit). **[Agent: vitest-testing]**

---

## Slice 5: Rollup build + package exports

_After this slice: `pnpm build` produces `dist/esm/` and `dist/cjs/` with valid output and `.d.ts` declarations._

- [x] **Slice 5: Set up Rollup build and package exports**
  - [x] Install `rollup@^4.60.1`, `@rollup/plugin-typescript@^12.3.0`, `@rollup/plugin-node-resolve@^16.0.3`, `rollup-plugin-dts@^6.4.1` via pnpm **[Agent: rollup-build]**
  - [x] Create `rollup.config.mjs` with dual ESM (`dist/esm/index.mjs`) + CJS (`dist/cjs/index.cjs`) output, TypeScript and node-resolve plugins, separate dts config **[Agent: rollup-build]**
  - [x] Add `build` script to `package.json`: `rollup -c` **[Agent: rollup-build]**
  - [x] Configure `package.json` exports map with `.`, `./core`, `./di`, `./compiler`, `./parser` subpaths — each with `import`, `require`, and `types` conditions **[Agent: rollup-build]**
  - [x] Add `main`, `module`, `types` top-level fields to `package.json` for legacy consumers **[Agent: rollup-build]**
  - [x] **Verify:** Run `pnpm build` — produces `dist/esm/`, `dist/cjs/`, and `dist/types/` with valid files. Verify `.d.ts` declarations exist. **[Agent: rollup-build]**

---

## Slice 6: GitHub Actions CI

_After this slice: pushing to the repo triggers a CI workflow that runs lint, format check, type check, and tests._

- [x] **Slice 6: Set up GitHub Actions CI pipeline**
  - [x] Create `.github/workflows/ci.yml` — triggers on `push` and `pull_request`, runs on `ubuntu-latest` with Node 22 LTS, uses `pnpm/action-setup@v4` **[Agent: ci-tooling]**
  - [x] Configure CI steps: Install (`pnpm install`) → Lint (`pnpm lint`) → Format Check (`pnpm format:check`) → Type Check (`pnpm typecheck`) → Test (`pnpm test`) **[Agent: ci-tooling]**
  - [x] **Verify:** Push a commit and confirm the CI workflow triggers and passes all steps on GitHub. **[Agent: ci-tooling]**

---

## Slice 7: Final validation

_After this slice: end-to-end verification that everything works together._

- [x] **Slice 7: End-to-end validation**
  - [x] Run full command sequence locally: `pnpm install` → `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test` → `pnpm build` — all pass **[Agent: general-purpose]**
  - [x] Verify `legacy/` files are excluded from lint, test, and build output **[Agent: general-purpose]**
  - [x] Verify `dist/` contains ESM, CJS, and type declarations **[Agent: general-purpose]**
  - [x] Add `dist/` to `.gitignore` if not already present **[Agent: general-purpose]**
  - [x] Verify CI workflow passes on GitHub **[Agent: ci-tooling]**
