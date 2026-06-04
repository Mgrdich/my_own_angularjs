/**
 * `ngController` — attach a registered controller to a subtree
 * (spec 027 Slice 4 / FS §2.5, technical-considerations §2.6).
 *
 * `<div ng-controller="MyCtrl">…</div>` looks up `MyCtrl` in the
 * controller registry, instantiates it against the element's child
 * scope, and runs the constructor. The `'Name as alias'` syntax
 * (`<div ng-controller="MyCtrl as vm">{{vm.greeting}}</div>`) publishes
 * the instance on the child scope under the alias, so expressions
 * inside the subtree can reach the controller via `vm.<property>`.
 *
 * **Sentinel-driven dispatch — the load-bearing design choice.** This
 * directive declares NO `link` fn. Instead it sets the normalized
 * `controller` field on the DDO to the sentinel shape
 * `{ __attributeSource: 'ngController' }`. The compiler's
 * `runControllerSeam` (in `src/compiler/compile.ts`) recognizes the
 * sentinel as a third dispatch alongside its existing
 * `bindToController` (deferred-alias `later: true`) and eager branches:
 * it reads the controller name from `attrs.ngController` at LINK time
 * and invokes `$controller(attrs.ngController, locals)`. The lifecycle
 * hooks (`$onInit`, `$postLink`, `$onDestroy`), the `$$ngControllers`
 * stash, the `require` resolution dance, and the `controllerAs` alias
 * publication (handled internally by `$controller`'s
 * `parseControllerName` on the attribute string — no separate `ident`
 * argument is passed) all fire on the SAME timeline as the eager path.
 * Duplicating that machinery here would mean ~80 lines of subtle
 * ordering replication; the sentinel-driven dispatch reuses every line
 * of `runControllerSeam` instead.
 *
 * **Why `scope: true` — child scope per AngularJS convention.**
 * AngularJS creates a fresh child scope on every `ng-controller`
 * element so the controller's instance properties (via `controllerAs`)
 * live in their own namespace. This is independent of any surrounding
 * `transclude: 'element'` (e.g. `ng-if`) — when
 * `<div ng-if="show" ng-controller="MyCtrl">` mounts, the cloned root
 * gets a transclusion scope AND `ng-controller` creates a `scope: true`
 * child of that. The double-nesting is canonical (one scope per
 * structural mount, one scope per controller).
 *
 * **`$onChanges` asymmetry — does NOT fire.** Spec 022's `$onChanges`
 * is wired ONLY through the `bindToController` instance-target path,
 * which records initial-change records from `<` and `@` bindings. The
 * `ng-controller` directive declares no isolate bindings (the attribute
 * value is a controller name, not a binding spec map), so the
 * `bindToController` branch is never reached and `$onChanges` is never
 * fired. Matches AngularJS — `$onChanges` is for component-style
 * directives with declared isolate bindings, not for plain controllers.
 * `$onInit`, `$postLink`, and `$onDestroy` all fire normally on the
 * eager path.
 *
 * **Lazy attribute lookup.** The seam reads `attrs.ngController` at
 * link time (not registration / compile time), so a controller name
 * set via `attrs.$set('ngController', 'MyCtrl')` BEFORE the seam runs
 * — typically by a higher-priority directive's `compile` fn on the
 * same element — flows through to the lookup. This is rare but
 * supported. An empty or missing attribute value at link time causes
 * the seam to clean-bail (no instantiation, no error) — the directive
 * matched on an element with no concrete controller name.
 *
 * **Co-existence with `ng-if`.** When
 * `<div ng-if="show" ng-controller="MyCtrl">` is written, the host
 * element is detached at compile time by `ng-if`'s `transclude: 'element'`
 * machinery and replaced by a Comment placeholder; the `ng-controller`
 * declaration rides along on the captured master element. On
 * `show` flipping truthy, `$transclude` produces a fresh clone of the
 * host (carrying the `ng-controller` attribute), the per-element link
 * site runs the seam, and `MyCtrl` is instantiated. On `show` flipping
 * falsy, the active clone is torn down, the transclusion scope is
 * destroyed, and the controller instance's `$onDestroy` fires through
 * the normal scope-destroy propagation path. A future truthy
 * transition produces a fresh `MyCtrl` instance (the spec 022 +
 * spec 027 fresh-mount contract).
 *
 * **Errors.** None new in this file — the seam routes every
 * `$controller`-side throw (`UnknownControllerError` on a name that
 * was never registered, `InvalidControllerFactoryError` on a malformed
 * registry entry, etc.) via `$exceptionHandler('$compile')` through
 * the existing factory `try/catch` in the seam. The rest of the page
 * does not crash. `EXCEPTION_HANDLER_CAUSES` stays at 10.
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject` — this is
 * the canonical shape used by every other built-in directive on
 * `ngModule`. No DI dependencies — the seam handles all lookups
 * (`$controller`, `$exceptionHandler`) on its own.
 *
 * @example Bare name (no alias)
 * ```html
 * <div ng-controller="GreetingCtrl">
 *   {{ message }}
 * </div>
 * <!-- GreetingCtrl instantiates against a fresh child scope; assigning
 *      `$scope.message = 'Hello'` inside the controller renders 'Hello'
 *      in the binding. -->
 * ```
 *
 * @example `Name as alias`
 * ```html
 * <div ng-controller="GreetingCtrl as vm">
 *   {{ vm.message }}
 * </div>
 * <!-- The instance is published on scope under `vm`; `this.message =
 *      'Hello'` inside GreetingCtrl renders 'Hello'. -->
 * ```
 *
 * @example Combined with `ng-if`
 * ```html
 * <div ng-if="show" ng-controller="WidgetCtrl as widget">
 *   <button ng-click="widget.activate()">Go</button>
 * </div>
 * <!-- WidgetCtrl is instantiated only while `show` is truthy. On each
 *      falsy → truthy transition a fresh instance is created (matches
 *      the spec 022 + spec 027 fresh-mount contract); on each truthy →
 *      falsy transition the active instance's $onDestroy fires through
 *      the surrounding scope-destroy propagation path. -->
 * ```
 */

import type { DirectiveFactory, DirectiveFactoryReturn } from './directive-types';

/**
 * Normalized directive name — the registration in `src/core/ng-module.ts`
 * and the sentinel's `__attributeSource` key in this file are tied
 * together via this constant so a rename touches both at once. Module-
 * private: only the registration import in `ng-module.ts` consumes the
 * re-export.
 */
export const NG_CONTROLLER_NAME = 'ngController';

function ngControllerFactory(): DirectiveFactoryReturn {
  return {
    restrict: 'A',
    priority: 500,
    scope: true,
    // Spec 027 Slice 4 — attribute-source sentinel. The compiler's
    // `runControllerSeam` recognizes this exact shape and dispatches
    // to a third branch that reads the controller name from
    // `attrs[__attributeSource]` (= `attrs.ngController`) at link time.
    // This is intentionally NOT a real `ControllerInvokable` — the
    // factory declares no controller of its own; the actual
    // instantiation is the seam's job.
    controller: { __attributeSource: NG_CONTROLLER_NAME },
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngController', ngControllerDirective)`.
 * Zero dependencies — the `annotate` helper rejects bare functions, so
 * the factory is wrapped in the canonical array form even though its
 * dependency list is empty. The runtime instantiation flows through
 * the compiler's per-element controller seam (in `compile.ts`'s
 * `runControllerSeam`), which closes over `$controller` and
 * `$exceptionHandler` from the surrounding `createCompile` factory.
 */
export const ngControllerDirective: DirectiveFactory = [ngControllerFactory];
