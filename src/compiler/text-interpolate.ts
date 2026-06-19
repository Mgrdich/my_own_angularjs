/**
 * Text-node interpolation — `{{ … }}` in element text content
 * (spec 031 Slice 1 / technical-considerations §2.1).
 *
 * Before spec 031 the `$compile` walker skipped `Text` nodes entirely —
 * they matched no directives, so `<h1>Hello {{name}}</h1>` rendered the
 * literal mustache forever. This module supplies the missing branch:
 * `compileNode` (in `compile.ts`) now dispatches every `Text` node to
 * `compileTextNode`, mirroring AngularJS's synthetic
 * `addTextInterpolateDirective`.
 *
 * **Static-text contract (no watch for static text).** The factory
 * calls `interpolate(text, true)` — the `true` is `mustHaveExpression`,
 * so a node whose text contains NO `{{ … }}` segment yields `undefined`
 * and we hand back a no-op linker. Pure-literal text therefore installs
 * ZERO watches and incurs zero per-digest cost: `<p>Just text</p>` is
 * left exactly as authored. Only nodes that actually contain an
 * expression pay for a watch.
 *
 * **Live binding.** When the text contains at least one expression,
 * `interpolate` returns an `InterpolateFn`. The returned linker installs
 * a single `scope.$watch(interpolateFn, …)` against the link-time scope;
 * the listener writes the rendered string to the text node's
 * `textContent` on first digest and on every subsequent change. The
 * surrounding literal characters (`Hello `, the comma in
 * `{{a}}, {{b}}`, trailing whitespace / newlines, …) are preserved
 * verbatim because `$interpolate` weaves them back into the rendered
 * output.
 *
 * **Empty / non-string values → `''`.** `null` / `undefined` (and any
 * other non-string) embedded expression renders as the empty string,
 * never the literal words `"undefined"` / `"null"`. This is inherited
 * from `$interpolate`'s `toInterpolationString` — the listener only
 * needs the defensive `typeof v === 'string' ? v : ''` guard (the
 * `oneTime` hold-back is the sole path that can yield `undefined` here,
 * which text interpolation does not use).
 *
 * **Transclusion (cloneMap indirection).** A transcluded clone (an
 * `ng-if` / `ng-repeat` row) deep-clones the master subtree, so the
 * master text node this linker closed over is NOT the node that ends up
 * in the DOM. The linker resolves the real target through the same
 * `cloneMap` indirection every element linker in `compile.ts` uses —
 * `cloneMap?.get(node) ?? node` — so each clone binds and updates ITS
 * OWN text node. The master fragment is never inserted.
 *
 * **Teardown.** No element-cleanup-queue entry is needed: the watch
 * lives on the linked scope and is torn down by normal `scope.$destroy()`
 * propagation. A transcluded clone's watch is torn down with the
 * clone's transclusion scope when the structural directive removes the
 * row.
 *
 * @example Live text binding
 * ```ts
 * const node = document.createTextNode('Hello {{name}}');
 * const link = compileTextNode(node, $interpolate);
 * scope.name = 'World';
 * link(scope); // installs the watch
 * scope.$digest();
 * node.textContent; // 'Hello World'
 * scope.name = 'Angular';
 * scope.$digest();
 * node.textContent; // 'Hello Angular'
 * ```
 *
 * @example Static text — no watch, untouched
 * ```ts
 * const node = document.createTextNode('Just text');
 * const link = compileTextNode(node, $interpolate);
 * link(scope); // no-op — no watch installed, node left as written
 * ```
 */

import type { Scope } from '@core/index';
import type { InterpolateService } from '@interpolate/interpolate-types';

/**
 * Internal walker linker contract (kept structurally identical to the
 * `NodeLinker` type in `compile.ts`). Re-declared here rather than
 * exported across the module boundary because it is a private compiler
 * implementation detail; `compile.ts` consumes the returned closure
 * directly.
 */
type TextNodeLinker = (scope: Scope, cloneMap?: Map<Node, Node>) => void;

const noop: TextNodeLinker = () => {
  /* intentionally empty — static text installs no watch */
};

/**
 * Compile a single `Text` node into a `NodeLinker`.
 *
 * Returns the no-op linker for static text (no expression → zero watch)
 * and a watch-installing linker for text containing `{{ … }}`.
 */
export function compileTextNode(node: Text, interpolate: InterpolateService): TextNodeLinker {
  // `Text.textContent` is typed `string` (never `null`) — no `?? ''`
  // guard needed (and ESLint flags the dead branch if one is added).
  const interpolateFn = interpolate(node.textContent, true);
  if (interpolateFn === undefined) {
    return noop;
  }
  return (scope, cloneMap): void => {
    // Resolve the actual target text node through the clone-substitution
    // map so transcluded clones bind their own node, not the master.
    const target = (cloneMap?.get(node) ?? node) as Text;
    scope.$watch(interpolateFn, (value) => {
      target.textContent = typeof value === 'string' ? value : '';
    });
  };
}
