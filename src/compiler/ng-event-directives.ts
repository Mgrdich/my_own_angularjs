/**
 * Native event-binding directives — `ngClick`, `ngDblclick`,
 * `ngMousedown`, `ngMouseup`, `ngMouseover`, `ngMouseout`,
 * `ngMousemove`, `ngMouseenter`, `ngMouseleave`, `ngKeydown`,
 * `ngKeyup`, `ngKeypress`, `ngCopy`, `ngCut`, `ngPaste`, `ngFocus`,
 * `ngBlur`, and `ngSubmit` (spec 026 Slice 1 / FS §2.1–§2.5,
 * technical-considerations §2.1).
 *
 * Eighteen directives, ONE mechanical pattern, ONE source file.
 * Mirrors AngularJS-1.x's `ngEventDirectives` block: a single internal
 * factory helper parameterized by event name + 18 generated directive
 * factories that get registered on `ngModule`.
 *
 * **The shared pattern.** At link time the directive parses the bound
 * scope expression ONCE via `parse(attrs[ngAttrName])` and registers a
 * native event listener through `element.addEventListener(eventName, handler)`.
 * When the event fires the handler builds a runner `() => parsed(scope, { $event })`
 * and dispatches:
 *
 * - `scope.$evalAsync(run)` when `scope.$$phase` is set (a digest is
 *   already in flight — this is the nested-event case, e.g. one
 *   `ng-click` triggering another synchronously). Queueing through
 *   `$evalAsync` avoids the canonical `'$digest already in progress'`
 *   throw and lets the inner expression's effect become observable
 *   after the outer digest's drain.
 * - `scope.$apply(run)` when no phase is active (the common case —
 *   the user clicked a button, the framework was idle between
 *   digests). `$apply` runs `run` then triggers a root-level
 *   `$digest()` so any scope mutation propagates.
 *
 * The native event object is exposed inside the bound expression as
 * `$event`. The parser's runtime resolves identifiers from `locals`
 * first (spec 009), so `$event` shadows any same-named scope property
 * for the duration of the single invocation — and is not assigned to
 * the scope.
 *
 * **Exception routing.** The handler wraps the `run()` call in a
 * dedicated `try/catch` and routes throws through `$exceptionHandler`
 * with cause `'eventListener'` (the existing 6th token of the
 * `EXCEPTION_HANDLER_CAUSES` tuple, originally introduced for scope
 * `$emit` / `$broadcast` listeners — its semantics extend naturally
 * to native DOM event listeners). This is load-bearing because the
 * project's `scope.$apply` is `try/finally`-only (no internal
 * `try/catch`), so a throw inside `$apply(run)` would otherwise
 * propagate out of `dispatchEvent` rather than land on the framework's
 * exception handler. The wrapper preserves the "log and continue"
 * contract: a buggy handler reports through the configured
 * `$exceptionHandler` and subsequent events still fire correctly.
 * `EXCEPTION_HANDLER_CAUSES.length` stays at 10 — no new token.
 *
 * **Cleanup.** Each link fn registers a `scope.$on('$destroy', …)`
 * listener that removes the native event listener when the scope
 * tears down. Without this hook, an element still in the DOM after
 * its scope was destroyed would continue firing handlers against a
 * dead scope — a leak and a correctness bug. The same hook covers
 * both the explicit `scope.$destroy()` path and the
 * `destroyElementScope(element)` propagation path (structural
 * directives — `ng-if`, `ng-repeat` — will lean on this in future
 * specs).
 *
 * **The `EventName` type-safety mechanism.** `EVENT_NAMES` is declared
 * as `as const satisfies readonly (keyof HTMLElementEventMap)[]`. The
 * `as const` narrows the tuple to a readonly list of string literals;
 * the `satisfies` constraint enforces that every entry is a real DOM
 * event name. A typo (`'clikc'`) becomes a compile error before the
 * test suite runs. The derived `(typeof EVENT_NAMES)[number]` union
 * is the parameter type of `createEventDirective` — the 18 call sites
 * at the bottom of this file pass type-checked string literals.
 *
 * **Module visibility.** `EVENT_NAMES`, `EventName`, and
 * `createEventDirective` are MODULE-PRIVATE — not exported from this
 * file. The 18 generated factories are exported here but NOT
 * re-exported from `@compiler/index`. They are reachable only through
 * DI on `ngModule`, matching the spec 018 / 023 / 024 / 025
 * precedent.
 *
 * **Parse-once-at-compile-time.** Each (element × directive) pair
 * parses its expression exactly once at compile time. The link fn
 * closes over the parsed function, so subsequent linker invocations
 * against the same compiled subtree reuse the parsed callable. The
 * per-event-fire cost is just the closure invocation + the
 * `$apply` / `$evalAsync` dispatch — no re-parsing.
 *
 * **`restrict: 'A'` is canonical.** Every directive in this file
 * matches only as an attribute (`<button ng-click="save()">`). The
 * element form (`<ng-click>`) and the class form
 * (`<button class="ng-click: save()">`) are intentionally not
 * supported, mirroring AngularJS.
 *
 * **`ng-submit` does NOT auto-`preventDefault()`.** A `<form ng-submit="…">`
 * with an `action` attribute still navigates the page on submit
 * unless the bound expression calls `$event.preventDefault()`. This
 * is the AngularJS-canonical behavior and is explicitly carved
 * out-of-scope by the functional spec (FS §3).
 */

import { parse } from '@parser/index';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

/**
 * The eighteen DOM event names this file's directives target.
 *
 * The `as const` makes the array a readonly tuple of string literals;
 * the `satisfies readonly (keyof HTMLElementEventMap)[]` constraint
 * enforces that every entry is a real DOM event name. The combination
 * is the COMPILE-TIME TYPO GUARD — a future maintainer who tries to
 * add `'clikc'` to the list gets a `Type '"clikc"' is not assignable
 * to type 'keyof HTMLElementEventMap'.` error.
 *
 * The tuple is NOT used at runtime: each of the 18
 * `createEventDirective('…')` call sites passes a type-checked
 * literal so the IDE's go-to-definition stays useful and the
 * registration in `src/core/ng-module.ts` is explicit.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- EVENT_NAMES is the SOURCE OF TRUTH for the `EventName` type derivation below (`(typeof EVENT_NAMES)[number]`). It is deliberately consumed only at type level — the spec explicitly says "NOT used at runtime" so the 18 `createEventDirective('…')` call sites stay explicit and the IDE's go-to-definition stays useful. Removing it would force `EventName` to be hand-typed, losing the compile-time typo guard.
const EVENT_NAMES = [
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'mouseover',
  'mouseout',
  'mousemove',
  'mouseenter',
  'mouseleave',
  'keydown',
  'keyup',
  'keypress',
  'copy',
  'cut',
  'paste',
  'focus',
  'blur',
  'submit',
] as const satisfies readonly (keyof HTMLElementEventMap)[];

/**
 * The 18-member string-literal union derived from {@link EVENT_NAMES}.
 *
 * Used as the parameter type of {@link createEventDirective} so the 18
 * call sites at the bottom of this file pass only type-checked event
 * names. A future spec that adds a new directive extends
 * `EVENT_NAMES`; the union narrows automatically.
 */
type EventName = (typeof EVENT_NAMES)[number];

/**
 * `'click'` → `'Click'`. Inline-only helper for building the
 * normalized `ng`-prefixed attribute name from an event name.
 */
function capitalize(name: EventName): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Build the array-form directive factory implementing the
 * native-event-binding pattern for a given event name.
 *
 * The returned factory injects `$exceptionHandler` so the per-event
 * `try/catch` around the parsed expression's invocation can route via
 * `invokeExceptionHandler(..., 'eventListener')`. The cause token is
 * the existing 6th entry of `EXCEPTION_HANDLER_CAUSES` — no new token
 * is introduced (the tuple stays at 10).
 *
 * The compile fn parses the bound expression ONCE; the link fn
 * registers `element.addEventListener(eventName, handler)` and a
 * `scope.$on('$destroy', …)` cleanup. The handler dispatches through
 * `scope.$evalAsync(run)` when `scope.$$phase` is set, otherwise
 * `scope.$apply(run)`.
 *
 * The `typeof attrs[ngAttrName] !== 'string'` early-return matches
 * the spec 023 / 024 / 025 defensive pattern: if the directive
 * somehow matched against an element that didn't carry the
 * `ng`-prefixed attribute, bail cleanly without parsing `undefined`.
 *
 * @internal Module-private — consumed by the 18 exported factories in
 *           this file. Not exported from `@compiler/index` or the
 *           root barrel.
 */
function createEventDirective(eventName: EventName): DirectiveFactory {
  const ngAttrName = `ng${capitalize(eventName)}`;

  function eventDirectiveFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
    return {
      restrict: 'A',
      compile: (_element, attrs) => {
        const exprString = attrs[ngAttrName];
        if (typeof exprString !== 'string') {
          // Defensive — the directive shouldn't have matched without
          // the `ng`-prefixed attribute, but bail cleanly rather than
          // pushing `undefined` through `parse`.
          return;
        }
        const parsed = parse(exprString);
        const link: LinkFn = (scope, element) => {
          const handler = (event: Event) => {
            const run = () => {
              parsed(scope, { $event: event });
            };
            try {
              if (scope.$$phase !== null) {
                // Nested-event path — a digest is already in flight
                // (e.g. one ng-click fired this synchronously during
                // another ng-click's $apply). Queue through
                // $evalAsync; the digest's standard '$evalAsync'
                // catch path covers any throw from the drained
                // expression.
                scope.$evalAsync(run);
              } else {
                // Common path — no phase active. $apply runs `run`
                // synchronously and then triggers $root.$digest() so
                // any scope mutation propagates. The framework's
                // $apply has no internal try/catch, so a throw from
                // `run` would otherwise propagate out of
                // dispatchEvent — the outer try/catch routes it
                // through $exceptionHandler instead.
                scope.$apply(run);
              }
            } catch (err) {
              invokeExceptionHandler($exceptionHandler, err, 'eventListener');
            }
          };
          element.addEventListener(eventName, handler);
          scope.$on('$destroy', () => {
            element.removeEventListener(eventName, handler);
          });
        };
        return link;
      },
    };
  }

  return ['$exceptionHandler', eventDirectiveFactory];
}

/**
 * `ng-click` — fires the bound expression when the element is clicked.
 *
 * Registers a `click` listener on the element. The handler evaluates
 * the bound expression inside `scope.$apply()` (or `scope.$evalAsync()`
 * when a digest is already in flight) so scope mutations propagate.
 * The native event is exposed as `$event` inside the expression.
 *
 * `restrict: 'A'`.
 *
 * @example
 * ```html
 * <button ng-click="save(item, $event)">Save</button>
 * ```
 */
export const ngClickDirective = createEventDirective('click');

/**
 * `ng-dblclick` — fires the bound expression when the element is
 * double-clicked.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <li ng-dblclick="edit(item)">{{ item.label }}</li>
 * ```
 */
export const ngDblclickDirective = createEventDirective('dblclick');

/**
 * `ng-mousedown` — fires the bound expression when a mouse button is
 * pressed on the element.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <div ng-mousedown="startDrag($event)">Drag me</div>
 * ```
 */
export const ngMousedownDirective = createEventDirective('mousedown');

/**
 * `ng-mouseup` — fires the bound expression when a mouse button is
 * released on the element.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <div ng-mouseup="endDrag($event)">Release me</div>
 * ```
 */
export const ngMouseupDirective = createEventDirective('mouseup');

/**
 * `ng-mouseover` — fires the bound expression when the mouse pointer
 * moves over the element. Bubbles from child elements.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <div ng-mouseover="showTooltip()">Hover me</div>
 * ```
 */
export const ngMouseoverDirective = createEventDirective('mouseover');

/**
 * `ng-mouseout` — fires the bound expression when the mouse pointer
 * leaves the element. Bubbles from child elements.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <div ng-mouseout="hideTooltip()">Hover me</div>
 * ```
 */
export const ngMouseoutDirective = createEventDirective('mouseout');

/**
 * `ng-mousemove` — fires the bound expression every time the mouse
 * pointer moves within the element. High-frequency event — wrap the
 * handler in a debouncer if scope mutations are expensive.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <canvas ng-mousemove="track($event.clientX, $event.clientY)"></canvas>
 * ```
 */
export const ngMousemoveDirective = createEventDirective('mousemove');

/**
 * `ng-mouseenter` — fires the bound expression when the mouse enters
 * the element. Does NOT bubble from descendants — unlike
 * `ng-mouseover`, this directive fires only when the pointer crosses
 * the element's own bounding box.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <div ng-mouseenter="focus($event)">Focus me</div>
 * ```
 */
export const ngMouseenterDirective = createEventDirective('mouseenter');

/**
 * `ng-mouseleave` — fires the bound expression when the mouse leaves
 * the element. Does NOT bubble from descendants — unlike
 * `ng-mouseout`, this directive fires only when the pointer leaves the
 * element's own bounding box.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <div ng-mouseleave="blur($event)">Defocus</div>
 * ```
 */
export const ngMouseleaveDirective = createEventDirective('mouseleave');

/**
 * `ng-keydown` — fires the bound expression when a key is pressed
 * while the element has focus.
 *
 * `restrict: 'A'`. Native event is exposed as `$event` — read
 * `$event.key`, `$event.code`, or `$event.ctrlKey` inside the
 * expression.
 *
 * @example
 * ```html
 * <input ng-keydown="onKeyDown($event)">
 * ```
 */
export const ngKeydownDirective = createEventDirective('keydown');

/**
 * `ng-keyup` — fires the bound expression when a key is released
 * while the element has focus.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <input ng-keyup="search($event.target.value)">
 * ```
 */
export const ngKeyupDirective = createEventDirective('keyup');

/**
 * `ng-keypress` — fires the bound expression when a printable key is
 * typed while the element has focus.
 *
 * Note: the underlying `keypress` event is deprecated browser-side
 * (modern code should prefer `keydown` / `beforeinput`), but
 * AngularJS still ships the directive for parity with legacy
 * applications.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <input ng-keypress="filterPrintable($event)">
 * ```
 */
export const ngKeypressDirective = createEventDirective('keypress');

/**
 * `ng-copy` — fires the bound expression when the clipboard `copy`
 * event is dispatched on the element.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <input ng-copy="logCopy($event)">
 * ```
 */
export const ngCopyDirective = createEventDirective('copy');

/**
 * `ng-cut` — fires the bound expression when the clipboard `cut`
 * event is dispatched on the element.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <input ng-cut="logCut($event)">
 * ```
 */
export const ngCutDirective = createEventDirective('cut');

/**
 * `ng-paste` — fires the bound expression when the clipboard `paste`
 * event is dispatched on the element.
 *
 * `restrict: 'A'`. Native event is exposed as `$event` — read
 * `$event.clipboardData` inside the expression to inspect the
 * pasted payload.
 *
 * @example
 * ```html
 * <input ng-paste="onPaste($event)">
 * ```
 */
export const ngPasteDirective = createEventDirective('paste');

/**
 * `ng-focus` — fires the bound expression when the element gains
 * focus.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <input ng-focus="focused = true">
 * ```
 */
export const ngFocusDirective = createEventDirective('focus');

/**
 * `ng-blur` — fires the bound expression when the element loses
 * focus.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <input ng-blur="touched = true">
 * ```
 */
export const ngBlurDirective = createEventDirective('blur');

/**
 * `ng-submit` — fires the bound expression when a `<form>` element is
 * submitted.
 *
 * **No auto-`preventDefault()`.** The directive does NOT call
 * `event.preventDefault()` for you. A `<form ng-submit="…" action="…">`
 * with an action URL will still navigate the page on submit unless the
 * bound expression calls `$event.preventDefault()`. The canonical
 * AngularJS pattern is to omit the `action` attribute entirely on
 * forms that don't navigate.
 *
 * `restrict: 'A'`. Native event is exposed as `$event`.
 *
 * @example
 * ```html
 * <form ng-submit="save(formData); $event.preventDefault()">
 *   <input type="text" ng-model="formData.name">
 *   <button type="submit">Save</button>
 * </form>
 * ```
 *
 * @example Omit `action` so the browser has nothing to navigate to.
 * ```html
 * <form ng-submit="save(formData)">
 *   <input type="text" ng-model="formData.name">
 *   <button type="submit">Save</button>
 * </form>
 * ```
 */
export const ngSubmitDirective = createEventDirective('submit');
