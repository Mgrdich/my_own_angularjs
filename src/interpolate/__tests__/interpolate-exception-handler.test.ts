/**
 * Slice 6 (spec 014) — `$interpolate` render-time catch routes per-expression
 * throws through the captured `ExceptionHandler` with cause `'$interpolate'`,
 * substitutes `undefined` for the failing slot, and preserves the
 * `allOrNothing` / `oneTime` short-circuit semantics for thrown values.
 *
 * Compile-time errors (parse failures, spec-012 strict-trust single-binding
 * failures) are NOT routed — they continue to throw synchronously at the
 * `$interpolate(text)` call site so authoring mistakes stay loud.
 *
 * The parser's member-access path is permissive — `x.y.z` against an
 * undefined `x` returns `undefined` rather than throwing. To force a
 * render-time throw we expose a thrower function on the context and
 * invoke it from inside the interpolation expression; the call-expression
 * path does throw on a thrown method.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Scope } from '@core/scope';
import { type ExceptionHandler } from '@exception-handler/index';
import { createInterpolate } from '@interpolate/index';

describe('createInterpolate — render-time error handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a thrown expression through the handler and renders the failed slot as ""', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({ exceptionHandler: spy });

    const fn = interpolate('a {{boom()}} b');
    const result = fn({
      boom: () => {
        throw new Error('expression-broke');
      },
    });

    expect(result).toBe('a  b');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Error), '$interpolate');
  });

  it('renders only the failing slot as empty in a multi-expression template', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({ exceptionHandler: spy });

    const fn = interpolate('{{a}} and {{boom()}}');
    const result = fn({
      a: 'X',
      boom: () => {
        throw new Error('only-second-broke');
      },
    });

    expect(result).toBe('X and ');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Error), '$interpolate');
  });

  it('invokes the handler once per failing slot when multiple expressions throw', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({ exceptionHandler: spy });

    const fn = interpolate('{{boom()}} and {{boom()}}');
    const result = fn({
      boom: () => {
        throw new Error('both-broke');
      },
    });

    expect(result).toBe(' and ');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('createInterpolate — allOrNothing semantics with thrown expressions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when allOrNothing is true and any expression throws', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({ exceptionHandler: spy });

    const fn = interpolate('a {{boom()}} b', false, undefined, true);
    const result = fn({
      boom: () => {
        throw new Error('aon-broke');
      },
    });

    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Error), '$interpolate');
  });

  it('returns the rendered string when allOrNothing is true and every expression resolves cleanly', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({ exceptionHandler: spy });

    const fn = interpolate('a {{x}} b', false, undefined, true);
    const result = fn({ x: 'Y' });

    expect(result).toBe('a Y b');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('createInterpolate — oneTime semantics with thrown expressions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined for the render pass when a `::` expression throws', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({ exceptionHandler: spy });

    const fn = interpolate('Hello {{::boom()}}');
    expect(fn.oneTime).toBe(true);

    const result = fn({
      boom: () => {
        throw new Error('one-time-broke');
      },
    });

    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.any(Error), '$interpolate');
  });

  it('does NOT deregister the $watch on a throw — deregistration still requires non-undefined resolution', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({ exceptionHandler: spy });

    type ThrowerScope = Record<string, unknown> & {
      shouldThrow: boolean;
      get: () => string | undefined;
    };
    const scope = Scope.create<ThrowerScope>();
    scope.shouldThrow = true;
    scope.get = () => {
      if (scope.shouldThrow) {
        throw new Error('not-yet');
      }
      return 'Alice';
    };

    const fn = interpolate('Hello {{::get()}}');
    const listener = vi.fn();
    scope.$watch(fn, listener);

    // First digest: `get()` throws; the render returns `undefined`. The
    // digest's stabilization loop may invoke the watch fn more than once
    // per digest (sentinel -> undefined transition + stabilization check),
    // so we only require that the handler fired at least once with the
    // correct cause. The critical post-condition is that the watcher MUST
    // stay registered — `undefined` is not a stable value, so spec-010's
    // `oneTimeWatchDelegate` does NOT deregister on it.
    scope.$digest();
    expect(spy).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.any(Error), '$interpolate');

    const stillRegistered = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(stillRegistered).toBe(1);

    // Stop the throw; second digest renders the stable string, the listener
    // fires, and the watcher deregisters per spec 010 — the listener firing
    // here is the proof that the throw on the first pass did NOT trigger
    // premature deregistration.
    scope.shouldThrow = false;
    scope.$digest();

    const stableCalls = listener.mock.calls.filter((call) => call[0] === 'Hello Alice');
    expect(stableCalls.length).toBeGreaterThan(0);
    const afterStabilization = (scope.$$watchers ?? []).filter((w) => w !== null).length;
    expect(afterStabilization).toBe(0);
  });
});

describe('createInterpolate — compile-time errors are NOT routed through the handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parse() failures throw synchronously at the $interpolate(text) call site', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({ exceptionHandler: spy });

    expect(() => interpolate('a {{b +}}')).toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('spec-012 strict-trust single-binding failures throw synchronously at the call site', () => {
    const spy = vi.fn<ExceptionHandler>();
    const interpolate = createInterpolate({
      exceptionHandler: spy,
      sceGetTrusted: (_ctx, value) => value,
      sceIsEnabled: () => true,
    });

    expect(() => interpolate('hello {{x}} world', false, 'html')).toThrow(
      /interpolations in trusted contexts must have exactly one/,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('createInterpolate — recursion guard on a throwing handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not crash the render when the handler itself throws — failed slot still renders as ""', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingHandler = vi.fn<ExceptionHandler>(() => {
      throw new Error('handler-broke');
    });
    const interpolate = createInterpolate({ exceptionHandler: throwingHandler });

    const fn = interpolate('a {{boom()}} b');
    const context = {
      boom: () => {
        throw new Error('expression-broke');
      },
    };

    expect(() => fn(context)).not.toThrow();

    const result = fn(context);
    expect(result).toBe('a  b');
    expect(throwingHandler).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[$exceptionHandler] handler threw while reporting:',
      expect.any(Error),
      'original exception was:',
      expect.any(Error),
    );
  });
});

describe('createInterpolate — default handler backwards compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes thrown expressions through console.error when no handler option is supplied', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const interpolate = createInterpolate();

    const fn = interpolate('a {{boom()}} b');
    const result = fn({
      boom: () => {
        throw new Error('default-handler-test');
      },
    });

    expect(result).toBe('a  b');
    expect(consoleSpy).toHaveBeenCalledWith('[$exceptionHandler]', expect.any(Error), '$interpolate');
  });
});
