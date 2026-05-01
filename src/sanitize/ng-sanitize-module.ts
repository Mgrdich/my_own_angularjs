/**
 * `ngSanitize` — opt-in DI module that ships the `$sanitize` HTML scrubber.
 *
 * Unlike `ngModule` (the always-on AngularJS-core module), `ngSanitize`
 * registers independently. Apps that want HTML sanitization compose it
 * alongside the core via `createInjector([ngModule, ngSanitize, myApp])`;
 * apps that do not need sanitization simply omit it and pay neither the
 * code-size nor the runtime cost.
 *
 * Registered names:
 * - `$sanitize` (run-phase service): the callable
 *   `(input: unknown) => string` produced by `$SanitizeProvider.$get`.
 * - `$sanitizeProvider` (config-phase): the configurator class
 *   {@link $SanitizeProvider}, exposing `addValidElements`, `addValidAttrs`,
 *   `enableSvg`, and `uriPattern` for use in `config()` blocks.
 *
 * Slice 5 of spec 013 wires this module into `$sce` via a lazy
 * `$injector.has('$sanitize')` probe so that `$sce.getTrustedHtml` falls
 * back to `$sanitize` when no trusted wrapper is present. That integration
 * lives in the `$sce` module — `ngSanitize` itself stays self-contained
 * and has no knowledge of `$sce`.
 *
 * The registry-augmentation block below adds a SECOND top-level key to
 * `ModuleRegistry` (the first being `ng`, declared in
 * `src/core/ng-module.ts`). TypeScript's declaration merging composes the
 * two interfaces into a single registry that the DI tuple typings consult.
 */

import { createModule } from '@di/module';
import { $SanitizeProvider } from '@sanitize/sanitize-provider';
import type { SanitizeService } from '@sanitize/sanitize-types';

declare module '@di/di-types' {
  interface ModuleRegistry {
    ngSanitize: {
      registry: {
        $sanitize: SanitizeService;
      };
      config: {
        $sanitizeProvider: $SanitizeProvider;
      };
    };
  }
}

export const ngSanitize = createModule('ngSanitize', []).provider('$sanitize', $SanitizeProvider);
