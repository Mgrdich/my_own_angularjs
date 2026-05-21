/**
 * `ngShow` — show or hide an element based on the truthiness of an
 * expression (spec 023 Slice 4 / FS §2.1, technical-considerations §2.1).
 *
 * `<div ng-show="expr">…</div>` adds the `ng-hide` CSS class to the
 * element when `expr` is FALSY and removes it when `expr` is TRUTHY.
 * Consumers ship the canonical CSS rule alongside the framework so the
 * class actually hides the element:
 *
 * ```css
 * .ng-hide { display: none !important; }
 * ```
 *
 * The framework does NOT auto-inject this stylesheet — that would
 * violate the no-runtime-DOM-injection invariant. Apps that omit the
 * CSS rule will see the class flip but the element will remain
 * visible. (`ngHide` shares the same class name and CSS rule — see
 * `ng-hide.ts` for the inverse-truthiness counterpart.)
 *
 * **Truthiness contract.** Standard JavaScript truthiness applies — the
 * value is coerced via `!value` in the listener:
 *
 * - Falsy (`ng-hide` added): `null`, `undefined`, `0`, `NaN`, `''`,
 *   `false`.
 * - Truthy (`ng-hide` removed): everything else — non-zero numbers,
 *   non-empty strings (INCLUDING the literal string `'false'`, which
 *   is a non-empty string and therefore truthy in JS), `true`,
 *   non-empty arrays, non-empty objects.
 *
 * **Watcher shape.** A single `scope.$watch(attrs.ngShow, …)` per
 * element. The scope accepts the expression string directly via the
 * parser — no `$parse` dependency needed. The listener calls
 * `element.classList.toggle('ng-hide', !value)`, which only touches
 * the named class so any other classes on the element are preserved
 * unchanged across digests. Standard `$watch` identity short-circuit
 * means the listener does not re-fire when the underlying value is
 * stable, so the per-digest cost of an `ng-show` element with a stable
 * value is the same as any other watch.
 *
 * **Animations.** This spec ships synchronous toggles only. The
 * `$animate` integration that animates the class transition between
 * shown / hidden states is deferred to Phase 4 (a future spec). The
 * directive's link function does NOT contain animation hooks today.
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject` — this
 * is the same canonical shape used by `ngBind`, `ngCloak`, and every
 * other built-in directive on `ngModule`.
 *
 * @example
 * ```html
 * <div ng-show="visible">Hello</div>
 * <!-- With scope.visible = true:  no ng-hide class. The element is shown.
 *      With scope.visible = false: ng-hide class added.    The element is hidden
 *      (assuming the consumer-shipped `.ng-hide { display: none !important; }`
 *      CSS rule is in scope). -->
 * ```
 *
 * @example Other classes on the element are preserved
 * ```html
 * <div class="card highlighted" ng-show="visible">Hello</div>
 * <!-- After toggling visible: the `card` and `highlighted` classes stay,
 *      only the `ng-hide` class is added/removed. -->
 * ```
 */

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

function ngShowFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const expr = attrs['ngShow'];
    if (typeof expr !== 'string') {
      // Defensive — `attrs['ngShow']` is typed as `string | undefined`
      // through the index signature. If the attribute is missing
      // entirely the directive shouldn't have matched, but bail
      // cleanly rather than passing `undefined` into `$watch`.
      return;
    }
    scope.$watch(expr, (value: unknown) => {
      // `ng-show` hides the element when the value is FALSY — the
      // truthiness check is `!value`. `classList.toggle(cls, force)`
      // adds the class when `force` is `true`, removes it when
      // `false`. Other classes on the element are untouched.
      element.classList.toggle('ng-hide', !value);
    });
  };

  return {
    restrict: 'A',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngShow', ngShowDirective)`. Zero
 * dependencies — the `annotate` helper rejects bare functions, so
 * the factory is wrapped in the canonical array form even though its
 * dependency list is empty.
 */
export const ngShowDirective: DirectiveFactory = [ngShowFactory];
