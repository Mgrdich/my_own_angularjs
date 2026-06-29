/**
 * Tests for the `$http` Slice-5 extras (spec 038 Slice 5 / FS §2.8, §2.11,
 * §2.13, §2.14).
 *
 * Four concerns, all exercised against the PURE `createHttp({ … })` factory
 * with a STUBBED backend (and stubbed `$$cookieReader` / timer seams), so no
 * real cookies, no real timers, and no network are involved:
 *
 * - **XSRF (§2.11)** — a same-origin request attaches the cookie token under
 *   the configured header; a cross-origin request does NOT (no leak);
 *   `xsrfCookieName` / `xsrfHeaderName` are honored.
 * - **Caching + dedup (§2.13)** — a GET cache hit serves WITHOUT the backend;
 *   caching is OFF by default; two concurrent identical GETs share ONE backend
 *   call.
 * - **Pending requests (§2.14)** — present while in flight, removed on settle
 *   (both success and failure).
 * - **Cancellation / timeout (§2.8)** — a numeric timeout aborts + rejects; a
 *   promise timeout aborts; an already-settled response IGNORES a later abort.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQ } from '@async/q';
import type { QDeferred, QService } from '@async/q-types';
import { createCacheFactory } from '@cache/cache-factory';
import type { Cache } from '@cache/cache-types';
import { Scope } from '@core/index';
import { noopExceptionHandler } from '@exception-handler/index';
import { createHttp } from '@http/http';
import { HttpTransportError } from '@http/http-backend';
import type { CookieReader } from '@http/http-xsrf';
import type { HttpBackend, HttpConfig, HttpDefaults, HttpResponse, RawResponse } from '@http/http-types';

const ORIGIN = 'https://app.example.com/';
const okRaw: RawResponse = { status: 200, statusText: 'OK', data: '', headers: '' };

/** A minimal defaults bag — no transforms needed for these tests. */
function makeDefaults(overrides?: Partial<HttpDefaults>): HttpDefaults {
  return {
    headers: { common: {} },
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    ...overrides,
  };
}

/** A `$q` wired to a real scope so resolving a deferred drains via digest. */
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

/** Pump several digest cycles synchronously (used under fake timers). */
function digest(scope: Scope, times = 4): void {
  for (let i = 0; i < times; i++) {
    scope.$digest();
  }
}

/**
 * Drain the interleaved microtask + digest cycles. A macrotask boundary fully
 * flushes the native microtask queue the `$q` chain rides before each digest.
 */
async function flush(scope: Scope): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    scope.$digest();
  }
}

describe('$http XSRF protection (FS §2.11)', () => {
  function setup(cookie: string, defaults?: Partial<HttpDefaults>) {
    const { q, scope } = makeQ();
    const sent: HttpConfig[] = [];
    const spy = vi.fn((config: HttpConfig) => {
      sent.push(config);
      const deferred = q.defer<RawResponse>();
      deferred.resolve(okRaw);
      return deferred.promise;
    });
    const $http = createHttp({
      q,
      httpBackend: spy as unknown as HttpBackend,
      defaults: makeDefaults(defaults),
      cookieReader: (() => cookie) as CookieReader,
      xsrfBaseUrl: ORIGIN,
    });
    return { $http, scope, sent };
  }

  it('attaches the cookie token as the XSRF header on a same-origin request', async () => {
    const { $http, scope, sent } = setup('XSRF-TOKEN=secret-123');

    $http.get(`${ORIGIN}api/data`);
    await flush(scope);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers?.['X-XSRF-TOKEN']).toBe('secret-123');
  });

  it('does NOT attach the token on a cross-origin request', async () => {
    const { $http, scope, sent } = setup('XSRF-TOKEN=secret-123');

    $http.get('https://evil.example.org/api/data');
    await flush(scope);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers?.['X-XSRF-TOKEN']).toBeUndefined();
  });

  it('honors configurable cookie + header names', async () => {
    const { $http, scope, sent } = setup('My-Cookie=tok-abc', {
      xsrfCookieName: 'My-Cookie',
      xsrfHeaderName: 'My-Header',
    });

    $http.get(`${ORIGIN}api/data`);
    await flush(scope);

    expect(sent[0]?.headers?.['My-Header']).toBe('tok-abc');
    // The default header name must NOT be used when a custom one is configured.
    expect(sent[0]?.headers?.['X-XSRF-TOKEN']).toBeUndefined();
  });

  it('attaches nothing when the cookie is absent (same-origin)', async () => {
    const { $http, scope, sent } = setup('OTHER=x');

    $http.get(`${ORIGIN}api/data`);
    await flush(scope);

    expect(sent[0]?.headers?.['X-XSRF-TOKEN']).toBeUndefined();
  });
});

describe('$http caching + in-flight dedup (FS §2.13)', () => {
  /**
   * A backend whose responses are controlled per call via a list of deferreds,
   * so a test can keep two GETs in flight before settling them.
   */
  function makeControllableBackend(q: QService) {
    const deferreds: QDeferred<RawResponse>[] = [];
    const spy = vi.fn(() => {
      const deferred = q.defer<RawResponse>();
      deferreds.push(deferred);
      return deferred.promise;
    });
    return { backend: spy as unknown as HttpBackend, spy, deferreds };
  }

  function settle(deferred: QDeferred<RawResponse> | undefined, body: string): void {
    deferred?.resolve({ status: 200, statusText: 'OK', data: body, headers: '' });
  }

  it('is OFF by default — a repeated GET hits the backend each time', async () => {
    const { q, scope } = makeQ();
    const { backend, spy, deferreds } = makeControllableBackend(q);
    const $http = createHttp({ q, httpBackend: backend, defaults: makeDefaults() });

    $http.get(`${ORIGIN}a`);
    await flush(scope);
    settle(deferreds[0], 'one');
    await flush(scope);

    $http.get(`${ORIGIN}a`);
    await flush(scope);

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('serves a GET cache HIT from the store without hitting the backend', async () => {
    const { q, scope } = makeQ();
    const { backend, spy, deferreds } = makeControllableBackend(q);
    const cache: Cache<HttpResponse> = createCacheFactory()<HttpResponse>('test');
    const $http = createHttp({ q, httpBackend: backend, defaults: makeDefaults() });

    // First request populates the cache on success.
    const first = vi.fn();
    $http.get(`${ORIGIN}a`, { cache }).then(first);
    await flush(scope);
    settle(deferreds[0], '"hello"');
    await flush(scope);
    expect(first).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);

    // Second identical request is served from the cache — backend NOT hit.
    const second = vi.fn();
    $http.get(`${ORIGIN}a`, { cache }).then(second);
    await flush(scope);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    const bundle = second.mock.calls[0]?.[0] as HttpResponse;
    expect(bundle.data).toBe('hello');
  });

  it('serves a cache CLONE so callers cannot corrupt the stored entry', async () => {
    const { q, scope } = makeQ();
    const { backend, deferreds } = makeControllableBackend(q);
    const cache: Cache<HttpResponse> = createCacheFactory()<HttpResponse>('clone');
    const $http = createHttp({ q, httpBackend: backend, defaults: makeDefaults() });

    const firstSeen = vi.fn();
    $http.get(`${ORIGIN}a`, { cache }).then(firstSeen);
    await flush(scope);
    settle(deferreds[0], 'x');
    await flush(scope);

    // Mutate the delivered bundle's config; the cached entry must be unaffected.
    const firstBundle = firstSeen.mock.calls[0]?.[0] as HttpResponse;
    firstBundle.config.url = 'tampered';

    const secondSeen = vi.fn();
    $http.get(`${ORIGIN}a`, { cache }).then(secondSeen);
    await flush(scope);

    const secondBundle = secondSeen.mock.calls[0]?.[0] as HttpResponse;
    expect(secondBundle.config.url).toBe(`${ORIGIN}a`);
    expect(secondBundle).not.toBe(firstBundle);
  });

  it('shares ONE backend call between two concurrent identical cacheable GETs', async () => {
    const { q, scope } = makeQ();
    const { backend, spy, deferreds } = makeControllableBackend(q);
    const cache: Cache<HttpResponse> = createCacheFactory()<HttpResponse>('dedup');
    const $http = createHttp({ q, httpBackend: backend, defaults: makeDefaults() });

    const a = vi.fn();
    const b = vi.fn();
    $http.get(`${ORIGIN}a`, { cache }).then(a);
    $http.get(`${ORIGIN}a`, { cache }).then(b);
    await flush(scope);

    // Only ONE outstanding network call despite two concurrent requests.
    expect(spy).toHaveBeenCalledTimes(1);

    settle(deferreds[0], '"shared"');
    await flush(scope);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect((a.mock.calls[0]?.[0] as HttpResponse).data).toBe('shared');
    expect((b.mock.calls[0]?.[0] as HttpResponse).data).toBe('shared');
  });

  it('lazily creates the default cache for `cache: true` via $cacheFactory', async () => {
    const { q, scope } = makeQ();
    const { backend, spy, deferreds } = makeControllableBackend(q);
    const cacheFactory = createCacheFactory();
    const $http = createHttp({ q, httpBackend: backend, defaults: makeDefaults(), cacheFactory });

    $http.get(`${ORIGIN}a`, { cache: true });
    await flush(scope);
    settle(deferreds[0], '"v"');
    await flush(scope);

    const second = vi.fn();
    $http.get(`${ORIGIN}a`, { cache: true }).then(second);
    await flush(scope);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(cacheFactory.get('$http')).toBeDefined();
  });
});

describe('$http pendingRequests (FS §2.14)', () => {
  it('lists a request while in flight and removes it on success', async () => {
    const { q, scope } = makeQ();
    const deferred = q.defer<RawResponse>();
    const $http = createHttp({
      q,
      httpBackend: (() => deferred.promise) as unknown as HttpBackend,
      defaults: makeDefaults(),
    });

    $http.get(`${ORIGIN}a`);
    await flush(scope);
    expect($http.pendingRequests).toHaveLength(1);

    deferred.resolve(okRaw);
    await flush(scope);
    expect($http.pendingRequests).toHaveLength(0);
  });

  it('removes the request on FAILURE (non-2xx) too', async () => {
    const { q, scope } = makeQ();
    const deferred = q.defer<RawResponse>();
    const $http = createHttp({
      q,
      httpBackend: (() => deferred.promise) as unknown as HttpBackend,
      defaults: makeDefaults(),
    });

    $http.get(`${ORIGIN}a`).then(undefined, () => undefined);
    await flush(scope);
    expect($http.pendingRequests).toHaveLength(1);

    deferred.resolve({ status: 500, statusText: 'Error', data: 'boom', headers: '' });
    await flush(scope);
    expect($http.pendingRequests).toHaveLength(0);
  });

  it('removes the request when the transport rejects (network failure)', async () => {
    const { q, scope } = makeQ();
    const deferred = q.defer<RawResponse>();
    const $http = createHttp({
      q,
      httpBackend: (() => deferred.promise) as unknown as HttpBackend,
      defaults: makeDefaults(),
    });

    $http.get(`${ORIGIN}a`).then(undefined, () => undefined);
    await flush(scope);
    expect($http.pendingRequests).toHaveLength(1);

    deferred.reject(new HttpTransportError('network', 'down'));
    await flush(scope);
    expect($http.pendingRequests).toHaveLength(0);
  });
});

describe('$http cancellation + timeout (FS §2.8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A backend that wires `fetch`'s abort to the deferred: when the signal
   * aborts, it rejects with an `'abort'` transport error (mirroring the real
   * fetch backend), unless it already settled.
   */
  function makeAbortableBackend(q: QService) {
    const signals: (AbortSignal | undefined)[] = [];
    const deferreds: QDeferred<RawResponse>[] = [];
    const spy = vi.fn((_config: HttpConfig, options: { signal?: AbortSignal }) => {
      const deferred = q.defer<RawResponse>();
      deferreds.push(deferred);
      signals.push(options.signal);
      options.signal?.addEventListener('abort', () => {
        deferred.reject(new HttpTransportError('abort', 'Request aborted'));
      });
      return deferred.promise;
    });
    return { backend: spy as unknown as HttpBackend, signals, deferreds };
  }

  /**
   * Build a `$q`/scope, an abortable backend wired to that `$q`, and an
   * `$http` whose timer seams route through (fake) `setTimeout` / `clearTimeout`.
   */
  function makeTimerHttp() {
    const { q, scope } = makeQ();
    const { backend, signals, deferreds } = makeAbortableBackend(q);
    const $http = createHttp({
      q,
      httpBackend: backend,
      defaults: makeDefaults(),
      setTimer: (fn, delay) => setTimeout(fn, delay),
      clearTimer: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    });
    return { q, scope, $http, signals, deferreds };
  }

  it('a numeric timeout aborts the fetch and rejects the result', () => {
    const { scope, $http, signals } = makeTimerHttp();

    const rejected = vi.fn();
    $http.get(`${ORIGIN}slow`, { timeout: 1000 }).then(undefined, rejected);

    digest(scope);
    expect(signals[0]?.aborted).toBe(false);

    // Advance past the time limit: the timer fires → controller.abort().
    vi.advanceTimersByTime(1000);
    expect(signals[0]?.aborted).toBe(true);

    digest(scope);
    expect(rejected).toHaveBeenCalledTimes(1);
    const failure = rejected.mock.calls[0]?.[0] as HttpResponse;
    expect(failure.status).toBe(-1);
  });

  it('a promise timeout aborts the fetch', () => {
    const { q, scope, $http, signals } = makeTimerHttp();

    const cancel = q.defer();
    const rejected = vi.fn();
    $http.get(`${ORIGIN}slow`, { timeout: cancel.promise }).then(undefined, rejected);

    digest(scope);
    expect(signals[0]?.aborted).toBe(false);

    cancel.resolve(undefined);
    digest(scope);
    expect(signals[0]?.aborted).toBe(true);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('an already-settled response IGNORES a later abort', () => {
    const { scope, $http, signals, deferreds } = makeTimerHttp();

    const resolved = vi.fn();
    const rejected = vi.fn();
    $http.get(`${ORIGIN}fast`, { timeout: 1000 }).then(resolved, rejected);

    digest(scope);

    // The response arrives BEFORE the timeout fires — settle it as a success.
    deferreds[0]?.resolve({ status: 200, statusText: 'OK', data: 'done', headers: '' });
    digest(scope);
    expect(resolved).toHaveBeenCalledTimes(1);

    // The timer was cleared on settle, so advancing time aborts nothing and
    // the already-resolved result is unaffected (no late rejection).
    vi.advanceTimersByTime(5000);
    digest(scope);
    expect(signals[0]?.aborted).toBe(false);
    expect(rejected).not.toHaveBeenCalled();
    expect(resolved).toHaveBeenCalledTimes(1);
  });
});
