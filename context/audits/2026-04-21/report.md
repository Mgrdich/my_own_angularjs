# Code Audit Report

**Date:** 2026-04-21
**Scope:** all dimensions
**Overall Score:** 76% — Grade **B**
**Previous Audit:** none

## Summary

| #   | Dimension                 | Score | Grade | Delta | Critical | High | Medium | Low |
| --- | ------------------------- | ----- | ----- | ----- | -------- | ---- | ------ | --- |
| 1   | Project Topology          | 100%  | A     | n/a   | 0        | 0    | 0      | 0   |
| 2   | AI Development Tooling    | 65%   | C     | n/a   | 1        | 0    | 0      | 0   |
| 3   | Code Architecture         | 71%   | C     | n/a   | 0        | 1    | 1      | 0   |
| 4   | Documentation Quality     | 31%   | F     | n/a   | 1        | 2    | 1      | 0   |
| 5   | Security Guardrails       | 64%   | C     | n/a   | 1        | 1    | 0      | 0   |
| 6   | Software Best Practices   | 85%   | B     | n/a   | 1        | 0    | 1      | 0   |
| 7   | Spec-Driven Development   | 92%   | A     | n/a   | 0        | 1    | 0      | 0   |
| 8   | End-to-End Delivery       | 100%  | A     | n/a   | 0        | 0    | 0      | 0   |

Issue counts include both FAIL and WARN statuses.

---

## Dimension: Project Topology

**Score:** 100% — Grade **A**

| # | Check | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| TOPO-01 | Repository structure type | medium | PASS | Single `package.json` with `exports` map; this is a published npm **library**. |
| TOPO-02 | Application layer inventory | medium | PASS | One layer: TypeScript library at `src/` with submodules `core`, `parser`, `di`, `compiler`. |
| TOPO-03 | Database and storage detection | medium | SKIP | No migrations, ORMs, or storage clients. |
| TOPO-04 | Infrastructure layer detection | medium | SKIP | No Dockerfile, IaC, or K8s. Only `.github/workflows/ci.yml`. |
| TOPO-05 | Language inventory | medium | PASS | TypeScript (25 files: 19 src + 6 test), JS/MJS (2 config). |
| TOPO-06 | Inter-layer communication patterns | medium | SKIP | Single-layer library; no API specs. |

---

## Dimension: AI Development Tooling

**Score:** 65% — Grade **C**

| # | Check | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| AI-01 | CLAUDE.md ecosystem provides adequate AI context | critical | FAIL | No CLAUDE.md files anywhere (root, `src/**`, `.claude/rules/**`). Project purpose/conventions live only in `README.md`. |
| AI-02 | Custom slash commands exist | medium | PASS | 9 AWOS commands in `.claude/commands/awos/` (architecture, hire, implement, product, roadmap, spec, tasks, tech, verify). |
| AI-03 | Skills are configured | low | PASS | 3 skills: `docs-that-work`, `gha-diagnosis`, `typescript-development`. |
| AI-04 | MCP servers configured | low | PASS | `.mcp.json` declares `awos-recruitment` HTTP server. |
| AI-05 | Hooks are configured | low | PASS | `PostToolUse` hook runs `pnpm format && lint:fix` on `Write\|Edit`. |
| AI-06 | CLAUDE.md files are meaningful and well-structured | high | SKIP | No CLAUDE.md exists to evaluate. |
| AI-07 | Agent can run and observe the application | critical | PASS | Library — agent can run `pnpm test/build/typecheck/lint` directly; allow-list permits these in `.claude/settings.local.json`. |

---

## Dimension: Code Architecture

**Score:** 71% — Grade **C**

| # | Check | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| ARCH-01 | Declared or recognizable architectural pattern | high | PASS | README declares modular library; `package.json` `exports` map exposes 4 barrels (`core`, `parser`, `di`, `compiler`). |
| ARCH-02 | Module boundaries respected | high | WARN | No cycles. However, `parser/{lexer,ast,interpreter}.ts` and `di/{annotate,injector}.ts` deep-import `@core/utils` rather than going through the `@core/index` barrel (5 files). |
| ARCH-03 | Single Responsibility in modules | medium | PASS | Submodules purpose-matching; no god modules; `core/utils.ts` narrowly scoped. |
| ARCH-04 | Separation of concerns across layers | high | SKIP | Library — Skip-When triggered. |
| ARCH-05 | Consistent file/directory naming | medium | PASS | Consistent kebab-case across all 19 source files; tests colocated under `__tests__/`. |
| ARCH-06 | Reasonable file sizes | medium | FAIL | 8/25 files >500 lines (32%); two test files >2000 lines hit hard-fail threshold (`di/__tests__/di.test.ts` 2817, `core/__tests__/scope.test.ts` 2453). Source hot-spots: `di/module.ts` (776), `di/injector.ts` (734), `core/scope.ts` (827). |

---

## Dimension: Documentation Quality

**Score:** 31% — Grade **F**

| # | Check | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| DOC-01 | Root README exists and is useful | critical | WARN | README has project name, stack, Getting Started, structure — but content is outdated (see DOC-04): marks DI as "Upcoming Phase 1" while `src/di/` is fully implemented. |
| DOC-02 | Service-level READMEs exist | high | FAIL | None of the four submodules (`src/core`, `src/parser`, `src/di`, `src/compiler`) has a README. |
| DOC-03 | API documentation is available | high | WARN | Published npm library with subpath `exports` but no TypeDoc config and no generated API reference. Inline TSDoc present but not surfaced. |
| DOC-04 | No stale documentation | medium | FAIL | 4/6 sampled README claims inaccurate: test-file count (claims 3, actually 6), Project Structure listings omit multiple files in `src/core` and `src/parser`, `src/di` and `src/compiler` absent from structure, DI labeled "Upcoming" despite full implementation. |

---

## Dimension: Security Guardrails

**Score:** 64% — Grade **C**

| # | Check | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| SEC-01 | .env files are gitignored | critical | PASS | `.gitignore` includes `.env` and `.env.test`; `git ls-files '*.env*'` empty. |
| SEC-02 | AI agent hooks restrict access to sensitive files | critical | FAIL | `.claude/settings.json` has only a format/lint `PostToolUse` hook; no `PreToolUse` guards on Read/Glob/Bash for `.env`, `*.pem`, `*.key`, `credentials*`, `secrets*`, `*.p12`, `*.pfx`. |
| SEC-03 | .env.example or template exists | high | SKIP | No env-var usage detected in source. |
| SEC-04 | No secrets in committed files | critical | PASS | No AKIA keys, no PRIVATE KEY headers, no credential patterns. `token`/`secret` occurrences in `src/parser/ast.ts` are lexer identifiers. |
| SEC-05 | Sensitive files in .gitignore relevant to stack | high | WARN | Good TS-library coverage but missing OS-file patterns (`.DS_Store`, `Thumbs.db`). |

---

## Dimension: Software Best Practices

**Score:** 85% — Grade **B**

| # | Check | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| SBP-01 | Linting configured and enforced | high | PASS | `eslint.config.mjs` uses `strictTypeChecked`; `lint`/`lint:fix` scripts; CI runs `pnpm lint`. |
| SBP-02 | Formatting is automated | medium | PASS | `.prettierrc` present; `format`/`format:check` scripts; CI runs `format:check`. |
| SBP-03 | Type safety enforced | high | PASS | `strict: true` + `noUncheckedIndexedAccess`. Only one `any` cast (`src/core/utils.ts:229`); all `eslint-disable` comments carry justifications. |
| SBP-04 | Test infrastructure exists | critical | WARN | Vitest configured (jsdom, 90% line coverage threshold) but only 6 test files (threshold 10+). 987 assertions in aggregate — depth is strong. |
| SBP-05 | CI/CD pipeline exists | high | PASS | `.github/workflows/ci.yml` runs lint + format + typecheck + test on Node 22. |
| SBP-06 | Error handling patterns consistent | high | PASS | Sampled 5 catch blocks in `src/core/scope.ts` — all `console.error(...)` with context; no silent swallows. |
| SBP-07 | Dependencies managed | medium | WARN | `pnpm-lock.yaml` committed, `packageManager` pinned — but no Dependabot/Renovate config. |

---

## Dimension: Spec-Driven Development

**Score:** 92% — Grade **A**

| # | Check | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| SDD-01 | AWOS installed and set up | critical | PASS | `.awos/commands/` has 9 files; `.claude/commands/awos/` has 9 matching files; `context/product/` and `context/spec/` both exist. |
| SDD-02 | Product context complete | high | PASS | `product-definition.md` (85 lines), `roadmap.md` (134 lines, 6 phases), `architecture.md` (70 lines, 5 sections). All substantive. |
| SDD-03 | Architecture document reflects codebase reality | high | WARN | Core stack confirmed. 3 minor phantom declarations: Husky, lint-staged, TypeDoc listed in architecture §5 but not installed. |
| SDD-04 | Features implemented through specs | critical | PASS | 13/14 feat commits (93%) over 3 months touched `context/spec/`. |
| SDD-05 | Spec directories structurally complete | high | PASS | 10/10 specs (001–010) have the full triad (functional-spec.md, technical-considerations.md, tasks.md). |
| SDD-06 | No stale or abandoned specs | medium | SKIP | All 10 specs are `Status: Completed` with 100% checkmarks. |
| SDD-07 | Tasks have meaningful agent assignments | medium | PASS | 289/289 sub-tasks annotated; `vitest-testing` used for verification; no systematic domain mix-ups. |

---

## Dimension: End-to-End Delivery

**Score:** 100% — Grade **A**

| # | Check | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| E2E-01 | Cross-layer feature branches | high | SKIP | Single-service library. |
| E2E-02 | No layer-split branching pattern | medium | SKIP | Single-service library. |
| E2E-03 | Spec-to-delivery traceability | high | PASS | Bidirectional. Commits cite spec IDs + slice numbers (e.g., `846fe2b … (spec 010)`, `4e7b3ee … (spec 010 slices 1-3)`); `tasks.md` files declare their spec dir and ticking `[x]` is atomic with `src/` edits. |
| E2E-04 | No orphaned artifacts | medium | SKIP | Only one layer. |
| E2E-05 | Shared ownership enablers | medium | SKIP | Single-service repo. |

---

## Top Recommendations

| #   | Priority | Effort | Dimension                 | Recommendation                                                                                                                                   |
| --- | -------- | ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | P0       | Low    | AI Development Tooling    | Add a root `CLAUDE.md` capturing project purpose, key commands, AngularJS parity invariants, digest/TTL contract, module boundaries, and the "no `new Function()` — tree-walking interpreter" constraint. |
| 2   | P0       | Low    | Security Guardrails       | Add `PreToolUse` hooks in `.claude/settings.json` that deny Read/Glob/Bash access to `.env`, `*.pem`, `*.key`, `credentials*`, `secrets*`, `*.p12`, `*.pfx`. |
| 3   | P1       | Low    | Documentation Quality     | Refresh root `README.md`: update Project Structure to list current files in `src/core` + `src/parser`, add `src/di` and `src/compiler`, move DI out of "Upcoming", correct test-file count. |
| 4   | P1       | Medium | Documentation Quality     | Add a brief `README.md` per submodule (`src/core`, `src/parser`, `src/di`, `src/compiler`) explaining purpose and key exports.                   |
| 5   | P1       | Medium | Software Best Practices   | Split the oversized test files (`di/__tests__/di.test.ts` 2817 LOC, `core/__tests__/scope.test.ts` 2453 LOC) by feature slice and introduce 4+ additional small test files to clear the 10-file threshold. |
| 6   | P2       | Low    | Security Guardrails       | Append `.DS_Store` and `Thumbs.db` to `.gitignore` to prevent OS-file leakage from macOS/Windows dev environments.                               |
| 7   | P2       | Low    | Software Best Practices   | Add `.github/dependabot.yml` (or `renovate.json`) for automated dependency update PRs. Add a `build` step to CI to catch Rollup/packaging regressions. |
| 8   | P2       | Low    | Spec-Driven Development   | Remove or install the 3 phantom tools in `context/product/architecture.md` §5 (Husky, lint-staged, TypeDoc) so the document matches reality.     |
| 9   | P2       | Low    | Code Architecture         | Change `parser/*` and `di/*` deep imports of `@core/utils` to use the `@core/index` barrel (5 files).                                            |
| 10  | P2       | Medium | Documentation Quality     | Add TypeDoc config + CI step that publishes an API reference for the library's `exports` map.                                                    |
