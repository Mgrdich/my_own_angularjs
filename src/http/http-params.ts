/**
 * Query-parameter serialization for `$http` (spec 038 Slice 3 / §2.5).
 *
 * {@link paramSerializer} is the DEFAULT serializer: it turns a structured
 * `params` object into a properly-escaped query string via
 * `encodeURIComponent`, following AngularJS's default rule —
 *
 * - `undefined` / `null` values are SKIPPED.
 * - An array value emits one `key=value` pair per element (`a=1&a=2`).
 * - A `Date` value is serialized to its ISO string.
 * - Any other object value is `JSON.stringify`-d.
 * - Everything else is coerced with `String(...)`.
 *
 * Keys are emitted in sorted order so the output is stable (AngularJS parity).
 *
 * {@link paramSerializerJQLike} is the jQuery-like alternate: it uses bracket
 * notation for nested arrays/objects (`a[]=1&a[]=2`, `obj[k]=v`). It is
 * swappable application-wide (`defaults.paramSerializer`) and per request
 * (`config.paramSerializer`).
 *
 * {@link buildUrl} appends a serialized query string to a URL, respecting an
 * existing `?` (it joins with `&` if the URL already carries a query).
 *
 * @example
 * ```ts
 * paramSerializer({ q: 'a b', tags: ['x', 'y'], from: new Date(0) });
 * // => 'from=1970-01-01T00:00:00.000Z&q=a%20b&tags=x&tags=y'
 *
 * paramSerializerJQLike({ tags: ['x', 'y'], page: { n: 2 } });
 * // => 'page%5Bn%5D=2&tags%5B%5D=x&tags%5B%5D=y'
 * ```
 */

import type { ParamSerializer } from './http-types';

/**
 * Escape a string for use in a query component. Wraps `encodeURIComponent` and
 * restores the handful of characters AngularJS leaves un-escaped in query
 * strings for readability (`@`, `:`, `$`, `,`, `;`, `+`, `=`, `?`, `/`).
 */
function encodeUriQuery(value: string): string {
  return encodeURIComponent(value)
    .replace(/%40/gi, '@')
    .replace(/%3A/gi, ':')
    .replace(/%24/g, '$')
    .replace(/%2C/gi, ',')
    .replace(/%3B/gi, ';')
    .replace(/%20/g, '+')
    .replace(/%3D/gi, '=')
    .replace(/%3F/gi, '?')
    .replace(/%2F/gi, '/');
}

/**
 * Coerce a scalar (`string` / `number` / `boolean` / `bigint` / `symbol`)
 * param value to its string form. Symbols use `.toString()` (the only safe
 * form); everything else uses template coercion.
 */
function scalarToString(value: string | number | boolean | bigint | symbol): string {
  // `String(...)` handles every scalar (including `symbol` and `bigint`)
  // without the template-literal restriction on `bigint`.
  return String(value);
}

/**
 * Serialize a single non-array param value to its string form per AngularJS's
 * default rule: `Date` → ISO string, plain object → JSON, anything scalar →
 * string coercion. Callers skip `undefined` / `null` before invoking.
 */
function serializeValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'function') {
    return value.toString();
  }
  return scalarToString(value as string | number | boolean | bigint | symbol);
}

/**
 * The DEFAULT param serializer (FS §2.5). Skips `undefined` / `null`, repeats
 * the key for array elements, ISO-encodes `Date`s, JSON-encodes other objects,
 * and emits keys in sorted order for a stable result.
 */
export const paramSerializer: ParamSerializer = (params) => {
  if (params === undefined) {
    return '';
  }

  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const element of value) {
        if (element === undefined || element === null) {
          continue;
        }
        parts.push(`${encodeUriQuery(key)}=${encodeUriQuery(serializeValue(element))}`);
      }
    } else {
      parts.push(`${encodeUriQuery(key)}=${encodeUriQuery(serializeValue(value))}`);
    }
  }

  return parts.join('&');
};

/**
 * Recursively flatten a value into bracket-notation `key=value` pairs for the
 * jQuery-like serializer. `topLevel` distinguishes the first call (where array
 * elements use `key[]`) from nested calls.
 */
function jqLikeSerialize(value: unknown, prefix: string, parts: string[]): void {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((element, index) => {
      // Primitive array elements use `key[]`; nested arrays/objects index by
      // position (`key[0][k]`) to disambiguate — AngularJS's jQuery-like rule.
      const childPrefix =
        element !== null && typeof element === 'object' ? `${prefix}[${String(index)}]` : `${prefix}[]`;
      jqLikeSerialize(element, childPrefix, parts);
    });
  } else if (value instanceof Date) {
    parts.push(`${encodeUriQuery(prefix)}=${encodeUriQuery(value.toISOString())}`);
  } else if (typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      jqLikeSerialize((value as Record<string, unknown>)[key], `${prefix}[${key}]`, parts);
    }
  } else {
    parts.push(`${encodeUriQuery(prefix)}=${encodeUriQuery(serializeValue(value))}`);
  }
}

/**
 * The jQuery-like (bracket-notation) param serializer (FS §2.5). Nested arrays
 * emit `key[]=…`, nested objects emit `key[child]=…`. Ships as an alternate to
 * the {@link paramSerializer} default; swap it in via
 * `defaults.paramSerializer = paramSerializerJQLike`.
 */
export const paramSerializerJQLike: ParamSerializer = (params) => {
  if (params === undefined) {
    return '';
  }

  const parts: string[] = [];
  for (const key of Object.keys(params).sort()) {
    jqLikeSerialize(params[key], key, parts);
  }
  return parts.join('&');
};

/**
 * Append a serialized query string to a URL, respecting an existing `?`. An
 * empty `serialized` string returns the URL unchanged; otherwise the URL joins
 * with `&` (when it already carries a `?`) or `?` (when it does not).
 *
 * @param url - The base URL (may already carry a query string).
 * @param serialized - The serialized query string (no leading `?`).
 * @returns The URL with the query string appended.
 */
export function buildUrl(url: string, serialized: string): string {
  if (serialized === '') {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${serialized}`;
}
