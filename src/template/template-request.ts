/**
 * `$templateRequest` ESM-first factory (spec 019 §2.6 / Slice 3).
 *
 * Wraps `$templateCache` with a fetch-and-cache pipeline keyed by URL:
 * a cache hit short-circuits the network; a cache miss kicks off a
 * single `TemplateFetcher` call whose body is written back to the
 * cache for subsequent requests. Concurrent requests for the same URL
 * share a single in-flight promise via an internal
 * `inFlight: Map<string, Promise<string>>` — only ONE network call
 * happens per URL while a request is outstanding, regardless of how
 * many callers wait on the result.
 *
 * The factory takes the cache and an optional `fetcher` as inputs.
 * The default fetcher routes through `globalThis.fetch` and reads the
 * response body as text; non-2xx HTTP statuses are converted into a
 * rejected promise carrying a {@link TemplateFetchFailedError}. Tests
 * inject a mock fetcher via the `fetcher` parameter to avoid touching
 * the network.
 *
 * Per-injector isolation is automatic — the DI factory registered on
 * `ngModule` (`createTemplateRequest({ cache: $templateCache })`)
 * constructs a fresh closure per injector, so the `inFlight` map is
 * never shared across injectors.
 *
 * @example
 * ```ts
 * // Standalone (ESM) usage with a mock fetcher:
 * import { createTemplateRequest } from 'my-own-angularjs/template';
 * import { createTemplateCache } from 'my-own-angularjs/template';
 *
 * const cache = createTemplateCache();
 * const request = createTemplateRequest({
 *   cache,
 *   fetcher: async () => '<p>hi</p>',
 * });
 *
 * const html = await request('/tpl/card.html');
 * // html: '<p>hi</p>'
 * cache.get('/tpl/card.html');
 * // => '<p>hi</p>'   — the response was cached on resolution
 * ```
 */

import { TemplateFetchFailedError } from '@compiler/compile-error';

import { templateCache } from './template-cache';
import type { TemplateCacheService, TemplateFetcher, TemplateRequestFn } from './template-types';

/**
 * Default `TemplateFetcher` used by {@link createTemplateRequest}
 * when no `fetcher` is supplied. Routes through the global `fetch`
 * function and reads the response body as text; non-2xx HTTP statuses
 * become a rejected promise carrying a {@link TemplateFetchFailedError}
 * whose message includes the URL plus the status and status text.
 *
 * Apps running in an environment without `globalThis.fetch` (older
 * Node, restricted sandboxes) must inject their own fetcher via the
 * `createTemplateRequest({ fetcher })` factory argument — the default
 * implementation will throw a `ReferenceError` if `fetch` is missing
 * at the moment of first use.
 *
 * @example
 * ```ts
 * import { defaultFetcher } from 'my-own-angularjs/template/template-request';
 *
 * try {
 *   const html = await defaultFetcher('/tpl/card.html');
 * } catch (err) {
 *   if (err instanceof TemplateFetchFailedError) {
 *     console.warn(err.message);
 *   }
 * }
 * ```
 */
const defaultFetcher: TemplateFetcher = async (url: string): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new TemplateFetchFailedError(url, `${String(response.status)} ${response.statusText}`);
  }
  return response.text();
};

/**
 * Arguments accepted by {@link createTemplateRequest}.
 *
 * The `cache` is required — `$templateRequest` is meaningless without
 * a backing cache. The `fetcher` is optional and defaults to a
 * `globalThis.fetch`-based implementation; tests and apps that want
 * to inject auth headers, route through `$http`, or stub the network
 * pass their own `TemplateFetcher` here.
 */
export interface CreateTemplateRequestArgs {
  /** The `$templateCache` instance (cache hits short-circuit fetch). */
  readonly cache: TemplateCacheService;
  /**
   * Optional fetcher injection seam. Defaults to a
   * `globalThis.fetch`-based implementation that converts non-2xx
   * HTTP statuses into a rejected promise carrying a
   * {@link TemplateFetchFailedError}.
   */
  readonly fetcher?: TemplateFetcher;
}

/**
 * Create a `$templateRequest` function backed by the supplied cache
 * and fetcher.
 *
 * Per-call lifecycle:
 *
 * 1. If `cache.get(url)` is set, return `Promise.resolve(cached)` —
 *    resolution happens on the next microtask, matching the
 *    AngularJS-canonical contract.
 * 2. Otherwise check the in-flight map for `url`. If an entry exists,
 *    return that promise so concurrent callers share the same chain
 *    (including the cache-write side effect on resolution).
 * 3. Otherwise call `fetcher(url)`. On success, write the response
 *    body into the cache and clear the in-flight entry. On failure,
 *    clear the in-flight entry and re-throw so the next request can
 *    retry.
 * 4. If `ignoreRequestError === true`, attach a `.catch(() => undefined)`
 *    so rejections become `undefined` resolutions — used by directives
 *    that want to render a fallback rather than route an error.
 *
 * The in-flight map ensures only ONE network request is outstanding
 * per URL. Once the fetcher resolves (success or failure), the entry
 * is removed so a subsequent request can re-fetch if the cache was
 * cleared between resolution and the next call.
 *
 * @example
 * ```ts
 * // Inject a mock fetcher in tests:
 * import { createTemplateCache, createTemplateRequest } from 'my-own-angularjs/template';
 *
 * const cache = createTemplateCache();
 * const fetcher = vi.fn(async (url: string) => `<p>${url}</p>`);
 * const request = createTemplateRequest({ cache, fetcher });
 *
 * const result = await request('/tpl.html');
 * expect(result).toBe('<p>/tpl.html</p>');
 * expect(fetcher).toHaveBeenCalledTimes(1);
 *
 * // Subsequent calls hit the cache:
 * await request('/tpl.html');
 * expect(fetcher).toHaveBeenCalledTimes(1);
 * ```
 *
 * @example
 * ```ts
 * // ignoreRequestError pattern — fall back to `undefined` on error:
 * const fetcher = vi.fn(async () => { throw new Error('network down'); });
 * const request = createTemplateRequest({ cache: createTemplateCache(), fetcher });
 *
 * const result = await request('/maybe-missing.html', true);
 * expect(result).toBeUndefined();
 * ```
 */
export function createTemplateRequest(args: CreateTemplateRequestArgs): TemplateRequestFn {
  const { cache, fetcher = defaultFetcher } = args;
  const inFlight = new Map<string, Promise<string>>();

  return (url: string, ignoreRequestError?: boolean): Promise<string | undefined> => {
    const cached = cache.get(url);
    if (cached !== undefined) {
      const cachedPromise: Promise<string> = Promise.resolve(cached);
      return ignoreRequestError === true ? cachedPromise.catch(() => undefined) : cachedPromise;
    }

    let pending = inFlight.get(url);
    if (pending === undefined) {
      pending = fetcher(url).then(
        (text) => {
          cache.put(url, text);
          inFlight.delete(url);
          return text;
        },
        (err: unknown) => {
          inFlight.delete(url);
          throw err;
        },
      );
      inFlight.set(url, pending);
    }

    return ignoreRequestError === true ? pending.catch(() => undefined) : pending;
  };
}

/**
 * Pre-constructed default `$templateRequest` instance for ESM-first
 * standalone use — wraps the shared default `templateCache` singleton
 * with the default `globalThis.fetch`-based fetcher.
 *
 * This instance is intended for standalone (non-DI) consumers — for
 * the DI path, prefer `injector.get('$templateRequest')` which
 * resolves to a per-injector closure backed by that injector's
 * `$templateCache`. Mixing the two paths in the same app means two
 * independent `inFlight` maps and two independent caches, which is
 * usually a bug — pick one.
 *
 * @example
 * ```ts
 * import { templateRequest } from 'my-own-angularjs/template';
 *
 * const html = await templateRequest('/tpl/header.html');
 * // First call hits the network; subsequent calls hit the cache.
 * ```
 */
export const templateRequest: TemplateRequestFn = createTemplateRequest({ cache: templateCache });
