# Tasks: Validate & Remove Legacy

- **Specification:** `context/spec/005-validate-remove-legacy/`
- **Status:** Not Started

---

- [ ] **Slice 1: Utility Functions — Behavioral Parity Validation**
  - [ ] Cross-reference `legacy/src/util/__tests__/LibHelper.test.ts` against `src/core/__tests__/utils.test.ts`. List any behavioral scenarios in legacy not covered by the new suite. **[Agent: vitest-testing]**
  - [ ] Fetch `test/AngularSpec.js` from `angular/angular.js` using `gh api`. Identify utility function test scenarios (isString, isNumber, isObject, isEqual, forEach, copy, etc.) relevant to implemented functions that are missing from the new suite. **[Agent: typescript-framework]**
  - [ ] Add any missing test scenarios found. Fix implementation in `src/core/utils.ts` if any new tests fail. **[Agent: typescript-framework]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes. **[Agent: typescript-framework]**

- [ ] **Slice 2: Expression Parser — Behavioral Parity Validation**
  - [ ] Cross-reference `legacy/src/__tests__/js_legacy/parse.test.js` against new parser tests. Confirm the 3 known gaps (bare function binding to scope, bare function binding to locals, uppercase scientific notation) and identify any others. **[Agent: vitest-testing]**
  - [ ] Fetch `test/ng/parseSpec.js` from `angular/angular.js` using `gh api`. Identify parser test scenarios relevant to implemented features (literals, operators, property access, function calls, method calls, locals) that are missing from the new suite. **[Agent: typescript-framework]**
  - [ ] Add the 3 known missing test scenarios. Add any additional gaps found from the AngularJS repo. Fix parser implementation if any new tests fail. **[Agent: typescript-framework]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes. **[Agent: typescript-framework]**

- [ ] **Slice 3: Scopes & Digest Cycle — Behavioral Parity Validation**
  - [ ] Cross-reference `legacy/src/__tests__/Scope.test.ts` and `legacy/src/__tests__/js_legacy/Scope.test.js` against `src/core/__tests__/scope.test.ts`. List any behavioral scenarios in legacy not covered by the new suite. **[Agent: vitest-testing]**
  - [ ] Fetch `test/ng/rootScopeSpec.js` from `angular/angular.js` using `gh api`. Identify scope test scenarios relevant to implemented features (`$watch`, `$digest`, `$apply`, `$eval`, `$evalAsync`, `$applyAsync`, `$watchGroup`, `$watchCollection`, events, `$destroy`) that are missing from the new suite. **[Agent: typescript-framework]**
  - [ ] Add any missing test scenarios found. Fix implementation in `src/core/scope.ts` if any new tests fail. **[Agent: typescript-framework]**
  - [ ] Verify: `pnpm test` passes, `pnpm typecheck` passes. **[Agent: typescript-framework]**

- [ ] **Slice 4: Remove Legacy Folder & Full Cleanup**
  - [ ] Delete the entire `legacy/` directory. **[Agent: typescript-framework]**
  - [ ] Run `git grep legacy` on tracked files. Remove or update any stale references found in config files, documentation, spec files, and CI workflows. **[Agent: typescript-framework]**
  - [ ] Verify: `pnpm test` passes, `pnpm build` succeeds, `pnpm typecheck` passes, `git grep legacy` returns no stale references (excluding commit history). **[Agent: typescript-framework]**
