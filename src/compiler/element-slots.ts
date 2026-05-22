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
export const NG_CLEANUP_QUEUE = '$$ngCleanupQueue' as const;
export const NG_CONTROLLERS = '$$ngControllers' as const;
export const NG_BOUND_TRANSCLUDE = '$$ngBoundTransclude' as const;

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
  [NG_CLEANUP_QUEUE]?: (() => void)[];
  [NG_CONTROLLERS]?: Map<string, unknown>;
  [NG_BOUND_TRANSCLUDE]?: BoundTranscludeFn;
}

/**
 * Type-predicate guard: `true` when `el` has a non-`undefined`
 * {@link NG_BOUND_TRANSCLUDE} slot — i.e. the element is the host of a
 * transcluding directive that captured children at compile time. Inside
 * the truthy branch TypeScript narrows `el` so `el[NG_BOUND_TRANSCLUDE]`
 * is `BoundTranscludeFn` (no `| undefined`) and no inline cast is
 * needed.
 *
 * ```ts
 * if (hasBoundTransclude(cursor)) {
 *   const bound = cursor[NG_BOUND_TRANSCLUDE]; // BoundTranscludeFn
 * }
 * ```
 */
export function hasBoundTransclude(el: Element): el is NgManagedElement & { [NG_BOUND_TRANSCLUDE]: BoundTranscludeFn } {
  return Reflect.get(el, NG_BOUND_TRANSCLUDE) !== undefined;
}
