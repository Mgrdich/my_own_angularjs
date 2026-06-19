/**
 * `sanitizeUri` — compiler-level URL safe-listing (spec 034 Slice 2 /
 * technical-considerations §2.2).
 *
 * AngularJS runs a `$$sanitizeUri` pass at the compiler's URL-attribute
 * write path: a URL that matches the configured safe-list pattern is
 * written verbatim; a URL that does NOT match is neutralized by
 * prefixing it with `unsafe:`, so the browser treats it as a relative
 * navigation to a (nonexistent) `unsafe:` scheme instead of executing a
 * `javascript:` / dangerous `data:` payload.
 *
 * This is a SEPARATE layer from `$sce`. The project's `$sce` URL context
 * passes plain strings through unchanged (`sce-delegate.ts:123-127` — a
 * deliberate simplification); `sanitizeUri` is the additive
 * compiler-level safety net that spec 031 deferred. The two are
 * independent: `$sce` governs trust wrappers, `sanitizeUri` governs the
 * literal scheme of the resolved URL string written to `href` / `src`.
 *
 * The function is pure — it never reads global state and never mutates
 * its arguments — so it is unit-testable in isolation and the caller is
 * responsible for selecting the correct pattern (href vs. img/media).
 *
 * @param uri         The resolved URL string about to be written to a
 *                    DOM attribute.
 * @param isMediaUrl  `true` for media/source contexts (`img[src]`,
 *                    `[srcset]`), `false` for link contexts
 *                    (`a`/`area[href]`). Informational only in this
 *                    implementation — the caller has already resolved
 *                    the matching `pattern` for the context, so the
 *                    flag does not branch here. It is retained in the
 *                    signature for AngularJS parity and to document the
 *                    call site's intent (and to leave room for a future
 *                    href-vs-media split without a signature change).
 * @param pattern     The safe-list RegExp for the context (the
 *                    `aHrefSanitizationTrustedUrlList` or
 *                    `imgSrcSanitizationTrustedUrlList` value).
 * @returns The URI unchanged when it matches `pattern`, else the URI
 *          prefixed with `'unsafe:'`.
 *
 * @example
 * ```ts
 * const href = /^\s*(https?|ftp|mailto|tel|file):/;
 * sanitizeUri('https://example.com', false, href); // 'https://example.com'
 * sanitizeUri('javascript:alert(1)', false, href); // 'unsafe:javascript:alert(1)'
 *
 * const img = /^\s*((https?|ftp|file|blob):|data:image\/)/;
 * sanitizeUri('data:image/png;base64,AAAA', true, img); // unchanged
 * sanitizeUri('data:text/html,<script>', true, img);    // 'unsafe:data:text/html,<script>'
 * ```
 */
export function sanitizeUri(uri: string, isMediaUrl: boolean, pattern: RegExp): string {
  // `isMediaUrl` is intentionally not branched on — the caller resolves
  // the context-appropriate `pattern` before calling. The void reference
  // keeps the parameter (which is part of the AngularJS-parity contract)
  // from tripping the no-unused-vars lint rule.
  void isMediaUrl;
  if (pattern.test(uri)) {
    return uri;
  }
  return `unsafe:${uri}`;
}
