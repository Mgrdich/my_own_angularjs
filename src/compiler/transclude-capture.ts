/**
 * Transclusion capture — extracts a directive host element's children
 * into private slot buckets at compile time (spec 018 Slices 3 + 4 /
 * technical-considerations §2.2).
 *
 * Two routing modes are supported:
 *
 * 1. `{ kind: 'content' }` (Slice 3) — every child node (Element, Text,
 *    Comment) of the host is detached from the live DOM in document
 *    order and pushed into the `defaultBucket`.
 * 2. `{ kind: 'slots' }` (Slice 4) — each direct Element child is
 *    matched against the declared slot selectors via
 *    `directiveNormalize(tagName)`. Matched children go into the named
 *    slot bucket; unmatched children, text nodes, and comments go into
 *    the `defaultBucket`. After the walk, slots whose buckets are
 *    still empty are classified as `unfilledRequired` (no `?` prefix
 *    at registration) or `unfilledOptional` (had `?` prefix). The
 *    bucket map only carries keys for FILLED named slots — unfilled
 *    slots are absent from `slotBuckets`, and the caller reads the
 *    unfilled sets to drive error reporting (required) or fallback
 *    paths (optional).
 *
 * Capture is DESTRUCTIVE — after `captureChildren(host, transclude)`
 * returns, `host.childNodes.length === 0` per FS §2.2 acceptance #1.
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
}

/**
 * Drain every child node of `host` into a private slot map.
 *
 * For `{ kind: 'content' }`, every child node goes into
 * `defaultBucket` in document order. Element, Text, and Comment
 * children are all captured — see FS §2.2 acceptance.
 *
 * For `{ kind: 'slots' }`, each direct Element child is routed by
 * normalized tag name; non-matching children and all non-Element nodes
 * fall through into the default bucket (FS §2.3 acceptance).
 */
export function captureChildren(host: Element, transclude: NormalizedTransclude): CapturedBuckets {
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
