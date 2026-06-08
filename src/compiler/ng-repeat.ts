/**
 * `ngRepeat` — list iteration directive (spec 028 Slice 4 / FS §2.1
 * §2.3 §2.6 §2.7 §2.8 §2.9, technical-considerations §2.3 §2.4).
 *
 * `<li ng-repeat="todo in todos">{{ todo.title }}</li>` renders one
 * copy of the host element per item in the bound collection. Built on
 * the `transclude: 'element'` foundation from spec 027 Slice 2: at
 * compile time the host element is detached and replaced by a
 * `<!-- ngRepeat: todo in todos -->` Comment placeholder; for each
 * item in the bound array a fresh deep clone of the captured master is
 * linked against a per-item child scope and inserted in document order
 * after the placeholder.
 *
 * **Slice 4 scope.** Custom identity via `track by EXPR` AND true row
 * reuse on identity match. The Slice 3 "tear down all + rebuild"
 * simplification is replaced with the proper diff / move / fresh-build
 * / survivor-teardown algorithm documented in
 * technical-considerations §2.3. Two capabilities remain deferred:
 * Slice 5 (`(key, value) in object` iteration — plain objects today
 * take the non-iterable bail branch) and Slice 6 (`as alias`
 * parent-scope publication — the parser validates the alias name but
 * the reconciler does not yet write to `parentScope[aliasIdent]`).
 *
 * **The row-reuse contract (FS §2.9).** On each watch fire the
 * reconciler computes an identity key for every incoming item, then
 * walks the new identity list in collection order:
 *
 *   - Identity present in the previous `currentRows` map → REUSE: the
 *     row's existing per-row scope and `cloneRoot` Element are
 *     retained, the six per-row locals are updated to the new
 *     position, the item binding is rewritten, and the `cloneRoot` is
 *     MOVED in the DOM via `parentNode.insertBefore(cloneRoot,
 *     anchor.nextSibling)`. DOM-node identity is preserved across
 *     digests so state inside (input focus, form values) survives.
 *   - Identity not in the previous map → FRESH BUILD: a new
 *     `$transclude(...)` clone is produced, populated with the
 *     per-row locals + item binding BEFORE DOM insertion, and
 *     inserted after the anchor.
 *
 * After the walk, entries left in the previous map (identities that
 * disappeared) are torn down: each survivor's scope is `$destroy()`-ed
 * and its `cloneRoot` is removed. Same order as
 * `tearDownAllRows`'s teardown.
 *
 * **The `track by EXPR` evaluation surface.** When `parsed.trackByExpr`
 * is non-null, the reconciler evaluates it against the parent scope
 * via the `ExpressionFn`'s `(scope, locals)` arity, with a transient
 * locals object exposing `$index` AND the per-row item binding under
 * `parsed.valueIdent` (so `track by todo.id` resolves `todo` even
 * though no per-row scope exists at identity-computation time). The
 * result is coerced via `String(...)` to normalize numeric / boolean /
 * null identity values into the `Map<string, …>` key space. When
 * `parsed.trackByExpr === null` the reconciler falls back to the
 * closure-local `identityTracker` from Slice 2.
 *
 * **DDO shape.** `restrict: 'A'`, `priority: 1000`, `terminal: true`,
 * `transclude: 'element'`. The priority makes `ngRepeat` win
 * same-element conflicts against `ngIf` (600) and `ngInclude` (400);
 * `terminal: true` provides the same-element cutoff (the descendant-
 * walk cutoff is NOT engaged — spec-023 gates that narrowing on
 * `directive.name === 'ngNonBindable'`).
 *
 * **The duplicate-key contract.** Two items resolving to the same
 * identity throws {@link NgRepeatDuplicateKeyError}. The directive
 * wraps the reconciliation block in a `try/catch` that routes via
 * `invokeExceptionHandler($exceptionHandler, err, '$compile')`, NOT
 * through the digest's `'watchListener'` path. On a throw the catch
 * branch calls `tearDownAllRows()` so no half-rendered tree remains.
 *
 * **Cleanup contract.** A single `addElementCleanup(placeholder,
 * tearDownAllRows)` runs at link time so a parent
 * `destroyElementScope` reaching the placeholder still cascades
 * teardown to every active row. A second path —
 * `scope.$on('$destroy', tearDownAllRows)` — covers parent-scope
 * destruction without DOM teardown. Both paths converge on the same
 * idempotent helper.
 *
 * **Non-iterable values bail cleanly (FS §2.7).** When the resolved
 * collection is not an array (`null`, `undefined`, a number, a string,
 * a function, OR a plain object — Slice 5), `reconcile` tears down
 * any current rows and returns without rendering. No error, no
 * console noise, no half-mounted DOM.
 *
 * @example Basic array iteration with row reuse on push / reorder
 * ```html
 * <ul>
 *   <li ng-repeat="todo in todos">{{ todo.title }}</li>
 * </ul>
 * <!-- Pushing a new item appends one <li>; existing rows are reused
 *      (not rebuilt). Reordering the array moves the existing <li>
 *      nodes in place — focus / form-state inside survives. -->
 * ```
 *
 * @example Custom identity via `track by`
 * ```html
 * <li ng-repeat="todo in todos track by todo.id">{{ todo.title }}</li>
 * <!-- Replacing scope.todos with a fresh array whose items have the
 *      SAME `.id` values as the previous array reuses every row by
 *      identity. `track by $index` is the documented escape hatch for
 *      lists whose item values legitimately repeat. -->
 * ```
 *
 * @example Duplicate-key detection
 * ```html
 * <li ng-repeat="n in [1, 2, 2, 3]">{{ n }}</li>
 * <!-- Without `track by`, the default tracker assigns
 *      'number:1' / 'number:2' / 'number:2' / 'number:3' — the second
 *      '2' duplicates the first. Reconciliation throws
 *      NgRepeatDuplicateKeyError; the directive catches and routes
 *      via $exceptionHandler('$compile'); all rows are torn down. The
 *      fix: use `track by $index` or deduplicate the input. -->
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
 * via this constant so a rename touches both at once.
 */
export const NG_REPEAT_NAME = 'ngRepeat';

/**
 * Per-row bookkeeping carried in the directive's closure-local
 * `currentRows` map. Keyed by identity string (default tracker OR the
 * `String(...)`-coerced value of the evaluated `track by` expression).
 * `key` is reserved for Slice 5's `(key, value) in object` iteration.
 */
interface RowEntry {
  scope: Scope;
  cloneRoot: Element;
  index: number;
  value: unknown;
  key?: string;
}

/**
 * Mutate the per-row scope's six framework-published locals to reflect
 * the row's new position. Used from both the reuse branch (existing
 * row whose `$index` changed) and the fresh-build branch (new row
 * needs locals populated before DOM insertion). The cast through
 * `Record<string, unknown>` matches the `compile.ts` precedent for
 * dynamic scope writes.
 */
function updatePerRowLocals(scope: Scope, index: number, totalCount: number): void {
  const lastIndex = totalCount - 1;
  const isFirstRow = index === 0;
  const isLastRow = index === lastIndex;
  const rowScope = scope as unknown as Record<string, unknown>;
  rowScope.$index = index;
  rowScope.$first = isFirstRow;
  rowScope.$last = isLastRow;
  rowScope.$middle = !isFirstRow && !isLastRow;
  rowScope.$even = index % 2 === 0;
  rowScope.$odd = index % 2 !== 0;
}

/**
 * Factory — depends ONLY on `$exceptionHandler` so duplicate-key
 * throws route via `'$compile'` from the directive's own try/catch
 * (not via the digest's `'watchListener'` path). The canonical
 * array-form DI shape from the spec 018 `ngTransclude` precedent.
 * `track by` evaluation reuses the `ExpressionFn` returned by
 * Slice 1's {@link parseIteratorExpression} via its `(scope, locals)`
 * arity — no additional parse seam is needed.
 */
function ngRepeatFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs, _controllers, $transclude) => {
    // Verify the runtime placeholder shape — for `transclude: 'element'`
    // the foundation guarantees a Comment at runtime, but the public
    // `LinkFn` types `element` as `Element`. Matches the spec 027
    // hardening precedent.
    if (!isComment(element)) {
      throw new Error(`ngRepeat: expected placeholder to be a Comment, got nodeType ${String(element.nodeType)}`);
    }
    const placeholder = element;

    // Defensive — the DDO sets `transclude: 'element'`, so the compiler
    // always wires `$transclude`; the guard keeps a hypothetical seam
    // change from null-dereffing. Mirrors ngIf / ngSwitch / ngInclude.
    if ($transclude === undefined) {
      return;
    }
    const transclude = $transclude;

    const rawAttrValue = attrs[NG_REPEAT_NAME];
    if (typeof rawAttrValue !== 'string') {
      // Defensive — index-signature widens to a union; bail rather
      // than pass a non-string into `parseIteratorExpression`.
      return;
    }
    // Narrowed `const` so nested closures see `string` (TS does not
    // propagate flow narrowing into nested function scopes).
    const rawExpression: string = rawAttrValue;

    // Parse once per link invocation. A throw from the Slice 1 parser
    // (NgRepeatBadIteratorExpressionError / NgRepeatBadIdentifierError
    // / NgRepeatBadAliasError) bubbles up through the factory's
    // try/catch in `$$buildDirectiveArrayProvider`, routed via
    // `$exceptionHandler('$compile')`.
    const parsed = parseIteratorExpression(rawExpression);

    // Fresh identity tracker per directive instance. The WeakMap is
    // module-private; two `ngRepeat` instances over the same
    // collection produce independent identity namespaces.
    const identityTracker = createIdentityTracker();

    // Closure-local row state, rebound by `reconcile` on each fire.
    let currentRows: Map<string, RowEntry> = new Map();

    /**
     * Identity for a single item at a given index. When `track by EXPR`
     * was supplied, evaluates the parsed expression against the parent
     * scope with a transient locals object exposing `$index` AND the
     * per-row item binding under `parsed.valueIdent` (so
     * `track by todo.id` resolves `todo` even though no per-row scope
     * exists at identity-computation time), then coerces via
     * `String(...)`. Otherwise falls back to the closure-local
     * `identityTracker` (Slice 2 — WeakMap for objects, type-prefix
     * sentinels for primitives).
     */
    function identityFor(item: unknown, index: number): string {
      if (parsed.trackByExpr !== null) {
        const locals: Record<string, unknown> = {
          $index: index,
          [parsed.valueIdent]: item,
        };
        const scopeLocals = scope as unknown as Record<string, unknown>;
        return String(parsed.trackByExpr(scopeLocals, locals));
      }
      return identityTracker.getIdentity(item);
    }

    /**
     * Tear down every currently-mounted row. Idempotent. Used from the
     * non-iterable bail branch, the duplicate-key catch branch, and
     * both cleanup paths (`addElementCleanup` + `$on('$destroy')`).
     * The steady-state diff pass does NOT call this helper — survivors
     * of the OLD map are torn down individually.
     */
    function tearDownAllRows(): void {
      for (const entry of currentRows.values()) {
        // Order mirrors ng-if / ng-switch: destroy the scope BEFORE
        // removing from the DOM so any `$on('$destroy', …)` listeners
        // that read DOM state still observe the live tree.
        entry.scope.$destroy();
        entry.cloneRoot.remove();
      }
      currentRows.clear();
    }

    /**
     * Reconcile rendered rows against a new collection (Slice 4):
     *
     *   1. Non-iterable → `tearDownAllRows()` and return (FS §2.7).
     *   2. Compute identity keys via `identityFor`; throw
     *      {@link NgRepeatDuplicateKeyError} on duplicates.
     *   3. Walk in order — reuse on identity match (move + update
     *      locals), fresh-build via `$transclude(...)` otherwise.
     *   4. Tear down entries left in the previous map (disappeared
     *      identities). Rebind `currentRows`.
     */
    function reconcile(newCollection: unknown): void {
      if (!Array.isArray(newCollection)) {
        tearDownAllRows();
        return;
      }
      // `Array.isArray` narrows to `any[]`; widen to `unknown[]` so
      // element access is strictly typed.
      const items: unknown[] = newCollection;

      // Compute identity keys + detect duplicates in a single pass.
      // `newKeyToIndex` lets the diagnostic name BOTH offending items.
      const newKeys: string[] = [];
      const newKeyToIndex = new Map<string, number>();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = identityFor(item, i);
        const existingIndex = newKeyToIndex.get(key);
        if (existingIndex !== undefined) {
          throw new NgRepeatDuplicateKeyError(rawExpression, key, items[existingIndex], item);
        }
        newKeys.push(key);
        newKeyToIndex.set(key, i);
      }

      // Diff pass. `previousRows` drains as the walk progresses; the
      // residue at the end is exactly the set of identities that
      // disappeared. `anchor` walks the DOM — `insertBefore(clone,
      // anchor.nextSibling)` handles `null` correctly (browsers
      // append) and is a self-no-op when the node is already in
      // position.
      const previousRows = currentRows;
      const nextRows = new Map<string, RowEntry>();
      const totalCount = items.length;
      let anchor: Node = placeholder;

      for (let i = 0; i < totalCount; i++) {
        const item = items[i];
        const key = newKeys[i];
        if (key === undefined) {
          // Defensive — `noUncheckedIndexedAccess` widens to
          // `string | undefined`. Built 1:1 with `items` above; treat
          // a phantom miss as a no-op rather than a panic.
          continue;
        }
        const existing = previousRows.get(key);
        if (existing !== undefined) {
          // REUSE — scope, watchers, listeners, and DOM tree kept
          // intact; only per-row locals + item binding + DOM position
          // are touched.
          previousRows.delete(key);
          updatePerRowLocals(existing.scope, i, totalCount);
          const reusedScope = existing.scope as unknown as Record<string, unknown>;
          reusedScope[parsed.valueIdent] = item;
          existing.index = i;
          existing.value = item;
          placeholder.parentNode?.insertBefore(existing.cloneRoot, anchor.nextSibling);
          anchor = existing.cloneRoot;
          nextRows.set(key, existing);
          continue;
        }

        // FRESH BUILD — `$transclude` deep-clones the captured master
        // and links the clone against a fresh transclusion scope.
        // `clone[0]` is the cloned host for the element-form default
        // bucket.
        transclude((clone, transcludedScope) => {
          const head = clone[0];
          if (head === undefined) {
            // Defensive — the element-form default bucket is `[host]`;
            // bail rather than stash a row with no DOM.
            return;
          }
          if (!isElement(head)) {
            throw new Error(`ngRepeat: expected cloned host to be an Element, got nodeType ${String(head.nodeType)}`);
          }
          const cloneRoot = head;

          // Populate locals + item binding BEFORE DOM insertion so
          // first-render watchers fire with correct values. The cast
          // mirrors `compile.ts`'s `bindAlias`-path scope write.
          const rowScope = transcludedScope as unknown as Record<string, unknown>;
          rowScope[parsed.valueIdent] = item;
          updatePerRowLocals(transcludedScope, i, totalCount);

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

      // Tear down identities that disappeared from the new
      // collection. The `previousRows` map at this point holds ONLY
      // the entries that weren't reused above. Same order as
      // `tearDownAllRows`: destroy the scope before removing from the
      // DOM.
      for (const entry of previousRows.values()) {
        entry.scope.$destroy();
        entry.cloneRoot.remove();
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
