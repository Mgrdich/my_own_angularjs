/**
 * Concrete value implementations of `ExceptionHandler` plus the
 * recursion-guarded `invokeExceptionHandler` dispatcher used by every
 * framework-internal call site.
 *
 * See FS § 2.3 (dispatcher), § 2.4 (default console handler), § 2.6 (noop).
 */

import type { ExceptionHandler } from './exception-handler-types';

/**
 * Default `$exceptionHandler` implementation — logs to `console.error`.
 *
 * The output format is `[$exceptionHandler]` followed by the exception
 * and (if present) the cause descriptor. When `cause` is omitted, the
 * trailing argument is omitted too — no literal `undefined` appears in
 * the output. This preserves the historical `console.error('...', e)`
 * baseline that lived inline in `src/core/scope.ts` before spec 014, so
 * existing apps see no change in console output.
 *
 * @example
 * import { consoleErrorExceptionHandler } from 'my-own-angularjs/exception-handler';
 *
 * consoleErrorExceptionHandler(new Error('boom'), 'watchFn');
 * // console.error('[$exceptionHandler]', Error: boom, 'watchFn')
 *
 * consoleErrorExceptionHandler(new Error('boom'));
 * // console.error('[$exceptionHandler]', Error: boom)
 */
export const consoleErrorExceptionHandler: ExceptionHandler = (exception, cause) => {
  if (cause === undefined) {
    console.error('[$exceptionHandler]', exception);
  } else {
    console.error('[$exceptionHandler]', exception, cause);
  }
};

/**
 * No-op `$exceptionHandler` — silently swallows every error.
 *
 * **Test-only.** Use this to silence digest noise in unit tests that
 * deliberately trigger watch / listener exceptions to verify the
 * framework's "log and continue" contract. Do NOT use in production:
 * silencing all errors makes runtime bugs invisible and defeats the
 * reason the service exists.
 *
 * @example
 * import { Scope } from 'my-own-angularjs/core';
 * import { noopExceptionHandler } from 'my-own-angularjs/exception-handler';
 *
 * // Inside a test that intentionally throws from a watcher.
 * const scope = Scope.create({ exceptionHandler: noopExceptionHandler });
 * scope.$watch(() => { throw new Error('expected'); }, () => {});
 * scope.$digest(); // no console output
 */
export const noopExceptionHandler: ExceptionHandler = () => {};

/**
 * Default-instance alias for the framework's `$exceptionHandler`.
 *
 * Equivalent to {@link consoleErrorExceptionHandler}. Use this when you
 * need a value-level reference to the default implementation — for
 * example, to pass it through the ESM-only options bag of `Scope.create`
 * or `createInterpolate`, or to fall back to the default inside a
 * decorator that conditionally wraps it.
 *
 * @example
 * import { Scope } from 'my-own-angularjs/core';
 * import { createInterpolate } from 'my-own-angularjs/interpolate';
 * import { exceptionHandler } from 'my-own-angularjs/exception-handler';
 *
 * // ESM-only wiring (no injector) — explicitly pass the default.
 * const scope = Scope.create({ exceptionHandler });
 * const interpolate = createInterpolate({ exceptionHandler });
 */
export const exceptionHandler: ExceptionHandler = consoleErrorExceptionHandler;

/**
 * Recursion-guarded dispatcher for `$exceptionHandler`.
 *
 * Every framework-internal call site routes through this helper rather
 * than invoking the handler directly. The try/catch traps a secondary
 * throw from the configured handler, logs both the handler error and
 * the original exception to `console.error`, and returns normally —
 * the handler is NOT re-invoked recursively. This means a buggy custom
 * `$exceptionHandler` can never crash the digest, the event loop, or
 * the interpolation render pass.
 *
 * Third-party services that want the same recursion-safe dispatch
 * pattern can import this helper and use it directly — there is no
 * requirement that the call originate from the framework itself.
 *
 * @param handler The handler to invoke. Typically the configured
 *   `$exceptionHandler` instance, but any `ExceptionHandler` works.
 * @param exception The thrown value to report.
 * @param cause Optional cause descriptor — should be one of the eight
 *   tokens in `EXCEPTION_HANDLER_CAUSES` for framework-internal calls,
 *   or any string for third-party uses.
 *
 * @example
 * // Third-party service routing its own caught errors through the
 * // configured $exceptionHandler with the same recursion safety the
 * // framework uses internally.
 * import { invokeExceptionHandler } from 'my-own-angularjs/exception-handler';
 * import type { ExceptionHandler } from 'my-own-angularjs/exception-handler';
 *
 * class MyService {
 *   constructor(private readonly handler: ExceptionHandler) {}
 *
 *   run(work: () => void) {
 *     try {
 *       work();
 *     } catch (err) {
 *       invokeExceptionHandler(this.handler, err, 'myService');
 *     }
 *   }
 * }
 */
export function invokeExceptionHandler(handler: ExceptionHandler, exception: unknown, cause?: string): void {
  try {
    handler(exception, cause);
  } catch (secondary) {
    console.error(
      '[$exceptionHandler] handler threw while reporting:',
      secondary,
      'original exception was:',
      exception,
    );
    // Intentionally NOT re-invoking the handler — we'd risk infinite recursion.
  }
}
