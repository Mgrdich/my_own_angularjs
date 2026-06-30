# Functional Specification: Promises & Async (`$q`, `$timeout`, `$interval`)

- **Roadmap Item:** Promises & Async — `$q` promise implementation, `$timeout`, `$interval`
- **Status:** Completed
- **Author:** AWOS spec workflow

---

## 1. Overview and Rationale (The "Why")

A developer building on this framework today has no built-in way to model work that finishes later — a value that will arrive "eventually," a one-off task that should run after a short delay, or a task that should repeat on a schedule. They can reach for the browser's native promise and timer facilities, but those run *outside* the framework's update cycle: when the deferred work finishes and changes the data, the on-screen content does **not** refresh on its own. The developer is forced to manually nudge the framework after every asynchronous step, which is easy to forget and produces "the data changed but the screen didn't" bugs.

This change delivers a small family of asynchronous building blocks that are **aware of the framework's update cycle**, so deferred results and scheduled tasks refresh bound content automatically:

- A **promise toolkit** for representing a result that will be available later, chaining follow-up steps onto it, reacting to success or failure, and combining several pending results into one.
- A **deferred one-off task** that runs after an optional delay, can be cancelled before it runs, and reports its result as a promise.
- A **repeating task** that runs on a fixed schedule for a set number of times (or indefinitely), can be cancelled, and reports progress as it ticks.

These pieces are also the foundation the later networking and routing features depend on, so getting them right and consistent now pays forward.

Behavior is validated against original AngularJS wherever the two overlap — this targets parity with `$q`, `$timeout`, and `$interval`. A few intentional additions and deviations (Section 3) are called out explicitly so they are tested as deliberate, not as parity bugs.

**Desired outcome:** a developer can express "do this later," "do this after a delay," and "do this repeatedly" in one consistent style; results flow through clear success/failure paths; and whenever deferred work changes the data, the bound content updates on its own — no manual refresh.

**Success measure:** a developer can model and combine asynchronous results, schedule and cancel delayed and repeating tasks, and see bound content refresh automatically on completion — all without reading the framework source, and with results that carry their correct value type through every step.

---

## 2. Functional Requirements (The "What")

> Throughout this document, "**update cycle**" means the framework's existing data-refresh pass — the same mechanism that re-evaluates bound expressions and updates the screen. "**Settle**" means a pending result finishes, either by **succeeding** (delivering a value) or **failing** (delivering a reason).

### 2.1 Create and hand out a result that will arrive later

- A developer can create a **pending result** they control directly: they obtain a controller object, hand its associated promise to other code, and later mark the result as either succeeded (with a value) or failed (with a reason).
- Once settled, the result is **final** — a later attempt to succeed or fail the same result has no effect.
- **Acceptance Criteria:**
  - [x] Given a developer creates a pending result, when they later mark it as succeeded with a value, then any success follow-up attached to its promise receives that value.
  - [x] Given a developer creates a pending result, when they later mark it as failed with a reason, then any failure follow-up attached to its promise receives that reason.
  - [x] Once a result has settled, a subsequent attempt to succeed or fail it again is ignored (the first outcome stands).

### 2.2 Construct a promise directly

- A developer can create a promise **directly**, without separately managing a controller, by providing a single piece of work that is handed the means to succeed or fail.
- A developer can wrap an **already-known value** as an immediately-succeeded promise, and wrap an **already-known reason** as an immediately-failed promise.
- Wrapping something that is already a promise returns an equivalent promise (it is not double-wrapped).
- **Acceptance Criteria:**
  - [x] Given a developer constructs a promise from a single unit of work, when that work signals success with a value, then success follow-ups receive the value; when it signals failure, failure follow-ups receive the reason.
  - [x] Wrapping a plain value yields a promise that immediately succeeds with that value.
  - [x] Wrapping a reason as a failure yields a promise that immediately fails with that reason.
  - [x] Wrapping a value that is itself a promise yields a promise equivalent to it, not a promise-of-a-promise.

### 2.3 React to success and failure, and chain follow-ups

- A developer can attach a **success follow-up**, a **failure follow-up**, or both, to any promise.
- Follow-ups can be **chained**: the value a follow-up returns becomes the input to the next follow-up; if a follow-up itself returns a pending result, the chain waits for it before continuing.
- A developer can attach a **failure-only** follow-up as a shorthand, and a **finally** follow-up that runs once the promise settles regardless of success or failure (for cleanup).
- A failure that is not handled at one step **propagates** down the chain until a failure follow-up handles it; a handled failure allows the chain to continue on the success path.
- **Acceptance Criteria:**
  - [x] Given a promise that succeeds, when a developer attaches a success follow-up, then it runs with the delivered value.
  - [x] Given a promise that fails, when a developer attaches a failure follow-up, then it runs with the delivered reason.
  - [x] When follow-ups are chained, the value returned by one is passed to the next; if a follow-up returns a pending result, the next step waits for that result to settle first.
  - [x] A failure-only shorthand follow-up runs when (and only when) the promise fails.
  - [x] A finally follow-up runs once the promise settles, whether it succeeded or failed, and does not alter the value or reason passing through (unless it itself fails).
  - [x] An unhandled failure continues down the chain until a failure follow-up handles it.

### 2.4 Combine several pending results

- A developer can wait for **all** of several pending results at once and receive their values together, preserving the original grouping (list order or named keys). If any one of them fails, the combined result fails with that reason.
- A developer can wait for the **first** of several pending results to settle and adopt its outcome (success or failure), ignoring the rest.
- A developer can wait for **every** result to settle and receive a per-item report of each one's outcome (succeeded-with-value or failed-with-reason) — this form never fails as a whole, even if some items failed.
- **Acceptance Criteria:**
  - [x] Given several pending results, when all of them succeed, then the combined result succeeds with their values grouped the same way they were provided (positional list or named keys).
  - [x] Given several pending results, when at least one fails, then the "wait for all" combined result fails with the first such reason.
  - [x] Given several pending results, when the first one settles, then the "wait for first" combined result adopts that outcome and disregards the others.
  - [x] Given several pending results, when every one has settled, then the "wait for every" combined result succeeds with a per-item report distinguishing succeeded-with-value from failed-with-reason, and it does not fail as a whole.

### 2.5 Bound content refreshes automatically when a result settles

- When a pending result settles, the framework runs an **update cycle on its own**, so content bound to the resulting data refreshes without the developer manually triggering a refresh — even when the work that settled the result originated outside an update cycle.
- **Acceptance Criteria:**
  - [x] Given content is bound to data that a success follow-up will set, when the pending result succeeds (including from work that started outside an update cycle), then the bound content reflects the new data without any further developer action.
  - [x] Follow-ups run asynchronously (not in the same step that settled the result), consistent with promise behavior.

### 2.6 Unhandled failures are reported, not swallowed

- When a pending result **fails and no failure follow-up ever handles it**, the framework reports the failure through its **central error-reporting channel** (the same place other framework-internal errors are surfaced), rather than failing silently.
- A failure that *is* handled somewhere in the chain is **not** reported as unhandled.
- **Acceptance Criteria:**
  - [x] Given a pending result fails and no failure follow-up handles it anywhere in its chain, then the failure is reported through the framework's central error-reporting channel.
  - [x] Given a pending result fails but a failure follow-up handles it, then nothing is reported as unhandled.

### 2.7 Schedule a one-off deferred task

- A developer can schedule a unit of work to run **once after an optional delay**. The scheduling call hands back a promise that **succeeds with the work's result** once it runs (or **fails** if the work fails).
- A developer can **cancel** a scheduled task before it runs; a cancelled task never runs and its promise **fails** to indicate cancellation. Cancelling a task that has already run (or was already cancelled) simply reports that nothing was cancelled.
- By default, completing the task triggers an **update cycle** so bound content refreshes; a developer can opt out of that automatic refresh for a task that does not touch bound data.
- A developer may pass through extra inputs to the scheduled work.
- **Acceptance Criteria:**
  - [x] Given a developer schedules a one-off task with a delay, when the delay elapses, then the work runs once and the returned promise succeeds with the work's result.
  - [x] Given a developer schedules a one-off task, when they cancel it before the delay elapses, then the work never runs and the returned promise fails to indicate cancellation.
  - [x] Cancelling a task that has already completed (or was already cancelled) reports that nothing was cancelled, and does not throw.
  - [x] By default, after the task runs, bound content that the task changed is refreshed without further developer action; when the developer opts out of the automatic refresh, the task still runs but no automatic refresh occurs.
  - [x] Extra inputs provided at scheduling time are passed through to the scheduled work.

### 2.8 Schedule a repeating task

- A developer can schedule a unit of work to run **repeatedly on a fixed interval**. They can cap it at a **set number of repetitions** or let it run **indefinitely**.
- The scheduling call hands back a promise that **reports progress on each repetition** (a notification carrying the repetition count) and **succeeds when the capped number of repetitions completes**; an indefinite schedule keeps reporting progress and does not settle on its own.
- A developer can **cancel** a repeating task at any time; cancelling stops further repetitions and **fails** the promise to indicate cancellation. Cancelling an already-finished or already-cancelled task reports that nothing was cancelled.
- By default, each repetition triggers an **update cycle**; a developer can opt out for a task that does not touch bound data.
- A developer may pass through extra inputs to the repeated work.
- **Acceptance Criteria:**
  - [x] Given a developer schedules a repeating task with a repetition cap, when the interval elapses repeatedly, then the work runs once per interval, a progress notification is reported on each repetition, and the promise succeeds after the final capped repetition.
  - [x] Given a developer schedules an indefinite repeating task, then it keeps running and reporting progress on each interval and does not settle on its own.
  - [x] Given a repeating task is running, when the developer cancels it, then no further repetitions occur and the promise fails to indicate cancellation.
  - [x] Cancelling an already-finished or already-cancelled repeating task reports that nothing was cancelled, and does not throw.
  - [x] By default, each repetition refreshes bound content the task changed without further developer action; when the developer opts out, repetitions still run but no automatic refresh occurs.
  - [x] Extra inputs provided at scheduling time are passed through to the repeated work.

### 2.9 Results carry their correct value type

- The promises, follow-ups, and scheduling results are **typed against the value they carry**, so a developer reading a delivered value or a combined result gets a correctly typed result without manual type assertions.
- **Acceptance Criteria:**
  - [x] Retrieving the value delivered to a success follow-up yields a result of the correct type, with no manual type assertion required.
  - [x] The grouped result of a "wait for all" reflects the correct type for each grouped item (positional or named), with no manual type assertion required.

---

## 3. Intentional additions and parity deviations

These differences from classic AngularJS are deliberate and should be treated as expected behavior (tested as intentional, not as parity bugs):

- **"Wait for first" and "wait for every" are included.** Classic AngularJS `$q` did not ship a "wait for first to settle" or a "wait for every to settle (never fails as a whole)" combiner. Both are added here for modern parity and because the roadmap calls for the first one explicitly.
- **Direct promise construction with a single unit of work is included.** The modern "hand me the means to succeed or fail" construction style is supported alongside the classic controller-object style.
- **Failure-only and finally follow-ups are first-class.** Provided as ergonomic shorthands in addition to the classic two-argument success/failure form.
- **Acceptance Criteria:**
  - [x] Each addition above is observable and behaves as described, and is covered by a test that marks it as an intentional addition rather than a parity gap.

---

## 4. Scope and Boundaries

### In-Scope

- The promise toolkit: creating a controllable pending result, constructing a promise directly, wrapping known values/reasons, attaching success / failure / failure-only / finally follow-ups, chaining, and the three combiners ("wait for all", "wait for first", "wait for every").
- Automatic update-cycle refresh when a result settles.
- Central reporting of unhandled failures.
- The one-off deferred task with optional delay, cancellation, opt-out of automatic refresh, and pass-through inputs.
- The repeating task with repetition cap or indefinite running, per-repetition progress, cancellation, opt-out of automatic refresh, and pass-through inputs.
- Typed results carrying the correct value type through follow-ups and combiners.
- The new packaged area (if any) and registration so these are retrievable as standard framework services.

### Out-of-Scope

- **Networking** of any kind — these building blocks underpin the upcoming networking feature, but request methods, headers, interceptors, and transformations are a separate roadmap item.
- **Form behavior, validation, routing, animations** — separate roadmap items.
- Any global namespace object or classic-namespace surface — that is the separate Compatibility Layer phase.
- Cancellation of an arbitrary in-flight promise (classic AngularJS `$q` promises are not cancellable; only the timer-based tasks expose cancellation here, matching `$timeout` / `$interval`).
- The following separate roadmap items, automatically out-of-scope: **HTTP & Networking**, **Forms & Validation**, **Routing**, **Animations**, **Package & Distribution**, and the **AngularJS Compatibility Layer**.
