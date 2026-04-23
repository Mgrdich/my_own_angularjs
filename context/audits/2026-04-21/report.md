# Code Audit Report

**Date:** 2026-04-21
**Scope:** all dimensions
**Overall Score:** 93% — Grade **A**
**Previous Audit:** none

## Summary

| #   | Dimension                | Score  | Grade | Delta | Critical | High | Medium | Low |
| --- | ------------------------ | ------ | ----- | ----- | -------- | ---- | ------ | --- |
| 1   | Project Topology         | 100%   | A     | n/a   | 0        | 0    | 0      | 0   |
| 2   | Documentation Quality    | 93.75% | A     | n/a   | 0        | 0    | 1      | 0   |
| 3   | Security Guardrails      | 100%   | A     | n/a   | 0        | 0    | 0      | 0   |
| 4   | AI Development Tooling   | 100%   | A     | n/a   | 0        | 0    | 0      | 0   |
| 5   | Spec-Driven Development  | 92%    | A     | n/a   | 0        | 1    | 0      | 0   |
| 6   | Code Architecture        | 71%    | C     | n/a   | 0        | 1    | 1      | 0   |
| 7   | Software Best Practices  | 91%    | A     | n/a   | 0        | 1    | 2      | 1   |
| 8   | End-to-End Delivery      | 100%   | A     | n/a   | 0        | 0    | 0      | 0   |

Issue counts reflect FAILs + WARNs only; SKIPs and PASS are not counted.

## Headline

A TypeScript library with exemplary guardrails (100% security, AI-tooling) and
spec-driven-development discipline (100% of `feat:` commits reference a spec
number and co-modify `tasks.md` with `src/`). The only dimension below B-grade
is **Code Architecture (71% — C)**, dragged down by three source files that
exceed the project's own 500-line target (`scope.ts` 827, `module.ts` 776,
`injector.ts` 734) plus five imports that bypass the `@core/index` barrel.
Both issues are already tracked as technical debt in `CLAUDE.md`, so the audit
is surfacing known-unfinished work rather than blind spots.

---

## Dimension: Project Topology

**Score:** 100% — Grade **A**

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1 | TOPO-01: Repository structure type | medium | PASS | Single `package.json` with subpath exports; no runnable service entry point — classified as library. |
| 2 | TOPO-02: Application layer inventory | medium | PASS | 4 library modules under `src/`: `core`, `parser`, `di`, `compiler`. |
| 3 | TOPO-03: Database and storage detection | medium | SKIP | No ORM, no migrations, no DB client deps — pure in-memory library. |
| 4 | TOPO-04: Infrastructure layer detection | medium | SKIP | No Dockerfile, no k8s, no Terraform — only `.github/workflows/ci.yml`. |
| 5 | TOPO-05: Language inventory | medium | PASS | TypeScript only (35 `.ts` source files + 1 config). 2 `.mjs` build configs, 81 `.md` docs. |
| 6 | TOPO-06: Inter-layer communication patterns | medium | SKIP | Single-layer library — module communication is in-process TS imports via path aliases. |

## Dimension: Documentation Quality

**Score:** 93.75% — Grade **A**

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1 | DOC-01: Root README exists and is useful | critical | PASS | 119-line `README.md` with install/test/typecheck/build commands, structure, license. |
| 2 | DOC-02: Module-level READMEs exist | high | PASS | All four subpaths (`core`, `parser`, `di`, `compiler`) have a README with entry points, exports, invariants. |
| 3 | DOC-03: API documentation is available | high | PASS | 211 TSDoc blocks across 14 source files; typed `.d.ts` ships via `package.json`. No TypeDoc site (minor, not a gap). |
| 4 | DOC-04: No stale documentation | medium | WARN | One stale claim: `README.md:108` says "883 tests across 6 test files" — actual is **16 test files / 883 tests**. Other sampled claims (commands, exports, file-size counts, `no new Function()` invariant, TTL override) verified accurate. |

## Dimension: Security Guardrails

**Score:** 100% — Grade **A**

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1 | SEC-01: `.env` files are gitignored and not tracked | critical | PASS | `.gitignore:76-77` includes `.env` and `.env.test`; zero tracked env files. |
| 2 | SEC-02: AI agent hooks restrict access to sensitive files | critical | PASS | `.claude/settings.json` PreToolUse hook `block-sensitive.sh` actively denies `.env*`, `*.pem`, `*.key`, `credentials*`, `secret*`, `*.p12`, `*.pfx`, SSH keys, `.kubeconfig`, `service-account*.json`. Verified blocking auditor probes live. |
| 3 | SEC-03: `.env.example` exists when needed | high | SKIP | No `process.env` usage in source — pure library, no runtime env vars. |
| 4 | SEC-04: No secrets in committed files | critical | PASS | Zero matches for API keys, tokens, AKIA, or private-key headers across 132 tracked files. |
| 5 | SEC-05: Sensitive-file patterns in `.gitignore` | high | PASS | `.env*`, `node_modules/`, `dist`, `coverage`, `*.log`, `.DS_Store` all covered. Stack-appropriate. |

## Dimension: AI Development Tooling

**Score:** 100% — Grade **A**

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1 | AI-01: CLAUDE.md ecosystem provides adequate AI context | critical | PASS | 66-line root `CLAUDE.md` covers purpose, commands, module map, invariants, conventions, spec workflow, and a "Where to look when…" index. |
| 2 | AI-02: Custom slash commands exist | medium | PASS | 9 AWOS commands in `.claude/commands/awos/` (product, roadmap, architecture, spec, tech, tasks, implement, verify, hire). |
| 3 | AI-03: Skills are configured | low | PASS | 3 project skills: `docs-that-work`, `gha-diagnosis`, `typescript-development`. |
| 4 | AI-04: MCP servers configured | low | PASS | `.mcp.json` declares `awos-recruitment`; `.claude/settings.local.json` enables it explicitly. |
| 5 | AI-05: Hooks are configured | low | PASS | PreToolUse `block-sensitive.sh` + PostToolUse `pnpm run format && pnpm run lint:fix`. |
| 6 | AI-06: CLAUDE.md files are meaningful and well-structured | high | PASS | 66 lines (well under 200); passes "would removing this cause mistakes?" test per line. |
| 7 | AI-07: Agent can run and observe the application | critical | PASS | Library project — `pnpm test/typecheck/lint/format/build` invokable via Bash; PostToolUse hook gives automatic feedback after every edit. |

## Dimension: Spec-Driven Development

**Score:** 92% — Grade **A**

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1 | SDD-01: AWOS installed and set up | critical | PASS | `.awos/commands/` 9 files; `.claude/commands/awos/` 9 wrappers; `context/product/` + `context/spec/` both populated. |
| 2 | SDD-02: Product context documents complete | high | PASS | product-definition.md (85 lines), roadmap.md (134 lines, 6 phases), architecture.md (70 lines, 5 sections). |
| 3 | SDD-03: Architecture doc reflects codebase reality | high | WARN | Architecture.md §5 declares **Husky + lint-staged** and **TypeDoc** — neither is in `package.json` or `.husky/`. Two phantom/aspirational entries. |
| 4 | SDD-04: Features implemented through specs | critical | PASS | 14/14 (100%) `feat:` commits in last 6 months reference a spec number explicitly. |
| 5 | SDD-05: Spec directories structurally complete | high | PASS | 11/11 (100%) spec dirs contain the full AWOS triad. |
| 6 | SDD-06: No stale or abandoned specs | medium | PASS | 10 Completed + 1 Draft (spec 011, fresh same-day add). No abandoned specs. |
| 7 | SDD-07: Meaningful agent assignments | medium | PASS | 326/395 (82.5%) sub-tasks annotated. Routing: `typescript-framework` 210, `vitest-testing` 84, `general-purpose` 16, `rollup-build` 12, `ci-tooling` 4. |

## Dimension: Code Architecture

**Score:** 71% — Grade **C**

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1 | ARCH-01: Declared or recognizable architectural pattern | high | PASS | Modular library architecture declared in `CLAUDE.md` + `package.json` exports map; each module has an `index.ts` barrel; path aliases enforced. |
| 2 | ARCH-02: Module boundaries are respected | high | WARN | Direction is correct (no `../` climbing; `parser/*` + `di/*` only reach `@core`). **But 5 files bypass the `@core/index` barrel** and import directly from `@core/utils`: `parser/lexer.ts:10`, `parser/ast.ts:10`, `parser/interpreter.ts:10`, `di/annotate.ts:11`, `di/injector.ts:15`. Violates the "prefer `@core/index`" guideline in CLAUDE.md. |
| 3 | ARCH-03: Single Responsibility Principle in modules | medium | PASS | Four coherent modules; no "god modules"; no `utils/`/`helpers/` catch-all directories. |
| 4 | ARCH-04: Separation of concerns across layers | high | SKIP | Library project — Skip-When rule applies. |
| 5 | ARCH-05: Consistent file and directory naming conventions | medium | PASS | All source files kebab-case; tests consistently under `src/<module>/__tests__/*.test.ts`; barrels uniformly `index.ts`. |
| 6 | ARCH-06: Reasonable file sizes | medium | FAIL | **3 of 19 non-test source files (15.8%) exceed 500 lines**, just over the 15% WARN ceiling: `src/core/scope.ts` (827), `src/di/module.ts` (776), `src/di/injector.ts` (734). All three are explicitly listed as refactor candidates in CLAUDE.md — tracked debt, not unnoticed. |

## Dimension: Software Best Practices

**Score:** 91% — Grade **A**

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1 | SBP-01: Linting configured and enforced | high | PASS | `eslint.config.mjs` with `typescript-eslint/strictTypeChecked`; CI gates on `pnpm lint`. |
| 2 | SBP-02: Formatting is automated | medium | WARN | Prettier configured + `format:check` in CI — but no pre-commit hook (no `.husky/`, no `lint-staged`). |
| 3 | SBP-03: Type safety is enforced | high | PASS | `strict: true` + `noUncheckedIndexedAccess: true`. Single intentional `any` cast at `src/core/utils.ts:229` (the documented ceiling). No `@ts-ignore`. **Minor sub-issue:** 4 `eslint-disable` directives lack the required `-- reason` justification (`src/core/utils.ts:91, 228, 256` + `src/core/__tests__/utils.test.ts:1235`) — direct CLAUDE.md standards violation. |
| 4 | SBP-04: Test infrastructure exists | critical | PASS | 16 test files, 883 tests, 90% line-coverage gate in `vitest.config.ts`. |
| 5 | SBP-05: CI/CD pipeline exists | high | WARN | CI runs install → lint → format:check → typecheck → test. **No `build` stage** — documented as known gap in CLAUDE.md but still a WARN. |
| 6 | SBP-06: Error handling patterns are consistent | high | PASS | Six sampled catch sites in `scope.ts` all use `console.error('<context>:', e)` per the CLAUDE.md digest contract. No silent swallowing. |
| 7 | SBP-07: Dependencies are managed | medium | WARN | `pnpm-lock.yaml` committed, `packageManager` pinned. No Renovate/Dependabot — zero update automation. |

## Dimension: End-to-End Delivery

**Score:** 100% — Grade **A**

| #   | Check | Severity | Status | Evidence |
| --- | ----- | -------- | ------ | -------- |
| 1 | E2E-01: Cross-layer feature branches | high | SKIP | Single-service library — Skip-When rule. |
| 2 | E2E-02: No layer-split branching | medium | SKIP | Single-service library. |
| 3 | E2E-03: Spec-to-delivery traceability | high | PASS | Bidirectional traceability verified on 3 sampled specs (006/009/010). 100/100 sampled tasks ticked. All `feat:` commits reference a spec; `tasks.md` co-modified with `src/` in the same atomic commit (CLAUDE.md's traceability signal). |
| 4 | E2E-04: No orphaned artifacts | medium | SKIP | Only one layer detected. |
| 5 | E2E-05: Shared ownership enablers | medium | SKIP | Single-service library. |

---

## Top Recommendations

No P0 or P1 items (no Critical FAILs, no High FAILs, no Critical WARNs). All actionable items are P2.

| #   | Priority | Effort | Dimension                | Recommendation                                                                                                                                                         |
| --- | -------- | ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | P2       | Low    | Documentation            | Fix `README.md:108` — change "883 tests across 6 test files" to "883 tests across 16 test files". Only stale claim found in DOC-04 sampling.                          |
| 2   | P2       | Low    | Software Best Practices  | Add `-- reason` justifications to the 4 bare `eslint-disable` directives (`src/core/utils.ts:91, 228, 256`; `src/core/__tests__/utils.test.ts:1235`). CLAUDE.md rule.  |
| 3   | P2       | Low    | Code Architecture        | Rewrite the 5 `@core/utils` direct imports to go through `@core/index` (`parser/lexer.ts:10`, `parser/ast.ts:10`, `parser/interpreter.ts:10`, `di/annotate.ts:11`, `di/injector.ts:15`). |
| 4   | P2       | Low    | Spec-Driven Development  | Resolve architecture.md §5 phantom tooling: either remove the **Husky + lint-staged** and **TypeDoc** entries, or add them (aligns with rec #6 and rec #8).           |
| 5   | P2       | Low    | Software Best Practices  | Add `pnpm build` as a CI stage in `.github/workflows/ci.yml` — prevents silent regressions in Rollup output and `.d.ts` emission. Job name already says "& Build".    |
| 6   | P2       | Low    | Software Best Practices  | Add `.github/dependabot.yml` (or `renovate.json`) for weekly devDependency updates. Library has zero runtime deps, so surface is small but hygiene matters.           |
| 7   | P2       | Medium | Software Best Practices  | Add `lint-staged` + `husky` (or `simple-git-hooks`) to run `prettier --write` and `eslint --fix` on staged files pre-commit. Catches "forgot to format" before CI.    |
| 8   | P2       | High   | Code Architecture        | Refactor the 3 oversized files under 500 lines: `src/core/scope.ts` (827), `src/di/module.ts` (776), `src/di/injector.ts` (734). Already tagged in CLAUDE.md.         |
