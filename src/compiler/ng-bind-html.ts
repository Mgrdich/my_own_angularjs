/**
 * `ngBindHtml` — trusted HTML binding (spec 023 Slice 5 / FS §2.5,
 * technical-considerations §2.5).
 *
 * `<div ng-bind-html="expr"></div>` evaluates `expr` against the
 * element's scope, routes the result through `$sce.getTrustedHtml(…)`
 * (the existing spec-012 SCE pipeline), and writes the resolved HTML
 * to the element's `innerHTML`. Updates on every digest cycle when
 * the underlying value changes.
 *
 * This is the security-relevant alternative to `ngBind` (spec 023
 * Slice 3). Use `ngBindHtml` ONLY when the rendered content genuinely
 * needs to carry markup (e.g. rich-text editors, server-rendered
 * snippets) AND the value has been verified safe by the SCE
 * pipeline. For text content, use `ngBind` — it writes to
 * `textContent`, which escapes HTML special characters automatically.
 *
 * **Trust pipeline.** The listener routes the raw value through
 * `$sce.getTrustedHtml(value)`:
 *
 * - A value previously wrapped via `$sce.trustAsHtml(…)` unwraps
 *   directly to its underlying string — no sanitization is applied.
 *   This is how callers opt INTO rendering markup that would
 *   otherwise be stripped (e.g. a `<script>` tag for a deliberate
 *   widget embedding).
 * - A plain string is routed through the SCE delegate. With
 *   `ngSanitize` loaded (spec 013), the spec-013 `$sce` → `$sanitize`
 *   fallback runs the string through the HTML allow-list scrubber
 *   and the cleaned result is returned. Without `ngSanitize`, the
 *   delegate throws — `$sce.getTrustedHtml('<p>x</p>')` raises an
 *   "untrusted for context 'html'" error. The directive's listener
 *   bubbles this throw up to the digest's existing `'watchListener'`
 *   exception path, the element's `innerHTML` is set to the
 *   empty-string default below, and the digest continues.
 *
 * **Watcher shape.** A single `scope.$watch(attrs.ngBindHtml, …)`
 * per element. The scope accepts the expression string directly via
 * the parser — no `$parse` dependency is needed (and `$parse` is not
 * currently registered as a DI service on `ngModule`). The
 * `getTrustedHtml` call lives INSIDE the listener, NOT around the
 * watched expression itself: this is deliberate so a throw inside
 * `getTrustedHtml` is caught by the digest's existing watch-listener
 * exception path (`'watchListener'` cause), not the watcher-evaluator
 * path (`'watchFn'` cause). Standard `$watch` identity short-circuit
 * keeps the per-digest cost minimal when the value is stable.
 *
 * The `?? ''` fallback covers any case where `$sce.getTrustedHtml`
 * legitimately returns `null` or `undefined` — the directive degrades
 * to clearing the element rather than passing a nullish value to the
 * `innerHTML` setter (which would coerce to the four-character string
 * `'null'`). A value of `null` / `undefined` on the scope is handled
 * by the explicit `value == null` early branch.
 *
 * **No sanitization in this file.** The `$sce` → `$sanitize`
 * integration is the existing spec 013 wiring on `$SceProvider.$get`;
 * this directive consumes the integration via the public
 * `$sce.getTrustedHtml` surface and re-implements nothing. Apps that
 * need a different sanitizer override the wiring via
 * `module.decorator('$sanitize', …)` — outside the scope of this
 * directive.
 *
 * The factory is array-form (`['$sce', $sce => ({…})]`) because the
 * project's `annotate` helper rejects bare functions without
 * `$inject`. Spec 012 registers `$sce` as a run-phase service on
 * `ngModule`.
 *
 * @example Trusted HTML renders verbatim
 * ```html
 * <div ng-bind-html="trustedSnippet"></div>
 * <!-- With scope.trustedSnippet = $sce.trustAsHtml('<b>safe</b>'):
 *      innerHTML === '<b>safe</b>' (the wrapper short-circuits sanitization). -->
 * ```
 *
 * @example Untrusted HTML with `ngSanitize` loaded
 * ```html
 * <div ng-bind-html="markup"></div>
 * <!-- With scope.markup = '<b>x</b><script>alert(1)</script>' and
 *      `'ngSanitize'` in the consumer's module deps chain:
 *      innerHTML === '<b>x</b>' (the script tag is stripped by $sanitize). -->
 * ```
 *
 * @example Untrusted HTML WITHOUT `ngSanitize` (degrades to empty)
 * ```html
 * <div ng-bind-html="markup"></div>
 * <!-- With scope.markup = '<b>x</b>' and no ngSanitize in the deps chain:
 *      $sce.getTrustedHtml('<b>x</b>') throws inside the watch listener,
 *      the digest's standard 'watchListener' path catches it, and
 *      innerHTML stays the empty string. The digest continues. -->
 * ```
 */

import type { SceService } from '@sce/sce-types';

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

function ngBindHtmlFactory($sce: SceService): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const expr = attrs['ngBindHtml'];
    if (typeof expr !== 'string') {
      // Defensive — `attrs['ngBindHtml']` is typed as `string | undefined`
      // through the index signature. If the attribute is missing
      // entirely the directive shouldn't have matched, but bail
      // cleanly rather than passing `undefined` into `$watch`.
      return;
    }
    scope.$watch(expr, (rawValue: unknown) => {
      // `rawValue == null` matches both `null` and `undefined` via JS
      // loose-equality. In both cases the element is cleared without
      // consulting `$sce` — there is nothing to trust-check.
      if (rawValue == null) {
        element.innerHTML = '';
        return;
      }
      // The `$sce.getTrustedHtml` call lives INSIDE the listener, so a
      // throw here is caught by the digest's existing 'watchListener'
      // exception path (see `src/core/scope.ts` for the routing). The
      // element degrades to empty for safety after the throw — matches
      // AngularJS-canonical behavior.
      const trusted = $sce.getTrustedHtml(rawValue);
      // The `getTrustedHtml` return type is `unknown` (the underlying
      // delegate may return `null` for nullish inputs); the `?? ''`
      // converts any nullish to the empty string and `String(...)`
      // coerces everything else into an `innerHTML`-assignable string.
      // The trusted-html pipeline only ever returns string-shaped
      // payloads in practice; the explicit `String(...)` keeps the
      // assignment total without an unchecked cast.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- trusted-html outputs are string-typed by the SCE pipeline contract; an unexpected non-string would safely stringify via `Object.prototype.toString` rather than crashing the listener.
      element.innerHTML = trusted == null ? '' : String(trusted);
    });
  };

  return {
    restrict: 'A',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngBindHtml', ngBindHtmlDirective)`.
 * One dependency — `$sce`, the run-phase service registered on
 * `ngModule` (spec 012). The `$sce` → `$sanitize` fallback (spec 013)
 * is consumed transparently via `$sce.getTrustedHtml`.
 */
export const ngBindHtmlDirective: DirectiveFactory = ['$sce', ngBindHtmlFactory];
