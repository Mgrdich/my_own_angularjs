/**
 * `ngHide` — hide or show an element based on the truthiness of an
 * expression (spec 023 Slice 4 / FS §2.1, technical-considerations §2.1).
 *
 * The mirror-inverse of {@link import('./ng-show').ngShowDirective}:
 * `<div ng-hide="expr">…</div>` adds the `ng-hide` CSS class to the
 * element when `expr` is TRUTHY and removes it when `expr` is FALSY.
 * Both directives share the same `ng-hide` CSS class name — the
 * canonical consumer-shipped rule is:
 *
 * ```css
 * .ng-hide { display: none !important; }
 * ```
 *
 * The framework does NOT auto-inject this stylesheet — that would
 * violate the no-runtime-DOM-injection invariant. Apps that omit the
 * CSS rule will see the class flip but the element will remain
 * visible.
 *
 * **Truthiness contract.** Standard JavaScript truthiness applies — the
 * value is coerced via `!!value` in the listener:
 *
 * - Truthy (`ng-hide` added): non-zero numbers, non-empty strings
 *   (INCLUDING the literal string `'false'`, which is a non-empty
 *   string and therefore truthy in JS), `true`, non-empty arrays,
 *   non-empty objects.
 * - Falsy (`ng-hide` removed): `null`, `undefined`, `0`, `NaN`, `''`,
 *   `false`.
 *
 * **Watcher shape.** A single `scope.$watch(attrs.ngHide, …)` per
 * element. The scope accepts the expression string directly via the
 * parser — no `$parse` dependency needed. The listener calls
 * `element.classList.toggle('ng-hide', !!value)`, which only touches
 * the named class so any other classes on the element are preserved
 * unchanged across digests. Standard `$watch` identity short-circuit
 * means the listener does not re-fire when the underlying value is
 * stable, so the per-digest cost of an `ng-hide` element with a stable
 * value is the same as any other watch.
 *
 * **Animations.** This spec ships synchronous toggles only. The
 * `$animate` integration that animates the class transition between
 * shown / hidden states is deferred to Phase 4 (a future spec). The
 * directive's link function does NOT contain animation hooks today.
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject` — this
 * is the same canonical shape used by `ngShow`, `ngBind`, `ngCloak`,
 * and every other built-in directive on `ngModule`.
 *
 * @example
 * ```html
 * <div ng-hide="hidden">Hello</div>
 * <!-- With scope.hidden = true:  ng-hide class added.    The element is hidden
 *      (assuming the consumer-shipped `.ng-hide { display: none !important; }`
 *      CSS rule is in scope).
 *      With scope.hidden = false: no ng-hide class. The element is shown. -->
 * ```
 *
 * @example Other classes on the element are preserved
 * ```html
 * <div class="card highlighted" ng-hide="hidden">Hello</div>
 * <!-- After toggling hidden: the `card` and `highlighted` classes stay,
 *      only the `ng-hide` class is added/removed. -->
 * ```
 *
 * @see ngShowDirective — the truthy-shows / falsy-hides counterpart.
 */

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

function ngHideFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const expr = attrs['ngHide'];
    if (typeof expr !== 'string') {
      // Defensive — `attrs['ngHide']` is typed as `string | undefined`
      // through the index signature. If the attribute is missing
      // entirely the directive shouldn't have matched, but bail
      // cleanly rather than passing `undefined` into `$watch`.
      return;
    }
    scope.$watch(expr, (value) => {
      // `ng-hide` hides the element when the value is TRUTHY — the
      // truthiness check is `!!value`. `classList.toggle(cls, force)`
      // adds the class when `force` is `true`, removes it when
      // `false`. Other classes on the element are untouched.
      element.classList.toggle('ng-hide', !!value);
    });
  };

  return {
    restrict: 'A',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngHide', ngHideDirective)`. Zero
 * dependencies — the `annotate` helper rejects bare functions, so
 * the factory is wrapped in the canonical array form even though its
 * dependency list is empty.
 */
export const ngHideDirective: DirectiveFactory = [ngHideFactory];
