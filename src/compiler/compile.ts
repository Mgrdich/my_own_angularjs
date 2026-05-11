/**
 * `createCompile` — pure ESM factory for the `$compile` tree walker.
 *
 * After Slice 3 of spec 017 the walker locks the full three-phase
 * lifecycle on every `Element`:
 *
 * 1. **Compile phase** (priority-DESCENDING) — for each matched
 *    directive, invoke `directive.compile(element, attrs)`. The
 *    return value classifies the directive's link contribution:
 *    `void` → no link; `function` → post-link only; `{ pre, post }` →
 *    pre and/or post link as specified. The compile loop runs BEFORE
 *    the walker descends into children, so element mutations made
 *    during compile (e.g. `el.setAttribute(...)`) are visible to
 *    child compilation.
 * 2. **Pre-link phase** (priority-DESCENDING) — runs top-down across
 *    the tree; a node's pre-links fire BEFORE its children link.
 * 3. **Post-link phase** (priority-ASCENDING) — runs bottom-up across
 *    the tree; a node's children all link before the node's
 *    post-links fire (FS §2.10 — "lower priority first, higher
 *    priority last").
 *
 * **Spec 018 / Slice 3 — Transclusion integration.** Before the
 * compile loop runs on an element, a pre-pass scans the matched
 * directive list for entries declaring `transclude: true | { … }`. If
 * a match is found, the host element's children are captured into a
 * private master fragment (`transclude-capture.ts`), compiled exactly
 * once via a recursive self-call (`transclude-compile.ts`), and a
 * `$transclude` closure is built inside the per-element linker that
 * captures the OUTER `parentScope` BEFORE the `scope: true` `$new()`
 * call. The closure is then threaded into every directive's compile
 * (3rd arg) and link (5th arg) calls on THIS element, and stashed on
 * the host's non-enumerable `$$ngBoundTransclude` slot for the future
 * `ng-transclude` marker (Slice 5) to consume.
 *
 * For transcluding hosts the compile loop is deferred from
 * template-build time to LINK time so each directive's compile fn
 * receives the same `$transclude` closure as the link fn — FS §2.4
 * acceptance #11 ("3rd compile arg === 5th link arg"). Non-transcluding
 * hosts continue to run compile at template-build time exactly as
 * before — no behavioral change.
 *
 * **Internal clone-substitution.** To support multi-clone, each
 * `$transclude(...)` call deep-clones the master fragment and re-runs
 * the compiled linker against the clone with a FRESH transclusion
 * scope. The recursive walker is widened with an OPTIONAL
 * `cloneMap?: Map<Node, Node>` parameter threaded through every
 * `NodeLinker`. When a per-node closure runs, it resolves
 * `target = cloneMap?.get(node) ?? node` so its directives fire
 * against the cloned counterpart rather than the master. The parallel
 * walk extends the map as it descends — `cloneTarget.childNodes[i]`
 * pairs with `masterNode.childNodes[i]` index-by-index. The PUBLIC
 * `Linker` type is unchanged; the cloneMap parameter is internal-only
 * and forwarded exclusively from `transclude-fn.ts`.
 *
 * - `NodeList` and array-of-`Node` inputs walk each top-level entry
 *   and return a composite linker that links them all.
 * - **Slice 7:** `Comment` nodes are walked through the same matching
 *   pipeline — the comment-text parser recognizes the canonical
 *   `<!-- directive: name value -->` syntax and matches directives
 *   whose `restrict` includes `'M'`.
 * - When walking an `Element`'s children the walker enumerates
 *   `childNodes` (filtered to elements + comments). `Text` nodes are
 *   skipped — they match no directives.
 *
 * The factory ALSO accepts `injector`, `interpolate`, and
 * `exceptionHandler` collaborators (see spec 017 Slices 9 / 10 / 11).
 */

import type { Scope } from '@core/index';
import { invokeExceptionHandler } from '@exception-handler/index';

import { bindAttrsToScope } from './attributes';
import { setElementScope } from './cleanup';
import { MultipleTranscludeDirectivesError, RequiredTranscludeSlotUnfilledError } from './compile-error';
import { collectDirectives } from './directive-collector';
import type { CompileOptions, CompileService, Directive, Linker, LinkFn, Attributes } from './directive-types';
import { captureChildren } from './transclude-capture';
import { compileBuckets } from './transclude-compile';
import { buildTranscludeFn } from './transclude-fn';
import type { BoundTranscludeFn, NormalizedTransclude, TranscludeFn, TranscludeSlotMap } from './transclude-types';

type LinkEntry = {
  pre?: LinkFn;
  post?: LinkFn;
};

/**
 * The internal walker contract. Per-node linker closures capture the
 * master `node` in scope; when invoked with a `cloneMap`, they resolve
 * `target = cloneMap.get(node) ?? node` and operate on the cloned
 * counterpart instead. The map is extended in parallel as the walker
 * descends so descendants find their own clones.
 */
type NodeLinker = (scope: Scope, cloneMap?: Map<Node, Node>) => void;

const BOUND_TRANSCLUDE_SLOT = '$$ngBoundTransclude';

/**
 * Build a `$compile` service bound to the supplied collaborators.
 *
 * @example
 * ```ts
 * const compile = createCompile({
 *   getDirectivesByName: (name) => directiveRegistry[name] ?? [],
 *   injector,
 *   interpolate,
 *   exceptionHandler,
 * });
 * compile(element)(scope);
 * ```
 */
export function createCompile(options: CompileOptions): CompileService {
  const { getDirectivesByName, interpolate, exceptionHandler } = options;

  function compileNode(node: Node): NodeLinker {
    if (isElement(node)) {
      return compileElementOrComment(node, /* hasChildren */ true);
    }
    if (isComment(node)) {
      return compileElementOrComment(node, /* hasChildren */ false);
    }
    return noopLinker;
  }

  function compileNodes(nodes: readonly Node[]): NodeLinker {
    const linkers = nodes.map((n) => compileNode(n));
    return (scope, cloneMap): void => {
      for (let i = 0; i < linkers.length; i++) {
        const linker = linkers[i];
        if (linker !== undefined) {
          linker(scope, cloneMap);
        }
      }
    };
  }

  /**
   * Internal Linker entry — same recursive walker as the public entry
   * but with a `cloneMap` slot exposed for the transclusion path.
   * Used by the capture pipeline's `compileBuckets(...)` callback so
   * each captured bucket compiles exactly once and is re-linked per
   * `$transclude(...)` invocation against a deep-cloned counterpart.
   */
  function makeInternalLinker(nodes: readonly Node[]): Linker {
    const linker = compileNodes(nodes);
    return ((scope: Scope, cloneMap?: Map<Node, Node>) => {
      linker(scope, cloneMap);
      return nodes as unknown as NodeList;
    }) as Linker;
  }

  function compileElementOrComment(node: Element | Comment, hasChildren: boolean): NodeLinker {
    const { directives, attrs } = collectDirectives(node, getDirectivesByName);

    // Slice 10 — `scope: true` detection (FS §2.12). Decide ONCE at
    // compile time whether THIS node needs its own child scope.
    const needsChildScope = isElement(node) && directives.some((d) => d.scope);

    // ----- Spec 018 / Slice 3: transclusion pre-pass -----
    //
    // Scan the priority-sorted directive list for entries declaring
    // `transclude`. The FIRST match wins; any second match is reported
    // via `MultipleTranscludeDirectivesError` and its `transclude` is
    // cleared on a LOCAL shallow copy (the shared registered directive
    // object is NOT mutated).
    let transcludingDirective: Directive | null = null;
    const effectiveDirectives: Directive[] = [];
    for (const directive of directives) {
      if (directive.transclude !== undefined) {
        if (transcludingDirective === null) {
          transcludingDirective = directive;
          effectiveDirectives.push(directive);
          continue;
        }
        invokeExceptionHandler(
          exceptionHandler,
          new MultipleTranscludeDirectivesError(transcludingDirective.name, directive.name),
          '$compile',
        );
        const stripped: Directive = { ...directive, transclude: undefined };
        effectiveDirectives.push(stripped);
        continue;
      }
      effectiveDirectives.push(directive);
    }

    // Capture children + compile master fragments when a transcluding
    // directive matched. Both `kind: 'content'` (Slice 3) and
    // `kind: 'slots'` (Slice 4) flow through the same pipeline.
    let defaultLinker: Linker | null = null;
    let slotLinkers: Record<string, Linker | null> = {};
    let transcludeDecl: NormalizedTransclude | null = null;
    let transcludeMasters: Node[] = [];
    let transcludeNamedMasters: Record<string, Node[]> = {};
    let transcludeUnfilledRequired: string[] = [];
    if (transcludingDirective !== null && transcludingDirective.transclude !== undefined && isElement(node)) {
      transcludeDecl = transcludingDirective.transclude;
      const buckets = captureChildren(node, transcludeDecl);
      const compiled = compileBuckets(
        { defaultBucket: buckets.defaultBucket, slotBuckets: buckets.slotBuckets },
        (nodes) => makeInternalLinker(nodes),
      );
      defaultLinker = compiled.defaultLinker;
      slotLinkers = compiled.slotLinkers;
      transcludeMasters = buckets.defaultBucket;
      transcludeNamedMasters = buckets.slotBuckets;
      transcludeUnfilledRequired = buckets.unfilledRequired;
    }

    // Compile phase — for non-transcluding hosts only. Transcluding
    // hosts defer the loop to link time so each directive's compile
    // fn receives the link-time `$transclude` as its 3rd arg
    // (FS §2.4 acceptance #11).
    const deferCompileToLink = transcludingDirective !== null;
    const templateTimeLinkEntries: LinkEntry[] = [];
    if (!deferCompileToLink) {
      for (const directive of effectiveDirectives) {
        if (directive.compile === undefined) {
          continue;
        }
        let compileResult: ReturnType<NonNullable<typeof directive.compile>>;
        try {
          compileResult = directive.compile(node as Element, attrs);
        } catch (err) {
          invokeExceptionHandler(exceptionHandler, err, '$compile');
          continue;
        }
        if (compileResult === undefined) {
          continue;
        }
        if (typeof compileResult === 'function') {
          templateTimeLinkEntries.push({ post: compileResult });
        } else {
          templateTimeLinkEntries.push({
            pre: compileResult.pre,
            post: compileResult.post,
          });
        }
      }
    }

    // Snapshot children AFTER the compile loop runs. For transcluding
    // hosts the capture pass above already drained children, so the
    // snapshot is empty and `childLinker` becomes the noop linker —
    // FS §2.2 acceptance #5 ("captured children are NOT linked
    // against the directive element by the OUTER walker").
    const masterChildren: Node[] = [];
    let childLinker: NodeLinker = noopLinker;
    if (hasChildren) {
      const element = node as Element;
      for (let i = 0; i < element.childNodes.length; i++) {
        const child = element.childNodes.item(i);
        if (child.nodeType === 1 /* ELEMENT_NODE */ || child.nodeType === 8 /* COMMENT_NODE */) {
          masterChildren.push(child);
        }
      }
      childLinker = compileNodes(masterChildren);
    }

    return (parentScope, cloneMap): void => {
      // Resolve the live target — when called under a clone map,
      // operate on the cloned counterpart rather than the master.
      const target = cloneMap?.get(node) ?? node;

      // ----- Spec 018 / Slice 3: build $transclude closure -----
      //
      // The closure captures `parentScope` as the OUTER scope BEFORE
      // the `scope: true` child is created below — FS §2.5 acceptance
      // #1 requires `transcludedScope.$parent === outerScope`. The
      // host element receives a non-enumerable `$$ngBoundTransclude`
      // stash so the future `ng-transclude` marker (Slice 5) can find
      // it via parent-element walk.
      let $transclude: TranscludeFn | undefined;
      if (transcludingDirective !== null && transcludeDecl !== null && isElement(target)) {
        const declared: TranscludeSlotMap = transcludeDecl.kind === 'slots' ? transcludeDecl.slots : [];
        const unfilledRequiredSet = new Set<string>(transcludeUnfilledRequired);
        $transclude = buildTranscludeFn({
          defaultLinker,
          slotLinkers,
          declaredSlots: declared,
          unfilledRequired: unfilledRequiredSet,
          outerScope: parentScope,
          hostElement: target,
          exceptionHandler,
          masterFragments: { default: transcludeMasters, named: transcludeNamedMasters },
          directiveName: transcludingDirective.name,
        });
        const bound: BoundTranscludeFn = {
          fn: $transclude,
          declaredSlots: declared,
          kind: transcludeDecl.kind,
          directiveName: transcludingDirective.name,
        };
        Object.defineProperty(target, BOUND_TRANSCLUDE_SLOT, {
          value: bound,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }

      // Slice 10 — `scope: true` wiring (FS §2.12). Create the child
      // scope AFTER the `$transclude` closure is built so the closure
      // captures `parentScope` (the OUTER scope) rather than the
      // freshly-created child.
      const scope: Scope = needsChildScope ? parentScope.$new() : parentScope;
      if (needsChildScope && isElement(target)) {
        setElementScope(target, scope);
      }

      // ----- Spec 018 / Slice 3: link-phase compile loop for
      // transcluding hosts -----
      const liveLinkEntries: LinkEntry[] = [];
      if (deferCompileToLink) {
        for (const directive of effectiveDirectives) {
          if (directive.compile === undefined) {
            continue;
          }
          let compileResult: ReturnType<NonNullable<typeof directive.compile>>;
          try {
            compileResult = directive.compile(target as Element, attrs, $transclude);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
            continue;
          }
          if (compileResult === undefined) {
            continue;
          }
          if (typeof compileResult === 'function') {
            liveLinkEntries.push({ post: compileResult });
          } else {
            liveLinkEntries.push({
              pre: compileResult.pre,
              post: compileResult.post,
            });
          }
        }
      }

      const effectiveLinkEntries = deferCompileToLink ? liveLinkEntries : templateTimeLinkEntries;

      bindAttrsToScope(attrs, scope, interpolate, exceptionHandler);
      // Pre-link: priority-DESCENDING, runs BEFORE child linking.
      for (const entry of effectiveLinkEntries) {
        if (entry.pre !== undefined) {
          try {
            entry.pre(scope, target as Element, attrs as Attributes, undefined, $transclude);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
          }
        }
      }
      // Recurse into children. When a `cloneMap` is in play we extend
      // it in parallel with the child walk: each master child's
      // cloned counterpart is the corresponding child on `target`.
      let extendedCloneMap = cloneMap;
      if (cloneMap !== undefined && masterChildren.length > 0 && isElement(target)) {
        extendedCloneMap = pairChildren(masterChildren, target, cloneMap);
      }
      childLinker(scope, extendedCloneMap);
      // Post-link: priority-ASCENDING, runs AFTER child linking.
      for (const entry of effectiveLinkEntries.slice().reverse()) {
        if (entry.post !== undefined) {
          try {
            entry.post(scope, target as Element, attrs as Attributes, undefined, $transclude);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
          }
        }
      }

      // ----- Spec 018 / Slice 4: eager required-slot-unfilled report.
      //
      // After all pre/post link phases finish on the host, report any
      // required slot that had no matching child in the consumer
      // markup. The directive's link STILL ran (it may render skeleton
      // chrome). One report per unfilled required slot per host link
      // invocation. The error is ALSO routed at the `$transclude(...)`
      // call site if the unfilled required slot is later requested
      // (FS §2.9 acceptance #3 — both surfaces are documented).
      if (
        transcludingDirective !== null &&
        transcludeDecl !== null &&
        transcludeDecl.kind === 'slots' &&
        transcludeUnfilledRequired.length > 0
      ) {
        const directiveName = transcludingDirective.name;
        const slotList = transcludeDecl.slots;
        for (const slotName of transcludeUnfilledRequired) {
          const slot = slotList.find((s) => s.name === slotName);
          if (slot !== undefined) {
            invokeExceptionHandler(
              exceptionHandler,
              new RequiredTranscludeSlotUnfilledError(directiveName, slot.name, slot.selector),
              '$compile',
            );
          }
        }
      }
    };
  }

  return ((node: Element | NodeList | Comment): Linker => {
    if (isNodeList(node) || Array.isArray(node)) {
      const list = node as ArrayLike<Node>;
      const masters: Node[] = [];
      for (let i = 0; i < list.length; i++) {
        const child = list[i];
        if (child !== undefined) {
          masters.push(child);
        }
      }
      const linker = compileNodes(masters);
      return ((scope: Scope) => {
        linker(scope);
        return node;
      }) as Linker;
    }

    const linker = compileNode(node);
    return ((scope: Scope) => {
      linker(scope);
      return node;
    }) as Linker;
  }) as CompileService;
}

/**
 * Extend a clone-substitution map by pairing each master child with
 * the corresponding child on the (already-cloned) parent. The two
 * child lists are guaranteed structurally aligned because the parent
 * is a deep clone produced by `Node.cloneNode(true)`.
 *
 * The filter mirrors the live walker — only Element and Comment
 * children participate in the per-node linkers, so only those are
 * paired (Text nodes carry no directive matches and are skipped).
 */
function pairChildren(masters: readonly Node[], cloneParent: Element, parentMap: Map<Node, Node>): Map<Node, Node> {
  const cloneChildren: Node[] = [];
  for (let i = 0; i < cloneParent.childNodes.length; i++) {
    const child = cloneParent.childNodes.item(i);
    if (child.nodeType === 1 /* ELEMENT_NODE */ || child.nodeType === 8 /* COMMENT_NODE */) {
      cloneChildren.push(child);
    }
  }
  const extended = new Map(parentMap);
  for (let i = 0; i < masters.length; i++) {
    const masterChild = masters[i];
    const cloneChild = cloneChildren[i];
    if (masterChild !== undefined && cloneChild !== undefined) {
      extended.set(masterChild, cloneChild);
    }
  }
  return extended;
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1; // Node.ELEMENT_NODE
}

function isComment(node: Node): node is Comment {
  return node.nodeType === 8; // Node.COMMENT_NODE
}

function isNodeList(value: unknown): value is NodeList {
  return typeof NodeList !== 'undefined' && value instanceof NodeList;
}

const noopLinker: NodeLinker = () => {
  /* intentionally empty — text-and-other node types and empty children both reach this branch */
};
