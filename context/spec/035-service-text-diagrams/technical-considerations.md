<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: Per-Service Text Diagrams (Phase 2 Wrap-Up)

- **Functional Specification:** `context/spec/035-service-text-diagrams/functional-spec.md`
- **Status:** Completed
- **Author(s):** AWOS tech workflow

---

## 1. High-Level Technical Approach

This is a **documentation-only** deliverable — no runtime code, no public API surface, no architecture/data/API changes to any service. The work produces a new `context/diagrams/` folder containing one hand-authored, plain-text Markdown file per Phase 2 service (12 files), plus an index page, all following a single fixed section layout. Each diagram is wired into the existing `## Where to look when…` table in `CLAUDE.md` so it is discoverable from the project's standard reference surface.

Accuracy is sourced from three places already in the repo: the service's source under `src/<module>/`, the invariants in `CLAUDE.md`, and the service's spec directory under `context/spec/`. Diagrams are authored by hand (no generator). A small Vitest structural test guards the collection against drift in CI.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 File layout

New folder `context/diagrams/`, kebab-case filenames mirroring the `src/` subpath names:

| File | Service covered | Primary source dir |
| --- | --- | --- |
| `README.md` | Index / overview (see 2.4) | — |
| `scope-and-digest.md` | Scopes & digest cycle | `src/core` |
| `injector-and-modules.md` | Injector & module system (DI) | `src/di` |
| `expression-parser.md` | Expression parser | `src/parser` |
| `interpolate.md` | String/template interpolation | `src/interpolate` |
| `sce.md` | Strict Contextual Escaping (+ delegate) | `src/sce` |
| `sanitize.md` | HTML sanitization (`ngSanitize`) | `src/sanitize` |
| `exception-handler.md` | Centralized exception handling | `src/exception-handler` |
| `filters.md` | Filters (+ `$locale`) | `src/filter` |
| `template-loading.md` | `$templateCache` / `$templateRequest` | `src/template` |
| `compile.md` | DOM compiler | `src/compiler` |
| `controller.md` | Controllers | `src/controller` |
| `built-in-directives.md` | Built-in directives (hybrid — see 2.3) | `src/compiler` |

### 2.2 Fixed five-section layout (every service file)

Each file is authored against a single shared template, in this exact order with consistent headings:

1. `## Purpose` — 1–2 plain sentences.
2. `## Collaborators & call order` — the Unicode box-drawing diagram (see 2.5).
3. `## Using it the primary way` — ESM import-and-call style + minimal snippet.
4. `## Using it the dependency-injection way` — DI style + minimal snippet.
5. `## Related diagrams` — relative links to other files in the folder.

Where a service has only one supported usage path (e.g. a DI-only provider like `$exceptionHandler` or `$controllerProvider`), the missing-path section is **kept** and explicitly states why it doesn't apply, rather than being dropped — this preserves the "comparable structure across files" guarantee.

### 2.3 Built-in directives — hybrid structure

`built-in-directives.md` carries:

- A top **overview** of the shared mechanism (registration → `restrict` matching → priority/terminal sort → compile / pre-link / post-link → scope kinds → transclusion), with 2–3 representative worked examples.
- A concise **per-category sub-section** for each family: structural/flow-control, visibility & binding, class & style, attribute helpers, event directives, pluralization, and the CSP/template-cache/element-override group — each showing that family's distinctive call order.
- **Optional split:** the structural/transclusion family (Comment-placeholder + element-transclude) may be promoted to its own `built-in-directives-structural.md` if the overview grows unwieldy; the overview links to any such split file. This is an author-discretion escape hatch, not a requirement.

### 2.4 Index page (`context/diagrams/README.md`)

- One-line description + link for every diagram file.
- A short "how the services fit together" orientation (e.g. parser feeds scope/interpolate; compiler orchestrates controller, interpolate, sce, directives).
- Optionally a single top-level dependency overview diagram showing the Phase 2 services as a graph.

### 2.5 Diagram notation convention

- Unicode box-drawing characters (`┌─┐ │ └─┘ ▼ →`) for boxes and call arrows.
- A short legend convention documented once in `README.md` so all files read consistently (e.g. solid arrow = direct call, label on arrow = method name, dashed/`⌁` = lazy `$injector.has(...)` probe).
- No binary images; everything is fenced text so it renders in editors, terminals, and GitHub.

### 2.6 Discoverability wiring

- Add one row per diagram to the `## Where to look when…` table in `CLAUDE.md` (anchor at `CLAUDE.md:144`), phrased as a "How does `<service>` work end-to-end?" → `context/diagrams/<file>` entry. Existing fine-grained rows stay; these are coarse "whole-service picture" entries.
- Cross-link the two existing per-module READMEs (`src/sanitize/README.md`, `src/template/README.md`) to their diagrams.

### 2.7 Snippet fidelity

Snippets are intentionally minimal (entry point + one representative call) and are hand-verified against the **current public exports** (`package.json` `exports` map + each module's `index.ts`) at authoring time. They are illustrative documentation, not compiled fixtures — drift is caught by review, not by the structural test (which checks structure, not snippet compilation).

---

## 3. Impact and Risk Analysis

- **System Dependencies:** None at runtime. The work depends only on the _current_ shape of the services for accuracy; it touches `CLAUDE.md` and two existing READMEs for linking. No `src/` runtime files, no `package.json` exports, no build config.
- **Potential Risks & Mitigations:**
  - _Documentation drift_ — diagrams describe a moving codebase. **Mitigation:** the structural test pins file/heading/link presence; future service-changing specs should treat the matching diagram as a co-update target (noted in the index page's maintenance line).
  - _Inaccuracy_ — a hand-authored diagram could misstate call order. **Mitigation:** author each file directly against its `src/` source and `CLAUDE.md` invariants; manual accuracy review per file before approval.
  - _Scope creep into later phases_ — tempting to diagram `$q`, `$http`, etc. **Mitigation:** functional spec explicitly bounds this to Phase 2 services; later phases document their own.
  - _Coverage-threshold interaction_ — adding a Markdown-reading test must not perturb the 90% line-coverage gate. **Mitigation:** the test reads files under `context/`, asserts structure, and adds no `src/` code, so it neither raises nor lowers module coverage.

---

## 4. Testing Strategy

- **Automated structural test (Vitest):** a single test file (e.g. `src/__tests__/diagrams-structure.test.ts`, or a co-located location if the test config picks it up — final location decided in tasks) that asserts:
  - every expected diagram file in 2.1 exists;
  - each service file contains all five required section headings (2.2), in order;
  - the index `README.md` links to every diagram file, and every diagram's `## Related diagrams` links resolve to existing files (no broken relative links);
  - `CLAUDE.md` contains a `context/diagrams/<file>` reference for each diagram.
- **Manual review:** prose accuracy, diagram correctness, and snippet fidelity are confirmed by reading each file against its source — not automated.
- **No runtime/behavior tests** — there is no executable behavior in this deliverable.
