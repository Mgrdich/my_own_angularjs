/**
 * Public barrel for the `@sanitize` module — the opt-in `ngSanitize`
 * companion to `$sce`.
 *
 * Slice 3 adds the ESM `createSanitize` factory and the `sanitize`
 * default instance on top of the type surface and frozen default
 * allow-lists laid down in earlier slices. Slice 4 layers on the
 * DI-shaped exports — the `$SanitizeProvider` provider shim and the
 * opt-in `ngSanitize` module that registers it as `$sanitize`.
 *
 * `$SanitizeProvider` itself is reachable via
 * `injector.get('$sanitizeProvider')` during `config()` and is
 * deliberately NOT re-exported from the root `src/index.ts` barrel —
 * that's the AngularJS-idiomatic surface.
 */

export { createSanitize, sanitize } from './sanitize';
export { $SanitizeProvider } from './sanitize-provider';
export { ngSanitize } from './ng-sanitize-module';
export type { SanitizeService, SanitizeOptions, AddValidElementsArg } from './sanitize-types';
