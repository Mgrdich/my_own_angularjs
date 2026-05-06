# Functional Specification: Scopes & Digest Cycle

- **Roadmap Item:** Phase 0 — Legacy Migration & Fresh Start > Reimplement Existing Features > Scopes & Digest Cycle
- **Status:** Completed
- **Author:** Poe (AI Assistant)

---

## 1. Overview and Rationale (The "Why")

Scopes are the foundational runtime data structure of AngularJS. Every other feature — expressions, directives, dependency injection — depends on scopes to store application state and propagate changes. Without a working Scope implementation, no further modules can be built.

The legacy implementation exists in `legacy/src/js_legacy/Scope.js` with ~2000 lines of tests. It works but uses JavaScript without types, relies on lodash for deep cloning, and lacks modern TypeScript strictness. The goal is to reimplement the full Scope module from scratch in clean TypeScript, matching behavioral parity with the legacy tests while improving type safety, error messages, and using modern APIs (`structuredClone` instead of lodash).

**Success criteria:** All legacy Scope test behaviors are reproducible with the new implementation. `pnpm test` passes with full coverage of Scope functionality. The module exports clean TypeScript types that downstream modules (DI, Compiler, Parser) can consume.

---

## 2. Functional Requirements (The "What")

### 2.1. Scope Creation and Hierarchy

- A root scope can be created as a standalone instance.
  - **Acceptance Criteria:**
    - [x] A new `Scope` instance has `$root` pointing to itself
    - [x] A new `Scope` instance has no `$parent`
    - [x] A new `Scope` instance has an empty `$$watchers` array and empty `$$listeners` object

- Child scopes can be created via `$new()`, inheriting from the parent via prototype chain.
  - **Acceptance Criteria:**
    - [x] `scope.$new()` returns a child scope whose `$parent` is the calling scope
    - [x] The child scope inherits properties from the parent (prototypal inheritance)
    - [x] Assigning a property on the child shadows the parent property without modifying the parent
    - [x] The parent's `$$children` array contains the child scope
    - [x] Nested scopes to arbitrary depth work correctly

- Isolated child scopes can be created via `$new(true)`, with no prototype inheritance.
  - **Acceptance Criteria:**
    - [x] `scope.$new(true)` returns a scope that does NOT inherit parent properties
    - [x] The isolated scope shares `$root`, `$$asyncQueue`, `$$applyAsyncQueue`, and `$$postDigestQueue` with the root
    - [x] The isolated scope's `$parent` points to the creating scope
    - [x] Digest cycles still propagate through isolated scopes

- A custom parent scope for event propagation can be specified via `$new(false, customParent)`.
  - **Acceptance Criteria:**
    - [x] `scope.$new(false, otherScope)` creates a child that inherits from the calling scope but has `$parent` set to `otherScope` for the scope hierarchy

### 2.2. Watchers and Dirty Checking

- Watchers can be registered via `$watch(watchFn, listenerFn, valueEq)`.
  - **Acceptance Criteria:**
    - [x] `$watch` accepts a watch function, a listener function, and an optional boolean for value-based equality
    - [x] `$watch` returns a deregistration function; calling it removes the watcher
    - [x] The watch function receives the scope as its argument
    - [x] The listener function receives `(newValue, oldValue, scope)` — on the first invocation, `oldValue` equals `newValue`
    - [x] Registering a watcher without a listener function does not throw

- The digest cycle (`$digest`) iterates watchers until no changes are detected or TTL is exceeded.
  - **Acceptance Criteria:**
    - [x] `$digest` runs all watchers on the current scope and all descendant scopes
    - [x] `$digest` re-runs if any watcher's value changed (dirty checking)
    - [x] `$digest` throws an error after 10 iterations (TTL) if watchers keep changing
    - [x] `$digest` handles NaN correctly (NaN === NaN for dirty checking purposes)
    - [x] `$digest` uses a short-circuit optimization: stops checking remaining watchers if the last dirty watcher is clean
    - [x] Exceptions in watch functions or listeners are caught and logged but do not abort the digest

- Value-based watching uses `structuredClone` for deep comparison.
  - **Acceptance Criteria:**
    - [x] When `valueEq` is `true`, changes within arrays or nested objects trigger the listener
    - [x] When `valueEq` is `false` (default), only reference changes trigger the listener

- Watchers can be deregistered, including during a digest cycle.
  - **Acceptance Criteria:**
    - [x] Calling the deregistration function during a digest does not corrupt the watcher iteration
    - [x] A watcher can deregister itself from within its own watch or listener function
    - [x] A watcher can deregister other watchers from within its listener

### 2.3. $watchGroup

- Multiple watchers can be grouped via `$watchGroup(watchFns, listenerFn)`.
  - **Acceptance Criteria:**
    - [x] The listener is called once per digest with arrays of `[newValues, oldValues]` when any watched value changes
    - [x] `$watchGroup` returns a deregistration function that removes all grouped watchers
    - [x] An empty `watchFns` array calls the listener once with empty arrays, then never again
    - [x] On the first call, `oldValues` equals `newValues`

### 2.4. $watchCollection

- Shallow collection watching via `$watchCollection(watchFn, listenerFn)` detects element-level changes in arrays and property-level changes in objects.
  - **Acceptance Criteria:**
    - [x] Detects array element additions, removals, and reorderings
    - [x] Detects object property additions, removals, and value changes
    - [x] Does NOT deep-compare nested objects (shallow only)
    - [x] Handles NaN values in arrays correctly
    - [x] Detects when a value changes type (e.g., from primitive to array, or array to object)
    - [x] The listener receives `(newValue, oldValue, scope)` — `oldValue` reflects the previous collection state
    - [x] Only supports plain arrays and plain objects (not array-like objects)

### 2.5. Scope Evaluation and Application

- `$eval(expr, locals)` executes a function with the scope as context.
  - **Acceptance Criteria:**
    - [x] `$eval(fn)` calls `fn(scope)` and returns the result
    - [x] `$eval(fn, locals)` calls `fn(scope, locals)` and returns the result
    - [x] `$eval()` with no arguments returns `undefined`

- `$apply(expr)` wraps `$eval` and triggers a root digest.
  - **Acceptance Criteria:**
    - [x] `$apply(fn)` calls `$eval(fn)`, then triggers `$digest` on the root scope
    - [x] `$apply` sets `$$phase` to `'$apply'` during execution
    - [x] If the expression throws, the digest still runs (in a `finally` block)

### 2.6. Async Scheduling

- `$evalAsync(expr)` queues an expression for deferred execution within the current or next digest.
  - **Acceptance Criteria:**
    - [x] Queued expressions are consumed at the start of each digest pass
    - [x] If no digest is in progress, `$evalAsync` schedules one via `setTimeout`
    - [x] Exceptions in `$evalAsync` expressions are caught but do not abort the digest

- `$applyAsync(expr)` coalesces multiple apply calls into a single digest.
  - **Acceptance Criteria:**
    - [x] Multiple `$applyAsync` calls are batched into a single `setTimeout` + `$apply`
    - [x] If a digest is already running, the `$applyAsync` queue is drained within it
    - [x] Exceptions in individual expressions do not prevent others from running

- `$$postDigest(fn)` queues a function to run after the current digest completes.
  - **Acceptance Criteria:**
    - [x] Functions run after the digest finishes, not during
    - [x] Changes made in `$$postDigest` are NOT automatically dirty-checked (require another digest)
    - [x] Exceptions are caught and do not prevent other post-digest functions from running

### 2.7. Phase Tracking

- The scope tracks the current phase (`$$phase`) to prevent nested digest/apply calls.
  - **Acceptance Criteria:**
    - [x] `$$phase` is `'$digest'` during a digest cycle
    - [x] `$$phase` is `'$apply'` during an `$apply` call
    - [x] `$$phase` is `null` when idle
    - [x] Calling `$digest` or `$apply` while a phase is active throws an error

### 2.8. Event System

- Scopes support event registration and propagation via `$on`, `$emit`, and `$broadcast`.
  - **Acceptance Criteria:**
    - [x] `$on(eventName, listener)` registers a listener and returns a deregistration function
    - [x] Multiple listeners can be registered for the same event
    - [x] Deregistering a listener during event propagation does not skip other listeners

- `$emit(eventName, ...args)` propagates events upward through the scope hierarchy.
  - **Acceptance Criteria:**
    - [x] The event fires on the current scope, then each ancestor up to `$root`
    - [x] The event object contains `{ name, targetScope, currentScope, stopPropagation, preventDefault, defaultPrevented }`
    - [x] Calling `stopPropagation()` prevents the event from reaching further ancestors
    - [x] Additional arguments are passed to listeners after the event object

- `$broadcast(eventName, ...args)` propagates events downward through all descendants.
  - **Acceptance Criteria:**
    - [x] The event fires on the current scope and all descendant scopes
    - [x] `stopPropagation` does NOT stop `$broadcast` (it only affects `$emit`)
    - [x] Additional arguments are passed to listeners after the event object

### 2.9. Scope Destruction

- `$destroy()` removes a scope from the hierarchy and cleans up resources.
  - **Acceptance Criteria:**
    - [x] `$destroy` broadcasts a `$destroy` event on the scope (reaching all descendants)
    - [x] The scope is removed from its parent's `$$children` array
    - [x] `$$watchers` is set to `null` to prevent further digest processing
    - [x] `$$listeners` is emptied
    - [x] Destroying the root scope does not throw

---

## 3. Scope and Boundaries

### In-Scope

- Full `Scope` class implementation in `src/core/`
- All watch variants: `$watch`, `$watchGroup`, `$watchCollection`
- Digest cycle with TTL, short-circuit optimization, and phase tracking
- Scope hierarchy: `$new` (normal, isolated, custom parent), `$destroy`
- Async scheduling: `$evalAsync`, `$applyAsync`, `$$postDigest`
- Event system: `$on`, `$emit`, `$broadcast`
- Comprehensive Vitest test suite achieving behavioral parity with legacy tests
- TypeScript types exported for downstream module consumption

### Out-of-Scope

- **Expression Parser** — string expression support in `$watch`/`$eval` (separate spec, Phase 0)
- **Utility Functions** — helper function reimplementation (separate spec, Phase 0)
- **Validate & Remove Legacy** — test parity validation and legacy folder deletion (separate roadmap item)
- **Dependency Injection** — module system, injector, providers (Phase 1)
- **Phase tracking extras** — `$beginPhase`, `$clearPhase` as public API (Phase 1 roadmap item)
- **TTL configuration** — configurable digest TTL (Phase 1 roadmap item)
- **Directives & DOM Compilation** — compiler, linking (Phase 2)
- **Expressions & Filters** — interpolation, one-time bindings, filter pipeline (Phase 2)
- **HTTP, Routing, Forms, Animations** — Phases 3 and 4
