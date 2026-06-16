<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: Structural-Directive Correctness

- **Functional Specification:** `context/spec/032-structural-directive-correctness/functional-spec.md`
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

Two independent, surgical fixes in the compiler — no public-surface change, no new error classes, no new `EXCEPTION_HANDLER_CAUSES` entry.

1. **Same-element structural conflict (FS §2.1).** Today the spec-017 terminal cutoff in `directive-collector.ts` runs *before* the spec-018 multi-transclude detection in `compile.ts`, so the lower-priority structural directive is dropped at collection time and the conflict is never reported. Fix: ensure a second `transclude`-declaring directive **survives collection** so the existing `MultipleTranscludeDirectivesError` path in `compile.ts` fires.
2. **Clone-relink internal-error noise (FS §2.2).** The element-transclude re-entrancy guard in `compile.ts` strips only `transclude` on the re-entrant master pass, leaving the structural directive's **link** in the clone's linker — so it re-runs on a cloned `Element` and throws "expected placeholder to be a Comment" (caught + routed via `'$compile'` on every row/mount). Fix: **exclude the structural directive entirely** from the re-entrant master's directive list (its job — creating the placeholder — is already done; the clone is only its content).

**Affected systems:** `@compiler` only (`directive-collector.ts`, `compile.ts`). The structural directive files (`ng-if.ts`, `ng-repeat.ts`, `ng-switch.ts`, `ng-include.ts`) are unchanged — their link guards stay as a defensive backstop.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 Same-element conflict surfaces the documented error — `src/compiler/directive-collector.ts`

| Change | Detail |
| --- | --- |
| Terminal cutoff must not hide a transclude conflict | In `applySortAndTerminalCutoff` (`directive-collector.ts:159-182`), a directive whose `transclude !== undefined` must not be silently dropped by the terminal cutoff when a higher-priority transclude directive already sits in the kept list. Keep both transclude-declaring directives in the returned list (a narrow exception to the priority-`break`), so the downstream guard can see the conflict. The cutoff continues to drop ordinary lower-priority directives unchanged. |
| Where the error is raised | No change here — `compile.ts`'s existing per-element loop (`compile.ts:948-960`) already detects "a second directive with `transclude`" and routes `MultipleTranscludeDirectivesError(first, second)` via `$exceptionHandler('$compile')`, then strips the second's `transclude`. Once both reach that loop, the documented error fires for `<div ng-if ng-repeat>` and every other structural pairing. |
| Non-goal | Do **not** broaden the terminal semantic for non-transclude directives — the spec-017 `terminal.test.ts` contract ("terminal drops lower-priority same-element directives") must stay green for ordinary terminal directives. |

### 2.2 Clone re-link no longer re-runs the structural directive — `src/compiler/compile.ts`

| Change | Detail |
| --- | --- |
| Exclude, don't strip | In the re-entrancy guard (`compile.ts:931-947`), the branch that today builds `stripped = { ...directive, transclude: undefined }` and pushes it must instead **skip the directive entirely** (do not add it to `effectiveDirectives`) when `alreadyElementTranscluded === directive.name && directive.transclude.kind === 'element'`. The re-entrant master pass then compiles only the **content** of the host — the structural directive contributes no compile fn, no link fn, no controller to the clone. |
| Why it's correct | The OUTER pass keeps the directive intact: it captures the host, installs the Comment placeholder, and the placeholder's linker runs the directive's link against the `Comment` (correct). The clone produced by `$transclude(...)` is the row/branch content and must NOT re-run `ng-repeat`/`ng-if` — so excluding it is the AngularJS-equivalent of compiling the transcluded content with the structural directive removed (their `maxPriority`/`terminalPriority` mechanism). |
| Result | The structural directive's link never executes against a cloned `Element`, so the "expected placeholder to be a Comment" throw is never produced — zero `$exceptionHandler` invocations on correct usage. The link-time guards in `ng-if.ts:159` / `ng-repeat.ts:201` / `ng-switch.ts` remain as defensive backstops (now unreachable on the happy path). |
| Re-entrancy preserved | Excluding the directive keeps `transcludingDirective === null` on the re-entrant pass, so no re-capture occurs — the infinite-recursion guard's original purpose is preserved (strengthened, even). |

### 2.3 Logic / contracts (shared)

- **No public-surface change.** `$compile`'s `Linker` signature, `Attributes`, `$compileProvider`, and every directive DDO are untouched.
- **No new error class / cause token.** Issue 1 reuses the existing `MultipleTranscludeDirectivesError` + `'$compile'`; issue 2 *removes* error emissions. `EXCEPTION_HANDLER_CAUSES` stays at 10.
- **DOM output unchanged.** Both fixes are about *when/whether the structural directive's link runs* and *whether the conflict is reported* — never about the produced DOM, updates, teardown, or row reuse.

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `directive-collector.ts` (collection + terminal cutoff), `compile.ts` (re-entrancy guard, multi-transclude guard, clone re-link). Consumers: `ng-if`, `ng-repeat`, `ng-switch`, `ng-include`.
- **Potential Risks & Mitigations:**
  - **Terminal-cutoff exception is too broad** — could keep directives that should be dropped. *Mitigation:* gate the exception strictly on `transclude !== undefined` (not on `terminal`); pin `terminal.test.ts` (spec 017) and the full spec-018 transclusion suite as regression gates.
  - **Excluding the structural directive on the clone removes needed behavior** — *Mitigation:* the structural directives carry no other compile/link/controller behavior that the clone needs (verified: their entire job is placeholder + `$transclude`); the full spec-027 / 028 suites (mount, update, teardown, reorder, focus/scroll preservation, object iteration, `track by`) are the regression gate. DOM output must be byte-identical.
  - **A real app relied on the swallowed error** — implausible (it was caught + logged only). *Mitigation:* documented as a fix; no behavioral output change.
  - **Interaction with spec 031 interpolation** — interpolated `{{ }}` inside `ng-repeat`/`ng-if` clones (spec 031 tests) must keep rendering and now additionally emit **zero** `$compile` notices. *Mitigation:* extend the spec-031 transclusion tests with a zero-handler-call assertion.

---

## 4. Testing Strategy

- **Framework:** Vitest + jsdom; maintain 90%+ coverage on `compiler`.
- **Reference parity:** AngularJS reports "Multiple directives ... asking for transclusion" for the same-element conflict; mirror with `MultipleTranscludeDirectivesError`.
- **Coverage mapped to acceptance criteria:**
  - **Conflict (FS §2.1):** `<div ng-if ng-repeat>` routes `MultipleTranscludeDirectivesError` via `$exceptionHandler('$compile')` naming both directives (it must NOT silently render with one applied); repeat for `ng-if`+`ng-include`, `ng-repeat`+`ng-switch-when`; the nested workaround renders correctly.
  - **Zero noise (FS §2.2):** spy the resolved `$exceptionHandler` (default `console.error`) and assert **zero** calls for a correct `<li ng-repeat>{{x}}</li>` rendering N rows; same for `ng-if`/`ng-switch`/`ng-include` across mount → update → teardown. (This is the exact measurement that surfaced the bug during spec 031 verification.)
  - **No-regression:** full spec 017 (`terminal.test.ts`), 018, 023, 027, 028, 031 suites green; DOM output, live updates, teardown, and `ng-repeat` reorder/focus/scroll preservation unchanged.
