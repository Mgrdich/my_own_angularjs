# Functional Specification: Per-Service Text Diagrams (Phase 2 Wrap-Up)

- **Roadmap Item:** Service Text Diagrams (Phase 2 wrap-up) — Per-service ASCII / text diagrams
- **Status:** Completed
- **Author:** AWOS spec workflow

---

## 1. Overview and Rationale (The "Why")

The whole reason this project exists is to be a _readable_ reference implementation of AngularJS — something a curious developer can study to finally understand how scopes, dependency injection, expression evaluation, and DOM compilation actually work. Today that understanding has to be assembled by hand: a learner reads the source for one service, jumps to a collaborating service, traces a call through several files, and mentally reconstructs the order things happen in. There is no single, at-a-glance artifact that says "here is how this service works and here is how you call it."

This change delivers a set of plain-text diagrams — one per service shipped through Phase 2 — that each answer three questions a learner has when they first open a service:

1. **How does it work inside?** — which other services it leans on, and the order in which calls flow between them.
2. **How am I supposed to use it?** — the two supported ways to reach it: the primary import-and-call style, and the dependency-injection style.
3. **What does that actually look like?** — minimal, copy-paste-ready example snippets for both ways.

**Desired outcome:** a developer browsing the repository can open one file and understand a service's collaborators, its call order, and how to call it — without reading the source first. The diagrams become the recommended on-ramp before diving into code.

**Success measure:** every Phase 2 service has a diagram that a reader unfamiliar with that service's source can follow; each diagram is reachable both from a central index and from the project's "Where to look when…" reference table.

---

## 2. Functional Requirements (The "What")

### 2.1 A diagram exists for every Phase 2 service

- A separate diagram document is produced for each of the following services:
  - Scopes & digest cycle
  - Injector & module system (dependency injection)
  - Expression parser
  - String/template interpolation
  - Strict Contextual Escaping (with its delegate)
  - HTML sanitization (the opt-in companion module)
  - Centralized exception handling
  - Filters (including the swappable locale)
  - Template loading (the template cache and the template request/fetch service)
  - The DOM compiler
  - Controllers
  - Built-in directives (see 2.4 for how this one is organized)
- **Acceptance Criteria:**
  - [x] Opening the diagrams folder, a reader finds one document for each service listed above.
  - [x] Each document's filename clearly identifies its service in lowercase hyphenated form.
  - [x] No listed service is missing a document.

### 2.2 Every diagram follows the same fixed layout

Each document presents its content in the same order so a reader always knows where to look:

1. **Purpose** — a one- to two-sentence plain statement of what the service does.
2. **Collaborators & call order** — the text/ASCII diagram showing which other services this one talks to and the sequence of calls between them.
3. **Using it the primary way** — how to reach the service through the import-and-call style, with a short worked snippet.
4. **Using it the dependency-injection way** — how to reach the same service through dependency injection, with a short worked snippet.
5. **Related diagrams** — links to the other service documents this one references.

- **Acceptance Criteria:**
  - [x] Every document contains all five sections, in this order, with consistent headings.
  - [x] A reader comparing any two documents finds the same section structure in both.
  - [x] If a service genuinely has only one supported usage path, the missing-path section explicitly says so rather than being omitted.

### 2.3 Each diagram shows collaborators and call order as readable text

- The central diagram in each document is rendered in plain text/ASCII (no binary image files), so it displays correctly in a code editor, a terminal, and a plain text view.
- It names the collaborating services and shows the order in which they are called for that service's main flow.
- **Acceptance Criteria:**
  - [x] The diagram renders legibly as plain text with no special viewer.
  - [x] A reader can trace the main flow of the service from the diagram alone and see which other services participate and in what order.

### 2.4 Built-in directives are presented as a hybrid: one overview plus per-category sections

- There is one primary "built-in directives" document that explains the shared mechanism every directive goes through (how a directive is registered, how it is matched on an element, the ordering rules, the compile and link phases, and the kinds of scope a directive can use), illustrated with a small number of representative examples.
- Within that document, each directive category has a concise sub-section describing that family's distinctive behavior and call order (for example: structural/flow-control, visibility & binding, class & style, attribute helpers, event directives, pluralization, and the CSP/template-cache/element-override group).
- A category whose behavior diverges substantially from the shared mechanism may be split into its own separate document; when that happens, the overview links to it.
- **Acceptance Criteria:**
  - [x] One overview document explains the shared directive mechanism with at least two representative examples.
  - [x] Every built-in directive category is covered by a sub-section (or its own linked document).
  - [x] A reader can find how a given directive family behaves without reading the framework source.

### 2.5 Each diagram includes minimal example snippets for both usage paths

- Each document shows at least one minimal example of calling the service the primary import-and-call way, and at least one minimal example of reaching it through dependency injection.
- Snippets are intentionally small — just enough to show the entry point and a representative call.
- **Acceptance Criteria:**
  - [x] Each document contains at least one primary-style snippet and at least one dependency-injection-style snippet (except where 2.2's single-path note applies).
  - [x] Each snippet shows a real, representative call rather than a placeholder.

### 2.6 An index page ties the collection together

- The diagrams folder contains an overview/index document that lists every diagram with a one-line description and briefly explains how the services fit together.
- **Acceptance Criteria:**
  - [x] The index lists every service diagram with a one-line description.
  - [x] Each index entry links to its diagram document.
  - [x] The index gives the reader a sense of how the services relate as a whole.

### 2.7 Diagrams are discoverable from the existing reference table

- Every diagram document is reachable from the project's existing "Where to look when…" reference table, in addition to the index page.
- **Acceptance Criteria:**
  - [x] For each service, the "Where to look when…" table contains an entry pointing to that service's diagram.
  - [x] Following the table link lands the reader on the correct diagram document.

---

## 3. Scope and Boundaries

### In-Scope

- Text/ASCII diagram documents for every Phase 2 service listed in 2.1.
- A fixed five-section layout applied consistently across all documents.
- The hybrid treatment of built-in directives (overview + per-category sections, with optional splits).
- An index/overview page in the diagrams folder.
- Links from the existing "Where to look when…" reference table to each diagram.
- Minimal example snippets for both the primary and dependency-injection usage paths.

### Out-of-Scope

- Diagrams for services that ship in later phases (Promises/async, HTTP, forms & validation, routing, animations) — they will be documented when those phases land.
- Generated or rendered image diagrams (the diagrams are plain text only).
- Auto-generation tooling that derives diagrams from source code.
- Changes to the services themselves; this work is purely descriptive documentation.
- The classic `angular`-namespace compatibility surface (Phase 5).
- The following items, which are separate roadmap entries and therefore out of scope here: **Application Bootstrap**, **Promises & Async**, **HTTP & Networking**, **Forms & Validation**, **Routing**, **Animations**, **Package & Distribution**, and the **AngularJS Compatibility Layer**.
