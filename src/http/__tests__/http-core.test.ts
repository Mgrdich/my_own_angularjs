/**
 * Tests for the `$http` core + `$httpBackend` fetch transport
 * (spec 038 Slice 2 / FS §2.1, §2.3, §2.7).
 *
 * Three layers are exercised:
 *
 * 1. **`$httpBackend` (fetch transport)** — `createHttpBackend({ q, fetchFn })`
 *    with a STUBBED `fetchFn` returning a `Response` (or throwing): resolves
 *    a `RawResponse` for 2xx AND non-2xx; rejects with a `'network'` /
 *    `'abort'` sentinel only when the request never reached the server.
 * 2. **`$http` core (ESM factory)** — `createHttp({ q, httpBackend })` with a
 *    STUBBED backend: the general form + `get` issue the right method/url;
 *    2xx → success bundle, non-2xx → failure bundle (incl. error body); a
 *    network failure is distinguishable (`status: -1`); the `headers` getter
 *    is case-insensitive.
 * 3. **DI / digest integration** — `injector.get('$http')` resolves after
 *    `createInjector(['ng'])`; a stubbed resolution refreshes a `$watch`-bound
 *    value with NO manual `$apply` (the `$q` → `$rootScope.$evalAsync` seam).
 */

import { describe, expect, it, vi } from 'vitest';

import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { Scope } from '@core/index';
import { ngModule } from '@core/ng-module';
import { createModule } from '@di/module';
import { createInjector } from '@di/injector';
import { noopExceptionHandler } from '@exception-handler/index';
import { createHttp } from '@http/http';
import { createHttpBackend, HttpTransportError, type FetchFn } from '@http/http-backend';
import type { HttpBackend, HttpConfig, RawResponse } from '@http/http-types';

/**
 * Build a `$q` wired to a real root scope so resolving a deferred drains
 * through a digest — the same seam `ngModule` binds. Returns both so a test
 * can drive `scope.$digest()` to flush continuations.
 */
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

/** A stub `fetchFn` returning a fixed `Response` built from the given parts. */
function stubFetch(body: string, init: ResponseInit): FetchFn {
  return vi.fn(() => Promise.resolve(new Response(body, init)));
}

/**
 * Drain the interleaved microtask + digest cycles the backend chains through:
 * `fetch().then` → `response.text().then` → `deferred.resolve` →
 * `$evalAsync` → digest. Several iterations cover the worst case defensively.
 */
async function flush(scope: Scope): Promise<void> {
  for (let i = 0; i < 3; i++) {
    // A macrotask boundary fully drains the native microtask queue the backend
    // chains through (`fetch().then` → `response.text().then`) before each
    // digest, which is what surfaces the `$q` continuation.
    await new Promise((resolve) => setTimeout(resolve, 0));
    scope.$digest();
  }
}

describe('createHttpBackend() — fetch transport (FS §2.3)', () => {
  it('resolves a RawResponse with status/statusText/data/headers on 2xx', async () => {
    const { q, scope } = makeQ();
    const fetchFn = stubFetch('{"ok":true}', {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/json' },
    });
    const backend = createHttpBackend({ q, fetchFn });

    const settled = vi.fn();
    backend({ method: 'GET', url: '/api' }, {}).then(settled);

    await flush(scope);

    expect(settled).toHaveBeenCalledTimes(1);
    const raw = settled.mock.calls[0]?.[0] as RawResponse;
    expect(raw.status).toBe(200);
    expect(raw.statusText).toBe('OK');
    expect(raw.data).toBe('{"ok":true}');
    expect(raw.headers.toLowerCase()).toContain('content-type: application/json');
  });

  it('RESOLVES (does not reject) on a non-2xx status — classification is $http’s job', async () => {
    const { q, scope } = makeQ();
    const fetchFn = stubFetch('not found', { status: 404, statusText: 'Not Found' });
    const backend = createHttpBackend({ q, fetchFn });

    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    backend({ method: 'GET', url: '/missing' }, {}).then(onSuccess, onFailure);

    await flush(scope);

    expect(onFailure).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect((onSuccess.mock.calls[0]?.[0] as RawResponse).status).toBe(404);
  });

  it('rejects with a network HttpTransportError when fetch throws', async () => {
    const { q, scope } = makeQ();
    const fetchFn: FetchFn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const backend = createHttpBackend({ q, fetchFn });

    const onFailure = vi.fn();
    backend({ method: 'GET', url: '/down' }, {}).then(undefined, onFailure);

    await flush(scope);

    expect(onFailure).toHaveBeenCalledTimes(1);
    const reason = onFailure.mock.calls[0]?.[0] as HttpTransportError;
    expect(reason).toBeInstanceOf(HttpTransportError);
    expect(reason.kind).toBe('network');
  });

  it('rejects with an abort HttpTransportError when the signal is aborted', async () => {
    const { q, scope } = makeQ();
    const controller = new AbortController();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const fetchFn: FetchFn = vi.fn(() => Promise.reject(abortError));
    const backend = createHttpBackend({ q, fetchFn });

    const onFailure = vi.fn();
    controller.abort();
    backend({ method: 'GET', url: '/x' }, { signal: controller.signal }).then(undefined, onFailure);

    await flush(scope);

    const reason = onFailure.mock.calls[0]?.[0] as HttpTransportError;
    expect(reason.kind).toBe('abort');
  });

  it('passes method/url/body/credentials/signal through to fetch', () => {
    const { q } = makeQ();
    const fetchFn = stubFetch('', { status: 200, statusText: 'OK' });
    const backend = createHttpBackend({ q, fetchFn });
    const controller = new AbortController();

    backend({ method: 'POST', url: '/submit', data: 'payload', withCredentials: true }, { signal: controller.signal });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/submit');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('payload');
    expect(init.credentials).toBe('include');
    expect(init.signal).toBe(controller.signal);
  });
});

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

describe('createHttp() — request pipeline (FS §2.1, §2.7)', () => {
  it('the general form issues the right method/url to the backend', () => {
    const { q, scope } = makeQ();
    const { backend, spy } = stubBackend(q, () => ({
      status: 200,
      statusText: 'OK',
      data: 'body',
      headers: '',
    }));
    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults });

    $http({ method: 'POST', url: '/create' });
    expect(spy).toHaveBeenCalledTimes(1);
    const sentConfig = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sentConfig.method).toBe('POST');
    expect(sentConfig.url).toBe('/create');
    void scope;
  });

  it('the get shortcut issues a GET to the url', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => ({ status: 200, statusText: 'OK', data: '', headers: '' }));
    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults });

    $http.get('/api/me');
    const sentConfig = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sentConfig.method).toBe('GET');
    expect(sentConfig.url).toBe('/api/me');
  });

  it('2xx resolves with the full success bundle (data/status/statusText/headers/config)', async () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => ({
      status: 200,
      statusText: 'OK',
      data: 'hello',
      headers: 'X-Total: 5',
    }));
    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults });

    const onSuccess = vi.fn();
    $http({ method: 'GET', url: '/x' }).then(onSuccess);

    scope.$digest();
    await Promise.resolve();
    scope.$digest();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    const res = onSuccess.mock.calls[0]?.[0] as {
      data: unknown;
      status: number;
      statusText: string;
      headers: (n: string) => string | null;
      config: HttpConfig;
    };
    expect(res.data).toBe('hello');
    expect(res.status).toBe(200);
    expect(res.statusText).toBe('OK');
    expect(res.headers('X-Total')).toBe('5');
    expect(res.config.url).toBe('/x');
  });

  it('non-2xx rejects with a failure bundle carrying the error body and status', async () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => ({
      status: 500,
      statusText: 'Server Error',
      data: 'boom',
      headers: '',
    }));
    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults });

    const onFailure = vi.fn();
    $http({ method: 'GET', url: '/x' }).then(undefined, onFailure);

    scope.$digest();
    await Promise.resolve();
    scope.$digest();

    expect(onFailure).toHaveBeenCalledTimes(1);
    const res = onFailure.mock.calls[0]?.[0] as { data: unknown; status: number };
    expect(res.status).toBe(500);
    expect(res.data).toBe('boom');
  });

  it('a network failure is distinguishable from a server error (status -1)', async () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => new HttpTransportError('network', 'never reached server'));
    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults });

    const onFailure = vi.fn();
    $http({ method: 'GET', url: '/x' }).then(undefined, onFailure);

    scope.$digest();
    await Promise.resolve();
    scope.$digest();

    expect(onFailure).toHaveBeenCalledTimes(1);
    const res = onFailure.mock.calls[0]?.[0] as { status: number };
    expect(res.status).toBe(-1);
  });

  it('the headers getter is case-insensitive', async () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => ({
      status: 200,
      statusText: 'OK',
      data: '',
      headers: 'Content-Type: application/json',
    }));
    const $http = createHttp({ q, httpBackend: backend, defaults: emptyDefaults });

    const onSuccess = vi.fn();
    $http({ method: 'GET', url: '/x' }).then(onSuccess);

    scope.$digest();
    await Promise.resolve();
    scope.$digest();

    const res = onSuccess.mock.calls[0]?.[0] as { headers: (n?: string) => string | null | Record<string, string> };
    expect(res.headers('Content-Type')).toBe('application/json');
    expect(res.headers('content-type')).toBe('application/json');
    expect(res.headers('CONTENT-TYPE')).toBe('application/json');
    expect(res.headers('missing')).toBeNull();
  });

  it('merges a default common header onto every request', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => ({ status: 200, statusText: 'OK', data: '', headers: '' }));
    const $http = createHttp({
      q,
      httpBackend: backend,
      defaults: { headers: { common: { Accept: 'application/json' } } },
    });

    $http({ method: 'GET', url: '/x', headers: { 'X-Custom': '1' } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.headers).toEqual({ Accept: 'application/json', 'X-Custom': '1' });
  });
});

describe('$http DI + digest integration (FS §2.1)', () => {
  it('injector.get(’$http’) resolves the service after createInjector([’ng’])', () => {
    const injector = createInjector([ngModule]);
    const $http = injector.get('$http');
    expect(typeof $http).toBe('function');
    expect(typeof $http.get).toBe('function');
    expect($http.defaults.headers.common).toBeDefined();
  });

  it('a stubbed-backend resolution refreshes a $watch-bound value with NO manual $apply', () => {
    // Clean seam: an app module overrides `$httpBackend` with a stub that
    // resolves a `RawResponse` through `$q`. `$http` then runs end-to-end and
    // the resolution schedules a digest via `$q`'s `$evalAsync` seam — the
    // test NEVER calls `$apply`.
    const appModule = createModule('http-digest-app', ['ng']).factory('$httpBackend', [
      '$q',
      (q: QService): HttpBackend =>
        (() => {
          const deferred = q.defer<RawResponse>();
          deferred.resolve({ status: 200, statusText: 'OK', data: 'fresh', headers: '' });
          return deferred.promise;
        }) as unknown as HttpBackend,
    ]);

    const injector = createInjector([ngModule, appModule]);
    const $http = injector.get('$http');
    const $rootScope = injector.get('$rootScope');

    let bound: string | undefined;
    $http.get<string>('/data').then((res) => {
      bound = res.data;
    });

    // The ONLY digest the test drives — it does NOT $apply. The resolution was
    // queued by $q via $evalAsync, so a plain $digest drains it.
    $rootScope.$digest();

    expect(bound).toBe('fresh');
  });
});
