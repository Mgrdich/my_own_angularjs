/**
 * `ngCsp` + `ngJq` — documented compatibility no-op directives (spec 030
 * Slice 6 / FS §2.x, technical-considerations §2.5).
 *
 * Both directives exist so that AngularJS-migrated markup carrying the
 * classic `ng-csp` / `ng-jq` attributes compiles and renders unchanged in
 * this reimplementation. They are **A-restricted, metadata-only no-op
 * DDOs** — no `compile`, no `link`. They do literally nothing with the
 * attribute value, so every classic value form
 * (`ng-csp`, `ng-csp="no-unsafe-eval"`, `ng-csp="no-inline-style"`,
 * `ng-jq`, `ng-jq="jQuery"`) is inert by construction. Presence on an
 * element renders identically to absence.
 *
 * **Why `ngCsp` is a no-op (CSP — Content Security Policy).** In upstream
 * AngularJS, `ng-csp` flips the framework out of two CSP-unsafe code paths:
 * it avoids generating expression evaluators with `Function`/`eval`, and it
 * stops injecting an inline `<style>` element for built-in directive CSS.
 * Neither path exists here:
 *
 *   - This framework's expression evaluation is a **tree-walking
 *     interpreter** that never uses `eval` or `new Function` — that is a
 *     deliberate, permanent part of the project's security posture (see
 *     CLAUDE.md, "No `new Function()` / no `eval()`"). Expressions are
 *     CSP-safe by construction with no flag to set.
 *   - This framework never injects inline styles; visibility directives
 *     (`ng-show` / `ng-hide` / `ng-cloak`) rely on consumer-shipped CSS,
 *     so there is no inline `<style>` to suppress.
 *
 * So there is nothing for `ng-csp` to reconfigure. It is accepted as a
 * pure no-op purely so migrated pages keep working unchanged.
 *
 * **Why `ngJq` is a no-op.** In upstream AngularJS, `ng-jq` selects which
 * jQuery-compatible library the framework's `angular.element` wrapper
 * delegates to (jqLite by default, full jQuery, or a named global). This
 * framework operates directly on the plain DOM (`Element` / `Comment`) with
 * **no jQuery/jqLite selection layer at all** — an `angular.element`
 * compatibility wrapper is a separate Phase 5 roadmap item. So `ng-jq` has
 * nothing to select. It too is accepted as a pure no-op.
 *
 * Both factories are array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject` — the same
 * canonical zero-dependency shape used by `ngNonBindable` and every other
 * built-in directive on `ngModule`. They install no watchers and have zero
 * per-digest cost.
 *
 * @example `ng-csp` is inert — element renders identically with or without it
 * ```html
 * <!-- These two compile and render the same; ng-csp changes nothing. -->
 * <div ng-csp ng-bind="user.name"></div>
 * <div ng-bind="user.name"></div>
 * <!-- The classic value forms are equally inert: -->
 * <html ng-csp="no-unsafe-eval"></html>
 * <html ng-csp="no-inline-style"></html>
 * ```
 *
 * @example `ng-jq` is inert — no jQuery/jqLite selection happens
 * ```html
 * <!-- ng-jq names a library to wrap, but there is no wrapper layer here,
 *      so the attribute is ignored and the element behaves normally. -->
 * <div ng-jq></div>
 * <div ng-jq="jQuery"></div>
 * ```
 */

import type { DirectiveFactory, DirectiveFactoryReturn } from './directive-types';

/**
 * Normalized directive name for `ngCsp`, used at the registration site in
 * `src/core/ng-module.ts`. Kept as a single exported literal so a rename
 * touches the registration call together with this module.
 */
export const NG_CSP_NAME = 'ngCsp';

/**
 * Normalized directive name for `ngJq`, used at the registration site in
 * `src/core/ng-module.ts`. Kept as a single exported literal so a rename
 * touches the registration call together with this module.
 */
export const NG_JQ_NAME = 'ngJq';

function ngCspFactory(): DirectiveFactoryReturn {
  // Pure metadata — no `compile`, no `link`. There is nothing for `ng-csp`
  // to reconfigure: expression evaluation is a tree-walking interpreter
  // (never `eval` / `new Function`) and no inline styles are injected. The
  // attribute value (`''`, `'no-unsafe-eval'`, `'no-inline-style'`) is
  // never read — every form is inert.
  return {
    restrict: 'A',
  };
}

function ngJqFactory(): DirectiveFactoryReturn {
  // Pure metadata — no `compile`, no `link`. There is no jQuery/jqLite
  // selection layer in this framework (a compatibility wrapper is a Phase 5
  // roadmap item), so `ng-jq` has nothing to select. The attribute value
  // (`''`, `'jQuery'`, a named global) is never read — every form is inert.
  return {
    restrict: 'A',
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngCsp', ngCspDirective)`. Zero dependencies —
 * the `annotate` helper rejects bare functions, so the factory is wrapped in
 * the canonical array form even though its dependency list is empty.
 */
export const ngCspDirective: DirectiveFactory = [ngCspFactory];

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngJq', ngJqDirective)`. Zero dependencies —
 * the `annotate` helper rejects bare functions, so the factory is wrapped in
 * the canonical array form even though its dependency list is empty.
 */
export const ngJqDirective: DirectiveFactory = [ngJqFactory];
