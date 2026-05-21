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
import { ngBindDirective } from '@compiler/ng-bind';
import { ngBindHtmlDirective } from '@compiler/ng-bind-html';
import { ngBindTemplateDirective } from '@compiler/ng-bind-template';
import { ngCloakDirective } from '@compiler/ng-cloak';
import { ngHideDirective } from '@compiler/ng-hide';
import { ngNonBindableDirective } from '@compiler/ng-non-bindable';
import { ngShowDirective } from '@compiler/ng-show';
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
  //
  // Spec 023 Slice 2 extends this block with `ngCloak` — the
  // compile-only directive that removes the `ng-cloak` attribute /
  // class once the compiler reaches the element so the
  // consumer-shipped `[ng-cloak], .ng-cloak { display: none !important; }`
  // CSS rule stops matching. See `src/compiler/ng-cloak.ts`.
  //
  // Spec 023 Slice 3 extends this block with `ngBind` and
  // `ngBindTemplate` — the text-binding directives that set an
  // element's `textContent` from a single expression
  // (`<span ng-bind="user.name">`) or a multi-expression template
  // string (`<span ng-bind-template="Hello {{name}}, today is {{day}}">`).
  // Both escape HTML automatically via `textContent` — the
  // security-relevant difference from spec 023 Slice 5's `ngBindHtml`.
  // See `src/compiler/ng-bind.ts` and `src/compiler/ng-bind-template.ts`.
  //
  // Spec 023 Slice 4 extends this block with `ngShow` and `ngHide` —
  // the visibility-toggle directives that add or remove the
  // `ng-hide` CSS class on an element based on the truthiness of an
  // expression. Both share the consumer-shipped
  // `.ng-hide { display: none !important; }` CSS rule; toggles are
  // synchronous in this spec (animations are deferred to Phase 4).
  // See `src/compiler/ng-show.ts` and `src/compiler/ng-hide.ts`.
  //
  // Spec 023 Slice 5 extends this block with `ngBindHtml` — the
  // trusted-HTML binding directive that evaluates an expression,
  // routes the value through `$sce.getTrustedHtml(...)` (consuming
  // the spec 013 `$sce` → `$sanitize` integration transparently when
  // `ngSanitize` is loaded), and writes the result to the element's
  // `innerHTML`. This is the security-relevant alternative to
  // `ngBind` — use it only when the value genuinely carries markup
  // verified safe by the SCE pipeline. See `src/compiler/ng-bind-html.ts`.
  //
  // Spec 023 Slice 6 extends this block with `ngNonBindable` — the
  // subtree-opt-out directive that signals the compiler walker to
  // skip descent into the element's children (literal `{{ }}` and
  // directive-looking child markup stay verbatim). The directive is
  // pure metadata (`restrict: 'AC'`, `terminal: true`, `priority: 1000`,
  // no compile / link); the heavy lifting lives in the Slice 1 walker
  // hook in `src/compiler/compile.ts`, narrowed to fire only when a
  // matched directive's `name === 'ngNonBindable'`. See
  // `src/compiler/ng-non-bindable.ts` for the file-level rationale
  // (including the narrowing audit note).
  .config([
    '$compileProvider',
    ($compileProvider: $CompileProvider) => {
      $compileProvider.directive('ngTransclude', ngTranscludeDirective);
      $compileProvider.directive('ngCloak', ngCloakDirective);
      $compileProvider.directive('ngBind', ngBindDirective);
      $compileProvider.directive('ngBindHtml', ngBindHtmlDirective);
      $compileProvider.directive('ngBindTemplate', ngBindTemplateDirective);
      $compileProvider.directive('ngShow', ngShowDirective);
      $compileProvider.directive('ngHide', ngHideDirective);
      $compileProvider.directive('ngNonBindable', ngNonBindableDirective);
    },
  ]);
