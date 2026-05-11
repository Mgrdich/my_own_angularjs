/**
 * Element-scoped cleanup registry (spec 017 Slice 10 / technical-considerations §2.8).
 *
 * The compiler attaches a child {@link Scope} to an element when any
 * matched directive declares `scope: true`. That scope must be
 * `$destroy()`-ed when the element is removed from the DOM, otherwise
 * its watchers stay attached to the parent scope tree forever.
 * Likewise, structural directives (future `ng-if`, `ng-repeat`, …) may
 * register additional cleanup callbacks (DOM event listeners,
 * `setTimeout` cancellations, etc.) that need to fire in the same
 * teardown.
 *
 * The mechanism is a pair of non-enumerable, configurable properties
 * stashed directly on the DOM `Element`:
 *
 * - `$$ngScope` — the child scope created for this element (if any).
 * - `$$ngCleanupQueue` — additional cleanup callbacks registered by
 *   directives or by the compiler.
 *
 * Both keys use the AngularJS-canonical `$$` prefix so they're
 * unambiguously framework-internal, and `Object.defineProperty` with
 * `enumerable: false` keeps them out of `for..in` traversals and
 * normal dev-tools enumeration. The properties are `configurable:
 * true` and `writable: true` so {@link destroyElementScope} can clear
 * them after teardown — making a second call a no-op (idempotent).
 *
 * The compiler does NOT call {@link destroyElementScope} itself in
 * spec 017 — it only wires the registry. Built-in structural
 * directives that ship in later specs (`ng-if`, `ng-repeat`, etc.)
 * are responsible for calling `destroyElementScope(node)` BEFORE
 * removing nodes from the DOM.
 */

import type { Scope } from '@core/index';

/**
 * Element augmented with the framework-internal cleanup slots.
 *
 * The cast through this interface is the controlled choke point for
 * `$$ngScope` / `$$ngCleanupQueue` access — a single narrowly-typed
 * site rather than `(element as any)` everywhere. The properties are
 * declared optional because they're set lazily via
 * `Object.defineProperty` and cleared on teardown.
 */
interface NgManagedElement extends Element {
  $$ngScope?: Scope;
  $$ngCleanupQueue?: (() => void)[];
}

const NG_SCOPE = '$$ngScope';
const NG_CLEANUP_QUEUE = '$$ngCleanupQueue';

/**
 * Stash the child {@link Scope} created for this element on the
 * element itself so {@link destroyElementScope} can retrieve and
 * destroy it later.
 *
 * Idempotent — repeated calls overwrite the prior reference. The
 * compiler currently calls this exactly once per `scope: true`
 * element, but the overwrite-on-set semantics keep the API forgiving
 * for future structural-directive use cases.
 *
 * @example
 * ```ts
 * const childScope = parentScope.$new();
 * setElementScope(element, childScope);
 * ```
 */
export function setElementScope(element: Element, scope: Scope): void {
  Object.defineProperty(element, NG_SCOPE, {
    value: scope,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Read the child {@link Scope} previously stashed on the element via
 * {@link setElementScope}. Returns `undefined` if no scope was ever
 * stashed (the common case for `scope: false` elements).
 */
export function getElementScope(element: Element): Scope | undefined {
  return (element as NgManagedElement).$$ngScope;
}

/**
 * Append a cleanup callback to the element's cleanup queue. The
 * queue is created lazily on the first call. Cleanup callbacks fire
 * in INSERTION order during {@link destroyElementScope}, BEFORE the
 * element's child scope (if any) is `$destroy()`-ed.
 *
 * @example
 * ```ts
 * const handler = () => doStuff();
 * element.addEventListener('click', handler);
 * addElementCleanup(element, () => element.removeEventListener('click', handler));
 * ```
 */
export function addElementCleanup(element: Element, fn: () => void): void {
  const managed = element as NgManagedElement;
  if (managed.$$ngCleanupQueue === undefined) {
    Object.defineProperty(element, NG_CLEANUP_QUEUE, {
      value: [] as (() => void)[],
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  // Non-null after the lazy-init branch above.
  (managed.$$ngCleanupQueue as (() => void)[]).push(fn);
}

/**
 * Tear down an element subtree's framework-managed state.
 *
 * Recurses depth-first through descendants:
 *   1. For each descendant Element, recursively call this function
 *      first (depth-first — children before parent).
 *   2. After descendants are processed, run each entry in
 *      `$$ngCleanupQueue` in INSERTION order. Errors from individual
 *      entries are collected and the FIRST one is re-thrown after the
 *      whole queue completes — so a single throwing cleanup does not
 *      abort the rest of the queue.
 *   3. Then if `$$ngScope` is set, call its `$destroy()`.
 *   4. Clear both private properties so a second call is a no-op
 *      (idempotent).
 *
 * Built-in structural directives (`ng-if`, `ng-repeat`, …) call this
 * BEFORE removing nodes from the DOM so the released scopes don't
 * leak into the parent's watcher tree.
 *
 * @example
 * ```ts
 * const linker = $compile(template);
 * linker(scope);
 * // …time passes…
 * destroyElementScope(template);
 * template.remove();
 * ```
 */
export function destroyElementScope(element: Element): void {
  // Depth-first: recurse into Element children before tearing down
  // this node. We enumerate `children` (HTMLCollection — Elements
  // only) because cleanup queues / child scopes are only attached to
  // Elements, never to Text or Comment children.
  const childCount = element.children.length;
  for (let i = 0; i < childCount; i++) {
    const child = element.children.item(i);
    if (child !== null) {
      destroyElementScope(child);
    }
  }

  const managed = element as NgManagedElement;

  // Run cleanup queue entries in INSERTION order. Per-entry errors
  // are collected; after the queue completes, if any errors occurred
  // we re-throw the FIRST one. This guarantees every entry got its
  // chance to run even if an early one threw.
  const queue = managed.$$ngCleanupQueue;
  let firstError: unknown;
  let hasError = false;
  if (queue !== undefined) {
    for (const fn of queue) {
      try {
        fn();
      } catch (e: unknown) {
        if (!hasError) {
          firstError = e;
          hasError = true;
        }
      }
    }
  }

  // Destroy the child scope (if one was stashed) AFTER the cleanup
  // queue. The order matters: cleanup callbacks may want to call
  // `scope.$emit(...)` or `scope.$broadcast(...)` for last-chance
  // notifications, and that's only meaningful before `$destroy`
  // tears down the listener tree.
  const scope = managed.$$ngScope;
  if (scope !== undefined) {
    scope.$destroy();
  }

  // Clear both private slots so a second call is a no-op. Reusing
  // `Object.defineProperty` (rather than `delete`) preserves the
  // non-enumerable + configurable descriptor flags so a future
  // `setElementScope` / `addElementCleanup` on the same element
  // still works cleanly.
  if (managed.$$ngCleanupQueue !== undefined) {
    Object.defineProperty(element, NG_CLEANUP_QUEUE, {
      value: undefined,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  if (managed.$$ngScope !== undefined) {
    Object.defineProperty(element, NG_SCOPE, {
      value: undefined,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  if (hasError) {
    throw firstError;
  }
}
