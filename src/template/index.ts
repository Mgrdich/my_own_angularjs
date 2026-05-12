/**
 * Public barrel for the template-loading module (spec 019).
 *
 * Slice 2 lit up the `$templateCache` service via the
 * `createTemplateCache` ESM factory + a shared default `templateCache`
 * singleton. Slice 3 adds the `$templateRequest` service via the
 * `createTemplateRequest` factory + the shared default `templateRequest`
 * instance (which wraps the default `templateCache` with a
 * `globalThis.fetch`-based fetcher). A follow-up additive change adds
 * `$TemplateCacheProvider` / `$TemplateRequestProvider` DI shims so
 * `module.config(['$templateCacheProvider', …])` resolves at config
 * phase — neither shim has a config-phase API in this spec.
 *
 * `NormalizedTemplate` is intentionally re-exported here so other
 * internal modules (and any future structural-directives spec) can
 * import the internal post-normalize shape from this barrel; it is
 * NOT re-exported from the root `src/index.ts` barrel to preserve
 * the public/internal boundary.
 */

export { createTemplateCache, templateCache } from './template-cache';
export { $TemplateCacheProvider } from './template-cache-provider';
export { createTemplateRequest, templateRequest } from './template-request';
export type { CreateTemplateRequestArgs } from './template-request';
export { $TemplateRequestProvider } from './template-request-provider';
export type {
  NormalizedTemplate,
  TemplateCacheInfo,
  TemplateCacheService,
  TemplateFetcher,
  TemplateFn,
  TemplateRequestFn,
  TemplateUrlFn,
} from './template-types';
