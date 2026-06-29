/**
 * `$cacheFactory` ESM-first factory (spec 038 Slice 1 / §2.2).
 *
 * `createCacheFactory()` returns a `$cacheFactory(id, options?)` callable
 * that produces named, Map-backed caches. Each call to
 * {@link createCacheFactory} builds a fresh registry closure, so
 * per-injector isolation is automatic when the DI factory invokes it once
 * per injector (the `$templateCache` precedent).
 *
 * The factory is PURE — it takes no inputs and touches no globals — so it
 * is unit-testable standalone; the `ngModule` registration just calls it.
 *
 * **Out of scope (documented):** `options.capacity` / LRU eviction is NOT
 * implemented. Every cache is an unbounded `Map`. See `cache-types.ts`
 * for the full rationale.
 */

import type { Cache, CacheFactory, CacheInfo, CacheOptions } from './cache-types';

/**
 * Create a fresh, isolated `$cacheFactory` instance.
 *
 * Each call returns a new factory backed by its own registry of caches —
 * two factories are entirely independent. The DI factory registered on
 * `ngModule` invokes this once per injector, giving every
 * `createInjector(['ng'])` call a fresh, empty registry.
 *
 * @example
 * ```ts
 * import { createCacheFactory } from 'my-own-angularjs/cache';
 *
 * const $cacheFactory = createCacheFactory();
 *
 * const cache = $cacheFactory<number>('counters');
 * cache.put('hits', 1);
 * cache.get('hits'); // => 1
 *
 * $cacheFactory.get('counters') === cache; // true
 * $cacheFactory.info(); // => { counters: { id: 'counters', size: 1 } }
 *
 * cache.destroy(); // id 'counters' is free again
 * ```
 */
export function createCacheFactory(): CacheFactory {
  // The registry of live caches, keyed by id. Lives in the closure so
  // each `createCacheFactory()` call (i.e. each injector) is isolated.
  const caches = new Map<string, Cache>();

  function cacheFactory<T = unknown>(id: string, options?: CacheOptions): Cache<T> {
    // `options` is accepted for AngularJS shape parity; `capacity`/LRU is
    // out of scope this spec, so it is intentionally unused. The reference
    // keeps the destructure-free signature stable for a future spec.
    void options;

    if (caches.has(id)) {
      // AngularJS parity: re-using an id without first destroying the
      // existing cache is a programming error.
      throw new Error(`cacheId ${id} taken`);
    }

    const store = new Map<string, T>();

    const cache: Cache<T> = {
      put(key: string, value: T) {
        store.set(key, value);
        return value;
      },
      get(key: string) {
        return store.get(key);
      },
      remove(key: string) {
        store.delete(key);
      },
      removeAll() {
        store.clear();
      },
      destroy() {
        store.clear();
        caches.delete(id);
      },
      info(): CacheInfo {
        return { id, size: store.size };
      },
    };

    // Store under the widened `Cache` (= `Cache<unknown>`) registry type.
    // The cast is a structural narrowing on read (`get<T>`) — the read site
    // restores the caller's requested `T`, matching the generic `put`/`get`
    // contract for the same id.
    caches.set(id, cache as Cache);
    return cache;
  }

  cacheFactory.get = function get<T = unknown>(id: string): Cache<T> | undefined {
    return caches.get(id) as Cache<T> | undefined;
  };

  cacheFactory.info = function info(): Record<string, CacheInfo> {
    const result: Record<string, CacheInfo> = {};
    for (const [id, cache] of caches) {
      result[id] = cache.info();
    }
    return result;
  };

  return cacheFactory;
}
