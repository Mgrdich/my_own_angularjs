/**
 * Unit tests for the four value exports in `src/exception-handler/exception-handler.ts`:
 * the default `consoleErrorExceptionHandler`, the silent `noopExceptionHandler`, the
 * `exceptionHandler` default-instance alias, and the recursion-guarded
 * `invokeExceptionHandler` dispatcher.
 *
 * Pure ESM — no DI, no scope. `console.error` is spied per test and restored in
 * `afterEach` so the runner stdout stays clean across the suite.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consoleErrorExceptionHandler,
  noopExceptionHandler,
  exceptionHandler,
  invokeExceptionHandler,
  type ExceptionHandler,
} from '@exception-handler/index';

describe('exception-handler value exports', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('consoleErrorExceptionHandler', () => {
    it('logs once with prefix and error and no trailing undefined when cause is omitted', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('boom');

      consoleErrorExceptionHandler(err);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', err);
      expect(consoleSpy.mock.calls[0]).toHaveLength(2);
    });

    it('logs once with prefix, error, and cause when cause is provided', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('boom');

      consoleErrorExceptionHandler(err, 'watchFn');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', err, 'watchFn');
      expect(consoleSpy.mock.calls[0]).toHaveLength(3);
    });

    it('accepts a string exception without throwing', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        consoleErrorExceptionHandler('a string');
      }).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', 'a string');
    });

    it('accepts a null exception without throwing', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        consoleErrorExceptionHandler(null);
      }).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', null);
    });

    it('accepts an undefined exception without throwing', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        consoleErrorExceptionHandler(undefined);
      }).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', undefined);
      expect(consoleSpy.mock.calls[0]).toHaveLength(2);
    });

    it('accepts a plain object exception with a cause without throwing', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const weird = { weird: 'object' };

      expect(() => {
        consoleErrorExceptionHandler(weird, 'cause');
      }).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', weird, 'cause');
    });
  });

  describe('noopExceptionHandler', () => {
    it('returns undefined and does not call console.error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Return type is `void`; invoking as a statement satisfies the
      // "returns undefined" contract without tripping no-confusing-void-expression.
      noopExceptionHandler(new Error('x'), 'cause');

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('exceptionHandler default instance', () => {
    it('is a strict reference to consoleErrorExceptionHandler', () => {
      expect(exceptionHandler).toBe(consoleErrorExceptionHandler);
    });
  });

  describe('invokeExceptionHandler', () => {
    it('invokes a normal handler exactly once with (exception, cause) and returns undefined', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler: ExceptionHandler = vi.fn();
      const err = new Error('boom');

      // Return type is `void`; invoking as a statement satisfies the
      // "returns undefined" contract without tripping no-confusing-void-expression.
      invokeExceptionHandler(handler, err, 'cause');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(err, 'cause');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('returns undefined and produces no console.error calls when delegating to noopExceptionHandler', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('boom');

      // Return type is `void`; invoking as a statement satisfies the
      // "returns undefined" contract without tripping no-confusing-void-expression.
      invokeExceptionHandler(noopExceptionHandler, err, 'cause');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('does not throw and does not recurse when the handler itself throws', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const secondaryMessage = 'handler-broke';
      const throwingHandler: ExceptionHandler = vi.fn(() => {
        throw new Error(secondaryMessage);
      });
      const originalErr = new Error('original');

      expect(() => {
        invokeExceptionHandler(throwingHandler, originalErr, 'cause');
      }).not.toThrow();

      expect(throwingHandler).toHaveBeenCalledTimes(1);
      expect(throwingHandler).toHaveBeenCalledWith(originalErr, 'cause');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[$exceptionHandler] handler threw while reporting:',
        expect.objectContaining({ message: secondaryMessage }),
        'original exception was:',
        originalErr,
      );
    });
  });
});
