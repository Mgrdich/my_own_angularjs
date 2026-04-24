/**
 * SCE security context identifiers.
 *
 * Exposes the five public context keys recognized by the `$sce` service
 * (`html`, `url`, `resourceUrl`, `js`, `css`) and a module-internal "any"
 * pseudo-context (`$$ANY$$`) used by the escape-hatch `TrustedValueAny`
 * wrapper. The public keys are published as a frozen `as const` constant so
 * library consumers never need to hard-code strings, and a runtime type guard
 * is provided for callers that validate incoming context arguments.
 */

/**
 * Frozen mapping of public SCE context names to their string identifiers.
 *
 * These five values are the only context keys accepted by
 * `$sce.trustAs` / `$sce.getTrusted` on the public API surface.
 */
export const SCE_CONTEXTS = Object.freeze({
  HTML: 'html',
  URL: 'url',
  RESOURCE_URL: 'resourceUrl',
  JS: 'js',
  CSS: 'css',
} as const);

/** Union of valid public SCE context strings. */
export type SceContext = (typeof SCE_CONTEXTS)[keyof typeof SCE_CONTEXTS];

/**
 * Internal "any" pseudo-context identifier.
 *
 * Values wrapped with this context unwrap successfully in every public
 * context. AngularJS parity: some trusted helpers don't know their eventual
 * consumer and must mark a value as trusted everywhere. This sentinel is
 * deliberately NOT re-exported from the public barrel — consumers cannot
 * construct an "any" wrapper directly.
 */
export const SCE_CONTEXT_ANY = '$$ANY$$' as const;

/** Internal type for the `$$ANY$$` pseudo-context. */
export type SceContextAny = typeof SCE_CONTEXT_ANY;

/**
 * Runtime guard that accepts only the five public SCE context strings.
 *
 * Rejects the internal `$$ANY$$` pseudo-context, unknown strings, and
 * non-string inputs. Used by `createSceDelegate`, `createSce`, and
 * `createInterpolate` to validate context arguments supplied by callers.
 */
export function isValidSceContext(v: unknown): v is SceContext {
  return (
    v === SCE_CONTEXTS.HTML ||
    v === SCE_CONTEXTS.URL ||
    v === SCE_CONTEXTS.RESOURCE_URL ||
    v === SCE_CONTEXTS.JS ||
    v === SCE_CONTEXTS.CSS
  );
}
