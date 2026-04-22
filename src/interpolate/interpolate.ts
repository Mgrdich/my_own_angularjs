/**
 * `createInterpolate` factory — produces a configured interpolation service.
 *
 * The service scans templates into text + expression chunks (via the scanner),
 * compiles each raw expression through the existing parser, and returns a
 * render function that stringifies the results and concatenates them with the
 * surrounding literal text.
 *
 * Slice 3 added the `mustHaveExpression` short-circuit and `allOrNothing`
 * render semantics. Slice 4 adds the `oneTime` metadata + render hold-back:
 * a template whose every embedded expression is `::`-prefixed returns
 * `undefined` from render until all expressions resolve to non-`undefined`
 * values, matching AngularJS parity so the spec-010 `oneTimeWatchDelegate`
 * correctly detects stabilization. `trustedContext` remains a no-op parameter
 * until `$sce` lands.
 */

import { toInterpolationString } from '@core/utils';
import { parse, type ExpressionFn } from '@parser/index';

import { DEFAULT_END_SYMBOL, DEFAULT_START_SYMBOL, validateDelimiters } from './interpolate-delimiters';
import { scan } from './interpolate-scanner';
import type { InterpolateFn, InterpolateOptions, InterpolateService } from './interpolate-types';

export function createInterpolate(options: InterpolateOptions = {}): InterpolateService {
  const startSymbol = options.startSymbol ?? DEFAULT_START_SYMBOL;
  const endSymbol = options.endSymbol ?? DEFAULT_END_SYMBOL;

  validateDelimiters(startSymbol, endSymbol);

  // Wider internal implementation signature — the public overloads on
  // `InterpolateService` narrow the return for callers. The cast at the
  // assignment boundary reconciles the two views without an `any`.
  const service = ((
    text: string,
    mustHaveExpression?: boolean,
    trustedContext?: string,
    allOrNothing?: boolean,
  ): InterpolateFn | undefined => {
    // TODO(spec-$sce): wire trustedContext through $sce when that service
    // lands; for now it is accepted and ignored so the call-signature parity
    // with AngularJS 1.x is preserved.
    void trustedContext;

    const { textSegments, expressions } = scan(text, startSymbol, endSymbol);

    if (expressions.length === 0 && mustHaveExpression === true) {
      return undefined;
    }

    const parsedFns: ExpressionFn[] = expressions.map((raw) => parse(raw));

    // A template is one-time only when there is at least one embedded
    // expression AND every parsed expression is `::`-prefixed. An empty or
    // mixed template is not one-time.
    const oneTime = parsedFns.length > 0 && parsedFns.every((fn) => fn.oneTime);

    const render = (context: Record<string, unknown>): string | undefined => {
      let out = textSegments[0] ?? '';
      for (let i = 0; i < parsedFns.length; i++) {
        const fn = parsedFns[i];
        const segment = textSegments[i + 1] ?? '';
        const value = fn === undefined ? undefined : fn(context);
        // Both `allOrNothing` and `oneTime` hold-back trigger on `undefined`
        // only — `null` renders as `''`, matching AngularJS 1.x parity.
        // Either path short-circuits the whole render to `undefined`.
        if ((allOrNothing === true || oneTime) && value === undefined) {
          return undefined;
        }
        out += toInterpolationString(value) + segment;
      }
      return out;
    };

    Object.defineProperties(render, {
      exp: { value: text, writable: false, enumerable: true, configurable: false },
      expressions: { value: expressions, writable: false, enumerable: true, configurable: false },
      oneTime: { value: oneTime, writable: false, enumerable: true, configurable: false },
    });

    return render as InterpolateFn;
  }) as InterpolateService;

  Object.defineProperties(service, {
    startSymbol: {
      value: () => startSymbol,
      writable: false,
      enumerable: false,
      configurable: false,
    },
    endSymbol: {
      value: () => endSymbol,
      writable: false,
      enumerable: false,
      configurable: false,
    },
  });

  return service;
}
