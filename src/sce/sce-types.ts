/**
 * Public types for the `$sce` module.
 *
 * Slice 3 filled in `SceDelegateOptions` and `SceDelegateService`. Slice 4
 * replaces the placeholder `SceOptions` / `SceService` with their concrete
 * shapes and introduces `SceParsedFn` — the return type of the façade's
 * `parseAs*` family, carrying the same metadata flags (`literal`, `constant`,
 * `oneTime`) that the expression parser attaches to its `ExpressionFn`.
 */

import type { SceContext } from '@sce/sce-contexts';

export type { SceContext } from '@sce/sce-contexts';

/**
 * An entry in a resource-URL allow-list or block-list.
 *
 * - The literal string `'self'` matches same-origin URLs relative to
 *   `document.baseURI`.
 * - Any other `string` is a pattern supporting `**` (matches zero or more of
 *   any character including `/`) and `*` (matches zero or more characters
 *   excluding `/`, `:`, `?`, `#`). Matched against the full URL.
 * - A `RegExp` is tested against the full URL string.
 *
 * Note: TypeScript collapses `'self' | string` to just `string`, so `'self'`
 * is a documented-but-not-type-checked convention. Runtime validation in
 * slice 2's matcher catches invalid entries.
 */
export type ResourceUrlListEntry = string | RegExp;

/**
 * Options bag for `createSceDelegate`.
 *
 * Both lists default to AngularJS 1.x parity values — `['self']` for the
 * allow-list (same-origin resource URLs pass) and `[]` for the block-list
 * (nothing rejected by default).
 */
export interface SceDelegateOptions {
  /** Allow-list of trusted resource URLs. Defaults to `['self']`. */
  readonly trustedResourceUrlList?: readonly ResourceUrlListEntry[];
  /** Block-list of rejected resource URLs. Defaults to `[]`. Block wins over allow. */
  readonly bannedResourceUrlList?: readonly ResourceUrlListEntry[];
}

/**
 * The always-strict delegate service returned by `createSceDelegate`.
 *
 * `value` is typed as `unknown` because the inputs legitimately span
 * `string`, nullish, and `TrustedValue` wrappers — a union TS cannot express
 * without losing its narrowing benefits. Callers narrow at the call-site.
 */
export interface SceDelegateService {
  /**
   * Wrap a raw string (or re-wrap an already-trusted value) for the given
   * context. Returns `null`/`undefined` unchanged. Non-string non-wrapper
   * inputs throw.
   */
  trustAs(ctx: SceContext, value: unknown): unknown;
  /**
   * Unwrap a trusted value for the given context. Throws if the value is
   * not trusted for the context (with special-cased pass-through for the
   * `url` context on plain strings, and allow/block-list enforcement for
   * the `resourceUrl` context).
   */
  getTrusted(ctx: SceContext, value: unknown): unknown;
  /**
   * Strip the trust wrapper if present, otherwise return the value
   * unchanged. Never throws; never consults any list. Safe for nullish
   * and non-string inputs.
   */
  valueOf(value: unknown): unknown;
}

/**
 * Options bag for `createSce`.
 *
 * Both fields are optional — `delegate` defaults to a fresh
 * `createSceDelegate()` instance, `enabled` defaults to `true` (strict mode
 * ON, AngularJS 1.x parity). Pass `enabled: false` for a total pass-through
 * façade (trust wrappers are never created and `getTrusted` becomes an
 * unwrapping identity).
 */
export interface SceOptions {
  /** Lower-level delegate to route through. Defaults to `createSceDelegate()`. */
  readonly delegate?: SceDelegateService;
  /** Strict-mode flag. Defaults to `true`. When `false`, the façade is a pass-through. */
  readonly enabled?: boolean;
}

/**
 * Function returned by `$sce.parseAs*` — a bound (scope, locals?) evaluator
 * that runs the parsed expression and then sends the result through
 * `$sce.getTrusted(ctx, ...)`.
 *
 * The three metadata flags (`literal`, `constant`, `oneTime`) are forwarded
 * from the inner `ExpressionFn` so watchers built on top of `parseAs`
 * continue to select the correct watch delegate (see spec 010).
 */
export type SceParsedFn = {
  (scope: Record<string, unknown>, locals?: Record<string, unknown>): unknown;
  readonly literal?: boolean;
  readonly constant?: boolean;
  readonly oneTime?: boolean;
};

/**
 * The user-facing `$sce` façade returned by `createSce`.
 *
 * All methods are closed over the captured `delegate` and `enabled` flag —
 * safely destructurable (`const { trustAsHtml } = sce`) and never rely on
 * `this`. Pass-through semantics under `enabled: false` are documented
 * per-method in `src/sce/sce.ts`.
 */
export interface SceService {
  /** Returns the captured strict-mode flag. Read-only — no runtime setter. */
  isEnabled(): boolean;

  /** Generic trust-wrapper constructor. `ctx` is validated against the public context set. */
  trustAs(ctx: SceContext, value: unknown): unknown;
  /** Shortcut for `trustAs('html', value)`. */
  trustAsHtml(value: unknown): unknown;
  /** Shortcut for `trustAs('url', value)`. */
  trustAsUrl(value: unknown): unknown;
  /** Shortcut for `trustAs('resourceUrl', value)`. */
  trustAsResourceUrl(value: unknown): unknown;
  /** Shortcut for `trustAs('js', value)`. */
  trustAsJs(value: unknown): unknown;
  /** Shortcut for `trustAs('css', value)`. */
  trustAsCss(value: unknown): unknown;

  /** Generic trust-wrapper unwrapper. Strict-mode ON: enforces the context match. */
  getTrusted(ctx: SceContext, value: unknown): unknown;
  /** Shortcut for `getTrusted('html', value)`. */
  getTrustedHtml(value: unknown): unknown;
  /** Shortcut for `getTrusted('url', value)`. */
  getTrustedUrl(value: unknown): unknown;
  /** Shortcut for `getTrusted('resourceUrl', value)`. */
  getTrustedResourceUrl(value: unknown): unknown;
  /** Shortcut for `getTrusted('js', value)`. */
  getTrustedJs(value: unknown): unknown;
  /** Shortcut for `getTrusted('css', value)`. */
  getTrustedCss(value: unknown): unknown;

  /**
   * Parse `expression` and return a function that evaluates it against a
   * scope, then routes the result through `getTrusted(ctx, …)`. Parser
   * metadata (`literal`, `constant`, `oneTime`) is preserved on the returned
   * function.
   */
  parseAs(ctx: SceContext, expression: string): SceParsedFn;
  /** Shortcut for `parseAs('html', expression)`. */
  parseAsHtml(expression: string): SceParsedFn;
  /** Shortcut for `parseAs('url', expression)`. */
  parseAsUrl(expression: string): SceParsedFn;
  /** Shortcut for `parseAs('resourceUrl', expression)`. */
  parseAsResourceUrl(expression: string): SceParsedFn;
  /** Shortcut for `parseAs('js', expression)`. */
  parseAsJs(expression: string): SceParsedFn;
  /** Shortcut for `parseAs('css', expression)`. */
  parseAsCss(expression: string): SceParsedFn;

  /**
   * Strip the trust wrapper if present, otherwise return the value
   * unchanged. Pure delegation to the underlying delegate — NOT gated by
   * strict mode (unwrapping a wrapper is always safe).
   */
  valueOf(value: unknown): unknown;
}
