/**
 * Tests for `$templateRequest` (spec 019 Slice 3 / FS §2.6).
 *
 * Two layers are exercised:
 *
 * 1. **ESM factory layer** — `createTemplateRequest({ cache, fetcher })`
 *    wraps a cache with a fetch-and-cache pipeline. Tests inject a
 *    `vi.fn()` mock fetcher so no network access is required and the
 *    `inFlight` dedup machinery can be verified deterministically.
 * 2. **DI layer** — `injector.get('$templateRequest')` returns the
 *    service after `createInjector(['ng'])`; the service is backed by
 *    the injector's own `$templateCache`. The DI surface is tested
 *    with cache-seeded values (so the default `globalThis.fetch`
 *    fetcher never runs) and with a decorator that replaces
 *    `$templateRequest` wholesale to inject a mock fetcher.
 */

import { describe, expect, it, vi } from 'vitest';

import { TemplateFetchFailedError } from '@compiler/compile-error';
import { ngModule } from '@core/ng-module';
import { createInjector } from '@di/injector';
import { createModule } from '@di/module';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest, templateRequest } from '@template/template-request';
import { $TemplateRequestProvider } from '@template/template-request-provider';
import type { TemplateCacheService, TemplateFetcher, TemplateRequestFn } from '@template/template-types';

describe('createTemplateRequest() — ESM factory (FS §2.6)', () => {
  describe('cache hit', () => {
    it('resolves with the cached content WITHOUT calling the fetcher', async () => {
      const cache = createTemplateCache();
      cache.put('/tpl.html', '<p>cached</p>');
      const fetcher = vi.fn<TemplateFetcher>();
      const request = createTemplateRequest({ cache, fetcher });

      const result = await request('/tpl.html');

      expect(result).toBe('<p>cached</p>');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('returns a Promise that resolves on the next microtask (cache hit is still async)', async () => {
      const cache = createTemplateCache();
      cache.put('/tpl.html', '<p>cached</p>');
      const request = createTemplateRequest({ cache });

      const p = request('/tpl.html');

      expect(p).toBeInstanceOf(Promise);
      await expect(p).resolves.toBe('<p>cached</p>');
    });
  });

  describe('cache miss', () => {
    it('calls the fetcher once, writes the response into the cache, and resolves with the body', async () => {
      const cache = createTemplateCache();
      const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<p>fresh</p>'));
      const request = createTemplateRequest({ cache, fetcher });

      const result = await request('/tpl.html');

      expect(result).toBe('<p>fresh</p>');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith('/tpl.html');
      expect(cache.get('/tpl.html')).toBe('<p>fresh</p>');
    });

    it('subsequent requests after a cache populate hit the cache (no second fetch)', async () => {
      const cache = createTemplateCache();
      const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<p>fresh</p>'));
      const request = createTemplateRequest({ cache, fetcher });

      await request('/tpl.html');
      await request('/tpl.html');
      await request('/tpl.html');

      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrent dedup', () => {
    it('two concurrent calls before the fetcher resolves share a single fetcher invocation', async () => {
      const cache = createTemplateCache();
      let resolveFn: (text: string) => void = () => undefined;
      const pending = new Promise<string>((resolve) => {
        resolveFn = resolve;
      });
      const fetcher = vi.fn<TemplateFetcher>(() => pending);
      const request = createTemplateRequest({ cache, fetcher });

      const p1 = request('/tpl.html');
      const p2 = request('/tpl.html');

      // Fetcher should have been called exactly once even though two
      // requests are in flight against the same URL.
      expect(fetcher).toHaveBeenCalledTimes(1);

      resolveFn('<p>shared</p>');

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('<p>shared</p>');
      expect(r2).toBe('<p>shared</p>');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('after the in-flight fetch resolves, clearing the cache lets a subsequent request re-fetch', async () => {
      const cache = createTemplateCache();
      const fetcher = vi.fn<TemplateFetcher>(() => Promise.resolve('<p>v1</p>'));
      const request = createTemplateRequest({ cache, fetcher });

      await request('/tpl.html');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cache.get('/tpl.html')).toBe('<p>v1</p>');

      // Clear the cache — the next request should hit the fetcher
      // again because the inFlight entry was removed on resolution.
      cache.remove('/tpl.html');
      fetcher.mockResolvedValueOnce('<p>v2</p>');

      const result = await request('/tpl.html');

      expect(result).toBe('<p>v2</p>');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(cache.get('/tpl.html')).toBe('<p>v2</p>');
    });

    it('different URLs do not share an in-flight slot', async () => {
      const cache = createTemplateCache();
      const fetcher = vi.fn<TemplateFetcher>((url: string) => Promise.resolve(`<p>${url}</p>`));
      const request = createTemplateRequest({ cache, fetcher });

      const [a, b] = await Promise.all([request('/a.html'), request('/b.html')]);

      expect(a).toBe('<p>/a.html</p>');
      expect(b).toBe('<p>/b.html</p>');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('rejection paths', () => {
    it('propagates TemplateFetchFailedError from the fetcher on non-2xx', async () => {
      const cache = createTemplateCache();
      const fetcher: TemplateFetcher = (url: string) =>
        Promise.reject(new TemplateFetchFailedError(url, '404 Not Found'));
      const request = createTemplateRequest({ cache, fetcher });

      await expect(request('/missing.html')).rejects.toBeInstanceOf(TemplateFetchFailedError);
      await expect(request('/missing.html')).rejects.toThrow('Failed to load template "/missing.html": 404 Not Found');
    });

    it('propagates a plain Error from a network rejection', async () => {
      const cache = createTemplateCache();
      const networkErr = new Error('network down');
      const fetcher: TemplateFetcher = () => Promise.reject(networkErr);
      const request = createTemplateRequest({ cache, fetcher });

      await expect(request('/tpl.html')).rejects.toBe(networkErr);
    });

    it('after a rejection, the in-flight entry is cleared so a subsequent request re-fetches', async () => {
      const cache = createTemplateCache();
      const fetcher = vi.fn<TemplateFetcher>();
      fetcher.mockRejectedValueOnce(new Error('attempt 1 failed'));
      fetcher.mockResolvedValueOnce('<p>recovered</p>');
      const request = createTemplateRequest({ cache, fetcher });

      await expect(request('/tpl.html')).rejects.toThrow('attempt 1 failed');
      const recovered = await request('/tpl.html');

      expect(recovered).toBe('<p>recovered</p>');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(cache.get('/tpl.html')).toBe('<p>recovered</p>');
    });
  });

  describe('ignoreRequestError flag', () => {
    it('resolves with `undefined` instead of rejecting when fetcher throws', async () => {
      const cache = createTemplateCache();
      const fetcher: TemplateFetcher = () => Promise.reject(new Error('boom'));
      const request = createTemplateRequest({ cache, fetcher });

      const result = await request('/tpl.html', true);

      expect(result).toBeUndefined();
    });

    it('still resolves with content on the success path (true does NOT mask successful resolution)', async () => {
      const cache = createTemplateCache();
      const fetcher: TemplateFetcher = () => Promise.resolve('<p>ok</p>');
      const request = createTemplateRequest({ cache, fetcher });

      const result = await request('/tpl.html', true);

      expect(result).toBe('<p>ok</p>');
    });

    it('cache-hit path also resolves with content (not undefined) when ignoreRequestError is true', async () => {
      const cache = createTemplateCache();
      cache.put('/tpl.html', '<p>cached</p>');
      const fetcher = vi.fn<TemplateFetcher>();
      const request = createTemplateRequest({ cache, fetcher });

      const result = await request('/tpl.html', true);

      expect(result).toBe('<p>cached</p>');
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('false (explicit) behaves like undefined — rejections propagate', async () => {
      const cache = createTemplateCache();
      const fetcher: TemplateFetcher = () => Promise.reject(new Error('boom'));
      const request = createTemplateRequest({ cache, fetcher });

      await expect(request('/tpl.html', false)).rejects.toThrow('boom');
    });
  });

  describe('default fetcher', () => {
    it('uses globalThis.fetch when no fetcher is supplied (smoke — call is wired)', async () => {
      // Stub globalThis.fetch with a deterministic ok response. We do
      // this in-test (not as a module-level mock) so the override is
      // scoped and other tests that inject their own fetcher are
      // unaffected.
      const cache = createTemplateCache();
      const originalFetch = globalThis.fetch;
      const stub = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response('<p>via fetch</p>', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/html' },
          }),
        ),
      );
      globalThis.fetch = stub as unknown as typeof fetch;

      try {
        const request = createTemplateRequest({ cache });
        const result = await request('/from-fetch.html');
        expect(result).toBe('<p>via fetch</p>');
        expect(stub).toHaveBeenCalledWith('/from-fetch.html');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('default fetcher rejects with TemplateFetchFailedError on non-2xx response', async () => {
      const cache = createTemplateCache();
      const originalFetch = globalThis.fetch;
      const stub = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          new Response('not found', {
            status: 404,
            statusText: 'Not Found',
          }),
        ),
      );
      globalThis.fetch = stub as unknown as typeof fetch;

      try {
        const request = createTemplateRequest({ cache });
        await expect(request('/missing.html')).rejects.toBeInstanceOf(TemplateFetchFailedError);
        await expect(request('/missing.html')).rejects.toThrow(
          'Failed to load template "/missing.html": 404 Not Found',
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('per-instance isolation', () => {
    it('two createTemplateRequest closures over independent caches do not share state', async () => {
      const cacheA = createTemplateCache();
      const cacheB = createTemplateCache();
      const fetcherA = vi.fn<TemplateFetcher>(() => Promise.resolve('<p>A</p>'));
      const fetcherB = vi.fn<TemplateFetcher>(() => Promise.resolve('<p>B</p>'));
      const requestA = createTemplateRequest({ cache: cacheA, fetcher: fetcherA });
      const requestB = createTemplateRequest({ cache: cacheB, fetcher: fetcherB });

      await requestA('/tpl.html');
      await requestB('/tpl.html');

      expect(cacheA.get('/tpl.html')).toBe('<p>A</p>');
      expect(cacheB.get('/tpl.html')).toBe('<p>B</p>');
      expect(fetcherA).toHaveBeenCalledTimes(1);
      expect(fetcherB).toHaveBeenCalledTimes(1);
    });
  });

  describe('default `templateRequest` singleton export', () => {
    it('is a callable TemplateRequestFn', () => {
      expect(typeof templateRequest).toBe('function');
    });
  });
});

describe('$templateRequest — DI registration on ngModule (FS §2.6)', () => {
  it("injector.get('$templateRequest') returns the service after createInjector(['ng'])", () => {
    const injector = createInjector([ngModule]);
    const request = injector.get('$templateRequest');

    expect(typeof request).toBe('function');
  });

  it("injector.has('$templateRequest') === true", () => {
    const injector = createInjector([ngModule]);
    expect(injector.has('$templateRequest')).toBe(true);
  });

  it('repeated lookups within a single injector return the same singleton', () => {
    const injector = createInjector([ngModule]);
    const a: TemplateRequestFn = injector.get('$templateRequest');
    const b: TemplateRequestFn = injector.get('$templateRequest');

    expect(a).toBe(b);
  });

  it('seeded cache short-circuits the fetcher — pre-populate $templateCache, request resolves from cache', async () => {
    const injector = createInjector([ngModule]);
    const cache = injector.get('$templateCache');
    const request = injector.get('$templateRequest');

    cache.put('/seeded.html', '<p>seeded</p>');

    await expect(request('/seeded.html')).resolves.toBe('<p>seeded</p>');
    expect(cache.get('/seeded.html')).toBe('<p>seeded</p>');
  });

  it('two createInjector calls produce independent $templateRequest closures (per-injector isolation)', async () => {
    const injectorA = createInjector([ngModule]);
    const injectorB = createInjector([ngModule]);

    const requestA = injectorA.get('$templateRequest');
    const requestB = injectorB.get('$templateRequest');
    const cacheA = injectorA.get('$templateCache');
    const cacheB = injectorB.get('$templateCache');

    expect(requestA).not.toBe(requestB);

    // Seed cacheA only. requestA resolves from cacheA; requestB does
    // not see the seed (and would attempt a fetch — we don't trigger
    // it here, we just verify the lookups are independent).
    cacheA.put('/seed.html', '<p>only in A</p>');

    await expect(requestA('/seed.html')).resolves.toBe('<p>only in A</p>');
    expect(cacheB.get('/seed.html')).toBeUndefined();
  });

  it('decorator-based mock fetcher: module.decorator replaces $templateRequest with a closure over a mock fetcher', async () => {
    const fetcher = vi.fn<TemplateFetcher>((url: string) => Promise.resolve(`<p>${url}</p>`));
    const appModule = createModule('app-templaterequest-decorator', ['ng']).decorator('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher }),
    ]);

    const injector = createInjector([ngModule, appModule]);
    const request = injector.get('$templateRequest');

    const result = await request('/decorated.html');

    expect(result).toBe('<p>/decorated.html</p>');
    expect(fetcher).toHaveBeenCalledTimes(1);
    // The decorator-replaced service still writes through to the
    // injector's $templateCache because we passed it the injected
    // cache instance.
    expect(injector.get('$templateCache').get('/decorated.html')).toBe('<p>/decorated.html</p>');
  });
});

describe('$TemplateRequestProvider — config-phase provider shim (FS §2.13)', () => {
  it("module.config(['$templateRequestProvider', …]) receives a $TemplateRequestProvider instance", () => {
    let captured: $TemplateRequestProvider | undefined;
    const appModule = createModule('app-templaterequest-provider-config', ['ng']).config([
      '$templateRequestProvider',
      (provider: $TemplateRequestProvider) => {
        captured = provider;
      },
    ]);

    createInjector([ngModule, appModule]);

    expect(captured).toBeInstanceOf($TemplateRequestProvider);
  });

  it("the provider's $get wires $templateCache through and produces a working $templateRequest end-to-end", async () => {
    const injector = createInjector([ngModule]);
    const cache = injector.get('$templateCache');
    const request = injector.get('$templateRequest');

    cache.put('/seeded-via-provider.html', '<p>seeded</p>');

    // The run-phase service produced by the provider's $get must read
    // from the SAME $templateCache instance the injector exposes —
    // this is the contract that lets apps seed the cache and have
    // $templateRequest short-circuit the fetcher.
    await expect(request('/seeded-via-provider.html')).resolves.toBe('<p>seeded</p>');
  });
});
