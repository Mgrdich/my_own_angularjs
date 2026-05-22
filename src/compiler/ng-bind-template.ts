/**
 * `ngBindTemplate` — multi-expression text binding via `$interpolate`
 * (spec 023 Slice 3 / FS §2.4, technical-considerations §2.4).
 *
 * `<span ng-bind-template="Hello {{name}}, today is {{day}}"></span>`
 * interpolates the template string against the element's scope and
 * sets the element's `textContent` to the rendered result. Updates
 * on every digest when ANY referenced expression changes.
 *
 * The directive is the multi-expression sibling of `ngBind`: where
 * `ngBind` reads a single expression, `ngBindTemplate` reads a
 * template string of the same shape that mustaches would have used,
 * just without writing them inline. The primary value is the same —
 * the uncompiled DOM never briefly exposes literal `{{ … }}` text.
 *
 * **Implementation shape.**
 *
 * - At link time, the factory calls `$interpolate(attrs.ngBindTemplate)`
 *   ONCE per matched element. The resulting `InterpolateFn` reference
 *   is captured in the listener closure — no per-digest re-parsing.
 * - `scope.$watch(interpolateFn, …)` watches the result. The watcher
 *   passes the `InterpolateFn` as the expression itself (the scope
 *   `$watch` accepts callable expressions, evaluated against the
 *   scope each digest). The listener writes the rendered string
 *   directly to `element.textContent`.
 * - The interpolated value is already a string per the existing
 *   `$interpolate` contract — no additional `String()` coercion
 *   needed. `null` / `undefined` segments inside the template are
 *   stringified to `''` by `$interpolate` itself.
 *
 * **Empty template.** `$interpolate('')` returns an `InterpolateFn`
 * that always evaluates to `''`. The directive accepts this without
 * a special case — the resulting `textContent` is an empty string.
 *
 * **Static-only template.** A template like `"Just text"` with no
 * `{{ … }}` segments compiles to an `InterpolateFn` that always
 * returns the same constant string. The first digest sets the
 * `textContent`; the standard `$watch` identity short-circuit
 * suppresses subsequent listener calls until the value somehow
 * changes (which it cannot, for a constant).
 *
 * **Security contract.** Identical to `ngBind` — the listener writes
 * to `textContent`, so any HTML special characters in the
 * interpolated value appear literally in the rendered DOM. For
 * markup content, see `ngBindHtml` (spec 023 Slice 5).
 *
 * The factory is array-form with `$interpolate` as the lone
 * dependency. The `annotate` helper rejects bare functions without
 * `$inject`, so the array shape is canonical even for
 * single-dependency factories.
 *
 * @example Multi-expression template
 * ```html
 * <span ng-bind-template="Hello {{user.first}} {{user.last}}!"></span>
 * <!-- With scope.user = { first: 'Ada', last: 'Lovelace' }:
 *      textContent === 'Hello Ada Lovelace!' -->
 * ```
 *
 * @example Empty template renders as an empty string
 * ```html
 * <span ng-bind-template=""></span>
 * <!-- textContent === '' (no special case in the directive — just
 *      the existing $interpolate contract). -->
 * ```
 */

import type { InterpolateFn, InterpolateService } from '@interpolate/interpolate-types';

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

/**
 * Normalized directive name — registration in `ng-module.ts` and the
 * `attrs[NG_BIND_TEMPLATE_NAME]` lookup in this file are tied together
 * via this constant so a rename touches both at once.
 */
export const NG_BIND_TEMPLATE_NAME = 'ngBindTemplate';

function ngBindTemplateFactory($interpolate: InterpolateService): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const template = attrs[NG_BIND_TEMPLATE_NAME];
    if (typeof template !== 'string') {
      // Defensive — see ngBind for the same bailout pattern.
      return;
    }
    // ONE `$interpolate` compilation per matched element. The
    // returned function is reused on every digest via the captured
    // closure — no per-cycle re-parse cost.
    const interpolateFn: InterpolateFn = $interpolate(template);
    scope.$watch(interpolateFn, (value) => {
      // `$interpolate` returns `string` (or `undefined` only on the
      // `oneTime` hold-back, which `ngBindTemplate` does not use).
      // Cast through the documented contract — `null` / `undefined`
      // segments inside the template are already rendered as `''` by
      // the service itself.
      element.textContent = typeof value === 'string' ? value : '';
    });
  };

  return {
    restrict: 'A',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngBindTemplate', ngBindTemplateDirective)`.
 * One dependency — `$interpolate`, the run-phase service registered
 * on `ngModule` (spec 011).
 */
export const ngBindTemplateDirective: DirectiveFactory = ['$interpolate', ngBindTemplateFactory];
