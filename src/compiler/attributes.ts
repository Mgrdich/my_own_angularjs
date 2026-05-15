/**
 * `AttributesImpl` — runtime implementation of the {@link Attributes}
 * type passed into every directive `compile`, pre-link, and post-link
 * call on a single element (or `Comment` for an M-restricted match).
 *
 * Slice 2 shipped the read-side for `Element` nodes only: the
 * constructor walked `element.attributes`, normalized each name via
 * `directiveNormalize`, stored the value as an indexed property, and
 * recorded the original DOM-form name in `$attr`. Slice 7 widened the
 * constructor to also accept a `Comment` node — comments have no
 * attributes to walk, so the `$attr` map and indexed properties start
 * empty; the comment-matching pass in `directive-collector` populates
 * `attrs[normalizedName] = parsedValue` after construction.
 *
 * Slice 8 implements `$set(name, value, writeAttr?)`:
 * - Updates the in-memory indexed property (or deletes it on `null`).
 * - When `writeAttr` (default true) and the bound node IS an Element,
 *   syncs the DOM via `setAttribute` / `removeAttribute` using the
 *   original DOM-form name from `$attr` (or derives one via
 *   `camelToKebab` for attributes never seen on the source DOM).
 *   `Comment` nodes have no `setAttribute` — the DOM-write step is
 *   skipped for them (matches AngularJS — comment-restricted directives
 *   can still call `$set` to update `attrs[...]` and notify observers,
 *   but no DOM write happens because there's nothing to write to).
 * - Notifies observers in `$$observers.get(name)`. INSIDE a digest
 *   (`$$scope.$root.$$phase !== null`) the notifications are deferred
 *   via `scope.$evalAsync(...)` so they fire AFTER the current digest
 *   completes; OUTSIDE any digest (or when `bindToScope` was never
 *   called) observers are invoked synchronously. The value passed to
 *   each observer is the CURRENT `this[name]` (after the in-memory
 *   update), not the raw `value` argument — `$set(name, null)` notifies
 *   with `undefined`.
 *
 * `$observe` (Slice 9) will populate `$$observers`. Slice 8 ships the
 * notification path so the observer-list iteration is exercised even
 * when the list is empty; tests pre-populate it via a narrow cast.
 *
 * Implementation choices that matter:
 * - `$attr`, `$$element`, `$$observers`, `$$scope`, `$set`, `$observe`,
 *   and `bindToScope` are installed via `Object.defineProperty` with
 *   `enumerable: false`, so `for (const k in attrs)` and
 *   `Object.keys(attrs)` yield ONLY the indexed normalized attribute
 *   names — matching FS §2.11 acceptance criterion ("internally-managed
 *   entries marked non-enumerable so they don't appear"). `$set` and
 *   `bindToScope` live on the prototype (rather than as declared class
 *   members) so they don't conflict with the class's index signature
 *   constraint and they don't appear in own-property iteration.
 * - The `$attr` map records the ORIGINAL, un-normalized DOM
 *   spelling (`'data-my-dir'`) under the normalized key
 *   (`'myDir'`); `$set` consults it to write back to the DOM in the
 *   form the developer wrote.
 * - For `Comment` nodes the `$$element` reference IS the comment;
 *   directives that need to insert siblings call
 *   `comment.parentNode?.insertBefore(...)`. The compiler does NOT
 *   attempt to write attributes back onto a comment node.
 */

import type { Scope } from '@core/index';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import type { InterpolateFn, InterpolateService } from '@interpolate/interpolate-types';

import { camelToKebab } from './attribute-name-utils';
import type { Attributes, AttributesObserveFn, AttributesSetFn } from './directive-types';
import { directiveNormalize } from './directive-normalize';

type ObserverFn = (value: string | undefined) => void;
type BindToScopeFn = (scope: Scope, interpolate?: InterpolateService, exceptionHandler?: ExceptionHandler) => void;

/**
 * Internal narrow view onto an `AttributesImpl` instance — used by
 * `$set` / `bindToScope` / `$observe` to access the non-enumerable
 * `$$element`, `$$observers`, `$$scope`, `$$interpolate`, and
 * `$$interpolators` slots without resorting to a blanket `any` cast
 * and without polluting the public `Attributes` interface.
 *
 * `$$interpolators.get(name)` carries one of three states:
 * - `undefined` — no `$observe` call has classified this attribute yet.
 * - `null` — STATIC attribute (no `{{...}}` markers); cached so future
 *   `$observe` calls don't re-interpret. Each new observer still
 *   schedules a one-shot `$evalAsync` notification.
 * - `InterpolateFn` — DYNAMIC attribute; a single per-attribute
 *   `$watch` was installed (the `watchListener` calls
 *   `$set(name, value, false)`, which iterates `$$observers`).
 */
interface AttributesInternals {
  readonly $$element: Element | Comment;
  readonly $$observers: Map<string, ObserverFn[]>;
  $$scope: Scope | undefined;
  $$interpolate: InterpolateService | undefined;
  readonly $$interpolators: Map<string, InterpolateFn | null>;
  // Slice 11 (FS §2.16): the configured `$exceptionHandler` is stashed
  // here by `bindAttrsToScope` so observer-callback throws (in `$set`'s
  // sync notification path AND in the `$evalAsync`-deferred branch)
  // can route via `invokeExceptionHandler(handler, err, '$compile')`.
  // When `undefined` (e.g. an `AttributesImpl` constructed standalone
  // in a test), observer throws bubble up to the caller — matches the
  // pre-Slice-11 behavior so existing test fixtures keep passing.
  $$exceptionHandler: ExceptionHandler | undefined;
}

export class AttributesImpl implements Attributes {
  /** Indexed normalized → value map (declared via index signature). */
  [normalizedName: string]: string | undefined | Record<string, string> | AttributesSetFn | AttributesObserveFn;

  /**
   * Map from normalized attribute name → the original un-normalized
   * DOM spelling (e.g. `'data-my-dir'`). Non-enumerable so iteration
   * over the `Attributes` instance yields only the value entries.
   */
  readonly $attr!: Record<string, string>;

  // `$set`, `$observe`, and `bindToScope` are NOT declared as
  // TypeScript methods — they're installed on the prototype via
  // `Object.defineProperty` below so their runtime types (function
  // values) don't conflict with the class's index signature. The
  // `Attributes` interface in `directive-types.ts` declares the
  // public methods so consumers get the public type; these
  // declarations satisfy that interface contract through the
  // prototype chain.
  declare $set: AttributesSetFn;
  declare $observe: AttributesObserveFn;

  constructor(node: Element | Comment) {
    const attrMap: Record<string, string> = {};

    Object.defineProperty(this, '$attr', {
      value: attrMap,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    Object.defineProperty(this, '$$element', {
      value: node,
      enumerable: false,
      writable: false,
      configurable: true,
    });
    Object.defineProperty(this, '$$observers', {
      value: new Map<string, ObserverFn[]>(),
      enumerable: false,
      writable: false,
      configurable: true,
    });
    // Mutable scope reference — populated via `bindToScope(scope)`
    // from the per-element `nodeLinker` before any link function
    // runs. Until then `$set` cannot detect a digest and falls back
    // to synchronous observer notification.
    Object.defineProperty(this, '$$scope', {
      value: undefined,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    // Mutable interpolate-service reference — populated via
    // `bindToScope(scope, interpolate)` from the per-element
    // `nodeLinker`. When `undefined` (e.g. `$observe` called before
    // any link wiring, or in a unit test that constructs an
    // `AttributesImpl` standalone), `$observe` skips the
    // interpolation-classification step and the observer simply waits
    // for the next explicit `$set` to fire.
    Object.defineProperty(this, '$$interpolate', {
      value: undefined,
      enumerable: false,
      writable: true,
      configurable: true,
    });
    // Per-attribute classification cache for `$observe`. Sentinel
    // `null` marks a STATIC attribute; an `InterpolateFn` value marks
    // a DYNAMIC attribute that already has its watch installed.
    Object.defineProperty(this, '$$interpolators', {
      value: new Map<string, InterpolateFn | null>(),
      enumerable: false,
      writable: false,
      configurable: true,
    });
    // Slice 11 — mutable exception-handler slot. Populated by
    // `bindAttrsToScope(attrs, scope, interpolate, exceptionHandler)`.
    // When `undefined` (test fixtures that construct `AttributesImpl`
    // standalone, or any consumer that calls `bindToScope` without the
    // fourth argument), `$set`'s observer-notification path falls back
    // to letting throws bubble up to the caller — preserves the
    // pre-Slice-11 behavior so unit tests that hand-built attributes
    // continue to work without ceremonial wiring.
    Object.defineProperty(this, '$$exceptionHandler', {
      value: undefined,
      enumerable: false,
      writable: true,
      configurable: true,
    });

    // Comments have no `.attributes` to walk — the `Attributes`
    // instance starts empty and the comment-matching pass in
    // `directive-collector` populates `this[normalizedName]` after
    // construction.
    if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) {
      return;
    }
    const element = node as Element;

    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i);
      if (attr === null) {
        continue;
      }
      const normalized = directiveNormalize(attr.name);
      this[normalized] = attr.value;
      attrMap[normalized] = attr.name;
    }
  }
}

/**
 * Public-internal: bind an `AttributesImpl` to a `Scope` (and
 * optionally the `$interpolate` service AND optionally the
 * `$exceptionHandler`) so `$set` can detect a digest and defer
 * observer notifications, `$observe` can install lazy per-attribute
 * watches that resolve `{{...}}` markers, AND observer-callback
 * throws can route through the handler with cause `'$compile'` while
 * other observers continue to fire.
 *
 * The per-element `nodeLinker` calls this exactly once before
 * invoking pre-link / post-link functions. Calling again with a
 * different scope replaces the previous binding (the linker won't do
 * this in practice, but the contract is idempotent).
 *
 * Slice 9 extends the signature: when `interpolate` is omitted (e.g.
 * the Slice-8 call sites or a unit test that hand-constructs an
 * `AttributesImpl`), `$observe` skips the interpolation step and
 * observers only fire on subsequent explicit `$set` calls — the
 * lazy-watch wiring is conditional on `$$interpolate` being set.
 *
 * Slice 11 extends the signature again: when `exceptionHandler` is
 * omitted (the Slice-8 / Slice-9 call sites still in standalone unit
 * tests), observer throws bubble up to the caller. When supplied,
 * each observer call in `$set`'s notification path is wrapped in
 * `try/catch` and routed via `invokeExceptionHandler(handler, err,
 * '$compile')` — other observers for the same attribute still fire.
 */
function bindToScope(
  this: AttributesImpl,
  scope: Scope,
  interpolate?: InterpolateService,
  exceptionHandler?: ExceptionHandler,
): void {
  const internals = this as unknown as AttributesInternals;
  internals.$$scope = scope;
  if (interpolate !== undefined) {
    internals.$$interpolate = interpolate;
  }
  if (exceptionHandler !== undefined) {
    internals.$$exceptionHandler = exceptionHandler;
  }
}

/**
 * Update an attribute value, optionally sync the DOM, and notify
 * any observers registered via `$observe` (Slice 9).
 *
 * @param name        Normalized (camelCase) attribute name.
 * @param value       New value. `null` removes the attribute from
 *                    `attrs`, removes the DOM attribute (if `writeAttr`),
 *                    and notifies observers with `undefined`.
 * @param writeAttr   When `true` (default) and the bound node IS an
 *                    `Element`, syncs the DOM via `setAttribute` /
 *                    `removeAttribute` using the original DOM-form
 *                    name from `$attr` (or `camelToKebab(name)` if
 *                    the attribute was never on the source DOM).
 *                    `Comment` nodes have no attributes — the
 *                    DOM-write step is skipped silently.
 */
function $set(this: AttributesImpl, name: string, value: string | null, writeAttr: boolean = true) {
  // Step 1: update the indexed property.
  if (value === null) {
    // `delete` on a class instance with an index signature requires
    // the cast — `unknown` then re-narrowed keeps strict mode happy
    // without a blanket `any`.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- AngularJS-canonical: `$set(name, null)` must remove the indexed entry from `attrs` so subsequent reads return `undefined`, matching the `delete attrs[name]` step in AngularJS's reference $set. The `name` is a normalized attribute identifier under the directive's control, not arbitrary user input.
    delete (this as unknown as Record<string, unknown>)[name];
  } else {
    this[name] = value;
  }

  const internals = this as unknown as AttributesInternals;

  // Step 2: optionally sync the DOM. Comments have no `setAttribute`
  // / `removeAttribute` (and `nodeType === 8`) — skip the DOM write
  // step entirely for them. AngularJS-canonical: comment-restricted
  // directives can still call `$set` to update `attrs[...]` and
  // notify observers, but no DOM write happens because there's
  // nothing to write to.
  const element = internals.$$element;
  if (writeAttr && element.nodeType !== 8 /* Node.COMMENT_NODE */) {
    const targetElement = element as Element;
    if (value === null) {
      const domName = this.$attr[name] ?? camelToKebab(name);
      targetElement.removeAttribute(domName);
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- AngularJS-canonical: removing the `$attr[name]` mapping after `removeAttribute` keeps `$attr` consistent with the live DOM. `name` is the normalized identifier under the directive's control, not arbitrary user input.
      delete this.$attr[name];
    } else {
      let domName = this.$attr[name];
      if (domName === undefined) {
        // Attribute never on the source DOM — derive a kebab-case
        // DOM name and record it for future $set calls.
        domName = camelToKebab(name);
        this.$attr[name] = domName;
      }
      targetElement.setAttribute(domName, value);
    }
  }

  // Step 3: notify observers. Use the CURRENT `this[name]` (after
  // the Step-1 update) so a `$set(name, null)` notifies with
  // `undefined`. Inside a digest, defer through `$evalAsync` so the
  // notification lands AFTER the current digest cycle completes.
  //
  // Slice 11 (FS §2.16): each observer call is wrapped in `try/catch`
  // and routed through `invokeExceptionHandler(handler, err,
  // '$compile')` when an `$exceptionHandler` was bound (via
  // `bindAttrsToScope`). Other observers for the same attribute still
  // fire on the same notification pass. When no handler is bound
  // (standalone test fixtures, or `bindToScope` called without the
  // fourth argument), throws bubble up — preserves the pre-Slice-11
  // behavior so existing test fixtures keep passing without ceremonial
  // wiring.
  const observers = internals.$$observers.get(name);
  if (observers === undefined || observers.length === 0) {
    return;
  }
  const scope = internals.$$scope;
  const handler = internals.$$exceptionHandler;
  const currentValue = this[name] as string | undefined;
  if (scope !== undefined && scope.$root.$$phase !== null) {
    // One $evalAsync schedule, multiple notifications fired in
    // observer-registration order from within the deferred callback.
    scope.$evalAsync(() => {
      notifyObservers(observers, currentValue, handler);
    });
  } else {
    notifyObservers(observers, currentValue, handler);
  }
}

/**
 * Iterate `observers` and invoke each with `value`. Slice 11: when
 * `handler` is supplied, route each thrown error via
 * `invokeExceptionHandler(handler, err, '$compile')` so subsequent
 * observers in the list still fire. When `handler` is `undefined`
 * (standalone test fixtures), let the throw bubble — matches the
 * pre-Slice-11 behavior.
 */
function notifyObservers(
  observers: readonly ObserverFn[],
  value: string | undefined,
  handler: ExceptionHandler | undefined,
): void {
  for (const observer of observers) {
    if (handler === undefined) {
      observer(value);
      continue;
    }
    try {
      observer(value);
    } catch (err) {
      invokeExceptionHandler(handler, err, '$compile');
    }
  }
}

/**
 * Register an observer for changes to the normalized attribute `name`.
 *
 * Lazy interpolation watch wiring (Slice 9, FS §2.11):
 *
 * 1. Append `fn` to `$$observers.get(name)` (creating the entry on
 *    demand). The deregistration closure simply splices `fn` out of
 *    that array.
 * 2. Look up the per-attribute classification cache (`$$interpolators`):
 *    - **Cached `null`** — STATIC attribute; an observer was registered
 *      previously and the attribute has no `{{...}}` markers. Schedule
 *      `scope.$evalAsync(() => fn(this[name]))` so THIS observer also
 *      fires once with the current value on the next digest.
 *    - **Cached `InterpolateFn`** — DYNAMIC attribute with an existing
 *      `$watch` already installed. Do NOT schedule anything — the next
 *      digest's watch evaluation will call `$set(name, value, false)`
 *      which iterates `$$observers` (and `fn` is now in that array).
 *    - **Uncached** — first observer for this name. Call
 *      `interpolate(this[name] ?? '', true)` (truthy
 *      `mustHaveExpression`):
 *        - `undefined` result → STATIC. Cache `null` and schedule the
 *          one-shot `$evalAsync(() => fn(this[name]))` so the FIRST
 *          observer fires once after the next digest.
 *        - `InterpolateFn` result → DYNAMIC. Cache the function AND
 *          install exactly ONE per-attribute
 *          `scope.$watch(interpolateFn, listener)` whose listener
 *          calls `$set(name, newValue, false)` (the `writeAttr: false`
 *          is intentional — we don't want $observe's own watch to
 *          thrash the DOM; built-in attribute directives like
 *          `ng-href` will take that responsibility in a later spec).
 *          The first watch evaluation fires this observer (and any
 *          others registered before the first digest) via the standard
 *          `$set`-iterates-`$$observers` notification path.
 * 3. If `$$scope` or `$$interpolate` is `undefined` (no link wiring,
 *    or `$observe` called from a unit test that built `AttributesImpl`
 *    standalone), the interpolation-classification step is skipped
 *    entirely. The observer is still appended to `$$observers` and
 *    will fire when `$set` is later called explicitly. This matches
 *    the FS §2.11 contract — without a scope to install on, lazy
 *    watch wiring is genuinely impossible.
 *
 * @example
 * ```ts
 * const dereg = attrs.$observe('href', (value) => {
 *   element.setAttribute('href', value ?? '');
 * });
 * // Later, when the directive is torn down:
 * dereg();
 * ```
 */
function $observe(this: AttributesImpl, name: string, fn: ObserverFn) {
  const internals = this as unknown as AttributesInternals;

  // Step 1: append the observer to the per-name list.
  let observers = internals.$$observers.get(name);
  if (observers === undefined) {
    observers = [];
    internals.$$observers.set(name, observers);
  }
  observers.push(fn);

  // Step 2: classify the attribute (or reuse the cached classification).
  const scope = internals.$$scope;
  const interpolate = internals.$$interpolate;
  if (scope !== undefined && interpolate !== undefined) {
    const cached = internals.$$interpolators.get(name);
    if (cached === undefined) {
      // FIRST observer for this attribute — classify it now.
      const interpolateFn = interpolate((this[name] as string | undefined) ?? '', true);
      if (interpolateFn === undefined) {
        // STATIC attribute. Cache the sentinel; schedule THIS
        // observer to fire once with the current value on the next
        // digest (matches AngularJS — observer sees `this[name]` AT
        // EVAL TIME, not at register time, so a `$set` in the
        // intervening micro-window wins).
        internals.$$interpolators.set(name, null);
        scope.$evalAsync(() => {
          fn(this[name] as string | undefined);
        });
      } else {
        // DYNAMIC attribute. Cache the parsed fn; install ONE
        // `$watch` whose listener routes new values through
        // `$set(name, value, false)` so observer notification reuses
        // the existing iteration path and the DOM is not thrashed.
        internals.$$interpolators.set(name, interpolateFn);
        scope.$watch(interpolateFn, (newValue) => {
          this.$set(name, newValue ?? null, false);
        });
      }
    } else if (cached === null) {
      // STATIC, classification already done. Schedule THIS observer
      // to fire once on the next digest with the current value.
      // (Earlier observers were either fired already or have their
      // own pending $evalAsync.)
      scope.$evalAsync(() => {
        fn(this[name] as string | undefined);
      });
    }
    // cached is an InterpolateFn — DYNAMIC, watch already installed.
    // Do NOT schedule anything; the next digest's watch evaluation
    // calls $set which fires this observer via the $$observers
    // iteration.
  }

  // Step 3: deregistration closure.
  return () => {
    const arr = internals.$$observers.get(name);
    if (arr === undefined) {
      return;
    }
    const i = arr.indexOf(fn);
    if (i >= 0) {
      arr.splice(i, 1);
    }
  };
}

// Install `$set`, `bindToScope`, and `$observe` on the prototype as
// non-enumerable methods. Mounting them here (rather than as declared
// class fields) keeps `Object.keys(attrs)` clean AND avoids the
// index-signature conflict their function-typed values would otherwise
// trigger against the class's
// `string | undefined | Record<string, string>` signature.
Object.defineProperty(AttributesImpl.prototype, '$set', {
  value: $set,
  enumerable: false,
  writable: false,
  configurable: true,
});

Object.defineProperty(AttributesImpl.prototype, 'bindToScope', {
  value: bindToScope,
  enumerable: false,
  writable: false,
  configurable: true,
});

Object.defineProperty(AttributesImpl.prototype, '$observe', {
  value: $observe,
  enumerable: false,
  writable: false,
  configurable: true,
});

/**
 * Public-internal helper: bind an `AttributesImpl` to a `Scope` (and
 * optionally the `$interpolate` service) so `$set` can detect a digest
 * and `$observe` can install lazy per-attribute watches that resolve
 * `{{...}}` markers. This is a free function (rather than a method on
 * `AttributesImpl`) because adding a method whose value is a function
 * would conflict with the class's index signature; the
 * prototype-installed `bindToScope` slot is invoked here through a
 * narrow cast.
 *
 * Called by the per-element `nodeLinker` in `compile.ts` exactly once
 * per element before any link function runs. Slice 9 chose the
 * "extend `bindAttrsToScope` to also stash `$interpolate`" path
 * (Option A in the spec text) over the parallel `boundAttrs` view
 * (Option B): one fewer object per element, no proxy indirection on
 * the read path, and the public `Attributes` surface stays a single
 * type. The trade-off — `$$interpolate` lives on `AttributesImpl`
 * mutable-slot — is local to this module.
 *
 * Passing `interpolate === undefined` (the Slice-8 call site, or any
 * unit test that hand-builds an `AttributesImpl`) keeps `$$interpolate`
 * unset; `$observe` then degrades gracefully — it appends to
 * `$$observers` but skips the lazy watch wiring entirely.
 */
export function bindAttrsToScope(
  attrs: AttributesImpl,
  scope: Scope,
  interpolate?: InterpolateService,
  exceptionHandler?: ExceptionHandler,
): void {
  (attrs as unknown as { bindToScope: BindToScopeFn }).bindToScope(scope, interpolate, exceptionHandler);
}
