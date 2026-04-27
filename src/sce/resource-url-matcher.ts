/**
 * Resource-URL matcher helpers for the `$sceDelegate` allow/block lists.
 *
 * A list entry can be the literal string `'self'` (match same-origin URLs
 * relative to the document base), a string URL pattern (`*` / `**` wildcards,
 * AngularJS parity), or a user-supplied `RegExp`. This module compiles each
 * heterogeneous entry into a uniform `CompiledMatcher` shape and exposes a
 * single `matches(url, matchers, baseUrl?)` predicate.
 *
 * Non-obvious: the string-pattern `*` translation rule is `[^:/?#]*` — a
 * greedy sequence that does NOT cross URL component separators (scheme, path,
 * query, fragment), NOT the intuitive `.*`. This is AngularJS 1.x parity
 * (`src/ng/sce.js:adjustMatcher`). Future maintainers should NOT "fix" this
 * to `.*`; the narrower class is what makes simple patterns like
 * `https://api.example.com/*` safe — `*` cannot swallow an additional path
 * segment, so `/v1/users` does not leak past a single-segment allow.
 *
 * Dependencies: none beyond the `ResourceUrlListEntry` type. No `$sce`
 * runtime; pure string / URL manipulation so unit tests can drive it in
 * isolation.
 */

import type { ResourceUrlListEntry } from '@sce/sce-types';

/**
 * A compiled list entry produced by `compileMatchers`.
 *
 * - `{ kind: 'self' }` defers origin comparison to match time so
 *   `document.baseURI` is read lazily (it may differ between test fixtures
 *   and production).
 * - `{ kind: 'regex', pattern }` holds either the user-supplied RegExp
 *   (reused as-is, AngularJS parity) or a regex compiled from a string
 *   pattern.
 */
export type CompiledMatcher = { readonly kind: 'self' } | { readonly kind: 'regex'; readonly pattern: RegExp };

/** Characters that must be escaped when compiling a string URL pattern. */
const REGEX_METACHARACTERS = new Set<string>(['\\', '^', '$', '.', '|', '?', '(', ')', '[', ']', '{', '}', '+', '/']);

/** Truncate a description of an invalid entry for inclusion in an error. */
function describeInvalidEntry(entry: unknown): string {
  const typeofEntry = typeof entry;
  let stringified: string;
  try {
    stringified = String(entry);
  } catch {
    stringified = '[unstringifiable value]';
  }
  const truncated = stringified.length > 40 ? `${stringified.slice(0, 40)}…` : stringified;
  return `${typeofEntry} ${truncated}`;
}

/**
 * Compile a string URL pattern into an anchored RegExp.
 *
 * Walks the input left-to-right so the `**` token is consumed before any
 * lone `*`. Every other regex metacharacter is escaped (and `/` too, for
 * safety against future regex-flavor changes). The returned regex is
 * anchored with `^…$` so a pattern matches only if it consumes the entire
 * URL string.
 */
function compileStringPattern(pattern: string): RegExp {
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 2;
      } else {
        out += '[^:/?#]*';
        i += 1;
      }
      continue;
    }
    // ch is defined because i < pattern.length, but satisfy noUncheckedIndexedAccess.
    if (ch === undefined) break;
    if (REGEX_METACHARACTERS.has(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  out += '$';
  return new RegExp(out);
}

/**
 * Compile a heterogeneous allow/block list into an array of uniform matchers.
 *
 * Throws synchronously on any entry that is not `'self'`, a `RegExp`, or a
 * string. Empty lists are valid and produce an empty matcher array. The
 * returned array is a fresh allocation — mutating it does not affect the
 * caller's input, and vice versa.
 *
 * @param list - The allow-list or block-list provided to `$sceDelegateProvider`.
 * @returns One compiled matcher per input entry, in input order.
 */
export function compileMatchers(list: readonly ResourceUrlListEntry[]): CompiledMatcher[] {
  const compiled: CompiledMatcher[] = [];
  for (const entry of list) {
    if (entry === 'self') {
      compiled.push({ kind: 'self' });
      continue;
    }
    if (entry instanceof RegExp) {
      compiled.push({ kind: 'regex', pattern: entry });
      continue;
    }
    if (typeof entry === 'string') {
      compiled.push({ kind: 'regex', pattern: compileStringPattern(entry) });
      continue;
    }
    throw new Error(
      `$sceDelegateProvider: invalid list entry — expected 'self', a RegExp, or a URL pattern string, got ${describeInvalidEntry(entry)}`,
    );
  }
  return compiled;
}

/**
 * Resolve the effective base URL for `'self'` matching.
 *
 * Returns the explicit `baseUrl` argument when provided, else the current
 * document's `baseURI` when a `document` exists, else `undefined` so the
 * caller can treat `'self'` matching as inert.
 */
function resolveBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl !== undefined) return baseUrl;
  if (typeof document !== 'undefined') return document.baseURI;
  return undefined;
}

/**
 * True iff `url` (resolved relative to `baseUrl`) has the same scheme, host,
 * and port as `baseUrl` itself.
 *
 * Returns `false` on parse failure rather than throwing — callers treat an
 * un-parseable URL as not-same-origin. The platform `URL` constructor
 * normalizes default ports (80 for http, 443 for https) to the empty string,
 * so `port` comparison is reliable without extra handling.
 *
 * @param url - The URL to test (may be relative; resolved against `baseUrl`).
 * @param baseUrl - The origin to compare against.
 */
export function isSameOrigin(url: string, baseUrl: string): boolean {
  let resolved: URL;
  let base: URL;
  try {
    resolved = new URL(url, baseUrl);
  } catch {
    return false;
  }
  try {
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  return resolved.protocol === base.protocol && resolved.host === base.host && resolved.port === base.port;
}

/**
 * True iff `url` matches any of the given compiled matchers.
 *
 * - `'regex'` matchers are tested against the raw `url` string (no
 *   pre-normalization — AngularJS parity).
 * - `'self'` matchers resolve `url` against `baseUrl` (defaulting to
 *   `document.baseURI` inside a browser or jsdom) and compare the origin;
 *   if no base URL is available, `'self'` matchers always return `false`.
 * - Returns `false` for an empty matcher array. Callers that need
 *   block-precedence semantics are responsible for ordering their checks
 *   (this function reports matches only, not allow vs. deny).
 *
 * @param url - The URL to test.
 * @param matchers - Compiled matchers from `compileMatchers`.
 * @param baseUrl - Optional override for the document base URL.
 */
export function matches(url: string, matchers: readonly CompiledMatcher[], baseUrl?: string): boolean {
  if (matchers.length === 0) return false;
  const effectiveBaseUrl = resolveBaseUrl(baseUrl);
  for (const matcher of matchers) {
    if (matcher.kind === 'regex') {
      if (matcher.pattern.test(url)) return true;
      continue;
    }
    // matcher.kind === 'self'
    if (effectiveBaseUrl === undefined) continue;
    let resolvedHref: string;
    try {
      resolvedHref = new URL(url, effectiveBaseUrl).href;
    } catch {
      continue;
    }
    if (isSameOrigin(resolvedHref, effectiveBaseUrl)) return true;
  }
  return false;
}
