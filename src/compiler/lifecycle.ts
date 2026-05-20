/**
 * Controller lifecycle hook helpers (spec 022 Slice 3 —
 * FS §2.3 + technical-considerations §2.3).
 *
 * A directive's controller may opt into four lifecycle hooks:
 *
 * - **`$onInit()`** — once, after the controller is constructed and its
 *   `bindToController` bindings have been populated, BEFORE pre-link.
 * - **`$onChanges(changes)`** — once initially at link time (with every
 *   `<` / `@` binding marked first-change) and then again per digest in
 *   which a `<` / `@` binding's value changed. `changes` maps each
 *   changed local name to a {@link SimpleChange} carrying the current
 *   value, the previous value, and a `isFirstChange()` method.
 * - **`$onDestroy()`** — when the controller's scope receives
 *   `$destroy`. Registered via `scope.$on('$destroy', …)` so the hook
 *   fires from both `scope.$destroy()` and `destroyElementScope(host)`.
 * - **`$postLink()`** — after the element AND all its child elements
 *   have completed linking (i.e. after the post-link loop).
 *
 * Every hook is an opt-in `typeof ctrl.$onX === 'function'` check — a
 * controller defining none of them behaves exactly as in spec 020 / 022
 * Slice 2. Failures inside a hook route via
 * `invokeExceptionHandler(handler, err, '$compile')`; the `'$compile'`
 * cause token is reused (no new `EXCEPTION_HANDLER_CAUSES` entry — the
 * tuple stays at 10).
 *
 * The `$onChanges` queue is a small per-`$compile`-call (effectively
 * per-runtime) structure keyed by controller instance. The COMPILER
 * (not this file) is responsible for scheduling a one-shot
 * `$$postDigest` task that drains the queue — this file owns the queue
 * shape, the recording helper, and the flush iteration.
 *
 * @see ExceptionHandler
 */

import type { ExceptionHandler } from '@exception-handler/exception-handler-types';
import { invokeExceptionHandler } from '@exception-handler/index';

/**
 * The four lifecycle hook names. A typed union so the
 * {@link hasHook} guard returns the right discriminant.
 *
 * @example
 * ```ts
 * const hooks: LifecycleHookName[] = ['$onInit', '$onChanges', '$onDestroy', '$postLink'];
 * for (const name of hooks) {
 *   if (hasHook(ctrl, name)) invokeHook(ctrl, name, handler);
 * }
 * ```
 */
export type LifecycleHookName = '$onInit' | '$onChanges' | '$onDestroy' | '$postLink';

/**
 * Type guard — narrows `ctrl` to an object carrying `hookName` as a
 * callable. The check is intentionally structural (`typeof === 'function'`)
 * so consumers can attach hooks dynamically inside the controller body
 * (the canonical AngularJS pattern: `this.$onInit = () => { … }`).
 *
 * @example
 * ```ts
 * if (hasHook(ctrl, '$onInit')) {
 *   invokeHook(ctrl, '$onInit', $exceptionHandler);
 * }
 * ```
 */
export function hasHook(ctrl: unknown, hookName: LifecycleHookName): boolean {
  if (typeof ctrl !== 'object' || ctrl === null) {
    return false;
  }
  const candidate = (ctrl as Record<string, unknown>)[hookName];
  return typeof candidate === 'function';
}

/**
 * Invoke `hookName` on `ctrl` with `ctrl` as `this`. Catches any throw
 * and routes via `invokeExceptionHandler(handler, err, '$compile')`. The
 * cause token is fixed — this helper is only ever called from compiler
 * code, never from app code. Returns void.
 *
 * Callers should pre-check via {@link hasHook} when they want to avoid
 * a no-op call; this function tolerates a missing hook silently so the
 * common "fire if present" pattern stays terse.
 *
 * @param ctrl The controller instance.
 * @param hookName One of `$onInit` / `$onChanges` / `$onDestroy` / `$postLink`.
 * @param handler The configured `$exceptionHandler`.
 * @param args Hook arguments (only `$onChanges` carries one).
 *
 * @example
 * ```ts
 * // $onInit — no args.
 * invokeHook(ctrl, '$onInit', $exceptionHandler);
 *
 * // $onChanges — pass the change record set.
 * invokeHook(ctrl, '$onChanges', $exceptionHandler, batch);
 * ```
 */
export function invokeHook(
  ctrl: unknown,
  hookName: LifecycleHookName,
  handler: ExceptionHandler,
  ...args: unknown[]
): void {
  if (!hasHook(ctrl, hookName)) {
    return;
  }
  const fn = (ctrl as Record<string, (...a: unknown[]) => unknown>)[hookName];
  if (typeof fn !== 'function') {
    // Defensive — `hasHook` already verified callability. The
    // narrowing keeps strict mode + `noUncheckedIndexedAccess` happy
    // without an inline disable comment.
    return;
  }
  try {
    fn.apply(ctrl, args);
  } catch (err) {
    invokeExceptionHandler(handler, err, '$compile');
  }
}

/**
 * Sentinel `previousValue` for the initial synchronous `$onChanges`
 * fire (AngularJS-canonical: a unique opaque object that the runtime
 * uses as the marker for "no prior value yet"). `isFirstChange()`
 * returns `true` for the initial fire so consumers should never read
 * `previousValue` — the sentinel exists to keep the value-shape
 * homogeneous.
 *
 * Frozen so consumers cannot accidentally mutate the shared sentinel.
 *
 * @example
 * ```ts
 * controller.$onChanges = (changes) => {
 *   const u = changes.user;
 *   if (u.isFirstChange()) {
 *     // u.previousValue === UNINITIALIZED_VALUE
 *     console.log('initial', u.currentValue);
 *   } else {
 *     console.log('changed from', u.previousValue, 'to', u.currentValue);
 *   }
 * };
 * ```
 */
export const UNINITIALIZED_VALUE: Readonly<Record<string, never>> = Object.freeze(
  Object.create(null) as Record<string, never>,
);

/**
 * Per-binding change record passed to `$onChanges(changes)`. The
 * `isFirstChange()` method (not a property!) reflects whether this is
 * the initial fire for the binding; AngularJS chose the method shape
 * for forward compatibility, so we mirror it.
 *
 * @example
 * ```ts
 * controller.$onChanges = (changes) => {
 *   const userChange = changes.user;
 *   if (userChange !== undefined) {
 *     if (userChange.isFirstChange()) {
 *       console.log('Initial user:', userChange.currentValue);
 *     } else {
 *       console.log('User changed from', userChange.previousValue, 'to', userChange.currentValue);
 *     }
 *   }
 * };
 * ```
 */
export class SimpleChange {
  readonly name = 'SimpleChange' as const;
  constructor(
    public currentValue: unknown,
    public previousValue: unknown,
    public isFirst: boolean,
  ) {}

  isFirstChange(): boolean {
    return this.isFirst;
  }
}

/**
 * The shape of a single controller's pending changes batch — keyed by
 * local binding name, valued by {@link SimpleChange}.
 *
 * @example
 * ```ts
 * controller.$onChanges = (changes: ChangeRecord) => {
 *   for (const localName of Object.keys(changes)) {
 *     const c = changes[localName];
 *     // c is a SimpleChange
 *   }
 * };
 * ```
 */
export type ChangeRecord = Record<string, SimpleChange>;

/**
 * Per-`$compile`-call (effectively per-`runControllerSeam` invocation)
 * queue of pending `$onChanges` deliveries. Keyed by controller
 * instance so multiple bindings changing in the same digest accumulate
 * into one record before flushing.
 *
 * The queue does NOT own scheduling — the COMPILER is responsible for
 * triggering a flush via `scope.$$postDigest(...)` when the queue
 * transitions from empty to non-empty. See `compile.ts` for the
 * scheduling site.
 *
 * @example
 * ```ts
 * const queue = new ChangesQueue();
 * const wasEmpty = queue.record(ctrl, 'user', next, prev, false);
 * if (wasEmpty) {
 *   scope.$$postDigest(() => flushChangesQueue(queue, $exceptionHandler));
 * }
 * ```
 */
export class ChangesQueue {
  private pending = new Map<object, ChangeRecord>();
  /** `true` between scheduling and draining; reset to `false` after drain. */
  flushed = false;

  /**
   * Record (or accumulate into the existing batch for) a single
   * binding change for `ctrl`. Returns `true` if the queue transitioned
   * from empty to non-empty as a result of this record — the compiler
   * uses that signal to schedule its one-shot `$$postDigest` drain.
   */
  record(ctrl: object, localName: string, currentValue: unknown, previousValue: unknown, isFirst: boolean): boolean {
    const wasEmpty = this.pending.size === 0;
    let record = this.pending.get(ctrl);
    if (record === undefined) {
      record = {};
      this.pending.set(ctrl, record);
    }
    const existing = record[localName];
    if (existing !== undefined) {
      // Coalesce — keep the original `previousValue` from this digest's
      // first record, advance `currentValue` to the latest. Matches
      // AngularJS semantics: a value going `a → b → c` between
      // recordings in the same digest yields `{ previousValue: a, currentValue: c }`.
      existing.currentValue = currentValue;
    } else {
      record[localName] = new SimpleChange(currentValue, previousValue, isFirst);
    }
    return wasEmpty;
  }

  /**
   * Pop and return the pending batch for `ctrl`, or `null` if there is
   * none. Removes the entry from the queue.
   */
  take(ctrl: object): ChangeRecord | null {
    const record = this.pending.get(ctrl);
    if (record === undefined) {
      return null;
    }
    this.pending.delete(ctrl);
    return record;
  }

  /**
   * Drop any pending changes for `ctrl` — used by `$onDestroy` so a
   * deferred flush does NOT fire after a controller has been destroyed.
   */
  clearForController(ctrl: object): void {
    this.pending.delete(ctrl);
  }

  /** Iterate every (controller, batch) pair currently in the queue. */
  *entries(): IterableIterator<[object, ChangeRecord]> {
    for (const entry of this.pending) {
      yield entry;
    }
  }

  /** Number of controllers with pending changes. */
  get size(): number {
    return this.pending.size;
  }
}

/**
 * Drain `queue` — for every (controller, batch) pair, fire the
 * controller's `$onChanges(batch)` via {@link invokeHook}, then clear
 * the entry. Robust to a controller's `$onChanges` triggering a
 * `clearForController` (e.g. by destroying its scope mid-flush): the
 * iteration captures keys up front so concurrent removal does not
 * confuse the loop.
 *
 * The flush is one-shot — the compiler schedules ONE `$$postDigest`
 * task per scope, and that task calls this function exactly once. If
 * additional changes record during flush (e.g. a `$onChanges` writes
 * back to a `<` binding), they accumulate into a fresh batch and the
 * compiler's next digest cycle will schedule another flush.
 *
 * @example
 * ```ts
 * scope.$$postDigest(() => flushChangesQueue(queue, $exceptionHandler));
 * ```
 */
export function flushChangesQueue(queue: ChangesQueue, handler: ExceptionHandler): void {
  // Snapshot keys so a hook that mutates the queue (e.g. by destroying
  // its scope) does not confuse the iteration.
  const controllers: object[] = [];
  for (const [ctrl] of queue.entries()) {
    controllers.push(ctrl);
  }
  for (const ctrl of controllers) {
    const batch = queue.take(ctrl);
    if (batch === null) {
      // Removed mid-flush by an earlier hook — skip.
      continue;
    }
    invokeHook(ctrl, '$onChanges', handler, batch);
  }
}
