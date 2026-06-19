/**
 * Attribute helper directives — `ng-href`, `ng-src`, `ng-srcset`
 * (spec 025 Slice 1 / FS §2.1) and `ng-disabled`, `ng-checked`,
 * `ng-readonly`, `ng-selected`, `ng-open` (spec 025 Slice 2 / FS §2.2).
 *
 * Eight directives, two mechanical patterns, ONE source file. Mirrors
 * AngularJS-1.x's `ngAttributeAliasDirectives` block: a pair of internal
 * factory helpers parameterized by attribute name, plus the generated
 * directive factories that get registered on `ngModule`.
 *
 * **Pattern 1 — URL / value alias.**
 *
 * The browser eagerly resolves URLs the moment it sees them. A literal
 * `<a href="{{userProfileUrl}}">` lets the user navigate to the string
 * `"{{userProfileUrl}}"` if they click before the framework compiles
 * the template; a literal `<img src="{{photoUrl}}">` fires a network
 * request for `"{{photoUrl}}"`, which 404s. Consumers sidestep both
 * bugs by binding to the parallel `ng-href` / `ng-src` / `ng-srcset`
 * attributes — the real `href` / `src` / `srcset` is only set AFTER
 * the framework resolves the interpolation, so a pre-compile click
 * goes nowhere instead of to a bad URL.
 *
 * **Pattern 2 — Boolean attribute toggle.**
 *
 * HTML5 treats boolean attributes by PRESENCE, not by value:
 * `<button disabled="false">` is a disabled button. AngularJS solves
 * this with `<button ng-disabled="!form.$valid">` — the directive adds
 * or removes the real `disabled` attribute based on the truthiness of
 * the expression. Five boolean helpers ship: `ng-disabled`, `ng-checked`,
 * `ng-readonly`, `ng-selected`, `ng-open`. Each watches a scope
 * expression (NOT an interpolation — there's no `{{ }}` resolution
 * step) and writes presence/absence through `attrs.$set`.
 *
 * **Shared invariants.**
 *
 * - Both helpers consume infrastructure that already exists from spec
 *   017: `attrs.$observe` (URL/value pattern), `scope.$watch` (boolean
 *   pattern), and `attrs.$set` (both — see `attributes.ts:271` for the
 *   `value === null` → `removeAttribute`, non-null → `setAttribute`
 *   logic).
 * - Both factory helpers are MODULE-PRIVATE. The 8 generated factories
 *   are exported from this file but NOT re-exported from
 *   `@compiler/index` — DI-registration only, matching the
 *   `ngTransclude` / spec-023 / spec-024 precedent.
 * - No new error classes. No new `EXCEPTION_HANDLER_CAUSES` token.
 *   Errors thrown from `$observe` listeners (URL pattern) or `$watch`
 *   listeners (boolean pattern) flow through the existing
 *   `'watchListener'` / `'$evalAsync'` causes — the tuple stays at 10.
 * - Priority is LOAD-BEARING and DIFFERS between the two patterns:
 *   URL aliases use priority 99, boolean aliases use priority 100.
 *   Matches AngularJS-canonical exactly.
 */

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';
import type { SanitizeUriService } from './sanitize-uri-types';

/**
 * Mapping from DOM attribute name to the corresponding normalized
 * `ng`-prefixed attribute name. Maintained as a small lookup table
 * (rather than a `'ng' + capitalize(...)` runtime call) so the spec's
 * exact target names — `ngHref`, `ngSrc`, `ngSrcset` — are visible as
 * literals in the source. The keys are the only three DOM attributes
 * the URL/value pattern supports; the type narrows the helper's
 * parameter so unrelated attribute names (`'class'`, `'style'`) cannot
 * be passed by accident.
 */
export const NG_ATTR_NAME: { readonly href: 'ngHref'; readonly src: 'ngSrc'; readonly srcset: 'ngSrcset' } = {
  href: 'ngHref',
  src: 'ngSrc',
  srcset: 'ngSrcset',
};

/**
 * Build an array-form directive factory implementing the
 * interpolation-safe URL/value alias pattern for a given DOM attribute.
 *
 * The link function calls
 * `attrs.$observe(ngAttrName, value => attrs.$set(domAttrName, value !== undefined && value !== '' ? value : null))`:
 *
 *  - The `$observe` callback fires whenever the interpolated value of
 *    the `ng`-prefixed attribute changes. Spec 017's `$observe` lazily
 *    installs a per-attribute watch on first registration; the
 *    interpolation framework drives the listener through the digest.
 *    `$interpolate` itself coerces `null` / `undefined` segments to the
 *    empty string, so the observer's `value` argument is either a
 *    non-empty string or `''` (never `null` / `undefined` in practice,
 *    but the union type still includes `undefined`).
 *  - The explicit `value !== undefined && value !== '' ? value : null`
 *    check collapses ONLY empty string and `undefined` to `null` —
 *    NOT every falsy string. A relative URL like `'0'` (valid `href`
 *    target, falsy in JS) survives intact. Spec 017's `$set` at
 *    `attributes.ts:273` routes a `null` value to
 *    `removeAttribute(domAttrName)`, removing the real DOM attribute
 *    entirely; any non-empty string triggers
 *    `setAttribute(domAttrName, value)`. This is the behavior the
 *    functional spec demands (FS §2.1: "When the interpolated value
 *    resolves to an empty string, the real attribute is REMOVED
 *    entirely — not set to `""`"). Do NOT "simplify" to `value || null`
 *    — that would silently strip valid falsy-string URLs.
 *  - `$set` requires a `string | null` argument; the runtime contract
 *    is satisfied because the false branch of the ternary is `null`
 *    and the true branch is by definition a non-empty string.
 *
 * **Priority 99** matches AngularJS-canonical and is LOAD-BEARING for
 * compatibility — the priority places these directives ABOVE the
 * default 0 (so they reliably run before later-priority code on the
 * same element) and BELOW 100 (the priority claimed by the boolean
 * alias helper in Slice 2, plus `ng-non-bindable` at 1000).
 *
 * **Pre-compile attribute absence.** The functional spec's "real
 * `href` attribute is absent before the first digest" requirement is
 * automatic: the consumer template writes `<a ng-href="{{url}}">`
 * (no `href` attribute at all). The compiler reaches the element,
 * the link fn registers the observer, the interpolation framework
 * wires a `scope.$watch`, and the real attribute is only written when
 * the listener fires during the first digest. The browser sees the
 * un-compiled `<a>` without any `href` — a click before the digest
 * goes nowhere (no navigation) instead of to the literal URL
 * `"{{url}}"`. No explicit pre-compile work needed.
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject`.
 *
 * @internal Module-private — consumed by the three exported URL/value
 *           directive factories in this file. Not exported from
 *           `@compiler/index` or the root barrel.
 */
function createUrlAliasDirective(domAttrName: 'href' | 'src' | 'srcset'): DirectiveFactory {
  const ngAttrName = NG_ATTR_NAME[domAttrName];
  // `href` is the link context (sanitized against the
  // `aHrefSanitizationTrustedUrlList`); `src` / `srcset` are media
  // contexts (sanitized against the `imgSrcSanitizationTrustedUrlList`).
  // Spec 034 Slice 2 — the `$$sanitizeUri` service selects the matching
  // pattern from `isMediaUrl`.
  const isMediaUrl = domAttrName !== 'href';

  // The factory injects `$$sanitizeUri` (registered by `$CompileProvider`
  // in its constructor, closing over the config-phase URL safe-list
  // patterns) so `ng-href` / `ng-src` / `ng-srcset` apply the SAME
  // configured safe-list as the eager attribute-interpolation write path
  // in `attributes.ts`. A resolved URL that fails the safe-list is
  // neutralized with an `unsafe:` prefix BEFORE the `$set` DOM write.
  return [
    '$$sanitizeUri',
    ($$sanitizeUri: SanitizeUriService): DirectiveFactoryReturn => {
      const link: LinkFn = (_scope, _element, attrs) => {
        attrs.$observe(ngAttrName, (value) => {
          // Non-empty string (including JS-falsy strings like `'0'`,
          // valid relative URLs) → sanitize, then setAttribute via
          // `$set`. Only `''` and `undefined` → `null` → removeAttribute
          // via `$set` (spec 017 `attributes.ts:273` removes when
          // `value === null`). The explicit ternary deliberately rejects
          // the looser `value || null` shape that would also strip
          // `'0'` / `'false'`.
          const next = value !== undefined && value !== '' ? $$sanitizeUri(value, isMediaUrl) : null;
          attrs.$set(domAttrName, next);
        });
      };

      return {
        restrict: 'A',
        priority: 99,
        link,
      };
    },
  ];
}

/**
 * `ng-href` — interpolation-safe alias for the `href` attribute.
 *
 * Watches the interpolated value of the `ng-href` attribute and writes
 * the resulting string to the real `href` attribute after each digest.
 * An empty / nullish interpolated value removes the real `href` entirely
 * (the attribute is absent, not set to `""`), so a click in that state
 * does nothing — `<a>` without `href` is unfocusable and unfollowable.
 *
 * Priority 99. `restrict: 'A'` (attribute form only).
 *
 * @example
 * ```html
 * <a ng-href="{{userProfileUrl}}">View profile</a>
 *
 * <!-- Before the first digest: the real `href` attribute is absent.
 *      A click goes nowhere instead of navigating to the literal URL
 *      "{{userProfileUrl}}". -->
 *
 * <!-- After scope.userProfileUrl = '/users/42' + digest:
 *      the element looks like
 *        <a ng-href="/users/42" href="/users/42">View profile</a> -->
 * ```
 */
export const ngHrefDirective = createUrlAliasDirective('href');

/**
 * `ng-src` — interpolation-safe alias for the `src` attribute on
 * `<img>` (and any other element that exposes a `src` attribute).
 *
 * Watches the interpolated value of the `ng-src` attribute and writes
 * the resulting string to the real `src` attribute after each digest.
 * The browser only fires a network request once the real attribute is
 * set, so a template that ships `<img ng-src="{{photoUrl}}">` never
 * triggers a 404 for the literal string `"{{photoUrl}}"`.
 *
 * Priority 99. `restrict: 'A'`.
 *
 * @example
 * ```html
 * <img ng-src="{{photoUrl}}" alt="profile photo">
 *
 * <!-- Before the first digest: the real `src` attribute is absent.
 *      The browser fires no network request. -->
 *
 * <!-- After scope.photoUrl = '/img/me.jpg' + digest:
 *      <img ng-src="/img/me.jpg" alt="profile photo" src="/img/me.jpg"> -->
 * ```
 */
export const ngSrcDirective = createUrlAliasDirective('src');

/**
 * `ng-srcset` — interpolation-safe alias for the `srcset` attribute on
 * `<img>` / `<source>` (responsive image sources).
 *
 * Same machinery as `ng-src` / `ng-href`; only the target attribute
 * differs. An empty / nullish interpolated value removes the real
 * `srcset` entirely.
 *
 * Priority 99. `restrict: 'A'`.
 *
 * @example
 * ```html
 * <img ng-src="{{photoUrl}}" ng-srcset="{{photoSet}}" alt="responsive photo">
 *
 * <!-- After scope.photoSet = '/img/me.jpg 1x, /img/me@2x.jpg 2x':
 *      the element has both `src` and `srcset` set on the real DOM
 *      attributes, and the browser picks the right resolution. -->
 * ```
 */
export const ngSrcsetDirective = createUrlAliasDirective('srcset');

/**
 * Mapping from DOM boolean-attribute name to the corresponding
 * normalized `ng`-prefixed attribute name. Same lookup-table style as
 * `NG_ATTR_NAME` above — the spec's exact target names
 * (`ngDisabled` / `ngChecked` / `ngReadonly` / `ngSelected` / `ngOpen`)
 * are visible as literals, and the type narrows the helper's parameter
 * so only the five supported boolean attributes can be passed.
 */
export const NG_BOOLEAN_ATTR_NAME: {
  readonly disabled: 'ngDisabled';
  readonly checked: 'ngChecked';
  readonly readonly: 'ngReadonly';
  readonly selected: 'ngSelected';
  readonly open: 'ngOpen';
} = {
  disabled: 'ngDisabled',
  checked: 'ngChecked',
  readonly: 'ngReadonly',
  selected: 'ngSelected',
  open: 'ngOpen',
};

/**
 * Build an array-form directive factory implementing the
 * boolean-attribute toggle pattern for a given DOM attribute.
 *
 * HTML5 treats boolean attributes (`disabled`, `checked`, `readonly`,
 * `selected`, `open`) by PRESENCE, not by value — `<button disabled>`,
 * `<button disabled="">`, `<button disabled="false">`, and
 * `<button disabled="anything">` all render a DISABLED button. The
 * only way to UN-disable from markup is to remove the attribute
 * entirely. This is why a literal `<button disabled="{{!form.$valid}}">`
 * would be broken: when the expression evaluates falsy, the rendered
 * attribute is `disabled="false"` — still disabled. The `ng-disabled`
 * family solves it by watching the expression and adding/removing the
 * real boolean attribute through `attrs.$set`.
 *
 * The link function calls
 * `scope.$watch(attrs[ngAttrName], (value) => attrs.$set(propName, value ? '' : null))`.
 *
 *  - `attrs[ngAttrName]` is the raw scope expression source for the
 *    `ng`-prefixed attribute (`'!form.$valid'`, `'isReadonly'`, …).
 *    Spec 002's `scope.$watch` accepts the source string directly and
 *    parses it through the expression parser lazily. A defensive
 *    `typeof !== 'string'` early-return matches the spec 023/024
 *    pattern — if the attribute is somehow missing or non-string, no
 *    watch is installed.
 *  - The `value ? '' : null` mapping is LOAD-BEARING:
 *      - Truthy `value` → empty string `''`. `attrs.$set` at
 *        `attributes.ts:271` treats any non-null value as a write, so
 *        the underlying `setAttribute(propName, '')` produces the
 *        bare-presence form `<button disabled="">` — equivalent to
 *        `<button disabled>` per HTML5.
 *      - Falsy `value` → `null`. `$set` at `attributes.ts:271` removes
 *        the attribute when the value is `null` (and ONLY when it is
 *        strictly `null`, not just falsy — the contract is tighter
 *        than a generic "falsy" check). The result is no attribute on
 *        the element, which the browser treats as the absence of the
 *        boolean property.
 *  - DO NOT pass `!!value` (a boolean) to `$set`: the public signature
 *    is `(name: string, value: string | null, writeAttr?: boolean)`,
 *    so TypeScript rejects it; at runtime, `setAttribute(propName, true)`
 *    would coerce the boolean to the literal string `"true"`,
 *    producing the cosmetic noise `<button disabled="true">`. Empty
 *    string is the AngularJS-1.x-canonical serialization.
 *
 * **Priority 100** — one notch above the URL alias helper's 99, and
 * load-bearing for AngularJS-1.x parity. Both helpers sit well above
 * the default 0 and below `ng-non-bindable` (1000).
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject`.
 *
 * @internal Module-private — consumed by the five exported boolean
 *           directive factories in this file. Not exported from
 *           `@compiler/index` or the root barrel.
 */
function createBooleanAliasDirective(
  propName: 'disabled' | 'checked' | 'readonly' | 'selected' | 'open',
): DirectiveFactory {
  const ngAttrName = NG_BOOLEAN_ATTR_NAME[propName];

  const link: LinkFn = (scope, _element, attrs) => {
    const expression = attrs[ngAttrName];
    if (typeof expression !== 'string') {
      // Defensive early-return — matches the spec 023/024 pattern.
      // If the consumer somehow didn't write the `ng`-prefixed
      // attribute on this element, there's nothing to watch.
      return;
    }
    scope.$watch(expression, (value) => {
      // Truthy → empty string `''` → bare-presence `<host propName>`
      // via `setAttribute(propName, '')`.
      // Falsy → `null` → `removeAttribute(propName)`. Spec 017's
      // `$set` at `attributes.ts:271` is the load-bearing piece —
      // it removes ONLY when `value === null`, not on any falsy
      // value, so passing `false` / `0` / `''` directly would be a
      // type error (and behaviorally wrong).
      attrs.$set(propName, value ? '' : null);
    });
  };

  return [
    () =>
      ({
        restrict: 'A',
        priority: 100,
        link,
      }) satisfies DirectiveFactoryReturn,
  ];
}

/**
 * `ng-disabled` — boolean alias for the `disabled` attribute on form
 * controls (`<button>`, `<input>`, `<select>`, `<textarea>`, `<option>`,
 * `<optgroup>`, `<fieldset>`).
 *
 * Watches the bound scope expression and adds/removes the real
 * `disabled` attribute by presence — never sets `disabled="false"`,
 * because HTML5 treats `disabled="false"` as a DISABLED control. The
 * directive corollary `element.disabled` DOM property stays in sync
 * automatically — browsers reflect the boolean attribute through the
 * property getter.
 *
 * Priority 100. `restrict: 'A'`.
 *
 * @example
 * ```html
 * <button ng-disabled="!form.$valid">Submit</button>
 *
 * <!-- scope.form.$valid === false: <button disabled="">…</button>
 *      → element.disabled === true
 *      scope.form.$valid === true:  <button>…</button>
 *      → element.disabled === false -->
 * ```
 */
export const ngDisabledDirective = createBooleanAliasDirective('disabled');

/**
 * `ng-checked` — boolean alias for the `checked` attribute on
 * `<input type="checkbox">` and `<input type="radio">`.
 *
 * Watches the bound scope expression and adds/removes the real
 * `checked` attribute by presence. The DOM property `element.checked`
 * stays in sync.
 *
 * Note: `ng-checked` controls only the DEFAULT-checked state
 * (the attribute). For two-way binding between the model and the
 * user-toggled state, the canonical AngularJS approach is `ng-model`
 * (future spec) — `ng-checked` is the one-way binding for cases where
 * the model owns the state but the user is not expected to toggle it
 * directly (think: a confirmation-flow read-only checkbox).
 *
 * Priority 100. `restrict: 'A'`.
 *
 * @example
 * ```html
 * <input type="checkbox" ng-checked="settings.notifications">
 *
 * <!-- scope.settings.notifications === true:
 *      <input type="checkbox" checked="">
 *      → element.checked === true -->
 * ```
 */
export const ngCheckedDirective = createBooleanAliasDirective('checked');

/**
 * `ng-readonly` — boolean alias for the `readonly` attribute on
 * `<input>` and `<textarea>`.
 *
 * Watches the bound scope expression and adds/removes the real
 * `readonly` attribute. A read-only input still participates in form
 * submission but rejects user edits — different from `disabled`, which
 * also blocks submission.
 *
 * Priority 100. `restrict: 'A'`.
 *
 * @example
 * ```html
 * <input ng-readonly="record.locked" value="cannot edit when locked">
 *
 * <!-- scope.record.locked === true:
 *      <input readonly="" value="cannot edit when locked">
 *      → element.readOnly === true -->
 * ```
 */
export const ngReadonlyDirective = createBooleanAliasDirective('readonly');

/**
 * `ng-selected` — boolean alias for the `selected` attribute on
 * `<option>` elements inside `<select>`.
 *
 * Watches the bound scope expression and adds/removes the real
 * `selected` attribute. The corresponding `<option>.selected` DOM
 * property stays in sync.
 *
 * Priority 100. `restrict: 'A'`.
 *
 * @example
 * ```html
 * <select>
 *   <option value="a" ng-selected="choice === 'a'">A</option>
 *   <option value="b" ng-selected="choice === 'b'">B</option>
 * </select>
 *
 * <!-- scope.choice === 'b':
 *      the second <option> carries `selected=""` and is highlighted
 *      in the rendered dropdown. -->
 * ```
 */
export const ngSelectedDirective = createBooleanAliasDirective('selected');

/**
 * `ng-open` — boolean alias for the `open` attribute on `<details>`
 * (and `<dialog>` for non-modal openness).
 *
 * Watches the bound scope expression and adds/removes the real `open`
 * attribute. When the attribute is present, the disclosure widget is
 * expanded; absent, it is collapsed.
 *
 * Priority 100. `restrict: 'A'`.
 *
 * @example
 * ```html
 * <details ng-open="section === 'about'">
 *   <summary>About</summary>
 *   <p>…</p>
 * </details>
 *
 * <!-- scope.section === 'about':
 *      <details open=""><summary>…</summary><p>…</p></details>
 *      → element.open === true -->
 * ```
 */
export const ngOpenDirective = createBooleanAliasDirective('open');
