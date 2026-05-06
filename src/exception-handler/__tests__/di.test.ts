/**
 * DI integration tests for `$exceptionHandler` (spec 014, Slice 3).
 *
 * Verifies that the core `ng` module registers `$exceptionHandler` as the
 * default `consoleErrorExceptionHandler` reference, that lookups are
 * singletons, and that the three AngularJS-parity override paths
 * (`module.factory`, `config(['$provide', ...])`, and `module.decorator`) all
 * work as expected. Also locks in the "no provider class" contract: there is
 * no `$exceptionHandlerProvider` — the only override surface is
 * `$provide.factory` (or its module-level shorthands).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import type { ProvideService } from '@di/index';
import { createModule, resetRegistry } from '@di/module';
import { consoleErrorExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';

describe('$exceptionHandler — DI integration', () => {
  // The `ng` module is registered at import time; a `resetRegistry()` in a
  // neighbouring test would evict it. Re-register a fresh `'ng'` here so any
  // `requires: ['ng']` lookup downstream still resolves. Matches the pattern
  // used in `src/sce/__tests__/sce-di.test.ts`.
  let consoleErrorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    resetRegistry();
    createModule('ng', [])
      .factory('$exceptionHandler', [() => consoleErrorExceptionHandler])
      .provider('$sceDelegate', $SceDelegateProvider)
      .provider('$sce', $SceProvider)
      .provider('$interpolate', $InterpolateProvider);

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default registration', () => {
    it('exposes $exceptionHandler via createInjector([ngModule])', () => {
      const injector = createInjector([ngModule]);

      expect(injector.has('$exceptionHandler')).toBe(true);
      expect(typeof injector.get('$exceptionHandler')).toBe('function');
    });

    it('default identity is the consoleErrorExceptionHandler reference', () => {
      const injector = createInjector([ngModule]);

      expect(injector.get('$exceptionHandler')).toBe(consoleErrorExceptionHandler);
    });

    it('repeated injector.get calls return the same singleton', () => {
      const injector = createInjector([ngModule]);
      const a = injector.get('$exceptionHandler');
      const b = injector.get('$exceptionHandler');

      expect(a).toBe(b);
    });
  });

  describe('override paths', () => {
    it('module.factory(name, fn) registered before createInjector replaces the default', () => {
      const mySpy: ExceptionHandler = vi.fn();
      const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => mySpy]);

      const injector = createInjector([appModule]);
      const handler = injector.get('$exceptionHandler');

      expect(handler).toBe(mySpy);

      const err = new Error('x');
      handler(err, 'watchFn');
      expect(mySpy).toHaveBeenCalledTimes(1);
      expect(mySpy).toHaveBeenCalledWith(err, 'watchFn');
    });

    it("config(['$provide', $p => $p.factory(...)]) replaces the default", () => {
      const mySpy: ExceptionHandler = vi.fn();

      const appModule = createModule('app', ['ng']).config([
        '$provide',
        ($provide: ProvideService) => {
          $provide.factory('$exceptionHandler', [() => mySpy]);
        },
      ]);

      const injector = createInjector([appModule]);

      expect(injector.get('$exceptionHandler')).toBe(mySpy);
    });

    it('module.decorator wraps the default — both wrapper and console.error run', () => {
      const mySpy: ExceptionHandler = vi.fn();
      const appModule = createModule('app', ['ng']).decorator('$exceptionHandler', [
        '$delegate',
        ($delegate: ExceptionHandler): ExceptionHandler =>
          (exception: unknown, cause?: string) => {
            mySpy(exception, cause);
            $delegate(exception, cause);
          },
      ]);

      const injector = createInjector([appModule]);
      const handler = injector.get('$exceptionHandler');
      const err = new Error('boom');

      handler(err, 'watchFn');

      expect(mySpy).toHaveBeenCalledTimes(1);
      expect(mySpy).toHaveBeenCalledWith(err, 'watchFn');

      // The default `consoleErrorExceptionHandler` was invoked via $delegate,
      // so `console.error` must have run with the prefixed-tag triple.
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[$exceptionHandler]', err, 'watchFn');
    });
  });

  describe('no provider class', () => {
    it('injector.get(\'$exceptionHandlerProvider\') throws "Unknown provider"', () => {
      const injector = createInjector([ngModule]);

      expect(() => injector.get('$exceptionHandlerProvider' as never)).toThrow(/Unknown provider/);
    });

    it("injector.has('$exceptionHandlerProvider') is false", () => {
      const injector = createInjector([ngModule]);

      expect(injector.has('$exceptionHandlerProvider' as never)).toBe(false);
    });
  });
});
