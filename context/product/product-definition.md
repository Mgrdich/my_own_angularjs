# Product Definition: My Own AngularJS

- **Version:** 1.0
- **Status:** Proposed

---

## 1. The Big Picture (The "Why")

### 1.1. Project Vision & Purpose

To create a complete, fully typed TypeScript reimplementation of AngularJS that serves as both a deep learning exercise in framework internals and a clean, well-documented reference implementation. Users should be able to install and use it as a drop-in replacement for AngularJS, benefiting from full TypeScript support and modern code quality.

### 1.2. Target Audience

- **The author (personal learning):** Deepening understanding of how frontend frameworks work internally by building one from scratch.
- **Frontend developers:** Developers who want to understand how AngularJS works under the hood by reading a clean, typed codebase.
- **TypeScript learners:** Developers learning TypeScript by seeing a real-world framework rewritten with full type safety.
- **Open-source community:** Contributors and users looking for a modern, typed alternative/reference of AngularJS.

### 1.3. User Personas

- **Persona 1: "Alex the Curious Developer"**
  - **Role:** Mid-level frontend developer working with Angular or React.
  - **Goal:** Wants to understand how dirty checking, digest cycles, and dependency injection actually work at a low level to become a stronger engineer.
  - **Frustration:** The original AngularJS source code is hard to read, lacks types, and has years of accumulated complexity.

- **Persona 2: "Jordan the TypeScript Enthusiast"**
  - **Role:** Developer transitioning from JavaScript to TypeScript.
  - **Goal:** Wants to study a non-trivial TypeScript project that applies advanced typing patterns (generics, mapped types, etc.) in a real framework context.
  - **Frustration:** Most TypeScript examples are trivial; real-world codebases are too large to learn from easily.

### 1.4. Success Metrics

- **Feature coverage:** Percentage of core AngularJS features successfully reimplemented in TypeScript — target: full coverage of all major AngularJS modules.
- **Test coverage:** High test coverage ensuring correctness and serving as living documentation — target: 90%+ coverage on core modules.
- **Code quality:** Clean, well-documented TypeScript code that serves as a clear reference — measured by consistent patterns, strong typing, and readable implementations.

---

## 2. The Product Experience (The "What")

### 2.1. Core Features

- **Scopes & Digest Cycle:** Full scope hierarchy, dirty checking, `$watch`, `$digest`, `$apply`, `$eval`, `$evalAsync`, `$applyAsync`, scope events (`$on`, `$emit`, `$broadcast`), and scope lifecycle.
- **Dependency Injection:** Module system, providers, factories, services, constants, values, decorators, and the injector.
- **Expressions & Filters:** Expression parser, interpolation, one-time bindings, and built-in filters.
- **Security ($sce):** Strict Contextual Escaping for HTML, URL, resource-URL, JS, and CSS contexts. Ships two layered surfaces: the ESM-first `createSce` / `sce` (and `createSceDelegate` / `sceDelegate`) primary API with `trustAs*` / `getTrusted*` / `parseAs*` helpers, plus the DI-layer `$sce` / `$sceProvider` / `$sceDelegate` / `$sceDelegateProvider` thin shims on the `ng` module. Wires `$interpolate`'s `trustedContext` parameter and exposes a configurable resource-URL allow/block list.
- **Directives & DOM Compilation:** Directive definition, compilation, linking (pre/post), transclusion, template loading, and built-in directives (`ng-if`, `ng-repeat`, `ng-class`, `ng-model`, etc.).
- **HTTP & Networking:** `$http` service, interceptors, request/response transformations.
- **Routing:** Route configuration, view management, route parameters, and navigation.
- **Forms & Validation:** `ngModel`, form controllers, built-in validators, custom validation.
- **Animations:** Animation hooks, CSS and JavaScript-based animations.
- **Promises & Async:** `$q` promise implementation, `$timeout`, `$interval`.

### 2.2. User Journey

A developer discovers the project on GitHub, clones the repository, and runs `npm install`. They can either:

1. **Use it as a library:** Import the package into their own project and use it like they would use AngularJS, but with full TypeScript autocompletion, type checking, and modern tooling support.
2. **Learn from it:** Browse the well-structured source code, read the tests as living documentation, and step through the implementation to understand how each AngularJS concept is built from the ground up.

---

## 3. Project Boundaries

### 3.1. What's In-Scope for this Version

- Full reimplementation of all major AngularJS features in TypeScript.
- Scopes, digest cycle, and dirty checking.
- Dependency injection system (modules, providers, injector).
- Expression parser and filters.
- Directive compilation and linking system.
- Built-in directives and services.
- HTTP service and routing.
- Forms, validation, and animations.
- Comprehensive test suite covering all modules.
- Usable as an installable npm package.

### 3.2. What's Out-of-Scope (Non-Goals)

- **Angular 2+ compatibility:** No compatibility with Angular 2+ APIs or migration path. This project reimplements AngularJS (1.x) only.
- **Server-side rendering:** No SSR support in initial versions.
- **IE/legacy browser support:** No support for Internet Explorer or legacy browser quirks. Targets modern browsers only.
- **Third-party module reimplementation:** No reimplementation of community modules like ui-router, angular-material, or other ecosystem libraries.
