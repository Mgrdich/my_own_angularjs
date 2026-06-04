/**
 * `ngStyle` — dynamically set inline CSS styles on an element from a
 * scope expression (spec 024 Slice 3 / FS §2.3, technical-considerations
 * §2.3).
 *
 * `<div ng-style="expr">…</div>` reads `expr` and applies the resulting
 * `{ cssProperty: value }` pairs as inline styles on the element. Only
 * the **object form** is supported — `ng-style` accepts a plain object
 * whose keys are CSS property names and whose values stringify into CSS
 * values. Other shapes (string, array, primitive) resolve to an empty
 * property set: any directive-applied styles are cleared and nothing
 * new is written.
 *
 * **Expression form.**
 *
 * - **Object** — `ng-style="{ color: 'red', fontSize: '14px' }"` sets
 *   each key as an inline CSS property with its associated value.
 * - **`null` / `undefined`** — all directive-applied styles are cleared.
 * - **Other value types** — number, string, array, function: treated as
 *   the empty property set (any directive-applied styles are cleared).
 *
 * **Property-name convention.** Property names are read as-is from the
 * object's keys. Both kebab-case (`'background-color'`) and camelCase
 * (`'backgroundColor'`) work — the directive dispatches on the
 * presence of a hyphen: kebab-case keys go through
 * `setProperty` / `removeProperty` (the CSS-property-name surface),
 * camelCase keys go through direct `element.style[key] = …` /
 * `element.style[key] = ''` assignment (the DOM IDL surface). This
 * matches the AngularJS-canonical behavior and aligns with the actual
 * web-platform contract — `setProperty('fontSize', …)` is a no-op per
 * spec because CSSOM's `setProperty` requires kebab-case property
 * names, but the IDL property `element.style.fontSize` accepts the
 * camelCase form directly. Mixed-case keys in the same expression are
 * supported; each is dispatched independently.
 *
 * **Styles-preserved guarantee.** The directive tracks which property
 * names IT has set in `appliedProps` and only removes properties from
 * that set on subsequent diffs. Inline styles set by the consumer
 * directly on the element (e.g. `<div style="margin: 5px"
 * ng-style="…">`) are NEVER in the tracking set and are therefore never
 * removed UNLESS the directive's expression later names the same
 * property — at which point the directive overwrites the consumer's
 * value and the property becomes directive-owned (AngularJS-canonical
 * "ng-style wins" behavior).
 *
 * **Watcher shape.** A single `scope.$watchCollection(attrs.ngStyle,
 * …)` per element. `$watchCollection` provides one-level-deep object
 * diffing so key flips and value changes are caught without the
 * consumer having to re-assign the whole value.
 *
 * **Animations.** This spec ships synchronous style writes only. The
 * `$animate.setStyles` hooks that animate style transitions are
 * deferred to Phase 4 (a future spec). The link function does NOT
 * contain animation hooks today.
 *
 * **Implementation note: per-property writes, NOT `cssText`.** Using
 * `element.style.cssText = '…'` would clobber every inline style on
 * the element — including consumer-shipped ones — defeating the
 * styles-preserved guarantee. `setProperty` / `removeProperty` (for
 * kebab-case keys) and direct IDL property assignment (for camelCase
 * keys) both mutate one property at a time, leaving the rest of
 * `element.style` alone.
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject` — this is
 * the same canonical shape used by the spec 023 directives and
 * `ngClass`.
 *
 * @example Set styles from an object expression
 * ```html
 * <div ng-style="{ color: 'red', fontSize: '14px' }">…</div>
 * <!-- After digest: element.style.color === 'red' and
 *      element.style.fontSize === '14px'. -->
 * ```
 *
 * @example Property removed when key leaves the expression
 * ```html
 * <div ng-style="styles">…</div>
 * <!-- scope.styles = { color: 'red', fontSize: '14px' } → both applied.
 *      scope.styles = { color: 'red' }                  → fontSize cleared
 *                                                          (now '').
 *      scope.styles = null                              → color also
 *                                                          cleared. -->
 * ```
 *
 * @example Consumer-shipped inline style preserved
 * ```html
 * <div style="margin: 5px" ng-style="{ color: 'red' }">…</div>
 * <!-- After digest: margin === '5px' AND color === 'red'.
 *      The directive never names `margin`, so it survives.
 *      Change ng-style to { margin: '10px' } → margin becomes '10px'
 *      (directive wins — now directive-owned).
 *      Change ng-style to {} → margin becomes '' (directive cleared
 *      the property it set on the previous digest). -->
 * ```
 *
 * @example Kebab-case and camelCase property names both work
 * ```html
 * <div ng-style="{ 'background-color': 'red' }">…</div>
 * <div ng-style="{ backgroundColor: 'red' }">…</div>
 * <!-- Both forms produce element.style.backgroundColor === 'red'. -->
 * ```
 */

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';
import { isStyleableElement } from './node-guards';

/**
 * Normalized directive name — registration in `ng-module.ts` and the
 * `attrs[NG_STYLE_NAME]` lookup in this file are tied together via this
 * constant so a rename touches both at once.
 */
export const NG_STYLE_NAME = 'ngStyle';

/**
 * Subset of `keyof CSSStyleDeclaration` whose slots hold writable
 * strings — i.e. the camelCase IDL property names (`color`,
 * `backgroundColor`, …) excluding methods (`setProperty`,
 * `getPropertyValue`, …) and the numeric `length` slot.
 *
 * @internal
 */
type CssIdlKey = {
  [K in Extract<keyof CSSStyleDeclaration, string>]-?: CSSStyleDeclaration[K] extends string ? K : never;
}[Extract<keyof CSSStyleDeclaration, string>];

/**
 * Kebab-case CSS property name — any string containing a hyphen.
 * Matches the runtime shape `setProperty` / `removeProperty` consume.
 *
 * @internal
 */
type KebabCssKey = `${string}-${string}`;

/**
 * Either spelling a consumer may use as an `ng-style` object key. The
 * single boundary cast lives in `resolveStyleProps`; from there on
 * `appliedProps`, the diff loop, and `applyStyle` / `clearStyle` are
 * cast-free.
 *
 * @internal
 */
type StyleName = CssIdlKey | KebabCssKey;

/**
 * Type predicate for the kebab branch. Narrows `StyleName` to
 * `KebabCssKey` (the `setProperty` surface) or — by exhaustion — to
 * `CssIdlKey` (the IDL-assignment surface) in the else branch.
 *
 * @internal
 */
function isKebabName(name: StyleName): name is KebabCssKey {
  return name.includes('-');
}

/**
 * Compute the property-name set AND the narrowed record from `value`.
 * Only plain objects (`typeof === 'object'`, non-null, non-array)
 * contribute keys; every other shape — including arrays, primitives,
 * and `null` / `undefined` — collapses to `{ props: empty, record:
 * null }`. Arrays are deliberately REJECTED even though
 * `Object.keys([1, 2])` yields `['0', '1']`: `ng-style` accepts plain
 * objects only, so an array-typed expression value clears any
 * directive-applied styles rather than spraying numeric-name
 * properties onto `element.style`.
 *
 * Returning the narrowed record alongside the keys lets the caller
 * read property values without a follow-up `value as Record<string,
 * unknown>` cast — the narrowing established here is preserved
 * through the return type.
 *
 * The `Object.keys(...) as StyleName[]` cast is the single boundary
 * narrowing in the file: it expresses the `ng-style` contract that
 * object keys are CSS property names (camelCase IDL or kebab-case
 * CSSOM). Downstream consumers (`applyStyle` / `clearStyle` / the diff
 * loop) operate on `StyleName` end-to-end with no further casts. The
 * cast itself is the TS-canonical workaround for `Object.keys`'s
 * specified `string[]` return type and cannot be replaced by a guard.
 *
 * @internal
 */
function resolveStyleProps(value: unknown): { props: Set<StyleName>; record: Record<string, unknown> | null } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { props: new Set<StyleName>(), record: null };
  }
  const record = value as Record<string, unknown>;
  return { props: new Set<StyleName>(Object.keys(record) as StyleName[]), record };
}

/**
 * Write a single inline style. Dispatches on the property-name shape:
 * kebab-case goes through `setProperty` (the CSSOM surface for
 * hyphenated property names); camelCase goes through direct
 * `style[name] = value` assignment (the DOM IDL surface).
 *
 * The dispatch is necessary because CSSOM's `setProperty` is specified
 * to accept ONLY kebab-case property names — `setProperty('fontSize',
 * '14px')` is a spec-defined no-op. The IDL surface is the opposite:
 * `style.fontSize = '14px'` works, `style['font-size'] = '14px'` is
 * undefined behavior. The two surfaces together cover every property
 * name a consumer can spell.
 *
 * @internal
 */
function applyStyle(style: CSSStyleDeclaration, name: StyleName, value: string): void {
  if (isKebabName(name)) {
    style.setProperty(name, value);
  } else {
    style[name] = value;
  }
}

/**
 * Clear a single inline style. Mirror of {@link applyStyle}: kebab-case
 * goes through `removeProperty`; camelCase goes through direct
 * `style[name] = ''` assignment.
 *
 * @internal
 */
function clearStyle(style: CSSStyleDeclaration, name: StyleName): void {
  if (isKebabName(name)) {
    style.removeProperty(name);
  } else {
    style[name] = '';
  }
}

function ngStyleFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const expr = attrs[NG_STYLE_NAME];
    if (typeof expr !== 'string') {
      // Defensive — `attrs['ngStyle']` is typed as `string | undefined`
      // through the index signature. If the attribute is missing
      // entirely the directive shouldn't have matched, but bail
      // cleanly rather than passing `undefined` into `$watchCollection`.
      return;
    }

    // Closed-over per-element state: the set of CSS property names
    // THIS instance has applied to `element.style`. Consumer-shipped
    // inline styles (e.g. `<div style="margin: 5px">`) are never in
    // this set and are therefore never removed by the diff cycle —
    // this is the styles-preserved guarantee.
    let appliedProps: Set<StyleName> = new Set<StyleName>();

    // `Element` is the directive-link signature — narrow once to a
    // style-bearing element for the `.style` access. Comment-restricted
    // matches never reach `ng-style` (attribute-restricted directive);
    // `isStyleableElement` admits both `HTMLElement` and `SVGElement`
    // since both implement `ElementCSSInlineStyle`.
    if (!isStyleableElement(element)) {
      return;
    }
    const { style } = element;

    scope.$watchCollection(expr, (value: unknown) => {
      const { props: newProps, record } = resolveStyleProps(value);

      // Diff (1) — clear properties WE applied that the new value no
      // longer names. Properties on the element that are NOT in
      // `appliedProps` (e.g. consumer-shipped inline styles, styles
      // contributed by a sibling directive) are left alone.
      for (const propName of appliedProps) {
        if (!newProps.has(propName)) {
          clearStyle(style, propName);
        }
      }

      // Diff (2) — write every property in the new value (always set,
      // not just on change — `$watchCollection` already filters out
      // no-op digests for unchanged collections). String coercion via
      // `String(...)` matches `ng-bind`'s contract and CSS-value
      // conventions; non-string values (numbers, booleans) stringify
      // the canonical JS way. `record` is non-null whenever
      // `newProps.size > 0` (both flow from the same plain-object
      // narrowing inside `resolveStyleProps`), so the typeof check
      // here is unreachable but kept for type-narrowing.
      if (newProps.size > 0 && record !== null) {
        for (const propName of newProps) {
          applyStyle(style, propName, String(record[propName]));
        }
      }

      appliedProps = newProps;
    });
  };

  return {
    restrict: 'A',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngStyle', ngStyleDirective)`. Zero
 * dependencies — the `annotate` helper rejects bare functions, so the
 * factory is wrapped in the canonical array form even though its
 * dependency list is empty.
 */
export const ngStyleDirective: DirectiveFactory = [ngStyleFactory];
