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

import { createQ } from '@async/q';
import type { QService } from '@async/q-types';
import { createTimeout } from '@async/timeout';
import { createInterval } from '@async/interval';
import type { IntervalService, TimeoutService } from '@async/async-types';
import { $CompileProvider } from '@compiler/compile-provider';
import type { CompileService } from '@compiler/directive-types';
import {
  NG_ATTR_NAME,
  NG_BOOLEAN_ATTR_NAME,
  ngCheckedDirective,
  ngDisabledDirective,
  ngHrefDirective,
  ngOpenDirective,
  ngReadonlyDirective,
  ngSelectedDirective,
  ngSrcDirective,
  ngSrcsetDirective,
} from '@compiler/ng-attribute-aliases';
import { NG_BIND_NAME, ngBindDirective } from '@compiler/ng-bind';
import { NG_BIND_HTML_NAME, ngBindHtmlDirective } from '@compiler/ng-bind-html';
import { NG_BIND_TEMPLATE_NAME, ngBindTemplateDirective } from '@compiler/ng-bind-template';
import {
  NG_CLASS_EVEN_NAME,
  NG_CLASS_NAME,
  NG_CLASS_ODD_NAME,
  ngClassDirective,
  ngClassEvenDirective,
  ngClassOddDirective,
} from '@compiler/ng-class';
import { NG_CSP_NAME, NG_JQ_NAME, ngCspDirective, ngJqDirective } from '@compiler/ng-compat-switches';
import { ngCloakDirective } from '@compiler/ng-cloak';
import { NG_CONTROLLER_NAME, ngControllerDirective } from '@compiler/ng-controller';
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
import { NG_HIDE_NAME, ngHideDirective } from '@compiler/ng-hide';
import { HTML_ANCHOR_NAME, htmlAnchorDirective } from '@compiler/html-anchor';
import { NG_IF_NAME, ngIfDirective } from '@compiler/ng-if';
import { NG_INCLUDE_NAME, ngIncludeDirective } from '@compiler/ng-include';
import { NG_INIT_NAME, ngInitDirective } from '@compiler/ng-init';
import { NG_NON_BINDABLE_NAME, ngNonBindableDirective } from '@compiler/ng-non-bindable';
import { NG_PLURALIZE_NAME, ngPluralizeDirective } from '@compiler/ng-pluralize';
import { NG_REF_NAME, ngRefDirective } from '@compiler/ng-ref';
import { NG_REPEAT_NAME, ngRepeatDirective } from '@compiler/ng-repeat';
import { SCRIPT_TEMPLATE_NAME, scriptTemplateDirective } from '@compiler/script-template';
import { NG_SHOW_NAME, ngShowDirective } from '@compiler/ng-show';
import { NG_STYLE_NAME, ngStyleDirective } from '@compiler/ng-style';
import {
  NG_SWITCH_DEFAULT_NAME,
  NG_SWITCH_NAME,
  NG_SWITCH_WHEN_NAME,
  ngSwitchDefaultDirective,
  ngSwitchDirective,
  ngSwitchWhenDirective,
} from '@compiler/ng-switch';
import { NG_TRANSCLUDE_NAME, ngTranscludeDirective } from '@compiler/ng-transclude';
import { $ControllerProvider } from '@controller/controller-provider';
import type { ControllerService } from '@controller/controller-types';
import { createModule } from '@di/module';
import { Scope } from './scope';
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
        $rootScope: Scope;
        $q: QService;
        $timeout: TimeoutService;
        $interval: IntervalService;
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

// NOTE(spec-036 Slice 2): `$rootScope` is the canonical, injector-resolvable
// root scope singleton (FS §2.4). It is a LAZY factory — `Scope.create()`
// runs only on the first `injector.get('$rootScope')`, and the DI cache makes
// every subsequent `get` return the SAME reference (singleton). The factory is
// array-wrapped (`[() => …]`) to satisfy strict `annotate`, which rejects bare
// un-annotated functions.
//
// TODO(future): construct the root scope via
// `Scope.create({ filterLookup: $filter, exceptionHandler: $exceptionHandler })`
// so filter expressions resolve out of the box on the injector-built scope
// tree. Today the dependency-free form keeps `@core`'s `ngModule` from pulling
// `$filter` into the construction path; scope's `filterLookup` option is
// exercised by tests directly — see
// `src/filter/__tests__/scope-watch-integration.test.ts`.
export const ngModule = createModule('ng', [])
  .factory('$exceptionHandler', [() => consoleErrorExceptionHandler])
  // `$rootScope` (spec 036 Slice 2 / spec 037 Slice 1) — the injector-resolvable root scope.
  // Previously unregistered (see the TODO above); `$q` / `$timeout` /
  // `$interval` need it as their digest seam, so it lands here as a
  // dependency-free factory. `Scope.create()` carries the default TTL and
  // the `consoleErrorExceptionHandler` default — `$q` injects
  // `$exceptionHandler` DIRECTLY (not via `$rootScope.$$exceptionHandler`)
  // so the two cannot diverge.
  .factory('$rootScope', [() => Scope.create()])
  // `$q` (spec 037 Slice 1) — the promise toolkit. `scheduleDigest` is bound
  // to `$rootScope.$evalAsync` so a settlement from outside a digest
  // schedules one (FS §2.5); the pure `createQ` factory keeps the seam
  // injectable so it is unit-testable without an injector.
  .factory('$q', [
    '$rootScope',
    '$exceptionHandler',
    ($rootScope: Scope, $exceptionHandler: ExceptionHandler): QService =>
      createQ({
        exceptionHandler: $exceptionHandler,
        scheduleDigest: (fn) => {
          $rootScope.$evalAsync(fn);
        },
      }),
  ])
  // `$timeout` (spec 037 Slice 3) — a one-off deferred task that settles a
  // `$q` promise (FS §2.7). `apply` / `rootPhase` are the `$$phase`-guarded
  // seams onto `$rootScope.$apply` / `$rootScope.$$phase` (the event-directive
  // pattern); `defer` / `cancelDefer` are the GLOBAL `setTimeout` /
  // `clearTimeout` called directly (matching the `scope.ts` precedent). The
  // pure `createTimeout` factory keeps every seam injectable so it is
  // unit-testable with fake timers and stubs. `$exceptionHandler` is injected
  // DIRECTLY (not via `$rootScope.$$exceptionHandler`) so a callback throw
  // routes through the SAME handler `$q` uses, cause `'$timeout'`.
  .factory('$timeout', [
    '$rootScope',
    '$q',
    '$exceptionHandler',
    ($rootScope: Scope, $q: QService, $exceptionHandler: ExceptionHandler): TimeoutService =>
      createTimeout({
        q: $q,
        exceptionHandler: $exceptionHandler,
        apply: (fn) => {
          $rootScope.$apply(fn);
        },
        rootPhase: () => $rootScope.$$phase,
        defer: (fn, delay) => setTimeout(fn, delay),
        cancelDefer: (id) => {
          clearTimeout(id);
        },
      }),
  ])
  // `$interval` (spec 037 Slice 4) — a repeating deferred task that reports
  // per-tick progress and (when capped) succeeds with the final count
  // (FS §2.8). Same `apply` / `rootPhase` `$$phase`-guarded seams as `$timeout`,
  // with `setIntervalFn` / `clearIntervalFn` bound to the GLOBAL `setInterval` /
  // `clearInterval` called directly (matching the `scope.ts` precedent). The
  // pure `createInterval` factory keeps every seam injectable so it is
  // unit-testable with fake timers and stubs. `$exceptionHandler` is injected
  // DIRECTLY (not via `$rootScope.$$exceptionHandler`) so a callback throw
  // routes through the SAME handler `$q` uses, cause `'$interval'`.
  .factory('$interval', [
    '$rootScope',
    '$q',
    '$exceptionHandler',
    ($rootScope: Scope, $q: QService, $exceptionHandler: ExceptionHandler): IntervalService =>
      createInterval({
        q: $q,
        exceptionHandler: $exceptionHandler,
        apply: (fn) => {
          $rootScope.$apply(fn);
        },
        rootPhase: () => $rootScope.$$phase,
        setIntervalFn: (fn, delay) => setInterval(fn, delay),
        clearIntervalFn: (id) => {
          clearInterval(id);
        },
      }),
  ])
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
      $compileProvider.directive(NG_TRANSCLUDE_NAME, ngTranscludeDirective);
      $compileProvider.directive('ngCloak', ngCloakDirective);
      $compileProvider.directive(NG_BIND_NAME, ngBindDirective);
      $compileProvider.directive(NG_BIND_HTML_NAME, ngBindHtmlDirective);
      $compileProvider.directive(NG_BIND_TEMPLATE_NAME, ngBindTemplateDirective);
      $compileProvider.directive(NG_SHOW_NAME, ngShowDirective);
      $compileProvider.directive(NG_HIDE_NAME, ngHideDirective);
      $compileProvider.directive(NG_NON_BINDABLE_NAME, ngNonBindableDirective);
      // Spec 024 Slice 1 — `ngClass` dynamically toggles CSS classes
      // on an element from a scope expression. Three expression forms
      // (string / array / object) are normalized via the shared
      // `flattenClassExpression` helper; a `$watchCollection` listener
      // diffs the current set against the previous and only ever
      // removes classes the directive itself added (the
      // classes-preserved guarantee). See `src/compiler/ng-class.ts`.
      $compileProvider.directive(NG_CLASS_NAME, ngClassDirective);
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
      $compileProvider.directive(NG_CLASS_EVEN_NAME, ngClassEvenDirective);
      $compileProvider.directive(NG_CLASS_ODD_NAME, ngClassOddDirective);
      // Spec 024 Slice 3 — `ngStyle` dynamically sets inline CSS
      // styles on an element from a scope expression. Object-only
      // expression form (`{ cssProperty: value }`); a per-instance
      // `appliedProps` set drives the diff cycle so consumer-shipped
      // inline styles (e.g. `<div style="margin: 5px">`) are
      // preserved unless the directive's expression later names the
      // same property. Writes via `setProperty` / `removeProperty`,
      // never `cssText`. See `src/compiler/ng-style.ts`.
      $compileProvider.directive(NG_STYLE_NAME, ngStyleDirective);
      // Spec 025 Slice 1 — interpolation-safe URL/value attribute
      // aliases (`ngHref`, `ngSrc`, `ngSrcset`). Each watches the
      // interpolated value of the `ng`-prefixed attribute via
      // `attrs.$observe` and writes through to the real DOM
      // attribute via `attrs.$set`, so the browser never sees the
      // literal `{{ … }}` mustache string (avoids the pre-compile
      // navigation / network-fetch bug). Priority 99 — load-bearing
      // for AngularJS-1.x parity. See
      // `src/compiler/ng-attribute-aliases.ts`.
      $compileProvider.directive(NG_ATTR_NAME.href, ngHrefDirective);
      $compileProvider.directive(NG_ATTR_NAME.src, ngSrcDirective);
      $compileProvider.directive(NG_ATTR_NAME.srcset, ngSrcsetDirective);
      // Spec 025 Slice 2 — boolean attribute alias directives
      // (`ngDisabled`, `ngChecked`, `ngReadonly`, `ngSelected`,
      // `ngOpen`). Each watches a scope expression (NOT an
      // interpolation) via `scope.$watch` and adds/removes the real
      // boolean DOM attribute through `attrs.$set` — truthy →
      // `setAttribute(name, '')` (bare-presence form, equivalent to
      // `<button disabled>` per HTML5), falsy → `removeAttribute(name)`.
      // Priority 100 — one notch above the URL aliases at 99, matching
      // AngularJS-1.x parity. See `src/compiler/ng-attribute-aliases.ts`.
      $compileProvider.directive(NG_BOOLEAN_ATTR_NAME.checked, ngCheckedDirective);
      $compileProvider.directive(NG_BOOLEAN_ATTR_NAME.disabled, ngDisabledDirective);
      $compileProvider.directive(NG_BOOLEAN_ATTR_NAME.open, ngOpenDirective);
      $compileProvider.directive(NG_BOOLEAN_ATTR_NAME.readonly, ngReadonlyDirective);
      $compileProvider.directive(NG_BOOLEAN_ATTR_NAME.selected, ngSelectedDirective);
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
      // Spec 027 Slice 4 — `ngController` attaches a registered
      // controller to a subtree. The directive declares NO `link` fn;
      // instead its normalized `controller` field is the sentinel
      // shape `{ __attributeSource: 'ngController' }` recognized by
      // `runControllerSeam`'s third dispatch branch — the seam reads
      // the controller name from `attrs.ngController` at link time
      // and invokes `$controller(name, locals)` with the lifecycle
      // hooks (`$onInit` / `$postLink` / `$onDestroy`; NOT
      // `$onChanges` — no isolate bindings), the `$$ngControllers`
      // stash, the `require` resolution dance, and the `controllerAs`
      // alias publication all flowing through the existing spec 022
      // machinery. `scope: true` (fresh child scope per AngularJS
      // convention) keeps the alias namespace separate from any
      // surrounding transclusion scope (e.g. `ng-if`'s).
      // See `src/compiler/ng-controller.ts` for the file-level rationale.
      $compileProvider.directive(NG_CONTROLLER_NAME, ngControllerDirective);
      // Spec 027 Slice 3 — `ngIf` is the first structural directive
      // built on the Slice 2 `transclude: 'element'` foundation. At
      // compile time the host element is detached and replaced by a
      // `<!-- ngIf: cond -->` Comment placeholder; a `scope.$watch`
      // listener on the expression mounts a fresh deep clone of the
      // host (with a fresh transclusion scope) on each falsy → truthy
      // transition and tears the active clone + its scope down on
      // each truthy → falsy transition. Position is preserved
      // across toggles via `insertBefore(clone, placeholder.nextSibling)`.
      // The cleanup callback registered via `addElementCleanup(placeholder, …)`
      // makes a parent `destroyElementScope` reaching the placeholder
      // still tear the active clone down (Comment nodes have no
      // `children` HTMLCollection for `destroyElementScope` to walk).
      // See `src/compiler/ng-if.ts` for the file-level rationale.
      $compileProvider.directive(NG_IF_NAME, ngIfDirective);
      // Spec 027 Slice 6 — `ngInclude` asynchronously loads another
      // template by URL and renders it inline. Built on the Slice 2
      // `transclude: 'element'` foundation (same Comment-placeholder
      // pattern as `ngIf` / `ngSwitch`-children), with the URL drawn
      // from `attrs.ngInclude` (attribute form) or `attrs.src`
      // (element form). The link fn watches the URL expression,
      // fetches via `$templateRequest` (cache + dedup), compiles the
      // result against a fresh child scope, and inserts the rendered
      // subtree as the next sibling of the placeholder. A
      // closure-local `currentLoadToken` sentinel guards against
      // stale-fetch installs after destruction or URL change. Three
      // scope events (`$includeContentRequested` /
      // `$includeContentLoaded` / `$includeContentError`) emit at the
      // canonical lifecycle points; an optional `onload="expr"`
      // modifier evaluates against the PARENT scope after each
      // successful load. The lazy `$injector.has('$sce')` probe
      // mirrors `$SceProvider.$get`'s `$sanitize` lookup — no hard
      // dependency on `$sce`, but cross-origin URLs are gated through
      // `getTrustedResourceUrl` when `$sce` is reachable. See
      // `src/compiler/ng-include.ts` for the file-level rationale.
      $compileProvider.directive(NG_INCLUDE_NAME, ngIncludeDirective);
      // Spec 027 Slice 1 — `ngInit` evaluates an expression exactly
      // once at the link-time scope before any binding inside the
      // marked subtree first renders. The directive is wired through
      // a `compile` fn that parses the expression once and returns a
      // `{ pre }` link object; the pre-link callback fires BEFORE the
      // child directives' link phase descends, so assignment-form
      // expressions (`user = {name:'Alice'}`) land on scope in time
      // for `{{user.name}}` to render the initialized value on its
      // very first paint. No watch, no DOM mutation, no cleanup —
      // one-shot initializer per mount. Re-fires on each remount
      // (e.g. via a surrounding `ng-if` retoggling — spec 027 Slice 3).
      // See `src/compiler/ng-init.ts` for the pre-link-timing rationale.
      $compileProvider.directive(NG_INIT_NAME, ngInitDirective);
      // Spec 028 Slice 3 — `ngRepeat` is the list-iteration
      // structural directive. Built on the spec 027 Slice 2
      // `transclude: 'element'` foundation (host detached at compile
      // time and replaced by a `<!-- ngRepeat: ITERATOR -->` Comment
      // placeholder); on each `$watchCollection` fire the directive
      // reconciles its rendered rows against the new collection,
      // mounting one deep-clone of the master per item with a fresh
      // per-row child scope carrying the six framework-published
      // locals (`$index`, `$first`, `$last`, `$middle`, `$even`,
      // `$odd`) and the item binding (`scope[parsed.valueIdent] =
      // item`). Duplicate identity keys without `track by` throw
      // `NgRepeatDuplicateKeyError` routed via
      // `$exceptionHandler('$compile')` from the directive's own
      // try/catch (NOT via the digest's `'watchListener'` path).
      // `priority: 1000` makes `ngRepeat` win same-element conflicts
      // against `ngIf` (600) and `ngInclude` (400). Slice 3 ships
      // arrays only + default identity tracking; Slices 4–6 extend
      // this file with `track by` reuse, object iteration, and `as
      // alias` parent-scope publication. See
      // `src/compiler/ng-repeat.ts` for the file-level rationale.
      $compileProvider.directive(NG_REPEAT_NAME, ngRepeatDirective);
      // Spec 029 Slice 2 — `ngPluralize` displays the message variant
      // that grammatically fits the current count. At link time the
      // `when` map is `$eval`'d ONCE (static-map contract) and each
      // message is `$interpolate`-compiled ONCE with its `{}`
      // placeholders rewritten to the parenthesized count expression.
      // A primary `scope.$watch` on the count expression resolves the
      // message key (exact `String(count)` match wins, else
      // `$locale.pluralCat(count)` — the spec-029 Slice 1 locale
      // seam) and, on each key TRANSITION, deregisters the previous
      // message watch and installs `scope.$watch(messageFn, write)` —
      // the switching-watch design that keeps embedded `{{expr}}`
      // bindings live without watch churn. Unusable (NaN) counts
      // blank the element silently; a valid count with no matching
      // rule blanks the element and routes
      // `NgPluralizeNoRuleDefinedError` via
      // `$exceptionHandler('$compile')` once per key transition (the
      // no-`$log` divergence). `offset` (Slice 3) and the per-key
      // `when-…` attribute scan (Slice 4) land in later slices. See
      // `src/compiler/ng-pluralize.ts` for the file-level rationale.
      $compileProvider.directive(NG_PLURALIZE_NAME, ngPluralizeDirective);
      // Spec 030 Slice 3 — `ngRef` publishes a reference to a
      // directive's controller (or, absent a matching controller, the
      // native DOM element) onto the surrounding scope. Post-link only:
      // the per-element controller seam (spec 022 Slice 3) has already
      // populated the `$$ngControllers` stash by post-link, so reading
      // the own element's controller (keyed by its normalized tag name)
      // is reliable. The published value is written through the
      // assignable-expression writer (`buildParentWriter`) — the same
      // machinery the `=` two-way isolate binding uses — so dotted-path
      // refs (`ng-ref="refs.widget"`) auto-create their intermediates.
      // A missing/empty or non-assignable expression (`ng-ref="123bad"`)
      // routes `NgRefBadExpressionError` via `$exceptionHandler('$compile')`
      // and the directive goes inert. On scope `$destroy` the slot is
      // reset to `null` only when it still holds this directive's
      // published reference (identity guard). The `ngRefRead` modifier
      // lands in Slice 4. See `src/compiler/ng-ref.ts`.
      $compileProvider.directive(NG_REF_NAME, ngRefDirective);
      // Spec 030 Slice 1 — `script` registers inline
      // `<script type="text/ng-template" id="…">…</script>` bodies into
      // `$templateCache` at compile time (compile-only, no link fn). A
      // subsequent `templateUrl` / `ng-include` for the same `id`
      // resolves with zero network round-trip via `$templateRequest`'s
      // cache-first check. `terminal: true` for upstream same-element
      // cutoff parity; missing / non-`text/ng-template` cases are silent
      // no-ops. See `src/compiler/script-template.ts`.
      $compileProvider.directive(SCRIPT_TEMPLATE_NAME, scriptTemplateDirective);
      // Spec 030 Slice 5 — `a` is the native-anchor override directive.
      // `restrict: 'E'`, priority 0, non-terminal, link-only: it matches
      // every `<a>` and layers two browser-safety behaviors on top of the
      // author's markup WITHOUT taking ownership (accumulate-per-name
      // registration lets an app's own `a` directive run alongside it, and
      // it composes with `ng-click` / `ng-href`). Behavior 1 is the
      // empty-link click guard — a single native `click` listener reads
      // `element.getAttribute('href')` at CLICK time (live; sees
      // `ng-href`-written values) and calls `event.preventDefault()` when
      // the href is null / empty, with zero watches and no digest.
      // Behavior 2 is new-tab `rel` hardening — a link-time check plus an
      // `attrs.$observe('target', …)` token-merge `noopener` /
      // `noreferrer` into the existing `rel` (idempotent, preserving
      // author tokens like `license`) whenever `target` is `_blank`;
      // one-way (never removed on a later transition away from `_blank`).
      // See `src/compiler/html-anchor.ts` for the file-level rationale.
      $compileProvider.directive(HTML_ANCHOR_NAME, htmlAnchorDirective);
      // Spec 030 Slice 6 — `ngCsp` + `ngJq` are documented compatibility
      // no-ops. Both are A-restricted metadata-only DDOs (no compile, no
      // link) so AngularJS-migrated markup carrying `ng-csp` / `ng-jq`
      // compiles and renders unchanged. There is nothing for either to do
      // here: this framework's expression evaluation is a tree-walking
      // interpreter (never `eval` / `new Function`, CSP-safe by
      // construction) and injects no inline styles, so `ng-csp` has nothing
      // to reconfigure; and there is no jQuery/jqLite selection layer (a
      // Phase 5 roadmap item), so `ng-jq` has nothing to select. Every
      // classic value form (`ng-csp="no-unsafe-eval"`, `ng-jq="jQuery"`, …)
      // is inert by construction. See `src/compiler/ng-compat-switches.ts`.
      $compileProvider.directive(NG_CSP_NAME, ngCspDirective);
      $compileProvider.directive(NG_JQ_NAME, ngJqDirective);
      // Spec 027 Slice 5 — `ngSwitch` + `ngSwitchWhen` + `ngSwitchDefault`
      // provide value-driven subtree selection. The parent (`ngSwitch`)
      // owns a `NgSwitchController` controller plus a `scope.$watch`
      // listener on the switch expression; the two child directives
      // declare `transclude: 'element'` (so their host element is
      // replaced at compile time by a Comment placeholder per Slice 2)
      // and `require: '^ngSwitch'` (so they can register their
      // `{ transclude, placeholder }` pair into the parent's `cases`
      // map). The parent's listener orchestrates every transition:
      // teardown of the active set, lookup of the new set via
      // `String(value)` exact-match (with `'?'` fallback for the
      // default block), and mounting of fresh deep clones next to each
      // matching child's own placeholder. Multiple matching siblings
      // mount in document order. See `src/compiler/ng-switch.ts` for
      // the parent-controller + child-registration architecture rationale.
      $compileProvider.directive(NG_SWITCH_NAME, ngSwitchDirective);
      $compileProvider.directive(NG_SWITCH_DEFAULT_NAME, ngSwitchDefaultDirective);
      $compileProvider.directive(NG_SWITCH_WHEN_NAME, ngSwitchWhenDirective);
    },
  ]);
