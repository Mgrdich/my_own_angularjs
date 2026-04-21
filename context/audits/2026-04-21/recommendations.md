# Audit Recommendations — 2026-04-21

No P0 or P1 items. The project has no critical FAILs, no high FAILs, and no
critical WARNs. All actionable items are P2 — improvements rather than fixes
for a system that's already in good shape.

## P0 — Fix Immediately

_None._

## P1 — Fix Soon

_None._

## P2 — Improve When Possible

### 1. Fix stale test-file count in README

- **Dimension:** Documentation Quality
- **Check:** DOC-04
- **Effort:** Low (1 min)
- **Details:** `README.md:108` says "883 tests across 6 test files". Actual is
  16 test files, 883 tests (verified by `pnpm test`). Change the text to
  "883 tests across 16 test files" or reword to avoid future drift.

### 2. Add `-- reason` justifications to bare eslint-disable directives

- **Dimension:** Software Best Practices
- **Check:** SBP-03
- **Effort:** Low (5 min)
- **Details:** CLAUDE.md requires every `eslint-disable` comment to carry an
  inline justification (`-- reason`). Four directives violate this rule:
  - `src/core/utils.ts:91` — `@typescript-eslint/no-unsafe-function-type`
  - `src/core/utils.ts:228` — `@typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call`
  - `src/core/utils.ts:256` — `@typescript-eslint/no-dynamic-delete`
  - `src/core/__tests__/utils.test.ts:1235` — `@typescript-eslint/no-confusing-void-expression`

  All other disables in the repo (22 in `src/di/`, 2 elsewhere) carry proper
  justifications, so this is a small consistency fix. Follow the pattern used
  in `src/di/module.ts:64, 212` (detailed reasons with variance trade-offs).

### 3. Route `@core/utils` imports through `@core/index`

- **Dimension:** Code Architecture
- **Check:** ARCH-02
- **Effort:** Low (~5 lines)
- **Details:** CLAUDE.md states: "prefer importing from `@core/index`, not
  `@core/utils` directly". Five files violate this:
  - `src/parser/lexer.ts:10`
  - `src/parser/ast.ts:10`
  - `src/parser/interpreter.ts:10`
  - `src/di/annotate.ts:11`
  - `src/di/injector.ts:15`

  Confirm the needed symbols (`isEqual`, `copy`, type guards) are re-exported
  from `src/core/index.ts` first; add them if not. Then rewrite the imports.

### 4. Resolve phantom tooling claims in architecture.md

- **Dimension:** Spec-Driven Development
- **Check:** SDD-03
- **Effort:** Low (2–10 min depending on approach)
- **Details:** `context/product/architecture.md` §5 declares:
  - **Husky + lint-staged** for pre-commit hooks — not in `package.json`, no `.husky/` directory
  - **TypeDoc** for API docs — not in `devDependencies`, no `docs/` site

  Pick one resolution:
  - (a) Remove both claims from §5 (2 min). Keeps architecture.md accurate today.
  - (b) Adopt both (combined with recs #7 and the DOC-03 follow-up). Aligns
    architecture.md with the code.

### 5. Add `pnpm build` stage to CI

- **Dimension:** Software Best Practices
- **Check:** SBP-05
- **Effort:** Low (30 min)
- **Details:** `.github/workflows/ci.yml` runs lint → format:check →
  typecheck → test but no build step. CLAUDE.md notes this as a known gap.
  The job is already named "Lint, Test & Build". Add:

  ```yaml
  - name: Build
    run: pnpm build
  ```

  Prevents silent regressions in Rollup dual ESM+CJS output and per-subpath
  `.d.ts` emission. Run after `test`.

### 6. Add dependency-update automation

- **Dimension:** Software Best Practices
- **Check:** SBP-07
- **Effort:** Low (10 min)
- **Details:** No Renovate/Dependabot config. Library has zero runtime deps so
  the surface is small, but devDependencies (`typescript`, `vitest`, `eslint`,
  `rollup`, `prettier`) still benefit from scheduled updates. Minimal
  `.github/dependabot.yml`:

  ```yaml
  version: 2
  updates:
    - package-ecosystem: "npm"
      directory: "/"
      schedule:
        interval: "weekly"
      open-pull-requests-limit: 5
  ```

### 7. Add pre-commit hook for format + lint

- **Dimension:** Software Best Practices
- **Check:** SBP-02
- **Effort:** Medium (1 h)
- **Details:** No `.husky/` directory and no `lint-staged` field. CI already
  catches format/lint issues, but a pre-commit hook catches them before the
  commit is made. Options: `husky` + `lint-staged`, or the lighter
  `simple-git-hooks`. Run `prettier --write` and `eslint --fix` on staged
  files. Aligns with the Husky claim already in architecture.md §5
  (see rec #4b).

### 8. Refactor oversized source files under 500 lines

- **Dimension:** Code Architecture
- **Check:** ARCH-06
- **Effort:** High (multi-PR; treat as its own slice)
- **Details:** Three source files exceed the 500-line target documented in
  CLAUDE.md, and the 15.8% ratio just crosses the FAIL threshold:
  - `src/core/scope.ts` (827 lines) — candidate split: digest loop vs.
    watch/event/async mechanics
  - `src/di/module.ts` (776 lines) — candidate split: registration API vs.
    provider construction
  - `src/di/injector.ts` (734 lines) — candidate split: resolution vs.
    annotation/caching

  These are already listed as "refactor candidates today" in CLAUDE.md. Because
  the behavior surface is well-tested (883 tests, 90% coverage gate), the
  refactor is low-risk from a correctness standpoint — treat the effort as
  design time, not test time. Consider raising an AWOS spec that explicitly
  targets decomposition.

---

## Nice-to-have (not counted)

- Generate a TypeDoc API site from the existing 211 TSDoc blocks. Not a gap
  that fails DOC-03 (typed `.d.ts` + per-module READMEs are sufficient) but
  would strengthen the published-library experience. Effort: ~1 h.
- Untangle the type-only cycle `scope-types.ts` ↔ `scope.ts` by moving
  `Scope`'s public type contract into `scope-types.ts` (or a new file).
  Currently safe (pure `import type`, TS erases it) but cleaner without.
