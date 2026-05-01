/**
 * `createSce` — the user-facing façade over `$sceDelegate`.
 *
 * This is the primary public entry point for the `$sce` service. It holds
 * the strict-mode flag (`enabled`, default `true`) and wires per-context
 * shortcut methods (`trustAsHtml`, `getTrustedHtml`, `parseAsHtml`, …) on
 * top of the lower-level delegate returned by `createSceDelegate`.
 *
 * Strict-mode semantics:
 * - `enabled: true` — every `trustAs` / `getTrusted` / `parseAs` call is
 *   validated and delegated. The default.
 * - `enabled: false` — `trustAs*` returns its input unchanged (no wrapper
 *   is ever constructed). `getTrusted*` unwraps a wrapper if present and
 *   otherwise returns the input unchanged. `parseAs*` therefore becomes a
 *   trust-free evaluator. `valueOf` is NOT gated — it always unwraps a
 *   wrapper, because unwrapping is always safe.
 *
 * The internal `$$ANY$$` sentinel context is deliberately NOT reachable
 * through this façade. It is an escape hatch available only at the delegate
 * layer; the public façade's `trustAs` / `getTrusted` / `parseAs` reject
 * any context string outside the five published values.
 *
 * All returned methods are standalone closures over the captured delegate
 * and flag — the service is safely destructurable (`const { trustAsHtml } =
 * sce`) and does not rely on `this`.
 */

import { parse, type ExpressionFn } from '@parser/index';
import { SCE_CONTEXTS, isValidSceContext, type SceContext } from '@sce/sce-contexts';
import { createSceDelegate } from '@sce/sce-delegate';
import type { SceOptions, SceParsedFn, SceService } from '@sce/sce-types';

/**
 * Create a strict-contextual-escaping façade.
 *
 * @param options - Optional `delegate` to route through (defaults to a
 *   fresh `createSceDelegate()`), `enabled` flag (defaults to `true`), and
 *   `sanitize` fallback. When `sanitize` is supplied AND strict mode is on,
 *   `getTrusted('html', value)` routes plain-string inputs through the
 *   sanitizer instead of throwing — `TrustedHtml` wrappers continue to
 *   unwrap directly (the wrapper-unwrap path is preserved by the
 *   `typeof value === 'string'` guard).
 * @returns A `SceService` with `isEnabled`, generic `trustAs` /
 *   `getTrusted` / `parseAs`, the 15 per-context shortcuts, and `valueOf`.
 *
 * @example
 * ```ts
 * // Typical pattern: mark a user-supplied string as trusted HTML, then
 * // render it through $interpolate in a trusted context. The interpolation
 * // must be a single {{expr}} with no surrounding text (single-binding rule).
 * const bio = sce.trustAsHtml('<p>hello <b>world</b></p>');
 * const render = $interpolate('{{bio}}', false, 'html');
 * render({ bio }); // → '<p>hello <b>world</b></p>'
 *
 * // A plain string in the same slot is rejected at render time:
 * render({ bio: '<p>unsafe</p>' }); // throws — not trusted for 'html'
 *
 * // Wire a sanitizer fallback (e.g. from ngSanitize):
 * import { sanitize } from 'my-own-angularjs/sanitize';
 * const sceWithSanitize = createSce({ sanitize });
 * sceWithSanitize.getTrustedHtml('<script>x</script>y'); // → 'y' (sanitized)
 * ```
 */
export function createSce(options?: SceOptions): SceService {
  const delegate = options?.delegate ?? createSceDelegate();
  const enabled = options?.enabled ?? true;
  const sanitize = options?.sanitize;

  function isEnabled(): boolean {
    return enabled;
  }

  function trustAs(ctx: SceContext, value: unknown): unknown {
    if (!enabled) return value;
    if (!isValidSceContext(ctx)) {
      throw new Error(`$sce.trustAs: unknown context '${String(ctx)}'`);
    }
    return delegate.trustAs(ctx, value);
  }

  function getTrusted(ctx: SceContext, value: unknown): unknown {
    if (!enabled) return delegate.valueOf(value);
    if (!isValidSceContext(ctx)) {
      throw new Error(`$sce.getTrusted: unknown context '${String(ctx)}'`);
    }
    // Sanitize fallback: only for the html context, only for plain strings,
    // and only when a sanitizer was wired. The `typeof value === 'string'`
    // guard preserves the wrapper-unwrap path — a `TrustedHtml` is an object
    // and falls through to `delegate.getTrusted`. Nullish values are passed
    // through unchanged by the delegate's own leading short-circuit, so no
    // explicit guard is needed here.
    if (ctx === SCE_CONTEXTS.HTML && sanitize !== undefined && typeof value === 'string') {
      return sanitize(value);
    }
    return delegate.getTrusted(ctx, value);
  }

  function parseAs(ctx: SceContext, expression: string): SceParsedFn {
    // Validate ctx BEFORE parsing so a bogus context short-circuits
    // without paying the lex/parse cost.
    if (!isValidSceContext(ctx)) {
      throw new Error(`$sce.parseAs: unknown context '${String(ctx)}'`);
    }
    const parsed: ExpressionFn = parse(expression);

    const wrapper = (scope: Record<string, unknown>, locals?: Record<string, unknown>): unknown =>
      getTrusted(ctx, parsed(scope, locals));

    // Forward the parser-attached metadata flags (`literal`, `constant`,
    // `oneTime`) onto the wrapper so watchers built on top of `parseAs`
    // continue to select the correct delegate (see spec 010). Mirrors the
    // `Object.defineProperties` pattern used in `createInterpolate`.
    Object.defineProperties(wrapper, {
      literal: { value: parsed.literal, writable: false, enumerable: true, configurable: false },
      constant: { value: parsed.constant, writable: false, enumerable: true, configurable: false },
      oneTime: { value: parsed.oneTime, writable: false, enumerable: true, configurable: false },
    });

    return wrapper as SceParsedFn;
  }

  function valueOf(value: unknown): unknown {
    return delegate.valueOf(value);
  }

  return {
    isEnabled,

    trustAs,
    trustAsHtml: (value) => trustAs(SCE_CONTEXTS.HTML, value),
    trustAsUrl: (value) => trustAs(SCE_CONTEXTS.URL, value),
    trustAsResourceUrl: (value) => trustAs(SCE_CONTEXTS.RESOURCE_URL, value),
    trustAsJs: (value) => trustAs(SCE_CONTEXTS.JS, value),
    trustAsCss: (value) => trustAs(SCE_CONTEXTS.CSS, value),

    getTrusted,
    getTrustedHtml: (value) => getTrusted(SCE_CONTEXTS.HTML, value),
    getTrustedUrl: (value) => getTrusted(SCE_CONTEXTS.URL, value),
    getTrustedResourceUrl: (value) => getTrusted(SCE_CONTEXTS.RESOURCE_URL, value),
    getTrustedJs: (value) => getTrusted(SCE_CONTEXTS.JS, value),
    getTrustedCss: (value) => getTrusted(SCE_CONTEXTS.CSS, value),

    parseAs,
    parseAsHtml: (expression) => parseAs(SCE_CONTEXTS.HTML, expression),
    parseAsUrl: (expression) => parseAs(SCE_CONTEXTS.URL, expression),
    parseAsResourceUrl: (expression) => parseAs(SCE_CONTEXTS.RESOURCE_URL, expression),
    parseAsJs: (expression) => parseAs(SCE_CONTEXTS.JS, expression),
    parseAsCss: (expression) => parseAs(SCE_CONTEXTS.CSS, expression),

    valueOf,
  };
}

/**
 * Pre-configured façade instance with strict mode ON and the default
 * delegate (allow-list `['self']`, block-list `[]`). Exported for pure-ESM
 * consumers that do not need to customize either.
 */
export const sce: SceService = createSce();
