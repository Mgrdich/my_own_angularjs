/**
 * `$q` / `$timeout` / `$interval` type-level tests (spec 037 Slice 5).
 *
 * Compile-time assertions via `expectTypeOf` — these prove the typed public
 * surface flows value types correctly through the async toolkit:
 *
 * - `injector.get('$q' | '$timeout' | '$interval')` narrows to the right service
 *   shape (the `ModuleRegistry` widening on `ngModule`).
 * - `$timeout(fn).then(v => …)` infers the callback's value type.
 * - `$q.all([...])` infers positional tuple element types; `$q.all({ … })` the
 *   keyed object shape.
 * - `$q.allSettled(...)` per-item discriminated union narrows on `status`.
 * - `$q.resolve` / `$q.reject` / `defer<T>()` produce the right `QPromise<…>`
 *   value types; `.catch` / `.finally` preserve / widen the value type as the
 *   real signatures declare.
 *
 * Every assertion mirrors what the implementation ACTUALLY exposes today — where
 * a signature is weaker than ideal it is asserted as-real with an inline note,
 * never as an aspirational type.
 */

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import type { QPromise, QService, QSettledResult } from '@async/q-types';
import type { IntervalService, TimeoutService } from '@async/async-types';
import { describe, expectTypeOf, it } from 'vitest';

const injector = createInjector([ngModule]);

describe('injector.get narrows the async services (ModuleRegistry)', () => {
  it('$q narrows to QService', () => {
    expectTypeOf(injector.get('$q')).toEqualTypeOf<QService>();
  });

  it('$timeout narrows to TimeoutService', () => {
    expectTypeOf(injector.get('$timeout')).toEqualTypeOf<TimeoutService>();
  });

  it('$interval narrows to IntervalService', () => {
    expectTypeOf(injector.get('$interval')).toEqualTypeOf<IntervalService>();
  });
});

describe('$timeout — resolved value type flows into .then', () => {
  it('infers the callback return type onto the promise', () => {
    const $timeout = injector.get('$timeout');
    const promise = $timeout(() => 'done', 100);
    expectTypeOf(promise).toEqualTypeOf<QPromise<string>>();

    // The resolved value type flows into the .then callback parameter.
    promise.then((value) => {
      expectTypeOf(value).toEqualTypeOf<string>();
      return value;
    });
  });

  it('a numeric callback produces QPromise<number>', () => {
    const $timeout = injector.get('$timeout');
    const promise = $timeout(() => 42, 0);
    expectTypeOf(promise).toEqualTypeOf<QPromise<number>>();
    promise.then((value) => {
      expectTypeOf(value).toEqualTypeOf<number>();
    });
  });

  it('an omitted callback resolves with the default type parameter (unknown)', () => {
    const $timeout = injector.get('$timeout');
    // No callback — `T` is left at its `unknown` default.
    expectTypeOf($timeout()).toEqualTypeOf<QPromise<unknown>>();
  });
});

describe('$interval — repeating service value type', () => {
  it('always resolves with the final count (number)', () => {
    const $interval = injector.get('$interval');
    const promise = $interval(() => undefined, 100, 3);
    expectTypeOf(promise).toEqualTypeOf<QPromise<number>>();
    promise.then((count) => {
      expectTypeOf(count).toEqualTypeOf<number>();
    });
  });
});

describe('$q.all — grouping inference (FS §2.4)', () => {
  const $q = injector.get('$q');

  it('positional array preserves per-slot value types (AwaitedQ tuple)', () => {
    const p1 = $q.resolve(1); // QPromise<number>
    const p2 = $q.resolve('two'); // QPromise<string>
    const result = $q.all([p1, p2] as const);

    // `AwaitedQ` peels each `QPromise<…>` layer explicitly (TS's built-in
    // `Awaited` would collapse a non-native `QPromise` to `unknown`), so each
    // slot reflects its REAL resolved value type. Both tuple arity AND the
    // per-slot value types survive.
    result.then((values) => {
      expectTypeOf(values).toEqualTypeOf<[number, string]>();
    });
  });

  it('a mixed array of promises and plain values unwraps element-wise', () => {
    const result = $q.all([$q.resolve(1), 3] as const);
    result.then((values) => {
      // Slot 0 is a `QPromise<number>` (unwrapped to `number`); slot 1 is a
      // plain `3` (literal, via `as const`) passed through by native `Awaited`.
      expectTypeOf(values).toEqualTypeOf<[number, 3]>();
    });
  });

  it('keyed object preserves per-key value types', () => {
    const result = $q.all({ a: $q.resolve('x'), b: 2 });
    result.then((values) => {
      // The keyed shape round-trips AND each value reflects its real type:
      // `a` unwraps the `QPromise<string>`, `b` passes through as `number`.
      expectTypeOf(values).toEqualTypeOf<{ a: string; b: number }>();
    });
  });
});

describe('$q.allSettled — per-item discriminated union (FS §2.4 / §3)', () => {
  const $q = injector.get('$q');

  it('delivers an array of QSettledResult<T>', () => {
    const result = $q.allSettled<number>([$q.resolve(1), $q.reject('boom')]);
    expectTypeOf(result).toEqualTypeOf<QPromise<Array<QSettledResult<number>>>>();
  });

  it('narrows each report on the `status` discriminant', () => {
    const $q2 = injector.get('$q');
    $q2.allSettled<number>([$q2.resolve(1)]).then((reports) => {
      const report = reports[0];
      expectTypeOf(report).toEqualTypeOf<QSettledResult<number> | undefined>();
      if (report?.status === 'fulfilled') {
        // The `'fulfilled'` arm carries `value: number`, no `reason`.
        expectTypeOf(report.value).toEqualTypeOf<number>();
        expectTypeOf(report).not.toHaveProperty('reason');
      } else if (report?.status === 'rejected') {
        // The `'rejected'` arm carries `reason: unknown`, no `value`.
        expectTypeOf(report.reason).toEqualTypeOf<unknown>();
        expectTypeOf(report).not.toHaveProperty('value');
      }
    });
  });
});

describe('$q.resolve / $q.reject / defer — value type round-trips', () => {
  const $q = injector.get('$q');

  it('$q.resolve(x) carries the value type', () => {
    expectTypeOf($q.resolve(7)).toEqualTypeOf<QPromise<number>>();
    $q.resolve('hi').then((value) => {
      expectTypeOf(value).toEqualTypeOf<string>();
    });
  });

  it('$q.reject(r) defaults to QPromise<never> (no success value)', () => {
    // `reject<T = never>` — a bare reject produces a never-succeeding promise.
    expectTypeOf($q.reject('bad')).toEqualTypeOf<QPromise<never>>();
  });

  it('defer<T>() yields a QDeferred<T> with a QPromise<T>', () => {
    const deferred = $q.defer<number>();
    expectTypeOf(deferred.promise).toEqualTypeOf<QPromise<number>>();
    // The `resolve` parameter accepts the value OR an adoptable thenable of it.
    expectTypeOf<Parameters<typeof deferred.resolve>[0]>().toEqualTypeOf<
      number | QPromise<number> | PromiseLike<number>
    >();
  });
});

describe('.catch / .finally preserve the value type', () => {
  const $q = injector.get('$q');

  it('.finally returns a QPromise of the SAME value type', () => {
    const promise = $q.resolve(10).finally(() => undefined);
    expectTypeOf(promise).toEqualTypeOf<QPromise<number>>();
  });

  it('.catch widens the value type with the recovery type', () => {
    // `catch<TResult = never>` returns `QPromise<T | TResult>` — a no-arg-typed
    // recovery defaults `TResult` to `never`, so the value type stays `number`.
    const recovered = $q.resolve(10).catch(() => 0);
    expectTypeOf(recovered).toEqualTypeOf<QPromise<number>>();

    // A recovery returning a different type widens the union.
    const widened = $q.resolve(10).catch(() => 'fallback');
    expectTypeOf(widened).toEqualTypeOf<QPromise<number | string>>();
  });
});
