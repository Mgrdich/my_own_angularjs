/**
 * `$templateCache` ESM-first factory (spec 019 §2.5 / Slice 2).
 *
 * A simple Map-backed key-value store keyed by template URL (or any
 * arbitrary string for apps that want to seed templates at boot under
 * stable identifiers). Each call to {@link createTemplateCache}
 * produces a fresh, isolated `Map<string, string>` closed over by the
 * returned methods — so per-injector isolation is automatic when the
 * DI factory calls `createTemplateCache()` once per injector.
 *
 * The factory takes no inputs; there is no config surface in this
 * spec. A future spec that adds configuration (e.g. an LRU eviction
 * policy or a maximum size) will add a `$templateCacheProvider`
 * around this factory without breaking the current zero-arg shape.
 */

import type { TemplateCacheInfo, TemplateCacheService } from './template-types';

/**
 * Create a fresh, isolated `$templateCache` instance.
 *
 * Each call returns a new service backed by its own `Map<string, string>`
 * — two instances are entirely independent, so test fixtures and apps
 * can freely create scratch caches without leaking state across each
 * other. The DI factory registered on `ngModule` invokes this once per
 * injector, giving every `createInjector(['ng'])` call a fresh cache.
 *
 * @example
 * ```ts
 * import { createTemplateCache } from 'my-own-angularjs/template';
 *
 * const cache = createTemplateCache();
 * cache.put('/tpl/card.html', '<div class="card"><h2>Hi</h2></div>');
 *
 * cache.get('/tpl/card.html');
 * // => '<div class="card"><h2>Hi</h2></div>'
 *
 * cache.info();
 * // => { id: 'templates', size: 1 }
 *
 * cache.remove('/tpl/card.html');
 * cache.get('/tpl/card.html');
 * // => undefined
 * ```
 */
export function createTemplateCache(): TemplateCacheService {
  const map = new Map<string, string>();

  return {
    put(key: string, content: string): string {
      map.set(key, content);
      return content;
    },
    get(key: string): string | undefined {
      return map.get(key);
    },
    remove(key: string): void {
      map.delete(key);
    },
    removeAll(): void {
      map.clear();
    },
    info(): TemplateCacheInfo {
      return { id: 'templates', size: map.size };
    },
  };
}

/**
 * Pre-constructed default `$templateCache` instance for ESM-first
 * standalone use (tests + apps that want a shared cache without going
 * through DI).
 *
 * This is a **single shared singleton** at module scope — every
 * importer of `templateCache` from `@template/index` sees the same
 * cache instance. Apps that need per-app isolation (multiple injectors
 * sharing the same Node process, test fixtures that should not leak
 * across cases, etc.) MUST call {@link createTemplateCache} directly
 * to obtain a fresh, isolated instance. The DI path on `ngModule`
 * already does this — `injector.get('$templateCache')` returns a
 * closure-fresh instance per injector.
 *
 * @example
 * ```ts
 * import { templateCache } from 'my-own-angularjs/template';
 *
 * templateCache.put('/tpl/header.html', '<header>…</header>');
 *
 * // Anywhere else in the same process — same cache instance:
 * templateCache.get('/tpl/header.html');
 * // => '<header>…</header>'
 * ```
 */
export const templateCache: TemplateCacheService = createTemplateCache();
