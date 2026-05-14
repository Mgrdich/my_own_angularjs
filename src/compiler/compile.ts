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
 * **Spec 019 / Slice 6 — Async `templateUrl` deferred drain.** When
 * the per-element pre-pass detects a directive whose normalized
 * `template` has `kind: 'url-string' | 'url-fn'`, the URL is resolved
 * synchronously (function form is invoked once with `(node, attrs)`),
 * and a `DeferredTemplateEntry` is pushed onto a per-`$compile`-call
 * queue threaded through the walker's closure. The per-element linker
 * for the host captures `parentScope` into the entry at link time but
 * does NOT install the template or run the host directive's compile /
 * pre-link / post-link — those are deferred to template-install time.
 *
 * After the synchronous walker completes and the public `Linker` has
 * been returned to the caller, the top-level `$compile` entry schedules
 * `Promise.resolve().then(drainDeferredTemplateQueue)`. Each queued
 * entry resolves its `$templateRequest(url)` in parallel; on success,
 * the template installs as the host's children, the post-template
 * subtree compiles recursively, and the host's per-element linker is
 * built + invoked against the captured `outerScope`. Fetch failures
 * route via `$exceptionHandler('$compile')`; host-destroyed-before-
 * resolve entries are silently dropped (no error, no DOM mutation).
 *
 * The factory ALSO accepts `injector`, `interpolate`, and
 * `exceptionHandler` collaborators (see spec 017 Slices 9 / 10 / 11)
 * plus `templateRequest` (Slice 5 — wired ahead of the Slice 6 drain).
 */

import type { ControllerLocals } from '@controller/controller-types';
import type { Scope } from '@core/index';
import { invokeExceptionHandler } from '@exception-handler/index';

import { bindAttrsToScope } from './attributes';
import { addElementCleanup, setElementScope } from './cleanup';
import {
  MultipleTemplateDirectivesError,
  MultipleTranscludeDirectivesError,
  RequiredTranscludeSlotUnfilledError,
  TemplateFunctionReturnedNonStringError,
  TemplateUrlFunctionReturnedNonStringError,
} from './compile-error';
import { describeValue } from './describe-value';
import { collectDirectives } from './directive-collector';
import type { CompileOptions, CompileService, Directive, Linker, LinkFn, Attributes } from './directive-types';
import { parseTemplate } from './template-parse';
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
 * Internal per-`$compile`-call queue carrying the host element + URL +
 * pending directives for every `templateUrl`-declaring directive
 * encountered on the synchronous walk. Filled during the recursive
 * walker pass; drained in a microtask after the public `Linker` has
 * been returned to the caller (spec 019 Slice 6 / technical-
 * considerations §2.8).
 */
interface DeferredTemplateEntry {
  /** The host element whose children will be replaced by the fetched template. */
  element: Element;
  /** The URL string (already resolved — for `url-fn`, the function was invoked synchronously). */
  url: string;
  /** The shared `Attributes` instance for the host. */
  attrs: Attributes;
  /** The template-declaring directive's name (for error messages). */
  directiveName: string;
  /**
   * Matched directives for the host. The template-declaring directive
   * is INCLUDED so its own `compile` / `link` runs against the post-
   * template DOM (FS §2.8 acceptance #2). The runtime never re-reads
   * the `template` field on this list; the install has already happened
   * by the time `processDeferredEntry` walks the pending directives.
   */
  pendingDirectives: Directive[];
  /** Filled at link time by the per-element linker — the OUTER scope passed by the caller. */
  outerScope: Scope | undefined;
  /**
   * Set to `true` by an element-level cleanup callback (registered via
   * `addElementCleanup`) when the host is destroyed BEFORE the deferred
   * drain runs. The drain peeks this flag after the `await templateRequest`
   * resumes and silently drops the install if it's set.
   */
  cancelled: boolean;
}

/**
 * Element augmented with the framework-internal cleanup slots stashed
 * by `cleanup.ts` (spec 017 Slice 10). Used here to detect whether the
 * host has been destroyed between enqueue and template-resolve.
 */
interface NgManagedElement extends Element {
  $$ngScope?: Scope;
}

/**
 * A scope is "destroyed" when `$destroy()` sets `$$watchers = null`
 * (spec 002 / scope.ts:516). The deferred drain peeks this slot to
 * decide whether to install the template or silently drop the entry.
 */
interface ScopeWatchersSlot {
  $$watchers: unknown[] | null;
}

function isScopeDestroyed(scope: Scope | undefined): boolean {
  if (scope === undefined) {
    return false;
  }
  return (scope as unknown as ScopeWatchersSlot).$$watchers === null;
}

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
 *   templateRequest,
 * });
 * compile(element)(scope);
 * ```
 */
export function createCompile(options: CompileOptions): CompileService {
  const { getDirectivesByName, controller: $controller, interpolate, exceptionHandler, templateRequest } = options;

  /**
   * Per-element controller seam (spec 020 Slice 4). Runs ONCE per
   * directive on the element that declares `controller`, AFTER the
   * attrs-to-scope binding and the `$transclude` stash, BEFORE the
   * pre-link loop. Errors route via `$exceptionHandler('$compile')` —
   * no new `EXCEPTION_HANDLER_CAUSES` token; the surrounding link
   * passes on this element AND on siblings continue.
   *
   * Extracted to a small helper because both the transcluding-host
   * link path and the non-transcluding link path call it with the
   * same shape (the only difference is whether `$transclude` is
   * threaded into the locals). The helper is closed over `$controller`
   * + `exceptionHandler` so the call sites stay short.
   */
  function runControllerSeam(
    directives: readonly Directive[],
    scope: Scope,
    element: Element,
    attrs: Attributes,
    $transclude: TranscludeFn | undefined,
  ): void {
    for (const directive of directives) {
      if (directive.controller === undefined) {
        continue;
      }
      const locals: ControllerLocals = {
        $scope: scope,
        $element: element,
        $attrs: attrs,
      };
      if ($transclude !== undefined) {
        locals.$transclude = $transclude;
      }
      try {
        $controller(directive.controller, locals, directive.controllerAs);
      } catch (err) {
        invokeExceptionHandler(exceptionHandler, err, '$compile');
      }
    }
  }

  function compileNode(node: Node, queue: DeferredTemplateEntry[]): NodeLinker {
    if (isElement(node)) {
      return compileElementOrComment(node, /* hasChildren */ true, queue);
    }
    if (isComment(node)) {
      return compileElementOrComment(node, /* hasChildren */ false, queue);
    }
    return noopLinker;
  }

  function compileNodes(nodes: readonly Node[], queue: DeferredTemplateEntry[]): NodeLinker {
    const linkers = nodes.map((n) => compileNode(n, queue));
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
   *
   * Transclusion compiles synchronously at the OUTER walker's pass —
   * the master fragment is captured before the deferred-template
   * enqueue and its compiled linker is independent of the queue. We
   * therefore use a FRESH queue here; any `templateUrl` directive
   * inside transcluded content compiles + queues against that inner
   * queue, and the inner queue is drained on the same microtask via
   * the same top-level `$compile` schedule. Each `$transclude(...)`
   * clone re-runs the compiled linker against a deep-clone, and
   * cloned-counterpart `templateUrl` resolution flows through the
   * runtime walker just like the master pass did.
   */
  function makeInternalLinker(nodes: readonly Node[]): Linker {
    const localQueue: DeferredTemplateEntry[] = [];
    const linker = compileNodes(nodes, localQueue);
    return ((scope: Scope, cloneMap?: Map<Node, Node>) => {
      linker(scope, cloneMap);
      // Local queue entries inside transcluded content drain on the
      // same microtask as the outer `$compile` call. The drain helper
      // is independent of where the queue was allocated.
      if (localQueue.length > 0) {
        void Promise.resolve().then(() => {
          drainDeferredTemplateQueue(localQueue);
        });
      }
      return nodes as unknown as NodeList;
    }) as Linker;
  }

  function compileElementOrComment(
    node: Element | Comment,
    hasChildren: boolean,
    queue: DeferredTemplateEntry[],
  ): NodeLinker {
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

    // ----- Spec 019 / Slices 5 + 6: template install pre-pass -----
    //
    // Scan the priority-sorted directive list (post-transclude
    // accumulation) for entries whose normalized `template` field is
    // set. The FIRST template-declaring directive wins; any subsequent
    // match routes `MultipleTemplateDirectivesError` and its template
    // declaration is cleared on a LOCAL shallow copy (the registered
    // directive object is NOT mutated). The second directive's other
    // behavior (compile, link, transclude, scope) still runs.
    //
    // Four `kind` discriminants are handled:
    //
    //   - `inline-string` — install synchronously (Slice 5).
    //   - `inline-fn` — invoke once, validate, memoize, install (Slice 5).
    //   - `url-string` — enqueue a deferred install (Slice 6).
    //   - `url-fn` — invoke once to resolve URL, enqueue (Slice 6).
    //
    // Install runs AFTER transclude capture (so `$$ngBoundTransclude`
    // is already stashed and `<ng-transclude>` markers inside the
    // template will find it via the parent-element walk) and BEFORE the
    // per-directive compile loop and the child snapshot. For the URL
    // forms, the synchronous install path is skipped — the host stays
    // empty until the drain resolves; the host's per-directive compile
    // loop and pre/post link run inside `processEntry` after the
    // template installs.
    let pendingTemplateUrl: { url: string; directiveName: string; templateDirectiveIndex: number } | null = null;
    let multiTemplateFirstName: string | null = null;
    if (isElement(node)) {
      for (let i = 0; i < effectiveDirectives.length; i++) {
        const directive = effectiveDirectives[i];
        if (directive === undefined || directive.template === undefined) {
          continue;
        }
        // Multi-template guard — second match (and beyond) is rejected.
        if (multiTemplateFirstName !== null) {
          // Route the error at link time so the second directive's
          // other behavior still runs through the normal linker. We
          // stash the names on a queued routing here and emit at link
          // time (mirroring `MultipleTranscludeDirectivesError`). Clear
          // the template field on the LOCAL copy so further iterations
          // and downstream walker logic don't re-trigger.
          invokeExceptionHandler(
            exceptionHandler,
            new MultipleTemplateDirectivesError(multiTemplateFirstName, directive.name),
            '$compile',
          );
          const stripped: Directive = { ...directive, template: undefined };
          effectiveDirectives[i] = stripped;
          continue;
        }
        multiTemplateFirstName = directive.name;

        const tpl = directive.template;
        if (tpl.kind === 'inline-string' || tpl.kind === 'inline-fn') {
          let templateString: string | null = null;
          if (tpl.kind === 'inline-string') {
            templateString = tpl.value;
          } else {
            // `kind: 'inline-fn'` — invoke and validate.
            let fnReturn: unknown;
            try {
              fnReturn = tpl.value(node, attrs);
            } catch (err) {
              invokeExceptionHandler(exceptionHandler, err, '$compile');
              continue;
            }
            if (typeof fnReturn !== 'string') {
              invokeExceptionHandler(
                exceptionHandler,
                new TemplateFunctionReturnedNonStringError(directive.name, describeValue(fnReturn)),
                '$compile',
              );
              continue;
            }
            templateString = fnReturn;
            // Memoize the resolved template on a LOCAL shallow copy.
            const memoized: Directive = {
              ...directive,
              template: { kind: 'inline-string', value: fnReturn },
            };
            effectiveDirectives[i] = memoized;
          }
          // Install — clear existing children, append parsed template
          // nodes. Multi-root templates are supported via
          // `parseTemplate(...)`'s `<template>` element fragment.
          const parsedNodes = parseTemplate(templateString);
          while (node.firstChild !== null) {
            node.removeChild(node.firstChild);
          }
          for (const tplNode of parsedNodes) {
            node.appendChild(tplNode);
          }
        } else {
          // `kind: 'url-string' | 'url-fn'` — deferred install.
          let url: string | null = null;
          if (tpl.kind === 'url-string') {
            url = tpl.value;
          } else {
            let fnReturn: unknown;
            try {
              fnReturn = tpl.value(node, attrs);
            } catch (err) {
              invokeExceptionHandler(exceptionHandler, err, '$compile');
              continue;
            }
            if (typeof fnReturn !== 'string') {
              invokeExceptionHandler(
                exceptionHandler,
                new TemplateUrlFunctionReturnedNonStringError(directive.name, describeValue(fnReturn)),
                '$compile',
              );
              continue;
            }
            if (fnReturn.length === 0) {
              // Empty-string return — silently skip. (Empty `templateUrl`
              // is rejected at registration; a runtime empty return is
              // an authoring bug but we treat it as a no-op rather than
              // routing a separate error class.)
              continue;
            }
            url = fnReturn;
          }
          pendingTemplateUrl = {
            url,
            directiveName: directive.name,
            templateDirectiveIndex: i,
          };
          // No synchronous install — the drain handles it. The walker
          // does NOT descend into children, and the per-directive
          // compile loop on the host does NOT run synchronously
          // (it runs inside `processEntry` after the template installs).
        }
      }
    }

    // Compile phase — for non-transcluding hosts only AND only when
    // there is no pending `templateUrl` directive (the URL forms defer
    // the host directives' compile/link to the drain).
    // Transcluding hosts defer the loop to link time so each
    // directive's compile fn receives the link-time `$transclude` as
    // its 3rd arg (FS §2.4 acceptance #11).
    const deferCompileToLink = transcludingDirective !== null;
    const isAsyncTemplateHost = pendingTemplateUrl !== null;
    const templateTimeLinkEntries: LinkEntry[] = [];
    if (!deferCompileToLink && !isAsyncTemplateHost) {
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
    //
    // For an async-template host (pending `templateUrl`) the snapshot
    // is intentionally skipped — the children come from the fetched
    // template and are compiled inside the drain.
    const masterChildren: Node[] = [];
    let childLinker: NodeLinker = noopLinker;
    if (hasChildren && !isAsyncTemplateHost) {
      const element = node as Element;
      for (let i = 0; i < element.childNodes.length; i++) {
        const child = element.childNodes.item(i);
        if (child.nodeType === 1 /* ELEMENT_NODE */ || child.nodeType === 8 /* COMMENT_NODE */) {
          masterChildren.push(child);
        }
      }
      childLinker = compileNodes(masterChildren, queue);
    }

    return (parentScope, cloneMap): void => {
      // Resolve the live target — when called under a clone map,
      // operate on the cloned counterpart rather than the master.
      const target = cloneMap?.get(node) ?? node;

      // ----- Spec 019 / Slice 6: async template host — enqueue + return.
      //
      // For a `templateUrl` host, the per-element linker captures
      // `parentScope` into a deferred entry and returns. The host's
      // directive compile / pre-link / post-link, and any child link,
      // run inside `processEntry` after the template installs.
      //
      // Transclude capture has ALREADY run synchronously above (the
      // `$$ngBoundTransclude` stash is on `target` if `transclude: true`
      // was declared), so consumer children are preserved through the
      // async install — `<ng-transclude>` inside the fetched template
      // will find the stash via parent-element walk.
      if (isAsyncTemplateHost && pendingTemplateUrl !== null && isElement(target)) {
        // Build + stash $transclude on the host BEFORE deferring so
        // the post-install link can find it via the parent-element
        // walk that `ng-transclude` uses.
        if (transcludingDirective !== null && transcludeDecl !== null) {
          const declared: TranscludeSlotMap = transcludeDecl.kind === 'slots' ? transcludeDecl.slots : [];
          const unfilledRequiredSet = new Set<string>(transcludeUnfilledRequired);
          const $transclude = buildTranscludeFn({
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

        // Build the pending-directives list. We include the
        // template-declaring directive so its own `compile` / `link`
        // runs against the post-template DOM (FS §2.8 acceptance #2);
        // we strip its `template` field on a LOCAL copy so the
        // post-template walker doesn't re-trigger the install.
        const pending: Directive[] = [];
        for (let i = 0; i < effectiveDirectives.length; i++) {
          const d = effectiveDirectives[i];
          if (d === undefined) {
            continue;
          }
          if (i === pendingTemplateUrl.templateDirectiveIndex) {
            pending.push({ ...d, template: undefined });
          } else {
            pending.push(d);
          }
        }
        const entry: DeferredTemplateEntry = {
          element: target,
          url: pendingTemplateUrl.url,
          attrs: attrs as Attributes,
          directiveName: pendingTemplateUrl.directiveName,
          pendingDirectives: pending,
          outerScope: parentScope,
          cancelled: false,
        };
        // Cancellation hook — if the host element is torn down via
        // `destroyElementScope` BEFORE the deferred drain resumes,
        // mark the entry as cancelled so the drain drops the install.
        addElementCleanup(target, () => {
          entry.cancelled = true;
        });
        queue.push(entry);
        return;
      }

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

      // ----- Spec 020 / Slice 4: per-element controller seam.
      //
      // Runs ONCE per directive declaring `controller`, AFTER attrs are
      // bound to the scope and the `$transclude` closure has been
      // built / stashed, BEFORE the per-directive pre-link loop (and
      // therefore before any other directive's pre-link on this
      // element). Errors route via `$exceptionHandler('$compile')`;
      // the surrounding pre/post-link on this element AND siblings
      // continue.
      if (isElement(target)) {
        runControllerSeam(effectiveDirectives, scope, target, attrs as Attributes, $transclude);
      }

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

  /**
   * Drain the per-`$compile`-call deferred-template queue. Each entry
   * is processed in parallel via `Promise.all(entries.map(processEntry))`
   * so sibling subtrees with independent `templateUrl` fetches don't
   * block one another. Errors from any single entry are routed via
   * `$exceptionHandler('$compile')` and do not affect other entries or
   * the host page. The returned promise is awaited internally only —
   * the public `Linker` has already returned synchronously.
   */
  function drainDeferredTemplateQueue(entries: DeferredTemplateEntry[]): void {
    if (entries.length === 0) {
      return;
    }
    void Promise.all(entries.map((entry) => processDeferredEntry(entry))).catch(() => {
      // Defensive — every per-entry rejection is caught inside
      // `processDeferredEntry`. The top-level `.catch` here only
      // exists so an accidental escaped rejection doesn't surface as
      // an unhandled-rejection warning.
    });
  }

  async function processDeferredEntry(entry: DeferredTemplateEntry): Promise<void> {
    // 1. Fetch the template via `$templateRequest`.
    let templateString: string | undefined;
    try {
      templateString = await templateRequest(entry.url);
    } catch (err) {
      invokeExceptionHandler(exceptionHandler, err, '$compile');
      return;
    }
    if (typeof templateString !== 'string') {
      // Either `ignoreRequestError === true` was set and the fetch
      // rejected, or the fetcher returned a non-string. Either way,
      // no install; entry drops silently. (We don't pass
      // `ignoreRequestError` from this site, but a decorated
      // `$templateRequest` could.)
      return;
    }

    // 2. Drop the install if cancellation fired (the host was torn
    // down via `destroyElementScope`) OR the captured outer scope was
    // destroyed since enqueue OR the host's own child scope (created
    // lazily for `scope: true` inside a prior drain cycle) was
    // destroyed.
    const elementScope = (entry.element as NgManagedElement).$$ngScope;
    if (entry.cancelled || isScopeDestroyed(elementScope) || isScopeDestroyed(entry.outerScope)) {
      return;
    }

    // 3. Parse + install the template as the host's children.
    const parsedNodes = parseTemplate(templateString);
    while (entry.element.firstChild !== null) {
      entry.element.removeChild(entry.element.firstChild);
    }
    for (const tplNode of parsedNodes) {
      entry.element.appendChild(tplNode);
    }

    // 4. Build a per-element linker for the pending directives + run
    // it. The linker reuses the captured outer scope (which becomes
    // the parent of the directive's `scope: true` child if any). The
    // pending directives may include another `transclude` declaration,
    // a `template` declaration whose template-time install is irrelevant
    // here (we've already installed THIS template — the pending
    // template-declaring directive's template would route the multi-
    // template error at link time), and any number of regular compile/
    // link directives.
    //
    // We use `buildPostTemplateLinker` so the relevant flags (needsChild
    // scope, the captured `$$ngBoundTransclude`) re-flow into the link.
    if (entry.outerScope === undefined) {
      return;
    }
    const innerQueue: DeferredTemplateEntry[] = [];
    const postLinker = buildPostTemplateLinker(entry, innerQueue);
    postLinker(entry.outerScope);
    // Drain nested `templateUrl` directives inside the freshly-
    // installed template. The drain is itself async, so it runs on a
    // follow-up microtask without blocking this entry's resolution.
    if (innerQueue.length > 0) {
      void Promise.resolve().then(() => {
        drainDeferredTemplateQueue(innerQueue);
      });
    }
  }

  /**
   * Build a linker that runs the host's pending directives against the
   * post-template DOM. Mirrors the synchronous per-element linker but
   * uses the captured `outerScope` (passed at call time) and the
   * pre-stashed `$$ngBoundTransclude` on the host (so consumer children
   * captured BEFORE the async fetch are still projected by
   * `<ng-transclude>` markers inside the fetched template).
   */
  function buildPostTemplateLinker(entry: DeferredTemplateEntry, childQueue: DeferredTemplateEntry[]): NodeLinker {
    const { element, attrs, pendingDirectives } = entry;

    // Compile the post-template subtree FIRST so `templateUrl`
    // directives inside the fetched template enqueue against the inner
    // child queue. They'll drain via the post-link path below.
    const childNodes: Node[] = [];
    for (let i = 0; i < element.childNodes.length; i++) {
      const child = element.childNodes.item(i);
      if (child.nodeType === 1 /* ELEMENT_NODE */ || child.nodeType === 8 /* COMMENT_NODE */) {
        childNodes.push(child);
      }
    }
    const childLinker = compileNodes(childNodes, childQueue);

    // Determine `scope: true` requirement on the pending directives.
    const needsChildScope = pendingDirectives.some((d) => d.scope);

    // Run compile on each pending directive against the post-template
    // element. Compile failures route + skip the directive.
    const templateTimeLinkEntries: LinkEntry[] = [];
    for (const directive of pendingDirectives) {
      if (directive.compile === undefined) {
        continue;
      }
      let compileResult: ReturnType<NonNullable<typeof directive.compile>>;
      try {
        // `$transclude` is `undefined` for the compile-phase call here.
        // The compile-time arg is reserved for transcluding hosts (where
        // we defer the compile loop to link time). The pending-directives
        // set NEVER contains the template-declaring directive itself,
        // and a transcluding directive that ALSO declared `templateUrl`
        // already had its `$transclude` built + stashed at the
        // synchronous enqueue site — the pending compile here is for
        // OTHER directives on the host that are not themselves the
        // transclusion source.
        compileResult = directive.compile(element, attrs, undefined);
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

    return (parentScope): void => {
      const scope: Scope = needsChildScope ? parentScope.$new() : parentScope;
      if (needsChildScope) {
        setElementScope(element, scope);
      }

      // Recover the bound transclude (if any) so directive pre/post
      // link callbacks receive the same `$transclude` they would have
      // received synchronously. Pre-link reads the stash directly.
      const bound = (element as unknown as Record<string, BoundTranscludeFn | undefined>)[BOUND_TRANSCLUDE_SLOT];
      const $transclude: TranscludeFn | undefined = bound?.fn;

      bindAttrsToScope(attrs, scope, interpolate, exceptionHandler);

      // ----- Spec 020 / Slice 4: per-element controller seam (post-
      // templateUrl-install path). Same contract as the synchronous
      // path: runs AFTER attrs are bound, BEFORE pre-link. The pending
      // directives include every directive on the host (the
      // template-declaring directive included, with its `template`
      // field stripped so it doesn't re-trigger the install). The
      // `$transclude` here is whatever was stashed at enqueue time
      // (may be `undefined` for non-transcluding hosts).
      runControllerSeam(pendingDirectives, scope, element, attrs, $transclude);

      for (const entry of templateTimeLinkEntries) {
        if (entry.pre !== undefined) {
          try {
            entry.pre(scope, element, attrs, undefined, $transclude);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
          }
        }
      }
      childLinker(scope);
      for (const entry of templateTimeLinkEntries.slice().reverse()) {
        if (entry.post !== undefined) {
          try {
            entry.post(scope, element, attrs, undefined, $transclude);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
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
      const queue: DeferredTemplateEntry[] = [];
      const linker = compileNodes(masters, queue);
      return ((scope: Scope) => {
        linker(scope);
        if (queue.length > 0) {
          void Promise.resolve().then(() => {
            drainDeferredTemplateQueue(queue);
          });
        }
        return node;
      }) as Linker;
    }

    const queue: DeferredTemplateEntry[] = [];
    const linker = compileNode(node, queue);
    return ((scope: Scope) => {
      linker(scope);
      if (queue.length > 0) {
        void Promise.resolve().then(() => {
          drainDeferredTemplateQueue(queue);
        });
      }
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
