/**
 * `createInterpolate` factory — produces a configured interpolation service.
 *
 * The service scans templates into text + expression chunks (via the scanner),
 * compiles each raw expression through the existing parser, and returns a
 * render function that stringifies the results and concatenates them with the
 * surrounding literal text.
 *
 * Slice 3 added the `mustHaveExpression` short-circuit and `allOrNothing`
 * render semantics. Slice 4 added the `oneTime` metadata + render hold-back:
 * a template whose every embedded expression is `::`-prefixed returns
 * `undefined` from render until all expressions resolve to non-`undefined`
 * values, matching AngularJS parity so the spec-010 `oneTimeWatchDelegate`
 * correctly detects stabilization. Slice 6 (spec 012) activates
 * `trustedContext`: when both `sceGetTrusted` and `sceIsEnabled` callbacks are
 * supplied AND `sceIsEnabled()` returns `true`, the template is required to
 * consist of exactly one `{{expression}}` with no surrounding literal text,
 * and the rendered value is routed through `sceGetTrusted` before
 * stringification. Pure-ESM consumers who omit the callbacks still accept
 * the `trustedContext` argument but get no enforcement (graceful-degradation
 * path — matches the spec-011 behavior for existing callers).
 */

import { toInterpolationString } from '@core/utils';
import { consoleErrorExceptionHandler, invokeExceptionHandler } from '@exception-handler/index';
import { parse, type ExpressionFn } from '@parser/index';
import { isValidSceContext, type SceContext } from '@sce/sce-contexts';

import { DEFAULT_END_SYMBOL, DEFAULT_START_SYMBOL, validateDelimiters } from './interpolate-delimiters';
import { scan } from './interpolate-scanner';
import type { InterpolateFn, InterpolateOptions, InterpolateService } from './interpolate-types';

export function createInterpolate(options: InterpolateOptions = {}): InterpolateService {
  const startSymbol = options.startSymbol ?? DEFAULT_START_SYMBOL;
  const endSymbol = options.endSymbol ?? DEFAULT_END_SYMBOL;
  const sceGetTrusted = options.sceGetTrusted;
  const sceIsEnabled = options.sceIsEnabled;
  const handler = options.exceptionHandler ?? consoleErrorExceptionHandler;

  validateDelimiters(startSymbol, endSymbol);

  // Wider internal implementation signature — the public overloads on
  // `InterpolateService` narrow the return for callers. The cast at the
  // assignment boundary reconciles the two views without an `any`.
  const service = ((
    text: string,
    mustHaveExpression?: boolean,
    trustedContext?: SceContext,
    allOrNothing?: boolean,
  ): InterpolateFn | undefined => {
    // Validate the trusted context string up front — a bogus value should
    // fail the compile call loudly, never reach render.
    if (trustedContext !== undefined && !isValidSceContext(trustedContext)) {
      throw new Error(`$interpolate: unknown trustedContext '${String(trustedContext)}'`);
    }

    const { textSegments, expressions } = scan(text, startSymbol, endSymbol);

    // Strict-trust enforcement is active only when the caller asked for a
    // trusted context AND both SCE callbacks are wired AND the wired $sce
    // service reports strict mode ON. Any missing piece → graceful no-op
    // (spec-011 behavior preserved).
    const strictTrustActive = trustedContext !== undefined && sceIsEnabled?.() === true && sceGetTrusted !== undefined;

    // Compile-time single-binding check. A literal-only template (no
    // embedded expressions) is always allowed because there is nothing to
    // sanitize; otherwise we require exactly one expression and empty
    // surrounding text.
    if (strictTrustActive && expressions.length > 0) {
      const hasSurroundingText = textSegments.some((s) => s !== '');
      if (expressions.length !== 1 || hasSurroundingText) {
        throw new Error(
          `$interpolate: interpolations in trusted contexts must have exactly one {{expression}} and no surrounding text (context='${trustedContext}'): ${text}`,
        );
      }
    }

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
        // Throws from per-expression evaluation are routed through the
        // captured handler and treated as `undefined` so `allOrNothing` /
        // `oneTime` short-circuits behave the same as a returned `undefined`.
        let value: unknown;
        try {
          value = fn === undefined ? undefined : fn(context);
        } catch (err) {
          invokeExceptionHandler(handler, err, '$interpolate');
          value = undefined;
        }
        // When strict trust is active the compile-time check guarantees
        // exactly one expression; `strictTrustActive === true` implies
        // `trustedContext` and `sceGetTrusted` are both defined (see the
        // predicate above), so the non-null assertions are correct and
        // needed to narrow past TS's flow analysis. `$sce.getTrusted`
        // passes `null` / `undefined` through unchanged per spec 012
        // slice 3, so the `allOrNothing` / `oneTime` undefined hold-back
        // decision is correctly made against the unwrapped value.
        const trusted = strictTrustActive ? sceGetTrusted(trustedContext, value) : value;
        // Both `allOrNothing` and `oneTime` hold-back trigger on `undefined`
        // only — `null` renders as `''`, matching AngularJS 1.x parity.
        // Either path short-circuits the whole render to `undefined`.
        if ((allOrNothing === true || oneTime) && trusted === undefined) {
          return undefined;
        }
        out += toInterpolationString(trusted) + segment;
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
