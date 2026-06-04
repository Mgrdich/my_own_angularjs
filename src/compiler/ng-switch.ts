/**
 * `ngSwitch` + `ngSwitchWhen` + `ngSwitchDefault` — value-driven subtree
 * selection (spec 027 Slice 5 / FS §2.2, technical-considerations §2.3).
 *
 * `<div ng-switch="expr"><div ng-switch-when="A">…</div><div ng-switch-default>…</div></div>`
 * renders AT MOST ONE matching child block based on the stringified
 * value of the parent's `ng-switch` expression. Every transition tears
 * down the previously-rendered child (including its scope and DOM) and
 * mounts a fresh deep clone of the newly-matching child (with a fresh
 * transclusion scope). Multiple `ng-switch-when` blocks sharing the same
 * value render TOGETHER when that value matches — AngularJS-canonical
 * behavior, uncommon but supported.
 *
 * **Architecture: parent-controller + child-registration.** Mirrors the
 * AngularJS-canonical implementation exactly:
 *
 *  1. `ngSwitchDirective` (the parent) declares a `controller`
 *     (`NgSwitchController`) and `require: 'ngSwitch'` (self-require).
 *     The controller exposes mutable state — a `cases` map keyed by
 *     stringified expression value, and three parallel arrays tracking
 *     currently-mounted transcludes / scopes / DOM clones.
 *  2. Each `ngSwitchWhenDirective` / `ngSwitchDefaultDirective` (the
 *     children) declares `transclude: 'element'` (so its content is
 *     captured into a master fragment at compile time and replaced
 *     in-place by a Comment placeholder per spec 027 Slice 2) AND
 *     `require: '^ngSwitch'` (so it can find the parent controller via
 *     the spec-022 Slice-4 ancestor walk through `parentElement`).
 *  3. At link time, each child registers its `{ placeholder, transclude }`
 *     pair into the parent's `cases` map under its `attrs.ngSwitchWhen`
 *     key (or `'?'` for default).
 *  4. The parent's link fn installs a `scope.$watch(attrs.ngSwitch, …)`
 *     listener that orchestrates ALL transitions — tearing down the
 *     active set, looking up the new set, and mounting fresh clones.
 *     Children install no clones themselves.
 *
 * **Why children register with the parent (vs. each child watching
 * independently).** A single orchestrator is mandatory for the
 * "exactly-one block at a time" guarantee — if each child watched the
 * expression and toggled its own clone, two `ng-switch-when="A"` blocks
 * could observe the expression flipping to `"A"` in different orders
 * relative to a sibling's teardown, and a transient "no block mounted"
 * frame could appear between Drop + Add. Centralizing the transition in
 * the parent eliminates that race entirely.
 *
 * **Insertion anchor: each child's own placeholder.** When a child
 * registers its transclude with the parent, it ALSO captures the
 * Comment placeholder Slice 2 installed in place of its host element.
 * The parent's clone-attach callback then uses that placeholder as the
 * insertion anchor — `placeholder.parentNode.insertBefore(clone, placeholder.nextSibling)`.
 * The placeholder itself never moves; it permanently occupies the slot
 * the child's original host element used to occupy. As a result the
 * rendered subtree's position relative to its sibling children is
 * preserved across transitions, AND multiple `ng-switch-when` siblings
 * sharing the same value mount in document order (each next to its own
 * placeholder).
 *
 * **The `'?'` key for default.** AngularJS canonically stores the
 * default-block transcludes under the literal string `'?'` (a value no
 * valid `ng-switch-when` attribute can produce because `?` is not a
 * legal scope-expression-value stringification). The parent's listener
 * looks up `cases.get(String(value))` first; on a miss it falls back to
 * `cases.get('?')`; on a miss there too, the slot stays empty.
 *
 * **String-equality semantics.** `String(value)` is used for the match
 * key — `null` / `undefined` / `0` / `false` all stringify deterministically
 * (`'null'`, `'undefined'`, `'0'`, `'false'`). Numeric switch-when
 * values written as attribute strings (`ng-switch-when="0"`) therefore
 * match the stringified scope value, NOT loose-equality coercion. This
 * mirrors AngularJS 1.x and is the FS §2.2 acceptance criterion.
 *
 * **Cleanup contract on transitions.** The parent's `$watch` listener
 * tears the previously-active set down via the canonical order:
 *   1. `scope.$destroy()` on each transclusion scope (fires
 *      `$on('$destroy', …)` listeners, tears the scope sub-tree down).
 *   2. `clone.remove()` to detach from the live DOM.
 *   3. Zero out the parallel `selectedTranscludes` / `selectedScopes` /
 *      `selectedClones` arrays.
 * The order matches spec 027 Slice 3's `ng-if` teardown (`cloneScope.$destroy()`
 * BEFORE `clone.remove()` so any `$destroy` listeners that read DOM
 * state can still do so).
 *
 * **Inert outside an enclosing `ng-switch`.** A `<div ng-switch-when="A">`
 * with no parent `ng-switch` triggers `MissingRequiredControllerError`
 * via the spec-022 Slice-4 `require: '^ngSwitch'` resolver, routed by
 * the per-element controller seam through `$exceptionHandler('$compile')`.
 * No new error class is needed; the FS §2.2 acceptance criterion
 * "helpers without parent throw" is satisfied by the existing
 * spec-022 mechanism.
 *
 * **Errors.** No new error classes. No new `EXCEPTION_HANDLER_CAUSES`
 * token. The tuple stays at 10. Every error site reuses existing
 * surfaces: `MissingRequiredControllerError` (children without parent),
 * `'watchListener'` (a throwing `$watch` listener inside the parent),
 * `'$compile'` (throws inside `$transclude` invocations).
 *
 * @example
 * ```html
 * <div ng-switch="user.role">
 *   <div ng-switch-when="admin">Admin panel</div>
 *   <div ng-switch-when="member">Member dashboard</div>
 *   <div ng-switch-default>Public view</div>
 * </div>
 * <!-- After compile:
 *      <div ng-switch="user.role">
 *        <!-- ngSwitchWhen: admin -->
 *        <!-- ngSwitchWhen: member -->
 *        <!-- ngSwitchDefault:  -->
 *      </div>
 *      With user.role = 'admin' the parent's $watch fires and mounts a
 *      fresh deep clone of the admin <div> after its placeholder.
 *      Flipping user.role to 'member' destroys the admin clone's scope,
 *      removes the admin clone from the DOM, and mounts a fresh member
 *      clone after the member placeholder. -->
 * ```
 *
 * @example Multiple when-blocks sharing a value
 * ```html
 * <div ng-switch="kind">
 *   <div ng-switch-when="alert">Top banner</div>
 *   <p>(static markup in between)</p>
 *   <div ng-switch-when="alert">Bottom banner</div>
 * </div>
 * <!-- With kind = 'alert' BOTH alert blocks render simultaneously,
 *      each next to its own placeholder. AngularJS-canonical multi-
 *      match behavior. -->
 * ```
 */

import type { Scope } from '@core/index';

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';
import { isComment, isElement } from './node-guards';
import type { TranscludeFn } from './transclude-types';

/**
 * Normalized directive name. Exported so `src/core/ng-module.ts` can
 * register `'ngSwitch'` against `$compileProvider` via the same constant
 * the children's `require: '^ngSwitch'` string refers to symbolically.
 * The constant value MUST stay in sync with the `require` literal on
 * each child directive's DDO below — a rename of one without the other
 * would silently break the parent-child wiring.
 */
export const NG_SWITCH_NAME = 'ngSwitch';

/**
 * Normalized directive name for the `ng-switch-when` child. Exported so
 * the registration site in `src/core/ng-module.ts` can refer to the
 * literal in one place.
 */
export const NG_SWITCH_WHEN_NAME = 'ngSwitchWhen';

/**
 * Normalized directive name for the `ng-switch-default` child. Exported
 * for the same reason as the two above.
 */
export const NG_SWITCH_DEFAULT_NAME = 'ngSwitchDefault';

/**
 * The literal key under which `ngSwitchDefault`'s transcludes are
 * registered in the parent's `cases` map. AngularJS-canonical — `?` is
 * not a legal stringification of any scope-expression value, so it
 * cannot collide with any `ng-switch-when` attribute value.
 */
const DEFAULT_KEY = '?';

/**
 * One child-side registration: the transclude callable that mounts a
 * fresh deep clone of the child's host element AND the Comment
 * placeholder Slice 2 installed in that host's slot. The placeholder is
 * the insertion anchor — `placeholder.parentNode.insertBefore(clone, placeholder.nextSibling)`
 * keeps the mounted clone next to its own placeholder, preserving
 * document order across multiple `ng-switch-when` siblings sharing the
 * same value.
 */
interface CaseEntry {
  readonly transclude: TranscludeFn;
  readonly placeholder: Comment;
}

/**
 * Shape carried by the `NgSwitchController` instance. Exposed only to
 * the parent's link fn (via the self-require resolution) and to the
 * children's link fns (via the `require: '^ngSwitch'` ancestor walk).
 * The fields are deliberately mutable — the parent's `$watch` listener
 * splices the parallel `selected*` arrays on every transition, and the
 * children's link fns push into `cases` at link time. NOT a public API
 * surface; module-private.
 */
interface NgSwitchControllerShape {
  cases: Map<string, CaseEntry[]>;
  selectedTranscludes: TranscludeFn[];
  selectedScopes: Scope[];
  selectedClones: Element[];
}

/**
 * Shared parent controller — owns the orchestration state for ONE
 * `<div ng-switch>` instance. Each parent element gets a fresh
 * controller (via `runControllerSeam`'s per-element instantiation).
 *
 * Declared as a plain constructor function (not an ES class) so the
 * trailing-of-array DI annotation shape (`[NgSwitchController]`) does
 * NOT require a `new`-vs-call branch in `$controller`'s `instantiate`
 * helper — `Object.create(NgSwitchController.prototype)` + `invoke` is
 * how the spec-020 `$controller` instantiates every controller, and
 * arrow / ES-class forms would throw when invoked without `new`. The
 * factory wraps in the canonical `[fn]` array form so `annotate` does
 * not reject it.
 *
 * The function takes zero injected dependencies — the parent's link fn
 * sets up the watcher and reads the state through the resolved
 * controller, so the controller only needs to expose mutable slots.
 */
function NgSwitchController(this: NgSwitchControllerShape) {
  this.cases = new Map();
  this.selectedTranscludes = [];
  this.selectedScopes = [];
  this.selectedClones = [];
}

/**
 * Tear down the currently-mounted set. Used on every transition by the
 * parent's `$watch` listener AND once at scope destruction (when the
 * outer scope's `$destroy` propagates through the controller's owning
 * scope). The destruction order — `scope.$destroy()` BEFORE
 * `clone.remove()` — mirrors spec 027 Slice 3's `ng-if` teardown so
 * `$destroy` listeners that read DOM state still observe the live tree.
 *
 * Splices the three parallel arrays in lock-step so a panic mid-loop
 * (a `$destroy` listener throwing) does not leave the state half-cleared
 * — the next transition's setup re-fills them.
 */
function clearSelected(ctrl: NgSwitchControllerShape): void {
  for (let i = 0; i < ctrl.selectedScopes.length; i++) {
    const s = ctrl.selectedScopes[i];
    if (s !== undefined) {
      s.$destroy();
    }
  }
  for (let i = 0; i < ctrl.selectedClones.length; i++) {
    const c = ctrl.selectedClones[i];
    if (c !== undefined) {
      c.remove();
    }
  }
  ctrl.selectedTranscludes = [];
  ctrl.selectedScopes = [];
  ctrl.selectedClones = [];
}

function ngSwitchFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, _element, attrs, controllers) => {
    // The 4th argument is the resolved `require: 'ngSwitch'` —
    // self-require, so `controllers` is the same `NgSwitchController`
    // instance the seam stashed against this element. The require-
    // resolver returns `null` for an optional miss (not applicable
    // here — the spec is non-optional) and a populated instance
    // otherwise. We treat anything non-shape-conforming as a no-op so
    // a hypothetical future seam change cannot null-deref the closure
    // below.
    const ctrl = controllers as NgSwitchControllerShape | null;
    if (ctrl === null) {
      return;
    }

    const expr = attrs[NG_SWITCH_NAME];
    if (typeof expr !== 'string') {
      // Defensive — the directive only matches when the attribute is
      // present, but `attrs[NG_SWITCH_NAME]` is typed `string | undefined`
      // through the Attributes index signature.
      return;
    }

    scope.$watch(expr, (value: unknown) => {
      // 1. Tear down the currently-mounted set.
      clearSelected(ctrl);

      // 2. Look up the matching transcludes — `String(value)` exact-
      //    match first, then fall back to the default key `'?'`. A miss
      //    in both leaves the slot empty (FS §2.2 acceptance: "empty
      //    container when no match and no default").
      const key = String(value);
      const matched = ctrl.cases.get(key) ?? ctrl.cases.get(DEFAULT_KEY);
      if (matched === undefined) {
        return;
      }

      // 3. Mount each matching transclude. Each yields a fresh deep
      //    clone of the child's host element against a fresh
      //    transclusion scope; the clone is inserted as the next
      //    sibling of the child's own Comment placeholder so document
      //    order across multiple matching siblings is preserved.
      for (const entry of matched) {
        entry.transclude((clone, transcludedScope) => {
          const head = clone[0];
          if (head === undefined) {
            // Defensive — the element-form default bucket is `[host]`,
            // so `clone[0]` is always defined in practice.
            return;
          }
          if (!isElement(head)) {
            // Invariant — for `transclude: 'element'`, the default
            // bucket is `[host]` where `host` is the original Element
            // the matched `ng-switch-when` / `ng-switch-default`
            // declared on. A runtime mismatch means the transclude
            // machinery's contract has broken; surface it rather than
            // silently casting through `unknown`.
            throw new Error(`ngSwitch: expected cloned host to be an Element, got nodeType ${String(head.nodeType)}`);
          }
          const cloneElement = head;
          entry.placeholder.parentNode?.insertBefore(cloneElement, entry.placeholder.nextSibling);
          ctrl.selectedTranscludes.push(entry.transclude);
          ctrl.selectedScopes.push(transcludedScope);
          ctrl.selectedClones.push(cloneElement);
        });
      }
    });

    // 4. Ensure scope destruction tears the active set down even if no
    //    transition ever fires (e.g. the parent's outer scope is
    //    destroyed before the watcher's first fire). `$destroy`
    //    listeners propagate through the scope tree, so a transition
    //    that never happens but a scope destruction that does should
    //    still tear active clones down. (In practice the watcher fires
    //    once synchronously on the first digest, so this is a belt-
    //    and-braces guarantee for edge cases.)
    scope.$on('$destroy', () => {
      clearSelected(ctrl);
    });
  };

  return {
    restrict: 'EA',
    priority: 1200,
    require: NG_SWITCH_NAME,
    controller: [NgSwitchController],
    link,
  };
}

/**
 * DI-annotated parent factory. Zero dependencies — array-form because
 * `annotate` rejects bare functions without `$inject`.
 */
export const ngSwitchDirective: DirectiveFactory = [ngSwitchFactory];

/**
 * Shared link-fn factory for `ngSwitchWhen` / `ngSwitchDefault`. Both
 * children share the same compile-time + link-time wiring:
 *
 *  1. Their host element is replaced at compile time by a Comment
 *     placeholder via spec 027 Slice 2's `transclude: 'element'`
 *     capture; the matched directive's link fn receives the Comment
 *     placeholder as `element` and a callable `$transclude` as the 5th
 *     argument.
 *  2. Their `require: '^ngSwitch'` resolves to the parent's
 *     `NgSwitchController` instance via the spec-022 Slice-4 ancestor
 *     walk; without a parent the resolver throws
 *     `MissingRequiredControllerError` routed via
 *     `$exceptionHandler('$compile')`.
 *  3. They register their `{ transclude, placeholder }` pair into the
 *     parent's `cases` map under the resolved key. The parent's link
 *     fn does ALL the mounting; the children install no clones
 *     themselves.
 *
 * The `keyFor` argument is the only thing that differs between the two
 * children: `ngSwitchWhen` reads its key from `attrs.ngSwitchWhen` (an
 * attribute string), while `ngSwitchDefault` always registers under the
 * literal `'?'` key (no attribute read).
 */
function createSwitchChildLink(keyFor: (attrs: Record<string, string | undefined>) => string | undefined): LinkFn {
  return (_scope, element, attrs, controllers, $transclude) => {
    const ctrl = controllers as NgSwitchControllerShape | null;
    if (ctrl === null) {
      // Defensive — `require: '^ngSwitch'` is non-optional, so the
      // seam would have already thrown `MissingRequiredControllerError`
      // before the link fn runs. Belt-and-braces guard.
      return;
    }

    if ($transclude === undefined) {
      // Defensive — `transclude: 'element'` on the DDO guarantees the
      // 5th argument is wired by the compiler. The guard exists so a
      // hypothetical future seam change cannot null-deref the
      // `entry.transclude` write below.
      return;
    }

    // The runtime `element` is the Comment placeholder Slice 2 inserted
    // in place of the host element. The public LinkFn types it as
    // `Element`, but the Slice 2 `transclude: 'element'` foundation
    // guarantees a `Comment` at runtime — verify with the existing
    // guard and throw on mismatch rather than casting through
    // `unknown`. Matches the spec 027 Slice 3 `ng-if` precedent.
    if (!isComment(element)) {
      throw new Error(`ngSwitch: expected placeholder to be a Comment, got nodeType ${String(element.nodeType)}`);
    }
    const placeholder = element;

    // Snapshot the attribute view so the closure-local `attrs` object
    // satisfies the `keyFor` callback's `Record<string, string | undefined>`
    // contract without leaking the wider `Attributes` index signature
    // (which includes `$set` / `$observe` callable slots).
    const attrSnapshot: Record<string, string | undefined> = attrs as unknown as Record<string, string | undefined>;
    const key = keyFor(attrSnapshot);
    if (key === undefined) {
      // No key resolved — bail cleanly. For `ngSwitchWhen` this
      // happens when `attrs.ngSwitchWhen` is undefined (the directive
      // would not have matched in that case, but the `keyFor` callback
      // is defensive). `ngSwitchDefault` always returns the literal
      // `'?'` from its `keyFor`, so it never bails.
      return;
    }

    const existing = ctrl.cases.get(key) ?? [];
    existing.push({ transclude: $transclude, placeholder });
    ctrl.cases.set(key, existing);
  };
}

function ngSwitchWhenFactory(): DirectiveFactoryReturn {
  return {
    restrict: 'EA',
    priority: 1200,
    transclude: 'element',
    require: `^${NG_SWITCH_NAME}`,
    link: createSwitchChildLink((attrs) => {
      const raw = attrs[NG_SWITCH_WHEN_NAME];
      if (typeof raw !== 'string') {
        return undefined;
      }
      return raw;
    }),
  };
}

function ngSwitchDefaultFactory(): DirectiveFactoryReturn {
  return {
    restrict: 'EA',
    priority: 1200,
    transclude: 'element',
    require: `^${NG_SWITCH_NAME}`,
    link: createSwitchChildLink(() => DEFAULT_KEY),
  };
}

/**
 * DI-annotated `ngSwitchWhen` factory. Zero dependencies — array-form
 * for `annotate` strict-mode compatibility (matches every other
 * spec-023+ built-in directive).
 */
export const ngSwitchWhenDirective: DirectiveFactory = [ngSwitchWhenFactory];

/**
 * DI-annotated `ngSwitchDefault` factory. Same array-form shape as
 * `ngSwitchWhenDirective`. The two children share `createSwitchChildLink`
 * — the only difference is the `keyFor` callback, which returns the
 * literal `DEFAULT_KEY` constant for `ngSwitchDefault`.
 */
export const ngSwitchDefaultDirective: DirectiveFactory = [ngSwitchDefaultFactory];
