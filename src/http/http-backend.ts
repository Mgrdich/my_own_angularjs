/**
 * `$httpBackend` — the fetch transport seam for `$http` (spec 038 Slice 2 /
 * §2.3).
 *
 * `createHttpBackend({ q })` returns a `$httpBackend(config, { signal })`
 * callable with TWO internal transports: the standard native `fetch` path
 * (every method except `JSONP`) and the `<script>`-tag JSONP path (`method:
 * 'JSONP'`, tech §2.3 / §2.7). The fetch path issues a single native `fetch`
 * and resolves a `$q` deferred with a {@link RawResponse} (status /
 * statusText / raw header string / body text) for EVERY HTTP response —
 * including non-2xx. Status classification
 * and response transforms are `$http`'s job, NOT the backend's, so the
 * backend never rejects on a 4xx/5xx; it only rejects when the request never
 * reached the server (fetch threw → {@link HttpTransportError} kind
 * `'network'`) or was aborted (kind `'abort'`).
 *
 * The factory is PURE — it takes the `$q` service and an optional `fetchFn`
 * seam (defaulting to the global `fetch`), so it is unit-testable standalone
 * without an injector and without touching the real network. The `ngModule`
 * registration binds the real `$q` and the global `fetch`. This mirrors the
 * `$templateRequest` `defaultFetcher` precedent and makes `$httpBackend` the
 * single point a future `ngMock` decorates.
 *
 * @example
 * ```ts
 * import { createHttpBackend } from 'my-own-angularjs/http';
 *
 * const $httpBackend = createHttpBackend({
 *   q: $q,
 *   fetchFn: async () =>
 *     new Response('{"ok":true}', { status: 200, statusText: 'OK' }),
 * });
 *
 * $httpBackend({ method: 'GET', url: '/x' }, {}).then((raw) => {
 *   raw.status; // 200
 *   raw.data;   // '{"ok":true}' (text — $http parses JSON)
 * });
 * ```
 */

import type { QService } from '@async/q-types';
import type { HttpBackend, HttpBackendOptions, HttpConfig, HttpTransportErrorKind, RawResponse } from './http-types';

/**
 * A transport-level failure that never produced an HTTP response — the
 * request either never reached the server (`kind: 'network'`) or was
 * cancelled / timed out (`kind: 'abort'`). `$http` inspects `kind` to settle
 * the caller's promise with a distinguishable failure bundle (FS §2.7): a
 * network failure surfaces as `status: -1`.
 *
 * @example
 * ```ts
 * $http.get('/x').catch((res) => {
 *   if (res.status === -1) {
 *     // never reached the server
 *   }
 * });
 * ```
 */
export class HttpTransportError extends Error {
  constructor(
    readonly kind: HttpTransportErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HttpTransportError';
  }
}

/**
 * Type guard for {@link HttpTransportError} — used by `$http` to tell a
 * transport sentinel apart from any other rejection reason.
 */
export function isHttpTransportError(value: unknown): value is HttpTransportError {
  return value instanceof HttpTransportError;
}

/**
 * The `fetch`-shaped seam injected into {@link createHttpBackend}. Defaults
 * to the global `fetch`; tests inject a stub returning a `Response` (or
 * throwing to simulate a network failure).
 */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The minimal `document` surface the JSONP transport touches — creating a
 * `<script>` node and a place to append it. Modelled as a seam (defaulting to
 * the global `document`) so the JSONP path stays unit-testable and so a
 * non-browser environment can be feature-detected (FS §2.12 / tech §2.7).
 */
export interface JsonpDocument {
  createElement(tagName: 'script'): HTMLScriptElement;
  readonly head: HTMLElement | null;
  readonly body: HTMLElement | null;
}

/**
 * The global object onto which the JSONP `<script>` callback is published and
 * later deleted. Defaults to `globalThis`; tests inject a plain object so the
 * registered callback name can be asserted + invoked deterministically.
 */
export type JsonpGlobal = Record<string, unknown>;

/** The literal placeholder a JSONP caller writes into the URL (AngularJS parity). */
export const JSONP_CALLBACK_PLACEHOLDER = 'JSON_CALLBACK';

/** The prefix for generated JSONP callback names (AngularJS-canonical). */
const JSONP_CALLBACK_PREFIX = 'angular_callbacks_';

/**
 * Arguments accepted by {@link createHttpBackend}.
 */
export interface CreateHttpBackendArgs {
  /** The `$q` service — resolving its deferred schedules a digest for free. */
  readonly q: QService;
  /**
   * Optional `fetch` seam. Defaults to the global `fetch` bound to
   * `globalThis`. Inject a stub in tests to avoid the network.
   */
  readonly fetchFn?: FetchFn;
  /**
   * Optional `document` seam for the JSONP `<script>` transport. Defaults to
   * the global `document` (feature-detected — when absent, a JSONP request
   * rejects with a clear error). Tests inject a stub.
   */
  readonly documentRef?: JsonpDocument | null;
  /**
   * Optional global object the JSONP callback is published onto. Defaults to
   * `globalThis`. Tests inject a plain object to observe registration +
   * cleanup.
   */
  readonly globalRef?: JsonpGlobal;
}

/**
 * Serialize a `Headers` object into the raw header string `$http` parses
 * into its case-insensitive getter. One `name: value` pair per line, joined
 * by CRLF — the wire format the upstream header parser expects.
 */
function serializeHeaders(headers: Headers): string {
  const lines: string[] = [];
  headers.forEach((value, name) => {
    lines.push(`${name}: ${value}`);
  });
  return lines.join('\r\n');
}

/**
 * Create a fetch-backed `$httpBackend`.
 *
 * Per call: build the `RequestInit` from the config (method / headers / body
 * / credentials / signal), `fetch`, read the body as text, serialize the
 * response headers, and RESOLVE the `$q` deferred with the
 * {@link RawResponse}. A fetch throw rejects with an `HttpTransportError` of
 * kind `'network'` UNLESS the signal already aborted, in which case the kind
 * is `'abort'` (browsers surface an abort as a thrown `AbortError`).
 *
 * @param args - The `$q` service plus an optional `fetch` seam.
 * @returns The `$httpBackend` transport callable.
 */
/** Monotonic counter feeding unique JSONP callback names across all requests. */
let jsonpCounter = 0;

export function createHttpBackend(args: CreateHttpBackendArgs): HttpBackend {
  const { q } = args;
  const fetchFn: FetchFn = args.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  // Feature-detect `document` for the JSONP transport. `undefined` (the seam
  // not supplied) falls back to the global; an explicit `null` (or a missing
  // global) means "no DOM" and a JSONP request rejects with a clear error.
  const documentRef: JsonpDocument | null =
    args.documentRef !== undefined
      ? args.documentRef
      : typeof document !== 'undefined'
        ? (document as unknown as JsonpDocument)
        : null;
  const globalRef: JsonpGlobal = args.globalRef ?? (globalThis as unknown as JsonpGlobal);

  /**
   * The `<script>`-tag JSONP transport (tech §2.3 / §2.7). A unique global
   * callback name is generated and substituted for the `JSON_CALLBACK`
   * placeholder in the URL (AngularJS parity); if no placeholder is present
   * the param `callback=<name>` is appended (`?`/`&` chosen by whether the URL
   * already has a query string). The callback captures the data + resolves the
   * deferred with a `RawResponse` (status 200); the script's `onerror`
   * rejects. EVERYTHING is cleaned up on settle — the `<script>` node is
   * removed and the global callback deleted — so no callback leaks across
   * requests. The `$sce` trusted-destination gate runs in `$http` BEFORE the
   * backend is ever reached, so by the time we inject a `<script>` the URL is
   * already trusted (FS §2.12).
   */
  function jsonpRequest(url: string, options: HttpBackendOptions): ReturnType<HttpBackend> {
    const deferred = q.defer<RawResponse>();

    if (documentRef === null) {
      deferred.reject(
        new HttpTransportError('network', 'JSONP requires a DOM (no `document` available in this environment)'),
      );
      return deferred.promise;
    }

    jsonpCounter += 1;
    const callbackName = `${JSONP_CALLBACK_PREFIX}${String(jsonpCounter)}`;
    let captured: unknown;
    let didCapture = false;
    let settled = false;

    const script = documentRef.createElement('script');
    const parent = documentRef.head ?? documentRef.body;

    // Substitute the generated callback name for the `JSON_CALLBACK`
    // placeholder; if the caller did not place one, append a `callback=`
    // param (the AngularJS default rule).
    const resolvedUrl = url.includes(JSONP_CALLBACK_PLACEHOLDER)
      ? url.split(JSONP_CALLBACK_PLACEHOLDER).join(callbackName)
      : `${url}${url.includes('?') ? '&' : '?'}callback=${callbackName}`;

    const cleanup = (): void => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- callback name is a generated, controlled key
      delete globalRef[callbackName];
      script.parentNode?.removeChild(script);
    };

    globalRef[callbackName] = (data: unknown): void => {
      captured = data;
      didCapture = true;
    };

    const onAbort = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      deferred.reject(new HttpTransportError('abort', 'Request aborted'));
    };

    // Honor an already-aborted signal AND future aborts (timeout / cancel).
    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        onAbort();
        return deferred.promise;
      }
      options.signal.addEventListener('abort', onAbort);
    }

    script.addEventListener('load', () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (didCapture) {
        deferred.resolve({ status: 200, statusText: 'OK', data: captured, headers: '' });
      } else {
        // The script loaded but never invoked the callback — treat as a JSONP
        // protocol failure (AngularJS surfaces this as a non-2xx; we reject
        // with a network sentinel so `$http` settles it as a failure).
        deferred.reject(new HttpTransportError('network', 'JSONP response did not invoke the callback'));
      }
    });

    script.addEventListener('error', () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      deferred.reject(new HttpTransportError('network', 'JSONP script failed to load'));
    });

    script.type = 'text/javascript';
    script.src = resolvedUrl;
    parent?.appendChild(script);

    return deferred.promise;
  }

  return (config: HttpConfig, options: HttpBackendOptions): ReturnType<HttpBackend> => {
    const method = (config.method ?? 'GET').toUpperCase();
    const url = config.url ?? '';

    if (method === 'JSONP') {
      return jsonpRequest(url, options);
    }

    const deferred = q.defer<RawResponse>();

    const init: RequestInit = {
      method,
      headers: config.headers ?? {},
    };
    // GET/HEAD must not carry a body — fetch throws if one is supplied.
    if (config.data !== undefined && config.data !== null && method !== 'GET' && method !== 'HEAD') {
      // `data` is already-serialized at this layer (transforms run in $http);
      // pass strings straight through, JSON-encode anything else defensively
      // (the proper transform pipeline lands in Slice 3).
      init.body = typeof config.data === 'string' ? config.data : JSON.stringify(config.data);
    }
    if (config.withCredentials === true) {
      init.credentials = 'include';
    }
    if (options.signal !== undefined) {
      init.signal = options.signal;
    }

    fetchFn(url, init).then(
      (response) => {
        response.text().then(
          (body) => {
            deferred.resolve({
              status: response.status,
              statusText: response.statusText,
              data: body,
              headers: serializeHeaders(response.headers),
            });
          },
          (err: unknown) => {
            // A body-read failure after the response arrived is still a
            // transport-level network failure from the caller's view.
            deferred.reject(new HttpTransportError('network', 'Failed to read response body', err));
          },
        );
      },
      (err: unknown) => {
        const aborted = options.signal?.aborted === true || (err instanceof Error && err.name === 'AbortError');
        deferred.reject(
          aborted
            ? new HttpTransportError('abort', 'Request aborted', err)
            : new HttpTransportError('network', 'Request failed to reach the server', err),
        );
      },
    );

    return deferred.promise;
  };
}
