/**
 * Transclusion capture — extracts a directive host element's children
 * into private slot buckets at compile time (spec 018 Slices 3 + 4 /
 * technical-considerations §2.2). Spec 027 Slice 2 widens the
 * capture surface with a third routing mode — `kind: 'element'` —
 * that captures the host element ITSELF (not its children) and leaves
 * a Comment placeholder in its slot.
 *
 * Three routing modes are supported:
 *
 * 1. `{ kind: 'content' }` (spec 018 Slice 3) — every child node
 *    (Element, Text, Comment) of the host is detached from the live
 *    DOM in document order and pushed into the `defaultBucket`. The
 *    host element itself stays in the DOM.
 * 2. `{ kind: 'slots' }` (spec 018 Slice 4) — each direct Element
 *    child is matched against the declared slot selectors via
 *    `directiveNormalize(tagName)`. Matched children go into the named
 *    slot bucket; unmatched children, text nodes, and comments go into
 *    the `defaultBucket`. The host element itself stays in the DOM.
 *    After the walk, slots whose buckets are still empty are
 *    classified as `unfilledRequired` (no `?` prefix at registration)
 *    or `unfilledOptional` (had `?` prefix). The bucket map only
 *    carries keys for FILLED named slots — unfilled slots are absent
 *    from `slotBuckets`, and the caller reads the unfilled sets to
 *    drive error reporting (required) or fallback paths (optional).
 * 3. `{ kind: 'element' }` (spec 027 Slice 2) — the host element
 *    ITSELF is detached from the live DOM and replaced in-place by a
 *    `<!-- directiveName: attrValue -->` Comment placeholder
 *    (AngularJS-canonical naming, useful in dev tools). The host is
 *    pushed into the `defaultBucket` as a single-element array; the
 *    existing default-bucket linker compiles it once and re-links a
 *    deep clone per `$transclude(...)` call. This is the FIRST
 *    capture mode that detaches the host element itself rather than
 *    its children, which is why the result also carries an optional
 *    `replacementNode` field — the per-element linker assembly in
 *    `compile.ts` reads it to rebind its local `node` reference to
 *    the placeholder so `$$ngBoundTransclude`, `$$ngCleanupQueue`,
 *    and the matched directive's link-time `element` argument all
 *    hang off the Comment rather than the detached host.
 *
 * Capture is DESTRUCTIVE — after `captureChildren(host, transclude, …)`
 * returns:
 *  - for `'content'` / `'slots'`: `host.childNodes.length === 0` per
 *    FS §2.2 acceptance #1, and `host` is still in the live DOM.
 *  - for `'element'`: `host.parentNode === null` (host is detached),
 *    and the returned `replacementNode` Comment occupies the host's
 *    former slot in the live DOM.
 *
 * The captured nodes preserve order, attributes, inline event
 * handlers, text-node whitespace, and comments exactly as authored
 * (no normalization at capture time).
 *
 * The module is pure-DOM — no scope, no injector, no exception
 * handler dependency.
 */

import { directiveNormalize } from './directive-normalize';
import { isElement } from './node-guards';
import type { NormalizedTransclude } from './transclude-types';

export interface CapturedBuckets {
  defaultBucket: Node[];
  slotBuckets: Record<string, Node[]>;
  unfilledRequired: string[];
  unfilledOptional: string[];
  /**
   * Set by the `kind: 'element'` branch (spec 027 Slice 2) to the
   * Comment placeholder that replaced the host element in the live
   * DOM. The `'content'` and `'slots'` branches return `undefined` —
   * they leave the host element in place. The per-element linker
   * assembly in `compile.ts` reads this slot to rebind its local
   * `node` reference to the placeholder.
   */
  replacementNode?: Comment;
}

/**
 * Drain every child node of `host` into a private slot map — or, for
 * `kind: 'element'`, detach the host itself and substitute a Comment
 * placeholder in its slot.
 *
 * For `{ kind: 'content' }`, every child node goes into
 * `defaultBucket` in document order. Element, Text, and Comment
 * children are all captured — see FS §2.2 acceptance.
 *
 * For `{ kind: 'slots' }`, each direct Element child is routed by
 * normalized tag name; non-matching children and all non-Element nodes
 * fall through into the default bucket (FS §2.3 acceptance).
 *
 * For `{ kind: 'element' }` (spec 027 Slice 2), the host element
 * itself is replaced by a `<!-- ${directiveName}: ${attrValue} -->`
 * Comment placeholder in the live DOM and pushed into the default
 * bucket as a single-element array. The placeholder is returned via
 * `replacementNode` so the caller can rebind its per-element linker
 * to it. The leading and trailing spaces in the comment text match
 * upstream AngularJS's `<!-- ngIf: cond -->` rendering convention.
 *
 * @param host - The host element. For `'element'`, MUST have a
 *   `parentNode` — caller is responsible for ensuring the host is
 *   attached before invoking with `kind: 'element'`.
 * @param transclude - The post-normalize transclude declaration.
 * @param directiveName - The matched directive's name (used to label
 *   the `'element'`-mode Comment placeholder). For `'content'` /
 *   `'slots'` the value is ignored.
 * @param attrValue - The corresponding attribute value (used to label
 *   the placeholder). For `'content'` / `'slots'` the value is
 *   ignored.
 */
export function captureChildren(
  host: Element,
  transclude: NormalizedTransclude,
  directiveName: string,
  attrValue: string,
): CapturedBuckets {
  if (transclude.kind === 'element') {
    const placeholder = host.ownerDocument.createComment(` ${directiveName}: ${attrValue} `);
    const parent = host.parentNode;
    if (parent !== null) {
      parent.insertBefore(placeholder, host);
      parent.removeChild(host);
    }
    return {
      defaultBucket: [host],
      slotBuckets: {},
      unfilledRequired: [],
      unfilledOptional: [],
      replacementNode: placeholder,
    };
  }

  if (transclude.kind === 'content') {
    const defaultBucket: Node[] = [];
    while (host.firstChild !== null) {
      const child = host.firstChild;
      host.removeChild(child);
      defaultBucket.push(child);
    }
    return {
      defaultBucket,
      slotBuckets: {},
      unfilledRequired: [],
      unfilledOptional: [],
    };
  }

  // `kind: 'slots'` — route by normalized tag name.
  const selectorToSlotName = new Map<string, string>();
  for (const slot of transclude.slots) {
    selectorToSlotName.set(slot.normalizedSelector, slot.name);
  }

  const defaultBucket: Node[] = [];
  const slotBuckets: Record<string, Node[]> = {};

  while (host.firstChild !== null) {
    const child = host.firstChild;
    host.removeChild(child);

    if (isElement(child)) {
      const tagName = child.tagName.toLowerCase();
      const normalized = directiveNormalize(tagName);
      const slotName = selectorToSlotName.get(normalized);
      if (slotName !== undefined) {
        const bucket = slotBuckets[slotName] ?? [];
        bucket.push(child);
        slotBuckets[slotName] = bucket;
        continue;
      }
    }
    defaultBucket.push(child);
  }

  const unfilledRequired: string[] = [];
  const unfilledOptional: string[] = [];
  for (const slot of transclude.slots) {
    const bucket = slotBuckets[slot.name];
    if (bucket === undefined || bucket.length === 0) {
      if (slot.required) {
        unfilledRequired.push(slot.name);
      } else {
        unfilledOptional.push(slot.name);
      }
    }
  }

  return {
    defaultBucket,
    slotBuckets,
    unfilledRequired,
    unfilledOptional,
  };
}
