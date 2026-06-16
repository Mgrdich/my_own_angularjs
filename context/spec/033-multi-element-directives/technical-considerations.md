<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: Multi-element / Ranged Directives (`*-start` / `*-end`)

- **Functional Specification:** `context/spec/033-multi-element-directives/functional-spec.md`
- **Status:** Draft
- **Author(s):** Mgrdich

---

## 1. High-Level Technical Approach

AngularJS handles ranged directives by, during directive collection, detecting an attribute whose normalized name ends in `Start`, scanning forward to the matching `…End` sibling, and grouping the whole range into one node collection that the directive operates on. We mirror that, adapted to this codebase's seams:

1. A new opt-in `multiElement: boolean` flag on the directive definition. The seven built-ins (`ng-repeat`, `ng-if`, `ng-show`, `ng-hide`, `ng-switch-when`, `ng-switch-default`, `ng-class`) set it.
2. A **grouping pass** in the compiler: when an element carries `<name>-start` for a `multiElement` directive, collect the start element through the matching depth-aware `<name>-end` sibling (inclusive) into a node range; a missing end is a clear compile-time error.
3. **Two integration modes** for the grouped range, reusing existing machinery:
   - `transclude: 'element'` directives (`ng-if`, `ng-repeat`, `ng-switch-when`, `ng-switch-default`) → capture the **whole range** as the transclusion master (generalizing today's single-host `defaultBucket: [host]` to `[...range]`), replace the range with one Comment placeholder, and let `$transclude` clone the whole range per iteration/branch.
   - non-transclude directives (`ng-show`, `ng-hide`, `ng-class`) → apply the directive to **every node** in the range (each grouped node links the directive with the start element's expression), so the effect covers the whole group.

**Prerequisite:** spec 032 (structural-directive correctness). The ranged transclude path reuses the same clone re-link machinery; without 034's cleanup, every ranged row/branch would also emit the spurious `$compile` notice.

**Affected systems:** `@compiler` (`directive-types.ts`, `directive-collector.ts`, `transclude-capture.ts`, `compile.ts`, `compile-error.ts`). The seven built-in directive files gain only the `multiElement: true` flag — their link logic is unchanged.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 `multiElement` flag — `src/compiler/directive-types.ts`

| Change | Detail |
| --- | --- |
| New DDO field | Add optional `multiElement?: boolean` to the `Directive` / `DirectiveDefinition` surface (default `false`). Normalized by `normalizeDirective` like the other flags. Documented as the opt-in for ranged `-start`/`-end` support. |
| Built-ins | The seven built-in factories add `multiElement: true` to their returned DDO. No other change to their `compile`/`link`. |

### 2.2 Range detection + grouping — `src/compiler/directive-collector.ts` (+ new helper)

| Change | Detail |
| --- | --- |
| Start-name recognition | In the attribute pass, an attribute normalizing to `<base>Start` is a candidate ranged match: look up the `<base>` directive; if it is `multiElement`, record it as matching this (start) element, with the directive's expression taken from the `-start` attribute's value, exposed as `attrs[base]`. The bare `<base>` and `<base>End` names are recognized as part of the same family. |
| Grouping helper | New `collectMultiElementRange(startElement, baseAttrName)` (own file, e.g. `multi-element-range.ts`): walk `nextSibling` from the start element, incrementing depth on a nested `<base>-start` and decrementing on `<base>-end`, until depth returns to zero at the matching end; return the inclusive node array (elements + comments + text between, so spec-031 interpolation inside the range works). |
| Unterminated error | If siblings are exhausted before the matching `-end`, report a clear `UnterminatedMultiElementDirectiveError` (new class in `compile-error.ts`, message names the directive + start attribute — AngularJS `$compile:uterdir` parity) via `$exceptionHandler('$compile')`. |

### 2.3 Walker integration — `src/compiler/compile.ts` + `src/compiler/transclude-capture.ts`

| Change | Detail |
| --- | --- |
| Form the group | When `compileElementOrComment` encounters an element matched by a `multiElement` directive via `-start`, build the range via `collectMultiElementRange` before the transclude pre-pass. |
| Mode A — `transclude: 'element'` | Generalize the `kind: 'element'` capture in `transclude-capture.ts` to accept a node **range**: `defaultBucket: [...range]` (instead of `[host]`), insert ONE Comment placeholder before the first range node, and remove EVERY range node from the DOM. Everything downstream (placeholder linker, `$transclude` deep-clone of the bucket, spec-034 clone re-link, `addElementCleanup`) already handles a multi-node bucket — the master fragment is simply N nodes instead of 1. The directive's link still receives the single Comment placeholder. |
| Mode B — non-transclude | For a `multiElement` directive that does NOT declare `transclude`, attach the directive to each node in the range: propagate the start element's attribute value as `attrs[base]` on each grouped node and let the normal per-element link apply the directive there. Net effect: one watch per grouped node, all bound to the same expression, so `ng-show`/`ng-hide`/`ng-class` toggle/style the whole range together. Deliberate clarity-over-performance choice (AngularJS links once against a node collection; we link per node — identical observable behavior). |
| Re-entrancy / terminal | Mode A reuses the spec-034-cleaned re-entrancy guard (the structural directive is excluded from the clone of the range, so it does not re-fire). The same-element multi-structural conflict detection (spec 032) still applies if two structural directives target the same start element. |

### 2.4 Logic / contracts (shared)

- **Single-element form unchanged.** A directive used without `-start`/`-end` compiles and links exactly as today; `multiElement` only activates on the `-start` suffix.
- **No new cause token.** The one new error class (`UnterminatedMultiElementDirectiveError`) routes via the existing `'$compile'` cause. `EXCEPTION_HANDLER_CAUSES` stays at 10.
- **Public `Linker` signature unchanged.** Mode A links against the Comment placeholder (as element-transclude does today); Mode B links against each real Element. No jqLite node-collection type is introduced.

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `directive-collector.ts`, `transclude-capture.ts`, `compile.ts`, `compile-error.ts`, `directive-types.ts`; the seven built-in directive files (flag only). Hard prerequisite: **spec 032**.
- **Potential Risks & Mitigations:**
  - **Depth tracking for nested same-named ranges** (`ng-repeat-start` inside another `ng-repeat-start`) — *Mitigation:* depth counter in `collectMultiElementRange`; explicit nested-range tests.
  - **Range spans non-element nodes** (whitespace/text/comments between `<tr>`s) — *Mitigation:* include all node types in the bucket so spec-031 text interpolation and comments inside the range survive cloning; tested.
  - **Mode B per-node watches diverge from single-collection semantics** — *Mitigation:* documented as an intentional clarity-over-performance deviation; assert identical observable behavior (all range nodes toggle/style together) in tests.
  - **Interaction with the same-element terminal cutoff** — a `-start` element may also carry other directives; *Mitigation:* grouping runs alongside normal collection; reuse spec-034 conflict detection; pin spec-017/027/028 suites.
  - **Unterminated range corrupts the DOM** — *Mitigation:* detect + error before any capture/removal; leave the DOM untouched on the error path.

---

## 4. Testing Strategy

- **Framework:** Vitest + jsdom; maintain 90%+ coverage on `compiler`.
- **Reference parity:** AngularJS `compileSpec.js` multiElement section + each directive's `*-start`/`*-end` spec.
- **Coverage mapped to acceptance criteria:**
  - **ng-repeat-start/end:** `<tr ng-repeat-start>…</tr><tr ng-repeat-end>…</tr>` repeats the whole group per item, in order; nodes between endpoints included; reorder/teardown correct.
  - **ng-if-start/end:** mounts/unmounts the whole range together; toggling adds/removes all range nodes.
  - **ng-show/ng-hide-start/end:** show/hide all range nodes together.
  - **ng-switch-when/default-start/end:** whole range selected as one case.
  - **ng-class-start/end:** computed classes applied to every range node.
  - **Nesting:** ranged directive inside a range; nested same-named ranges resolve via depth.
  - **Errors:** missing `-end` → `UnterminatedMultiElementDirectiveError` via `'$compile'`, DOM untouched.
  - **Additivity:** single-element form of all seven directives unchanged (full spec 023/024/027/028 suites green).
  - **Custom opt-in:** a developer directive with `multiElement: true` works in the ranged form.
  - **No-regression + spec 031/034:** interpolation inside a range renders; zero spurious `$compile` notices (depends on 034).
