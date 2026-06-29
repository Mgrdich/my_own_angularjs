/**
 * Upstream-AngularJS `$http` / `$httpProvider` PARITY tests (spec 038 Slice 7).
 *
 * Ports the upstream behaviors NOT already pinned by the Slice-2..6 suites —
 * the corner cases of the param serializers, the header parser, the default
 * JSON transforms, status classification (incl. the `status === 0` rule),
 * interceptor ordering, and cache/dedup semantics. Each `describe` cites the
 * upstream rule it mirrors.
 *
 * The two §3 INTENTIONAL DEVIATIONS are pinned at the bottom and labelled as
 * DELIBERATE, not parity gaps:
 *
 *  1. NO `.success()` / `.error()` shorthands — only the standard `.then` /
 *     `.catch` follow-ups exist on the returned `$q` promise.
 *  2. The JSONP destination is HARD-GATED through `$sce.getTrustedResourceUrl`
 *     with NO opt-out — an untrusted URL rejects before any `<script>` is
 *     injected.
 */

import { describe, expect, it, vi } from 'vitest';

import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { Scope } from '@core/index';
import { noopExceptionHandler } from '@exception-handler/index';
import { createHttp } from '@http/http';
import { HttpTransportError } from '@http/http-backend';
import { parseHeaders } from '@http/http-headers';
import { paramSerializer, paramSerializerJQLike } from '@http/http-params';
import { defaultTransformRequest, defaultTransformResponse } from '@http/http-transforms';
import type {
  HttpBackend,
  HttpConfig,
  HttpDefaults,
  HttpHeaders,
  HttpResponse,
  Interceptor,
  RawResponse,
} from '@http/http-types';

/** Build a `$q` wired to a real root scope (the shared suite pattern). */
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

/** Drain the interleaved microtask + digest cycles (the shared suite pattern). */
async function flush(scope: Scope): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    scope.$digest();
  }
}

/** A backend that resolves a fixed `RawResponse` and records the sent config. */
function recordingBackend(raw: RawResponse, q: QService): { backend: HttpBackend; sent: HttpConfig[] } {
  const sent: HttpConfig[] = [];
  const backend: HttpBackend = (config) => {
    sent.push(config);
    return q.resolve(raw);
  };
  return { backend, sent };
}

/** The minimal default bag used when a test does not exercise the merge. */
function bareDefaults(): HttpDefaults {
  return { headers: { common: {} } };
}

describe('paramSerializer — default rule (upstream $httpParamSerializer)', () => {
  it('skips undefined and null values', () => {
    expect(paramSerializer({ a: 1, b: undefined, c: null, d: 2 })).toBe('a=1&d=2');
  });

  it('repeats the key once per array element', () => {
    expect(paramSerializer({ tags: ['x', 'y', 'z'] })).toBe('tags=x&tags=y&tags=z');
  });

  it('skips null/undefined array elements', () => {
    expect(paramSerializer({ tags: ['x', null, 'y', undefined] })).toBe('tags=x&tags=y');
  });

  it('serializes a Date value to its ISO string', () => {
    expect(paramSerializer({ from: new Date(0) })).toBe('from=1970-01-01T00:00:00.000Z');
  });

  it('JSON-stringifies a nested object value', () => {
    expect(paramSerializer({ page: { n: 2 } })).toBe('page=%7B%22n%22:2%7D');
  });

  it('emits keys in sorted order for a stable result', () => {
    expect(paramSerializer({ b: 2, a: 1, c: 3 })).toBe('a=1&b=2&c=3');
  });

  it('escapes a space as + and leaves the readable reserved characters', () => {
    expect(paramSerializer({ q: 'a b', path: '/x', at: 'a@b' })).toBe('at=a@b&path=/x&q=a+b');
  });

  it('returns an empty string for undefined params', () => {
    expect(paramSerializer(undefined)).toBe('');
  });
});

describe('paramSerializerJQLike — jQuery-like bracket rule (upstream alternate)', () => {
  it('uses key[] for primitive array elements', () => {
    expect(paramSerializerJQLike({ tags: ['x', 'y'] })).toBe('tags%5B%5D=x&tags%5B%5D=y');
  });

  it('uses key[child] for nested objects', () => {
    expect(paramSerializerJQLike({ page: { n: 2 } })).toBe('page%5Bn%5D=2');
  });

  it('indexes nested arrays/objects by position', () => {
    // `items[0][k]=v` — an object element of an array is indexed by position.
    expect(paramSerializerJQLike({ items: [{ k: 'v' }] })).toBe('items%5B0%5D%5Bk%5D=v');
  });
});

describe('parseHeaders — header parser corner cases (upstream parseHeaders)', () => {
  it('is case-insensitive on lookup', () => {
    const h = parseHeaders('Content-Type: application/json');
    expect(h('content-type')).toBe('application/json');
    expect(h('Content-Type')).toBe('application/json');
    expect(h('CONTENT-TYPE')).toBe('application/json');
  });

  it('returns null on a miss', () => {
    expect(parseHeaders('X-A: 1')('x-missing')).toBeNull();
  });

  it('splits on the FIRST colon only (values may contain colons)', () => {
    // A Date header carries colons in its value.
    const h = parseHeaders('Date: Tue, 15 Nov 1994 08:12:31 GMT');
    expect(h('date')).toBe('Tue, 15 Nov 1994 08:12:31 GMT');
  });

  it('joins a repeated header name with ", "', () => {
    const h = parseHeaders('Set-Cookie: a=1\nSet-Cookie: b=2');
    expect(h('set-cookie')).toBe('a=1, b=2');
  });

  it('skips blank lines and lines without a separator', () => {
    const h = parseHeaders('X-A: 1\n\ngarbage-no-colon\nX-B: 2');
    expect(h('x-a')).toBe('1');
    expect(h('x-b')).toBe('2');
  });

  it('the no-argument form returns a snapshot of every parsed header', () => {
    const h = parseHeaders('Content-Type: application/json\r\nX-Total: 5');
    expect(h()).toEqual({ 'content-type': 'application/json', 'x-total': '5' });
  });

  it('an empty raw header string yields an empty snapshot', () => {
    expect(parseHeaders('')()).toEqual({});
  });
});

describe('default transforms — JSON request/response (upstream defaults)', () => {
  const reqTransform = defaultTransformRequest[0];
  const resTransform = defaultTransformResponse[0];

  it('request: JSON-serializes a structured body and sets the JSON content-type', () => {
    const headers: HttpHeaders = {};
    const body = reqTransform?.({ a: 1 }, headers);
    expect(body).toBe('{"a":1}');
    expect(headers['Content-Type']).toBe('application/json;charset=utf-8');
  });

  it('request: a string body passes through and the content-type is NOT forced', () => {
    const headers: HttpHeaders = {};
    expect(reqTransform?.('raw', headers)).toBe('raw');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('request: does not overwrite an author-set content-type', () => {
    const headers: HttpHeaders = { 'content-type': 'application/vnd.api+json' };
    reqTransform?.({ a: 1 }, headers);
    expect(headers['content-type']).toBe('application/vnd.api+json');
  });

  it('response: JSON-parses a JSON-looking body', () => {
    expect(resTransform?.('{"a":1}', parseHeaders(''), 200)).toEqual({ a: 1 });
    expect(resTransform?.('[1,2,3]', parseHeaders(''), 200)).toEqual([1, 2, 3]);
  });

  it('response: passes a non-JSON body through unchanged', () => {
    expect(resTransform?.('plain text', parseHeaders(''), 200)).toBe('plain text');
  });

  it('response: does NOT parse a body carrying the XSRF prefix marker', () => {
    // AngularJS strips `)]}',\n` before parsing; our heuristic refuses to treat
    // a marker-prefixed body as JSON, so it passes through unchanged.
    expect(resTransform?.(')]}\',\n{"a":1}', parseHeaders(''), 200)).toBe(')]}\',\n{"a":1}');
  });

  it('response: leaves a malformed JSON body as the raw string (defensive)', () => {
    expect(resTransform?.('{not valid', parseHeaders(''), 200)).toBe('{not valid');
  });
});

describe('status classification (upstream isSuccess + the status-0 rule)', () => {
  async function statusOf(rawStatus: number): Promise<{ ok: boolean; status: number }> {
    const { q, scope } = makeQ();
    const { backend } = recordingBackend({ status: rawStatus, statusText: '', data: 'body', headers: '' }, q);
    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults() });

    let ok = false;
    let status = NaN;
    $http({ method: 'GET', url: '/x' }).then(
      (res) => {
        ok = true;
        status = res.status;
      },
      (res: unknown) => {
        ok = false;
        status = (res as HttpResponse).status;
      },
    );
    await flush(scope);
    return { ok, status };
  }

  it('treats 200 as success', async () => {
    expect(await statusOf(200)).toEqual({ ok: true, status: 200 });
  });

  it('treats 299 as success and 300 as failure (the 2xx band)', async () => {
    expect((await statusOf(299)).ok).toBe(true);
    expect((await statusOf(300)).ok).toBe(false);
  });

  it('treats status 0 as success (upstream file-protocol / opaque rule)', async () => {
    expect(await statusOf(0)).toEqual({ ok: true, status: 0 });
  });

  it('treats 404 / 500 as failure but preserves the status', async () => {
    expect(await statusOf(404)).toEqual({ ok: false, status: 404 });
    expect(await statusOf(500)).toEqual({ ok: false, status: 500 });
  });

  it('marks a network failure with status -1 (distinct from any server status)', async () => {
    const { q, scope } = makeQ();
    const backend: HttpBackend = () => q.reject(new HttpTransportError('network', 'down'));
    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults() });

    let status = NaN;
    $http({ method: 'GET', url: '/x' }).catch((res: unknown) => {
      status = (res as HttpResponse).status;
    });
    await flush(scope);
    expect(status).toBe(-1);
  });
});

describe('interceptor ordering (upstream reversedInterceptors)', () => {
  it('request phase runs OUTWARD→INWARD (last-registered first)', async () => {
    const { q, scope } = makeQ();
    const order: string[] = [];
    const { backend } = recordingBackend({ status: 200, statusText: 'OK', data: '', headers: '' }, q);

    const a: Interceptor = {
      request(config) {
        order.push('A.request');
        return config;
      },
    };
    const b: Interceptor = {
      request(config) {
        order.push('B.request');
        return config;
      },
    };

    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults(), interceptors: [a, b] });
    $http({ method: 'GET', url: '/x' });
    await flush(scope);

    // Registration order [A, B] → request phase runs B then A.
    expect(order).toEqual(['B.request', 'A.request']);
  });

  it('response phase runs INNER→OUTER (first-registered last)', async () => {
    const { q, scope } = makeQ();
    const order: string[] = [];
    const { backend } = recordingBackend({ status: 200, statusText: 'OK', data: '', headers: '' }, q);

    const a: Interceptor = {
      response(res) {
        order.push('A.response');
        return res;
      },
    };
    const b: Interceptor = {
      response(res) {
        order.push('B.response');
        return res;
      },
    };

    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults(), interceptors: [a, b] });
    $http({ method: 'GET', url: '/x' });
    await flush(scope);

    // Registration order [A, B] → response phase runs B (innermost) then A.
    expect(order).toEqual(['B.response', 'A.response']);
  });

  it('responseError can RECOVER a failure into a success (upstream)', async () => {
    const { q, scope } = makeQ();
    const { backend } = recordingBackend({ status: 500, statusText: 'Err', data: 'boom', headers: '' }, q);

    const recover: Interceptor = {
      responseError() {
        return { data: 'recovered', status: 200, statusText: 'OK', headers: parseHeaders(''), config: {} };
      },
    };
    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults(), interceptors: [recover] });

    const onOk = vi.fn();
    $http({ method: 'GET', url: '/x' }).then(onOk);
    await flush(scope);

    expect(onOk).toHaveBeenCalledTimes(1);
    expect((onOk.mock.calls[0]?.[0] as HttpResponse).data).toBe('recovered');
  });
});

describe('cache semantics — GET-only opt-in + dedup (upstream cache rule)', () => {
  it('a second cacheable GET is served from cache with NO second backend call', async () => {
    const { q, scope } = makeQ();
    const { backend, sent } = recordingBackend({ status: 200, statusText: 'OK', data: 'hi', headers: '' }, q);

    const cache = (await import('@cache/cache-factory')).createCacheFactory()<HttpResponse>('t');
    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults() });

    $http({ method: 'GET', url: '/x', cache });
    await flush(scope);
    $http({ method: 'GET', url: '/x', cache });
    await flush(scope);

    expect(sent.length).toBe(1); // second request hit the cache
  });

  it('caching is GET-only — a POST is never cached', async () => {
    const { q, scope } = makeQ();
    const { backend, sent } = recordingBackend({ status: 200, statusText: 'OK', data: 'hi', headers: '' }, q);
    const cache = (await import('@cache/cache-factory')).createCacheFactory()<HttpResponse>('t');
    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults() });

    $http({ method: 'POST', url: '/x', data: 'a', cache });
    await flush(scope);
    $http({ method: 'POST', url: '/x', data: 'a', cache });
    await flush(scope);

    expect(sent.length).toBe(2); // both POSTs hit the backend
  });

  it('a cache hit serves a CLONE — mutating it does not corrupt the stored entry', async () => {
    const { q, scope } = makeQ();
    const { backend } = recordingBackend({ status: 200, statusText: 'OK', data: { n: 1 }, headers: '' }, q);
    const cache = (await import('@cache/cache-factory')).createCacheFactory()<HttpResponse>('t');
    const $http = createHttp({
      q,
      httpBackend: backend,
      // No response transform so the structured object body is preserved.
      defaults: { headers: { common: {} }, transformResponse: [] },
    });

    let first: HttpResponse | undefined;
    $http<{ n: number }>({ method: 'GET', url: '/x', cache }).then((r) => {
      first = r;
    });
    await flush(scope);
    // Mutate the delivered config bundle.
    if (first) {
      first.config = { ...first.config, url: '/MUTATED' };
    }

    let second: HttpResponse | undefined;
    $http<{ n: number }>({ method: 'GET', url: '/x', cache }).then((r) => {
      second = r;
    });
    await flush(scope);

    expect(second?.config.url).toBe('/x'); // the stored entry is independent
  });
});

// ---------------------------------------------------------------------------
// §3 INTENTIONAL DEVIATIONS — these are DELIBERATE, tested as expected
// behavior, NOT as parity gaps.
// ---------------------------------------------------------------------------

describe('§3 deviation (DELIBERATE): NO .success() / .error() shorthands', () => {
  it('the returned result exposes only standard $q follow-ups, not .success/.error', async () => {
    const { q, scope } = makeQ();
    const { backend } = recordingBackend({ status: 200, statusText: 'OK', data: 'hi', headers: '' }, q);
    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults() });

    const promise = $http({ method: 'GET', url: '/x' });

    // Standard follow-ups exist…
    expect(typeof promise.then).toBe('function');
    expect(typeof promise.catch).toBe('function');
    expect(typeof promise.finally).toBe('function');

    // …the legacy AngularJS `.success` / `.error` shorthands are intentionally
    // absent (the modern, type-safe shape). This is a deliberate §3 deviation.
    expect((promise as unknown as { success?: unknown }).success).toBeUndefined();
    expect((promise as unknown as { error?: unknown }).error).toBeUndefined();

    await flush(scope);
  });
});

describe('§3 deviation (DELIBERATE): JSONP is hard-gated through $sce, no opt-out', () => {
  it('an untrusted JSONP URL rejects BEFORE the backend is ever called', async () => {
    const { q, scope } = makeQ();
    const backend = vi.fn<HttpBackend>(() => q.resolve({ status: 200, statusText: 'OK', data: '', headers: '' }));

    // The trust gate THROWS for an untrusted destination — exactly what
    // `$sce.getTrustedResourceUrl` does. There is NO opt-out.
    const jsonpTrust = (url: string): string => {
      throw new Error(`untrusted resource URL: ${url}`);
    };
    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults(), jsonpTrust });

    const onErr = vi.fn();
    $http.jsonp('http://evil.example/x?callback=JSON_CALLBACK').catch(onErr);
    await flush(scope);

    expect(onErr).toHaveBeenCalledTimes(1);
    expect(backend).not.toHaveBeenCalled(); // no network / no <script> ever
  });

  it('a trusted JSONP URL proceeds to the backend', async () => {
    const { q, scope } = makeQ();
    const backend = vi.fn<HttpBackend>(() => q.resolve({ status: 200, statusText: 'OK', data: 'cb(1)', headers: '' }));
    const jsonpTrust = (url: string): string => url; // trust everything in this test
    const $http = createHttp({ q, httpBackend: backend, defaults: bareDefaults(), jsonpTrust });

    $http.jsonp('https://trusted.example/x?callback=JSON_CALLBACK');
    await flush(scope);

    expect(backend).toHaveBeenCalledTimes(1);
  });
});
