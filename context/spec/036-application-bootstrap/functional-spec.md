# Functional Specification: Application Bootstrap

- **Roadmap Item:** Application Bootstrap — `bootstrapInjector` / `bootstrap` / `autoBootstrap`
- **Status:** Completed
- **Author:** AWOS spec workflow

---

## 1. Overview and Rationale (The "Why")

A developer who wants to _start_ an application built on this framework has no single entry point today. They must assemble the runtime by hand — build the injector from the right list of modules, obtain a root scope, run the compiler against the page, and trigger the first update cycle, all in the correct order. That is error-prone, undocumented, and a poor first impression for someone arriving from classic AngularJS, where a single call (or a single `ng-app` attribute) started everything.

This change delivers a small, predictable set of startup entry points so a developer can launch the runtime in one call, in the shape that fits their situation:

- A **headless** start for tests, server-side use, command-line tools, and learning exercises — no page required.
- A **page** start that wires the runtime to a chosen part of the page and immediately renders it.
- An **opt-in automatic** start for developers migrating existing markup that uses the classic `ng-app` attribute.

Behavior is validated against original AngularJS wherever the two overlap — this feature targets behavior parity with `angular.bootstrap`, `angular.injector`, and the `ng-app` auto-bootstrap scanner. A small number of intentional deviations (Section 2.8) are called out explicitly so they can be tested as deliberate.

**Desired outcome:** starting an app is a one-liner with an obvious, typed result the developer can hold onto; there is no hidden global state; and the migration path for classic `ng-app` pages is honored without forcing it on everyone.

**Success measure:** a developer can start an app three ways (headless, on a page, automatically via `ng-app`) without reading the framework source; each path reports problems clearly; and the on-page paths render content and respond to changes immediately after the call returns.

---

## 2. Functional Requirements (The "What")

### 2.1 Headless start (no page needed)

- A developer can start the runtime from a list of their modules **without a page**, and receive back a handle they can use to retrieve any registered service.
- The framework's own built-in capabilities are always available without the developer having to list them explicitly.
- By default the start is **strict about wiring**: a service that doesn't clearly declare what it needs is reported as an error rather than silently guessed. The developer can relax this if they choose.
- **Acceptance Criteria:**
  - [x] Given a developer provides a list of their modules, when they perform a headless start, then they receive a handle from which they can retrieve any service registered by those modules or by the framework.
  - [x] Retrieving a service that exists returns it; retrieving one that doesn't is reported clearly (see 2.5).
  - [x] No part of a page is required, accessed, or modified for a headless start.
  - [x] Strictness about declared wiring is on by default and can be turned off via an option.

### 2.2 Page start

- A developer can start the runtime against a chosen element on the page. The framework prepares that element and everything inside it, connects it to a fresh root context, and performs the first update so the content is live immediately.
- The call returns a single handle bundling: the service-retrieval handle, the root context, and the element that was started.
- The framework does **not** attach any of its own bookkeeping to the page element by default. A developer who wants the classic behavior of attaching it can opt in with a flag (see 2.8).
- **Acceptance Criteria:**
  - [x] Given a developer provides a page element and their module list, when they perform a page start, then the element and its contents are processed and rendered, and dynamic content reflects the current data without any further action.
  - [x] The call returns a handle containing the service-retrieval handle, the root context, and the started element.
  - [x] By default, nothing the framework uses internally is attached to the page element; a developer can opt in to attaching it.
  - [x] The startup steps always happen in a fixed order so behavior is predictable across runs.

### 2.3 Automatic start via the classic attribute

- A developer can ask the framework to scan a region of the page for the classic application-marker attribute and, if found, start the app on that element using the named module. This is equivalent to performing a page start on that element.
- This automatic start is **opt-in** — it only happens when the developer explicitly asks for it, never on its own.
- It recognizes the common historical spellings of the marker attribute so existing markup migrates without edits: `ng-app`, `data-ng-app`, `ng:app`, and `x-ng-app` (attribute forms only; the legacy class-based form is intentionally not supported, matching modern AngularJS).
- If more than one marker attribute is present, the **first one in document order wins**; the rest are ignored.
- It only applies on a real page; in a non-page environment it does nothing.
- **Acceptance Criteria:**
  - [x] Given a region of the page contains the classic application-marker attribute naming a module, when the developer triggers the automatic start, then the app starts on that element using that module (equivalent to a page start).
  - [x] Each of the four recognized attribute spellings is honored.
  - [x] When more than one marker attribute is present, the first in document order is used and the others are ignored.
  - [x] When no marker attribute is found, the automatic start does nothing and reports nothing (silent no-op).
  - [x] In an environment with no page, the automatic start does nothing.

### 2.4 A canonical root context is always available

- After any start that involves a page, a single shared root context exists and is retrievable as a standard service, so the rest of the framework and the developer's code have one agreed starting point.
- **Acceptance Criteria:**
  - [x] After a page start, the root context is retrievable as a named service from the handle.
  - [x] The root context retrieved as a service is the same one returned in the start handle.

### 2.5 Clear failures

- When a start cannot proceed, the framework **throws a clear, descriptive error directly to the caller** at the point of the start call — rather than failing silently, cryptically, or being swallowed. This matches AngularJS, where startup, module-resolution, and target-element problems surface synchronously.
  - Examples: a named module that was never registered; a page-start target that doesn't exist.
- **Acceptance Criteria:**
  - [x] Starting with a module name that isn't registered throws a clear error naming the missing module.
  - [x] A page start whose target element is missing throws a clear error identifying that problem.
  - [x] Startup failures are raised at the call site (synchronously), not deferred or suppressed.

### 2.6 Guard against starting the same content twice

- If a developer starts the runtime on an element that has already been started (including an automatic start landing on content nested inside an already-started region), the framework **throws a clear "already bootstrapped" error** rather than running two independent copies over the same content. This is parity with AngularJS's existing double-bootstrap guard.
- **Acceptance Criteria:**
  - [x] Given an element has already been started, when a second start targets the same element, then the framework throws a clear error indicating the element is already started.
  - [x] The first, already-running start continues to work normally after the rejected second attempt.

### 2.7 Typed result

- The handle returned from a start is typed against the modules the developer passed, so retrieving a known service gives back a correctly typed result without manual casting.
- **Acceptance Criteria:**
  - [x] Retrieving a service that the provided modules (or the framework) registered yields a result of the correct type, with no manual type assertion required by the developer.

### 2.8 Intentional parity deviations

These differences from classic AngularJS are deliberate and should be treated as expected behavior (tested as intentional, not as parity bugs):

- **Strict wiring on by default.** Strictness about declared dependencies defaults to ON here, whereas classic AngularJS defaults it OFF. Explicit dependency declarations are idiomatic in this project. (Developer-facing opt-out exists per 2.1.)
- **Richer page-start result.** A page start returns a handle bundling the service-retrieval handle, the root context, and the started element — whereas classic AngularJS returns only the service-retrieval handle. This avoids any hidden global state.
- **No automatic attachment to the page element.** The framework does not attach its internal bookkeeping to the started element by default, whereas classic AngularJS always does. Attaching it is opt-in (per 2.2). Because of this, the "already started" guard (2.6) recognizes a prior start through the framework's own private marker rather than through attached bookkeeping.
- **Automatic start is opt-in.** The `ng-app` scan only runs when the developer explicitly asks for it (per 2.3), whereas classic AngularJS scans the page automatically when the library loads.
- **Acceptance Criteria:**
  - [x] Each deviation above is observable and behaves as described (strict-on default, bundled result handle, no default attachment with opt-in, opt-in automatic start).

---

## 3. Scope and Boundaries

### In-Scope

- The three start entry points: headless, page, and opt-in automatic (`ng-app`-style).
- A retrievable, canonical root context registered as a standard service.
- A typed result handle over the provided modules.
- Strict-wiring-by-default with an opt-out.
- Opt-in attachment of internal bookkeeping to the page element.
- Clear, descriptive failures thrown synchronously to the caller.
- A guard that throws when the same content would be started twice.
- The new packaged area for these entry points so consumers can import them.

### Out-of-Scope

- Any global `angular` namespace object or classic-namespace surface — that is the separate AngularJS Compatibility Layer phase.
- New runtime capabilities beyond startup (no new services, directives, or compiler features) — startup composes what already exists.
- Server-side rendering of actual page output (the headless path enables DOM-less use, but full SSR is a documented non-goal of the project).
- The following items, which are separate roadmap entries and therefore out of scope here: **Promises & Async (`$q`, `$timeout`, `$interval`)**, **HTTP & Networking**, **Forms & Validation**, **Routing**, **Animations**, **Package & Distribution**, **Service Text Diagrams** (already shipped), and the **AngularJS Compatibility Layer**.
