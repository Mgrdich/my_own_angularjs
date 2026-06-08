/**
 * `ngRepeat` — list iteration directive (spec 028 Slice 5 / FS §2.1
 * §2.2 §2.3 §2.6 §2.7 §2.8 §2.9, technical-considerations §2.3 §2.4).
 *
 * `<li ng-repeat="todo in todos">{{ todo.title }}</li>` renders one
 * copy of the host element per item in the bound collection. Built on
 * the `transclude: 'element'` foundation from spec 027 Slice 2: at
 * compile time the host element is detached and replaced by a
 * `<!-- ngRepeat: todo in todos -->` Comment placeholder; for each
 * item in the bound array (OR each property of the bound object —
 * Slice 5) a fresh deep clone of the captured master is linked against
 * a per-item child scope and inserted in document order after the
 * placeholder.
 *
 * **Slice 5 scope.** Object iteration via `(key, value) in object` is
 * supported alongside the existing array iteration. Both shapes flow
 * through the same diff machinery after a normalization step that
 * collapses each input into a uniform `NormalizedItem[]` list. One
 * capability remains deferred: Slice 6 (`as alias` parent-scope
 * publication — the parser validates the alias name but the reconciler
 * does not yet write to `parentScope[aliasIdent]`).
 *
 * **Collection-shape dispatch (FS §2.2).** `normalizeCollection`
 * triages the runtime value:
 *
 *   - `Array.isArray(coll)` → array branch. Each entry becomes
 *     `{ key: i, value: coll[i] }` where `key` is the numeric index.
 *     The per-row scope binds `parsed.valueIdent` to the item; if the
 *     author also wrote `(k, v) in arr`, `parsed.keyIdent` is bound to
 *     the index (AngularJS-canonical — arrays expose `$index` AND the
 *     optional explicit key alias).
 *   - `coll !== null && typeof coll === 'object'` → object branch.
 *     Keys taken in alphabetical-string order via
 *     `Object.keys(coll).sort()` (AngularJS-canonical). Each entry
 *     becomes `{ key, value: coll[key] }`. The per-row scope binds
 *     `parsed.keyIdent` (when non-null) AND `parsed.valueIdent`;
 *     `item in obj` (`keyIdent === null`) exposes only the value.
 *   - Anything else (`null`, `undefined`, primitives, functions) →
 *     non-iterable bail: tear down current rows and return. Matches
 *     FS §2.7. Functions take the non-iterable path even though
 *     `Object.keys(fn)` would succeed, matching the Slice 3 contract
 *     pinned by the test suite.
 *
 * **Identity-with-key formula for object items.** Default identity on
 * object collections MUST include the object key — the same value can
 * legitimately appear under multiple keys (`{a: 1, b: 1}`), and a
 * value-only identity would falsely flag those as duplicates. The
 * formula is `key:${objKey}|${identityTracker.getIdentity(value)}`.
 * The `key:` prefix + `|` separator are disjoint from every
 * default-tracker output (`'object:N'`, `'string:…'`, `'number:…'`
 * etc. — none contain a `|`). When the author supplies `track by EXPR`
 * the expression is the identity source (same as array iteration) and
 * the key-injection step is skipped.
 *
 * **Collection-shape flip across digests is naturally safe.** Flipping
 * `scope.collection` from `[1, 2, 3]` to `{a: 1}` between digests
 * produces a fully disjoint identity key space (array entries use
 * primitive sentinels like `'number:1'`; object entries use
 * `'key:a|number:1'`), so the natural diff tears down every old row
 * and builds every new row — no special-case code needed.
 *
 * **Row-reuse contract (FS §2.9).** On each watch fire the reconciler
 * computes an identity for every incoming entry, then walks the new
 * list in order:
 *
 *   - Identity present in the previous `currentRows` map → REUSE: the
 *     existing per-row scope and `cloneRoot` are retained, the six
 *     per-row locals are updated, the item / key bindings are
 *     rewritten, and the `cloneRoot` is MOVED via
 *     `parentNode.insertBefore(cloneRoot, anchor.nextSibling)` — DOM
 *     identity is preserved so input focus / form values inside the
 *     row survive.
 *   - Identity not in the previous map → FRESH BUILD: a new
 *     `$transclude(...)` clone is produced, locals + bindings are
 *     populated BEFORE DOM insertion, then inserted after the anchor.
 *
 * Entries left in the previous map after the walk (disappeared
 * identities) are torn down: scope `$destroy()`-ed before `cloneRoot`
 * removal, matching the `tearDownAllRows` order.
 *
 * **`track by EXPR` evaluation surface.** When `parsed.trackByExpr` is
 * non-null, evaluation runs against the parent scope via the
 * `ExpressionFn`'s `(scope, locals)` arity, with a transient locals
 * object exposing `$index`, the per-row item binding under
 * `parsed.valueIdent`, AND (for the `(k, v)` LHS form) the key binding
 * under `parsed.keyIdent`. The result is coerced via `String(...)` to
 * normalize numeric / boolean / null identity values. When
 * `parsed.trackByExpr === null` the reconciler falls back to the
 * closure-local `identityTracker` from Slice 2 (with the
 * key-injection step for object collections).
 *
 * **DDO shape.** `restrict: 'A'`, `priority: 1000`, `terminal: true`,
 * `transclude: 'element'`. The priority makes `ngRepeat` win
 * same-element conflicts against `ngIf` (600) and `ngInclude` (400).
 *
 * **Duplicate-key contract.** Two entries resolving to the same
 * identity throws {@link NgRepeatDuplicateKeyError}. The directive
 * wraps the reconciliation block in a `try/catch` that routes via
 * `invokeExceptionHandler($exceptionHandler, err, '$compile')`, NOT
 * via the digest's `'watchListener'` path. On a throw the catch branch
 * calls `tearDownAllRows()` so no half-rendered tree remains.
 *
 * **Cleanup contract.** `addElementCleanup(placeholder,
 * tearDownAllRows)` runs at link time so a parent
 * `destroyElementScope` reaching the placeholder still cascades
 * teardown to every active row; `scope.$on('$destroy',
 * tearDownAllRows)` covers parent-scope destruction without DOM
 * teardown. Both converge on the same idempotent helper.
 *
 * @example Basic array iteration with row reuse on push / reorder
 * ```html
 * <ul>
 *   <li ng-repeat="todo in todos">{{ todo.title }}</li>
 * </ul>
 * ```
 *
 * @example Custom identity via `track by`
 * ```html
 * <li ng-repeat="todo in todos track by todo.id">{{ todo.title }}</li>
 * ```
 *
 * @example Duplicate-key detection
 * ```html
 * <li ng-repeat="n in [1, 2, 2, 3]">{{ n }}</li>
 * <!-- Throws NgRepeatDuplicateKeyError; fix: `track by $index`. -->
 * ```
 *
 * @example Object iteration with alphabetical key order
 * ```html
 * <li ng-repeat="(name, age) in {alice: 30, bob: 25}">
 *   {{ name }} → {{ age }}
 * </li>
 * <!-- Two rows: "alice → 30" then "bob → 25". -->
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
 * Per-row bookkeeping in the directive's closure-local `currentRows`
 * map. Keyed by identity string (default tracker OR `String(...)`-
 * coerced `track by` result). `key` is the numeric index for array
 * iteration and the property name for object iteration (Slice 5) —
 * both flow through the same `NormalizedItem` shape.
 */
interface RowEntry {
  scope: Scope;
  cloneRoot: Element;
  index: number;
  value: unknown;
  key: string | number;
}

/**
 * Uniform per-item shape produced by `normalizeCollection`. The diff
 * body walks this list shape-agnostically — array vs object dispatch
 * happens once during normalization and never again.
 */
interface NormalizedItem {
  key: string | number;
  value: unknown;
}

/**
 * Mutate the per-row scope's six framework-published locals to reflect
 * the row's new position. Used from both reuse and fresh-build
 * branches. The `Record<string, unknown>` cast matches the `compile.ts`
 * precedent for dynamic scope writes.
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
 * (not via the digest's `'watchListener'` path). `track by` evaluation
 * reuses the `ExpressionFn` returned by Slice 1's
 * {@link parseIteratorExpression} via its `(scope, locals)` arity.
 */
function ngRepeatFactory($exceptionHandler: ExceptionHandler): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs, _controllers, $transclude) => {
    // Verify the runtime placeholder shape — `transclude: 'element'`
    // guarantees a Comment but the public `LinkFn` types `element` as
    // `Element`. Matches the spec 027 hardening precedent.
    if (!isComment(element)) {
      throw new Error(`ngRepeat: expected placeholder to be a Comment, got nodeType ${String(element.nodeType)}`);
    }
    const placeholder = element;

    // Defensive — DDO sets `transclude: 'element'` so $transclude is
    // always wired; mirrors ngIf / ngSwitch / ngInclude.
    if ($transclude === undefined) {
      return;
    }
    const transclude = $transclude;

    const rawAttrValue = attrs[NG_REPEAT_NAME];
    if (typeof rawAttrValue !== 'string') {
      return;
    }
    // Narrowed const so nested closures see `string` (TS does not
    // propagate flow narrowing into nested function scopes).
    const rawExpression: string = rawAttrValue;

    // Parse once per link invocation. Parser throws (NgRepeatBad*) flow
    // through the factory's try/catch in $$buildDirectiveArrayProvider
    // and route via $exceptionHandler('$compile').
    const parsed = parseIteratorExpression(rawExpression);

    // Fresh identity tracker per directive instance — two `ngRepeat`
    // instances over the same collection produce independent namespaces.
    const identityTracker = createIdentityTracker();

    // Closure-local row state, rebound by `reconcile` on each fire.
    let currentRows: Map<string, RowEntry> = new Map();

    /**
     * Identity for a normalized entry. With `track by EXPR`, evaluates
     * against the parent scope with locals `{ $index, valueIdent: v,
     * (keyIdent: k)? }` then `String(...)`-coerces. Without, falls back
     * to `identityTracker`; for object collections (`isObjectCollection
     * === true`) the result is prefixed with `'key:${k}|'` so the same
     * value under two distinct keys does not falsely collide.
     */
    function identityFor(entry: NormalizedItem, index: number, isObjectCollection: boolean): string {
      if (parsed.trackByExpr !== null) {
        const locals: Record<string, unknown> = {
          $index: index,
          [parsed.valueIdent]: entry.value,
        };
        if (parsed.keyIdent !== null) {
          locals[parsed.keyIdent] = entry.key;
        }
        const scopeLocals = scope as unknown as Record<string, unknown>;
        return String(parsed.trackByExpr(scopeLocals, locals));
      }
      const valueIdentity = identityTracker.getIdentity(entry.value);
      if (isObjectCollection) {
        // Prefix with the property key so `{a: x, b: x}` (same value
        // under two keys) does not collapse to a single duplicate-key
        // throw. The `'key:'` prefix + `|` separator is disjoint from
        // every default-tracker output shape (`'object:N'`,
        // `'string:…'`, etc. — none contain a `|`), so the namespace
        // does not collide.
        return `key:${String(entry.key)}|${valueIdentity}`;
      }
      return valueIdentity;
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
     * Normalize the runtime collection into a uniform
     * `NormalizedItem[]` shape OR `null` for non-iterable values:
     *
     *   - `Array.isArray` → array branch, `{ key: i, value: arr[i] }`.
     *   - `value !== null && typeof === 'object'` → object branch,
     *     keys taken via `Object.keys(...).sort()` (AngularJS-canonical
     *     alphabetical-string order). Functions never reach this
     *     branch because `typeof === 'object'` and `typeof ===
     *     'function'` are disjoint primitive type tags, so they take
     *     the non-iterable bail — matches the Slice 3 contract pinned
     *     by the test suite.
     *   - Anything else → `null` (non-iterable bail, FS §2.7).
     *
     * The check ordering (`!== null` BEFORE `typeof === 'object'`) is
     * non-optional because `typeof null === 'object'` in JavaScript.
     */
    function normalizeCollection(value: unknown): { items: NormalizedItem[]; isObject: boolean } | null {
      if (Array.isArray(value)) {
        const arr: unknown[] = value;
        const items: NormalizedItem[] = arr.map((v, i) => ({ key: i, value: v }));
        return { items, isObject: false };
      }
      if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        const items: NormalizedItem[] = keys.map((k) => ({ key: k, value: obj[k] }));
        return { items, isObject: true };
      }
      return null;
    }

    /**
     * Reconcile rendered rows against a new collection (Slice 5):
     * normalize, compute identities (throw {@link
     * NgRepeatDuplicateKeyError} on duplicates), walk in order reusing
     * on identity match (move + update locals + value/key bindings) or
     * fresh-building via `$transclude(...)`, then tear down entries
     * left in the previous map. Array vs object dispatch is collapsed
     * into `normalizeCollection` so the diff body is shape-agnostic.
     */
    function reconcile(newCollection: unknown): void {
      const normalized = normalizeCollection(newCollection);
      if (normalized === null) {
        tearDownAllRows();
        return;
      }
      const { items, isObject } = normalized;

      // Compute identity keys + detect duplicates in a single pass.
      // `newKeyToIndex` lets the diagnostic name BOTH offending items.
      const newKeys: string[] = [];
      const newKeyToIndex = new Map<string, number>();
      for (let i = 0; i < items.length; i++) {
        const entry = items[i];
        if (entry === undefined) {
          // Defensive — `noUncheckedIndexedAccess` widens; built 1:1
          // with `items.length` above, so this is unreachable in
          // practice. Treat as a no-op rather than panic.
          continue;
        }
        const key = identityFor(entry, i, isObject);
        const existingIndex = newKeyToIndex.get(key);
        if (existingIndex !== undefined) {
          const prior = items[existingIndex];
          // Same defensive index-access narrowing — the `prior`
          // lookup is paired with `newKeyToIndex.set(key, i)` below so
          // a hit means the slot is populated.
          const priorValue = prior === undefined ? undefined : prior.value;
          throw new NgRepeatDuplicateKeyError(rawExpression, key, priorValue, entry.value);
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
        const entry = items[i];
        const key = newKeys[i];
        if (entry === undefined || key === undefined) {
          // Defensive — both arrays are built 1:1 with `totalCount`.
          continue;
        }
        const existing = previousRows.get(key);
        if (existing !== undefined) {
          // REUSE — scope, watchers, listeners, and DOM tree kept
          // intact; only per-row locals + item bindings + DOM position
          // are touched. Object-iteration rebinds the key alias too
          // when `parsed.keyIdent !== null`.
          previousRows.delete(key);
          updatePerRowLocals(existing.scope, i, totalCount);
          const reusedScope = existing.scope as unknown as Record<string, unknown>;
          reusedScope[parsed.valueIdent] = entry.value;
          if (parsed.keyIdent !== null) {
            reusedScope[parsed.keyIdent] = entry.key;
          }
          existing.index = i;
          existing.value = entry.value;
          existing.key = entry.key;
          placeholder.parentNode?.insertBefore(existing.cloneRoot, anchor.nextSibling);
          anchor = existing.cloneRoot;
          nextRows.set(key, existing);
          continue;
        }

        // FRESH BUILD — `$transclude` deep-clones the captured master.
        // `clone[0]` is the cloned host for the element-form default
        // bucket.
        transclude((clone, transcludedScope) => {
          const head = clone[0];
          if (head === undefined) {
            return;
          }
          if (!isElement(head)) {
            throw new Error(`ngRepeat: expected cloned host to be an Element, got nodeType ${String(head.nodeType)}`);
          }
          const cloneRoot = head;

          // Populate locals + bindings BEFORE DOM insertion so
          // first-render watchers fire with correct values.
          const rowScope = transcludedScope as unknown as Record<string, unknown>;
          rowScope[parsed.valueIdent] = entry.value;
          if (parsed.keyIdent !== null) {
            rowScope[parsed.keyIdent] = entry.key;
          }
          updatePerRowLocals(transcludedScope, i, totalCount);

          placeholder.parentNode?.insertBefore(cloneRoot, anchor.nextSibling);
          anchor = cloneRoot;

          nextRows.set(key, {
            scope: transcludedScope,
            cloneRoot,
            index: i,
            value: entry.value,
            key: entry.key,
          });
        });
      }

      // Tear down identities that disappeared. `previousRows` holds
      // only the unreused entries. Same order as `tearDownAllRows`.
      for (const entry of previousRows.values()) {
        entry.scope.$destroy();
        entry.cloneRoot.remove();
      }

      currentRows = nextRows;
    }

    // Collection watcher. Wrap reconcile in try/catch so a
    // duplicate-key throw routes via `'$compile'` (NOT the digest's
    // `'watchListener'` path) and any partial state is cleared first.
    scope.$watchCollection(parsed.collectionExpr, (newCollection) => {
      try {
        reconcile(newCollection);
      } catch (err: unknown) {
        tearDownAllRows();
        invokeExceptionHandler($exceptionHandler, err, '$compile');
      }
    });

    // Placeholder cleanup — parent `destroyElementScope` reaching the
    // Comment cascades teardown to every active row. `addElementCleanup`
    // accepts `Element | Comment` directly (spec 027 Slice 2).
    addElementCleanup(placeholder, () => {
      tearDownAllRows();
    });

    // Scope-destroy path covers "parent scope destroyed without DOM
    // teardown". Both paths converge on the idempotent helper.
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
