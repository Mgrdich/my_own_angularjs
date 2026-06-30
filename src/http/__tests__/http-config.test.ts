/**
 * Tests for the `$http` Slice-3 configuration surface (spec 038 Slice 3 /
 * FS §2.2, §2.4, §2.5, §2.6, §2.9).
 *
 * Four concerns are exercised against the STUBBED-backend seam established in
 * `http-core.test.ts`:
 *
 * 1. **Method shortcuts** — bodyless (`delete` / `head`) and body-carrying
 *    (`post` / `put` / `patch`) each issue the right method/url/body.
 * 2. **Param serialization** — the default serializer (escaping + array +
 *    object + Date rules) plus a swappable custom serializer.
 * 3. **Header merge** — `common` + per-method + per-request override,
 *    case-insensitive, request-wins.
 * 4. **JSON transforms** — structured body → JSON text + JSON content-type;
 *    string body pass-through; non-JSON response pass-through; a custom
 *    transform array runs.
 */

import { describe, expect, it, vi } from 'vitest';

import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { Scope } from '@core/index';
import { noopExceptionHandler } from '@exception-handler/index';
import { createHttp } from '@http/http';
import { HttpTransportError } from '@http/http-backend';
import { defaultTransformRequest, defaultTransformResponse, paramSerializer, paramSerializerJQLike } from '@http/index';
import type { HttpBackend, HttpConfig, HttpDefaults, RawResponse } from '@http/http-types';

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

const okRaw: RawResponse = { status: 200, statusText: 'OK', data: '', headers: '' };

/** The defaults the `$HttpProvider` ships, mirrored for standalone factory tests. */
const fullDefaults: HttpDefaults = {
  headers: {
    common: { Accept: 'application/json, text/plain, */*' },
    post: { 'Content-Type': 'application/json;charset=utf-8' },
    put: { 'Content-Type': 'application/json;charset=utf-8' },
    patch: { 'Content-Type': 'application/json;charset=utf-8' },
  },
  paramSerializer,
  transformRequest: defaultTransformRequest,
  transformResponse: defaultTransformResponse,
};

describe('$http method shortcuts (FS §2.2)', () => {
  it('the bodyless shortcuts (delete/head) issue the right method/url with no body', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http.delete('/items/1');
    $http.head('/items/1');

    const del = spy.mock.calls[0]?.[0] as HttpConfig;
    const head = spy.mock.calls[1]?.[0] as HttpConfig;
    expect(del.method).toBe('DELETE');
    expect(del.url).toBe('/items/1');
    expect(del.data).toBeUndefined();
    expect(head.method).toBe('HEAD');
    expect(head.url).toBe('/items/1');
    expect(head.data).toBeUndefined();
  });

  it('the body-carrying shortcuts (post/put/patch) send the body to the backend', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http.post('/items', { name: 'a' });
    $http.put('/items/1', { name: 'b' });
    $http.patch('/items/1', { name: 'c' });

    const post = spy.mock.calls[0]?.[0] as HttpConfig;
    const put = spy.mock.calls[1]?.[0] as HttpConfig;
    const patch = spy.mock.calls[2]?.[0] as HttpConfig;
    expect(post.method).toBe('POST');
    expect(post.url).toBe('/items');
    // The default request transform JSON-serializes the structured body.
    expect(post.data).toBe('{"name":"a"}');
    expect(put.method).toBe('PUT');
    expect(put.data).toBe('{"name":"b"}');
    expect(patch.method).toBe('PATCH');
    expect(patch.data).toBe('{"name":"c"}');
  });

  it('a per-request config override flows through a shortcut', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http.post('/items', 'raw-string', { headers: { 'X-Custom': '1' } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    // A string body passes through unchanged (no JSON serialization).
    expect(sent.data).toBe('raw-string');
    expect(sent.headers?.['X-Custom']).toBe('1');
  });
});

describe('$http param serialization (FS §2.5)', () => {
  it('serializes a structured params object onto the URL with correct escaping', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http({ method: 'GET', url: '/search', params: { q: 'a b&c', page: 2 } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    // Keys are sorted; spaces become `+`, `&` is escaped.
    expect(sent.url).toBe('/search?page=2&q=a+b%26c');
  });

  it('repeats the key for array params and skips null/undefined', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http({ method: 'GET', url: '/x', params: { tags: ['x', 'y'], skip: null, gone: undefined } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.url).toBe('/x?tags=x&tags=y');
  });

  it('serializes objects as JSON and Dates as ISO strings', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http({ method: 'GET', url: '/x', params: { from: new Date(0), filter: { active: true } } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.url).toBe('/x?filter=%7B%22active%22:true%7D&from=1970-01-01T00:00:00.000Z');
  });

  it('respects an existing query string on the URL', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http({ method: 'GET', url: '/x?existing=1', params: { added: 2 } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.url).toBe('/x?existing=1&added=2');
  });

  it('uses a per-request custom paramSerializer over the default', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http({
      method: 'GET',
      url: '/x',
      params: { a: 1, b: 2 },
      paramSerializer: () => 'CUSTOM',
    });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.url).toBe('/x?CUSTOM');
  });

  it('uses defaults.paramSerializer (the jQuery-like variant) when configured', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({
      q,
      httpBackend: backend,
      defaults: { ...fullDefaults, paramSerializer: paramSerializerJQLike },
    });

    $http({ method: 'GET', url: '/x', params: { tags: ['a', 'b'] } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    // Bracket notation for arrays.
    expect(sent.url).toBe('/x?tags%5B%5D=a&tags%5B%5D=b');
  });
});

describe('$http header merge (FS §2.4)', () => {
  it('layers common + per-method + per-request, request wins, case-insensitive', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    // A per-request `content-type` (lowercase) overrides the per-method default
    // `Content-Type` despite the casing difference.
    $http.post('/x', 'body', { headers: { 'content-type': 'text/plain', 'X-Req': '1' } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.headers?.Accept).toBe('application/json, text/plain, */*');
    expect(sent.headers?.['content-type']).toBe('text/plain');
    expect(sent.headers?.['Content-Type']).toBeUndefined();
    expect(sent.headers?.['X-Req']).toBe('1');
  });

  it('a per-method default header appears only on that method', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http.get('/x');
    $http.post('/x', 'b');

    const get = spy.mock.calls[0]?.[0] as HttpConfig;
    const post = spy.mock.calls[1]?.[0] as HttpConfig;
    expect(get.headers?.['Content-Type']).toBeUndefined();
    expect(post.headers?.['Content-Type']).toBe('application/json;charset=utf-8');
  });
});

describe('$http JSON transforms (FS §2.6 / §2.9)', () => {
  it('serializes a structured body to JSON text and sets a JSON content-type', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    // No per-method content-type default here so we prove the TRANSFORM sets it.
    const $http = createHttp({
      q,
      httpBackend: backend,
      defaults: {
        headers: { common: {} },
        paramSerializer,
        transformRequest: defaultTransformRequest,
        transformResponse: defaultTransformResponse,
      },
    });

    $http({ method: 'POST', url: '/x', data: { a: 1 } });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.data).toBe('{"a":1}');
    expect(sent.headers?.['Content-Type']).toBe('application/json;charset=utf-8');
  });

  it('passes a plain-string body through without JSON conversion', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http({ method: 'POST', url: '/x', data: 'already a string' });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.data).toBe('already a string');
  });

  it('JSON-parses a JSON-looking response body by default', async () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => ({
      status: 200,
      statusText: 'OK',
      data: '{"id":7,"name":"x"}',
      headers: 'Content-Type: application/json',
    }));
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    const onSuccess = vi.fn();
    $http<{ id: number; name: string }>({ method: 'GET', url: '/x' }).then(onSuccess);

    scope.$digest();
    await Promise.resolve();
    scope.$digest();

    const res = onSuccess.mock.calls[0]?.[0] as { data: { id: number; name: string } };
    expect(res.data).toEqual({ id: 7, name: 'x' });
  });

  it('passes a non-JSON response body through unparsed', async () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => ({
      status: 200,
      statusText: 'OK',
      data: 'plain text body',
      headers: '',
    }));
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    const onSuccess = vi.fn();
    $http({ method: 'GET', url: '/x' }).then(onSuccess);

    scope.$digest();
    await Promise.resolve();
    scope.$digest();

    const res = onSuccess.mock.calls[0]?.[0] as { data: unknown };
    expect(res.data).toBe('plain text body');
  });

  it('runs a per-request custom transformResponse array, replacing the default', async () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => ({
      status: 200,
      statusText: 'OK',
      data: 'abc',
      headers: '',
    }));
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    const onSuccess = vi.fn();
    $http({
      method: 'GET',
      url: '/x',
      transformResponse: [(data) => `${String(data)}!`, (data) => String(data).toUpperCase()],
    }).then(onSuccess);

    scope.$digest();
    await Promise.resolve();
    scope.$digest();

    const res = onSuccess.mock.calls[0]?.[0] as { data: unknown };
    // Folded left-to-right: 'abc' -> 'abc!' -> 'ABC!'.
    expect(res.data).toBe('ABC!');
  });

  it('runs a per-request custom transformRequest array, replacing the default', () => {
    const { q } = makeQ();
    const { backend, spy } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    $http({
      method: 'POST',
      url: '/x',
      data: 'seed',
      transformRequest: (data) => `${String(data)}-wrapped`,
    });

    const sent = spy.mock.calls[0]?.[0] as HttpConfig;
    expect(sent.data).toBe('seed-wrapped');
  });

  it('a throwing transform rejects the promise (NOT routed through $exceptionHandler)', async () => {
    const { q, scope } = makeQ();
    const { backend } = stubBackend(q, () => okRaw);
    const $http = createHttp({ q, httpBackend: backend, defaults: fullDefaults });

    const onFailure = vi.fn();
    $http({
      method: 'POST',
      url: '/x',
      data: 'x',
      transformRequest: () => {
        throw new Error('boom');
      },
    }).then(undefined, onFailure);

    scope.$digest();
    await Promise.resolve();
    scope.$digest();

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect((onFailure.mock.calls[0]?.[0] as Error).message).toBe('boom');
  });
});
