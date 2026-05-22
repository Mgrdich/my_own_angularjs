/**
 * `ngClass` / `ngClassEven` / `ngClassOdd` — dynamically add or remove
 * CSS classes on an element based on a scope expression (spec 024
 * Slices 1 & 2 / FS §2.1, §2.2, technical-considerations §2.2).
 *
 * `<div ng-class="expr">…</div>` reads `expr` and applies the resulting
 * class set to the element. Three expression forms are supported,
 * normalized by the shared {@link flattenClassExpression} helper:
 *
 * - **String** — `ng-class="'highlighted'"` adds the class
 *   `highlighted`. Multiple whitespace-separated names
 *   (`'class1 class2'`) add each as a separate class.
 * - **Array** — `ng-class="['a', 'b']"` adds each element. Array
 *   elements that are themselves plain objects follow the object form;
 *   string elements follow the string form. Other element types are
 *   ignored.
 * - **Object** — `ng-class="{ active: cond, error: hasFault }"` adds
 *   each key whose value is truthy, removes each key whose value is
 *   falsy.
 *
 * **Classes-preserved guarantee.** The directive tracks which classes
 * IT added in `appliedClasses` and only removes classes from that set
 * on subsequent diffs. Classes already on the element when the
 * directive ran (e.g. `<div class="card" ng-class="…">`) are never in
 * the tracking set and are therefore never removed. This is the
 * AngularJS-canonical behavior — `ng-class` plays nicely with both
 * static `class="…"` markup and other directives that mutate the
 * element's class list (`ng-show` / `ng-hide` toggling `ng-hide`,
 * etc.).
 *
 * **Watcher shape.** A single `scope.$watchCollection(attrs.ngClass,
 * …)` per element. `$watchCollection` provides one-level-deep
 * collection diffing so array `push` and object key flips are caught
 * without forcing the consumer to re-assign the whole value. For
 * primitive string values the watch falls back to identity comparison
 * — the same effective behavior as `$watch`.
 *
 * **Animations.** This spec ships synchronous class toggles only. The
 * `$animate.addClass` / `$animate.removeClass` hooks that animate
 * class transitions are deferred to Phase 4 (a future spec). The
 * link function does NOT contain animation hooks today.
 *
 * **`ng-class-even` / `ng-class-odd`.** Slice 2 ships the two
 * index-gated variants. They share the same engine
 * ({@link installClassWatcher}) as `ng-class` but pass a `gate`
 * predicate (`(scope) => !!scope.$even` / `…$odd`) plus the gate's
 * scope-property name (`'$even'` / `'$odd'`). When `gateProperty` is
 * supplied the engine installs a secondary `scope.$watch(gateProperty,
 * refire)` so a gate flip with the expression itself unchanged still
 * triggers the diff. Outside `ng-repeat` (no `$even` / `$odd` on the
 * scope) the gate evaluates falsy and the directive contributes no
 * classes — no error is thrown.
 *
 * The factories are array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject`. The
 * gate-aware {@link installClassWatcher} helper is module-private and
 * shared across all three directives.
 *
 * @example String form
 * ```html
 * <div ng-class="'active'">…</div>
 * <!-- Element gets the `active` class once the digest runs. -->
 * ```
 *
 * @example Array form
 * ```html
 * <div ng-class="['selected', 'primary']">…</div>
 * <!-- Element gets `selected` and `primary`. -->
 * ```
 *
 * @example Object form
 * ```html
 * <div ng-class="{ active: isSelected, error: hasFault }">…</div>
 * <!-- When isSelected is truthy and hasFault is falsy: only `active`
 *      applied. Flip hasFault to truthy → `error` is added on the next
 *      digest. Flip isSelected to falsy → `active` is removed. -->
 * ```
 *
 * @example Consumer-shipped classes preserved
 * ```html
 * <div class="card" ng-class="'highlighted'">…</div>
 * <!-- After digest: class = "card highlighted". Changing the
 *      expression to '' (empty) removes only `highlighted` — `card`
 *      stays because it was never in the directive's tracking set. -->
 * ```
 */

import type { Scope } from '@core/index';

import { flattenClassExpression } from './class-expression';
import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

/**
 * Gate predicate consumed by {@link installClassWatcher}. Returns `true`
 * to allow the resolved class set through to the DOM, `false` to apply
 * an empty set (which, via the diff, REMOVES any previously-applied
 * classes). Slice 2 supplies `(scope) => !!scope.$even` for
 * `ng-class-even` and `(scope) => !!scope.$odd` for `ng-class-odd`. The
 * plain `ng-class` directive passes no gate.
 */
type ClassWatcherGate = (scope: Scope & { $odd?: boolean; $even?: boolean }) => boolean;

/**
 * Install the class-watch + diff cycle on `element` against `expr`,
 * optionally gated by `gate` and a `gateProperty` scope-key.
 *
 * The closed-over `appliedClasses` set tracks the classes THIS instance
 * has added, so consumer-shipped classes are never touched — this is
 * the classes-preserved guarantee.
 *
 * **Parameters.**
 *
 * - `expr` — the directive's attribute value (e.g. `attrs.ngClass`),
 *   passed verbatim to `scope.$watchCollection`.
 * - `gate` — optional predicate that decides whether the resolved
 *   class set is allowed through. When `gate(scope)` returns `false`
 *   the listener applies an empty set (diff-cycle removes any
 *   previously-applied classes).
 * - `gateProperty` — optional scope-key name for the variable that
 *   drives `gate`. When supplied, the engine installs a SECONDARY
 *   `scope.$watch(gateProperty, …)` that re-fires the diff against the
 *   last expression value seen by `$watchCollection`. This is what
 *   lets `ng-class-even` / `ng-class-odd` re-evaluate when `$even` /
 *   `$odd` flips with the expression itself unchanged.
 *
 * **Slice 2 wiring.** The Slice 1 contract (no gate) is preserved
 * verbatim — the secondary watch only installs when `gateProperty` is
 * supplied. The `lastValue` closure variable seeds to `undefined`; the
 * gate-flip listener is safe to fire before the collection listener
 * has ever run because `flattenClassExpression(undefined)` returns an
 * empty set.
 *
 * @internal Module-private — shared by `ngClassDirective`,
 *           `ngClassEvenDirective`, and `ngClassOddDirective`.
 */
function installClassWatcher(
  scope: Scope,
  element: Element,
  expr: string,
  gate?: ClassWatcherGate,
  gateProperty?: string,
): void {
  let appliedClasses: Set<string> = new Set<string>();
  let lastValue: unknown = undefined;

  /**
   * Apply the diff for a given expression value, respecting the gate.
   * Pulled out as a local so both the `$watchCollection` listener and
   * the (optional) gate-flip watcher can drive it.
   */
  const applyDiff = (value: unknown): void => {
    const targetClasses = gate !== undefined && !gate(scope) ? new Set<string>() : flattenClassExpression(value);

    // Diff: remove classes WE added that are no longer in the target
    // set. Consumer-shipped classes (e.g. `<div class="card">`) are
    // never in `appliedClasses` and are therefore preserved.
    for (const cls of appliedClasses) {
      if (!targetClasses.has(cls)) {
        element.classList.remove(cls);
      }
    }
    // Add classes that are in the target set but were not in
    // `appliedClasses`. Classes already in both are untouched.
    for (const cls of targetClasses) {
      if (!appliedClasses.has(cls)) {
        element.classList.add(cls);
      }
    }
    appliedClasses = targetClasses;
  };

  scope.$watchCollection(expr, (value: unknown) => {
    lastValue = value;
    applyDiff(value);
  });

  // Secondary watch on the gate property (e.g. `$even` / `$odd`). Re-
  // fires the diff against the cached `lastValue` whenever the gate
  // flips without the expression itself changing. Only installed when
  // BOTH a gate predicate AND a `gateProperty` are supplied — the
  // plain `ng-class` directive passes neither.
  if (gate !== undefined && gateProperty !== undefined) {
    scope.$watch(gateProperty, () => {
      applyDiff(lastValue);
    });
  }
}

function ngClassFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const expr = attrs['ngClass'];
    if (typeof expr !== 'string') {
      // Defensive — `attrs['ngClass']` is typed as `string | undefined`
      // through the index signature. If the attribute is missing
      // entirely the directive shouldn't have matched, but bail
      // cleanly rather than passing `undefined` into `$watchCollection`.
      return;
    }
    installClassWatcher(scope, element, expr);
  };

  return {
    restrict: 'A',
    link,
  };
}

function ngClassEvenFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const expr = attrs['ngClassEven'];
    if (typeof expr !== 'string') {
      return;
    }
    // `$even` is conventionally populated by `ng-repeat` (a future
    // spec) on each iteration's child scope; outside that context the
    // property is absent and `!!undefined === false`, which is the
    // documented "no-op" behavior. Reachable through the `Scope`
    // class's `[key: string]: unknown` index signature — no cast.
    installClassWatcher(scope, element, expr, (s) => !!s.$even, '$even');
  };

  return {
    restrict: 'A',
    link,
  };
}

function ngClassOddFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const expr = attrs['ngClassOdd'];
    if (typeof expr !== 'string') {
      return;
    }
    // See `ngClassEvenFactory` — same `$odd` convention, same
    // index-signature access path.
    installClassWatcher(scope, element, expr, (s) => !!s.$odd, '$odd');
  };

  return {
    restrict: 'A',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngClass', ngClassDirective)`. Zero
 * dependencies — the `annotate` helper rejects bare functions, so the
 * factory is wrapped in the canonical array form even though its
 * dependency list is empty.
 */
export const ngClassDirective: DirectiveFactory = [ngClassFactory];

/**
 * `ng-class-even` — applies the resolved class set only when the
 * scope's `$even` property is truthy.
 *
 * Same three expression forms as `ng-class` (string / array / object),
 * normalized through the shared {@link flattenClassExpression} helper.
 * Internally shares {@link installClassWatcher} with `ng-class` and
 * `ng-class-odd`; the gate predicate is `(scope) => !!scope.$even` and
 * a secondary `scope.$watch('$even', …)` triggers a refire when
 * `$even` flips without the expression itself changing.
 *
 * The classes-preserved guarantee is unchanged: only classes this
 * directive instance added are subject to removal. Consumer-shipped
 * classes and classes contributed by sibling `ng-class` /
 * `ng-class-odd` directives on the same element are untouched.
 *
 * Outside `ng-repeat` (no `$even` on the scope) the gate evaluates
 * falsy and the directive contributes no classes. No error is thrown
 * — the directive is intentionally tolerant of being used outside the
 * canonical iteration context.
 *
 * @example Gated on `$even`
 * ```html
 * <div ng-class-even="'highlight'">…</div>
 * <!-- Only carries the `highlight` class on digests where
 *      scope.$even is truthy. When ng-repeat lands, that's the
 *      even-indexed iterations; today it's any scope where the
 *      developer manually sets $even. -->
 * ```
 *
 * @example Combined with `ng-class` on the same element
 * ```html
 * <div ng-class="'always'" ng-class-even="'sometimes'">…</div>
 * <!-- $even = true  → element has both `always` and `sometimes`.
 *      $even = false → element has only `always`. -->
 * ```
 */
export const ngClassEvenDirective: DirectiveFactory = [ngClassEvenFactory];

/**
 * `ng-class-odd` — applies the resolved class set only when the
 * scope's `$odd` property is truthy.
 *
 * Mirror-inverse of {@link ngClassEvenDirective}. Gate predicate is
 * `(scope) => !!scope.$odd`; the secondary watch is on `'$odd'`. All
 * other semantics (expression forms, classes-preserved guarantee,
 * combined usage, tolerance outside `ng-repeat`) are identical.
 *
 * @example Gated on `$odd`
 * ```html
 * <div ng-class-odd="'striped'">…</div>
 * <!-- Only carries the `striped` class on digests where
 *      scope.$odd is truthy. -->
 * ```
 *
 * @example Combined with `ng-class-even` for zebra-stripe rows
 * ```html
 * <li ng-class-even="'row-even'" ng-class-odd="'row-odd'">…</li>
 * <!-- Each iteration of an enclosing ng-repeat carries exactly one
 *      of `row-even` / `row-odd`, never both. -->
 * ```
 */
export const ngClassOddDirective: DirectiveFactory = [ngClassOddFactory];
