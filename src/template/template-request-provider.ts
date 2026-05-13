/**
 * `$TemplateRequestProvider` — DI-facing configurator shim for the
 * `$templateRequest` service (spec 019 §2.13 acceptance).
 *
 * `$templateRequest` is a fetch-and-cache pipeline over `$templateCache`
 * with in-flight deduplication; spec 019 ships it with no config-phase
 * surface, but the provider class is still registered (rather than a
 * bare `.factory(...)`) so apps can write the AngularJS-canonical
 * `module.config(['$templateRequestProvider', (p) => …])` shape and
 * reach the provider during the config phase via
 * `injector.get('$templateRequestProvider')`.
 *
 * This shim follows the same ESM-first factory + DI shim pattern as
 * `$SceProvider`, `$InterpolateProvider`, `$SanitizeProvider`, and
 * `$FilterProvider`. The provider holds no instance state today; a
 * likely future addition is a `fetcher(fn?)` getter/setter that lets
 * apps swap the default `globalThis.fetch`-based fetcher at config time
 * (the ESM factory already accepts a `fetcher` parameter — this would
 * just surface that seam through DI). Adding such setters is additive
 * and does not break the current zero-config shape.
 *
 * The `$` prefix on the class name is the AngularJS convention for
 * built-in service providers.
 *
 * @example
 * ```ts
 * // Config-phase access (future configuration would happen here):
 * createModule('app', ['ng']).config([
 *   '$templateRequestProvider',
 *   (provider: $TemplateRequestProvider) => {
 *     // Reserved for future config hooks (e.g. a custom fetcher).
 *     // Today the provider is stateless — the config block can still
 *     // resolve it, which is the public-API contract this shim guarantees.
 *   },
 * ]);
 *
 * // Run-phase access (unchanged from prior slices):
 * const injector = createInjector([ngModule]);
 * const request = injector.get('$templateRequest');
 * const html = await request('/tpl/card.html');
 * ```
 */

import { createTemplateRequest } from './template-request';
import type { TemplateCacheService, TemplateRequestFn } from './template-types';

export class $TemplateRequestProvider {
  /**
   * Injector-facing factory. Array-style invokable declaring
   * `$templateCache` as its single dependency — the injector resolves
   * the cache first and passes it in, so the produced
   * `$templateRequest` is automatically wired against the same per-injector
   * cache instance that `injector.get('$templateCache')` returns. The
   * `inFlight: Map<string, Promise<string>>` map is closed over per
   * injector and never shared across injectors.
   */
  $get = [
    '$templateCache',
    (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache }),
  ] as const;
}
