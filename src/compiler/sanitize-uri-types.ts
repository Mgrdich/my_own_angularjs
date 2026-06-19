/**
 * Type for the internal `$$sanitizeUri` DI service (spec 034 Slice 2).
 *
 * `$CompileProvider` registers a `$$sanitizeUri` factory at config time
 * whose `$get` closes over the two config-phase URL safe-list patterns
 * (`aHrefSanitizationTrustedUrlList` / `imgSrcSanitizationTrustedUrlList`,
 * frozen at `$get` time). The built-in `ng-href` / `ng-src` / `ng-srcset`
 * alias directives inject this service so they apply the SAME configured
 * safe-list as the eager attribute-interpolation write path in
 * `attributes.ts` — a single source of truth for URL neutralization.
 *
 * The service signature mirrors the pure {@link import('./sanitize-uri').sanitizeUri}
 * helper minus the `pattern` argument: the caller picks the context via
 * `isMediaUrl`, and the service selects the matching pattern internally.
 *
 * @example
 * ```ts
 * // ng-href:
 * const safe = $$sanitizeUri('javascript:alert(1)', false); // 'unsafe:javascript:alert(1)'
 * // ng-src / ng-srcset:
 * const safeImg = $$sanitizeUri('data:image/png;base64,AAAA', true); // unchanged
 * ```
 */
export type SanitizeUriService = (uri: string, isMediaUrl: boolean) => string;
