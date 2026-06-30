/**
 * Public TypeScript types for the `@http` module (spec 038 Slice 2).
 *
 * `$http` is the framework's networking service: a callable that returns a
 * `$q` promise carrying a typed {@link HttpResponse}. Resolving that promise
 * schedules a digest for free (the `$q` → `$rootScope.$evalAsync` seam), so
 * content bound to the response data refreshes on its own — no manual
 * `$apply` (FS §2.1).
 *
 * This slice ships the general `$http<T>(config)` form plus the `get`
 * shortcut and the fetch-backed `$httpBackend` transport. The remaining
 * shortcuts, param serialization, header merge, JSON transforms, the
 * interceptor pipeline, XSRF, caching, and JSONP land in later slices — the
 * shapes here reserve their fields (`transformRequest` / `transformResponse`
 * / `paramSerializer` / `xsrf*` on {@link HttpDefaults}, `interceptors` on
 * the provider) so they can be lit up without a signature break.
 *
 * The file is intentionally type-only — no runtime imports beyond the `$q`
 * promise types — so it can be re-exported as `export type` from the public
 * barrel and the root barrel without dragging runtime code along.
 */

import type { QPromise } from '@async/q-types';
import type { Cache } from '@cache/cache-types';
import type { Invokable } from '@di/di-types';

/**
 * A case-insensitive accessor over the response headers (FS §2.1).
 *
 * Called with a header name, it returns that header's value (or `null` on a
 * miss); called with no argument, it returns a snapshot object of every
 * parsed header keyed by its lowercased name. Header lookup is
 * case-insensitive — `headers('Content-Type')` and `headers('content-type')`
 * resolve to the same value.
 *
 * @example
 * ```ts
 * $http.get<User>('/api/me').then((res) => {
 *   res.headers('Content-Type'); // => 'application/json'
 *   res.headers('content-type'); // => 'application/json' (case-insensitive)
 *   res.headers();               // => { 'content-type': 'application/json', … }
 * });
 * ```
 */
export interface HttpHeadersGetter {
  (): Record<string, string>;
  (name: string): string | null;
}

/**
 * A map of header name → value, as supplied per request or as application
 * defaults. Values are the literal strings sent on the wire.
 */
export type HttpHeaders = Record<string, string>;

/**
 * A query-parameter serializer (FS §2.5). Receives the structured `params`
 * object and returns the escaped query string (no leading `?`). The default
 * ({@link HttpDefaults.paramSerializer}) and a per-request override
 * ({@link HttpConfig.paramSerializer}) both use this shape.
 */
export type ParamSerializer = (params: Record<string, unknown> | undefined) => string;

/**
 * A request-body transform step (FS §2.6 / §2.9). Receives the running body
 * plus the MUTABLE request-headers bag (so a step may set `Content-Type`) and
 * returns the next body. Transforms run as an array, folded left-to-right.
 */
export type RequestTransform = (data: unknown, headers: HttpHeaders) => unknown;

/**
 * A response-body transform step (FS §2.6 / §2.9). Receives the running body,
 * the case-insensitive response-headers getter, and the numeric status, and
 * returns the next body. Transforms run as an array, folded left-to-right.
 */
export type ResponseTransform = (data: unknown, headers: HttpHeadersGetter, status: number) => unknown;

/**
 * The request description handed to `$http` (FS §2.3).
 *
 * Generic over the success-body type `T` so the returned
 * {@link HttpResponse}`<T>` is typed end-to-end. Unspecified options fall
 * back to the application-wide {@link HttpDefaults}.
 *
 * Several fields (`params` / `transformRequest` / `transformResponse` /
 * `paramSerializer` / `xsrf*`) are reserved for later slices — present here
 * so the typed-config contract is stable, but only `method` / `url` / `data`
 * / `headers` / `responseType` / `withCredentials` / `timeout` are wired this
 * slice.
 *
 * @typeParam T - The expected type of the response body on success.
 */
export interface HttpConfig<T = unknown> {
  /** HTTP method (e.g. `'GET'` / `'POST'`). Defaults to `'GET'`. */
  method?: string;
  /** The destination URL. */
  url?: string;
  /** The request body to send (body-carrying methods). */
  data?: unknown;
  /** Per-request headers, merged over the application defaults. */
  headers?: HttpHeaders;
  /** Structured query parameters, serialized onto the URL (FS §2.5). */
  params?: Record<string, unknown>;
  /**
   * Per-request query-parameter serializer, overriding
   * {@link HttpDefaults.paramSerializer} for this request only (FS §2.5).
   */
  paramSerializer?: ParamSerializer;
  /**
   * Per-request request-body transform(s) — a single function or an array.
   * REPLACES the application default for this request (FS §2.9).
   */
  transformRequest?: RequestTransform | readonly RequestTransform[];
  /**
   * Per-request response-body transform(s) — a single function or an array.
   * REPLACES the application default for this request (FS §2.9).
   */
  transformResponse?: ResponseTransform | readonly ResponseTransform[];
  /** How the response body should be interpreted (`fetch`'s body reader). */
  responseType?: string;
  /** Whether credentials are included on cross-origin calls. */
  withCredentials?: boolean;
  /**
   * A numeric (ms) time limit after which the request is aborted, or a
   * cancellation {@link QPromise} that aborts the request when it settles
   * (FS §2.8). An aborted request fails the result and stops the underlying
   * `fetch` via its `AbortSignal`.
   */
  timeout?: number | QPromise<unknown>;
  /**
   * Opt this request into response caching (FS §2.13). A {@link Cache} object
   * caches into that store; `true` uses `$http`'s lazily-created default
   * cache. Caching applies to GET only — on a hit the stored response is
   * served WITHOUT a network call, and two concurrent identical cacheable
   * GETs share a single outstanding call. Off by default (omit the field).
   */
  cache?: Cache<HttpResponse> | boolean;
  /**
   * Phantom marker tying this config to its success-body type `T`. Never
   * read at runtime — it exists so `$http(config)` can infer `T` from a
   * caller-annotated `HttpConfig<User>` without an explicit type argument.
   */
  readonly __responseType?: T;
}

/**
 * The bundle delivered to the success follow-up (and, same-shaped, to the
 * failure follow-up) (FS §2.1 / §2.7).
 *
 * @typeParam T - The type of the response body.
 *
 * @example
 * ```ts
 * $http<User>({ method: 'GET', url: '/api/me' }).then((res) => {
 *   res.data;       // User
 *   res.status;     // 200
 *   res.statusText; // 'OK'
 *   res.headers('Content-Type');
 *   res.config;     // the originating request description
 * });
 * ```
 */
export interface HttpResponse<T = unknown> {
  /** The (optionally transformed) response body. */
  data: T;
  /**
   * The numeric HTTP status. A request that never reached the server (a
   * network failure) carries `-1` to make it distinguishable from any
   * server-reported status (FS §2.7).
   */
  status: number;
  /** The status description (e.g. `'OK'` / `'Not Found'`). */
  statusText: string;
  /** Case-insensitive accessor over the response headers. */
  headers: HttpHeadersGetter;
  /** The merged request description that produced this response. */
  config: HttpConfig<T>;
}

/**
 * The application-wide defaults bag held on `$HttpProvider.defaults`
 * (FS §2.4). Public and mutable from config blocks (AngularJS parity — NOT
 * `$$`-prefixed).
 *
 * This slice wires `headers`, `paramSerializer`, and the JSON
 * `transformRequest` / `transformResponse` defaults; the xsrf fields are
 * reserved for a later slice so the public shape is stable.
 */
export interface HttpDefaults {
  /**
   * Default headers, layered by applicability: `common` (every request) plus
   * a per-method bag (e.g. `post` headers only on body-carrying requests).
   */
  headers: {
    common: HttpHeaders;
    get?: HttpHeaders;
    post?: HttpHeaders;
    put?: HttpHeaders;
    patch?: HttpHeaders;
    delete?: HttpHeaders;
    head?: HttpHeaders;
    [method: string]: HttpHeaders | undefined;
  };
  /**
   * The default query-parameter serializer (FS §2.5). Swappable
   * application-wide; a per-request `config.paramSerializer` overrides it.
   */
  paramSerializer?: ParamSerializer;
  /**
   * The default request-body transform(s) — a single function or an array
   * (AngularJS parity). The shipped default JSON-serializes a structured body
   * and sets a JSON `Content-Type` (FS §2.6).
   */
  transformRequest?: RequestTransform | readonly RequestTransform[];
  /**
   * The default response-body transform(s) — a single function or an array.
   * The shipped default `JSON.parse`s a JSON-looking body (FS §2.6).
   */
  transformResponse?: ResponseTransform | readonly ResponseTransform[];
  /**
   * The cookie name the per-session XSRF token is read from (FS §2.11).
   * Config-phase settable; default `'XSRF-TOKEN'`. The token is echoed back
   * in {@link HttpDefaults.xsrfHeaderName} on same-origin requests only.
   */
  xsrfCookieName?: string;
  /**
   * The request header the XSRF token is echoed back in (FS §2.11).
   * Config-phase settable; default `'X-XSRF-TOKEN'`.
   */
  xsrfHeaderName?: string;
  /** Reserved — default credentials behavior (later slice). */
  withCredentials?: boolean;
}

/**
 * The raw, untransformed transport result handed back by {@link HttpBackend}
 * (spec 038 §2.3). Status classification (2xx vs. non-2xx) and response
 * transforms happen in `$http`, NOT the backend — the backend resolves with
 * this shape for EVERY HTTP response (including non-2xx) and only rejects
 * when the request never reached the server (network failure) or was
 * aborted.
 */
export interface RawResponse {
  /** The numeric HTTP status. */
  status: number;
  /** The status description. */
  statusText: string;
  /** The raw response body (text by default, or per `responseType`). */
  data: unknown;
  /** The raw header string, parsed into a getter by `$http`. */
  headers: string;
}

/**
 * Per-send options passed to {@link HttpBackend} alongside the config —
 * currently the `AbortSignal` driving cancellation (the controller is owned
 * by `$http`, the backend only consumes its signal).
 */
export interface HttpBackendOptions {
  /** The abort signal wired to `fetch`'s `signal` for cancellation. */
  signal?: AbortSignal;
}

/**
 * The transport seam (spec 038 §2.3). `$http` calls it with the resolved
 * config + an abort signal; it returns a `$q` promise that RESOLVES with a
 * {@link RawResponse} for every HTTP response (does NOT reject on non-2xx)
 * and REJECTS with a transport sentinel ({@link HttpTransportError}) only on
 * a network failure or abort.
 *
 * `$httpBackend` is the mock seam — a future `ngMock` overrides it via a
 * decorator, and tests stub it directly.
 */
export type HttpBackend = (config: HttpConfig, options: HttpBackendOptions) => QPromise<RawResponse>;

/**
 * The kind of transport-level failure carried by {@link HttpTransportError}.
 *
 * - `'network'` — the request never reached the server (fetch threw).
 * - `'abort'` — the request was cancelled / timed out.
 */
export type HttpTransportErrorKind = 'network' | 'abort';

/**
 * A resolved interceptor object (FS §2.10). Each method is optional; a
 * registered interceptor exposes any subset of the four hooks:
 *
 * - `request(config)` — observe / modify the OUTGOING config before the
 *   backend send. May return the config synchronously or a
 *   `QPromise<config>` (awaited). Runs OUTWARD→INWARD: the LAST-registered
 *   interceptor's `request` runs FIRST (AngularJS reverses the request
 *   phase).
 * - `requestError(rejection)` — observe a rejection produced by an EARLIER
 *   (outer) request handler. Re-reject to keep failing, or return a config
 *   to recover.
 * - `response(response)` — observe / modify the INCOMING response before the
 *   caller's success follow-up. May return synchronously or a
 *   `QPromise<response>` (awaited). Runs INNER→OUTER: the FIRST-registered
 *   interceptor's `response` runs LAST.
 * - `responseError(rejection)` — observe a failure (a non-2xx / network
 *   {@link HttpResponse}, or a rejection from an inner response handler).
 *   Re-reject to keep failing, or RETURN a value to RECOVER into a success.
 *
 * The pipeline `.then`-chains these handlers, so an async handler (returning
 * a `QPromise`) is awaited before the next stage runs.
 *
 * @example
 * ```ts
 * const authInterceptor: Interceptor = {
 *   request(config) {
 *     config.headers = { ...config.headers, Authorization: 'Bearer t' };
 *     return config;
 *   },
 *   responseError(rejection) {
 *     // recover a 401 into a canned empty success:
 *     return { data: null, status: 200, statusText: 'OK', headers, config };
 *   },
 * };
 * ```
 */
export interface Interceptor {
  /** Observe / modify the outgoing config (outward→inward). */
  request?(config: HttpConfig): HttpConfig | QPromise<HttpConfig>;
  /** Observe a rejection from an earlier (outer) request handler. */
  requestError?(rejection: unknown): HttpConfig | QPromise<HttpConfig>;
  /** Observe / modify the incoming response (inner→outer). */
  response?(response: HttpResponse): HttpResponse | QPromise<HttpResponse>;
  /** Observe a failure; return a value to RECOVER, re-reject to keep failing. */
  responseError?(rejection: unknown): HttpResponse | QPromise<HttpResponse>;
}

/**
 * A factory that produces an {@link Interceptor} (FS §2.10). Registered on
 * `$HttpProvider.interceptors` either as a factory NAME (a string resolved
 * via `$injector.get(name)`) or as a factory FUNCTION (resolved via
 * `$injector.invoke(fn)`) — both resolved ONCE at `$get` time. The function
 * form is an injector {@link Invokable}, so it may be an array-annotated
 * `['$q', ($q) => ({ … })]` or a bare / `$inject`-annotated function.
 */
export type InterceptorFactory = string | Invokable<Interceptor>;

/**
 * The `$http` service surface (FS §2.1 / §2.2).
 *
 * The general callable form plus the `get` shortcut (this slice). Later
 * slices add `delete` / `head` / `post` / `put` / `patch` / `jsonp`, the
 * mutable `defaults`, and the observational `pendingRequests` array.
 *
 * @example
 * ```ts
 * const $http: HttpService = injector.get('$http');
 *
 * // General form:
 * $http<User>({ method: 'GET', url: '/api/me' }).then((res) => res.data);
 *
 * // Shortcut:
 * $http.get<User>('/api/me').then((res) => res.data);
 * ```
 */
export interface HttpService {
  /**
   * Issue a request from a full description and obtain a digest-aware,
   * typed result.
   *
   * @typeParam T - The expected response-body type on success.
   * @param config - The request description.
   * @returns A `$q` promise of the typed {@link HttpResponse}.
   */
  <T = unknown>(config: HttpConfig<T>): QPromise<HttpResponse<T>>;

  /**
   * GET shortcut — issue a bodyless GET to `url` with optional config
   * overrides.
   *
   * @typeParam T - The expected response-body type on success.
   * @param url - The destination URL.
   * @param config - Optional per-request overrides (method/url are forced).
   * @returns A `$q` promise of the typed {@link HttpResponse}.
   */
  get<T = unknown>(url: string, config?: HttpConfig<T>): QPromise<HttpResponse<T>>;

  /**
   * DELETE shortcut — bodyless. Issues a DELETE to `url`.
   *
   * @typeParam T - The expected response-body type on success.
   */
  delete<T = unknown>(url: string, config?: HttpConfig<T>): QPromise<HttpResponse<T>>;

  /**
   * HEAD shortcut — bodyless. Issues a HEAD to `url`.
   *
   * @typeParam T - The expected response-body type on success.
   */
  head<T = unknown>(url: string, config?: HttpConfig<T>): QPromise<HttpResponse<T>>;

  /**
   * JSONP shortcut — the legacy cross-origin `<script>`-tag action (FS §2.2 /
   * §2.12). Issues a `method: 'JSONP'` request to `url`; the URL is HARD-GATED
   * through `$sce.getTrustedResourceUrl` BEFORE any `<script>` is injected, so
   * an untrusted destination is refused (the call rejects/throws) with NO
   * network activity. The caller writes the `JSON_CALLBACK` placeholder into
   * the URL where the generated callback name should be substituted (if
   * absent, a `callback=<name>` param is appended).
   *
   * @typeParam T - The expected response-body type on success.
   */
  jsonp<T = unknown>(url: string, config?: HttpConfig<T>): QPromise<HttpResponse<T>>;

  /**
   * POST shortcut — body-carrying. Issues a POST to `url` with `data`.
   *
   * @typeParam T - The expected response-body type on success.
   */
  post<T = unknown>(url: string, data: unknown, config?: HttpConfig<T>): QPromise<HttpResponse<T>>;

  /**
   * PUT shortcut — body-carrying. Issues a PUT to `url` with `data`.
   *
   * @typeParam T - The expected response-body type on success.
   */
  put<T = unknown>(url: string, data: unknown, config?: HttpConfig<T>): QPromise<HttpResponse<T>>;

  /**
   * PATCH shortcut — body-carrying. Issues a PATCH to `url` with `data`.
   *
   * @typeParam T - The expected response-body type on success.
   */
  patch<T = unknown>(url: string, data: unknown, config?: HttpConfig<T>): QPromise<HttpResponse<T>>;

  /** The mutable application-wide defaults (frozen-as-config at `$get`). */
  readonly defaults: HttpDefaults;

  /**
   * The set of requests currently in flight (FS §2.14). The (resolved)
   * config is pushed when a request is sent and spliced out when it settles
   * (success OR failure). Observational only — useful for a busy indicator or
   * asserting quiescence in a test. Never reorder or mutate entries by hand.
   */
  readonly pendingRequests: HttpConfig[];
}
