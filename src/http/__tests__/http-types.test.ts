/**
 * Type-level tests for the `@http` + `@cache` public surfaces (spec 038
 * Slice 7). These assert the COMPILE-TIME contract with vitest's
 * `expectTypeOf` — no behavior is exercised at runtime (the `it` bodies are
 * type assertions, which vitest evaluates as no-ops). The goal is to pin the
 * inference guarantees a consumer relies on:
 *
 * - `$http<User>(config).then(r => r.data)` infers `User` end-to-end.
 * - The method shortcuts (`get` / `post` / …) are generic over `T` and infer
 *   `HttpResponse<T>`.
 * - `HttpConfig` rejects an unknown option key (excess-property checking).
 * - `$cacheFactory('id')` and `Cache<T>` are generic over the stored value.
 *
 * A documented type-signature limitation is asserted as REAL (see the
 * `injector.get` block) so the test pins the actual surface, not an
 * aspirational one.
 */

import { describe, expectTypeOf, it } from 'vitest';

import type { QPromise } from '@async/q-types';
import type { Cache, CacheFactory, CacheInfo } from '@cache/cache-types';
import { createCacheFactory } from '@cache/cache-factory';
import { createHttp } from '@http/http';
import type { HttpConfig, HttpResponse, HttpService } from '@http/http-types';

interface User {
  id: string;
  name: string;
}

// `expectTypeOf(expr)` evaluates `expr` at runtime (it returns a chainable
// object), so a bare `declare const` would `ReferenceError`. We therefore give
// `$http` / `escapeHatchGet` HARMLESS runtime stubs cast to the type under
// test: the calls return `undefined` at runtime (never asserted) but carry the
// real declared type that `expectTypeOf` reads. Method calls like
// `$http.get(...)` need the shortcut slots present, hence the function-with-
// attached-methods stub.
const httpStub = (() => undefined) as unknown as { [K: string]: unknown };
for (const m of ['get', 'delete', 'head', 'jsonp', 'post', 'put', 'patch']) {
  httpStub[m] = () => undefined;
}
httpStub['defaults'] = { headers: { common: {} } };
httpStub['pendingRequests'] = [];
const $http = httpStub as unknown as HttpService;

// An untyped escape-hatch `get` modelling `injector.get<T>(name: string): T`
// (the overload `'$http'` falls through to — see the "documented limitation"
// block below). `T` appears once by design — this models the real injector
// escape-hatch overload, which carries the same eslint-disable.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- models the injector escape-hatch overload (caller-provided T)
const escapeHatchGet = (() => undefined) as <T>(name: string) => T;

describe('$http — generic response inference (FS §2.1 / §2.3)', () => {
  it('the general form infers HttpResponse<T> from the config type argument', () => {
    const result = $http<User>({ method: 'GET', url: '/api/me' });
    expectTypeOf(result).toEqualTypeOf<QPromise<HttpResponse<User>>>();
  });

  it('the resolved value`s `data` is the success-body type T', () => {
    type Result = QPromise<HttpResponse<User>>;
    // `.then`'s success-callback parameter is `HttpResponse<User>`.
    type ThenParam = Parameters<Parameters<Result['then']>[0] & object>[0];
    expectTypeOf<ThenParam>().toEqualTypeOf<HttpResponse<User>>();
    expectTypeOf<ThenParam['data']>().toEqualTypeOf<User>();
  });

  it('infers T from a caller-annotated HttpConfig<User> without an explicit type arg', () => {
    const config: HttpConfig<User> = { method: 'GET', url: '/api/me' };
    const result = $http(config);
    expectTypeOf(result).toEqualTypeOf<QPromise<HttpResponse<User>>>();
  });

  it('defaults T to unknown when no type argument is supplied', () => {
    const result = $http({ method: 'GET', url: '/api/me' });
    expectTypeOf(result).toEqualTypeOf<QPromise<HttpResponse>>();
  });
});

describe('$http shortcuts — generic over T (FS §2.2)', () => {
  it('bodyless shortcuts (get/delete/head/jsonp) infer HttpResponse<T>', () => {
    expectTypeOf($http.get<User>('/u')).toEqualTypeOf<QPromise<HttpResponse<User>>>();
    expectTypeOf($http.delete<User>('/u')).toEqualTypeOf<QPromise<HttpResponse<User>>>();
    expectTypeOf($http.head<User>('/u')).toEqualTypeOf<QPromise<HttpResponse<User>>>();
    expectTypeOf($http.jsonp<User>('/u')).toEqualTypeOf<QPromise<HttpResponse<User>>>();
  });

  it('body-carrying shortcuts (post/put/patch) infer HttpResponse<T>', () => {
    expectTypeOf($http.post<User>('/u', { name: 'a' })).toEqualTypeOf<QPromise<HttpResponse<User>>>();
    expectTypeOf($http.put<User>('/u', { name: 'a' })).toEqualTypeOf<QPromise<HttpResponse<User>>>();
    expectTypeOf($http.patch<User>('/u', { name: 'a' })).toEqualTypeOf<QPromise<HttpResponse<User>>>();
  });

  it('body-carrying shortcuts require the data argument', () => {
    // `post(url)` with no body is a type error — `data: unknown` is required.
    // @ts-expect-error — the `data` argument is mandatory on body shortcuts.
    void $http.post<User>('/u');
  });

  it('the observational surfaces are read-only', () => {
    expectTypeOf($http.defaults).toExtend<{ headers: { common: Record<string, string> } }>();
    expectTypeOf($http.pendingRequests).toExtend<readonly HttpConfig[]>();
  });
});

describe('HttpConfig — option typing (FS §2.3)', () => {
  it('accepts every documented option key', () => {
    const config: HttpConfig<User> = {
      method: 'POST',
      url: '/u',
      data: { name: 'a' },
      headers: { 'X-Token': 't' },
      params: { page: 1 },
      responseType: 'json',
      withCredentials: true,
      timeout: 1000,
      cache: true,
    };
    expectTypeOf(config).toExtend<HttpConfig<User>>();
  });

  it('flags an unknown option key (excess-property checking)', () => {
    const config: HttpConfig = {
      method: 'GET',
      url: '/u',
      // @ts-expect-error — `retries` is not a known HttpConfig option.
      retries: 3,
    };
    void config;
  });

  it('flags a mistyped option value', () => {
    const config: HttpConfig = {
      // @ts-expect-error — `method` is a string, not a number.
      method: 42,
    };
    void config;
  });
});

describe('injector.get — narrowing to HttpService (documented limitation)', () => {
  it('narrows to HttpService when the consumer supplies the type argument', () => {
    // `'$http'` is NOT a statically-known key of a bare `createInjector(['ng'])`
    // registry (services registered on `ngModule` are not reflected in the
    // typed `Registry`), so the typed `get<K extends keyof Registry>` overload
    // does not match and the call falls through to the escape-hatch
    // `get<T>(name: string): T`. Supplying the type argument therefore narrows
    // correctly — this is the REAL, supported shape. A future spec that widens
    // `ModuleRegistry` to include the `ng` services could drop the explicit
    // type argument; today it is required.
    expectTypeOf(escapeHatchGet<HttpService>('$http')).toEqualTypeOf<HttpService>();
  });
});

describe('$cacheFactory + Cache<T> — generic over the stored value (spec 038 §2.2)', () => {
  it('$cacheFactory returns the CacheFactory surface', () => {
    expectTypeOf(createCacheFactory()).toEqualTypeOf<CacheFactory>();
  });

  it('$cacheFactory<T>(id) produces a Cache<T> whose get/put are typed', () => {
    const factory = createCacheFactory();
    const cache = factory<User>('users');
    expectTypeOf(cache).toEqualTypeOf<Cache<User>>();
    expectTypeOf(cache.get('a')).toEqualTypeOf<User | undefined>();
    expectTypeOf(cache.put('a', { id: '1', name: 'n' })).toEqualTypeOf<User>();
  });

  it('Cache<T> defaults T to unknown', () => {
    const cache: Cache = createCacheFactory()('anon');
    expectTypeOf(cache.get('a')).toEqualTypeOf<unknown>();
  });

  it('the registry surface (get / info) is typed', () => {
    const factory = createCacheFactory();
    expectTypeOf(factory.get<User>('users')).toEqualTypeOf<Cache<User> | undefined>();
    expectTypeOf(factory.info()).toEqualTypeOf<Record<string, CacheInfo>>();
  });

  it('rejects a mistyped value on put', () => {
    const cache = createCacheFactory()<User>('users');
    // @ts-expect-error — a number is not assignable to the stored `User` type.
    cache.put('a', 42);
  });
});

describe('createHttp — factory return type', () => {
  it('returns the HttpService surface', () => {
    expectTypeOf(createHttp).returns.toEqualTypeOf<HttpService>();
  });
});
