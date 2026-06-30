/**
 * Tests for the `$http` interceptor pipeline (spec 038 Slice 4 / FS §2.10).
 *
 * Two layers are exercised:
 *
 * 1. **Pure factory** — `createHttp({ q, httpBackend, defaults, interceptors })`
 *    with a STUBBED backend and hand-built interceptor objects: a `request`
 *    interceptor modifies the outgoing config and it reaches the backend; a
 *    `response` interceptor modifies the response before the caller; a
 *    `responseError` recovers a rejection into success; a `requestError` is
 *    reachable when an earlier request handler rejects; multi-interceptor
 *    ordering is pinned (request OUTWARD→INWARD = last-registered first,
 *    response INNER→OUTER = first-registered last); an ASYNC interceptor
 *    (returning a `QPromise` resolved later via a digest) is awaited.
 * 2. **DI resolution** — both registration forms resolve at `$get`: a factory
 *    NAME (`appModule.factory('myInterceptor', …)` + `interceptors.push(name)`)
 *    via `$injector.get`, and a factory FUNCTION via `$injector.invoke`.
 */

import { describe, expect, it, vi } from 'vitest';

import { createQ } from '@async/q';
import type { QPromise, QService } from '@async/q-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { noopExceptionHandler } from '@exception-handler/index';
import { createHttp } from '@http/http';
import { HttpTransportError } from '@http/http-backend';
import { $HttpProvider } from '@http/http-provider';
import type { HttpBackend, HttpConfig, HttpResponse, Interceptor, RawResponse } from '@http/http-types';

/** Build a `$q` wired to a real root scope (the `http-core.test.ts` pattern). */
function makeQ(): { q: QService; scope: Scope } {
  const scope = Scope.create();
  const q = createQ({
    exceptionHandler: noopExceptionHandler,
    scheduleDigest: (fn) => {
      scope.$evalAsync(fn);
    },
  });
  return { q, scope };
}

/** A stub `$httpBackend` resolving / rejecting with a caller-supplied raw value. */
function stubBackend(
  q: QService,
  behavior: (config: HttpConfig) => RawResponse | HttpTransportError,
): {
  backend: HttpBackend;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn((config: HttpConfig) => {
    const deferred = q.defer<RawResponse>();
    const result = behavior(config);
    if (result instanceof HttpTransportError) {
      deferred.reject(result);
    } else {
      deferred.resolve(result);
    }
    return deferred.promise;
  });
  return { backend: spy as unknown as HttpBackend, spy };
}

const emptyDefaults = { headers: { common: {} } };

/**
 * Drain the `$q` continuation chain: the interceptor pipeline `.then`-chains
 * across several promise hops (request phase → backend → response phase), each
 * scheduled through `$evalAsync` and drained by a `$digest`. Several iterations
 * cover the deepest chain defensively.
 */
function flush(scope: Scope): void {
  for (let i = 0; i < 8; i++) {
    scope.$digest();
  }
}

describe('createHttp() — interceptor pipeline (FS §2.10)', () => {
  it('a request interceptor modifies the outgoing request and it reaches the backend', () => {
    const { q, scope } = makeQ();
    const { backend, spy } = stubBackend(q, () => ({ status: 200, statusText: 'OK', data: '', headers: '' }));

    const requestInterceptor: Interceptor = {
      request(config) {
        config.headers = { ...config.headers, 'X-Intercepted': 'yes' };
        config.url = '/rewritten';
        return config;
      },
    };

    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults, interceptors: [requestInterceptor] });
    $http({ method: 'GET', url: '/original' });

    flush(scope);

    expect(spy).toHaveBeenCalledTimes(1);
    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.url).toBe('/rewritten');
    expect(sent.headers?.['X-Intercepted']).toBe('yes');
  });

  it('a response interceptor modifies the response before the caller', () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => ({ status: 200, statusText: 'OK', data: 'raw', headers: '' }));

    const responseInterceptor: Interceptor = {
      response(response) {
        return { ...response, data: 'transformed' };
      },
    };

    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults, interceptors: [responseInterceptor] });

    const onSuccess = vi.fn();
    $http<string>({ method: 'GET', url: '/x' }).then(onSuccess);

    flush(scope);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    const res = onSuccess.mock.calls[0]?.[0] as HttpResponse<string>;
    expect(res.data).toBe('transformed');
  });

  it('a responseError recovers a rejection into a success', () => {
    const { q, scope } = makeQ();
    // Backend returns 500 → $http rejects with the failure bundle.
    const { backend } = stubBackend(q, () => ({ status: 500, statusText: 'Server Error', data: 'boom', headers: '' }));

    const recovering: Interceptor = {
      responseError(rejection) {
        const failure = rejection as HttpResponse;
        // Recover: RETURN a success-shaped bundle (does NOT re-reject).
        return { ...failure, data: 'recovered', status: 200, statusText: 'OK' };
      },
    };

    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults, interceptors: [recovering] });

    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    $http({ method: 'GET', url: '/x' }).then(onSuccess, onFailure);

    flush(scope);

    expect(onFailure).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const res = onSuccess.mock.calls[0]?.[0] as HttpResponse;
    expect(res.status).toBe(200);
    expect(res.data).toBe('recovered');
  });

  it('a requestError is reachable when an earlier request interceptor rejects', () => {
    const { q, scope } = makeQ();
    const { backend, spy } = stubBackend(q, () => ({ status: 200, statusText: 'OK', data: '', headers: '' }));

    const order: string[] = [];

    // LAST-registered runs FIRST in the request phase — so this one runs
    // before `inner` and rejects, routing to `inner`'s requestError.
    const outerRejecting: Interceptor = {
      request() {
        order.push('outer.request(reject)');
        return q.reject<HttpConfig>('request blew up');
      },
    };
    const innerRecovering: Interceptor = {
      requestError(rejection) {
        order.push(`inner.requestError(${String(rejection)})`);
        // Recover into a usable config so the backend still sends.
        return { method: 'GET', url: '/recovered' };
      },
    };

    // Registration order: [innerRecovering, outerRejecting]. Request phase
    // runs last-first → outerRejecting.request → innerRecovering.requestError.
    const $http = createHttp({
      q,
      httpBackend: backend,
      defaults: emptyDefaults,
      interceptors: [innerRecovering, outerRejecting],
    });

    $http({ method: 'GET', url: '/original' });

    flush(scope);

    expect(order).toEqual(['outer.request(reject)', 'inner.requestError(request blew up)']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]?.[0] as HttpConfig).url).toBe('/recovered');
  });

  it('pins multi-interceptor ordering: request outward→inward, response inner→outer', () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => ({ status: 200, statusText: 'OK', data: '', headers: '' }));

    const order: string[] = [];

    const makeInterceptor = (label: string): Interceptor => ({
      request(config) {
        order.push(`request:${label}`);
        return config;
      },
      response(response) {
        order.push(`response:${label}`);
        return response;
      },
    });

    // Registration order: A then B.
    const $http = createHttp({
      q,
      httpBackend: backend,
      defaults: emptyDefaults,
      interceptors: [makeInterceptor('A'), makeInterceptor('B')],
    });

    $http({ method: 'GET', url: '/x' });

    flush(scope);

    // Request phase OUTWARD→INWARD: last-registered (B) runs FIRST, then A,
    // then the backend send. Response phase INNER→OUTER: B's response runs
    // first (innermost), A's response runs last (outermost).
    expect(order).toEqual(['request:B', 'request:A', 'response:B', 'response:A']);
  });

  it('awaits an async (QPromise-returning) interceptor before continuing', () => {
    const { q, scope } = makeQ();
    const { backend, spy } = stubBackend(q, () => ({ status: 200, statusText: 'OK', data: '', headers: '' }));

    const deferred = q.defer<HttpConfig>();
    let pendingResolved = false;

    const asyncInterceptor: Interceptor = {
      request(config): QPromise<HttpConfig> {
        // Defer the config; the backend MUST NOT be hit until this resolves.
        void config;
        return deferred.promise;
      },
    };

    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults, interceptors: [asyncInterceptor] });
    $http({ method: 'GET', url: '/original' });

    // Drain: the request interceptor's pending promise gates the backend send.
    flush(scope);
    expect(spy).not.toHaveBeenCalled();

    // Resolve the deferred config later (the "async resolved via digest" seam).
    deferred.resolve({ method: 'GET', url: '/late' });
    pendingResolved = true;
    flush(scope);

    expect(pendingResolved).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0]?.[0] as HttpConfig).url).toBe('/late');
  });
});

describe('$http interceptor DI resolution (FS §2.10)', () => {
  it('resolves a factory-NAME registration via $injector.get', () => {
    const seen: string[] = [];

    const appModule = createModule('http-interceptor-name', ['ng'])
      // The interceptor is a normal factory whose service IS the interceptor object.
      .factory('myInterceptor', [
        (): Interceptor => ({
          request(config) {
            seen.push(config.url ?? '');
            config.headers = { ...config.headers, 'X-By-Name': '1' };
            return config;
          },
        }),
      ])
      // Override the backend with a $q-resolving stub.
      .factory('$httpBackend', [
        '$q',
        (q: QService): HttpBackend =>
          ((config: HttpConfig) => {
            seen.push(`backend:${config.headers?.['X-By-Name'] ?? 'none'}`);
            const deferred = q.defer<RawResponse>();
            deferred.resolve({ status: 200, statusText: 'OK', data: 'ok', headers: '' });
            return deferred.promise;
          }) as unknown as HttpBackend,
      ])
      .config([
        '$httpProvider',
        // The provider's `interceptors` array takes a factory NAME (string).
        (httpProvider: $HttpProvider) => {
          httpProvider.interceptors.push('myInterceptor');
        },
      ]);

    const injector = createInjector([ngModule, appModule]);
    const $http = injector.get('$http');
    const $rootScope = injector.get('$rootScope');

    $http.get('/by-name');
    $rootScope.$digest();

    expect(seen).toContain('/by-name');
    expect(seen).toContain('backend:1');
  });

  it('resolves a factory-FUNCTION registration via $injector.invoke', () => {
    const seen: string[] = [];

    const appModule = createModule('http-interceptor-fn', ['ng'])
      .factory('$httpBackend', [
        '$q',
        (q: QService): HttpBackend =>
          ((config: HttpConfig) => {
            seen.push(`backend:${config.headers?.['X-By-Fn'] ?? 'none'}`);
            const deferred = q.defer<RawResponse>();
            deferred.resolve({ status: 200, statusText: 'OK', data: 'ok', headers: '' });
            return deferred.promise;
          }) as unknown as HttpBackend,
      ])
      .config([
        '$httpProvider',
        (httpProvider: $HttpProvider) => {
          // A factory FUNCTION — an array-annotated Invokable resolved via
          // $injector.invoke. Declares $q as a dependency to prove the
          // function form is injected, not merely `get`-looked-up.
          httpProvider.interceptors.push([
            '$q',
            (q: QService): Interceptor => {
              void q;
              return {
                request(config) {
                  seen.push(config.url ?? '');
                  config.headers = { ...config.headers, 'X-By-Fn': '1' };
                  return config;
                },
              };
            },
          ]);
        },
      ]);

    const injector = createInjector([ngModule, appModule]);
    const $http = injector.get('$http');
    const $rootScope = injector.get('$rootScope');

    $http.get('/by-fn');
    $rootScope.$digest();

    expect(seen).toContain('/by-fn');
    expect(seen).toContain('backend:1');
  });
});
