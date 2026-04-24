/**
 * `createSceDelegate` — the always-strict, lower-level trust-unwrapping
 * factory.
 *
 * This is the lower layer that `createSce` builds on. It owns the compiled
 * resource-URL matchers and the raw `trustAs` / `getTrusted` / `valueOf`
 * trio. It is always strict — pass-through / disabled mode lives in
 * `createSce` (slice 4). Use `createSce` when you want the façade with the
 * `enabled` toggle and the `parseAs*` / `trustAs*` / `getTrusted*`
 * shortcuts; use `createSceDelegate` directly only when you need the raw
 * primitives (e.g. testing, DI provider wiring).
 *
 * The returned object is a plain literal of three standalone functions
 * (not bound to `this`) closing over the compiled matchers — safely
 * destructurable by consumers.
 */

import {
  SCE_CONTEXTS,
  SCE_CONTEXT_ANY,
  type SceContext,
  type SceContextAny,
  isValidSceContext,
} from '@sce/sce-contexts';
import { type CompiledMatcher, compileMatchers, matches } from '@sce/resource-url-matcher';
import type { SceDelegateOptions, SceDelegateService } from '@sce/sce-types';
import {
  TrustedCss,
  TrustedHtml,
  TrustedJs,
  TrustedResourceUrl,
  TrustedUrl,
  TrustedValueAny,
  isTrustedFor,
  isTrustedValue,
} from '@sce/trusted-values';

/**
 * Map from public context string to the human-readable `trustAs*` shortcut
 * name used in the `getTrusted` mismatch error message. Inlined to keep the
 * hot path free of table lookups; five entries is not worth a helper.
 */
function trustAsShortcutFor(ctx: SceContext): string {
  switch (ctx) {
    case SCE_CONTEXTS.HTML:
      return 'trustAsHtml';
    case SCE_CONTEXTS.URL:
      return 'trustAsUrl';
    case SCE_CONTEXTS.RESOURCE_URL:
      return 'trustAsResourceUrl';
    case SCE_CONTEXTS.JS:
      return 'trustAsJs';
    case SCE_CONTEXTS.CSS:
      return 'trustAsCss';
  }
}

/**
 * Create an always-strict SCE delegate service.
 *
 * Compiles the allow- and block-lists once at factory-call time; any
 * validation error from `compileMatchers` propagates synchronously.
 *
 * @param options - Optional allow-list / block-list configuration. Defaults
 *   to `['self']` allow and `[]` block (AngularJS 1.x defaults).
 * @returns The delegate service — a plain object with `trustAs`,
 *   `getTrusted`, and `valueOf` methods closed over the compiled matchers.
 */
export function createSceDelegate(options?: SceDelegateOptions): SceDelegateService {
  const allowMatchers: readonly CompiledMatcher[] = compileMatchers(options?.trustedResourceUrlList ?? ['self']);
  const blockMatchers: readonly CompiledMatcher[] = compileMatchers(options?.bannedResourceUrlList ?? []);

  function trustAs(ctx: SceContext, value: unknown): unknown {
    if (value === null) return null;
    if (value === undefined) return undefined;

    if (typeof value !== 'string' && !isTrustedValue(value)) {
      throw new Error(`$sceDelegate.trustAs: value must be a string, got ${typeof value}`);
    }

    // Internally trustAs also accepts the `$$ANY$$` pseudo-context (the
    // escape hatch) even though the public type narrows to SceContext. We
    // accept callers who bypass the type system to reach the sentinel but
    // reject any other unknown string.
    const isAny = (ctx as SceContext | SceContextAny) === SCE_CONTEXT_ANY;
    if (!isValidSceContext(ctx) && !isAny) {
      throw new Error(`$sceDelegate.trustAs: unknown context '${String(ctx)}'`);
    }

    const raw: string = isTrustedValue(value) ? value.$$unwrapTrustedValue : value;

    if (isAny) return new TrustedValueAny(raw);

    switch (ctx) {
      case SCE_CONTEXTS.HTML:
        return new TrustedHtml(raw);
      case SCE_CONTEXTS.URL:
        return new TrustedUrl(raw);
      case SCE_CONTEXTS.RESOURCE_URL:
        return new TrustedResourceUrl(raw);
      case SCE_CONTEXTS.JS:
        return new TrustedJs(raw);
      case SCE_CONTEXTS.CSS:
        return new TrustedCss(raw);
    }
  }

  function valueOf(value: unknown): unknown {
    if (isTrustedValue(value)) return value.$$unwrapTrustedValue;
    return value;
  }

  function getTrusted(ctx: SceContext, value: unknown): unknown {
    if (value === null) return null;
    if (value === undefined) return undefined;

    if (!isValidSceContext(ctx)) {
      // `$$ANY$$` is NOT accepted here — getTrusted is the consumer-facing
      // gate, and the "any" escape hatch is meaningful only when producing.
      throw new Error(`$sceDelegate.getTrusted: unknown context '${String(ctx)}'`);
    }

    // URL context: plain strings pass through (AngularJS parity — modern
    // browsers do not execute URL protocol text in href/src). A wrapper
    // still has to satisfy the context match below.
    if (ctx === SCE_CONTEXTS.URL && typeof value === 'string') {
      return value;
    }

    // Resource-URL context: list enforcement with block-first precedence.
    if (ctx === SCE_CONTEXTS.RESOURCE_URL) {
      let candidateUrl: string | undefined;
      let fromWrapper = false;

      if (isTrustedValue(value)) {
        candidateUrl = value.$$unwrapTrustedValue;
        fromWrapper = true;
      } else if (typeof value === 'string') {
        candidateUrl = value;
      }

      if (candidateUrl !== undefined) {
        // Wrapper already trusted for resourceUrl (including the any-context
        // escape hatch) short-circuits list checks — the author accepted
        // responsibility by wrapping.
        if (fromWrapper && isTrustedFor(SCE_CONTEXTS.RESOURCE_URL, value)) {
          return candidateUrl;
        }

        if (matches(candidateUrl, blockMatchers)) {
          throw new Error(`$sceDelegate.getTrusted: URL matched a banned resource URL list entry: ${candidateUrl}`);
        }
        if (matches(candidateUrl, allowMatchers)) {
          return candidateUrl;
        }
        throw new Error(
          `$sceDelegate.getTrusted: URL did not match any trusted resource URL list entry: ${candidateUrl}`,
        );
      }
      // Non-string, non-wrapper input (e.g. a number) falls through to the
      // generic context-mismatch error below.
    }

    if (isTrustedFor(ctx, value)) {
      return valueOf(value);
    }

    throw new Error(
      `$sceDelegate.getTrusted: value was not trusted for context '${ctx}'. Use $sce.${trustAsShortcutFor(ctx)}(...) or configure a trusted resource URL list.`,
    );
  }

  return { trustAs, getTrusted, valueOf };
}

/**
 * Pre-configured delegate instance with the default allow-list (`['self']`)
 * and block-list (`[]`). Exported for pure-ESM consumers who do not need to
 * customize the resource-URL lists.
 */
export const sceDelegate: SceDelegateService = createSceDelegate();
