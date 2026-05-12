/**
 * `$TemplateCacheProvider` — DI-facing configurator shim for the
 * `$templateCache` service (spec 019 §2.13 acceptance).
 *
 * `$templateCache` is a Map-backed key-value store with no config-phase
 * surface in spec 019 — every method is a run-phase operation on a live
 * cache instance. The provider class is still registered (rather than a
 * bare `.factory(...)`) so apps can write the AngularJS-canonical
 * `module.config(['$templateCacheProvider', (p) => …])` shape and reach
 * the provider during the config phase via `injector.get('$templateCacheProvider')`.
 *
 * This shim follows the same ESM-first factory + DI shim pattern as
 * `$SceProvider`, `$InterpolateProvider`, `$SanitizeProvider`, and
 * `$FilterProvider` — `$get` is a typed array invokable that the
 * run-phase injector drains to produce the actual service via
 * {@link createTemplateCache}. The provider holds no instance state
 * today; future specs that add configuration (e.g. an LRU eviction
 * policy or a maximum size) will introduce `$$`-prefixed private fields
 * + fluent setters without breaking the current zero-config shape.
 *
 * The `$` prefix on the class name is the AngularJS convention for
 * built-in service providers.
 *
 * @example
 * ```ts
 * // Config-phase access (future configuration would happen here):
 * createModule('app', ['ng']).config([
 *   '$templateCacheProvider',
 *   (provider: $TemplateCacheProvider) => {
 *     // Reserved for future config hooks. Today the provider is
 *     // stateless — the config block can still resolve it, which is
 *     // the public-API contract this shim guarantees.
 *   },
 * ]);
 *
 * // Run-phase access (unchanged from prior slices):
 * const injector = createInjector([ngModule]);
 * const cache = injector.get('$templateCache');
 * cache.put('/tpl/card.html', '<div class="card">…</div>');
 * ```
 */

import { createTemplateCache } from './template-cache';
import type { TemplateCacheService } from './template-types';

export class $TemplateCacheProvider {
  /**
   * Injector-facing factory. Array-style invokable with no
   * dependencies — the run-phase injector calls the trailing function
   * exactly once per injector and caches the result, giving each
   * `createInjector(['ng'])` its own isolated cache (the factory closes
   * over a fresh `Map<string, string>` per invocation).
   */
  $get = [(): TemplateCacheService => createTemplateCache()] as const;
}
