/**
 * Shared test fixtures for the compiler test suite.
 *
 * Every compiler test needs the canonical `ng` module wired with the
 * same set of providers ($sce, $interpolate, $filter, $templateCache,
 * $templateRequest, $compile, …). Centralizing the bootstrap here keeps
 * the per-test files focused on directive registration and assertions,
 * and means adding a new `ng`-module service is a one-line edit in
 * this file instead of an N-file sweep.
 *
 * Two helpers are exported:
 *
 * - `bootstrapNgModule(options?)` — resets the module registry and
 *   re-registers `'ng'` with the canonical provider set. Pass
 *   `{ exceptionHandler }` to override the default no-op
 *   `$exceptionHandler` (used by tests that need to spy on routed
 *   errors at the `ng`-module layer).
 *
 * - `compileWith(register)` — creates an `app` module that depends on
 *   `'ng'`, runs the supplied config callback against `$compileProvider`,
 *   and returns the resolved `$compile` service.
 *
 * Tests that want a `$exceptionHandler` spy at the app-module layer
 * (rather than the ng-module factory layer) can call
 * `bootstrapNgModule()` and then `.factory('$exceptionHandler', …)` on
 * their own `app` module — that pattern is unchanged by this helper.
 *
 * This file is INTERNAL to the test suite: it lives under `__tests__/`,
 * is not re-exported from any public barrel, and has no path-alias
 * dependents outside this directory.
 */

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { $ControllerProvider } from '@controller/controller-provider';
import { createInjector } from '@di/injector';
import { createModule, resetRegistry } from '@di/module';
import { $FilterProvider } from '@filter/filter-provider';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import { createTemplateCache } from '@template/template-cache';
import { createTemplateRequest } from '@template/template-request';
import type { TemplateCacheService, TemplateFetcher, TemplateRequestFn } from '@template/template-types';

export interface BootstrapNgModuleOptions {
  /**
   * Overrides the default no-op `$exceptionHandler` on the `ng` module.
   * Pass a `vi.fn()` to capture errors routed through the digest's
   * exception-handler pipeline.
   */
  exceptionHandler?: (...args: unknown[]) => void;
  /**
   * Overrides the default fetcher used by `$templateRequest`. Tests for
   * the deferred-template-queue path inject a mock to control the cache
   * miss + reject / resolve cycle.
   */
  fetcher?: TemplateFetcher;
}

/**
 * Resets the module registry and re-registers `'ng'` with the canonical
 * provider set used across every compiler test. The optional
 * `exceptionHandler` and `fetcher` options replace the corresponding
 * defaults on the `ng` module so tests can spy on routed errors or
 * stub template-fetching behavior without rebuilding the bootstrap.
 */
export function bootstrapNgModule(options?: BootstrapNgModuleOptions): void {
  const handler = options?.exceptionHandler ?? ((): void => undefined);
  const fetcher = options?.fetcher;
  resetRegistry();
  createModule('ng', [])
    .factory('$exceptionHandler', [() => handler])
    .provider('$sceDelegate', $SceDelegateProvider)
    .provider('$sce', $SceProvider)
    .provider('$interpolate', $InterpolateProvider)
    .provider('$filter', ['$provide', $FilterProvider])
    // `$controller` (spec 020) — registered BEFORE `$compile` so the
    // compiler's per-element controller seam (Slice 4) can resolve
    // `'$controller'` from `$CompileProvider.$get`'s deps array. The
    // production `ngModule` registers the two in the same order; the
    // compiler test bootstrap mirrors that here.
    .provider('$controller', ['$provide', $ControllerProvider])
    .factory('$templateCache', [() => createTemplateCache()])
    .factory('$templateRequest', [
      '$templateCache',
      (cache: TemplateCacheService): TemplateRequestFn => createTemplateRequest({ cache, fetcher }),
    ])
    .provider('$compile', ['$provide', $CompileProvider]);
}

/**
 * Builds an `app` module that depends on `'ng'`, runs the caller's
 * config callback against `$compileProvider`, and returns the resolved
 * `$compile` service. Mirrors the verbatim copy that lived in 20
 * compiler test files prior to spec-019.
 */
export function compileWith(register: ($cp: $CompileProvider) => void): CompileService {
  const appModule = createModule('app', ['ng']).config([
    '$compileProvider',
    ($cp: $CompileProvider) => {
      register($cp);
    },
  ]);
  return createInjector([appModule]).get('$compile');
}
