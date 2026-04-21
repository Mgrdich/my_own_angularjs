# Audit Recommendations — 2026-04-21

## P0 — Fix Immediately

### 1. Add a root `CLAUDE.md`

- **Dimension:** AI Development Tooling
- **Check:** AI-01 (critical FAIL)
- **Effort:** Low
- **Details:** No CLAUDE.md exists anywhere in the repo. Create `/Users/mgo/Documents/my_own_angularjs/CLAUDE.md` covering:
  - Project purpose: AngularJS behavioral-parity reimplementation in TypeScript, clarity-over-performance.
  - Key commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build`.
  - Non-obvious invariants: no `new Function()` / `eval()` — expressions use the tree-walking interpreter; digest-cycle TTL contract (10 iterations); `$watchGroup` / `$watchCollection` semantics; one-time binding flag propagation (spec 010).
  - Module boundaries: `core` (scopes/digest), `parser` (lexer/AST/interpreter), `di` (module/injector/annotate), `compiler` (future).
  - Spec-driven workflow: every feature goes through `context/spec/<id>/{functional-spec,technical-considerations,tasks}.md`; tick `[x]` in the same commit as the implementation.
  - User preferences from memory: conventional-commit prefixes; no explicit return types when TS can infer.
  - Keep under 200 lines. Use the `docs-that-work` skill already installed.

### 2. Add PreToolUse hooks blocking sensitive file access

- **Dimension:** Security Guardrails
- **Check:** SEC-02 (critical FAIL)
- **Effort:** Low
- **Details:** Edit `/Users/mgo/Documents/my_own_angularjs/.claude/settings.json` to add a `PreToolUse` hook that denies Read/Glob/Bash access to sensitive patterns: `.env`, `.env.*`, `*.pem`, `*.key`, `credentials*`, `secrets*`, `*secret*`, `*.p12`, `*.pfx`. Pattern-match on the tool's `file_path` / `pattern` / `command` input and return a non-zero exit with a denial message.

## P1 — Fix Soon

### 3. Refresh root README

- **Dimension:** Documentation Quality
- **Check:** DOC-01 (critical WARN), DOC-04 (medium FAIL)
- **Effort:** Low
- **Details:** Edit `/Users/mgo/Documents/my_own_angularjs/README.md`:
  - Update "Project Structure" to list all current files in `src/core` (add `scope-types.ts`, `scope-watch-delegates.ts`), `src/parser` (add `ast-flags.ts`, `parse-types.ts`), and add sections for `src/di/` (`module.ts`, `injector.ts`, `annotate.ts`, `di-types.ts`) and `src/compiler/`.
  - Move "Dependency Injection" out of "Upcoming — Phase 1" into implemented features.
  - Fix test-count claim: 6 test files (not 3); aggregate ~987 assertions.
  - Reflect spec 010 one-time bindings / constant watch optimization in the status section.

### 4. Add submodule READMEs

- **Dimension:** Documentation Quality
- **Check:** DOC-02 (high FAIL)
- **Effort:** Medium
- **Details:** Create short README files (50–100 lines each) for `src/core/README.md`, `src/parser/README.md`, `src/di/README.md`, `src/compiler/README.md`. Each should cover: purpose, main exports, key invariants, and quick usage example.

### 5. Split oversized test files + raise file count above threshold

- **Dimension:** Software Best Practices
- **Check:** SBP-04 (critical WARN), Code Architecture ARCH-06 (medium FAIL)
- **Effort:** Medium
- **Details:**
  - Split `src/di/__tests__/di.test.ts` (2817 LOC) into several files by concern: `module.test.ts` (module registration, annotate), `injector.test.ts` (invoke, instantiate), `providers.test.ts` (factory/service/value/constant), `lifecycle.test.ts`, `recipes.test.ts`. Each should land under 1000 lines.
  - Split `src/core/__tests__/scope.test.ts` (2453 LOC) into `scope-digest.test.ts`, `scope-watch.test.ts`, `scope-events.test.ts`, `scope-hierarchy.test.ts`, `scope-lifecycle.test.ts`.
  - Outcome: SBP-04 moves from WARN → PASS (10+ test files) and ARCH-06 clears the `>2000 lines` hard fail.

## P2 — Improve When Possible

### 6. Add OS-file patterns to `.gitignore`

- **Dimension:** Security Guardrails
- **Check:** SEC-05 (high WARN)
- **Effort:** Low
- **Details:** Append `.DS_Store` and `Thumbs.db` to `/Users/mgo/Documents/my_own_angularjs/.gitignore`.

### 7. Add dependency-update automation and CI build step

- **Dimension:** Software Best Practices
- **Check:** SBP-07 (medium WARN), SBP-05 polish
- **Effort:** Low
- **Details:**
  - Create `.github/dependabot.yml` with weekly schedule for `npm` + `github-actions` ecosystems (or `renovate.json` if preferred).
  - Add `pnpm build` step to `.github/workflows/ci.yml` after the `Test` step to catch Rollup/packaging regressions.

### 8. Reconcile phantom tooling in architecture.md

- **Dimension:** Spec-Driven Development
- **Check:** SDD-03 (high WARN)
- **Effort:** Low
- **Details:** In `/Users/mgo/Documents/my_own_angularjs/context/product/architecture.md` §5, either remove Husky / lint-staged / TypeDoc (3 phantom entries) or install them. Since TypeDoc is a documentation priority (P2 #10), wiring it up would satisfy both this and DOC-03.

### 9. Route core imports through the barrel

- **Dimension:** Code Architecture
- **Check:** ARCH-02 (high WARN)
- **Effort:** Low
- **Details:** In each of `src/parser/lexer.ts`, `src/parser/ast.ts`, `src/parser/interpreter.ts`, `src/di/annotate.ts`, `src/di/injector.ts`, change imports from `@core/utils` to `@core` (or `@core/index`). Re-export the needed helpers from `src/core/index.ts` if they aren't already, so `parser`/`di` consume only the core public surface.

### 10. Publish a TypeDoc API reference

- **Dimension:** Documentation Quality
- **Check:** DOC-03 (high WARN)
- **Effort:** Medium
- **Details:** Add TypeDoc as a devDependency, create a `typedoc.json` that entry-points on `src/core/index.ts`, `src/parser/index.ts`, `src/di/index.ts`, `src/compiler/index.ts`. Add a `docs` script (`typedoc`) and a CI job that publishes to GitHub Pages on pushes to `master`. This clears DOC-03 and doubles as the fix for the TypeDoc entry in SDD-03.
