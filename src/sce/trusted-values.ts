/**
 * Trusted-value class hierarchy for the `$sce` service.
 *
 * Each public context (`html`, `url`, `resourceUrl`, `js`, `css`) has a
 * corresponding nominal class. Identity of "trustedness" is established via
 * `instanceof TrustedValue`, matching AngularJS 1.x internals and letting
 * TypeScript narrow to a specific context class at the type level.
 *
 * Non-obvious rule: `TrustedResourceUrl extends TrustedUrl`. AngularJS parity
 * — a trusted resource URL is accepted anywhere a trusted URL is expected,
 * but a bare trusted URL does NOT satisfy a `resourceUrl` requirement. The
 * `isTrustedFor` guard honors this directional subtype rule.
 */

import { SCE_CONTEXTS, type SceContext } from '@sce/sce-contexts';

/**
 * Abstract base for every trusted-value wrapper.
 *
 * Stores the original string on `$$unwrapTrustedValue`. `toString()` returns
 * that raw string so accidental template concatenation (`` `${wrapper}` ``)
 * never leaks a `[object Object]` representation.
 */
export abstract class TrustedValue {
  public readonly $$unwrapTrustedValue: string;

  constructor(value: string) {
    this.$$unwrapTrustedValue = value;
  }

  public toString(): string {
    return this.$$unwrapTrustedValue;
  }
}

/** Trusted-HTML wrapper. Unwraps for `getTrusted('html', ...)`. */
export class TrustedHtml extends TrustedValue {}

/**
 * Trusted-URL wrapper. Unwraps for `getTrusted('url', ...)`.
 *
 * Superclass of `TrustedResourceUrl` — a resource URL is a URL, but not the
 * other way around.
 */
export class TrustedUrl extends TrustedValue {}

/**
 * Trusted resource-URL wrapper (e.g. a URL safe to use as an iframe `src`).
 *
 * Extends `TrustedUrl` to match AngularJS 1.x parity: accepted where a
 * `TrustedUrl` is expected, but a bare `TrustedUrl` does NOT satisfy a
 * `resourceUrl` check. `isTrustedFor` enforces this directional rule.
 */
export class TrustedResourceUrl extends TrustedUrl {}

/** Trusted-JS wrapper. Unwraps for `getTrusted('js', ...)`. */
export class TrustedJs extends TrustedValue {}

/** Trusted-CSS wrapper. Unwraps for `getTrusted('css', ...)`. */
export class TrustedCss extends TrustedValue {}

/**
 * Internal escape-hatch wrapper for the `$$ANY$$` pseudo-context.
 *
 * A `TrustedValueAny` unwraps successfully in every public context. Not
 * re-exported from the public barrel — consumers cannot construct one.
 * Used by the delegate (later slice) when a caller trusts a value via
 * the `$$ANY$$` context key.
 */
export class TrustedValueAny extends TrustedValue {}

/** Runtime guard: `true` iff `v` is an instance of `TrustedValue`. */
export function isTrustedValue(v: unknown): v is TrustedValue {
  return v instanceof TrustedValue;
}

/**
 * Runtime guard: `true` iff `v` is trusted for the given context.
 *
 * Honors two subtype rules:
 * - `TrustedResourceUrl` satisfies `'url'` AND `'resourceUrl'` (extends `TrustedUrl`).
 * - `TrustedValueAny` satisfies every public context (escape hatch).
 *
 * A bare `TrustedUrl` does NOT satisfy `'resourceUrl'` — the subtype rule is
 * directional, by design.
 */
export function isTrustedFor(ctx: SceContext, v: unknown): boolean {
  if (v instanceof TrustedValueAny) return true;

  switch (ctx) {
    case SCE_CONTEXTS.HTML:
      return v instanceof TrustedHtml;
    case SCE_CONTEXTS.URL:
      return v instanceof TrustedUrl;
    case SCE_CONTEXTS.RESOURCE_URL:
      return v instanceof TrustedResourceUrl;
    case SCE_CONTEXTS.JS:
      return v instanceof TrustedJs;
    case SCE_CONTEXTS.CSS:
      return v instanceof TrustedCss;
  }
}
