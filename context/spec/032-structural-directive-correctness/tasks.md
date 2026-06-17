# Tasks: Structural-Directive Correctness

- **Specification:** `context/spec/032-structural-directive-correctness/`
- **Status:** Draft

---

- [x] **Slice 1: Zero-noise clone re-linking (FS §2.2) — structural directive no longer re-runs on its clones**
  - [x] In `src/compiler/compile.ts`, change the element-transclude re-entrancy guard (~`compile.ts:931-947`) so the re-entrant branch (`alreadyElementTranscluded === directive.name && directive.transclude.kind === 'element'`) **skips the directive entirely** — do not push `{ ...directive, transclude: undefined }` into `effectiveDirectives`. The re-entrant master pass then compiles only the host's content (no structural compile/link/controller on the clone). Confirm `transcludingDirective` stays `null` on the re-entrant pass (re-capture guard preserved). Update the surrounding TSDoc (it currently says "the directive's other behavior … still applies to the master") to describe the exclusion + why. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/structural-clone-noise.test.ts` using the `console.error`-spy harness (the exact measurement from spec 031 verification — register a spying `$exceptionHandler` / spy `console.error`, count "expected placeholder" + total calls). Assert **zero** handler calls for: a correct `<li ng-repeat="x in xs">{{x}}</li>` rendering N rows; `ng-if` mount → update → teardown; `ng-switch` case switch; `ng-include` load. Assert DOM output, live updates, and teardown are unchanged (rows render, conditions mount/unmount). **[Agent: vitest-testing]**
  - [x] Extend the spec-031 transclusion cases (`src/compiler/__tests__/text-interpolate.test.ts` and/or `spec031-parity.test.ts`) with a zero-handler-call assertion for `{{ }}` inside `ng-if`/`ng-repeat` clones (closes the spec-031-interaction risk). **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **Regression gate:** full spec 027 / 028 suites green — DOM output, reorder, focus/scroll preservation, object iteration, `track by` all byte-identical. **[Agent: rollup-build]**

- [x] **Slice 2: Same-element structural conflict reports a clear error (FS §2.1)**
  - [x] In `src/compiler/directive-collector.ts` `applySortAndTerminalCutoff` (~`directive-collector.ts:159-182`), add a narrow exception so a directive with `transclude !== undefined` is **not** dropped by the terminal cutoff when a higher-priority transclude directive is already in the kept list — both transclude directives survive collection and reach `compile.ts`'s existing multi-transclude guard (`compile.ts:948-960`), which already routes `MultipleTranscludeDirectivesError(first, second)` via `$exceptionHandler('$compile')`. Gate the exception strictly on `transclude !== undefined` (NOT on `terminal`). Update the helper's TSDoc. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/structural-conflict.test.ts`: `<div ng-if="a" ng-repeat="x in xs">` routes `MultipleTranscludeDirectivesError` via `$exceptionHandler('$compile')` naming both directives, and does **not** silently render with only one applied; repeat for `ng-if`+`ng-include` and `ng-repeat`+`ng-switch-when`; the nested workaround (`<div ng-if><div ng-repeat>…`) renders correctly. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **Critical regression gate:** `src/compiler/__tests__/terminal.test.ts` (spec 017 — ordinary `terminal: true` still drops lower-priority same-element directives) stays green; full spec-018 transclusion suite green. **[Agent: rollup-build]**

- [x] **Slice 3: Docs & final regression**
  - [x] Update `CLAUDE.md`: amend the "Non-obvious invariants" bullets — (a) the element-transclude re-entrancy guard now **excludes** the structural directive on the re-entrant pass (was: stripped `transclude` only) so its link never re-runs on clones; (b) two structural directives on one element now surface `MultipleTranscludeDirectivesError` — **revise the spec-027 "known gap" bullet and the spec-028 `priority: 1000` bullet** that currently document the silent-drop behavior. **[Agent: typedoc-docs]**
  - [x] Tick the spec-032 roadmap item in `context/product/roadmap.md`. **[Agent: typedoc-docs]**
  - [x] Final regression: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All five gates pass; spec 017/018/023/027/028/031 suites green; `EXCEPTION_HANDLER_CAUSES.length === 10` held in source and built output; no new error class / cause token. **[Agent: rollup-build]**

---

## Notes for the Implementation Agent

- **No public-surface change, no new error class, no new cause token.** Issue 1 reuses `MultipleTranscludeDirectivesError` + `'$compile'`; issue 2 *removes* error emissions. `EXCEPTION_HANDLER_CAUSES` stays at 10.
- **DOM output must be byte-identical.** Both fixes change *whether/when the structural directive's link runs* and *whether the conflict is reported* — never the produced DOM, updates, teardown, or row reuse. The spec 027/028 suites are the regression gate.
- **The link-time guards stay** (`ng-if.ts:159`, `ng-repeat.ts:201`, `ng-switch.ts`) as defensive backstops — now unreachable on the happy path; do not remove them.
- **This spec is the prerequisite for 033 (multi-element directives)** — its ranged transclude path reuses the cleaned-up clone re-link machinery.
- **Tick task checkboxes in the SAME commit as the implementation** per `CLAUDE.md`.
