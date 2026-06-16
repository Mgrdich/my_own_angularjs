# Functional Specification: Template Interpolation in the Compiler (Text & Attribute Bindings)

- **Roadmap Item:** Directives & DOM Compilation — close-out: compiler-driven `{{ }}` interpolation for text nodes and attribute values (the foundational templating gap remaining after specs 017–030).
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

Today, a developer using this framework can wire up directives, controllers, scopes, and the digest cycle — but the single most recognizable AngularJS feature does **not** work: putting an expression in curly braces directly in the markup.

- `<h1>Hello {{name}}</h1>` renders the literal text `Hello {{name}}` and never updates.
- `<div title="{{tooltip}}">` keeps the literal `{{tooltip}}` as its tooltip forever.

To get dynamic text today, the developer must reach for `ng-bind`, and to get a dynamic attribute they must either use a purpose-built helper (`ng-href`, `ng-src`) or write their own directive. That is a jarring departure from AngularJS, where `{{ }}` "just works" anywhere in a template. For a project whose whole purpose is to be a clean, drop-in AngularJS reference, this is the biggest remaining hole in the templating story.

**The problem we're solving:** Developers expect to write expressions in double-curly-braces anywhere in their HTML — inside element text and inside attribute values — and have those expressions evaluate and stay in sync with their data automatically. Right now they can't.

**Desired outcome:** Any `{{ expression }}` placed in template text or in an attribute value is automatically evaluated and kept up to date as the underlying data changes, with no extra directive required — matching AngularJS behavior.

**How we measure success:**

- The canonical AngularJS "hello world" (`<h1>Hello {{name}}</h1>`) renders the live value and updates when the value changes.
- Interpolated attributes (`<div title="{{tooltip}}">`) reflect the live value and update on change.
- Behavior matches AngularJS for the cases covered here (multiple expressions per binding, literal text preservation, empty/undefined values, configured custom delimiters, and safe handling of link/source attributes).

---

## 2. Functional Requirements (The "What")

### 2.1 Text content interpolation

- **As a** developer, **I want to** write `{{ expression }}` directly inside an element's text, **so that** the rendered text shows the live value of that expression and updates automatically when the value changes.
  - **Acceptance Criteria:**
    - [ ] Given a template `<h1>Hello {{name}}</h1>` compiled and linked against data where `name` is `"World"`, the element displays `Hello World`.
    - [ ] When `name` later changes to `"Angular"` and a digest runs, the element updates to display `Hello Angular`.
    - [ ] Given multiple expressions in one piece of text — `{{greeting}}, {{name}}!` — every expression is evaluated and the surrounding literal characters (the comma, space, and exclamation mark) are preserved.
    - [ ] Literal text with no curly-brace expression (e.g. `<p>Just text</p>`) is left exactly as written and incurs no ongoing update cost.
    - [ ] An expression that evaluates to a number, boolean, or other non-string value is shown as its readable text form (e.g. `{{1 + 2}}` shows `3`).
    - [ ] An expression that evaluates to nothing (undefined or null) shows as empty text, not the words "undefined" or "null", matching AngularJS.
    - [ ] Whitespace and line breaks around expressions inside the text are preserved.

### 2.2 Attribute value interpolation

- **As a** developer, **I want to** write `{{ expression }}` inside any attribute value, **so that** the attribute reflects the live value of that expression and updates automatically — without writing a directive.
  - **Acceptance Criteria:**
    - [ ] Given `<div title="{{tooltip}}">` where `tooltip` is `"Save your work"`, the element's `title` attribute is `Save your work`.
    - [ ] When `tooltip` changes and a digest runs, the `title` attribute updates to the new value.
    - [ ] Interpolation works on arbitrary attributes (e.g. `title`, `alt`, `data-*`, `aria-*`), not only on a fixed list.
    - [ ] An attribute that mixes literal text and an expression — `class="box {{state}}"` — renders the literal portion plus the evaluated portion (e.g. `box active`).
    - [ ] Multiple expressions in one attribute value are all evaluated, with surrounding literal text preserved.
    - [ ] An attribute value with no curly-brace expression is left as written and incurs no ongoing update cost.
    - [ ] A directive on the same element that watches an attribute's computed value (via the existing observe mechanism) is notified with the evaluated value, and again whenever it changes — so existing directives that rely on observing attributes keep working and now also see interpolated values.
    - [ ] An expression that evaluates to nothing produces an empty attribute value, not the literal words "undefined"/"null".

### 2.3 Safe handling of link and source attributes

- **As a** developer, **I want** interpolated values placed into link/source attributes (such as `href` and `src`) to be handled with the same URL-safety rules the rest of the framework already applies, **so that** an interpolated URL cannot become an avenue for unsafe content.
  - **Acceptance Criteria:**
    - [ ] An interpolated `href` / `src` value is run through the framework's existing trusted-context handling, so a value the framework already considers unsafe is treated the same way here as anywhere else in the framework.
    - [ ] A normal, safe URL placed via interpolation (e.g. `<a href="{{profileUrl}}">`) renders and navigates as expected.
    - [ ] _Note:_ the **configurable** safe-URL lists (the developer being able to tune which URL patterns are allowed) are intentionally **not** part of this spec — see Out-of-Scope. This spec only guarantees interpolated link/source attributes go through the existing handling, not that it is reconfigurable.

### 2.4 Custom interpolation delimiters

- **As a** developer who has configured custom start/end symbols for expressions, **I want** text and attribute interpolation to honor those symbols, **so that** my whole app uses one consistent delimiter style.
  - **Acceptance Criteria:**
    - [ ] When the app is configured to use custom delimiters (e.g. `[[` and `]]` instead of `{{` and `}}`), text-content interpolation recognizes `[[ expression ]]` and ignores `{{ }}`.
    - [ ] The same configured delimiters apply to attribute interpolation.

### 2.5 Behavior on first render and error handling

- **Acceptance Criteria:**
  - [ ] Until the first digest runs, raw template markup (the un-evaluated `{{ }}`) may briefly be visible — identical to AngularJS. The flash-free alternatives (`ng-cloak`, `ng-bind`, `ng-href`, `ng-src`) remain available for developers who want to avoid this.
  - [ ] If an interpolated expression throws while being evaluated during a digest, the failure is reported through the framework's standard error-reporting path and the rest of the page continues to render and update — one bad expression does not break the whole template.

---

## 3. Scope and Boundaries

### In-Scope

- Automatic evaluation and live updating of `{{ }}` expressions found in **element text content**.
- Automatic evaluation and live updating of `{{ }}` expressions found in **attribute values**, on any attribute.
- Preservation of literal text surrounding expressions, support for multiple expressions per text/attribute, and empty rendering for undefined/null values.
- Routing interpolated link/source attributes (`href`, `src`) through the framework's existing trusted-context/URL-safety handling.
- Honoring app-configured custom interpolation delimiters.
- Integration so that existing directives observing an attribute's value also receive interpolated values.

### Out-of-Scope

- **Multi-element / ranged directives** (`ng-repeat-start` / `ng-repeat-end` and the general `*-start` / `*-end` suffix) — a separate close-out gap; tracked on the roadmap with its own future spec.
- **`$compileProvider` configuration methods** (`aHrefSanitizationTrustedUrlList`, `imgSrcSanitizationTrustedUrlList`, `debugInfoEnabled`, `commentDirectivesEnabled`, `cssClassDirectivesEnabled`, `strictComponentBindingsEnabled`) — a separate close-out gap; tracked on the roadmap with its own future spec. This includes the developer-tunable URL safe-lists referenced in §2.3; spec 031 only guarantees interpolated link/source attributes pass through the **existing** handling, not that it is reconfigurable.
- `replace: true` (deliberately rejected, unchanged).
- Animation hooks (Phase 4) and the jQuery/jqLite element wrapper (Phase 5).
- All other roadmap items outside Directives & DOM Compilation (Application Bootstrap, Service Text Diagrams, Promises/HTTP/Forms/Routing, etc.).
