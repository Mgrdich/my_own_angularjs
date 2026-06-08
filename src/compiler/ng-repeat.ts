/**
 * `ngRepeat` — list iteration directive (spec 028 Slice 3 / FS §2.1
 * §2.6 §2.7 §2.8, technical-considerations §2.3 §2.4).
 *
 * `<li ng-repeat="todo in todos">{{ todo.title }}</li>` renders one
 * copy of the host element per item in the bound collection. The
 * directive is built on the `transclude: 'element'` foundation from
 * spec 027 Slice 2: at compile time the host element is detached and
 * replaced in place by a `<!-- ngRepeat: todo in todos -->` Comment
 * placeholder, and for each item in the bound array a fresh deep clone
 * of the captured master is linked against a per-item child scope and
 * inserted in document order after the placeholder.
 *
 * **Slice 3 scope.** This file ships the MINIMAL end-to-end working
 * directive: arrays only, default identity tracking only, the six
 * per-row locals, duplicate-key detection, and non-iterable bail.
 * Three capabilities are deferred to later slices and explicitly
 * NOT implemented here:
 *
 *  - **Slice 4: `track by EXPR` and row reuse.** The reconciler in
 *    this slice tears down ALL current rows on every watch fire and
 *    rebuilds the new list from scratch. Slice 4 will read `parsed.trackByExpr`
 *    and turn the "tear down all" branch into a proper survivor /
 *    move / new-row pass that preserves DOM-node identity and the
 *    state inside (input focus, form values).
 *  - **Slice 5: object iteration `(key, value) in object`.** This
 *    slice's `reconcile` accepts only `Array.isArray(newCollection)`;
 *    anything else (including plain objects) triggers the tear-down
 *    branch and renders nothing. Slice 5 will detect the object case
 *    and normalize `Object.keys(obj).sort()` to an item-array before
 *    feeding it through the same diff machinery.
 *  - **Slice 6: `as alias` parent-scope publication.** The parser
 *    already validates the alias name (Slice 1's
 *    {@link NgRepeatBadAliasError}), but this slice does NOT write
 *    the normalized collection to `parentScope[parsed.aliasIdent]` —
 *    the alias is silently ignored. Slice 6 will add the publication
 *    BEFORE row reconciliation in the same listener fire so a sibling
 *    `<p ng-if="!visible.length">` sees the new value in the same
 *    digest.
 *
 * Each of those three slices extends this file in-place; the duplicate-
 * detection contract, the per-row scope shape, and the cleanup wiring
 * are stable from this slice forward.
 *
 * **DDO shape and registration.** `restrict: 'A'`, `priority: 1000`,
 * `terminal: true`, `transclude: 'element'`. `priority: 1000` makes
 * `ngRepeat` win same-element conflicts against `ngIf` (600) and
 * `ngInclude` (400) — the canonical pattern `<li ng-repeat="…" ng-class="…">`
 * is unaffected because `ngClass` is not a structural directive.
 * `terminal: true` provides the same-element cutoff so lower-priority
 * directives on the host do not run; the descendant-walk cutoff is
 * NOT engaged (the spec-023 narrowing is gated on `directive.name ===
 * 'ngNonBindable'`).
 *
 * **The duplicate-key contract.** When two items in the bound array
 * resolve to the same identity string under the default tracker, the
 * reconciler throws {@link NgRepeatDuplicateKeyError}. The directive
 * wraps the entire reconciliation block in a `try/catch` that routes
 * via `invokeExceptionHandler($exceptionHandler, err, '$compile')`,
 * NOT through the digest's `'watchListener'` path — the directive
 * captures the throw before the watcher's caller does, so the cause
 * token observed by application-side `$exceptionHandler` overrides is
 * `'$compile'`. On a throw, the catch branch invokes
 * `tearDownAllRows()` so the offending collection does not leave a
 * half-rendered tree behind.
 *
 * **Cleanup contract.** A single
 * `addElementCleanup(placeholder, () => tearDownAllRows())` runs at
 * link time so a parent `destroyElementScope` reaching the placeholder
 * still cascades teardown to every active row. A second cleanup path
 * — `scope.$on('$destroy', tearDownAllRows)` — covers the
 * "parent scope destroyed without DOM teardown" branch; both paths
 * converge on the same closure-local helper and are idempotent (a
 * second invocation finds `currentRows` empty and is a no-op).
 *
 * **Non-iterable values bail cleanly (FS §2.7).** When the resolved
 * collection is not an array (`null`, `undefined`, a number, a string,
 * a function, OR a plain object — the object branch is deferred to
 * Slice 5), `reconcile` tears down any current rows and returns
 * without rendering. No error, no console noise, no half-mounted DOM.
 *
 * @example Basic array iteration
 * ```html
 * <ul>
 *   <li ng-repeat="todo in todos">{{ todo.title }}</li>
 * </ul>
 * <!-- With scope.todos = [{title:'A'}, {title:'B'}, {title:'C'}]:
 *      after compile + first digest the <ul> contains:
 *      <ul>
 *        <!-- ngRepeat: todo in todos -->
 *        <li>A</li>
 *        <li>B</li>
 *        <li>C</li>
 *      </ul>
 *      Pushing a new item appends one <li>; reassigning the array
 *      tears down all rows and rebuilds (Slice 3) — Slice 4 will
 *      reuse rows by identity. -->
 * ```
 *
 * @example Per-row locals
 * ```html
 * <li ng-repeat="t in todos">
 *   {{ $index + 1 }}. {{ t.title }} ({{ $first ? 'first' : $last ? 'last' : 'middle' }})
 * </li>
 * <!-- The six framework-published locals ($index, $first, $last,
 *      $middle, $even, $odd) are populated on the per-row scope
 *      BEFORE the row's DOM is inserted, so first-render bindings see
 *      the correct values. -->
 * ```
 *
 * @example Duplicate-key detection
 * ```html
 * <li ng-repeat="n in [1, 2, 2, 3]">{{ n }}</li>
 * <!-- Without `track by`, the default tracker assigns
 *      'number:1' / 'number:2' / 'number:2' / 'number:3' — the
 *      second '2' duplicates the first. Reconciliation throws
 *      NgRepeatDuplicateKeyError; the directive catches and routes
 *      via $exceptionHandler('$compile'); all rows are torn down so
 *      no half-rendered list remains. The fix: use `track by $index`
 *      (Slice 4) or deduplicate the input. -->
 * ```
 */

import type { Scope } from '@core/index';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';

import { addElementCleanup } from './cleanup';
import { NgRepeatDuplicateKeyError } from './compile-error';
import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';
import { createIdentityTracker } from './ng-repeat-identity';
import { parseIteratorExpression } from './ng-repeat-iterator-parse';
import { isComment, isElement } from './node-guards';

/**
 * Normalized directive name — registration in `src/core/ng-module.ts`
 * and the `attrs[NG_REPEAT_NAME]` lookup in this file are tied together
 * via this constant so a rename touches both at once. Module-private:
 * only the registration import in `ng-module.ts` consumes the
 * re-export.
 */
export const NG_REPEAT_NAME = 'ngRepeat';

/**
 * Per-row bookkeeping carried in the directive's closure-local
 * `currentRows` map. Keyed by identity string (the value returned by
 * the default tracker, or — Slice 4 — by the evaluated `track by`
 * expression).
 *
 * `key` is reserved for Slice 5's `(key, value) in object` iteration;
 * Slice 3 never reads or writes it. The optional field is declared now
 * so Slice 5 can extend the shape without a breaking refactor.
 */
interface RowEntry {
  scope: Scope;
  cloneRoot: Element;
  index: number;
  value: unknown;
  key?: string;
}

/**
 * Slice 3 factory — depends ONLY on `$exceptionHandler` so duplicate-
 * key throws route via `'$compile'` from the directive's own
 * try/catch (not via the digest's `'watchListener'` path). The
 * canonical array-form DI shape that the spec 018 `ngTransclude`
 * precedent established for built-in directives that need framework
 * services injected.
 *
 * Slice 4 will preserve the same shape (no additional deps); Slice 5
 * may add `$parse` if the iterator's `track by` evaluation needs a
 * dedicated parse seam beyond the one already provided by
 * {@link parseIteratorExpression}.
 */
function ngRepeatFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs, _controllers, $transclude) => {
    // Verify the runtime placeholder shape. For `transclude: 'element'`
    // the foundation guarantees a Comment at runtime, but the public
    // `LinkFn` types `element` as `Element` — verify with the existing
    // guard and throw on mismatch rather than casting through `unknown`.
    // Matches the spec 027 Slice 3 / Slice 5 / Slice 6 precedent.
    if (!isComment(element)) {
      throw new Error(`ngRepeat: expected placeholder to be a Comment, got nodeType ${String(element.nodeType)}`);
    }
    const placeholder = element;

    // Defensive — `$transclude` is the 5th argument and is populated
    // only when the directive declares `transclude` on its DDO. The
    // DDO below sets `transclude: 'element'`, so the compiler always
    // wires this argument in practice; the guard exists so a
    // hypothetical future seam change cannot silently null-deref the
    // closure below. Mirrors `ngIf` / `ngSwitch` / `ngInclude`.
    if ($transclude === undefined) {
      return;
    }
    const transclude = $transclude;

    const rawAttrValue = attrs[NG_REPEAT_NAME];
    if (typeof rawAttrValue !== 'string') {
      // Defensive — `attrs['ngRepeat']` is typed
      // `string | Record<string, string> | AttributesSetFn |
      // AttributesObserveFn | undefined` through the index signature.
      // If the attribute is missing entirely the directive shouldn't
      // have matched, but bail cleanly rather than passing a
      // non-string into `parseIteratorExpression`.
      return;
    }
    // Capture a narrowed `const` so closures (the `reconcile` body
    // below) see `string` rather than the wider index-signature
    // union — TS does not propagate flow narrowing into nested
    // function scopes.
    const rawExpression: string = rawAttrValue;

    // Parse the iterator expression ONCE per link invocation. A throw
    // from `parseIteratorExpression` (one of the three Slice 1 error
    // classes — `NgRepeatBadIteratorExpressionError`,
    // `NgRepeatBadIdentifierError`, `NgRepeatBadAliasError`) bubbles
    // up through the factory's existing try/catch in
    // `$$buildDirectiveArrayProvider`, routed via
    // `$exceptionHandler('$compile')`. For Slice 3 that bubbling-up
    // is the documented behavior — the parser's error classes carry
    // the diagnostic; no wrapping is needed.
    const parsed = parseIteratorExpression(rawExpression);

    // Fresh identity tracker per directive instance. The WeakMap
    // closed over by `createIdentityTracker` is module-private to the
    // directive — two `ngRepeat` instances over the same collection
    // produce independent identity namespaces, which is fine because
    // identity is a relative concept here (only stability across
    // digests within the same directive matters).
    const identityTracker = createIdentityTracker();

    // Closure-local row state. Keyed by identity string; the value
    // carries the per-row scope + DOM clone + bookkeeping. In Slice 3
    // we always rebuild this from scratch on each watch fire (no
    // reuse); Slice 4 will turn this into a survivor-tracking map.
    let currentRows: Map<string, RowEntry> = new Map();

    /**
     * Tear down every currently-mounted row: destroy each per-row
     * scope (fires `$on('$destroy', …)` listeners, cancels watchers),
     * remove the clone from the DOM, and clear the row map. Idempotent
     * — a second invocation finds `currentRows` empty and returns
     * immediately. Used from three call sites:
     *
     *   1. `reconcile`'s non-iterable-bail branch (FS §2.7).
     *   2. The reconciliation's tear-down-then-rebuild step (Slice 3
     *      only; Slice 4 will refine this into a survivor pass).
     *   3. The cleanup callback registered on the placeholder via
     *      `addElementCleanup` AND the `scope.$on('$destroy', …)`
     *      handler — both paths must converge on a single helper so
     *      a parent scope destruction tears the rows down even if the
     *      DOM-cleanup queue is never walked.
     */
    function tearDownAllRows(): void {
      for (const entry of currentRows.values()) {
        // Order mirrors `ng-if` / `ng-switch`'s teardown: destroy the
        // scope BEFORE removing from the DOM so any `$on('$destroy',
        // …)` listeners that read DOM state still observe the live
        // tree.
        entry.scope.$destroy();
        entry.cloneRoot.remove();
      }
      currentRows.clear();
    }

    /**
     * Reconcile the rendered rows against a new collection value.
     * Slice 3 semantics:
     *
     *   1. Non-iterable → tear down all rows and return (FS §2.7).
     *   2. Compute identity keys for every item; throw
     *      {@link NgRepeatDuplicateKeyError} on the first duplicate.
     *   3. Tear down ALL current rows (no reuse — Slice 4 will refine).
     *   4. Build fresh rows in collection order, populating the six
     *      per-row locals and the item binding BEFORE the row's DOM
     *      is inserted (so first-render watchers fire with correct
     *      values).
     *
     * Throws bubble up to the watcher-listener wrapper below, which
     * routes via `$exceptionHandler('$compile')` and tears the rows
     * down on the error path so no half-rendered tree remains.
     */
    function reconcile(newCollection: unknown): void {
      if (!Array.isArray(newCollection)) {
        // FS §2.7 — non-iterable values render nothing. Tear down
        // anything currently mounted and bail. Object-iteration is
        // Slice 5; in Slice 3 even a plain object takes this branch.
        tearDownAllRows();
        return;
      }
      // `Array.isArray` narrows to `any[]` per the TS lib types;
      // widen back to `unknown[]` so element access is strictly
      // typed (avoids `@typescript-eslint/no-unsafe-assignment`).
      const items: unknown[] = newCollection;

      // Compute identity keys + detect duplicates in a single pass.
      // The `newKeyToIndex` map serves two purposes: it lets us
      // surface the OTHER index of a duplicate identity (so the
      // error message names both offending items), and it stores the
      // canonical keys so step 4 doesn't recompute identity.
      const newKeys: string[] = [];
      const newKeyToIndex = new Map<string, number>();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = identityTracker.getIdentity(item);
        const existingIndex = newKeyToIndex.get(key);
        if (existingIndex !== undefined) {
          // The two items both resolve to `key`. Surface both for the
          // diagnostic; `items[existingIndex]` is the FIRST
          // occurrence (already pushed into `newKeys`), `item` is the
          // CURRENT one.
          throw new NgRepeatDuplicateKeyError(rawExpression, key, items[existingIndex], item);
        }
        newKeys.push(key);
        newKeyToIndex.set(key, i);
      }

      // Slice 3 simplification — tear down ALL current rows and
      // rebuild fresh. Slice 4 will turn this into a survivor /
      // move / new-row pass that preserves DOM-node identity and
      // the state inside (input focus, form values).
      tearDownAllRows();

      // Walk the new collection in document order, mounting one row
      // per item. `anchor` starts at the Comment placeholder and
      // advances to the most-recently-inserted clone so each new row
      // is inserted IMMEDIATELY AFTER its predecessor (i.e. as the
      // next sibling) — `insertBefore(clone, anchor.nextSibling)`
      // handles `anchor.nextSibling === null` correctly (it appends
      // when the anchor is the last child of its parent).
      let anchor: Node = placeholder;
      const lastIndex = items.length - 1;
      const nextRows = new Map<string, RowEntry>();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = newKeys[i];
        if (key === undefined) {
          // Defensive — `newKeys` is built 1:1 with `newCollection` in
          // the pass above, so `newKeys[i]` is always defined here.
          // The `noUncheckedIndexedAccess` strict-mode flag types it
          // as `string | undefined`, hence the guard. Treat a phantom
          // miss as a no-op rather than a panic; the next iteration
          // will recover.
          continue;
        }
        const isFirstRow = i === 0;
        const isLastRow = i === lastIndex;

        // `$transclude(fn)` deep-clones the captured master and links
        // the clone against a fresh transclusion scope. The callback
        // receives `(clone, transcludedScope)`; `clone[0]` is the
        // cloned host Element for the element-form default bucket.
        transclude((clone, transcludedScope) => {
          const head = clone[0];
          if (head === undefined) {
            // Defensive — the element-form default bucket is `[host]`,
            // so `clone[0]` is always defined in practice. Bail
            // cleanly rather than insert nothing and stash a row
            // with no DOM (which would corrupt tear-down).
            return;
          }
          if (!isElement(head)) {
            // Invariant — for `transclude: 'element'`, the default
            // bucket is `[host]` where `host` is the original
            // Element. A runtime mismatch means the transclude
            // machinery's contract has broken; surface it rather
            // than silently casting through `unknown`. Matches the
            // spec 027 Slice 3 / Slice 5 / Slice 6 precedent.
            throw new Error(`ngRepeat: expected cloned host to be an Element, got nodeType ${String(head.nodeType)}`);
          }
          const cloneRoot = head;

          // Populate the per-row locals + the item binding BEFORE
          // inserting into the DOM so first-render watchers fire
          // with correct values. The cast through
          // `Record<string, unknown>` matches the established
          // precedent in `compile.ts:668` (`bindAlias`-path scope
          // write) — `Scope`'s typed surface does NOT include
          // arbitrary keys, but the runtime accepts them via
          // prototype-chain lookup the same way the parser's
          // interpreter does.
          const rowScope = transcludedScope as unknown as Record<string, unknown>;
          rowScope[parsed.valueIdent] = item;
          rowScope.$index = i;
          rowScope.$first = isFirstRow;
          rowScope.$last = isLastRow;
          rowScope.$middle = !isFirstRow && !isLastRow;
          rowScope.$even = i % 2 === 0;
          rowScope.$odd = i % 2 !== 0;

          // Insert the clone as the next sibling of `anchor`. When
          // `anchor === placeholder` this lands the first row
          // immediately after the placeholder; subsequent iterations
          // advance the anchor so each row lands after its
          // predecessor. `insertBefore(clone, null)` is the canonical
          // "append at end" shape and is what we get when
          // `anchor.nextSibling === null` (i.e. the anchor is the
          // last child of its parent).
          placeholder.parentNode?.insertBefore(cloneRoot, anchor.nextSibling);
          anchor = cloneRoot;

          nextRows.set(key, {
            scope: transcludedScope,
            cloneRoot,
            index: i,
            value: item,
          });
        });
      }

      currentRows = nextRows;
    }

    // Install the collection watcher. `$watchCollection` accepts both
    // the function-form `ExpressionFn` (what `parse()` returns) and
    // string expressions; we pass the pre-parsed function so the
    // watcher does NOT re-parse on each install. The listener wraps
    // the reconciliation in a try/catch so a duplicate-key throw is
    // captured BEFORE the digest's `'watchListener'` path sees it —
    // the cause token observed by application-side
    // `$exceptionHandler` overrides is `'$compile'`, NOT
    // `'watchListener'` (the duplicate-key contract is documented as
    // `$compile`-cause-routed). On a throw the catch clears all rows
    // so the offending collection does not leave a half-rendered
    // tree.
    scope.$watchCollection(parsed.collectionExpr, (newCollection) => {
      try {
        reconcile(newCollection);
      } catch (err: unknown) {
        // Clear any rows that survived the partial pass before
        // routing — a duplicate detected mid-collection would leave
        // earlier-validated rows un-built (we tear down BEFORE
        // re-mounting), so the only state to clear is the bookkeeping
        // map plus any rows from the previous SUCCESSFUL reconcile.
        // `tearDownAllRows` is idempotent.
        tearDownAllRows();
        invokeExceptionHandler($exceptionHandler, err, '$compile');
      }
    });

    // Register cleanup on the placeholder Comment so a parent
    // `destroyElementScope` reaching this slot still tears every
    // active row down. The `addElementCleanup` widening from spec
    // 027 Slice 2 accepts `Element | Comment` directly — no cast
    // needed.
    addElementCleanup(placeholder, () => {
      tearDownAllRows();
    });

    // The scope-destroy path covers the "parent scope destroyed
    // without DOM teardown" branch — without this `$on`, an outer
    // `scope.$destroy()` would leave the rows mounted (their parent
    // scope still references them) but their watcher tree would be
    // attached to a torn-down parent, leaking digest work. Both
    // cleanup paths converge on `tearDownAllRows`; subsequent
    // invocations are idempotent no-ops.
    scope.$on('$destroy', () => {
      tearDownAllRows();
    });
  };

  return {
    restrict: 'A',
    priority: 1000,
    terminal: true,
    transclude: 'element',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngRepeat', ngRepeatDirective)`. The
 * `'$exceptionHandler'` dependency lets the directive route
 * duplicate-key throws via `'$compile'` from its own try/catch (NOT
 * via the digest's `'watchListener'` path). The canonical array-form
 * shape — same as `ngTransclude` (spec 018), the event directives
 * (spec 026), and `ngInclude` (spec 027) — keeps `annotate` happy.
 */
export const ngRepeatDirective: DirectiveFactory = ['$exceptionHandler', ngRepeatFactory];
