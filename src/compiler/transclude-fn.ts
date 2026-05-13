/**
 * `buildTranscludeFn` — factory for the `$transclude` closure handed
 * to a transcluding directive's compile and link functions
 * (spec 018 Slice 3 / technical-considerations §2.4).
 *
 * Each invocation of the returned `TranscludeFn`:
 *
 * 1. Resolves the target linker — default slot when `slotName` is
 *    null / undefined / empty; named slot otherwise. Named-slot
 *    resolution is short-circuited in Slice 3 (the only path that
 *    fires for `kind: 'content'` is the undeclared-slot error case,
 *    used by the `ng-transclude` marker in Slice 5; real named-slot
 *    routing lands in Slice 4).
 * 2. Creates a fresh transclusion scope as `outerScope.$new()` — FS
 *    §2.5 acceptance #1 ("`$parent === outer`"). Each call gets its
 *    OWN scope so multi-clone produces independent state.
 * 3. Registers `() => transclusionScope.$destroy()` against the host
 *    element's `$$ngCleanupQueue` via `addElementCleanup` — FS §2.8
 *    acceptance #1.
 * 4. Deep-clones every master node via `Node.cloneNode(true)`. The
 *    master is never mutated, so two sequential `$transclude(...)`
 *    calls produce two independent clones (FS §2.7).
 * 5. Invokes the bucket's compiled linker against the clone with a
 *    `Map<masterNode, cloneNode>` so per-node closures rebind to
 *    cloned counterparts (see `compile.ts`'s internal cloneMap
 *    indirection — public `Linker` type is unchanged).
 * 6. Invokes `cloneAttachFn?.(clonedNodes, transclusionScope)`
 *    synchronously, wrapped in a try/catch that routes via
 *    `invokeExceptionHandler(handler, err, '$compile')` (FS §2.4
 *    acceptance #11). The scope IS still created and registered for
 *    cleanup; the clone IS still returned to the call site.
 * 7. Returns the cloned top-level nodes.
 *
 * The factory only depends on PUBLIC types from `directive-types.ts`
 * plus the internal cloneMap-aware Linker call form documented in
 * `compile.ts`. No circular import with the compiler — the factory
 * receives its linker via the closure-built capture pipeline.
 */

import type { Scope } from '@core/index';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';

import { addElementCleanup } from './cleanup';
import { RequiredTranscludeSlotUnfilledError, UndeclaredTranscludeSlotError } from './compile-error';
import type { Linker } from './directive-types';
import type { CloneAttachFn, TranscludeFn, TranscludeSlotMap } from './transclude-types';

export interface BuildTranscludeFnArgs {
  defaultLinker: Linker | null;
  slotLinkers: Record<string, Linker | null>;
  declaredSlots: TranscludeSlotMap;
  unfilledRequired: Set<string>;
  outerScope: Scope;
  hostElement: Element;
  exceptionHandler: ExceptionHandler;
  masterFragments: { default: Node[]; named: Record<string, Node[]> };
  directiveName: string;
}

/**
 * Internal-only call shape — `compile.ts`'s `makeInternalLinker(...)`
 * returns a `Linker` whose runtime callable accepts an OPTIONAL
 * cloneMap. The PUBLIC `Linker` type stays `(scope) => …` so spec-017
 * callers don't see the widening; the transclusion path forwards
 * through this narrow internal contract.
 */
type LinkerWithCloneMap = (scope: Scope, cloneMap?: Map<Node, Node>) => unknown;

/**
 * Build the `$transclude` closure for a single transcluding host. The
 * closure captures the OUTER `parentScope` BEFORE the host's
 * `scope: true` child is created — FS §2.5 acceptance #1.
 */
export function buildTranscludeFn(args: BuildTranscludeFnArgs): TranscludeFn {
  const {
    defaultLinker,
    slotLinkers,
    declaredSlots,
    unfilledRequired,
    outerScope,
    hostElement,
    exceptionHandler,
    masterFragments,
    directiveName,
  } = args;

  return (cloneAttachFn?: CloneAttachFn, _futureParent?: Element | null, slotName?: string | null): Node[] => {
    // Resolve the target linker + master fragment for this call.
    const isDefaultSlot = slotName === undefined || slotName === null || slotName === '';
    let linker: Linker | null;
    let masters: Node[];

    if (isDefaultSlot) {
      linker = defaultLinker;
      masters = masterFragments.default;
    } else {
      // A `kind: 'content'` host (transclude: true) exposes only the
      // default slot — any non-empty `slotName` is undeclared.
      if (declaredSlots.length === 0) {
        invokeExceptionHandler(
          exceptionHandler,
          new UndeclaredTranscludeSlotError(directiveName, slotName),
          '$compile',
        );
        return [];
      }
      const slot = declaredSlots.find((s) => s.name === slotName);
      if (slot === undefined) {
        invokeExceptionHandler(
          exceptionHandler,
          new UndeclaredTranscludeSlotError(directiveName, slotName),
          '$compile',
        );
        return [];
      }
      // Required slot that the consumer left unfilled: report at the
      // call site too (the eager link-time report fires from
      // `compile.ts` regardless of whether `$transclude(...)` is ever
      // called for the slot — FS §2.9 acceptance #3). No transclusion
      // scope is created here; `cloneAttachFn` is NOT invoked.
      if (unfilledRequired.has(slot.name)) {
        invokeExceptionHandler(
          exceptionHandler,
          new RequiredTranscludeSlotUnfilledError(directiveName, slot.name, slot.selector),
          '$compile',
        );
        return [];
      }
      linker = slotLinkers[slot.name] ?? null;
      masters = masterFragments.named[slot.name] ?? [];
    }

    // Create a fresh transclusion scope and register it on the host
    // element's cleanup queue BEFORE invoking the linker or
    // `cloneAttachFn` — so a throw in either path still leaves a
    // destroy-able scope on the queue (FS §2.8 acceptance #3).
    const transclusionScope = outerScope.$new();
    addElementCleanup(hostElement, () => {
      transclusionScope.$destroy();
    });

    // Empty bucket: linker is null, masters is empty. Still invoke
    // `cloneAttachFn([], scope)` so the directive can render fallback
    // (the `ng-transclude` Slice-5 use case).
    if (linker === null || masters.length === 0) {
      if (cloneAttachFn !== undefined) {
        try {
          cloneAttachFn([], transclusionScope);
        } catch (err) {
          invokeExceptionHandler(exceptionHandler, err, '$compile');
        }
      }
      return [];
    }

    // Deep-clone every master node. `Node.cloneNode(true)` produces
    // a structurally identical subtree so the parallel cloneMap walk
    // in `compile.ts` finds every cloned counterpart by index.
    const clones: Node[] = masters.map((m) => m.cloneNode(true));
    const cloneMap = new Map<Node, Node>();
    for (let i = 0; i < masters.length; i++) {
      const master = masters[i];
      const clone = clones[i];
      if (master !== undefined && clone !== undefined) {
        cloneMap.set(master, clone);
      }
    }

    // Forward through the internal cloneMap-aware Linker call form.
    // The PUBLIC `Linker` type at `directive-types.ts` is
    // `(scope) => Element | NodeList | Comment`; the runtime callable
    // built by `makeInternalLinker(...)` in `compile.ts` accepts the
    // extra cloneMap argument and forwards it through the recursive
    // walker so per-node closures rebind to the clone.
    try {
      (linker as unknown as LinkerWithCloneMap)(transclusionScope, cloneMap);
    } catch (err) {
      invokeExceptionHandler(exceptionHandler, err, '$compile');
    }

    if (cloneAttachFn !== undefined) {
      try {
        cloneAttachFn(clones, transclusionScope);
      } catch (err) {
        invokeExceptionHandler(exceptionHandler, err, '$compile');
      }
    }

    return clones;
  };
}
