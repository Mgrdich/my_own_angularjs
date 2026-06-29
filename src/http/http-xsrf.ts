/**
 * XSRF (cross-site-request-forgery) protection for `$http` (spec 038 Slice 5 /
 * §2.11 / tech §2.8).
 *
 * The browser server-side convention: the server leaves a per-session
 * anti-forgery token in a cookie (default name `XSRF-TOKEN`); `$http` reads it
 * and echoes it back on the request in a header (default `X-XSRF-TOKEN`) so the
 * server can confirm the request is genuine. The token is read fresh per
 * request and attached ONLY when the request URL is SAME-ORIGIN — sending it
 * cross-origin would leak it to a third party, so the {@link isSameOrigin} gate
 * (reused from `@sce`, already tested) is the security-critical guard.
 *
 * Two seams keep this unit-testable without real cookies / a real document:
 *
 * - {@link CookieReader} (`$$cookieReader`) — a `() => string` over
 *   `document.cookie`, defaulting to {@link defaultCookieReader} which
 *   feature-detects `document` (a non-browser env yields the empty cookie
 *   string, never a throw). Mirrors the `TemplateFetcher` injection precedent.
 * - {@link resolveBaseUrl} — resolves the document base for the same-origin
 *   comparison (`document.baseURI` when available, else a sensible default),
 *   overridable by the caller for tests.
 *
 * The token names are config-phase settable through `defaults.xsrfCookieName`
 * / `defaults.xsrfHeaderName` (read lazily per request, so a config block's
 * mutation is honored). This module is PURE — `applyXsrfHeader` mutates the
 * passed header bag in place and returns nothing observable beyond that.
 */

import { isSameOrigin } from '@sce/resource-url-matcher';
import type { HttpHeaders } from './http-types';

/** The default XSRF cookie name the server is expected to set. */
export const DEFAULT_XSRF_COOKIE_NAME = 'XSRF-TOKEN';

/** The default request header the token is echoed back in. */
export const DEFAULT_XSRF_HEADER_NAME = 'X-XSRF-TOKEN';

/**
 * The `document.cookie`-shaped seam (`$$cookieReader`). Returns the raw cookie
 * string (`'a=1; b=2'`); tests inject a stub so they never touch real cookies.
 */
export type CookieReader = () => string;

/**
 * Default {@link CookieReader} — reads `document.cookie` behind a feature
 * detect so a non-browser environment (SSR / Node) yields `''` rather than a
 * `ReferenceError`. This is the seam the `ngModule` registration binds.
 */
export const defaultCookieReader: CookieReader = () => {
  if (typeof document === 'undefined') {
    return '';
  }
  return document.cookie;
};

/**
 * Parse a raw cookie string (`'a=1; b=2'`) and return the value stored under
 * `name`, or `null` on a miss. Values are `decodeURIComponent`-decoded (cookies
 * are URI-encoded on the wire); a decode failure falls back to the raw value so
 * a malformed token never throws out of the request path. The first occurrence
 * of a duplicated name wins (browser cookie-jar order).
 */
export function readCookieValue(raw: string, name: string): string | null {
  if (raw === '') {
    return null;
  }
  for (const pair of raw.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = pair.slice(0, separatorIndex).trim();
    if (key !== name) {
      continue;
    }
    const value = pair.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/**
 * Resolve the base URL used for the same-origin comparison. Returns the
 * explicit `baseUrl` when provided (tests pass one), else `document.baseURI`
 * when a document exists, else `undefined` so the caller treats every request
 * as NOT same-origin (no token attached) in a non-browser environment.
 */
export function resolveBaseUrl(baseUrl: string | undefined): string | undefined {
  if (baseUrl !== undefined) {
    return baseUrl;
  }
  if (typeof document !== 'undefined') {
    return document.baseURI;
  }
  return undefined;
}

/**
 * Arguments to {@link applyXsrfHeader}.
 */
export interface ApplyXsrfHeaderArgs {
  /** The mutable merged request-header bag the token is attached to. */
  readonly headers: HttpHeaders;
  /** The resolved request URL (params already serialized on). */
  readonly url: string;
  /** The cookie-name to read (config-phase settable; default `XSRF-TOKEN`). */
  readonly cookieName: string;
  /** The header-name to echo the token in (default `X-XSRF-TOKEN`). */
  readonly headerName: string;
  /** The cookie-reading seam. */
  readonly cookieReader: CookieReader;
  /** Optional explicit base URL for the same-origin gate (tests). */
  readonly baseUrl?: string;
}

/**
 * Attach the XSRF token header to `headers` IN PLACE — but only when the
 * request is same-origin AND a token is present in the cookie. Cross-origin
 * requests (or an absent token / unresolvable base) leave the header bag
 * untouched so the token is never leaked off-origin (FS §2.11).
 *
 * @param args - The header bag, URL, configurable names, and the seams.
 */
export function applyXsrfHeader(args: ApplyXsrfHeaderArgs): void {
  const { headers, url, cookieName, headerName, cookieReader, baseUrl } = args;

  const effectiveBaseUrl = resolveBaseUrl(baseUrl);
  if (effectiveBaseUrl === undefined) {
    return;
  }
  if (!isSameOrigin(url, effectiveBaseUrl)) {
    return;
  }

  const token = readCookieValue(cookieReader(), cookieName);
  if (token === null || token === '') {
    return;
  }

  headers[headerName] = token;
}
