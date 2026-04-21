# Project Topology — Audit Results

**Date:** 2026-04-21
**Score:** 100% — Grade **A**

## Results

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1   | TOPO-01: Repository structure type | medium | PASS | Single `package.json` at root (`my_own_angularjs`, v1.0.0) with `exports` map exposing 5 subpaths (`.`, `./core`, `./di`, `./compiler`, `./parser`). No nested build roots (no additional `package.json`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle.kts`, or `pyproject.toml` outside `node_modules/`). No runnable service entry point (no `bin`, no server `start` script — only `test`, `typecheck`, `lint`, `format`, `build`). **Structure: single-package TypeScript library (monorepo-of-one via exports map).** |
| 2   | TOPO-02: Application layer inventory | medium | PASS | One published library surface with four internal modules under `src/`: `core/` (scopes + digest — `scope.ts`, `scope-watch-delegates.ts`, `scope-types.ts`, `utils.ts`), `parser/` (lexer → AST → tree-walking interpreter — `lexer.ts`, `ast.ts`, `ast-flags.ts`, `parse.ts`, `interpreter.ts`, `parse-types.ts`), `di/` (DI container — `module.ts`, `injector.ts`, `annotate.ts`, `di-types.ts`), and `compiler/` (reserved empty barrel — `index.ts` only). Framework/technology: TypeScript 6 library; build via Rollup 4 (dual ESM + CJS + `.d.ts`); tests via Vitest 4 (jsdom env). Primary language: TypeScript. |
| 3   | TOPO-03: Database and storage detection | medium | SKIP | No migration directories, no ORM configs (no Prisma, TypeORM, Hibernate, SQLAlchemy, GORM), no `docker-compose*.yml`, no client SDKs for DBs in `package.json` devDependencies. Pure in-memory library. |
| 4   | TOPO-04: Infrastructure layer detection | medium | SKIP | No `*.tf`, no `Dockerfile`, no `docker-compose*.yml`, no `k8s/`/`kubernetes/` manifests, no Helm charts, no CDK/Pulumi/CloudFormation/SAM, no `serverless.yml`, no Ansible. The only YAML outside `node_modules/` is `.github/workflows/ci.yml` (CI pipeline, not IaC) and `pnpm-lock.yaml`. |
| 5   | TOPO-05: Language inventory | medium | PASS | Glob counts outside `node_modules/`, `dist/`, `coverage/`, `.git/`: **TypeScript: 35 `.ts` source files** (all under `src/` — 12 production modules + 15 test files + type/index/README mix) plus 1 top-level `vitest.config.ts`. Config/scripts: 2 `.mjs` (`rollup.config.mjs`, `eslint.config.mjs`), 5 `.json` (`package.json`, `tsconfig.json`, `.mcp.json`, etc.), 81 `.md` (docs + AWOS specs under `context/`). No `.js`, `.tsx`, `.py`, `.go`, `.java`, `.kt`, `.rs`, or other source languages. |
| 6   | TOPO-06: Inter-layer communication patterns | medium | SKIP | No OpenAPI/Swagger specs, no `.proto` files, no `.graphql` files, no message-queue configs, no event schemas, no generated API clients. Single-layer library — inter-module communication is in-process TypeScript imports via path aliases (`@core`, `@parser`, `@di`, `@compiler`) governed by the module-boundary rule (documented in `CLAUDE.md`: `parser/*` and `di/*` depend only on `@core`; `core/scope.ts` depends on `@parser/index`; `compiler/` has no deps). |

## Scoring

- Checks: 6 at `medium` severity = 6.0 max points
- Deductions: 0 (all PASS or SKIP; project-topology never produces FAIL)
- `pct = (6.0 − 0) / 6.0 × 100 = 100%` → Grade **A**

## Topology Summary

- **Structure:** library (single-package, single `package.json` at root; published to npm with subpath `exports`)
- **Layers:**
  - library-module `core`: TypeScript scope + digest engine at `src/core/` (primary language: TypeScript)
  - library-module `parser`: TypeScript lexer/AST/tree-walking interpreter at `src/parser/` (primary language: TypeScript)
  - library-module `di`: TypeScript dependency-injection container at `src/di/` (primary language: TypeScript)
  - library-module `compiler`: reserved empty barrel at `src/compiler/` (primary language: TypeScript)
- **Storage:** not detected
- **Infrastructure:** not detected (only `.github/workflows/ci.yml` for GitHub Actions CI — lint, format:check, typecheck, test on Node 22; `build` not yet wired into CI)
- **Languages:** TypeScript (35 `.ts` files in `src/` + 1 root `vitest.config.ts`), JavaScript-modules (2 `.mjs` config files: Rollup + ESLint), JSON (5 config files), Markdown (81 files — READMEs + AWOS spec docs under `context/`)
- **Communication:** not detected (single-layer in-process library; module boundaries enforced via TS path aliases and an ESLint `no-restricted-imports` rule that blocks `../*` climbing)
- **Service directories:** `src/core/`, `src/parser/`, `src/di/`, `src/compiler/` (four library subpaths — no runnable services)
