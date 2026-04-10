# Technical Specification: Validate & Remove Legacy

- **Functional Specification:** `context/spec/005-validate-remove-legacy/functional-spec.md`
- **Status:** Completed
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

This is a validation and cleanup task, not a feature build. The approach is:

1. **Cross-reference** each module's new test suite against both the legacy tests in `legacy/` and the original AngularJS test suite on GitHub (`angular/angular.js`), identifying any behavioral scenarios not yet covered.
2. **Fix gaps** by adding missing tests and correcting implementation behavior where needed.
3. **Delete** the entire `legacy/` directory.
4. **Clean up** all remaining references to `legacy/` in tracked files.

No architectural changes are needed. The existing `src/` structure, build pipeline, and CI workflow remain unchanged.

---

## 2. Proposed Solution & Implementation Plan

### Component Breakdown

**Module 1: Scopes (`src/core/scope.ts`)**

- **Legacy tests:** `legacy/src/__tests__/Scope.test.ts` (13 tests), `legacy/src/__tests__/js_legacy/Scope.test.js` (96 tests)
- **New tests:** `src/core/__tests__/scope.test.ts` (101 tests)
- **Reference:** `angular/angular.js` — `test/ng/rootScopeSpec.js`
- **Known gaps:** None identified from legacy comparison. Cross-reference against `rootScopeSpec.js` may reveal additional scenarios for implemented features (`$watch`, `$digest`, `$apply`, `$eval`, `$evalAsync`, `$applyAsync`, `$watchGroup`, `$watchCollection`, events, lifecycle).
- **Action:** Fetch and compare against `rootScopeSpec.js`. Add any missing behavioral scenarios. Fix implementation if needed.

**Module 2: Expression Parser (`src/parser/`)**

- **Legacy tests:** `legacy/src/__tests__/js_legacy/parse.test.js` (47 tests)
- **New tests:** `src/parser/__tests__/parse.test.ts` (42 tests)
- **Reference:** `angular/angular.js` — `test/ng/parseSpec.js`
- **Known gaps from legacy comparison:**
  - Bare function binding to scope (`binds a bare function to the scope`)
  - Bare function binding to locals (`binds a bare function on locals to the locals`)
  - Uppercase scientific notation (`parses upper case scientific notation`)
- **Action:** Add the 3 missing test scenarios. Fix parser implementation if any fail. Additionally, cross-reference against `parseSpec.js` for any other missing scenarios relevant to implemented features.

**Module 3: Utility Functions (`src/core/utils.ts`)**

- **Legacy tests:** `legacy/src/util/__tests__/LibHelper.test.ts` (34 tests)
- **New tests:** `src/core/__tests__/utils.test.ts` (160 tests)
- **Reference:** `angular/angular.js` — `test/AngularSpec.js` (utility functions section)
- **Known gaps:** None — new suite exceeds legacy coverage significantly.
- **Action:** Cross-reference against `AngularSpec.js` for any edge cases not yet covered. Add if found.

**Cleanup: Remove Legacy Folder**

- Delete `legacy/` directory entirely (includes `legacy/src/`, `legacy/.eslintrc`, `legacy/jest.config.js`, `legacy/webpack.config.js`)
- Run `git grep legacy` on tracked files to find stale references
- Remove any found references in spec docs, CLAUDE.md, configs, or CI files

### Key Implementation Details

| Step | Files Affected | Agent |
|---|---|---|
| Scope parity validation | `src/core/__tests__/scope.test.ts`, `src/core/scope.ts` (if gaps found) | vitest-testing, typescript-framework |
| Parser parity validation | `src/parser/__tests__/parse.test.ts`, parser source files (if gaps found) | vitest-testing, typescript-framework |
| Utils parity validation | `src/core/__tests__/utils.test.ts`, `src/core/utils.ts` (if gaps found) | vitest-testing, typescript-framework |
| Delete legacy folder | `legacy/` (entire directory) | typescript-framework |
| Reference cleanup | Any file referencing `legacy/` | typescript-framework |

---

## 3. Impact and Risk Analysis

### System Dependencies

- **No runtime dependencies on legacy.** The `legacy/` folder is not imported by any `src/` code — it exists only as a reference. Deletion has zero runtime impact.
- **CI/Build pipeline:** No CI steps reference the `legacy/` folder. No impact expected.
- **Spec documents:** Some earlier functional specs reference `legacy/` paths as context. These references should be removed or updated.

### Potential Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| AngularJS repo test files are large and cover features not yet implemented | Low — wasted effort comparing irrelevant tests | Only compare scenarios for features we've implemented (Scopes, Parser basics, Utilities). Skip tests for DI, Directives, HTTP, etc. |
| Fixing parser gaps could require non-trivial implementation changes | Medium — could expand scope | If a gap requires significant new parser features (not just bug fixes), document it and defer to a future spec |
| Stale references to `legacy/` hidden in unexpected files | Low — causes confusion | Use `git grep legacy` to catch all occurrences. Review each match before removing. |

---

## 4. Testing Strategy

- **Approach:** The entire spec IS a testing task. Each module validation slice produces new/updated tests.
- **Framework:** Vitest with existing `describe`/`it`/`expect` patterns
- **Validation method:** For each module, compare test describe block topics and individual scenarios between legacy/reference and new. Add missing scenarios as new `it` blocks in existing test files.
- **Final verification:** After all gaps are fixed and legacy is removed, run the full CI pipeline (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) to confirm nothing is broken.
- **Coverage:** Verify 90%+ coverage on core modules after cleanup.
