/**
 * `ngCloak` — prevent the brief flash of un-compiled `{{ … }}` markup
 * before the framework finishes rendering the page (spec 023 Slice 2 /
 * FS §2.2, technical-considerations §2.2).
 *
 * Consumers ship a small CSS rule that hides cloaked elements before
 * compilation:
 *
 * ```css
 * [ng-cloak], .ng-cloak { display: none !important; }
 * ```
 *
 * The framework does NOT auto-inject this stylesheet — that would
 * violate the no-runtime-DOM-injection invariant. Once the compiler
 * reaches the element, this directive's `compile` function removes
 * both the `ng-cloak` attribute and the `ng-cloak` class so the CSS
 * rule no longer matches and the element becomes visible.
 *
 * `restrict: 'AC'` lets consumers use either form:
 *
 * - Attribute form: `<div ng-cloak>…</div>`
 * - Class form: `<div class="ng-cloak">…</div>`
 *
 * The directive is **compile-only** — it does NOT install any watcher,
 * does NOT register an `$observe`, and has zero per-digest cost. The
 * effect is a one-shot DOM cleanup that happens when `$compile` first
 * reaches the element. `removeAttribute` and `classList.remove` are
 * both idempotent (no-ops on a clean element) so the directive is safe
 * on elements that carry only one of the two forms (or neither).
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject` — this is
 * the same canonical shape used by `ngTransclude` and every other
 * built-in directive on `ngModule`.
 *
 * @example Attribute form
 * ```html
 * <div ng-cloak>
 *   <p>{{ user.name }}</p>
 * </div>
 * <!-- After $compile reaches the element: the ng-cloak attribute is
 *      removed, the CSS rule no longer matches, and the element
 *      becomes visible with `{{ user.name }}` already interpolated. -->
 * ```
 *
 * @example Class form
 * ```html
 * <div class="ng-cloak">
 *   <p>{{ user.name }}</p>
 * </div>
 * <!-- Same effect — the ng-cloak class is removed at compile time. -->
 * ```
 */

import type { DirectiveFactory, DirectiveFactoryReturn } from './directive-types';

const NG_CLOAK_ATTR = 'ng-cloak';
const NG_CLOAK_CLASS = 'ng-cloak';

function ngCloakFactory(): DirectiveFactoryReturn {
  return {
    restrict: 'AC',
    compile: (element) => {
      // Both calls are idempotent — `removeAttribute` on a missing attr
      // and `classList.remove` on a missing class are both DOM no-ops.
      // No watcher is installed; this directive has zero per-digest
      // cost beyond the one-shot cleanup at compile time.
      element.removeAttribute(NG_CLOAK_ATTR);
      element.classList.remove(NG_CLOAK_CLASS);
      // Returning `void` signals "no link function" — the compile-only
      // pattern is supported by spec 017's three-phase linker.
    },
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngCloak', ngCloakDirective)`. Zero
 * dependencies — the `annotate` helper rejects bare functions, so the
 * factory is wrapped in the canonical array form even though its
 * dependency list is empty.
 */
export const ngCloakDirective: DirectiveFactory = [ngCloakFactory];
