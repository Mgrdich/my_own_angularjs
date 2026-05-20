/**
 * `ng` — AngularJS-core DI module.
 *
 * Registers the core run-phase services (`$exceptionHandler`, `$sceDelegate`,
 * `$sce`, `$interpolate`) and their config-phase providers
 * (`$sceDelegateProvider`, `$sceProvider`, `$interpolateProvider`) via the
 * spec 008 `.provider()` recipe. Registration order is informational — the
 * actual instantiation order is driven by the DI dependency graph (`$sce`
 * depends on `$sceDelegate`, `$interpolate` depends on `$sce`). Future specs
 * add their `.provider(...)` call here.
 *
 * Consumers compose their own injector with `createInjector([ngModule, ...])`
 * and use `config(['$interpolateProvider', p => p.startSymbol('[[')])` or
 * `config(['$sceProvider', p => p.enabled(false)])` to customize behavior
 * before the run phase begins.
 */

import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import { ngTranscludeDirective } from '@compiler/ng-transclude';
import { $ControllerProvider } from '@controller/controller-provider';
import type { ControllerService } from '@controller/controller-types';
import { createModule } from '@di/module';
import { consoleErrorExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { lowercaseFilterFactory, uppercaseFilterFactory } from '@filter/case';
import { currencyFilterFactory } from '@filter/currency';
import { dateFilterFactory } from '@filter/date';
import { filterFilterFactory } from '@filter/filter-filter';
import { $FilterProvider } from '@filter/filter-provider';
import type { FilterFn, FilterService } from '@filter/filter-types';
import { jsonFilterFactory } from '@filter/json';
import { limitToFilterFactory } from '@filter/limit-to';
import { defaultLocale } from '@filter/locale';
import type { LocaleService } from '@filter/locale-types';
import { numberFilterFactory } from '@filter/number';
import { orderByFilterFactory } from '@filter/order-by';
import { $InterpolateProvider } from '@interpolate/interpolate-provider';
import type { InterpolateService } from '@interpolate/interpolate-types';
import { $SceDelegateProvider } from '@sce/sce-delegate-provider';
import { $SceProvider } from '@sce/sce-provider';
import type { SceDelegateService, SceService } from '@sce/sce-types';
import { $TemplateCacheProvider } from '@template/template-cache-provider';
import { $TemplateRequestProvider } from '@template/template-request-provider';
import type { TemplateCacheService, TemplateRequestFn } from '@template/template-types';

declare module '@di/di-types' {
  interface ModuleRegistry {
    ng: {
      registry: {
        $exceptionHandler: ExceptionHandler;
        $interpolate: InterpolateService;
        $sceDelegate: SceDelegateService;
        $sce: SceService;
        $filter: FilterService;
        $locale: LocaleService;
        $controller: ControllerService;
        $compile: CompileService;
        $templateCache: TemplateCacheService;
        $templateRequest: TemplateRequestFn;
        uppercaseFilter: FilterFn;
        lowercaseFilter: FilterFn;
        jsonFilter: FilterFn;
        limitToFilter: FilterFn;
        currencyFilter: FilterFn;
        numberFilter: FilterFn;
        dateFilter: FilterFn;
        filterFilter: FilterFn;
        orderByFilter: FilterFn;
      };
      config: {
        $interpolateProvider: $InterpolateProvider;
        $sceDelegateProvider: $SceDelegateProvider;
        $sceProvider: $SceProvider;
        $filterProvider: $FilterProvider;
        $controllerProvider: $ControllerProvider;
        $compileProvider: $CompileProvider;
        $templateCacheProvider: $TemplateCacheProvider;
        $templateRequestProvider: $TemplateRequestProvider;
      };
    };
  }
}

// TODO(spec-016 Slice 4): when `$rootScope` lands as a registered factory
// (Bootstrap roadmap item), construct it via
// `Scope.create({ filterLookup: $filter, exceptionHandler: $exceptionHandler })`
// so filter expressions resolve out of the box on the injector-built scope
// tree. Until then, scope's `filterLookup` option is exercised by tests
// directly — see `src/filter/__tests__/scope-watch-integration.test.ts`.
export const ngModule = createModule('ng', [])
  .factory('$exceptionHandler', [() => consoleErrorExceptionHandler])
  .provider('$sceDelegate', $SceDelegateProvider)
  .provider('$sce', $SceProvider)
  .provider('$interpolate', $InterpolateProvider)
  .provider<'$filter', FilterService, $FilterProvider>('$filter', ['$provide', $FilterProvider])
  // `$controller` (spec 020) — registered BEFORE `$compile` because the
  // Slice 4 spec wires the compiler's per-element controller seam against
  // a resolved `$controller` injected into `$CompileProvider.$get`. Order
  // among providers is otherwise informational (DI resolves on dependency
  // graph, not registration order), but keeping the source-order parity
  // with the runtime dep graph makes the intent obvious to readers.
  .provider<'$controller', ControllerService, $ControllerProvider>('$controller', ['$provide', $ControllerProvider])
  .provider<'$compile', CompileService, $CompileProvider>('$compile', ['$provide', $CompileProvider])
  // `$locale` carries the en-US default. Apps swap the entire object
  // via `module.factory('$locale', () => myLocale)` — the `currency`,
  // `number`, and (Slice 8) `date` filters read it lazily so a swap at
  // config time takes effect at run time (FS §2.20).
  .factory('$locale', [() => defaultLocale])
  // Built-in filters — registered through the Slice-3 `.filter()` DSL so each
  // routes through `$provide.factory(<name>Filter, factory)` and is reachable
  // both as `$filter('<name>')` and as `injector.get('<name>Filter')`. All
  // are stateless (no `$stateful` flag); FS §2.7 acceptance.
  .filter('uppercase', uppercaseFilterFactory)
  .filter('lowercase', lowercaseFilterFactory)
  .filter('json', jsonFilterFactory)
  .filter('limitTo', limitToFilterFactory)
  .filter('currency', currencyFilterFactory)
  .filter('number', numberFilterFactory)
  .filter('date', dateFilterFactory)
  .filter('filter', filterFilterFactory)
  .filter('orderBy', orderByFilterFactory)
  // `$templateCache` — Map-backed key-value store for templates (spec
  // 019 Slice 2). Each injector receives its own isolated cache; the
  // provider's `$get` closes over a fresh `Map<string, string>` per
  // invocation. Apps seed templates from a `config()` or `run()` block
  // via `$templateCache.put(url, content)`; subsequent `templateUrl`
  // resolutions (Slice 6) hit the cache without a network fetch.
  // The provider class is registered (rather than a bare `.factory(...)`)
  // so `injector.get('$templateCacheProvider')` resolves at config
  // phase; spec 019 ships no config-phase API on it, but the public
  // contract per §2.13 requires the provider to be reachable.
  .provider('$templateCache', $TemplateCacheProvider)
  // `$templateRequest` — fetch-and-cache pipeline over `$templateCache`
  // (spec 019 Slice 3). Closes over a per-injector `inFlight` map for
  // concurrent-fetch deduplication; uses the default
  // `globalThis.fetch`-based fetcher. Apps that need auth headers,
  // `$http` integration, or test-mode network stubbing override the
  // service via `module.decorator('$templateRequest', …)` or replace
  // the factory wholesale. As with `$templateCache`, the provider class
  // is registered so the AngularJS-canonical
  // `module.config(['$templateRequestProvider', …])` shape resolves.
  .provider('$templateRequest', $TemplateRequestProvider)
  // Built-in directives — spec 018 Slice 5 introduces the FIRST
  // `.directive(...)` registration on `ngModule`. The module DSL
  // currently has no `.directive(...)` method, so we register via a
  // config block on `$compileProvider`. `ngTransclude` is the
  // slot-marker directive consumed by transcluding hosts to render
  // captured content (default / named / fallback paths). See
  // `src/compiler/ng-transclude.ts` for the implementation.
  .config([
    '$compileProvider',
    ($compileProvider: $CompileProvider) => {
      $compileProvider.directive('ngTransclude', ngTranscludeDirective);
    },
  ]);
