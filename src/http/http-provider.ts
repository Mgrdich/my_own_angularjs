/**
 * `$HttpProvider` — config-phase configurator for the `$http` service
 * (spec 038 Slice 2 / §2.13).
 *
 * Holds the PUBLIC, mutable {@link HttpDefaults} and `interceptors` fields
 * that config blocks mutate (AngularJS parity — these are NOT `$$`-prefixed,
 * because the app is meant to write them: `config(['$httpProvider', p =>
 * p.defaults.headers.common.Authorization = '…'])`). `$get` freezes the
 * config (the `$SceProvider.$get`-freezes-config precedent), declares its
 * dependencies, and returns the `$http` callable built by the pure
 * {@link createHttp} factory.
 *
 * This slice ships `defaults.headers` + an empty `interceptors` array and the
 * `$q` / `$injector` / `$httpBackend` / `$cacheFactory` deps. The interceptor
 * RESOLUTION (names → `$injector.get`, functions → `$injector.invoke`) and
 * the caching wiring through `$cacheFactory` land in later slices — the deps
 * are declared now so the `$get` signature is stable.
 *
 * @example
 * ```ts
 * createModule('app', ['ng']).config(['$httpProvider', (p) => {
 *   p.defaults.headers.common['Authorization'] = 'Bearer token';
 * }]);
 * ```
 */

import type { CacheFactory } from '@cache/cache-types';
import type { QService } from '@async/q-types';
import type { Injector, Invokable } from '@di/di-types';
import type { SceService } from '@sce/sce-types';
import { createHttp } from './http';
import { paramSerializer } from './http-params';
import { defaultTransformRequest, defaultTransformResponse } from './http-transforms';
import type { HttpBackend, HttpDefaults, HttpService, Interceptor } from './http-types';

/** The JSON content-type AngularJS attaches as a per-method default header. */
const JSON_CONTENT_TYPE = 'application/json;charset=utf-8';

/**
 * A registered interceptor — either a factory NAME resolved via
 * `$injector.get(name)` or a factory FUNCTION (an injector {@link Invokable},
 * so an array-annotated `['$q', ($q) => ({ … })]` or a bare / `$inject`-
 * annotated function) resolved via `$injector.invoke(fn)` at `$get` time
 * (Slice 4). The resolution produces an {@link Interceptor} object.
 */
export type InterceptorRegistration = string | Invokable<Interceptor>;

export class $HttpProvider {
  /**
   * The application-wide request defaults (FS §2.4). Public and mutable —
   * config blocks write directly onto `defaults.headers.common` /
   * per-method bags. The reference is captured at `$get` time and baked into
   * the produced `$http` service.
   */
  defaults: HttpDefaults = {
    headers: {
      common: {
        Accept: 'application/json, text/plain, */*',
      },
      post: { 'Content-Type': JSON_CONTENT_TYPE },
      put: { 'Content-Type': JSON_CONTENT_TYPE },
      patch: { 'Content-Type': JSON_CONTENT_TYPE },
    },
    paramSerializer,
    transformRequest: defaultTransformRequest,
    transformResponse: defaultTransformResponse,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
  };

  /**
   * The interceptor registrations (FS §2.10). Public and mutable — config
   * blocks `push` factory names / functions. Resolution into the request /
   * response pipeline lands in Slice 4; today the array is held verbatim.
   */
  interceptors: InterceptorRegistration[] = [];

  /**
   * Injector-facing factory. Array-style invokable declaring `$q`,
   * `$injector`, `$httpBackend`, and `$cacheFactory` as dependencies. The
   * closure captures `this` so the `defaults` / `interceptors` in force at
   * `$get` time (after all `config()` blocks have run) are the ones baked
   * into the produced service.
   *
   * `$injector` and `$cacheFactory` are declared now (used by the
   * interceptor-resolution and caching slices) so the `$get` signature is
   * stable across the remaining slices.
   */
  $get = [
    '$q',
    '$injector',
    '$httpBackend',
    '$cacheFactory',
    (q: QService, injector: Injector, httpBackend: HttpBackend, cacheFactory: CacheFactory): HttpService => {
      // Resolve the interceptor registrations ONCE at `$get` time (the
      // `$FilterProvider` resolve-at-`$get` precedent): a string is a factory
      // NAME → `$injector.get(name)`; anything else is a factory FUNCTION
      // (an `Invokable`) → `$injector.invoke(fn)`. Both yield the
      // `Interceptor` object threaded into the pipeline. Registration order
      // is preserved — `createHttp` folds the request phase outward→inward
      // and the response phase inner→outer.
      const interceptors: Interceptor[] = this.interceptors.map((registration) =>
        typeof registration === 'string'
          ? injector.get<Interceptor>(registration)
          : injector.invoke<Interceptor>(registration),
      );

      // The JSONP trusted-destination gate (FS §2.12). Resolve `$sce` LAZILY
      // (the `ng-include` precedent — `$sce` is always on `ngModule`, so the
      // probe normally succeeds; the lazy form covers a stripped injector
      // lacking `$sce`, where JSONP URLs pass through). The closure throws from
      // `getTrustedResourceUrl` for an untrusted destination BEFORE any
      // `<script>` is injected; `createHttp` propagates the throw as a
      // rejection so no network/DOM activity occurs.
      const jsonpTrust = injector.has('$sce')
        ? (url: string): string => {
            const trusted = injector.get<SceService>('$sce').getTrustedResourceUrl(url);
            return typeof trusted === 'string' ? trusted : String(trusted);
          }
        : undefined;

      // The XSRF cookie read (`$$cookieReader`) and the cancellation timer
      // seams default to the real `document.cookie` / global `setTimeout`
      // inside `createHttp` (FS §2.8 / §2.11), so they are not threaded here.
      // `cacheFactory` powers the lazy `cache: true` default cache (FS §2.13).
      return createHttp({ q, httpBackend, defaults: this.defaults, interceptors, cacheFactory, jsonpTrust });
    },
  ] as const;
}
