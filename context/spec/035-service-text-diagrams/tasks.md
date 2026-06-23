# Tasks: Per-Service Text Diagrams (Phase 2 Wrap-Up)

- **Specification:** `context/spec/035-service-text-diagrams/`
- **Status:** Draft

---

- [x] **Slice 1: Scaffold + convention + structural test + first exemplar diagram**
  - [x] Create `context/diagrams/README.md` (index): legend for the Unicode box-drawing notation, a one-line "how the services fit together" intro, a maintenance note (service-changing specs must co-update the matching diagram), and a links table seeded with the first diagram. **[Agent: typedoc-docs]**
  - [x] Author `context/diagrams/scope-and-digest.md` as the **exemplar** — the canonical five-section layout (`## Purpose` → `## Collaborators & call order` → `## Using it the primary way` → `## Using it the dependency-injection way` → `## Related diagrams`), Unicode box-drawing diagram **inside a fenced code block** (so Prettier leaves it untouched), and minimal ESM + DI snippets verified against `src/core` exports. **[Agent: typedoc-docs]**
  - [x] Add a `## Where to look when…` row in `CLAUDE.md` for the index page and the `scope-and-digest.md` diagram (coarse "whole-service picture" entries). **[Agent: typedoc-docs]**
  - [x] Create the structural Vitest test (`src/__tests__/diagrams-structure.test.ts`; confirm the vitest `include` glob picks it up): globs `context/diagrams/*.md`, and for every service file asserts the five required headings exist in order, its `## Related diagrams` links resolve to existing files, it is linked from `README.md`, and `CLAUDE.md` references it. Imports no `src/` runtime → no coverage impact. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Structural test green. **[Agent: rollup-build]**

- [x] **Slice 2: Foundational services (no/few collaborators)**
  - [x] Author `expression-parser.md`, `injector-and-modules.md`, `exception-handler.md` against the shared layout. For `exception-handler.md` (DI-only surface), the "primary way" section explicitly states the service is reached via DI / the default `consoleErrorExceptionHandler` export rather than being omitted. **[Agent: typedoc-docs]**
  - [x] Add the three files to the `README.md` index table and add three `CLAUDE.md` rows. **[Agent: typedoc-docs]**
  - [x] Confirm the structural test stays green over the now-larger file set (no test edits expected — it's glob-driven). **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **[Agent: rollup-build]**

- [x] **Slice 3: Expression / templating layer**
  - [x] Author `interpolate.md`, `sce.md`, `sanitize.md`. Diagrams show the cross-service seams: `$interpolate` → `$sce.getTrusted*`, and the lazy `$injector.has('$sanitize')` probe from `$SceProvider.$get` (use the dashed/`⌁` lazy-probe notation from the legend). **[Agent: typedoc-docs]**
  - [x] Add three index entries + three `CLAUDE.md` rows. **[Agent: typedoc-docs]**
  - [x] Confirm structural test green. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **[Agent: rollup-build]**

- [x] **Slice 4: Filters & template loading**
  - [x] Author `filters.md` (pipeline + `$filterProvider` + `$filter` lookup + swappable `$locale`) and `template-loading.md` (`$templateCache` ↔ `$templateRequest` with in-flight dedup). **[Agent: typedoc-docs]**
  - [x] Add two index entries + two `CLAUDE.md` rows. **[Agent: typedoc-docs]**
  - [x] Confirm structural test green. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **[Agent: rollup-build]**

- [x] **Slice 5: Orchestrators — controller & compiler**
  - [x] Author `controller.md` (`$controllerProvider.register` → `$controller` instantiate with return-value replacement; the compiler's controller seam) and `compile.md` (tree walk → directive collect/sort/terminal → three-phase linking → transclusion → controller seam → isolate bindings → lifecycle). **[Agent: typedoc-docs]**
  - [x] Add two index entries + two `CLAUDE.md` rows. **[Agent: typedoc-docs]**
  - [x] Confirm structural test green. **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **[Agent: rollup-build]**

- [x] **Slice 6: Built-in directives (hybrid)**
  - [x] Author `built-in-directives.md`: top overview of the shared `$compile` mechanism with 2–3 worked examples, then a concise per-category sub-section (structural/flow-control, visibility & binding, class & style, attribute helpers, events, pluralization, CSP/template-cache/element-overrides). Promote the structural/transclusion family to `built-in-directives-structural.md` only if the overview grows unwieldy (link it from the overview if split). _(Overview stayed manageable — no split needed.)_ **[Agent: typedoc-docs]**
  - [x] Add index entry/entries + `CLAUDE.md` row(s). **[Agent: typedoc-docs]**
  - [x] Confirm structural test green (any split file is glob-picked up and validated automatically). **[Agent: vitest-testing]**
  - [x] Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`. **[Agent: rollup-build]**

- [x] **Slice 7: Completeness gate, cross-links & final regression**
  - [x] Extend the structural test with an explicit `EXPECTED_DIAGRAMS` completeness assertion: all 12 canonical service files + `README.md` are present (guards against a future deletion). **[Agent: vitest-testing]**
  - [x] Cross-link `src/sanitize/README.md` → `sanitize.md` and `src/template/README.md` → `template-loading.md`; verify every `CLAUDE.md` diagram link and every index link resolves. Tick the "Service Text Diagrams" roadmap item in `context/product/roadmap.md`. **[Agent: typedoc-docs]**
  - [x] Final regression: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` — all green; structural + completeness tests pass; no broken links. **[Agent: rollup-build]**

---

## Notes for the Implementation Agent

- **Diagrams go inside fenced code blocks** so Prettier (printWidth 120) doesn't reflow the box-drawing art. Prose and tables outside fences must pass `format:check`.
- **Discoverability is wired per-slice, not deferred** — each diagram's `README.md` index entry and `CLAUDE.md` row land in the same slice as the file, keeping the glob-driven structural test green after every slice.
- **The structural test checks structure, not prose** — snippet/diagram accuracy is confirmed by manual review against each `src/<module>` source and the `CLAUDE.md` invariants.
- **No `src/` runtime changes, no `package.json`/build config changes** — this is documentation plus one test file.
- **Tick task checkboxes in the SAME commit as the implementation** per `CLAUDE.md`.
