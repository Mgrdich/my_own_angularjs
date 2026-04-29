/**
 * End-to-end DI integration for `$exceptionHandler` (spec 014, Slice 7).
 *
 * Verifies that a custom `$exceptionHandler` registered on the application
 * module is consulted by both the digest's framework-internal call sites and
 * the `$interpolate` render-time path, and that the AngularJS-parity
 * decorator override wraps (rather than replaces) the default
 * `consoleErrorExceptionHandler` so both wrappers fire.
 */

import { describe, it, expect, vi } from 'vitest';

import { ngModule } from '@core/ng-module';
import { Scope } from '@core/scope';
import { createInjector, createModule } from '@di/index';
import { type ExceptionHandler } from '@exception-handler/index';

describe('$exceptionHandler — cross-service integration', () => {
  it('custom $exceptionHandler routes both digest and interpolation errors', () => {
    const mySpy = vi.fn<ExceptionHandler>();
    const appModule = createModule('app', ['ng']).factory('$exceptionHandler', [() => mySpy]);
    const injector = createInjector([ngModule, appModule]);

    expect(injector.get('$exceptionHandler')).toBe(mySpy);

    const interpolate = injector.get('$interpolate');
    const scope = Scope.create({ exceptionHandler: injector.get('$exceptionHandler') });

    scope.$watch(
      () => {
        throw new Error('watch-broke');
      },
      () => {},
    );
    scope.$digest();
    expect(mySpy).toHaveBeenCalledWith(expect.any(Error), 'watchFn');
    mySpy.mockClear();

    let value = 0;
    scope.$watch(
      () => value,
      () => {
        throw new Error('listener-broke');
      },
    );
    value = 1;
    scope.$digest();
    expect(mySpy).toHaveBeenCalledWith(expect.any(Error), 'watchListener');
    mySpy.mockClear();

    const fn = interpolate('a {{boom()}} b');
    const ctx: Record<string, unknown> = {
      boom: () => {
        throw new Error('interp-broke');
      },
    };
    const result = fn(ctx);
    expect(result).toBe('a  b');
    expect(mySpy).toHaveBeenCalledWith(expect.any(Error), '$interpolate');
  });

  it('decorator wraps default — both spy and console.error fire on digest and interpolation errors', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mySpy = vi.fn<ExceptionHandler>();

    const appModule = createModule('app', ['ng']).decorator('$exceptionHandler', [
      '$delegate',
      ($delegate: ExceptionHandler): ExceptionHandler =>
        (exception: unknown, cause?: string) => {
          mySpy(exception, cause);
          $delegate(exception, cause);
        },
    ]);
    const injector = createInjector([ngModule, appModule]);

    const interpolate = injector.get('$interpolate');
    const scope = Scope.create({ exceptionHandler: injector.get('$exceptionHandler') });

    scope.$watch(
      () => {
        throw new Error('digest-fail');
      },
      () => {},
    );
    scope.$digest();
    expect(mySpy).toHaveBeenCalledWith(expect.any(Error), 'watchFn');
    expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', expect.any(Error), 'watchFn');

    mySpy.mockClear();
    consoleSpy.mockClear();

    const fn = interpolate('{{boom()}}');
    fn({
      boom: () => {
        throw new Error('interp-fail');
      },
    });
    expect(mySpy).toHaveBeenCalledWith(expect.any(Error), '$interpolate');
    expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', expect.any(Error), '$interpolate');

    consoleSpy.mockRestore();
  });
});
