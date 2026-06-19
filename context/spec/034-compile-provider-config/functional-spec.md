# Functional Specification: `$compileProvider` Configuration Methods

- **Roadmap Item:** Directives & DOM Compilation — `$compileProvider` config-phase configuration methods.
- **Status:** Completed
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

AngularJS apps tune compiler-wide behavior during the configuration phase through `$compileProvider`. This project exposes only directive and component **registration** — none of the policy, performance, or safety toggles that real apps rely on.

**The problem we're solving:** App authors currently cannot:

- Control which URLs are considered safe in links and image sources (the URL safe-list policy).
- Turn off scanning for comment-form and class-form directives — a performance lever and an attack-surface reduction.
- Turn debugging metadata on or off.
- Enforce that every required component input is actually supplied, so missing inputs surface as a clear error instead of silently-undefined values.

**Desired outcome:** A developer can configure all of the above during the config phase, matching the AngularJS `$compileProvider` surface.

**How we measure success:**

- Each configuration method works as a getter (no argument → returns the current value) and a setter (argument → applies the value and supports chaining), matching AngularJS.
- The defaults preserve today's behavior, so existing apps are unaffected unless they opt in.

---

## 2. Functional Requirements (The "What")

Each method below is callable only during the configuration phase. Called **with** a value it applies the setting and returns the provider for chaining; called **with no** value it returns the current setting.

- **URL safe-list for links — `aHrefSanitizationTrustedUrlList`.**
  - **Acceptance Criteria:**
    - [x] Setting a custom pattern changes which link (`href`) URLs are treated as safe; a URL that does not match is neutralized so it cannot navigate to unsafe content (AngularJS marks it with an `unsafe:` prefix).
    - [x] A URL that matches the pattern is used unchanged.
    - [x] The no-argument form returns the current pattern; the default preserves today's behavior.

- **URL safe-list for media sources — `imgSrcSanitizationTrustedUrlList`.**
  - **Acceptance Criteria:**
    - [x] Setting a custom pattern changes which image / media source (`src`) URLs are treated as safe; non-matching URLs are neutralized.
    - [x] The no-argument form returns the current pattern; the default preserves today's behavior.

- **Comment-directive scanning — `commentDirectivesEnabled`.**
  - **Acceptance Criteria:**
    - [x] When disabled, comment-form directives (`<!-- directive: foo -->`) are no longer recognized during compilation.
    - [x] When enabled (the default), they are recognized as they are today.
    - [x] The no-argument form returns the current setting.

- **Class-directive scanning — `cssClassDirectivesEnabled`.**
  - **Acceptance Criteria:**
    - [x] When disabled, class-name directives (matched via an element's CSS classes) are no longer recognized during compilation.
    - [x] When enabled (the default), they are recognized as they are today.
    - [x] The no-argument form returns the current setting.

- **Strict component bindings — `strictComponentBindingsEnabled`.**
  - **Acceptance Criteria:**
    - [x] When enabled, using a component or directive without providing one of its required (non-optional) inputs reports a clear error naming the missing input.
    - [x] When disabled (the default), a missing input is tolerated (today's lenient behavior).
    - [x] The no-argument form returns the current setting.

- **Debug information — `debugInfoEnabled`.**
  - **Acceptance Criteria:**
    - [x] When enabled (the default), compiled elements carry debugging metadata — the marker classes AngularJS adds (a scope marker, an isolate-scope marker, and a binding marker) plus the ability to retrieve an element's scope for inspection in dev tools.
    - [x] When disabled, that debugging metadata is not attached, so production output stays clean and slightly lighter.
    - [x] The no-argument form returns the current setting.

---

## 3. Scope and Boundaries

### In-Scope

- The six configuration methods above, each as a config-phase getter/setter.
- Actually attaching the debugging metadata (marker classes + scope retrieval) so the `debugInfoEnabled` toggle is meaningful — this is new behavior, not just a switch.
- The configurable URL safe-lists, which complete the link/source security story that spec 031 deferred (spec 031 routes interpolated `href`/`src` through the framework's safety handling but with fixed, non-configurable patterns).

### Out-of-Scope

- Other compiler internals or registration APIs.
- Multi-element / ranged directives (separate spec 033).
- Structural-directive correctness fixes (separate spec 032).
- All other roadmap items outside Directives & DOM Compilation.
