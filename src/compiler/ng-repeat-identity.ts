/**
 * `createIdentityTracker` — default identity tracker for `ng-repeat` rows
 * (spec 028 Slice 2 / technical-considerations §2.2).
 *
 * `ng-repeat` reconciles its DOM rows across digests by matching items
 * by a stable identity string. When the directive's author supplies a
 * `track by EXPR` clause, that expression is the identity source; in
 * the (much more common) absence of `track by`, this module is the
 * fallback. The contract is intentionally narrow:
 *
 * ```ts
 * const tracker = createIdentityTracker();
 * tracker.getIdentity(item) // → 'object:1' | 'object:2' | 'string:foo' | …
 * ```
 *
 * A fresh tracker is created per `ng-repeat` directive instance (one
 * per link invocation). Identities are stable for the lifetime of that
 * tracker — the same object passed twice yields the same string —
 * but two distinct trackers share NO state, so an item identified
 * `'object:1'` by tracker A is not necessarily `'object:1'` under
 * tracker B.
 *
 * **Closure-state model.** Two pieces of state live in the closure
 * returned by the factory:
 *
 *   1. A `WeakMap<object, string>` that maps each previously-seen
 *      object reference to its synthesized identity. `WeakMap` is the
 *      load-bearing choice — when the user drops the object reference,
 *      the entry is reclaimable by the GC, so a long-lived tracker
 *      sitting on a constantly-mutating collection does not grow
 *      indefinitely.
 *   2. A monotonically-increasing `nextId: number` counter. Each new
 *      object encountered consumes the next integer and the result is
 *      stored in the WeakMap. Because the counter only ever increments,
 *      distinct objects ALWAYS receive distinct identities — collisions
 *      are impossible by construction.
 *
 * **Primitive-vs-object dispatch.** `getIdentity` first triages on
 * `value === null` and `value === undefined` (each owns a dedicated
 * sentinel). Object-like values per the `@core` `isObjectLike` guard
 * (arrays, plain objects, class instances, functions, dates, maps,
 * sets, etc. all qualify) take
 * the WeakMap branch. All other primitives produce a type-prefixed
 * sentinel string built from `typeof` + `String(value)` with three
 * deliberate normalizations:
 *
 *   - `NaN` collapses to `'number:NaN'`. `String(NaN)` already yields
 *     `'NaN'`, so this falls out naturally — documented for clarity.
 *   - `+0` and `-0` collapse to `'number:0'`. JavaScript's `String(-0)`
 *     yields `'0'`, so both sign-variants of zero land on the same
 *     sentinel and reuse the same row across digests — the desired
 *     behavior for `ng-repeat`'s identity contract.
 *   - `Symbol` values pass through `String(sym)` so the result reads
 *     like `'symbol:Symbol(x)'`. A bare `value as unknown as string`
 *     coercion would throw `TypeError: Cannot convert a Symbol value to
 *     a string` — `String()` is the safe conversion path.
 *
 * **AngularJS divergence — `WeakMap` over `$$hashKey`.** AngularJS
 * 1.x injects a non-enumerable `$$hashKey: string` property onto every
 * object the iterator encounters; we deliberately don't. The WeakMap
 * approach has three advantages worth the divergence:
 *
 *   1. **User data stays clean.** A consumer iterating the same object
 *      with both `ng-repeat` and an external library (a serializer, a
 *      structural-clone routine, a fetch body builder) does not see a
 *      mystery `$$hashKey` property leak into output. The author's
 *      object is byte-identical before and after `ng-repeat` consumes
 *      it.
 *   2. **`Object.freeze`d items work transparently.** A frozen object
 *      cannot accept new properties; AngularJS's `$$hashKey` injection
 *      throws on first encounter. The WeakMap stores the key/value
 *      pair externally — frozen items are first-class citizens here.
 *   3. **GC-friendly.** When the user drops their reference to an
 *      object (collection re-fetched from the server, item removed from
 *      a list), the WeakMap entry is reclaimable. AngularJS's
 *      injected `$$hashKey` is fine in practice because the user's
 *      reference is what holds the object alive anyway, but the
 *      WeakMap formulation makes the lifecycle explicit.
 *
 * **Reference identity, not structural identity.** The same object
 * mutated in place (`todos[0].title = 'new'`) keeps its identity
 * because the WeakMap key is the object reference itself. This matches
 * the AngularJS contract — `ng-repeat` identity tracking is by
 * reference, not by value. Authors who want structural identity supply
 * a `track by` expression (e.g. `track by todo.id`).
 *
 * @example Object items get monotonically-increasing identities
 * ```ts
 * const tracker = createIdentityTracker();
 * const a = { id: 1 };
 * const b = { id: 2 };
 * tracker.getIdentity(a); // → 'object:1'
 * tracker.getIdentity(b); // → 'object:2'
 * tracker.getIdentity(a); // → 'object:1' (stable across calls)
 * ```
 *
 * @example Primitives map to type-prefixed sentinels
 * ```ts
 * const tracker = createIdentityTracker();
 * tracker.getIdentity('hello');     // → 'string:hello'
 * tracker.getIdentity(42);          // → 'number:42'
 * tracker.getIdentity(NaN);         // → 'number:NaN'
 * tracker.getIdentity(-0);          // → 'number:0' (collapses with +0)
 * tracker.getIdentity(true);        // → 'boolean:true'
 * tracker.getIdentity(null);        // → 'null:'
 * tracker.getIdentity(undefined);   // → 'undefined:'
 * tracker.getIdentity(10n);         // → 'bigint:10'
 * tracker.getIdentity(Symbol('x')); // → 'symbol:Symbol(x)'
 * ```
 */

import { isObjectLike } from '@core/index';

/**
 * Closure interface returned by {@link createIdentityTracker}. The
 * single method derives a stable identity string for any value — see
 * the module-level TSDoc for the dispatch rules.
 */
export interface IdentityTracker {
  /**
   * Resolve the identity string for `value`. The same object reference
   * always returns the same identity; distinct object references always
   * return distinct identities. Primitives map to type-prefixed
   * sentinels (see file-level TSDoc for the full set).
   */
  getIdentity(value: unknown): string;
}

/**
 * Build a fresh identity tracker with private closure state — a
 * `WeakMap<object, string>` for object items and a monotonic counter
 * driving new identity assignments. A new tracker is created per
 * `ng-repeat` directive instance; the two share no state.
 */
export function createIdentityTracker(): IdentityTracker {
  const objectIdentities = new WeakMap<object, string>();
  let nextId = 0;

  function getIdentity(value: unknown) {
    // `null` and `undefined` get their dedicated sentinels before the
    // shape dispatch. `isObjectLike` itself rejects `null` (it wraps
    // the `value !== null && typeof === 'object'` check), so neither
    // can leak into the WeakMap path (which throws on a `null` key).
    if (value === null) {
      return 'null:';
    }
    if (value === undefined) {
      return 'undefined:';
    }

    if (isObjectLike(value)) {
      // Object-like branch — covers plain objects, arrays, class
      // instances, functions, dates, maps, sets, and any other
      // reference type. The guard's `Record<string, unknown>`
      // narrowing is a valid WeakMap-key shape — no cast needed.
      const existing = objectIdentities.get(value);
      if (existing !== undefined) {
        return existing;
      }
      nextId += 1;
      const identity = `object:${String(nextId)}`;
      objectIdentities.set(value, identity);
      return identity;
    }

    const valueType = typeof value;

    // Primitive branch — `string`, `number`, `boolean`, `bigint`,
    // `symbol`. Each gets a `<typeof>:<String(value)>` sentinel. The
    // `String(value)` conversion is the safe path for `Symbol` values
    // (a bare string concatenation would throw `TypeError: Cannot
    // convert a Symbol value to a string`) and produces the
    // documented normalizations for `NaN` and signed zeros for free
    // (`String(NaN) === 'NaN'`, `String(-0) === '0'`). The cast to
    // the primitive-only union below is what makes the narrowing
    // visible to `@typescript-eslint/no-base-to-string` — at runtime
    // `null` / `undefined` / `object` / `function` have all been
    // routed away by the earlier branches, so `value` here is
    // guaranteed to be a primitive whose `String()` produces a
    // meaningful sentinel (never `'[object Object]'`).
    const primitive = value as string | number | boolean | bigint | symbol;
    return `${valueType}:${String(primitive)}`;
  }

  return { getIdentity };
}
