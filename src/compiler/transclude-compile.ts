/**
 * Transclusion compile — drives the captured master fragments through
 * the recursive `$compile` walker exactly once (spec 018 Slice 3 /
 * technical-considerations §2.2 step 4).
 *
 * The compile pre-pass in `compile.ts` calls this module with a
 * `compileNodes` callback — typically `(nodes) => compileService(nodes)`
 * — that defers back to the top-level `CompileService` entry. This
 * indirection keeps `transclude-compile.ts` free of the cyclic import
 * that a direct call into `compile.ts` would create.
 *
 * Each bucket is compiled exactly once. Empty buckets yield `null`, a
 * sentinel that `$transclude` interprets as "nothing to project" —
 * the call still creates a transclusion scope (FS §2.4 acceptance #7)
 * and still invokes `cloneAttachFn([], scope)`, but the per-call deep
 * clone + linker invocation is skipped.
 *
 * Slice 3 ships ONLY the default-bucket path. Slice 4 extends this
 * module to compile each named-slot bucket; the `slotLinkers` map
 * stays empty for now and the integration site only forwards the
 * default bucket.
 */

import type { Linker } from './directive-types';

export interface CompiledBuckets {
  defaultLinker: Linker | null;
  slotLinkers: Record<string, Linker | null>;
}

/**
 * Compile each captured bucket via the supplied `compileNodes`
 * callback. Empty buckets short-circuit to `null` so the caller can
 * tell "nothing to project" apart from "linker exists but produces
 * no DOM".
 *
 * @param buckets - The capture pipeline's bucket output.
 * @param compileNodes - Recursive entry into the top-level `$compile`
 *   service. Returns a `Linker` (which itself accepts a `Scope` and
 *   returns the input nodes) or `null` if the bucket was empty.
 */
export function compileBuckets(
  buckets: { defaultBucket: Node[]; slotBuckets: Record<string, Node[]> },
  compileNodes: (nodes: Node[]) => Linker | null,
): CompiledBuckets {
  const defaultLinker = buckets.defaultBucket.length > 0 ? compileNodes(buckets.defaultBucket) : null;

  const slotLinkers: Record<string, Linker | null> = {};
  for (const [slotName, bucket] of Object.entries(buckets.slotBuckets)) {
    slotLinkers[slotName] = bucket.length > 0 ? compileNodes(bucket) : null;
  }

  return { defaultLinker, slotLinkers };
}
