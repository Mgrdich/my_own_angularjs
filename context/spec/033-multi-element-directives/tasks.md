# Tasks: Multi-element / Ranged Directives (`*-start` / `*-end`)

- **Specification:** `context/spec/033-multi-element-directives/`
- **Status:** Draft

---

- [x] **Slice 1: Foundation + Mode A for `ng-repeat` (the canonical ranged case, end-to-end)**
  - [x] Add optional `multiElement?: boolean` to the directive surface in `src/compiler/directive-types.ts` (default `false`); normalize it in `normalizeDirective` (`compile-provider.ts`) alongside the other flags. Document it as the `-start`/`-end` opt-in. **[Agent: typescript-framework]**
  - [x] Add `UnterminatedMultiElementDirectiveError` to `src/compiler/compile-error.ts` (message names the directive + start attribute — AngularJS `$compile:uterdir` parity); re-export from `src/compiler/index.ts` and the root barrel. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/multi-element-range.ts` — `collectMultiElementRange(startElement, baseAttrName)`: walk `nextSibling` from the start element, depth-aware (increment on a nested `<base>-start`, decrement on `<base>-end`), until the matching `<base>-end` at depth zero; return the inclusive node array (elements **+ comments + text** between, so spec-031 interpolation survives). On exhausted siblings with no matching end, signal the unterminated condition for the caller to route. **[Agent: typescript-framework]**
  - [x] Wire range detection into `src/compiler/directive-collector.ts`: an attribute normalizing to `<base>Start` whose `<base>` directive is `multiElement` matches as a ranged start, with the directive's expression taken from the `-start` attribute value exposed as `attrs[base]`; recognize the bare `<base>` and `<base>End` names as the same family. **[Agent: typescript-framework]**
  - [x] Mode A wiring — generalize the `kind: 'element'` capture in `src/compiler/transclude-capture.ts` from single host to a node **range**: `defaultBucket: [...range]`, insert ONE Comment placeholder before the first range node, remove every range node. In `src/compiler/compile.ts`, build the range via `collectMultiElementRange` before the transclude pre-pass when a `multiElement` directive matches via `-start`; route an unterminated range through `$exceptionHandler('$compile')` (`UnterminatedMultiElementDirectiveError`) leaving the DOM untouched. Reuse the spec-032-cleaned re-entrancy guard (structural directive excluded from the clone). **[Agent: typescript-framework]**
  - [x] Add `multiElement: true` to the `ng-repeat` DDO (`src/compiler/ng-repeat.ts`) — no other change to its `compile`/`link`. **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/multi-element-range.test.ts`: `<tr ng-repeat-start="i in items">…</tr><tr ng-repeat-end>…</tr>` repeats the **whole** start→end group per item, in order; nodes **between** endpoints included; nested same-named ranges resolve via depth; reorder + teardown correct; missing `-end` → `UnterminatedMultiElementDirectiveError` via `'$compile'` with the DOM untouched; the single-element `ng-repeat` form is unchanged; **zero** spurious `$compile` notices (spec-032 interaction). **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Full spec 028 (`ng-repeat`) + 018 (transclusion) suites green. **[Agent: rollup-build]**

- [x] **Slice 2: Mode A for the remaining transclude built-ins — `ng-if`, `ng-switch-when`, `ng-switch-default`**
  - [x] Add `multiElement: true` to the `ng-if` DDO (`src/compiler/ng-if.ts`) and the `ng-switch-when` / `ng-switch-default` DDOs (`src/compiler/ng-switch.ts`). No link-logic change (Mode A machinery already built in Slice 1). **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/multi-element-structural.test.ts`: `ng-if-start`/`-end` mounts/unmounts the **whole range** together (toggle adds/removes every range node); `ng-switch-when-start`/`-end` and `ng-switch-default-start`/`-end` select the whole range as one case; a ranged directive nested **inside** another range works; teardown destroys the whole range's scopes; zero `$compile` noise. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Full spec 027 (`ng-if`/`ng-switch`) suite green. **[Agent: rollup-build]**

- [x] **Slice 3: Mode B — non-transclude ranged directives (`ng-show`, `ng-hide`, `ng-class`) + custom opt-in**
  - [x] Mode B wiring in `src/compiler/compile.ts`: for a `multiElement` directive that does NOT declare `transclude`, apply the directive to **each node** in the range — propagate the start element's attribute value as `attrs[base]` on each grouped node so the normal per-element link applies the directive there (one watch per node, all bound to the same expression). Document the deliberate clarity-over-performance choice (AngularJS links once against a node collection; we link per node — identical observable behavior). **[Agent: typescript-framework]**
  - [x] Add `multiElement: true` to `ng-show` (`src/compiler/ng-show.ts`), `ng-hide` (`src/compiler/ng-hide.ts`), and `ng-class` (`src/compiler/ng-class.ts`). **[Agent: typescript-framework]**
  - [x] Create `src/compiler/__tests__/multi-element-attr.test.ts`: `ng-show-start`/`-end` and `ng-hide-start`/`-end` show/hide **every** node in the range together; `ng-class-start`/`-end` applies the computed classes to every range node; a **custom developer directive** with `multiElement: true` (non-transclude) works in the ranged form; the single-element forms of all three built-ins unchanged; missing `-end` errors. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Full spec 023 (`ng-show`/`ng-hide`) + 024 (`ng-class`) suites green. **[Agent: rollup-build]**

- [x] **Slice 4: Docs & final regression**
  - [x] Update `src/compiler/README.md` — new "Multi-element / ranged directives (spec 033)" section: the `multiElement` flag, the depth-aware `-start`/`-end` range scan, Mode A (range capture → one placeholder → clone the whole range) vs Mode B (per-node link), the unterminated-range error, the parity built-in set, worked `<tr ng-repeat-start>` example. **[Agent: typedoc-docs]**
  - [x] Update `CLAUDE.md`: amend the `./compiler` Modules row; add "Non-obvious invariants" bullets — (a) the `multiElement` flag + depth-aware range grouping (`multi-element-range.ts`), (b) Mode A generalizes the element-transclude bucket from `[host]` to `[...range]` with one Comment placeholder, (c) Mode B links the directive per range node (clarity-over-performance), (d) unterminated range → `UnterminatedMultiElementDirectiveError` via `'$compile'` (tuple stays at 10); add "Where to look when…" rows for `multi-element-range.ts` and the range-capture path. Tick the spec-033 roadmap item in `context/product/roadmap.md`. **[Agent: typedoc-docs]**
  - [x] TSDoc audit on the new public surface (`UnterminatedMultiElementDirectiveError`, `multiElement` field, `collectMultiElementRange`), each with a runnable `@example`. **[Agent: typedoc-docs]**
  - [x] Final regression: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All five gates pass; spec 017/018/023/024/027/028/031/032 suites green; `EXCEPTION_HANDLER_CAUSES.length === 10` in source and built output; `UnterminatedMultiElementDirectiveError` exported from both `dist` root entries. **[Agent: rollup-build]**

---

## Notes for the Implementation Agent

- **Prerequisite spec 032 is merged** — the clone re-link is already noise-free and the same-element conflict already errors, so Mode A ranged rows/branches inherit clean behavior. Do not reintroduce the strip-and-keep re-entrancy behavior.
- **One new error class, no new cause token.** `UnterminatedMultiElementDirectiveError` routes via the existing `'$compile'`. `EXCEPTION_HANDLER_CAUSES` stays at 10.
- **Single-element form is sacred.** `multiElement` only activates on the `-start` suffix; every directive's ordinary form must stay byte-identical (the spec 023/024/027/028 suites are the regression gate).
- **Range includes non-element nodes** (text/comments between endpoints) so spec-031 interpolation and comments survive cloning.
- **Mode B is per-node** by design (one watch per grouped node) — assert identical observable behavior, not a single shared watch.
- **Tick task checkboxes in the SAME commit as the implementation** per `CLAUDE.md`.
