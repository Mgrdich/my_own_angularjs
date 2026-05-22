/**
 * `ngBind` — single-expression text binding (spec 023 Slice 3 /
 * FS §2.3, technical-considerations §2.3).
 *
 * `<span ng-bind="expr"></span>` sets the element's `textContent` to
 * the current string value of `expr` and updates on every digest
 * cycle when the underlying value changes. The primary value of the
 * directive over an inline `{{ expr }}` mustache is that the
 * uncompiled DOM never briefly exposes the literal text — the
 * `ng-bind` attribute is invisible to the user even before the
 * framework reaches the element. (Pair with `ng-cloak` for the
 * mustache-style alternative.)
 *
 * **Coercion contract.**
 *
 * - `null` and `undefined` render as the empty string (FS §2.3 — the
 *   `value == null` check covers both via JS loose-equality semantics).
 *   Users never see literal `"null"` or `"undefined"` in the rendered
 *   text.
 * - Every other value is coerced via `String(value)`. Numbers (`42` →
 *   `"42"`), booleans (`true` → `"true"`), arrays / objects via their
 *   `.toString()` — all stringify in the canonical JS way.
 *
 * **Security contract.** The listener writes to `textContent`, which
 * sets the element's child text without interpreting HTML markup.
 * Any `<`, `&`, `>` etc. in the value appear LITERALLY in the
 * rendered DOM — `scope.html = '<script>alert(1)</script>'` renders
 * the eight characters of the opening tag, not a `<script>` element.
 * This is the security-relevant difference from `ngBindHtml` (spec
 * 023 Slice 5), which writes to `innerHTML` after routing the value
 * through `$sce.getTrustedHtml`. Use `ngBind` whenever the value is
 * supposed to be text; use `ngBindHtml` only when the value carries
 * markup AND is verified safe by the SCE pipeline.
 *
 * **Watcher shape.** A single `scope.$watch(attrs.ngBind, …)` per
 * element. The scope accepts the expression string directly via the
 * parser — no `$parse` dependency needed. Standard `$watch` identity
 * short-circuit keeps the per-digest cost minimal when the value is
 * stable.
 *
 * The factory is array-form (`[() => ({...})]`) because the
 * project's `annotate` helper rejects bare functions without
 * `$inject` — this is the same canonical shape used by `ngCloak` and
 * every other built-in directive on `ngModule`.
 *
 * @example
 * ```html
 * <span ng-bind="user.name"></span>
 * <!-- After $compile reaches the element and the digest runs:
 *      textContent === String(user.name) (or '' if null/undefined). -->
 * ```
 *
 * @example HTML characters escape automatically
 * ```html
 * <span ng-bind="html"></span>
 * <!-- With scope.html = '<script>alert(1)</script>':
 *      textContent === '<script>alert(1)</script>' (eight literal
 *      characters, NOT a parsed <script> element). For markup
 *      content, see ngBindHtml (spec 023 Slice 5). -->
 * ```
 */

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

/**
 * Normalized directive name — registration in `ng-module.ts` and the
 * `attrs[NG_BIND_NAME]` lookup in this file are tied together via this
 * constant so a rename touches both at once.
 */
export const NG_BIND_NAME = 'ngBind';

function ngBindFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const expr = attrs[NG_BIND_NAME];
    if (typeof expr !== 'string') {
      // Defensive — `attrs['ngBind']` is typed as `string | undefined`
      // through the index signature. If the attribute is missing
      // entirely the directive shouldn't have matched, but bail
      // cleanly rather than passing `undefined` into `$watch`.
      return;
    }
    scope.$watch(expr, (value) => {
      // `value == null` matches both `null` and `undefined` via JS
      // loose-equality (the only documented use of `==` in the spec).
      // Everything else stringifies via `String(...)`.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- spec contract: non-string inputs are coerced via `String()`; an object collapsing to `[object Object]` is the documented AngularJS-canonical behavior (no explicit type narrowing applied).
      element.textContent = value == null ? '' : String(value);
    });
  };

  return {
    restrict: 'A',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngBind', ngBindDirective)`. Zero
 * dependencies — the `annotate` helper rejects bare functions, so
 * the factory is wrapped in the canonical array form even though
 * its dependency list is empty.
 */
export const ngBindDirective: DirectiveFactory = [ngBindFactory];
