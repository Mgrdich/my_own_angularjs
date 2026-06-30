/**
 * Public barrel for the `@async` module — the promise & async toolkit
 * (`$q`, and in later slices `$timeout` / `$interval`).
 *
 * Slice 1 exposes the pure `createQ` factory plus its public types
 * (`QService`, `QPromise`, `QDeferred`). The internal promise class is
 * deliberately NOT exported (it would shadow the global `Promise`); consumers
 * interact with promises only through the `QPromise` type and instances
 * returned by `$q`. The DI registration lives on `ngModule` (`src/core/ng-module.ts`),
 * not here — mirroring the dominant precedent where a service ships a pure
 * factory AND a `ngModule` registration.
 */

export { createQ } from '@async/q';
export type { QService, QPromise, QDeferred, QOptions, QExecutor, QSettledResult, Thenable } from '@async/q-types';
export { createTimeout } from '@async/timeout';
export { createInterval } from '@async/interval';
export type { TimeoutService, TimeoutOptions, IntervalService, IntervalOptions, TimerId } from '@async/async-types';
