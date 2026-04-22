/**
 * Public types for the `$interpolate` service.
 *
 * The service has two shapes:
 * - `InterpolateFn` — the callable returned by a successful `$interpolate(text)`
 *   call. It renders the template against a context at invocation time.
 * - `InterpolateService` — the callable produced by `createInterpolate()` that
 *   compiles templates and exposes delimiter accessors.
 */

/** Options accepted by `createInterpolate`. Omitted fields default to `{{` / `}}`. */
export interface InterpolateOptions {
  readonly startSymbol?: string;
  readonly endSymbol?: string;
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
 */
export type InterpolateService = {
  (text: string, mustHaveExpression: true, trustedContext?: string, allOrNothing?: boolean): InterpolateFn | undefined;
  (text: string, mustHaveExpression?: false, trustedContext?: string, allOrNothing?: boolean): InterpolateFn;
} & {
  startSymbol(): string;
  endSymbol(): string;
};
