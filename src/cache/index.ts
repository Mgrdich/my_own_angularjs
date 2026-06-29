/**
 * Public barrel for the `@cache` module — the general-purpose cache
 * factory (`$cacheFactory`, spec 038 Slice 1).
 *
 * Exposes the pure {@link createCacheFactory} factory plus its public
 * types (`CacheFactory`, `Cache`, `CacheInfo`, `CacheOptions`). The DI
 * registration lives on `ngModule` (`src/core/ng-module.ts`), not here —
 * mirroring the `@async` / `@template` precedent where a service ships a
 * pure factory AND a separate `ngModule` registration.
 */

export { createCacheFactory } from './cache-factory';
export type { Cache, CacheFactory, CacheInfo, CacheOptions } from './cache-types';
