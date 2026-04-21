# Code Architecture — Audit Results

**Date:** 2026-04-21
**Score:** 71% — Grade **C**

## Results

| # | Check | Severity | Status | Evidence |
|---|-------|----------|--------|----------|
| ARCH-01 | Declared or recognizable architectural pattern | high | PASS | README.md lines 76-91 declares "Project Structure" with 4 focused submodules (`core`, `parser`, `di`, `compiler`); `package.json` exports map (lines 7-33) exposes each as a standalone subpath entry; each submodule has a barrel `index.ts`. Modular library pattern — clearly recognizable and declared. |
| ARCH-02 | Module boundaries respected | high | WARN | No circular imports at file level. Import direction is consistent: `parser/*` and `di/*` import downward from `@core/utils`; `core/scope.ts` imports `@parser/index` (barrel). Violation: `parser/{lexer,ast,interpreter}.ts` and `di/{annotate,injector}.ts` all deep-import `@core/utils` instead of the `@core/index` barrel (5 files bypass barrel). `core/index.ts` also uses `export *` re-export which could mask boundaries. `src/compiler/index.ts` is empty (`export {};`) — placeholder only. Minor but systemic bypass of the core barrel. |
| ARCH-03 | Single Responsibility in modules | medium | PASS | Top-level submodules `core`, `parser`, `di`, `compiler` have clear, purpose-matching names. No module exceeds 30 files (largest: `core/__tests__` + 5 source = 8 entries). One generic name present (`core/utils.ts`, 361 lines) but it is narrowly scoped to type guards, `isEqual`, and a few helpers — not a cross-cutting dumping ground. `compiler` is an empty placeholder for future work (acceptable per README "Phase 2"). |
| ARCH-04 | Separation of concerns across layers | high | SKIP | Topology confirms this is a library — skipped per Skip-When. |
| ARCH-05 | Consistent file/directory naming | medium | PASS | All source files use consistent kebab-case: `scope-types.ts`, `scope-watch-delegates.ts`, `ast-flags.ts`, `parse-types.ts`, `di-types.ts`. No PascalCase or camelCase deviations found across 19 source files. Tests colocated consistently under `__tests__/` in every submodule (`core/__tests__`, `parser/__tests__`, `di/__tests__`). Test files follow `*.test.ts` suffix. File names match their primary exports (e.g., `scope.ts` → `Scope`, `injector.ts` → `createInjector`, `module.ts` → `Module`/`createModule`, `parse.ts` → `parse`). |
| ARCH-06 | Reasonable file sizes | medium | FAIL | 25 total `.ts` files (19 source + 6 test). Files over 500 lines: `core/scope.ts` (827), `di/module.ts` (776), `di/injector.ts` (734), `core/__tests__/scope-string-expr.test.ts` (1389), `core/__tests__/utils.test.ts` (1294), `core/__tests__/scope.test.ts` (2453), `parser/__tests__/parse.test.ts` (892), `di/__tests__/di.test.ts` (2817) — 8 of 25 files (32%) over 500. Two test files over 2000 lines: `di/__tests__/di.test.ts` (2817), `core/__tests__/scope.test.ts` (2453) — triggers hard FAIL (`any file >2000`). Excluding tests, 3/19 source files (15.8%) exceed 500 lines, still outside the Warn band (5–15%). |

## Scoring

- Weights: ARCH-01 high=2, ARCH-02 high=2, ARCH-03 medium=1, ARCH-04 SKIP (not counted), ARCH-05 medium=1, ARCH-06 medium=1
- Max = 2 + 2 + 1 + 1 + 1 = 7
- Deductions: ARCH-02 WARN = 1 (half of 2), ARCH-06 FAIL = 1 (full medium)
- Score = (7 − 2) / 7 × 100 = **71%** → Grade **C**

## Notes for downstream consumers

- Architectural style: **modular TypeScript library** with barrel-per-submodule and an `exports` map in `package.json` enabling granular subpath imports (`my_own_angularjs/core`, `/parser`, `/di`, `/compiler`).
- Inter-module dependency graph (no cycles):
  - `core/utils.ts` — leaf (no cross-module imports)
  - `parser/*` → `@core/utils`
  - `di/*` → `@core/utils`
  - `core/scope.ts` → `@parser/index` (semantically required: scopes evaluate expression strings)
  - `compiler/index.ts` — empty placeholder
- Main hot-spots for future refactoring: `di/module.ts` (776 LOC), `di/injector.ts` (734 LOC), and `core/scope.ts` (827 LOC) all combine typed public API with runtime orchestration and could be sliced further.
- Test files in `__tests__/` directories are very large (up to 2817 LOC in `di.test.ts`); consider splitting by feature slice to keep individual test modules under 1000 lines.
- Minor boundary improvement: have `parser` and `di` import from `@core/index` (barrel) rather than `@core/utils` directly to enforce the public surface contract.
