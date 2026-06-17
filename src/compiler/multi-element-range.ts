/**
 * Multi-element (ranged) directive grouping — spec 033 Slice 1.
 *
 * AngularJS lets a directive apply across a RANGE of sibling elements
 * via paired `<name>-start` / `<name>-end` attributes: the directive
 * operates on the start element, the end element, and every node in
 * between as one group. This module owns the depth-aware forward scan
 * that turns a `-start` element into the inclusive node range.
 *
 * **Detection.** The `baseAttrName` is the NORMALIZED base directive name
 * (e.g. `ngRepeat`). An element opens a nested range when it carries an
 * attribute normalizing to `<base>Start`, and closes one when it carries
 * an attribute normalizing to `<base>End`. The same
 * {@link directiveNormalize} the collector uses recognizes the kebab /
 * `data-` / `x-` prefixed spellings (`ng-repeat-start`,
 * `data-ng-repeat-start`, …) uniformly.
 *
 * **Depth tracking.** The scan starts at depth 1 (the start element
 * itself opens the outermost range). Walking forward through
 * `nextSibling`, each element bearing `<base>Start` increments depth and
 * each bearing `<base>End` decrements it; the range terminates
 * (inclusively) at the sibling that brings depth back to zero. A single
 * element may carry BOTH `-start` and `-end` (a self-contained nested
 * range) — the increment runs before the decrement so net depth is
 * unchanged. The start element itself is never re-counted as opening a
 * nested range (it already accounts for the outermost depth-1 level).
 *
 * **All node types are collected.** Element, Text, and Comment nodes
 * between the endpoints are all included so spec-031 text interpolation
 * and authored comments inside the range survive cloning by Mode A's
 * element-transclude capture.
 *
 * **Unterminated contract.** If the forward scan exhausts the start
 * element's siblings before depth returns to zero, the result is the
 * discriminated `{ ok: false }` arm — the caller routes
 * {@link import('./compile-error').UnterminatedMultiElementDirectiveError}
 * via `$exceptionHandler('$compile')` and leaves the DOM untouched. The
 * helper itself NEVER throws and NEVER mutates the DOM, so a caller that
 * bails on the error arm has performed no partial work to undo.
 *
 * The module is pure-DOM — no scope, no injector, no exception handler.
 */

import { directiveNormalize } from './directive-normalize';
import { isElement } from './node-guards';

/**
 * Result of {@link collectMultiElementRange}. A discriminated union so
 * the caller routes the unterminated case explicitly rather than
 * sentinel-checking a magic value:
 *
 *  - `{ ok: true; nodes }` — the inclusive start→end node range, in
 *    document order, starting WITH the start element.
 *  - `{ ok: false; reason: 'unterminated' }` — the matching `<base>-end`
 *    was never found; the caller routes the error and leaves the DOM
 *    untouched.
 */
export type MultiElementRangeResult = { ok: true; nodes: Node[] } | { ok: false; reason: 'unterminated' };

/**
 * Does `element` carry an attribute whose normalized name equals
 * `target` (a normalized `<base>Start` / `<base>End` name)? Mirrors the
 * collector's per-attribute `directiveNormalize` pass so kebab /
 * `data-` / `x-` spellings all match.
 */
function hasNormalizedAttr(element: Element, target: string): boolean {
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes.item(i);
    if (attr === null) {
      continue;
    }
    if (directiveNormalize(attr.name) === target) {
      return true;
    }
  }
  return false;
}

/**
 * Walk forward from `startElement` collecting the inclusive ranged group
 * delimited by `<base>-start` / `<base>-end`. See the module TSDoc for
 * the depth-tracking and unterminated semantics.
 *
 * @param startElement - The element carrying `<base>-start` (the range's
 *   first node — always included in the result).
 * @param baseAttrName - The NORMALIZED base directive name (e.g.
 *   `ngRepeat`). Used to derive the `<base>Start` / `<base>End` marker
 *   names compared against each sibling's normalized attributes.
 * @returns The discriminated {@link MultiElementRangeResult}.
 *
 * @example
 * ```ts
 * // <tr ng-repeat-start="r in rows">…</tr>
 * //   <tr>… middle …</tr>
 * // <tr ng-repeat-end>…</tr>
 * const result = collectMultiElementRange(startTr, 'ngRepeat');
 * if (result.ok) {
 *   // result.nodes === [startTr, middleTr, endTr] (+ any text/comments between)
 * }
 * ```
 */
export function collectMultiElementRange(startElement: Element, baseAttrName: string): MultiElementRangeResult {
  const startMarker = `${baseAttrName}Start`;
  const endMarker = `${baseAttrName}End`;

  const nodes: Node[] = [startElement];

  // The start element opens the outermost range — depth begins at 1.
  let depth = 1;

  // If the start element ALSO carries `<base>-end` (a single-element
  // self-closed range), depth drops to zero immediately and the range is
  // just the start element. The start element's OWN `-start` is the
  // depth-1 level already counted above, so it is NOT re-counted here.
  if (hasNormalizedAttr(startElement, endMarker)) {
    depth -= 1;
  }
  if (depth === 0) {
    return { ok: true, nodes };
  }

  let cursor: Node | null = startElement.nextSibling;
  while (cursor !== null) {
    nodes.push(cursor);
    if (isElement(cursor)) {
      // Increment BEFORE decrement so an element carrying both markers
      // (a fully nested range on one element) nets to no depth change.
      if (hasNormalizedAttr(cursor, startMarker)) {
        depth += 1;
      }
      if (hasNormalizedAttr(cursor, endMarker)) {
        depth -= 1;
        if (depth === 0) {
          return { ok: true, nodes };
        }
      }
    }
    cursor = cursor.nextSibling;
  }

  // Siblings exhausted with depth still above zero — no matching end.
  return { ok: false, reason: 'unterminated' };
}
