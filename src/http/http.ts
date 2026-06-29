/**
 * `$http` core — the request pipeline (spec 038 Slice 2 / §2.4).
 *
 * `createHttp({ q, httpBackend, defaults })` returns the `$http` callable: a
 * general `$http<T>(config)` form plus a `get` shortcut (this slice). Per
 * request it merges the config over the application {@link HttpDefaults},
 * sends via the {@link HttpBackend} transport, classifies the status (2xx →
 * success / non-2xx → failure), builds a typed {@link HttpResponse} (with a
 * case-insensitive `headers` getter parsed from the raw header string), and
 * resolves / rejects a `$q` deferred. Resolving schedules a digest for free
 * via `$q`'s `$rootScope.$evalAsync` seam — `$http` NEVER calls `$apply`
 * (FS §2.1).
 *
 * A network failure (the backend rejects with a {@link HttpTransportError}
 * of kind `'network'`) settles the result as a failure with `status: -1`,
 * making it distinguishable from any server-reported failure (FS §2.7).
 *
 * The factory is PURE — it takes the `$q` service, the backend, the defaults
 * bag, and the (already-resolved) interceptor objects as injected seams, so it
 * is unit-testable standalone with a stubbed backend (no injector, no
 * network). The interceptor pipeline (spec 038 Slice 4 / §2.10) wraps the
 * extracted inner `serverRequest` as a single `$q` chain: request handlers
 * fold OUTWARD→INWARD before the send, response handlers INNER→OUTER after;
 * `requestError` / `responseError` recover (return) or keep failing
 * (re-reject); async handlers (returning a `QPromise`) are awaited via
 * `.then`-chaining. Later slices thread XSRF, caching, and JSONP through the
 * same pipeline.
 *
 * @example
 * ```ts
 * import { createHttp } from 'my-own-angularjs/http';
 *
 * const $http = createHttp({ q: $q, httpBackend, defaults });
 * $http.get<User>('/api/me').then((res) => res.data); // digest runs on its own
 * ```
 */

import type { QPromise, QService } from '@async/q-types';
import type { Cache, CacheFactory } from '@cache/cache-types';
import { isHttpTransportError } from './http-backend';
import { mergeHeaders, parseHeaders } from './http-headers';
import { buildUrl, paramSerializer as defaultParamSerializer } from './http-params';
import {
  applyRequestTransforms,
  applyResponseTransforms,
  defaultTransformRequest,
  defaultTransformResponse,
  resolveTransforms,
} from './http-transforms';
import {
  applyXsrfHeader,
  DEFAULT_XSRF_COOKIE_NAME,
  DEFAULT_XSRF_HEADER_NAME,
  defaultCookieReader,
  type CookieReader,
} from './http-xsrf';
import type {
  HttpBackend,
  HttpConfig,
  HttpDefaults,
  HttpHeaders,
  HttpResponse,
  HttpService,
  Interceptor,
  RawResponse,
  ResponseTransform,
} from './http-types';

/**
 * The numeric status carried by a {@link HttpResponse} for a request that
 * never reached the server (FS §2.7). Distinct from any real HTTP status so
 * callers can branch on `res.status === -1`.
 */
const NETWORK_FAILURE_STATUS = -1;

/**
 * Arguments accepted by {@link createHttp}.
 */
export interface CreateHttpArgs {
  /** The `$q` service — its promises make digest integration free. */
  readonly q: QService;
  /** The transport seam (`$httpBackend`). */
  readonly httpBackend: HttpBackend;
  /** The application-wide defaults (provider-owned, frozen at `$get`). */
  readonly defaults: HttpDefaults;
  /**
   * The resolved interceptor objects, in REGISTRATION order (FS §2.10). The
   * provider resolves the `$HttpProvider.interceptors` entries (factory names
   * via `$injector.get`, factory functions via `$injector.invoke`) ONCE at
   * `$get` time and threads the resulting objects here. The request phase
   * folds them OUTWARD→INWARD (last-registered's `request` runs first) and the
   * response phase INNER→OUTER (first-registered's `response` runs last) —
   * see the `$q`-chain composition in {@link createHttp}. Omitted in the
   * pure-factory unit tests that don't exercise interceptors.
   */
  readonly interceptors?: readonly Interceptor[];
  /**
   * The `$cacheFactory` service — used to lazily create the application-wide
   * default response cache (`$cacheFactory('$http')`) for requests that opt in
   * with `cache: true` (FS §2.13). Optional in the pure-factory unit tests
   * that pass an explicit `Cache` object (or never cache).
   */
  readonly cacheFactory?: CacheFactory;
  /**
   * The `$$cookieReader` seam used by the XSRF step to read
   * `document.cookie` (FS §2.11). Defaults to {@link defaultCookieReader}
   * (feature-detects `document`); tests inject a stub.
   */
  readonly cookieReader?: CookieReader;
  /**
   * Arms a one-off timer for a numeric `config.timeout`, returning a handle
   * passed to {@link CreateHttpArgs.clearTimer} on settle. Defaults to the
   * global `setTimeout`; tests use vitest fake timers. The `scope.ts` /
   * `timeout.ts` global-timer-seam precedent.
   */
  readonly setTimer?: (fn: () => void, delay: number) => unknown;
  /** Clears a handle armed by {@link CreateHttpArgs.setTimer}. */
  readonly clearTimer?: (handle: unknown) => void;
  /**
   * Optional explicit base URL for the XSRF same-origin gate. Defaults to
   * `document.baseURI`; tests pass an explicit origin so the gate is
   * deterministic without a real document base.
   */
  readonly xsrfBaseUrl?: string;
  /**
   * The JSONP trusted-destination gate (FS §2.12 / tech §2.7). Run BEFORE the
   * backend send for `method: 'JSONP'` requests — returns the trusted URL or
   * THROWS synchronously for an untrusted destination, so NO `<script>` is
   * ever injected for an untrusted URL. `$HttpProvider.$get` supplies this via
   * the lazy `$injector.has('$sce')` probe (the `ng-include` precedent):
   * present `$sce` → `(url) => $sce.getTrustedResourceUrl(url)`; absent (a
   * stripped injector) → omitted, so JSONP URLs pass through. Omitted in the
   * pure-factory unit tests that don't exercise JSONP gating.
   */
  readonly jsonpTrust?: (url: string) => string;
}

/**
 * Decide whether an HTTP status counts as a success (FS §2.7). 2xx is a
 * success; AngularJS additionally treats status `0` (a same-origin
 * file-protocol / opaque response that nonetheless produced a body) as a
 * success — mirrored here for parity.
 */
function isSuccessStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 0;
}

export function createHttp(args: CreateHttpArgs): HttpService {
  const { q, httpBackend, defaults } = args;
  const interceptors = args.interceptors ?? [];
  const cookieReader = args.cookieReader ?? defaultCookieReader;
  const setTimer = args.setTimer ?? ((fn, delay) => setTimeout(fn, delay));
  const clearTimer =
    args.clearTimer ??
    ((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  // The observable in-flight set (FS §2.14) — pushed on send, spliced on settle.
  const pendingRequests: HttpConfig[] = [];

  // Concurrent-identical-GET dedup (FS §2.13) — the `$templateRequest`
  // `inFlight: Map` precedent. Keyed by the fully-serialized URL; the entry is
  // cleared on settle so a later request re-sends.
  const inFlight = new Map<string, QPromise<HttpResponse>>();

  // The application-wide default response cache, created lazily on the first
  // `cache: true` GET (FS §2.13). Off until something opts in.
  let defaultCache: Cache<HttpResponse> | undefined;
  function getDefaultCache(): Cache<HttpResponse> | undefined {
    if (defaultCache === undefined && args.cacheFactory !== undefined) {
      defaultCache = args.cacheFactory<HttpResponse>('$http');
    }
    return defaultCache;
  }

  /**
   * Resolve the effective cache for a request: a `Cache` object is used as-is;
   * `true` resolves the lazily-created default cache; anything falsy → no
   * caching. Caching applies to GET only (the caller passes the method).
   */
  function resolveCache(method: string, configCache: HttpConfig['cache']): Cache<HttpResponse> | undefined {
    if (method !== 'GET' || configCache === undefined || configCache === false) {
      return undefined;
    }
    return configCache === true ? getDefaultCache() : configCache;
  }

  /**
   * Clone a cached {@link HttpResponse} so a caller mutating the delivered
   * bundle cannot corrupt the stored entry (or a sibling sharing the cache).
   * `headers` is a closure getter, so it is reused as-is (it reads a private
   * parsed snapshot); `data` / `config` are shallow-copied.
   */
  function cloneResponse<T>(stored: HttpResponse): HttpResponse<T> {
    return {
      data: stored.data as T,
      status: stored.status,
      statusText: stored.statusText,
      headers: stored.headers,
      config: { ...stored.config } as HttpConfig<T>,
    };
  }

  /**
   * The inner server-send stage — the transform + serialize + backend +
   * response-transform + classify pipeline, extracted so the interceptor
   * `$q` chain can wrap it (FS §2.10). Receives the (already
   * interceptor-processed) request config and returns a `$q` promise of the
   * typed {@link HttpResponse}, resolving on a 2xx classification and
   * rejecting with the same-shaped failure bundle otherwise.
   */
  function serverRequest<T>(requestConfig: HttpConfig<T>): QPromise<HttpResponse<T>> {
    const deferred = q.defer<HttpResponse<T>>();

    const method = (requestConfig.method ?? 'GET').toUpperCase();

    // 0. JSONP trusted-destination hard gate (FS §2.12 / §3). For a JSONP
    //    request, route the URL through `$sce.getTrustedResourceUrl` BEFORE any
    //    backend / DOM activity — an untrusted URL THROWS here, so no
    //    `<script>` is ever injected and the deferred rejects with the throw.
    //    There is no opt-out; the gate runs whenever `jsonpTrust` is wired
    //    (the provider wires it iff `$sce` is reachable — a stripped injector
    //    lacking `$sce` passes JSONP URLs through, mirroring `ng-include`).
    if (method === 'JSONP' && args.jsonpTrust !== undefined && requestConfig.url !== undefined) {
      try {
        const trustedUrl = args.jsonpTrust(requestConfig.url);
        requestConfig = { ...requestConfig, url: trustedUrl };
      } catch (error: unknown) {
        deferred.reject(error);
        return deferred.promise;
      }
    }

    // 1. Merge headers: common + per-method + per-request (request wins,
    //    case-insensitive). The merged bag is mutable so the request
    //    transforms can set `Content-Type` on a JSON body.
    const headers: HttpHeaders = mergeHeaders(defaults, method, requestConfig.headers);

    // 2. Run request transforms (default: JSON-serialize a structured body +
    //    set the JSON content-type; strings pass through). A per-request
    //    `transformRequest` replaces the default. A throwing transform
    //    rejects the promise — NOT routed through `$exceptionHandler`.
    let data: unknown;
    try {
      const requestTransforms = resolveTransforms(
        defaults.transformRequest ?? defaultTransformRequest,
        requestConfig.transformRequest,
      );
      data = applyRequestTransforms(requestTransforms, requestConfig.data, headers);
    } catch (error: unknown) {
      deferred.reject(error);
      return deferred.promise;
    }

    // 3. Serialize `params` onto the URL via the configured serializer. The
    //    fully-serialized URL is the cache key + the XSRF same-origin subject.
    const serialize = requestConfig.paramSerializer ?? defaults.paramSerializer ?? defaultParamSerializer;
    const baseUrl = requestConfig.url ?? '';
    const url = requestConfig.params !== undefined ? buildUrl(baseUrl, serialize(requestConfig.params)) : baseUrl;

    // 4. XSRF (FS §2.11): attach the cookie token as the configured header,
    //    but ONLY for same-origin requests (the `isSameOrigin` gate inside
    //    `applyXsrfHeader` never leaks the token cross-origin). Names are read
    //    lazily off `defaults` so a config block's mutation is honored.
    applyXsrfHeader({
      headers,
      url,
      cookieName: defaults.xsrfCookieName ?? DEFAULT_XSRF_COOKIE_NAME,
      headerName: defaults.xsrfHeaderName ?? DEFAULT_XSRF_HEADER_NAME,
      cookieReader,
      baseUrl: args.xsrfBaseUrl,
    });

    const mergedConfig: HttpConfig<T> = {
      ...requestConfig,
      method,
      url,
      headers,
      data,
    };

    // 5. Cache check (FS §2.13, GET only). A hit serves a CLONE immediately
    //    (callers can't corrupt the stored entry); a concurrent in-flight
    //    request shares the single outstanding promise (dedup).
    const cache = resolveCache(method, requestConfig.cache);
    if (cache !== undefined) {
      const cached = cache.get(url);
      if (cached !== undefined) {
        deferred.resolve(cloneResponse<T>(cached));
        return deferred.promise;
      }
      const shared = inFlight.get(url);
      if (shared !== undefined) {
        shared.then(
          (response) => {
            deferred.resolve(cloneResponse<T>(response));
          },
          (reason: unknown) => {
            deferred.reject(reason);
          },
        );
        return deferred.promise;
      }
      // First cacheable request for this URL — register the shared promise so
      // concurrent callers ride it; clear the entry on settle.
      inFlight.set(url, deferred.promise as QPromise<HttpResponse>);
      deferred.promise.then(
        () => {
          inFlight.delete(url);
        },
        () => {
          inFlight.delete(url);
        },
      );
    }

    // 6. Visibility (FS §2.14): the request is now being sent — track it, and
    //    splice it out whenever the deferred settles (success OR failure).
    pendingRequests.push(mergedConfig);
    const dropPending = (): void => {
      const index = pendingRequests.indexOf(mergedConfig);
      if (index !== -1) {
        pendingRequests.splice(index, 1);
      }
    };

    // 7. Cancellation / timeout (FS §2.8): one `AbortController` per request.
    //    A numeric `timeout` arms a timer that aborts; a `QPromise` timeout
    //    aborts when it settles. The controller's `signal` drives `fetch`. An
    //    abort rejects the deferred; a deferred that already settled IGNORES
    //    the abort ($q makes settlement final).
    const controller = new AbortController();
    let timerHandle: unknown;
    const { timeout } = requestConfig;
    if (typeof timeout === 'number') {
      timerHandle = setTimer(() => {
        controller.abort();
      }, timeout);
    } else if (timeout !== undefined) {
      timeout.then(
        () => {
          controller.abort();
        },
        () => {
          controller.abort();
        },
      );
    }
    const clearArmedTimer = (): void => {
      if (timerHandle !== undefined) {
        clearTimer(timerHandle);
        timerHandle = undefined;
      }
    };

    // Settle bookkeeping shared by both backend branches: drop the pending
    // entry and disarm the timer. The cache write happens on the success path.
    const onSettled = (): void => {
      dropPending();
      clearArmedTimer();
    };

    httpBackend(mergedConfig, { signal: controller.signal }).then(
      (raw: RawResponse) => {
        onSettled();
        const responseHeaders = parseHeaders(raw.headers);

        let body: unknown;
        try {
          // 8. Run response transforms (default: JSON-parse a JSON-looking
          //    body). A per-request `transformResponse` replaces the default.
          const responseTransforms = resolveTransforms<ResponseTransform>(
            defaults.transformResponse ?? defaultTransformResponse,
            requestConfig.transformResponse,
          );
          body = applyResponseTransforms(responseTransforms, raw.data, responseHeaders, raw.status);
        } catch (error: unknown) {
          deferred.reject(error);
          return;
        }

        const response: HttpResponse<T> = {
          data: body as T,
          status: raw.status,
          statusText: raw.statusText,
          headers: responseHeaders,
          config: mergedConfig,
        };

        if (isSuccessStatus(raw.status)) {
          // 9. Store a 2xx success in the cache (a clone, so the stored entry
          //    is independent of the bundle the caller receives + mutates).
          if (cache !== undefined) {
            cache.put(url, cloneResponse(response));
          }
          deferred.resolve(response);
        } else {
          deferred.reject(response);
        }
      },
      (reason: unknown) => {
        onSettled();
        // A transport sentinel: build a same-shaped failure bundle so the
        // caller inspects `status` / `data` uniformly. A network failure is
        // marked `status: -1` (distinguishable from a server error). An abort
        // (timeout / manual cancel) also surfaces as a transport failure.
        if (isHttpTransportError(reason)) {
          const failure: HttpResponse<T> = {
            data: null as T,
            status: NETWORK_FAILURE_STATUS,
            statusText: '',
            headers: parseHeaders(''),
            config: mergedConfig,
          };
          deferred.reject(failure);
        } else {
          // Defensive: a non-transport rejection passes through unchanged.
          deferred.reject(reason);
        }
      },
    );

    return deferred.promise;
  }

  function http<T = unknown>(requestConfig: HttpConfig<T>): QPromise<HttpResponse<T>> {
    // Fast path: with NO interceptors registered, send straight through the
    // inner server pipeline. This keeps the backend dispatch synchronous for
    // the common case (the Slice-2/3 contract — the backend is hit on the
    // call itself, not after a digest) and avoids spinning an empty `$q`
    // chain. When interceptors exist, the AngularJS-parity async chain below
    // engages.
    if (interceptors.length === 0) {
      return serverRequest<T>(requestConfig);
    }

    // Compose the interceptor pipeline as a SINGLE `$q` chain around
    // `serverRequest`, matching AngularJS's `$http` exactly (FS §2.10):
    //
    //   $q.resolve(config)
    //     → [request / requestError]*  (REQUEST phase)
    //     → serverRequest              (the backend send + transforms)
    //     → [response / responseError]* (RESPONSE phase)
    //
    // ORDERING (AngularJS parity — pinned by a test):
    //   AngularJS builds a single `reversedInterceptors` array (each
    //   registered interceptor `unshift`ed, so registration order [A, B]
    //   becomes [B, A]) and folds BOTH phases over THAT same reversed array:
    //     for each in reversed: promise = promise.then(request, requestError)
    //     promise = promise.then(serverSend)
    //     for each in reversed: promise = promise.then(response, responseError)
    //   We mirror it by iterating the registration list in REVERSE for BOTH
    //   phases and `.then`-appending:
    //   • REQUEST phase OUTWARD→INWARD: the LAST-registered interceptor's
    //     `request` is appended first, so it runs FIRST (outermost), then the
    //     earlier-registered ones, then the backend send.
    //   • RESPONSE phase INNER→OUTER: with the SAME reverse iteration, the
    //     LAST-registered interceptor's `response` is appended first (runs
    //     first = innermost) and the FIRST-registered's `response` is appended
    //     last (runs LAST = outermost).
    //
    // Each handler may return synchronously or a `QPromise`; `.then`-chaining
    // awaits the async form before the next stage. `requestError` /
    // `responseError` recover (return a value) or keep failing (re-reject) —
    // they ARE the rejection branch of `.then`.

    // The chain's value type necessarily widens (config → response), so it is
    // threaded as `unknown` through the fold and narrowed at the boundaries.
    let chain: QPromise<unknown> = q.resolve<HttpConfig<T>>(requestConfig);

    // REQUEST phase — reverse iteration so the last-registered runs first.
    // Methods are invoked ON the interceptor object (`interceptor.request(…)`)
    // so each handler's `this` stays bound to its own interceptor.
    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      if (interceptor === undefined) {
        continue;
      }
      if (interceptor.request !== undefined || interceptor.requestError !== undefined) {
        chain = chain.then(
          interceptor.request === undefined
            ? undefined
            : (config: unknown) => interceptor.request?.(config as HttpConfig),
          interceptor.requestError === undefined
            ? undefined
            : (rejection: unknown) => interceptor.requestError?.(rejection),
        );
      }
    }

    // Backend send — the extracted inner pipeline.
    chain = chain.then((config: unknown) => serverRequest<T>(config as HttpConfig<T>));

    // RESPONSE phase — reverse iteration (same as the request phase) so the
    // first-registered interceptor's `response` is appended LAST and runs
    // outermost (INNER→OUTER), matching AngularJS's single reversed array.
    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      if (interceptor === undefined) {
        continue;
      }
      if (interceptor.response !== undefined || interceptor.responseError !== undefined) {
        chain = chain.then(
          interceptor.response === undefined
            ? undefined
            : (response: unknown) => interceptor.response?.(response as HttpResponse),
          interceptor.responseError === undefined
            ? undefined
            : (rejection: unknown) => interceptor.responseError?.(rejection),
        );
      }
    }

    return chain as QPromise<HttpResponse<T>>;
  }

  // Bodyless shortcuts — destination + optional config; method forced.
  function bodylessShortcut(method: string) {
    return <T = unknown>(url: string, config?: HttpConfig<T>): QPromise<HttpResponse<T>> =>
      http<T>({ ...config, method, url });
  }

  // Body-carrying shortcuts — destination + body + optional config.
  function bodyShortcut(method: string) {
    return <T = unknown>(url: string, data: unknown, config?: HttpConfig<T>): QPromise<HttpResponse<T>> =>
      http<T>({ ...config, method, url, data });
  }

  http.get = bodylessShortcut('GET');
  http.delete = bodylessShortcut('DELETE');
  http.head = bodylessShortcut('HEAD');
  http.jsonp = bodylessShortcut('JSONP');
  http.post = bodyShortcut('POST');
  http.put = bodyShortcut('PUT');
  http.patch = bodyShortcut('PATCH');

  Object.defineProperty(http, 'defaults', {
    value: defaults,
    enumerable: true,
  });

  // The observational in-flight set (FS §2.14). Exposed as the live array so a
  // busy indicator / test can read `.length`; entries are managed internally.
  Object.defineProperty(http, 'pendingRequests', {
    value: pendingRequests,
    enumerable: true,
  });

  return http as HttpService;
}
