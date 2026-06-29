/**
 * Default JSON request / response transforms for `$http` (spec 038 Slice 3 /
 * §2.6 / §2.9).
 *
 * AngularJS models transforms as ARRAYS of functions so an app can prepend or
 * append steps around the defaults. This file ships:
 *
 * - {@link defaultTransformRequest} — a single-element array whose function
 *   JSON-serializes a STRUCTURED body (a plain object/array) and ensures a
 *   JSON `Content-Type` header; a string / `Blob` / `FormData` / `File` /
 *   `ArrayBuffer` / `URLSearchParams` / `Date` body passes through unchanged.
 * - {@link defaultTransformResponse} — a single-element array whose function
 *   `JSON.parse`s a response body that LOOKS like JSON; anything else passes
 *   through.
 *
 * {@link applyTransforms} folds an array of transforms left-to-right over the
 * data (each step receives the running data + the headers getter), and
 * {@link resolveTransforms} normalizes a `defaults` value plus a per-request
 * override into the array actually run (a per-request array REPLACES the
 * default; `undefined` keeps the default).
 *
 * A throwing transform is NOT routed through `$exceptionHandler` — it rejects
 * the `$http` promise (AngularJS parity); `EXCEPTION_HANDLER_CAUSES` stays 13.
 */

import type { HttpHeaders, HttpHeadersGetter, RequestTransform, ResponseTransform } from './http-types';

/**
 * Whether a request body is a STRUCTURED value the default request transform
 * should JSON-serialize. Excludes the body types `fetch` sends verbatim:
 * `string`, `Blob`, `FormData`, `File`, `ArrayBuffer`, `URLSearchParams`, and
 * `Date` (a `Date` is left to the caller — JSON-stringifying it would wrap it
 * in quotes, rarely the intent for a top-level body).
 */
function isJsonLikeBody(data: unknown): boolean {
  if (data === undefined || data === null) {
    return false;
  }
  if (typeof data !== 'object') {
    return false;
  }
  // Native body types `fetch` accepts as-is — never JSON-serialize them.
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return false;
  }
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    return false;
  }
  if (typeof File !== 'undefined' && data instanceof File) {
    return false;
  }
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
    return false;
  }
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
    return false;
  }
  if (data instanceof Date) {
    return false;
  }
  return true;
}

/**
 * Whether a response body string LOOKS like JSON — a leading `{` / `[`, or a
 * JSON literal (`true` / `false` / `null` / a number / a quoted string). A
 * conservative heuristic mirroring AngularJS's `JSON_START` / `JSON_ENDS`.
 */
function looksLikeJson(data: string): boolean {
  const trimmed = data.trim();
  if (trimmed === '') {
    return false;
  }
  if (/^\s*[[{]/.test(trimmed)) {
    // Reject the XSRF-prefix protection marker `)]}',\n` AngularJS strips
    // before parsing; without the marker, a `{`/`[` start is JSON.
    return !/^\)]\}',?\n/.test(trimmed);
  }
  return /^(true|false|null|"|-?\d)/.test(trimmed);
}

/**
 * Find a header value by case-insensitive name from a mutable request-headers
 * bag (the bag the request transform mutates to set `Content-Type`).
 */
function findHeaderKey(headers: HttpHeaders, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lower);
}

/**
 * The default request transform (FS §2.6): JSON-serialize a structured body
 * and ensure a JSON `Content-Type`. Receives the live request-headers bag so
 * it can set the content type in place.
 */
export const defaultTransformRequest: RequestTransform[] = [
  (data: unknown, headers: HttpHeaders): unknown => {
    if (isJsonLikeBody(data)) {
      if (findHeaderKey(headers, 'Content-Type') === undefined) {
        headers['Content-Type'] = 'application/json;charset=utf-8';
      }
      return JSON.stringify(data);
    }
    return data;
  },
];

/**
 * The default response transform (FS §2.6): `JSON.parse` a body that looks like
 * JSON; pass everything else through. A parse failure leaves the raw string
 * (defensive — a malformed body should not blow up the pipeline).
 */
export const defaultTransformResponse: ResponseTransform[] = [
  (data: unknown): unknown => {
    if (typeof data !== 'string') {
      return data;
    }
    if (!looksLikeJson(data)) {
      return data;
    }
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return data;
    }
  },
];

/**
 * Fold an array of request transforms over the body, threading the mutable
 * headers bag through each step. Returns the transformed body.
 */
export function applyRequestTransforms(
  transforms: readonly RequestTransform[],
  data: unknown,
  headers: HttpHeaders,
): unknown {
  return transforms.reduce<unknown>((acc, transform) => transform(acc, headers), data);
}

/**
 * Fold an array of response transforms over the body, threading the response
 * headers getter + status through each step. Returns the transformed body.
 */
export function applyResponseTransforms(
  transforms: readonly ResponseTransform[],
  data: unknown,
  headers: HttpHeadersGetter,
  status: number,
): unknown {
  return transforms.reduce<unknown>((acc, transform) => transform(acc, headers, status), data);
}

/**
 * Normalize a transforms value (a single function OR an array) plus a
 * per-request override into the array actually run. A per-request value
 * REPLACES the default; `undefined` keeps the default. A bare function is
 * wrapped in a single-element array.
 *
 * @param fallback - The application default (function or array).
 * @param override - The per-request value, if any.
 * @returns The resolved transform array.
 */
export function resolveTransforms<F extends RequestTransform | ResponseTransform>(
  fallback: F | readonly F[] | undefined,
  override: F | readonly F[] | undefined,
): readonly F[] {
  const chosen = override ?? fallback;
  if (chosen === undefined) {
    return [];
  }
  // `Array.isArray` does not narrow a generic union (a known TS limitation),
  // so branch on whether `chosen` is callable: a function is a single
  // transform, anything else is the array form.
  return typeof chosen === 'function' ? [chosen] : chosen;
}
