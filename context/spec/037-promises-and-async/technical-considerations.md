<!--
This document describes HOW to build the feature at an architectural level.
It is NOT a copy-paste implementation guide.
-->

# Technical Specification: Promises & Async (`$q`, `$timeout`, `$interval`)

- **Functional Specification:** `context/spec/037-promises-and-async/functional-spec.md`
- **Status:** Draft
- **Author(s):** AWOS tech workflow

---

## 1. High-Level Technical Approach

Add a new `src/async/` module exporting three ESM-first pure factories — `createQ`, `createTimeout`, `createInterval` — plus their DI registrations on the core `ngModule`. They **compose existing machinery**: `$q` schedules digests via `$rootScope.$evalAsync` (the auto-`setTimeout`-when-idle seam at `src/core/scope.ts:536`), `$timeout`/`$interval` settle `$q` promises and run the digest via the `$$phase`-guarded `$apply` pattern established by the event directives (`src/compiler/ng-event-directives.ts:203-220`), and all three route errors through the existing `invokeExceptionHandler` (`src/exception-handler/exception-handler.ts:119`).

Two additive, cross-cutting touches to existing code are required:

1. **`EXCEPTION_HANDLER_CAUSES`** (`src/exception-handler/exception-handler-types.ts:89`) grows from 10 → 13 with new `'$q'`, `'$timeout'`, `'$interval'` cause tokens (public-API additive change, following the `$filter`/`$compile` precedent).
2. **`ngModule`** (`src/core/ng-module.ts`) gains three `.factory(...)` registrations and three `ModuleRegistry` entries.

Everything else lives behind the new `@async` subpath, mirroring the `./sce` / `./interpolate` layout (alias, `package.json` export, Rollup entry, vitest alias, root barrel). The packaging follows the dominant precedent: a service lives on `ngModule` **and** ships a pure factory usable without an injector.

---

## 2. Proposed Solution & Implementation Plan (The "How")

### 2.1 New module: `src/async/`

| File | Responsibility |
| --- | --- |
| `src/async/index.ts` | Barrel: `createQ`, `createTimeout`, `createInterval`, `ngModule`-less factories + all public types |
| `src/async/q.ts` | `createQ(options)` — the promise engine: `Deferred`, `Promise` (the internal promise class), the `$q` callable + statics |
| `src/async/q-types.ts` | Public types: `QService`, `QPromise<T>`, `QDeferred<T>`, `QResolver<T>`, `QPromiseState`, error/rejection shapes |
| `src/async/timeout.ts` | `createTimeout(options)` — `$timeout` callable + `.cancel` |
| `src/async/interval.ts` | `createInterval(options)` — `$interval` callable + `.cancel` |
| `src/async/async-types.ts` | `TimeoutService`, `IntervalService`, factory option shapes |
| `src/async/register.ts` _(or inline in `ng-module.ts`)_ | The three `.factory` DI registrations (kept thin) |
| `src/async/__tests__/*.test.ts` | Unit + parity tests (vitest fake timers) |

> Naming note: the internal promise class is module-private to avoid colliding with the global `Promise`; it is exposed only through the `QPromise<T>` **type** and instances returned by `$q`. No `new Promise` global shadowing in public surface.

### 2.2 Pure-factory contracts (ESM-first, DI shim on top)

| Factory | Signature (shape) | Returns |
| --- | --- | --- |
| `createQ` | `(opts: { exceptionHandler: ExceptionHandler; scheduleDigest: (fn: () => void) => void }) → QService` | the `$q` callable + statics |
| `createTimeout` | `(opts: { q: QService; exceptionHandler: ExceptionHandler; apply: (fn: () => void) => void; defer: (fn, delay) => TimerId; cancelDefer: (id) => void; rootPhase: () => ScopePhase }) → TimeoutService` | the `$timeout` callable + `.cancel` |
| `createInterval` | `(opts: { q: QService; exceptionHandler: ExceptionHandler; apply; setIntervalFn; clearIntervalFn; rootPhase })  → IntervalService` | the `$interval` callable + `.cancel` |

- **`scheduleDigest`** is the injected seam onto `$rootScope.$evalAsync` — `$q` calls it whenever a promise settles so the digest drains the queued continuation (`scope.ts:536-546`). Injecting it (rather than importing a global root) keeps `createQ` pure and unit-testable without an injector.
- **`apply` / `rootPhase`** are the seams onto `$rootScope.$apply` and `$rootScope.$$phase` for the timers' "run callback + digest, guarded by phase" path.
- The DI factories (§2.6) bind these seams to the real `$rootScope` / `$exceptionHandler`.

### 2.3 `$q` engine (`q.ts`) — behavior & internal model

A tree-walking-free, state-machine promise consistent with AngularJS `$q` (Promises/A+ aligned, digest-scheduled):

- **States:** `pending → resolved | rejected` (final-once-settled, FS 2.1). Internal state holds `{ status, value, pending: callbacks[] }`.
- **`Deferred`** (FS 2.1): `{ promise, resolve(value), reject(reason), notify(state) }`. `resolve` adopts thenables (FS 2.2 "no double-wrapping") by detecting a `.then` and chaining.
- **`$q(executor)`** (FS 2.2): the ES6-style constructor — calls `executor(resolve, reject)` synchronously, wrapping a thrown executor as a rejection.
- **`$q.resolve` / `$q.when`** (aliases), **`$q.reject`** (FS 2.2). `when` is the classic name; `resolve` the modern alias — same impl.
- **`.then(onOk?, onErr?, onNotify?)`** (FS 2.3): registers callbacks; returns a derived promise. Settlement schedules callback processing via `scheduleDigest` (so continuations run asynchronously inside a digest, FS 2.5). A callback's return value resolves the derived promise; a thrown callback rejects it; a returned thenable is awaited.
- **`.catch(onErr)`** = `.then(undefined, onErr)` (FS 2.3 failure-only shorthand).
- **`.finally(cb)`** (FS 2.3): runs `cb` on settle; passes value/reason through unless `cb` throws or returns a rejecting thenable.
- **Combiners** (FS 2.4):
  - `$q.all(promisesArrayOrObject)` → succeeds with values in the same grouping (array index ↔ object keys); rejects on first failure.
  - `$q.race(iterable)` → adopts the first settlement (intentional addition beyond classic `$q`, FS §3).
  - `$q.allSettled(iterable)` → never rejects; resolves with per-item `{ status: 'fulfilled', value } | { status: 'rejected', reason }` (intentional addition, FS §3).
- **Unhandled-rejection reporting** (FS 2.6): a rejection with **no** registered failure handler anywhere in its chain is reported via `invokeExceptionHandler(exceptionHandler, reason, '$q')`. Implementation approach: track a per-promise `handled` flag; when a promise settles rejected, schedule a check (on the same digest turn) that reports if still unhandled and no derived promise took over the rejection. A handler attached later that handles it flips the flag before the scheduled check fires. (Mirrors AngularJS's `markQStateExceptionHandled` / `$q.errorOnUnhandledRejections` behavior; this project keeps it **always on** — see Risks.)

### 2.4 `$timeout` (`timeout.ts`) — behavior

`$timeout(fn?, delay = 0, invokeApply = true, ...args)` (FS 2.7):
- Creates a `Deferred`; arms a global `setTimeout(delay)`.
- On fire: runs `fn(...args)` inside `apply()` when `invokeApply` is `true` **and** `rootPhase() === null`; otherwise runs `fn` then `scheduleDigest` (phase-guarded, avoiding the `'$digest already in progress'` throw, `scope.ts:938`). A throw from `fn` rejects the promise **and** routes via `invokeExceptionHandler(..., '$timeout')` (because `$apply` is `try/finally`, not `try/catch` — `scope.ts:498`).
- Resolves the promise with `fn`'s return value.
- Returns the promise; `$timeout.cancel(promise)` clears the pending `setTimeout`, **rejects** the promise (cancellation signal), and returns `true`; cancelling an already-settled/unknown promise returns `false` and does not throw (FS 2.7).
- A promise→timer registry (a `Map<QPromise, TimerId>`, per-factory closure) backs `cancel`.

### 2.5 `$interval` (`interval.ts`) — behavior

`$interval(fn, delay, count = 0, invokeApply = true, ...args)` (FS 2.8):
- Creates a `Deferred`; arms a global `setInterval(delay)`.
- On each tick: increments an iteration counter, runs `fn(iteration, ...args)` (phase-guarded apply as in §2.4), then **`notify(iteration)`** on the deferred (per-repetition progress). A throw routes via `invokeExceptionHandler(..., '$interval')` and (parity) does **not** auto-cancel.
- When `count > 0` and the counter reaches it: `clearInterval`, **resolve** with the final count. `count === 0` ⇒ indefinite (never self-settles).
- `$interval.cancel(promise)`: `clearInterval`, **reject** (cancellation), return `true`; unknown/settled ⇒ `false`, no throw.

### 2.6 DI registration (touch: `src/core/ng-module.ts`)

Extend the `ng` chain with three `.factory` registrations (array-wrapped for strict `annotate`), and add the three keys to the `ModuleRegistry` type block (`ng-module.ts:115-137`):

| Service | Deps | Binds |
| --- | --- | --- |
| `$q` | `['$rootScope', '$exceptionHandler', factory]` | `createQ({ exceptionHandler, scheduleDigest: fn => $rootScope.$evalAsync(fn) })` |
| `$timeout` | `['$rootScope', '$q', '$exceptionHandler', factory]` | `createTimeout({ q, exceptionHandler, apply: fn => $rootScope.$apply(fn), rootPhase: () => $rootScope.$$phase, defer: setTimeout, cancelDefer: clearTimeout })` |
| `$interval` | `['$rootScope', '$q', '$exceptionHandler', factory]` | `createInterval({ q, exceptionHandler, apply, rootPhase, setIntervalFn: setInterval, clearIntervalFn: clearInterval })` |

Registry types: `$q: QService`, `$timeout: TimeoutService`, `$interval: IntervalService`.

> The `$rootScope` factory is currently dependency-free and its `$$exceptionHandler` can diverge from the DI `$exceptionHandler` (`ng-module.ts:159-165` TODO). Therefore `$q`/`$timeout`/`$interval` inject `$exceptionHandler` **directly** rather than reading `$rootScope.$$exceptionHandler`.

### 2.7 Exception-handler cause tokens (touch: `src/exception-handler/exception-handler-types.ts`)

Append `'$q'`, `'$timeout'`, `'$interval'` to the frozen `EXCEPTION_HANDLER_CAUSES` tuple (10 → 13). `ExceptionHandlerCause` widens automatically (it is `(typeof EXCEPTION_HANDLER_CAUSES)[number]`). Update the JSDoc cause tables. This is the public-API-additive part of the change; the prior-spec suite must still pass with the larger tuple (no test should assert `length === 10` — verify).

### 2.8 Packaging (mirror `./sce`) — six touchpoints

- `tsconfig.json`: add `@async/*` path.
- `vitest.config.ts`: add `@async` alias.
- `package.json`: add `./async` to `exports` (import/require/types triple).
- `rollup.config.mjs`: add the `src/async/index.ts` entry **and** the `@async/*` dts path alias.
- Root barrel `src/index.ts`: re-export the three factories + public types.
- `src/async/index.ts`: the module barrel.

---

## 3. Impact and Risk Analysis

- **System Dependencies:** `@core` (`$rootScope` / `Scope` — `$evalAsync`, `$apply`, `$$phase`), `@di` (factory registration + `ModuleRegistry` typing), `@exception-handler` (`invokeExceptionHandler` + the cause tuple). `$timeout`/`$interval` depend on `$q`. No dependency on `@compiler` — these are runtime services, DOM-free, so the `@async` bundle stays compiler-free.
- **Potential Risks & Mitigations:**
  - **Digest TTL exhaustion from promise re-queuing.** A promise chain that re-queues `$evalAsync` every digest can blow the TTL (`scope.ts:426`). _Mitigation:_ schedule callback processing once per settlement (not per digest); port AngularJS's `processQueue` coalescing; add a parity test that a resolved-chain settles within the digest without TTL growth.
  - **Unhandled-rejection false positives.** Reporting too eagerly flags rejections that get a handler attached slightly later in the same turn. _Mitigation:_ defer the unhandled check to the scheduled digest turn and clear the flag when a failure handler attaches; port the upstream `$q` unhandled-rejection test vectors. Decision: keep reporting **always on** (no `$qProvider.errorOnUnhandledRejections(false)` toggle in this spec — documented deviation; can be added later if needed).
  - **`$apply` is `try/finally`, not `try/catch`** (`scope.ts:498`). A timer/promise callback throw would otherwise escape unreported. _Mitigation:_ every callback invocation site wraps in `try/catch` → `invokeExceptionHandler` with the right cause, exactly as the event directives do (`ng-event-directives.ts`).
  - **Phase collisions.** Calling `$apply` while a digest is in flight throws (`scope.ts:938`). _Mitigation:_ the `rootPhase() === null ? apply : evalAsync` guard on every timer fire; pinned by a "fires during digest" test.
  - **Global-timer testability.** Direct `setTimeout`/`setInterval` calls. _Mitigation:_ vitest fake timers (`vi.useFakeTimers` + `vi.advanceTimersByTime`), the established `scope-async.test.ts` pattern; the factory still accepts the timer fns as options so a future test can inject without fake timers if needed.
  - **`EXCEPTION_HANDLER_CAUSES` growth is a public-API change.** _Mitigation:_ additive append only; update JSDoc tables; grep the suite for any hardcoded `length`/`=== 10` assertion before changing.

---

## 4. Testing Strategy

- **Unit (vitest, fake timers):**
  - `$q`: defer resolve/reject finality; `$q(executor)`; `resolve`/`when`/`reject`; thenable adoption (no double-wrap); `.then` chaining incl. returned-promise waiting; `.catch`; `.finally` pass-through + throw; `all` (array + object grouping, first-failure); `race`; `allSettled` (never rejects, per-item report).
  - Digest integration: a resolution from outside a digest triggers a digest and refreshes a bound `$watch` value (FS 2.5); callbacks run asynchronously, not synchronously on settle.
  - Unhandled rejection: unhandled → routed via `$exceptionHandler('$q')`; handled-later → not reported (FS 2.6).
  - `$timeout`: fires after delay, resolves with return value; cancel-before-fire rejects + never runs; cancel-after-settle ⇒ `false`, no throw; `invokeApply: false` runs without auto-refresh; extra args passed through; callback throw rejects + routes `'$timeout'`.
  - `$interval`: per-tick `notify`; capped count resolves after final tick; indefinite never self-settles; cancel rejects + stops; cancel-unknown ⇒ `false`; `invokeApply: false`; args pass-through; callback throw routes `'$interval'` and does not auto-cancel.
- **Parity tests:** port the relevant upstream `$q`/`$timeout`/`$interval` scenarios (digest scheduling, unhandled-rejection vectors, cancellation semantics) per the architecture's reference-implementation rule.
- **Type-level:** `injector.get('$q')` narrows to `QService`; `$timeout(fn).then(v => …)` infers the callback return type; `$q.all([p1, p2])` infers the tuple/positional value types and `$q.all({a, b})` the keyed shape.
- **Coverage:** new `async` module held to the 90% per-module line threshold (add `async` to the architecture's enumerated coverage set / `vitest.config.ts` if listed).
- **Gates:** `pnpm lint` / `format:check` / `typecheck` / `test` / `build` all green; full prior-spec suite green; **`EXCEPTION_HANDLER_CAUSES.length === 13`** after this spec (the only spec that changes it); `./async` exports resolve from both `dist` root entries (ESM + CJS + `.d.ts`).
