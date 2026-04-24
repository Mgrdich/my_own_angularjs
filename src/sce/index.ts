/**
 * Public barrel for the `$sce` (Strict Contextual Escaping) module.
 *
 * Slice 1 exposed the foundation (contexts, trusted-value classes, type
 * guards). Slice 3 added the always-strict `createSceDelegate` factory and
 * its pre-configured `sceDelegate` default export. Slice 4 added the
 * user-facing `createSce` façade plus its `sce` default instance. Slice 5
 * adds the DI provider shims (`$SceDelegateProvider`, `$SceProvider`) —
 * exported here so tests and advanced consumers can construct them
 * directly without a path-alias dance. The providers remain internal to
 * the library's public API (they are NOT re-exported from `src/index.ts`);
 * normal consumers reach them via `injector.get('$sceProvider')` etc.
 * during `config()`.
 *
 * Internal-only symbols (`SCE_CONTEXT_ANY`, `SceContextAny`,
 * `TrustedValueAny`, the compiled matcher helpers) are deliberately omitted
 * from this barrel.
 */

export { SCE_CONTEXTS, isValidSceContext } from '@sce/sce-contexts';
export {
  TrustedValue,
  TrustedHtml,
  TrustedUrl,
  TrustedResourceUrl,
  TrustedJs,
  TrustedCss,
  isTrustedValue,
  isTrustedFor,
} from '@sce/trusted-values';
export { createSceDelegate, sceDelegate } from '@sce/sce-delegate';
export { createSce, sce } from '@sce/sce';
export { $SceDelegateProvider } from '@sce/sce-delegate-provider';
export { $SceProvider } from '@sce/sce-provider';
export type {
  SceContext,
  ResourceUrlListEntry,
  SceDelegateOptions,
  SceOptions,
  SceDelegateService,
  SceService,
  SceParsedFn,
} from '@sce/sce-types';
