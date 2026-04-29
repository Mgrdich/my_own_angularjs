/**
 * Public types for the `$interpolate` service.
 *
 * The service has two shapes:
 * - `InterpolateFn` — the callable returned by a successful `$interpolate(text)`
 *   call. It renders the template against a context at invocation time.
 * - `InterpolateService` — the callable produced by `createInterpolate()` that
 *   compiles templates and exposes delimiter accessors.
 *
 * `trustedContext`-based enforcement (the narrowed `SceContext` parameter on
 * the service overloads) is fully wired to `$sce` when the `sceGetTrusted` +
 * `sceIsEnabled` callbacks on {@link InterpolateOptions} are supplied. The DI
 * provider (`$InterpolateProvider.$get`) wires them through the `$sce`
 * service automatically; pure-ESM consumers who want the same enforcement
 * must supply them explicitly (see `createInterpolate` JSDoc for the
 * recommended wiring).
 *
 * Graceful-degradation rule: if either callback is missing at the call site,
 * `createInterpolate` accepts `trustedContext` but performs NO enforcement —
 * the two callbacks are treated as independent and absence is interpreted as
 * "no enforcement requested for this invocation" rather than a
 * misconfiguration error. This matches the spec-011 / spec-010 precedent of
 * silent graceful degradation and keeps consumers of the pure-ESM factory
 * with no SCE wiring fully compatible.
 */

import type { ExceptionHandler } from '@exception-handler/index';
import type { SceContext } from '@sce/sce-types';

/**
 * Options accepted by `createInterpolate`. Omitted fields default to `{{` /
 * `}}` for the delimiters; omitted SCE callbacks default to "no enforcement".
 *
 * Supplying `sceIsEnabled` that returns `true` WITHOUT also supplying
 * `sceGetTrusted` is NOT treated as a misconfiguration error — the factory
 * silently skips enforcement because neither side of the trust contract can
 * be upheld without a resolver. Supply both or omit both.
 */
export interface InterpolateOptions {
  readonly startSymbol?: string;
  readonly endSymbol?: string;
  /**
   * Callback used to unwrap a trusted value at render time. Typically
   * `(ctx, v) => $sce.getTrusted(ctx, v)`. When omitted, interpolation
   * accepts the `trustedContext` argument but performs no trust lookup.
   */
  readonly sceGetTrusted?: (ctx: SceContext, value: unknown) => unknown;
  /**
   * Callback used to query the current strict-mode flag. Typically
   * `() => $sce.isEnabled()`. Returning `false` disables the compile-time
   * single-binding check and the render-time `getTrusted` call even if
   * `trustedContext` is supplied at invocation.
   */
  readonly sceIsEnabled?: () => boolean;
  /**
   * Optional exception handler captured at factory time and applied to every
   * render-time expression evaluation. When an embedded expression throws
   * during `fn(context)`, the error is routed through this handler with cause
   * `'$interpolate'` and the offending slot is treated as `undefined` (so
   * `allOrNothing` and `oneTime` short-circuits behave the same as if the
   * expression had returned `undefined`).
   *
   * Defaults to `consoleErrorExceptionHandler` when omitted, which logs via
   * `console.error` and continues — preserving spec-011's "errors don't abort
   * rendering" baseline while routing them through the centralized handler
   * surface introduced in spec 014.
   *
   * Compile-time errors from `parse()` and the spec-012 strict-trust
   * single-binding check are NOT routed here — they continue to throw
   * synchronously at the `$interpolate(text)` call site because they
   * indicate programming errors, not runtime evaluation failures.
   */
  readonly exceptionHandler?: ExceptionHandler;
}

/**
 * A compiled interpolation function.
 *
 * Calling it with a context object evaluates every embedded expression against
 * that context and returns the concatenated rendered string. Metadata
 * properties expose the original source, the raw expression strings in
 * left-to-right order, and the one-time flag used by `$watch` to deregister
 * after stabilization.
 *
 * One-time hold-back: returns `undefined` when `.oneTime === true` and at
 * least one embedded expression is still `undefined`. Once every expression
 * is defined, returns the rendered string. This matches AngularJS parity
 * (`angular.js:src/ng/interpolate.js`) and enables
 * `scope.$watch(interpolationFn, listener)` to detect stabilization via the
 * standard spec-010 `oneTimeWatchDelegate`.
 *
 * `null` does NOT trigger the hold-back — it stringifies to `''` just like
 * `null` values render under the default (non-oneTime) path.
 */
export type InterpolateFn = ((context: Record<string, unknown>) => string | undefined) & {
  readonly exp: string;
  readonly expressions: string[];
  readonly oneTime: boolean;
};

/**
 * A configured interpolation service. Callable with a template string and
 * optional flags; exposes `startSymbol()` / `endSymbol()` getters that return
 * the active delimiters.
 *
 * The call signature is overloaded on `mustHaveExpression`:
 * - When `true`, the service returns `InterpolateFn | undefined` — templates
 *   containing no expressions yield `undefined` so callers can skip binding.
 * - When `false` or omitted (the default), the service always returns an
 *   `InterpolateFn` — callers don't have to handle an `undefined` branch.
 *
 * `trustedContext` is narrowed to the published `SceContext` union (plus
 * `undefined`); arbitrary strings are a type error at the call site and
 * also a runtime error inside the service.
 */
export type InterpolateService = {
  (
    text: string,
    mustHaveExpression: true,
    trustedContext?: SceContext,
    allOrNothing?: boolean,
  ): InterpolateFn | undefined;
  (text: string, mustHaveExpression?: false, trustedContext?: SceContext, allOrNothing?: boolean): InterpolateFn;
} & {
  startSymbol(): string;
  endSymbol(): string;
};
