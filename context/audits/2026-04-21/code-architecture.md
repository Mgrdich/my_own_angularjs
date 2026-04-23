# Code Architecture — Audit Results

**Date:** 2026-04-21
**Score:** 71% — Grade **C**

## Results

| # | Check | Severity | Status | Evidence |
|---|---|---|---|---|
| ARCH-01 | Declared or recognizable architectural pattern | high | PASS | Modular library architecture is both declared (CLAUDE.md "Modules" table; `package.json` subpath `exports` map at lines 7–33 declaring `./core`, `./di`, `./compiler`, `./parser`) and recognizable on disk. Each module has its own `index.ts` barrel (`src/core/index.ts:1–17`, `src/parser/index.ts:1–2`, `src/di/index.ts:1–18`, `src/compiler/index.ts:1`). Root `src/index.ts` re-exports the subpaths. Path aliases (`@core`, `@parser`, `@di`, `@compiler`) reinforce the module boundaries. |
| ARCH-02 | Module boundaries are respected | high | WARN | Direction of dependencies is correct: `parser/*` and `di/*` only import from `@core/*`; `core/scope.ts:1` imports `@parser/index` (explicitly permitted exception in CLAUDE.md); no cross-imports between `parser/` and `di/`. No `../` parent climbing anywhere under `src/` (`no-restricted-imports` rule holds). However, **5 source files bypass the `@core/index` barrel** and import directly from `@core/utils` — a documented "prefer" guideline in CLAUDE.md ("prefer importing from `@core/index`, not `@core/utils` directly"): `src/parser/lexer.ts:10`, `src/parser/ast.ts:10`, `src/parser/interpreter.ts:10`, `src/di/annotate.ts:11`, `src/di/injector.ts:15`. One intra-`core` type-only cycle exists (`scope-types.ts:1` → `scope.ts` → `scope-types.ts`) but it is pure `import type` so TS erases it — no runtime cycle. |
| ARCH-03 | Single Responsibility Principle in modules | medium | PASS | Four top-level module directories with coherent, non-overlapping responsibilities: `core/` (scopes + digest), `parser/` (lexer → AST → interpreter), `di/` (container), `compiler/` (reserved empty barrel, intentionally). No generic "utils/" or "helpers/" directory exists — `src/core/utils.ts` is a single file of core primitives (`isEqual`, `copy`, type guards) properly scoped to the `core` module. No "god module" mixing unrelated concerns. |
| ARCH-04 | Separation of concerns across layers | high | SKIP | Skip-When rule applies: topology (`project-topology.md`) shows the project is a single-package TypeScript library. Libraries may legitimately have simpler structure; the layered-separation check targets apps with presentation/business/data concerns, which do not exist here. |
| ARCH-05 | Consistent file and directory naming conventions | medium | PASS | All source filenames are kebab-case (`scope-watch-delegates.ts`, `ast-flags.ts`, `scope-types.ts`, `di-types.ts`, `parse-types.ts`, etc.). Tests consistently live under `src/<module>/__tests__/*.test.ts` (verified for `core`, `parser`, `di`). Directory names are lowercase single words. Barrel files are uniformly named `index.ts`. No mixed-case, snake_case, or PascalCase source filenames found. |
| ARCH-06 | Reasonable file sizes | medium | FAIL | Three non-test source files exceed the 500-line target documented in CLAUDE.md: `src/core/scope.ts` (827), `src/di/module.ts` (776), `src/di/injector.ts` (734) — all counts verified via `wc -l` and matching CLAUDE.md's stated figures. Out of 19 non-test `.ts` files under `src/`, 3 are >500 lines = **15.8%**, which is just over the 15% WARN ceiling → FAIL per rubric. No file exceeds 2000 lines (largest is 827). These files are explicitly listed as "refactor candidates today" in CLAUDE.md so the breach is tracked technical debt, not unnoticed. |

## Scoring

- **Max points:** ARCH-01 (high, 2) + ARCH-02 (high, 2) + ARCH-03 (medium, 1) + ARCH-05 (medium, 1) + ARCH-06 (medium, 1) = **7** (ARCH-04 SKIP excluded).
- **Deductions:**
  - ARCH-02 WARN (high, partial) = 1.0
  - ARCH-06 FAIL (medium) = 1.0
  - **Total = 2.0**
- **Percentage:** (7 − 2) / 7 = **71.4%** → Grade **C**

## Notes

- The architecture is fundamentally sound: clean modular library with enforced boundaries, path aliases, and no relative-parent climbing. Both deductions are remediable without architectural change:
  1. Rewrite the 5 `@core/utils` imports to go through `@core/index` (mechanical change, ~5 lines).
  2. Execute the refactor already planned in CLAUDE.md for `scope.ts`, `module.ts`, `injector.ts` to split each under 500 lines.
- The type-only cycle `scope-types.ts` ↔ `scope.ts` is safe under current TS settings but could be untangled by moving `Scope`'s public type contract into `scope-types.ts` (or a new `scope-interface.ts`) so that `scope-types.ts` has no dependency on `scope.ts` at all.
