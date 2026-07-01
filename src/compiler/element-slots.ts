/**
 * Framework-internal slot names stashed on DOM `Element` instances by
 * the compiler. Centralized so that the property name lives in ONE
 * place and the interface field is type-tied to the constant via a
 * computed property name — a rename touches every reader/writer at
 * once, with TypeScript flagging any drift as a compile error.
 *
 * **The drift risk that motivates this module.** Each slot is referenced
 * across multiple files: a `defineProperty` write site, an interface
 * field declaring the type, and one or more read sites. Before this
 * module the literal `'$$ngControllers'` appeared in three files; a
 * rename in one would silently break the other two with no compile
 * failure and no test failure (unless a specific regression test
 * happened to exercise the broken path). The `as const` constants
 * below + the `NgManagedElement` interface using `[NG_*]?:` computed
 * property names tie all sites together at the type level.
 *
 * **Why all four slots in one interface.** Every slot is optional
 * (created lazily via `Object.defineProperty` and cleared on teardown),
 * so it costs nothing to declare them together. Readers cast to
 * `NgManagedElement` and pick whichever fields they need — the same
 * pattern used by the original file-local interfaces in
 * `cleanup.ts` / `compile.ts` / `require-resolver.ts` / `ng-transclude.ts`.
 *
 * Slot semantics live in the files that own each lifecycle:
 *   - `$$ngScope` / `$$ngCleanupQueue` — `cleanup.ts` (spec 017 Slice 10).
 *   - `$$ngControllers` — `compile.ts:stashController` write, `require-
 *     resolver.ts:readController` read (spec 022 Slice 3 / Slice 4).
 *   - `$$ngBoundTransclude` — `compile.ts` install, `ng-transclude.ts`
 *     parent-element walk (spec 018).
 */

import type { Scope } from '@core/index';

import type { BoundTranscludeFn } from './transclude-types';

export const NG_SCOPE = '$$ngScope' as const;
/**
 * Records the SURROUNDING (pre-isolate) scope on an element that bears
 * an ISOLATE scope. The compiler stamps this slot when it creates an
 * isolate scope via `parentScope.$new(true)`; the value is the
 * `parentScope` the linker held BEFORE the isolate scope existed — i.e.
 * the scope a true outer DOM sibling shares.
 *
 * Non-isolate directives that publish into the scope (currently only
 * `ngRef`) read this slot so their published reference lands on the
 * surrounding scope rather than on the isolate scope the element's own
 * link fn receives — AngularJS parity for `linkFn.isolateScope ?
 * isolateScope : scope`. On a non-isolate element the slot is absent
 * and such directives fall back to the linked scope unchanged.
 */
export const NG_ISOLATE_HOST_SCOPE = '$$ngIsolateHostScope' as const;
export const NG_CLEANUP_QUEUE = '$$ngCleanupQueue' as const;
export const NG_CONTROLLERS = '$$ngControllers' as const;
export const NG_BOUND_TRANSCLUDE = '$$ngBoundTransclude' as const;
/**
 * Marker stashed on a host Element after spec 027 Slice 2's
 * `kind: 'element'` capture detaches it. When the master fragment is
 * re-compiled inside `makeInternalLinker([host])`, the second
 * `compileElementOrComment` invocation reads this slot and SKIPS the
 * transclude pre-pass for the marked directive — otherwise an
 * `transclude: 'element'` directive would re-fire transclude capture
 * recursively on the master clone and never terminate. The value is
 * the matched directive's name so two SIBLING `transclude: 'element'`
 * directives at the same priority (a future spec scenario) can still
 * fire independently.
 */
export const NG_ELEMENT_TRANSCLUDED = '$$ngElementTranscluded' as const;

/**
 * Element augmented with every framework-internal slot the compiler may
 * stash. All slots are optional; readers pick whichever they need. The
 * computed property names tie each field's identifier to the
 * corresponding `NG_*` constant — a rename of the constant
 * automatically renames the interface field, and any reader using the
 * field via direct property access (`element.$$ngScope`) becomes a
 * compile error until it is updated.
 */
export interface NgManagedElement extends Element {
  [NG_SCOPE]?: Scope;
  [NG_ISOLATE_HOST_SCOPE]?: Scope;
  [NG_CLEANUP_QUEUE]?: (() => void)[];
  [NG_CONTROLLERS]?: Map<string, unknown>;
  [NG_BOUND_TRANSCLUDE]?: BoundTranscludeFn;
  [NG_ELEMENT_TRANSCLUDED]?: string;
}

/**
 * Comment placeholder augmented with the subset of framework-internal
 * slots that may appear on a `transclude: 'element'` placeholder
 * (spec 027 Slice 2). Today only `$$ngCleanupQueue` and
 * `$$ngBoundTransclude` are valid; `$$ngScope` and `$$ngControllers`
 * are Element-only because no scope-having or controller-bearing
 * directive ever hosts itself on a Comment node.
 */
export interface NgManagedComment extends Comment {
  [NG_CLEANUP_QUEUE]?: (() => void)[];
  [NG_BOUND_TRANSCLUDE]?: BoundTranscludeFn;
}

/**
 * Type-predicate guard: `true` when `el` carries any framework-managed
 * stash slot (i.e. the compiler has touched the element). Inside the
 * truthy branch TypeScript narrows `el` to {@link NgManagedElement} so
 * the optional slot fields can be read without an inline cast.
 *
 * Implementation uses the `in` operator — no `as` cast in the body —
 * so the guard is a real runtime check, not a type-system fiction. A
 * slot is created via `Object.defineProperty`, so once any slot has
 * been set on an element the corresponding key sticks around (cleanup
 * sets the value to `undefined` but does not `delete` the descriptor),
 * meaning a previously-managed element keeps reporting `true` even
 * after teardown — callers that care about live values must do their
 * own per-slot `!== undefined` check inside the truthy branch.
 *
 * ```ts
 * if (isNgManagedElement(cursor)) {
 *   const bound = cursor[NG_BOUND_TRANSCLUDE];
 *   if (bound !== undefined) {
 *     // …
 *   }
 * }
 * ```
 */
export function isNgManagedElement(el: Element): el is NgManagedElement {
  return (
    NG_SCOPE in el ||
    NG_ISOLATE_HOST_SCOPE in el ||
    NG_CLEANUP_QUEUE in el ||
    NG_CONTROLLERS in el ||
    NG_BOUND_TRANSCLUDE in el ||
    NG_ELEMENT_TRANSCLUDED in el
  );
}

/**
 * Variant of {@link isNgManagedElement} that accepts a Comment node —
 * spec 027 Slice 2's `transclude: 'element'` placeholder. Same
 * `in`-operator runtime semantics; narrows to {@link NgManagedComment}.
 */
export function isNgManagedComment(el: Comment): el is NgManagedComment {
  return NG_CLEANUP_QUEUE in el || NG_BOUND_TRANSCLUDE in el;
}

/**
 * Stash a controller instance under `name` in the element's
 * `$$ngControllers` map, creating the (non-enumerable) map lazily on
 * first use — the same write the compiler's per-element controller seam
 * performs, exposed so a directive can publish a controller under an
 * ADDITIONAL key beyond its own directive name.
 *
 * The motivating case (spec 039 Slice 2) is `form` / `ngForm`: both
 * directives share one `FormController`, and `ngModel` / nested forms
 * resolve the enclosing form via `require: '?^^form'`. The controller
 * seam stashes each directive's controller under its own directive name
 * (`form` for `<form>`, `ngForm` for `<ng-form>`), so the `ngForm`
 * variant additionally stashes itself under `'form'` here to make the
 * single `'form'` require key resolve for BOTH element shapes.
 */
export function stashController(element: Element, name: string, instance: unknown): void {
  let map: Map<string, unknown> | undefined;
  if (isNgManagedElement(element)) {
    map = element[NG_CONTROLLERS];
  }
  if (map === undefined) {
    map = new Map<string, unknown>();
    Object.defineProperty(element, NG_CONTROLLERS, {
      value: map,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  map.set(name, instance);
}
