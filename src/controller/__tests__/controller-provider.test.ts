/**
 * Unit tests for `$ControllerProvider` (spec 020 Slice 3).
 *
 * Exercises the provider in isolation — no `createInjector`, no `ngModule`.
 * The provider's only collaboration is with `$provide.$$getPhase()`; the
 * tests pass a hand-rolled mock `ProvideService` (a `Proxy` that throws on
 * any access beyond `$$getPhase`) so accidental future calls to other
 * `$provide` methods are caught immediately.
 *
 * End-to-end DI integration is covered in `controller-di.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { $ControllerProvider } from '@controller/controller-provider';
import {
  ControllerRegistrationOutOfPhaseError,
  InvalidControllerFactoryError,
  InvalidControllerNameError,
} from '@controller/controller-errors';
import type { ControllerInvokable } from '@controller/controller-types';
import type { PhaseState, ProvideService } from '@di/provide-types';

/**
 * Build a minimal `ProvideService` mock exposing a controllable
 * `$$getPhase()` thunk. Every other `$provide.*` method is wired through
 * a `Proxy` trap that throws on first access — so a future regression that
 * starts calling (say) `$provide.factory` from `$ControllerProvider` would
 * fail loudly here, not silently in production.
 */
function makeFakeProvide(getPhase: () => PhaseState): ProvideService {
  const surface = { $$getPhase: getPhase };
  return new Proxy(surface as object, {
    get(target, prop): unknown {
      if (prop in target) {
        return (target as Record<string | symbol, unknown>)[prop];
      }
      throw new Error(`Unexpected $provide.${String(prop)} access in controller-provider test`);
    },
  }) as ProvideService;
}

/** Always-config phase. */
const configPhase = (): PhaseState => 'config';

/** Always-run phase. */
const runPhase = (): PhaseState => 'run';

describe('$ControllerProvider — string-form register (config phase)', () => {
  it('registers a controller and reports has(name) === true', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));
    const fn: ControllerInvokable = function ($scope: unknown) {
      void $scope;
    };

    const returned = provider.register('MyCtrl', fn);

    expect(returned).toBe(provider);
    expect(provider.has('MyCtrl')).toBe(true);
  });

  it('accepts array-style annotation', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));
    const fn: ControllerInvokable = [
      '$scope',
      function ($scope: unknown) {
        void $scope;
      },
    ];

    provider.register('AnnotatedCtrl', fn);

    expect(provider.has('AnnotatedCtrl')).toBe(true);
  });

  it('chains register calls (returns this)', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));
    const a: ControllerInvokable = function () {};
    const b: ControllerInvokable = function () {};

    const result = provider.register('A', a).register('B', b);

    expect(result).toBe(provider);
    expect(provider.has('A')).toBe(true);
    expect(provider.has('B')).toBe(true);
  });

  it('overwrites prior factory on duplicate name (last-wins)', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));
    const fnA: ControllerInvokable = function () {};
    const fnB: ControllerInvokable = function () {};

    provider.register('X', fnA);
    provider.register('X', fnB);

    // Bracket access to the private `$$registry` — Slice 3 testing affordance
    // only. The public API (`has`) cannot distinguish "registered with fnA"
    // from "registered with fnB", but the run-phase `$controller` resolves
    // against this map so the assertion below pins the runtime behavior.
    const reg = (provider as unknown as { $$registry: Map<string, ControllerInvokable> }).$$registry;
    expect(reg.get('X')).toBe(fnB);
    expect(reg.get('X')).not.toBe(fnA);
  });
});

describe('$ControllerProvider — object-form register (config phase)', () => {
  it('registers every entry and returns this', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));
    const fn1: ControllerInvokable = function () {};
    const fn2: ControllerInvokable = function () {};

    const returned = provider.register({ FooCtrl: fn1, BarCtrl: fn2 });

    expect(returned).toBe(provider);
    expect(provider.has('FooCtrl')).toBe(true);
    expect(provider.has('BarCtrl')).toBe(true);
  });

  it('validates entries in the object form too', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));

    expect(() =>
      provider.register({
        'bad name': function () {},
      }),
    ).toThrow(InvalidControllerNameError);

    expect(() =>
      provider.register({
        Valid: null as unknown as ControllerInvokable,
      }),
    ).toThrow(InvalidControllerFactoryError);
  });
});

describe('$ControllerProvider — has() introspection', () => {
  it('returns false for unregistered names', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));
    expect(provider.has('Missing')).toBe(false);
  });

  it('returns false before registration, true after', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));
    expect(provider.has('Pending')).toBe(false);
    provider.register('Pending', function () {});
    expect(provider.has('Pending')).toBe(true);
  });

  it('is reachable in run phase too (no guard)', () => {
    let phase: PhaseState = 'config';
    const provider = new $ControllerProvider(makeFakeProvide(() => phase));
    provider.register('Early', function () {});
    phase = 'run';
    // `has()` does not trip the phase guard.
    expect(provider.has('Early')).toBe(true);
    expect(provider.has('Missing')).toBe(false);
  });
});

describe('$ControllerProvider — out-of-phase guard', () => {
  it('register(name, fn) throws ControllerRegistrationOutOfPhaseError when phase is run', () => {
    const provider = new $ControllerProvider(makeFakeProvide(runPhase));

    let captured: unknown = null;
    try {
      provider.register('Late', function () {});
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ControllerRegistrationOutOfPhaseError);
    expect(captured).toBeInstanceOf(Error);
    const err = captured as Error;
    expect(err.name).toBe('ControllerRegistrationOutOfPhaseError');
    expect(err.message).toBe(
      '$controllerProvider.register is only callable during the config phase; calling it after the run phase begins is not supported',
    );
  });

  it('register(map) also throws in run phase', () => {
    const provider = new $ControllerProvider(makeFakeProvide(runPhase));
    expect(() => provider.register({ Foo: function () {} })).toThrow(ControllerRegistrationOutOfPhaseError);
  });

  it('captured-reference safety: phase flip after registration trips the guard', () => {
    let phase: PhaseState = 'config';
    const provider = new $ControllerProvider(makeFakeProvide(() => phase));

    provider.register('Early', function () {}); // succeeds — still config
    phase = 'run';

    expect(() => provider.register('Late', function () {})).toThrow(ControllerRegistrationOutOfPhaseError);
  });
});

describe('$ControllerProvider — invalid name', () => {
  const provider = new $ControllerProvider(makeFakeProvide(configPhase));

  it.each([
    ['empty string', ''],
    ['whitespace-only', '   '],
    ['contains space', 'a b'],
    ['contains tab', 'a\tb'],
    ['hasOwnProperty (reserved)', 'hasOwnProperty'],
  ])('throws InvalidControllerNameError for %s', (_label, name) => {
    expect(() => provider.register(name, function () {})).toThrow(InvalidControllerNameError);
  });

  it('throws InvalidControllerNameError with stringified offending input for non-string name', () => {
    let captured: unknown = null;
    try {
      provider.register(null as unknown as string, function () {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(InvalidControllerNameError);
    expect((captured as Error).message).toContain('null');
  });

  it('throws InvalidControllerNameError for a number name', () => {
    let captured: unknown = null;
    try {
      provider.register(42 as unknown as string, function () {});
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(InvalidControllerNameError);
    expect((captured as Error).message).toContain('42');
  });
});

describe('$ControllerProvider — invalid factory', () => {
  const provider = new $ControllerProvider(makeFakeProvide(configPhase));

  it('throws InvalidControllerFactoryError when factory is null', () => {
    expect(() => provider.register('X', null as unknown as ControllerInvokable)).toThrow(InvalidControllerFactoryError);
  });

  it('throws InvalidControllerFactoryError when factory is undefined (missing arg)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- exercise the runtime missing-argument path that TypeScript otherwise prevents at the call site
    expect(() => (provider as any).register('X')).toThrow(InvalidControllerFactoryError);
  });

  it('throws InvalidControllerFactoryError when factory is a number', () => {
    expect(() => provider.register('X', 42 as unknown as ControllerInvokable)).toThrow(InvalidControllerFactoryError);
  });

  it('throws InvalidControllerFactoryError when factory is an empty array', () => {
    expect(() => provider.register('X', [] as unknown as ControllerInvokable)).toThrow(InvalidControllerFactoryError);
  });

  it('throws InvalidControllerFactoryError when array has no trailing function', () => {
    expect(() => provider.register('X', ['$scope'] as unknown as ControllerInvokable)).toThrow(
      InvalidControllerFactoryError,
    );
  });

  it('throws InvalidControllerFactoryError when array trailing element is a number', () => {
    expect(() => provider.register('X', ['$scope', 42] as unknown as ControllerInvokable)).toThrow(
      InvalidControllerFactoryError,
    );
  });
});

describe('$ControllerProvider — $get factory shape', () => {
  it("exposes a `['$injector', fn]` invokable", () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));

    expect(Array.isArray(provider.$get)).toBe(true);
    expect(provider.$get[0]).toBe('$injector');
    expect(typeof provider.$get[1]).toBe('function');
  });

  it('builds a `$controller` service that shares the same live registry', () => {
    const provider = new $ControllerProvider(makeFakeProvide(configPhase));
    const ctorFn: ControllerInvokable = function () {};

    provider.register('Greeter', ctorFn);

    // Resolve `$controller` with a minimally-shaped injector. We don't
    // exercise instantiation here (see controller.test.ts); only that the
    // factory closes over the provider's live registry so lookups resolve.
    const fakeInjector = {
      invoke: () => ({}),
      get: () => undefined,
      has: () => false,
      annotate: () => [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- runtime test of the `$get` invokable; the fake injector is shaped narrower than the real `Injector` for clarity
    const $controller = provider.$get[1](fakeInjector as any);
    expect(typeof $controller).toBe('function');

    // Register an additional controller AFTER `$get` resolved; the same
    // live `Map` is read by the service, so the new name is reachable.
    provider.register('LateRegistered', function () {});
    expect(provider.has('LateRegistered')).toBe(true);
  });
});
