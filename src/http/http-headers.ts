/**
 * Response-header parsing for `$http` (spec 038 Slice 2 / §2.1).
 *
 * {@link parseHeaders} turns the raw header string the {@link HttpBackend}
 * hands back (`name: value` pairs, one per line) into the case-insensitive
 * {@link HttpHeadersGetter} delivered on the {@link HttpResponse}. Header
 * names are lowercased for storage so lookup is case-insensitive
 * (`headers('Content-Type')` === `headers('content-type')`); calling the
 * getter with no argument returns a snapshot of every parsed header.
 *
 * This file also implements the request-side header MERGE
 * ({@link mergeHeaders}): `defaults.headers.common` + the per-HTTP-method bag
 * (e.g. `defaults.headers.post`) + per-request headers, layered with
 * later-wins precedence and case-insensitive de-duplication (request >
 * per-method > common) — all header machinery lives in one place (spec 038
 * Slice 3 / §2.4).
 *
 * @example
 * ```ts
 * const headers = parseHeaders('Content-Type: application/json\r\nX-Total: 5');
 * headers('content-type'); // => 'application/json'
 * headers('X-Total');      // => '5'
 * headers('missing');      // => null
 * headers();               // => { 'content-type': 'application/json', 'x-total': '5' }
 * ```
 */

import type { HttpDefaults, HttpHeaders, HttpHeadersGetter } from './http-types';

/**
 * Parse a raw header string into a lowercased-key map. A line is split on the
 * FIRST `:` only (values may legitimately contain colons, e.g. a `Date`
 * header). Blank lines and lines without a separator are skipped. A repeated
 * header name is joined with `', '` (the HTTP-canonical merge).
 */
function parseRawHeaders(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  if (raw === '') {
    return parsed;
  }

  for (const line of raw.split('\n')) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (name === '') {
      continue;
    }
    const existing = parsed[name];
    parsed[name] = existing === undefined ? value : `${existing}, ${value}`;
  }

  return parsed;
}

/**
 * Build the case-insensitive {@link HttpHeadersGetter} over a raw header
 * string. Parsing happens once eagerly here; the returned getter is a thin
 * closure over the parsed map.
 *
 * @param raw - The raw header string from the transport.
 * @returns A getter: `(name)` → that header's value or `null`; `()` → a
 *   snapshot of every parsed header.
 */
export function parseHeaders(raw: string): HttpHeadersGetter {
  const parsed = parseRawHeaders(raw);

  function getter(): Record<string, string>;
  function getter(name: string): string | null;
  function getter(name?: string): Record<string, string> | string | null {
    if (name === undefined) {
      return { ...parsed };
    }
    const value = parsed[name.toLowerCase()];
    return value === undefined ? null : value;
  }

  return getter;
}

/**
 * Layer one header bag over a base bag with case-insensitive de-dup and
 * later-wins precedence: an incoming key that case-insensitively matches a base
 * key REPLACES it (preserving the incoming key's casing). Returns a FRESH bag —
 * the base is never mutated. Used to fold `common` → per-method → per-request
 * so the last layer wins.
 */
function layerHeaders(base: HttpHeaders, incoming: HttpHeaders): HttpHeaders {
  const incomingLowerKeys = new Set(Object.keys(incoming).map((key) => key.toLowerCase()));
  const merged: HttpHeaders = {};

  // Keep base entries that the incoming layer does NOT override (by lowercase).
  for (const [name, value] of Object.entries(base)) {
    if (!incomingLowerKeys.has(name.toLowerCase())) {
      merged[name] = value;
    }
  }
  // Add the incoming layer (it wins).
  for (const [name, value] of Object.entries(incoming)) {
    merged[name] = value;
  }

  return merged;
}

/**
 * Merge the request headers from the application defaults and the per-request
 * config (FS §2.4). Precedence (later wins): `defaults.headers.common` <
 * `defaults.headers[method]` (the per-HTTP-method bag, looked up by the
 * lowercased method) < the per-request `config.headers`. Matching is
 * case-insensitive, so a per-request `content-type` overrides a default
 * `Content-Type`.
 *
 * @param defaults - The application-wide defaults bag.
 * @param method - The (already-resolved) HTTP method, any case.
 * @param requestHeaders - The per-request headers, if any.
 * @returns A fresh merged header bag (never the inputs).
 */
export function mergeHeaders(
  defaults: HttpDefaults,
  method: string,
  requestHeaders: HttpHeaders | undefined,
): HttpHeaders {
  let merged: HttpHeaders = { ...defaults.headers.common };

  const perMethod = defaults.headers[method.toLowerCase()];
  if (perMethod !== undefined) {
    merged = layerHeaders(merged, perMethod);
  }

  if (requestHeaders !== undefined) {
    merged = layerHeaders(merged, requestHeaders);
  }

  return merged;
}
