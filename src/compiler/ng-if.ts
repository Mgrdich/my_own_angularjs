/**
 * `ngIf` — conditional rendering (spec 027 Slice 3 / FS §2.1,
 * technical-considerations §2.2).
 *
 * `<div ng-if="expr">…</div>` renders its contents in the DOM only
 * while `expr` is truthy. When `expr` flips from falsy → truthy the
 * directive mounts a fresh deep clone of its host element against a
 * fresh transclusion scope; when `expr` flips from truthy → falsy the
 * clone is removed from the live DOM and its scope is destroyed
 * (watchers stop firing, `$on('$destroy', …)` listeners run).
 *
 * **DDO shape and registration.** `restrict: 'A'`, `priority: 600`,
 * `terminal: true`, `transclude: 'element'`. The Slice 2 foundation
 * (`transclude: 'element'`) is what makes this directive possible —
 * at compile time the host element is detached and replaced in-place
 * by a `<!-- ngIf: cond -->` Comment placeholder; the matched
 * directive's `link` fn receives the placeholder Comment as its
 * `element` argument and a callable `$transclude` as its 5th argument.
 * The default-bucket linker (spec 018) handles deep-clone + re-link
 * for each `$transclude(...)` call.
 *
 * **Position preservation via `nextSibling` insertion.** Each truthy
 * transition inserts the freshly linked clone via
 * `element.parentNode.insertBefore(clone, element.nextSibling)` so
 * the clone always lands IMMEDIATELY AFTER the placeholder Comment in
 * the parent's `childNodes`. The placeholder itself never moves — it
 * permanently occupies the slot the original host element used to
 * occupy, so the rendered subtree's position relative to its
 * siblings is preserved across any number of falsy → truthy
 * retoggles. This is the FS §2.1 acceptance criterion: "the position
 * where the rendered subtree appears is preserved across toggles".
 *
 * **Fresh-scope-per-truthy-transition contract.** Each falsy → truthy
 * transition produces a brand-new transclusion scope (the `$transclude`
 * call yields a fresh `transcludedScope` per invocation per the
 * spec-018 multi-clone contract). Each truthy → falsy transition
 * explicitly destroys the active clone's transclusion scope via
 * `cloneScope.$destroy()` BEFORE removing the clone from the DOM —
 * this fires `$on('$destroy', …)` listeners and tears the scope sub-
 * tree down deterministically, independent of the parent-scope
 * teardown propagation path. The follow-up
 * {@link import('./cleanup').destroyElementScope} call clears any
 * per-element-scope state attached via the cleanup queue (idempotent
 * — the transclusion scope is registered on the placeholder's queue,
 * not the clone root, so this walk finds no `$$ngScope` slot on the
 * clone root itself). Any state on the previous scope (input values,
 * scope properties set by child directives, `$on(…)` listeners) is
 * GONE before the next mount begins. The new mount starts from
 * scratch. This is the FS §2.1 acceptance criterion: "a fresh copy of
 * the subtree is rendered with a fresh child scope". Order matters:
 * destroy the scope BEFORE removing from the DOM so any cleanup
 * listeners that read DOM state can still do so.
 *
 * **Why `terminal: true` but no walker narrowing.** The same-element
 * terminal cutoff (the spec-017 directive-collector rule) is what
 * stops lower-priority sibling directives on the same host element
 * from running once `ngIf` is matched. The walker-narrowing hook
 * (gated on `directive.name === 'ngNonBindable'` in `compile.ts`'s
 * `compileElementOrComment`) is NOT needed for `ngIf` because the
 * host has ALREADY been removed from the DOM by the
 * `transclude: 'element'` capture pass — the outer walker has no
 * children to descend into, so there is no narrowing decision to
 * make. The terminal flag's only role here is the same-element
 * cutoff.
 *
 * **Cleanup contract via `addElementCleanup`.** Each truthy
 * transition registers a cleanup callback against the placeholder
 * Comment via
 * {@link import('./cleanup').addElementCleanup}(placeholder, …)`. The
 * callback closes over the closure-local `clonedRoot` so a parent
 * `destroyElementScope` reaching the placeholder still tears the
 * currently-active clone down even though the placeholder is a
 * Comment node with no `children` HTMLCollection for
 * `destroyElementScope` to walk. The Slice 2 widening of
 * `addElementCleanup` accepts `Element | Comment` directly — no cast
 * needed.
 *
 * **Errors.** None new. A throwing `$watch` listener routes via the
 * digest's existing `'watchListener'` cause; `$transclude` errors
 * route via the existing `'$compile'` cause through the spec-018
 * transclusion runtime. `EXCEPTION_HANDLER_CAUSES` stays at 10.
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject` — this
 * is the canonical shape used by every other built-in directive on
 * `ngModule`.
 *
 * @example
 * ```html
 * <div ng-if="user">
 *   Welcome, {{ user.name }}.
 * </div>
 * <!-- With scope.user = null: the host is detached at compile time,
 *      replaced by a <!-- ngIf: user --> Comment placeholder, and no
 *      clone is inserted (the watch listener sees falsy + no current
 *      clone, no-op).
 *      With scope.user = { name: 'Alice' }: a fresh deep clone of the
 *      host is mounted as the next sibling of the placeholder, linked
 *      against a fresh transclusion scope, and the binding inside
 *      renders 'Welcome, Alice.'.
 *      Flipping user back to null destroys that scope, removes the
 *      clone from the DOM, and clears both refs. -->
 * ```
 *
 * @example Position preservation across toggles
 * ```html
 * <ul>
 *   <li>First</li>
 *   <li ng-if="show">Middle</li>
 *   <li>Last</li>
 * </ul>
 * <!-- After compile:
 *      <ul>
 *        <li>First</li>
 *        <!-- ngIf: show -->
 *        <li>Last</li>
 *      </ul>
 *      With show = true the Middle <li> mounts BETWEEN the placeholder
 *      and the Last <li>. Flipping show to false detaches the Middle <li>
 *      and leaves the placeholder + Last <li> in place. Flipping back
 *      to true mounts a fresh Middle <li> at the same position. -->
 * ```
 */

import type { Scope } from '@core/index';

import { addElementCleanup, destroyElementScope } from './cleanup';
import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

/**
 * Normalized directive name — registration in `src/core/ng-module.ts`
 * and the `attrs[NG_IF_NAME]` lookup in this file are tied together
 * via this constant so a rename touches both at once. Module-private:
 * only the registration import in `ng-module.ts` consumes the
 * re-export.
 */
export const NG_IF_NAME = 'ngIf';

function ngIfFactory(): DirectiveFactoryReturn {
  // The `element` argument is typed as `Element` on the public LinkFn
  // signature; for a `transclude: 'element'` directive the runtime
  // value is the Comment placeholder installed by the Slice 2
  // foundation. Both `Element` and `Comment` carry the `parentNode` /
  // `nextSibling` / `remove()` surface this link function consumes,
  // so the cast through `unknown` keeps the runtime contract
  // observable without a `// @ts-expect-error`. The `addElementCleanup`
  // signature is already widened to `Element | Comment` per Slice 2,
  // so its call site needs no cast.
  const link: LinkFn = (_scope, element, attrs, _ctrls, $transclude) => {
    // The placeholder Comment is `element` for the entire lifetime of
    // this link invocation; the host element it replaced is the
    // master fragment that `$transclude` clones on every call.
    const placeholder = element as unknown as Comment;
    const scope = _scope;

    let clonedRoot: Element | null = null;
    let cloneScope: Scope | null = null;

    const expr = attrs[NG_IF_NAME];
    if (typeof expr !== 'string') {
      // Defensive — `attrs['ngIf']` is typed as `string | undefined`
      // through the index signature. If the attribute is missing
      // entirely the directive shouldn't have matched, but bail
      // cleanly rather than passing `undefined` into `$watch`.
      // Matches the spec 023 / 024 / 025 / 026 defensive pattern.
      return;
    }

    if ($transclude === undefined) {
      // Defensive — `$transclude` is the 5th argument and is
      // populated only when the directive declares `transclude` on
      // its DDO. The DDO below sets `transclude: 'element'`, so the
      // compiler always wires this argument in practice; the guard
      // exists so a hypothetical future seam change cannot silently
      // null-deref the closure below.
      return;
    }

    scope.$watch(expr, (newValue: unknown) => {
      if (newValue) {
        if (clonedRoot === null) {
          // Falsy → truthy transition: mount a fresh deep clone of the
          // host against a fresh transclusion scope. The default-bucket
          // linker (spec 018) handles the deep clone + re-link on each
          // `$transclude(...)` invocation, so calling `$transclude`
          // here ALWAYS produces a brand-new clone with a brand-new
          // scope — the fresh-mount semantic falls out for free.
          $transclude((clone, transcludedScope) => {
            // `clone` is the array of cloned top-level nodes. For
            // element-form transclusion the default bucket is the
            // detached host itself (a single-element array), so
            // `clone[0]` is the cloned host Element.
            const head = clone[0];
            if (head === undefined) {
              // Defensive — the element-form default bucket is
              // `[host]`, so `clone[0]` is always defined in practice.
              // Bail cleanly rather than insert nothing and stash a
              // null `clonedRoot` (which would block future toggles).
              return;
            }
            clonedRoot = head as Element;
            cloneScope = transcludedScope;
            // Position preservation: insert the clone as the next
            // sibling of the placeholder. `insertBefore(node, null)`
            // is the canonical "append at end" shape but here
            // `placeholder.nextSibling` may legitimately be `null`
            // when the placeholder is the LAST child of its parent —
            // in that case `insertBefore(clone, null)` correctly
            // appends to the end of the parent's children.
            placeholder.parentNode?.insertBefore(clonedRoot, placeholder.nextSibling);
            // Register the cleanup callback so a parent
            // `destroyElementScope` reaching the placeholder still
            // tears the active clone down — Comment nodes have no
            // `children` HTMLCollection for `destroyElementScope` to
            // walk, so this is the directive-author's responsibility
            // (per the Slice 2 cleanup-wiring documentation in
            // `transclude-capture.ts`'s TSDoc). The callback closes
            // over `clonedRoot` so it always tears down the
            // CURRENTLY-ACTIVE clone (not whatever was active when
            // this $transclude call ran).
            addElementCleanup(placeholder, () => {
              if (clonedRoot !== null) {
                destroyElementScope(clonedRoot);
              }
            });
          });
        }
        // Truthy → truthy: no-op. The previous clone stays mounted
        // against its existing scope; `$watch`'s identity short-
        // circuit means this branch is rarely reached anyway.
        return;
      }

      if (clonedRoot !== null) {
        // Truthy → falsy transition: destroy the transclusion scope
        // explicitly via `cloneScope.$destroy()` BEFORE removing the
        // clone from the DOM. This fires `$on('$destroy', …)`
        // listeners and tears the scope sub-tree down deterministically
        // — without this call the transclusion scope (registered on
        // the PLACEHOLDER's cleanup queue by `buildTranscludeFn`, not
        // on the clone root) would only be torn down when the OUTER
        // scope is destroyed, leaking watchers in the meantime. The
        // follow-up {@link destroyElementScope} call clears any
        // per-element-scope state attached to the clone root itself
        // (idempotent — safe to call even when there is none). The
        // null-guard on `cloneScope` matches the closure-init contract:
        // it is populated synchronously inside the `$transclude`
        // callback at the same instant as `clonedRoot`, so when
        // `clonedRoot !== null` `cloneScope` is also non-null, but the
        // optional-chain keeps the strict null-check happy without an
        // assertion.
        cloneScope?.$destroy();
        destroyElementScope(clonedRoot);
        clonedRoot.remove();
        clonedRoot = null;
        cloneScope = null;
      }
      // Falsy → falsy: no-op. Same identity-short-circuit
      // observation — `$watch` rarely re-fires this branch.
    });
  };

  return {
    restrict: 'A',
    priority: 600,
    terminal: true,
    transclude: 'element',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngIf', ngIfDirective)`. Zero
 * dependencies — the `annotate` helper rejects bare functions, so
 * the factory is wrapped in the canonical array form even though
 * its dependency list is empty.
 */
export const ngIfDirective: DirectiveFactory = [ngIfFactory];
