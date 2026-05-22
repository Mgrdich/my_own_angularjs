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
import {
  ngCheckedDirective,
  ngDisabledDirective,
  ngHrefDirective,
  ngOpenDirective,
  ngReadonlyDirective,
  ngSelectedDirective,
  ngSrcDirective,
  ngSrcsetDirective,
} from '@compiler/ng-attribute-aliases';
import { ngBindDirective } from '@compiler/ng-bind';
import { ngBindHtmlDirective } from '@compiler/ng-bind-html';
import { ngBindTemplateDirective } from '@compiler/ng-bind-template';
import { ngClassDirective, ngClassEvenDirective, ngClassOddDirective } from '@compiler/ng-class';
import { ngCloakDirective } from '@compiler/ng-cloak';
import {
  ngBlurDirective,
  ngClickDirective,
  ngCopyDirective,
  ngCutDirective,
  ngDblclickDirective,
  ngFocusDirective,
  ngKeydownDirective,
  ngKeypressDirective,
  ngKeyupDirective,
  ngMousedownDirective,
  ngMouseenterDirective,
  ngMouseleaveDirective,
  ngMousemoveDirective,
  ngMouseoutDirective,
  ngMouseoverDirective,
  ngMouseupDirective,
  ngPasteDirective,
  ngSubmitDirective,
} from '@compiler/ng-event-directives';
import { ngHideDirective } from '@compiler/ng-hide';
import { ngNonBindableDirective } from '@compiler/ng-non-bindable';
import { ngShowDirective } from '@compiler/ng-show';
import { ngStyleDirective } from '@compiler/ng-style';
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
      // Spec 024 Slice 1 — `ngClass` dynamically toggles CSS classes
      // on an element from a scope expression. Three expression forms
      // (string / array / object) are normalized via the shared
      // `flattenClassExpression` helper; a `$watchCollection` listener
      // diffs the current set against the previous and only ever
      // removes classes the directive itself added (the
      // classes-preserved guarantee). See `src/compiler/ng-class.ts`.
      $compileProvider.directive('ngClass', ngClassDirective);
      // Spec 024 Slice 2 — `ngClassEven` and `ngClassOdd` are
      // index-gated variants of `ngClass` driven by `scope.$even` /
      // `scope.$odd` (canonically set by `ng-repeat`, manually-set
      // today). They share the same `installClassWatcher` engine as
      // `ngClass`; the engine takes a gate predicate plus the gate's
      // scope-property name so a secondary `scope.$watch('$even', …)`
      // re-fires the diff when the gate flips with the expression
      // itself unchanged. Each instance maintains its own
      // `appliedClasses` set, so combining `ngClass` /
      // `ngClassEven` / `ngClassOdd` on the same element works as
      // expected — the rendered class set is the union of each
      // directive's contribution. See `src/compiler/ng-class.ts`.
      $compileProvider.directive('ngClassEven', ngClassEvenDirective);
      $compileProvider.directive('ngClassOdd', ngClassOddDirective);
      // Spec 024 Slice 3 — `ngStyle` dynamically sets inline CSS
      // styles on an element from a scope expression. Object-only
      // expression form (`{ cssProperty: value }`); a per-instance
      // `appliedProps` set drives the diff cycle so consumer-shipped
      // inline styles (e.g. `<div style="margin: 5px">`) are
      // preserved unless the directive's expression later names the
      // same property. Writes via `setProperty` / `removeProperty`,
      // never `cssText`. See `src/compiler/ng-style.ts`.
      $compileProvider.directive('ngStyle', ngStyleDirective);
      // Spec 025 Slice 1 — interpolation-safe URL/value attribute
      // aliases (`ngHref`, `ngSrc`, `ngSrcset`). Each watches the
      // interpolated value of the `ng`-prefixed attribute via
      // `attrs.$observe` and writes through to the real DOM
      // attribute via `attrs.$set`, so the browser never sees the
      // literal `{{ … }}` mustache string (avoids the pre-compile
      // navigation / network-fetch bug). Priority 99 — load-bearing
      // for AngularJS-1.x parity. See
      // `src/compiler/ng-attribute-aliases.ts`.
      $compileProvider.directive('ngHref', ngHrefDirective);
      $compileProvider.directive('ngSrc', ngSrcDirective);
      $compileProvider.directive('ngSrcset', ngSrcsetDirective);
      // Spec 025 Slice 2 — boolean attribute alias directives
      // (`ngDisabled`, `ngChecked`, `ngReadonly`, `ngSelected`,
      // `ngOpen`). Each watches a scope expression (NOT an
      // interpolation) via `scope.$watch` and adds/removes the real
      // boolean DOM attribute through `attrs.$set` — truthy →
      // `setAttribute(name, '')` (bare-presence form, equivalent to
      // `<button disabled>` per HTML5), falsy → `removeAttribute(name)`.
      // Priority 100 — one notch above the URL aliases at 99, matching
      // AngularJS-1.x parity. See `src/compiler/ng-attribute-aliases.ts`.
      $compileProvider.directive('ngChecked', ngCheckedDirective);
      $compileProvider.directive('ngDisabled', ngDisabledDirective);
      $compileProvider.directive('ngOpen', ngOpenDirective);
      $compileProvider.directive('ngReadonly', ngReadonlyDirective);
      $compileProvider.directive('ngSelected', ngSelectedDirective);
      // Spec 026 — native event-binding directives. Eighteen
      // directives, ONE mechanical pattern (register native listener,
      // parse expression once at compile time, evaluate inside
      // `scope.$apply()` — or `scope.$evalAsync()` when a digest is in
      // flight — with `$event` exposed as a local, cleanup on
      // `$destroy`). All eighteen live in a single source file driven
      // by a module-private `createEventDirective(eventName)` factory
      // helper; the `eventName` parameter is the 18-member
      // `EventName` string-literal union derived from the
      // `EVENT_NAMES` tuple. See `src/compiler/ng-event-directives.ts`.
      $compileProvider.directive('ngBlur', ngBlurDirective);
      $compileProvider.directive('ngClick', ngClickDirective);
      $compileProvider.directive('ngCopy', ngCopyDirective);
      $compileProvider.directive('ngCut', ngCutDirective);
      $compileProvider.directive('ngDblclick', ngDblclickDirective);
      $compileProvider.directive('ngFocus', ngFocusDirective);
      $compileProvider.directive('ngKeydown', ngKeydownDirective);
      $compileProvider.directive('ngKeypress', ngKeypressDirective);
      $compileProvider.directive('ngKeyup', ngKeyupDirective);
      $compileProvider.directive('ngMousedown', ngMousedownDirective);
      $compileProvider.directive('ngMouseenter', ngMouseenterDirective);
      $compileProvider.directive('ngMouseleave', ngMouseleaveDirective);
      $compileProvider.directive('ngMousemove', ngMousemoveDirective);
      $compileProvider.directive('ngMouseout', ngMouseoutDirective);
      $compileProvider.directive('ngMouseover', ngMouseoverDirective);
      $compileProvider.directive('ngMouseup', ngMouseupDirective);
      $compileProvider.directive('ngPaste', ngPasteDirective);
      $compileProvider.directive('ngSubmit', ngSubmitDirective);
    },
  ]);
