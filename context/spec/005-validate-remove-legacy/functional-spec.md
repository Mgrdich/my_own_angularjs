# Functional Specification: Validate & Remove Legacy

- **Roadmap Item:** Validate test parity and remove the legacy folder (Phase 0 — Legacy Migration & Fresh Start)
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

The project has completed reimplementation of all Phase 0 features — Scopes & Digest Cycle, Expression Parser, and Utility Functions — in clean TypeScript. The original code still exists in the `legacy/` folder, which was kept as a behavioral reference during reimplementation.

**Problem:** The `legacy/` folder adds confusion (two implementations of everything), bloats the repository, and cannot be removed until we are confident that the new code matches the original behavior. Without formal validation, subtle behavioral differences could go unnoticed and surface as bugs when building Phase 1+ modules on top.

**Desired outcome:** Confirm that all three reimplemented modules exhibit behavioral parity with the original AngularJS implementation, fix any gaps found, then fully remove the `legacy/` folder and all references to it — completing the "Legacy Migration & Fresh Start" phase.

**Success criteria:** All behavioral test scenarios from both the legacy folder tests and the original AngularJS repo are covered by the new test suite. After validation, the `legacy/` folder is deleted and no legacy references remain in configs, docs, or CI.

---

## 2. Functional Requirements (The "What")

### 2.1 Behavioral Parity Validation — Scopes & Digest Cycle

Cross-reference the legacy test files (`legacy/src/__tests__/Scope.test.ts`, `legacy/src/__tests__/js_legacy/Scope.test.js`) and the original AngularJS scope test suite against `src/core/__tests__/scope.test.ts`. Identify any test scenarios present in the legacy/reference that are missing from the new suite.

**Acceptance Criteria:**

- [ ] All behavioral scenarios from the legacy Scope tests are covered by the new test suite
- [ ] All behavioral scenarios from the original AngularJS Scope test suite (relevant to implemented features) are covered
- [ ] Any gaps found are fixed (new tests added, implementation corrected if needed) before proceeding
- [ ] `pnpm test` passes with all Scope tests green

### 2.2 Behavioral Parity Validation — Expression Parser

Cross-reference the legacy parser test file (`legacy/src/__tests__/js_legacy/parse.test.js`) and the original AngularJS parser test suite against the new parser tests. Identify any test scenarios present in the legacy/reference that are missing.

**Acceptance Criteria:**

- [ ] All behavioral scenarios from the legacy parser tests are covered by the new test suite
- [ ] All behavioral scenarios from the original AngularJS parser test suite (relevant to implemented features) are covered
- [ ] Any gaps found are fixed before proceeding
- [ ] `pnpm test` passes with all parser tests green

### 2.3 Behavioral Parity Validation — Utility Functions

Cross-reference the legacy utility test file (`legacy/src/util/__tests__/LibHelper.test.ts`) and the original AngularJS utility functions against `src/core/__tests__/utils.test.ts`. Identify any test scenarios present in the legacy/reference that are missing.

**Acceptance Criteria:**

- [ ] All behavioral scenarios from the legacy utility tests are covered by the new test suite
- [ ] All behavioral scenarios from the original AngularJS utility functions (relevant to implemented functions) are covered
- [ ] Any gaps found are fixed before proceeding
- [ ] `pnpm test` passes with all utility tests green

### 2.4 Remove Legacy Folder

Once all three modules pass parity validation, delete the entire `legacy/` directory.

**Acceptance Criteria:**

- [ ] The `legacy/` directory is completely removed from the repository
- [ ] No files in the repository reference or import from `legacy/`
- [ ] `pnpm test` passes after removal
- [ ] `pnpm build` succeeds after removal
- [ ] `pnpm typecheck` passes after removal

### 2.5 Full Cleanup of Legacy References

Remove any remaining references to the legacy folder from configs, documentation, CI workflows, and other project files.

**Acceptance Criteria:**

- [ ] No references to `legacy/` remain in any config file (tsconfig, eslint, vitest, rollup, package.json)
- [ ] No references to `legacy/` remain in any documentation file (CLAUDE.md, README, spec files)
- [ ] No references to `legacy/` remain in CI/CD workflows
- [ ] The repository is clean — `git grep legacy` (tracked files only) returns no stale references

---

## 3. Scope and Boundaries

### In-Scope

- Behavioral parity validation for all three reimplemented modules (Scopes, Parser, Utilities)
- Cross-referencing both the legacy folder tests and the original AngularJS repo test suite
- Fixing any behavioral gaps discovered during validation
- Complete removal of the `legacy/` directory
- Full cleanup of all legacy references across the codebase

### Out-of-Scope

- **Scopes & Digest Cycle (remaining)** — Phase tracking (`$beginPhase`, `$clearPhase`, `$$postDigest`) and TTL configuration are Phase 1 items
- **Dependency Injection** — Module system, injector, providers are Phase 1 items
- **Expressions & Parser enhancements** — One-time bindings, interpolation are Phase 2 items
- **Filters** — Filter registration and built-in filters are Phase 2 items
- **Directives & DOM Compilation** — Compiler, linking, transclusion are Phase 2 items
- **HTTP & Networking** — `$http` service is a Phase 3 item
- **Forms & Validation** — ngModel, validators are Phase 3 items
- **Routing, Animations, Package & Distribution** — Phase 4 items
