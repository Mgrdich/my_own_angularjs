# Functional Specification: Scopes — Configurable Digest TTL

- **Roadmap Item:** Phase 1 — Core Runtime Foundation > Scopes & Digest Cycle (remaining)
- **Status:** Draft
- **Author:** Mgrdich

---

## 1. Overview and Rationale (The "Why")

The Scope module was reimplemented in Phase 0 with a hardcoded digest TTL of 10 iterations. Phase tracking (`$beginPhase`, `$clearPhase`, `$$postDigest`, `$$phase`) is already fully implemented and tested.

**Problem:** The fixed TTL of 10 is not always appropriate. In complex applications with many interdependent watchers, 10 iterations may not be enough to reach stability. Conversely, in simpler apps, a lower TTL could catch infinite loops faster. Additionally, when the digest does exceed the TTL, the current error message is generic and does not help developers identify which watcher is causing the instability.

**Desired outcome:** Developers can configure the digest TTL when creating the root scope. When the TTL is exceeded, the error message includes information about which watcher(s) failed to stabilize, making debugging significantly easier.

---

## 2. Functional Requirements (The "What")

### 2.1 Configurable TTL via Scope.create()

The `Scope.create()` factory method must accept an optional configuration object that includes a `ttl` property to set the maximum number of digest iterations before throwing.

- Default TTL remains 10 (backward compatible)
- `Scope.create({ ttl: 15 })` sets the TTL to 15 for that scope hierarchy
- The TTL is shared across the entire scope hierarchy (child scopes inherit the root's TTL)

**Acceptance Criteria:**

- [ ] `Scope.create()` with no arguments uses a default TTL of 10
- [ ] `Scope.create({ ttl: 20 })` sets the digest TTL to 20 for that root scope
- [ ] Child scopes (via `$new()`) inherit the root scope's TTL
- [ ] TTL must be >= 2; values below 2 throw an error at creation time

### 2.2 Improved TTL Exceeded Error Message

When the digest does not stabilize within the configured TTL, the error message must include information about the last watcher(s) that were still dirty, helping developers identify the source of the instability.

**Acceptance Criteria:**

- [ ] When TTL is exceeded, the error includes the last watch expression or function that was still dirty
- [ ] The error message is actionable — a developer can use it to identify the problematic watcher

### 2.3 Phase Tracking (Already Implemented)

Phase tracking (`$beginPhase`, `$clearPhase`, `$$postDigest`, `$$phase`) is already fully implemented and tested in Phase 0. No changes needed.

**Acceptance Criteria:**

- [ ] `$$phase` is `'$digest'` during digest, `'$apply'` during apply, `null` otherwise (already passing)
- [ ] `$$postDigest` callbacks run after the digest completes (already passing)

---

## 3. Scope and Boundaries

### In-Scope

- Adding an optional `ttl` configuration to `Scope.create()`
- Enforcing a minimum TTL of 2
- Improving the TTL-exceeded error message to include unstable watcher info
- Tests for all new behavior

### Out-of-Scope

- **$rootScopeProvider.digestTtl()** — Provider-based TTL configuration will be added when the Dependency Injection module is implemented (Phase 1)
- **Dependency Injection** — Module system, injector, providers are a separate roadmap item
- **Expressions & Parser enhancements** — One-time bindings, interpolation are Phase 2 items
- **Filters, Directives, HTTP, Forms, Routing, Animations** — Later phases
