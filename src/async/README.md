# `@async` — promises & async: `$q` + `$timeout` + `$interval`

The `@async` module ships the three digest-aware asynchronous building
blocks AngularJS apps reach for: `$q` (a promise toolkit), `$timeout` (a
cancellable one-off deferred task), and `$interval` (a cancellable
repeating task). What makes them different from the browser's native
`Promise` / `setTimeout` / `setInterval` is that they are **aware of the
framework's update cycle** — when deferred work settles and changes bound
data, the screen refreshes on its own. No manual `$apply` after every
async step.

Each service ships as a PURE ESM-first factory (`createQ`,
`createTimeout`, `createInterval`) plus a DI registration on `ngModule`.
The factories take their digest / timer seams as injected options, so
they are unit-testable WITHOUT an injector; the `ngModule` registrations
bind those seams to the real `$rootScope` / `$exceptionHandler` / global
timers (`src/core/ng-module.ts`).

```ts
const injector = createInjector(['ng']);
const $q = injector.get('$q'); // QService
const $timeout = injector.get('$timeout'); // TimeoutService
const $interval = injector.get('$interval'); // IntervalService
```

## The digest-integration contract

This is the whole point of the module. `$q` continuations are NOT
processed on the native microtask queue — they are queued and flushed
inside the framework's update cycle via the injected `scheduleDigest`
seam, which `ngModule` binds to `$rootScope.$evalAsync`. Settling a
promise therefore schedules a digest, and that digest both drains the
queued `.then` continuations AND re-evaluates watchers — so content bound
to data a follow-up sets refreshes automatically, even when the work that
settled the promise originated outside a digest (FS §2.5).

```ts
$rootScope.$watch('greeting', (v) => {
  /* render v */
});

const deferred = $q.defer();
deferred.promise.then((name) => {
  $rootScope.greeting = `Hello ${name}`;
});

// Settle from OUTSIDE any digest — e.g. a native event handler:
deferred.resolve('Ada');
// A digest is scheduled on its own; the `.then` runs, sets `greeting`,
// and the watch fires — no manual $apply.
```

`$timeout` and `$interval` integrate the same way but through `$apply`
rather than `$evalAsync`: each scheduled run is **phase-guarded**. When
`invokeApply` is `true` (the default) AND no digest is currently in
flight (`$rootScope.$$phase === null`), the callback runs inside
`$rootScope.$apply` so bound content refreshes. When a digest is already
running (the timer fired mid-`$apply`), or when `invokeApply` is `false`,
the callback runs directly — calling `$apply` mid-digest would throw
`'$digest already in progress'`. Pass `invokeApply: false` to opt out of
the automatic refresh for a task that does not touch bound data.

## Always-on unhandled-rejection reporting

A rejected promise that no failure follow-up ever handles is reported
through the framework's central error-reporting channel —
`$exceptionHandler` with cause `'$q'` — rather than failing silently
(FS §2.6). Each promise carries a `handled` flag that flips the moment
ANY follow-up attaches (the derived promise inherits the
unhandled-tracking responsibility). The check is deferred to the
scheduled digest turn, so a failure handler attached slightly later in
the same turn still suppresses the report.

```ts
$q.reject(new Error('boom'));
// No `.catch` / failure follow-up anywhere → reported via
// $exceptionHandler(error, '$q') on the next digest turn.

$q.reject(new Error('boom')).catch(() => {
  /* recover */
});
// Handled → NOT reported.
```

This reporting is **always on** — there is no
`$qProvider.errorOnUnhandledRejections(false)` toggle in this spec (a
documented deviation; it may be added later).

## Intentional additions & deviations (FS §3)

The following differ from classic AngularJS `$q` and are DELIBERATE — they
are tested as intentional additions, not parity gaps:

- **`$q.race(inputs)`** — adopt the FIRST settlement (success or failure),
  ignoring the rest. Classic `$q` shipped no race combiner.
- **`$q.allSettled(inputs)`** — wait for EVERY input to settle and succeed
  with a per-item discriminated report
  (`{ status: 'fulfilled', value } | { status: 'rejected', reason }`).
  Never fails as a whole. Classic `$q` shipped no allSettled.
- **`$q(executor)` — the ES6-style constructor.** Construct a promise
  directly from a single unit of work handed `resolve` / `reject`,
  alongside the classic `$q.defer()` controller-object style. A
  synchronous throw from the executor fails the promise.
- **`.catch(onRejected)` / `.finally(callback)`** — failure-only and
  cleanup shorthands, first-class alongside the classic two-argument
  `.then(onOk, onErr)` form.

Other deviations: unhandled-rejection reporting is always on (no toggle,
above); the cancellation reason for `$timeout.cancel` / `$interval.cancel`
is the literal string `'canceled'`.

## `$q` — worked examples

### Deferred + chaining

```ts
const deferred = $q.defer<number>();

deferred.promise
  .then((n) => n * 2) // value returned → input to the next step
  .then((n) => $q.resolve(n + 1)) // returning a promise defers the chain
  .then((n) => {
    /* n === 21 */
  });

deferred.resolve(10);
```

### Construct, wrap, recover

```ts
// ES6-style constructor (intentional addition §3):
const p = $q<string>((resolve, reject) => {
  if (ok) resolve('done');
  else reject(new Error('nope'));
});

// Wrap a known value / reason:
const ready = $q.resolve(42); // immediately-succeeded
const failed = $q.reject('bad'); // immediately-failed
const same = $q.when(ready); // adopts — no promise-of-a-promise

// Failure-only + cleanup shorthands:
p.catch((reason) => `recovered: ${String(reason)}`).finally(() => {
  /* always runs; value/reason passes through unless this throws */
});
```

### `$q.all` — wait for all (positional and keyed)

```ts
// Positional — per-slot value types are preserved (see typing note below):
$q.all([$q.resolve(1), $q.resolve('two')]).then(([a, b]) => {
  /* a: number, b: string */
});

// Keyed — grouping preserved by name:
$q.all({ user: fetchUser(), perms: fetchPerms() }).then(({ user, perms }) => {
  /* typed by key */
});
// Rejects with the FIRST failing reason; plain (non-promise) inputs count
// as already-resolved.
```

## `$timeout` — worked example (with cancel)

```ts
// Schedule once after 1000ms; the promise succeeds with fn's return value.
const promise = $timeout(() => {
  $rootScope.message = 'loaded'; // bound content refreshes by default
  return 'loaded';
}, 1000);

promise.then((result) => {
  /* result === 'loaded' */
});

// Cancel before it fires — the work never runs and the promise REJECTS
// with 'canceled'; returns true. Cancelling an already-run / unknown
// promise returns false and does not throw.
const wasCancelled = $timeout.cancel(promise); // true if still pending

// Opt out of the automatic refresh + pass extra args through:
$timeout(
  (a, b) => {
    /* a, b are the trailing args */
  },
  500,
  false,
  'a',
  'b',
);
```

A callback throw both REJECTS the promise AND routes via
`$exceptionHandler(err, '$timeout')` — because `$apply` is `try/finally`
(not `try/catch`), `$timeout` wraps the run in its own `try/catch`.

## `$interval` — worked example (with count + cancel)

```ts
// Run every 1000ms, capped at 3 repetitions. The callback receives the
// 1-based iteration count.
const promise = $interval(
  (iteration) => {
    $rootScope.tick = iteration; // refreshes by default
  },
  1000,
  3,
);

promise.then(
  (finalCount) => {
    /* finalCount === 3 — resolves after the final tick */
  },
  undefined,
  (iteration) => {
    /* progress notification on EACH tick: 1, 2, 3 */
  },
);

// count === 0 (the default) runs indefinitely and never self-settles.
const forever = $interval(() => {
  /* … */
}, 1000);

// Cancel at any time — stops further ticks, REJECTS the promise with
// 'canceled', returns true. Cancelling a finished / unknown promise
// returns false and does not throw.
$interval.cancel(forever);
```

Unlike `$timeout`, an `$interval` callback throw routes via
`$exceptionHandler(err, '$interval')` but does NOT settle the promise and
does NOT auto-cancel — the interval keeps ticking (AngularJS parity).

## Typing note: `$q.all` per-slot value types

`QPromise<U>` is not a native `PromiseLike`, so TS's built-in
`Awaited<QPromise<U>>` collapses to `unknown` and would lose the per-slot
value type in the combiner return types. The `AwaitedQ<T>` helper
(`@async/q-types`) peels each `QPromise` layer explicitly, then defers to
native `Awaited` for native thenables / plain values. As a result
`$q.all([$q.resolve(1), $q.resolve('x')])` infers `[number, string]` and
`$q.all({ a, b })` infers the keyed shape — no manual type assertion
required (FS §2.9).

## Forward-pointers

- **`$qProvider.errorOnUnhandledRejections(false)`** — the toggle that
  silences unhandled-rejection reporting is intentionally NOT shipped;
  reporting is always on in this spec. May be added later.
- **`$http`** — Phase 3 networking builds on `$q`; not in this module.
- **`$animate` hooks** — `$interval`'s callback does not integrate with
  animations; that lands with the Phase 4 animations roadmap item.
