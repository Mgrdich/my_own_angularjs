/**
 * Element-scoped bootstrap marker (spec 036 Slice 4 / technical-considerations §2.6).
 *
 * The DOM `bootstrap` entry point stamps a single non-enumerable property —
 * `$$ngBootstrapped` — on the host element the very first time it starts an
 * application there. A second `bootstrap(...)` call against the same element
 * reads the marker and throws `AlreadyBootstrappedError` (parity with
 * AngularJS's `ng:btstrpd`), guarding against the double-bootstrap programmer
 * error.
 *
 * The mechanism mirrors the compiler's element-slot pattern (see
 * `src/compiler/cleanup.ts` and `src/compiler/element-slots.ts`): a single
 * `as const` slot-name constant tied to a computed-property interface field,
 * written via `Object.defineProperty` with `enumerable: false` so it stays out
 * of `for..in` traversals and dev-tools enumeration. The property is
 * `configurable: true` + `writable: true` to keep the writer forgiving (a
 * re-stamp overwrites rather than throwing on the descriptor), and the
 * `in`-operator guard is a real runtime check — no `as` cast in the body.
 *
 * `$injector` attachment (the opt-in `attachToElement` config) lives here too
 * so both element-stash concerns share one typed slot interface, keeping the
 * `bootstrap` function free of inline element casts.
 */

import type { Injector } from '@di/di-types';

/**
 * Non-enumerable slot recording that an application has been bootstrapped on an
 * element. Presence (not value) is the signal the double-bootstrap guard reads.
 */
export const NG_BOOTSTRAPPED = '$$ngBootstrapped' as const;

/**
 * Non-enumerable slot holding the `$injector` of the application bootstrapped on
 * an element. Only stamped when the caller opts in via `config.attachToElement`
 * — the double-bootstrap guard never reads it (it reads {@link NG_BOOTSTRAPPED}
 * instead), so attachment stays a pure convenience for DOM-side tooling.
 */
export const NG_INJECTOR = '$$ngInjector' as const;

/**
 * Element augmented with the bootstrap-managed slots. Both are optional —
 * created lazily via `Object.defineProperty` — and tied to their `NG_*`
 * constants via computed property names so a rename of either constant
 * propagates to every reader as a compile error.
 */
interface BootstrappedElement extends Element {
  [NG_BOOTSTRAPPED]?: true;
  // Stored at the widest injector shape — `attachInjector` is generic over the
  // concrete (narrow) registry, so a precisely-typed injector is accepted on
  // write and surfaced at the wide shape on read.
  [NG_INJECTOR]?: Injector;
}

/**
 * Stamp the {@link NG_BOOTSTRAPPED} marker on an element. Idempotent — a repeat
 * call overwrites the prior `true` value (the guard runs BEFORE this in the
 * `bootstrap` flow, so a re-stamp only happens after the guard has already
 * decided the element is clean).
 */
export function markBootstrapped(element: Element): void {
  Object.defineProperty(element, NG_BOOTSTRAPPED, {
    value: true,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Type-predicate guard: `true` when `element` already carries the
 * {@link NG_BOOTSTRAPPED} marker. Uses the `in` operator (no cast) so it's a
 * genuine runtime check; inside the truthy branch the element narrows to
 * {@link BootstrappedElement}.
 */
export function isBootstrapped(element: Element): element is BootstrappedElement {
  return NG_BOOTSTRAPPED in element;
}

/**
 * Attach an `$injector` reference to an element as a non-enumerable slot — the
 * opt-in `config.attachToElement` behavior. Mirrors AngularJS's element-data
 * `$injector` attachment so DOM-side tooling can discover the running
 * application from its host node.
 */
export function attachInjector<Registry extends Record<string, unknown>>(
  element: Element,
  injector: Injector<Registry>,
): void {
  Object.defineProperty(element, NG_INJECTOR, {
    value: injector,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Read the `$injector` previously attached via {@link attachInjector}. Returns
 * `undefined` when `config.attachToElement` was not set (the default). Exposed
 * primarily for tests asserting the attach / no-attach contract.
 */
export function getAttachedInjector(element: Element): Injector | undefined {
  if (!(NG_INJECTOR in element)) {
    return undefined;
  }
  return (element as BootstrappedElement)[NG_INJECTOR];
}
