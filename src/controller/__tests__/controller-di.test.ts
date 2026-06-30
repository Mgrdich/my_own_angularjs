/**
 * End-to-end DI integration tests for `$controller` / `$controllerProvider`
 * (spec 020 Slice 3).
 *
 * Where `controller-provider.test.ts` exercises the provider class in
 * isolation against a hand-rolled fake `$provide`, this suite drives the
 * full DI machinery via `createInjector([ngModule, customModule])`. It
 * covers the reachability bullets from technical-considerations §2.8, the
 * captured-reference safety rule (FS §2.8 precedent — same shape as the
 * `$provide` regression in `src/di/__tests__/provide.test.ts:583-636`),
 * and the direct-call exception asymmetry from FS §2.5.
 *
 * **Direct-call vs. compile-time asymmetry.** Calling `$controller(...)`
 * directly (this suite) does NOT route exceptions through
 * `$exceptionHandler` — `UnknownControllerError` surfaces synchronously
 * to the caller. The compile-time path (Slice 4) routes through
 * `$exceptionHandler('$compile')` instead. Both behaviors are intentional
 * and mirror AngularJS 1.x. Slice 4's `controller-compile.test.ts` covers
 * the compile-time side.
 *
 * The `EXCEPTION_HANDLER_CAUSES.length === 10` assertion at the bottom is
 * a regression lock — Slice 3 introduces no new cause token.
 */

import { describe, expect, it, vi } from 'vitest';

import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';

import { $ControllerProvider } from '@controller/controller-provider';
import { ControllerRegistrationOutOfPhaseError, UnknownControllerError } from '@controller/controller-errors';

import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import type { ProvideService } from '@di/provide-types';

import { EXCEPTION_HANDLER_CAUSES, type ExceptionHandler } from '@exception-handler/index';

describe('$controller — DI reachability (FS §2.8)', () => {
  it('injector.has("$controller") is true after createInjector', () => {
    const appModule = createModule('app', ['ng']);
    const injector = createInjector([ngModule, appModule]);

    expect(injector.has('$controller')).toBe(true);
  });

  it('injector.has("$controllerProvider") is false at run time', () => {
    // Provider-injector intentionally NOT exposed post-config. `$provide`
    // is wiped from `providerCache` at `src/di/injector.ts:702`, and the
    // run-phase `has()` only consults `providerCache` / factory-invokable
    // / service-ctor / provider-$get maps — provider instances (kept in
    // `providerInstances`) are not visible from the run-phase facade.
    //
    // Provider reachability INSIDE `config()` blocks is verified via the
    // round-trip test below: the captured `$controllerProvider` reference
    // resolved cleanly during config and `register(...)` succeeded.
    const appModule = createModule('app', ['ng']);
    const injector = createInjector([ngModule, appModule]);

    expect(injector.has('$controllerProvider')).toBe(false);
  });

  it('injector.get("$controller") returns a function', () => {
    const appModule = createModule('app', ['ng']);
    const injector = createInjector([ngModule, appModule]);

    expect(typeof injector.get('$controller')).toBe('function');
  });
});

describe('$controller — config()-phase registration round-trip', () => {
  it('config-registered controller is instantiable via $controller and writes to $scope', () => {
    const appModule = createModule('app', ['ng']).config([
      '$controllerProvider',
      ($cp: $ControllerProvider) => {
        $cp.register('Greeter', [
          '$scope',
          ($scope: unknown) => {
            ($scope as Record<string, unknown>).greeting = 'hi';
          },
        ]);
      },
    ]);

    const injector = createInjector([ngModule, appModule]);
    const $controller = injector.get('$controller');
    const $scope = Scope.create();

    $controller('Greeter', { $scope });

    expect(($scope as unknown as Record<string, unknown>).greeting).toBe('hi');
  });

  it('multiple config blocks accumulate registrations on the same provider', () => {
    const appModule = createModule('app', ['ng'])
      .config([
        '$controllerProvider',
        ($cp: $ControllerProvider) => {
          $cp.register('A', [
            '$scope',
            ($scope: unknown) => {
              ($scope as Record<string, unknown>).a = true;
            },
          ]);
        },
      ])
      .config([
        '$controllerProvider',
        ($cp: $ControllerProvider) => {
          $cp.register('B', [
            '$scope',
            ($scope: unknown) => {
              ($scope as Record<string, unknown>).b = true;
            },
          ]);
        },
      ]);

    const injector = createInjector([ngModule, appModule]);
    const $controller = injector.get('$controller');
    const $scope = Scope.create();

    $controller('A', { $scope });
    $controller('B', { $scope });

    const bag = $scope as unknown as Record<string, unknown>;
    expect(bag.a).toBe(true);
    expect(bag.b).toBe(true);
  });
});

describe('$controller — captured-reference safety (FS §2.8 precedent)', () => {
  it('$controllerProvider captured in config and called after run starts throws ControllerRegistrationOutOfPhaseError', () => {
    // Same regression shape as the `$provide` captured-reference test in
    // `src/di/__tests__/provide.test.ts:583-636`. The provider reads
    // `$$getPhase()` on every `register` invocation rather than snapshotting
    // it at construction time, so a reference smuggled out of a `config()`
    // block trips the guard when called from outside.
    let saved: $ControllerProvider | undefined;
    const appModule = createModule('app', ['ng']).config([
      '$controllerProvider',
      ($cp: $ControllerProvider) => {
        saved = $cp;
      },
    ]);

    createInjector([ngModule, appModule]);
    expect(saved).toBeDefined();

    const provider = saved as $ControllerProvider;
    let captured: unknown = null;
    try {
      provider.register('Late', function () {});
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ControllerRegistrationOutOfPhaseError);
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe(
      '$controllerProvider.register is only callable during the config phase; calling it after the run phase begins is not supported',
    );
  });
});

describe('$controller — direct-call exception asymmetry (FS §2.5 acceptance #5)', () => {
  it('UnknownControllerError propagates to the caller and is NOT routed through $exceptionHandler', () => {
    // FS §2.5 acceptance #5: direct callers own their try/catch — the
    // service surfaces the error synchronously. The compile-time path
    // (Slice 4) routes via `$exceptionHandler('$compile')` instead; this
    // asymmetry is deliberate and matches AngularJS 1.x.
    const spyHandler = vi.fn<ExceptionHandler>();
    const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => spyHandler]);

    const injector = createInjector([ngModule, appModule]);
    const $controller = injector.get('$controller');

    let captured: unknown = null;
    try {
      $controller('NotRegistered', {});
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(UnknownControllerError);
    expect((captured as Error).message).toBe('Unknown controller: NotRegistered');
    expect(spyHandler).not.toHaveBeenCalled();
  });
});

describe('$controller — decorator on the $controller service (sanity)', () => {
  it('identity decorator preserves registration semantics', () => {
    // Sanity-check the AngularJS-canonical decorator hook on the
    // run-phase `$controller` service. The identity decorator returns
    // `$delegate` unchanged, so registrations made via the provider
    // must still resolve through the (decorated) `$controller(...)`
    // service. Catches a regression where the decorator chain replaced
    // the service with a wrapper that broke `$$registry` access.
    //
    // We decorate the SERVICE (`$controller`), not the PROVIDER
    // (`$controllerProvider`). AngularJS providers live in a
    // config-only `providerInstances` map and are NOT addressable by
    // `$provide.decorator(...)` — the decorator-validation pass at
    // `src/di/injector.ts:684-693` only consults the four producer
    // maps (`providerCache`, `factoryInvokables`, `serviceCtors`,
    // `providerGetInvokables`). The service-side decorator is the
    // documented seam for wrapping `$controller`.
    const appModule = createModule('app', ['ng'])
      .config([
        '$controllerProvider',
        ($cp: $ControllerProvider) => {
          $cp.register('Foo', [
            '$scope',
            ($scope: unknown) => {
              ($scope as Record<string, unknown>).foo = 1;
            },
          ]);
        },
      ])
      .config([
        '$provide',
        ($provide: ProvideService) => {
          $provide.decorator('$controller', ['$delegate', ($delegate: unknown) => $delegate]);
        },
      ]);

    const injector = createInjector([ngModule, appModule]);
    const $controller = injector.get('$controller');
    const $scope = Scope.create();

    $controller('Foo', { $scope });
    expect(($scope as Record<string, unknown>).foo).toBe(1);
  });
});

describe('EXCEPTION_HANDLER_CAUSES regression (no new cause token in Slice 3)', () => {
  it('EXCEPTION_HANDLER_CAUSES.length === 13 (no controller-spec token; grew to 13 in spec 037)', () => {
    // Spec 020 reuses the existing `'$compile'` cause token (added in
    // spec 017) for every controller-related error site at link time.
    // The tuple stays at 10 entries across Slices 1-5; lock that in
    // here so a future drive-by addition surfaces an obvious failure.
    expect(EXCEPTION_HANDLER_CAUSES.length).toBe(13);
  });
});
