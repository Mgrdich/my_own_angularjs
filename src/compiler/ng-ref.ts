/**
 * `ngRef` — publish a reference to a directive's controller (or its DOM
 * element) onto the surrounding scope (spec 030 Slice 3 / FS §2.x,
 * technical-considerations §2.3).
 *
 * `<my-widget ng-ref="widget">` writes the value selected by the rules
 * below into the scope slot named by the `ng-ref` expression — so
 * sibling markup can read `{{ widget.someProperty }}` or a bound
 * handler can call `widget.doThing()`. The directive is the AngularJS
 * 1.7+ template-side analogue of `@ViewChild` in Angular.
 *
 * **DDO shape and registration.** `restrict: 'A'`, default priority,
 * **post-link only**. Post-link is deliberate: by the time post-link
 * runs the per-element controller seam (spec 022 Slice 3) has already
 * stashed every controller for the element into the non-enumerable
 * `$$ngControllers: Map<string, unknown>` slot, so reading the own
 * element's controller is reliable. A pre-link variant could race the
 * seam and read an empty map.
 *
 * **Value selection (three-way read dispatch).** The published value
 * depends on whether the optional `ng-ref-read` attribute is present:
 *
 *   1. **`ng-ref-read="$element"`** → publish the native `Element`
 *      itself (raw-Element convention, spec 017). The author
 *      explicitly asked for the DOM node, so no controller lookup runs.
 *   2. **`ng-ref-read="<directiveName>"`** (any other value) → look up
 *      `$$ngControllers.get(directiveNormalize(readName))` on the OWN
 *      element. A HIT publishes that controller. A MISS (no such
 *      controller on the element) is an authoring mistake — the author
 *      named a specific directive that is not present — so it routes a
 *      {@link NgRefNoControllerError} via
 *      `invokeExceptionHandler($exceptionHandler, err, '$compile')` and
 *      publishes NOTHING (no element fallback; the directive is inert
 *      for this read). This differs from the default-read miss below,
 *      which DOES fall back to the element.
 *   3. **No `ng-ref-read`** → the default read. The published value is:
 *      a. The controller stashed under the OWN element's normalized
 *         tag-name key in `$$ngControllers` — i.e.
 *         `$$ngControllers.get(directiveNormalize(element.tagName.toLowerCase()))`.
 *         This targets the canonical case of `ng-ref` on a component
 *         element (`<my-widget ng-ref="…">`) where the component
 *         directive shares the element's tag name and registers its
 *         controller under that key.
 *      b. Otherwise the native `Element` itself — the plain-element
 *         case (`<div ng-ref="…">` with no matching controller)
 *         publishes the DOM node so consumers can read `.value`,
 *         `.focus()`, etc.
 *
 * **Publish via the assignable-expression writer.** The `ng-ref`
 * expression must be an assignable l-value — an `Identifier` (`widget`)
 * or a `MemberExpression` (`refs.widget`). The value is written onto
 * the scope through {@link buildParentWriter}, the same machinery the
 * `=` two-way isolate binding uses; dotted paths auto-create their
 * intermediate objects via `ensurePath`, so `ng-ref="refs.widget"`
 * works even when `scope.refs` did not previously exist.
 *
 * **Bad-expression inert behavior.** A missing/empty `ng-ref` OR a
 * non-assignable expression (`ng-ref="123bad"`, `ng-ref="a + b"`,
 * `ng-ref="fn()"`) routes a {@link NgRefBadExpressionError} carrying
 * the offending text via `invokeExceptionHandler($exceptionHandler,
 * err, '$compile')` and makes the directive INERT — it publishes
 * nothing and installs no destroy listener. This is the FS criterion
 * for `ng-ref="123bad"`. No new `EXCEPTION_HANDLER_CAUSES` token; the
 * tuple stays at 10.
 *
 * **Surrounding-scope publish (upstream parity).** `ngRef` is a
 * non-isolate directive, so it publishes to the element's SURROUNDING
 * scope — the pre-isolate scope a true outer DOM sibling shares —
 * matching AngularJS's `linkFn.isolateScope ? isolateScope : scope`
 * rule. This compiler uses one scope per element, so on a `.component`
 * / isolate element the scope the link fn receives IS the isolate
 * scope; publishing there would hide the reference from a real sibling.
 * The compiler stamps the surrounding (pre-isolate) scope onto isolate
 * elements via the `$$ngIsolateHostScope` slot (the `setIsolateHostScope`
 * / `getIsolateHostScope` pair in `cleanup.ts`); the link fn reads it
 * as `getIsolateHostScope(element) ?? scope`. On a non-isolate element
 * (plain element, or a `scope: true` child element) the slot is absent
 * and the surrounding scope IS the linked scope — `scope: true`
 * elements publish to the child scope, matching upstream.
 *
 * **Clear-on-destroy guard.** On the LINKED scope's `$destroy` (the
 * element's own scope — the isolate scope for a component — tears down
 * when the element is removed, e.g. by `ng-if`) the published value is
 * reset to `null` on the SURROUNDING scope — but ONLY IF that slot
 * still holds the reference this directive published. Reading the slot
 * and comparing identity before clearing guards against clobbering a
 * newer publish (e.g. when the same `ng-ref` name was re-bound
 * elsewhere before this scope tore down) — upstream-parity behavior.
 *
 * Registered on `ngModule` only (DI-only, the spec 018/023–029
 * precedent) — reachable via `injector.get('ngRefDirective')`, NOT
 * exported from `@compiler/index` or the root barrel. The
 * {@link NgRefBadExpressionError} class, by contrast, IS exported from
 * both barrels.
 *
 * @example Reference a component controller from a true outer sibling
 * ```html
 * <my-player ng-ref="player"></my-player>
 * <button ng-click="player.play()">Play</button>
 * <!-- `<my-player>` is a component (isolate scope), but `ng-ref`
 *      publishes its controller onto the element's SURROUNDING scope —
 *      the same scope the sibling <button> binds against. So
 *      `player.play()` reaches the component's controller even though
 *      the button is a real outer DOM sibling, not nested inside the
 *      component. (`scope.player` is read from $$ngControllers under the
 *      'myPlayer' key.) -->
 * ```
 *
 * @example Reference a plain DOM element via a dotted path
 * ```html
 * <input ng-ref="form.name">
 * <span>{{ form.name.value }}</span>
 * <!-- No controller on <input> → `scope.form.name` is the native
 *      <input> Element (the `form` intermediate object is auto-created
 *      by the assignable writer). -->
 * ```
 *
 * @example Request the raw element or a specific controller via `ng-ref-read`
 * ```html
 * <input ng-ref="el" ng-ref-read="$element">
 * <!-- `scope.el` is the native <input> Element, regardless of any
 *      controller on the element. -->
 *
 * <my-widget ng-ref="widget" ng-ref-read="myWidget"></my-widget>
 * <!-- `scope.widget` is the `myWidget` controller; a miss (no myWidget
 *      controller on the element) routes NgRefNoControllerError and
 *      publishes nothing. -->
 * ```
 */

import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { parse } from '@parser/index';

import { getIsolateHostScope } from './cleanup';
import { NgRefBadExpressionError, NgRefNoControllerError } from './compile-error';
import { directiveNormalize } from './directive-normalize';
import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';
import { buildParentWriter } from './expression-assign';
import { isNgManagedElement, NG_CONTROLLERS } from './element-slots';

/**
 * Normalized directive name — registration in `src/core/ng-module.ts`
 * and this file are tied together via this constant so a rename touches
 * both at once.
 */
export const NG_REF_NAME = 'ngRef';

/**
 * Read the controller stashed under `name` on the element's
 * `$$ngControllers` map (planted by the spec 022 Slice 3 controller
 * seam). Returns `undefined` when the element is unmanaged, has no
 * controller map, or has no controller under that key. Mirrors the
 * read pattern in `require-resolver.ts`.
 */
function readOwnController(element: Element, name: string): unknown {
  if (!isNgManagedElement(element)) {
    return undefined;
  }
  const map = element[NG_CONTROLLERS];
  if (map === undefined) {
    return undefined;
  }
  return map.get(name);
}

function ngRefFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    const refExpr = attrs[NG_REF_NAME];
    if (typeof refExpr !== 'string' || refExpr === '') {
      // Missing / empty `ng-ref` — inert, but report (the author wrote
      // the attribute, so an empty value is a mistake worth surfacing).
      // `refExpr` is typed `string | undefined` here, and the only
      // non-string runtime case is `undefined`, so the empty-string
      // stand-in is a faithful descriptor for both bail paths.
      invokeExceptionHandler($exceptionHandler, new NgRefBadExpressionError(''), '$compile');
      return;
    }

    // `buildParentWriter` returns `undefined` for a non-assignable
    // expression (anything other than an `Identifier` or
    // `MemberExpression` — see `isAssignable` in `expression-assign.ts`),
    // so we use it as the single assignability gate: parse once, hand
    // the compiled `ExpressionFn` (with its `$$ast` handle) to the
    // builder, and bail inert when no writer comes back. This covers
    // the FS `ng-ref="123bad"` criterion (a leading-digit token is not
    // a valid identifier and parses to a non-assignable node) as well
    // as `ng-ref="a + b"`, `ng-ref="fn()"`, etc.
    const refFn = parse(refExpr);
    const writeRef = buildParentWriter(refFn);
    if (writeRef === undefined) {
      invokeExceptionHandler($exceptionHandler, new NgRefBadExpressionError(refExpr), '$compile');
      return;
    }

    // Value selection — three-way read dispatch on the optional
    // `ng-ref-read` attribute (Slice 4).
    const readName = attrs.ngRefRead;
    let value: unknown;
    if (typeof readName === 'string' && readName !== '') {
      if (readName === '$element') {
        // Explicit raw-Element request — no controller lookup.
        value = element;
      } else {
        // Named directive — read its controller off the OWN element. A
        // miss is an authoring mistake (the author named a specific
        // directive that is not present): report and publish NOTHING.
        const requested = readOwnController(element, directiveNormalize(readName));
        if (requested === undefined) {
          invokeExceptionHandler(
            $exceptionHandler,
            new NgRefNoControllerError(readName, element.tagName.toLowerCase()),
            '$compile',
          );
          return;
        }
        value = requested;
      }
    } else {
      // Default read (no `ng-ref-read`): the own element's controller
      // keyed by its normalized tag name when present, else the native
      // Element (the plain-element fallback).
      const ownControllerKey = directiveNormalize(element.tagName.toLowerCase());
      const ownController = readOwnController(element, ownControllerKey);
      value = ownController !== undefined ? ownController : element;
    }

    // Publish onto the element's SURROUNDING (pre-isolate) scope when the
    // element bears an isolate scope — so a true outer DOM sibling
    // (`<button ng-click="player.play()">`) can see the published
    // reference. On a non-isolate element `getIsolateHostScope` returns
    // undefined and the publish target IS the linked scope (upstream
    // parity for `linkFn.isolateScope ? isolateScope : scope`).
    const publishScope = getIsolateHostScope(element) ?? scope;
    writeRef(publishScope, value);

    // Clear-on-destroy with an identity guard: only null out the slot if
    // it still holds OUR published value. A newer publish under the same
    // name (rare, but legal) must not be clobbered by this teardown.
    // Reading the current value through the SAME compiled `refFn`
    // resolves a dotted-path ref (`refs.widget`) correctly rather than
    // doing a flat property lookup. The read/write target is
    // `publishScope` (the surrounding scope on an isolate element), but
    // the listener stays on the LINKED `scope` — the element's own scope
    // (the isolate scope for a component) is what `$destroy`s when the
    // element is removed (e.g. by `ng-if`), the correct trigger to clear
    // the published ref from the surrounding scope.
    scope.$on('$destroy', () => {
      if (refFn(publishScope as unknown as Record<string, unknown>) === value) {
        writeRef(publishScope, null);
      }
    });
  };

  return {
    restrict: 'A',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngRef', ngRefDirective)`. One
 * dependency, resolvable on `ngModule`: `$exceptionHandler` (spec 014),
 * used to route {@link NgRefBadExpressionError} when the `ng-ref`
 * expression is missing, empty, or non-assignable.
 */
export const ngRefDirective: DirectiveFactory = ['$exceptionHandler', ngRefFactory];
