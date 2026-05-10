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
 * - `NodeList` and array-of-`Node` inputs walk each top-level entry
 *   and return a composite linker that links them all.
 * - **Slice 7:** `Comment` nodes are now walked through the same
 *   matching pipeline — the comment-text parser in
 *   `directive-collector` recognizes the canonical
 *   `<!-- directive: name value -->` syntax and matches any
 *   directive whose `restrict` includes `'M'`. Comments have no
 *   children, so the compile/pre/post phases run on the comment node
 *   itself; the `element` argument passed to the directive IS the
 *   `Comment` reference, so directives that need to insert siblings
 *   call `comment.parentNode?.insertBefore(...)`.
 * - When walking an `Element`'s children the walker enumerates
 *   `childNodes` (filtered to elements + comments) rather than the
 *   `children` HTMLCollection (which excludes comments). `Text` nodes
 *   and other node types are skipped — they match no directives.
 *
 * The factory ALSO accepts `injector`, `interpolate`, and
 * `exceptionHandler` collaborators. Slice 9 wires `interpolate` into
 * `attrs.$observe` via `bindAttrsToScope(attrs, scope, interpolate)`
 * — the per-element linker passes the collaborator through so
 * `$observe` can lazily classify `{{...}}`-bearing attributes and
 * install a per-attribute `$watch`. `injector` is stashed for Slice
 * 10's `scope: true` cleanup wiring; `exceptionHandler` is stashed for
 * Slice 11's `try/catch` routing through cause `'$compile'`.
 */

import type { Scope } from '@core/index';
import { invokeExceptionHandler } from '@exception-handler/index';

import { bindAttrsToScope } from './attributes';
import { setElementScope } from './cleanup';
import { collectDirectives } from './directive-collector';
import type { CompileOptions, CompileService, Linker, LinkFn, Attributes } from './directive-types';

type LinkEntry = {
  pre?: LinkFn;
  post?: LinkFn;
};

type NodeLinker = (scope: Scope) => void;

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
  // Slice 11 wires `exceptionHandler` into the four execution sites
  // (compile, pre-link, post-link, and `$observe` callbacks via the
  // attributes binding) so a thrown error routes through
  // `invokeExceptionHandler(handler, err, '$compile')` while the
  // walker continues compiling/linking sibling directives, sibling
  // nodes, and ancestor post-links per FS §2.16.

  function compileNode(node: Node): NodeLinker {
    if (isElement(node)) {
      return compileElementOrComment(node, /* hasChildren */ true);
    }
    if (isComment(node)) {
      // Comments have no children — pass `hasChildren: false` so the
      // walker skips the `childNodes` enumeration entirely.
      return compileElementOrComment(node, /* hasChildren */ false);
    }
    // Text and other node types match no directives.
    return noopLinker;
  }

  function compileElementOrComment(node: Element | Comment, hasChildren: boolean): NodeLinker {
    const { directives, attrs } = collectDirectives(node, getDirectivesByName);

    // Slice 10 — `scope: true` detection (FS §2.12). Decide ONCE at
    // compile time whether THIS node needs its own child scope. The
    // actual `parent.$new()` call happens inside `nodeLinker(scope)`
    // so each linker invocation gets a FRESH child scope; the compile
    // phase only inspects whether ANY matched directive requested it.
    // Per FS §2.12: only one child scope is created per element even
    // if multiple directives request `scope: true` (and a `true`
    // request wins over a sibling `false` on the same element).
    // Comments cannot carry child scopes — the `node` cast in
    // `setElementScope` requires `Element`, and structural directives
    // historically attach to elements; defensively gate the flag on
    // the node type so a future M-restricted directive declaring
    // `scope: true` is silently ignored rather than crashing.
    const needsChildScope = isElement(node) && directives.some((d) => d.scope);

    // Compile phase — priority-DESCENDING (matches the order
    // `collectDirectives` produces). Each directive's `compile`
    // return value classifies its link contribution.
    //
    // Slice 11 (FS §2.16): a throwing `compile` function is reported
    // through `$exceptionHandler` with cause `'$compile'`; the
    // directive contributes no link function (its `linkEntries` slot
    // is skipped); other directives' compile functions on the same
    // node continue. The walker MUST still produce a linker even when
    // some directives' compile functions threw — `nodeLinker` runs
    // whatever survived the catch.
    const linkEntries: LinkEntry[] = [];
    for (const directive of directives) {
      if (directive.compile === undefined) {
        continue;
      }
      // The `compile` function's signature accepts `Element` per the
      // public type contract — for Comment-restricted (M) directives
      // the matched `node` IS a `Comment`, but the runtime hands it
      // through unchanged so the directive can call
      // `node.parentNode?.insertBefore(...)`. We narrow the cast in
      // one place; a future widening of the public type to accept
      // `Element | Comment` would erase the cast.
      let compileResult: ReturnType<NonNullable<typeof directive.compile>>;
      try {
        compileResult = directive.compile(node as Element, attrs);
      } catch (err) {
        invokeExceptionHandler(exceptionHandler, err, '$compile');
        // Skip — this directive contributes no link function. Other
        // directives on the same node continue to compile and link.
        continue;
      }
      if (compileResult === undefined) {
        continue;
      }
      if (typeof compileResult === 'function') {
        linkEntries.push({ post: compileResult });
      } else {
        linkEntries.push({
          pre: compileResult.pre,
          post: compileResult.post,
        });
      }
    }

    // Snapshot children AFTER the compile loop runs — a directive's
    // compile function may mutate `node` (add classes, set
    // attributes, even append children) and that mutation MUST be
    // visible to child compilation per FS §2.8.
    //
    // We enumerate `childNodes` rather than `children` so Comment
    // children are walked too (the `children` HTMLCollection only
    // contains Elements). Text and other node types are filtered out
    // — they match no directives.
    let childLinker: NodeLinker = noopLinker;
    if (hasChildren) {
      const children: Node[] = [];
      const element = node as Element;
      for (let i = 0; i < element.childNodes.length; i++) {
        const child = element.childNodes.item(i);
        if (child.nodeType === 1 /* ELEMENT_NODE */ || child.nodeType === 8 /* COMMENT_NODE */) {
          children.push(child);
        }
      }
      childLinker = composeLinkers(children.map((child) => compileNode(child)));
    }

    // The `linkEntries` array is already priority-DESCENDING (the
    // order the compile loop produced). Pre-link runs in that exact
    // order (priority-DESCENDING — FS §2.9). Post-link runs in
    // priority-ASCENDING order (FS §2.10 — "lower priority first,
    // higher priority last"), so we walk a reversed slice of the
    // entries for the post-link phase.
    return (parentScope: Scope): void => {
      // Slice 10 — `scope: true` wiring (FS §2.12). If ANY directive
      // on this element requested `scope: true`, create exactly ONE
      // child scope via `parentScope.$new()` and use it for:
      //   - `bindAttrsToScope` (so `$set` / `$observe` see the
      //     child scope's digest)
      //   - every link function on THIS element (pre + post)
      //   - the child linker (so descendants inherit the child
      //     scope unless they themselves request `scope: true`)
      // The fresh scope is stashed on the element via
      // `setElementScope` so a future `destroyElementScope(node)`
      // call (from `ng-if` / `ng-repeat` / etc., shipping in later
      // specs) can release it. Each linker invocation gets its own
      // child scope — `parentScope.$new()` lives inside this closure,
      // not at compile time.
      const scope: Scope = needsChildScope ? parentScope.$new() : parentScope;
      if (needsChildScope) {
        setElementScope(node, scope);
      }

      // Bind the scope (and the `$interpolate` collaborator) into
      // `attrs` BEFORE invoking any link functions so `$set` can
      // detect a digest, defer observer notifications via
      // `$evalAsync`, AND `$observe` can classify the attribute
      // (static vs. interpolated `{{...}}`) and lazily install a
      // per-attribute `$watch`. Slice 9 chose to extend
      // `bindAttrsToScope` (Option A in the slice notes) rather than
      // build a parallel `boundAttrs` view: one fewer object per
      // element and the public `Attributes` surface stays a single
      // type, while still satisfying the FS §2.11 contract that
      // `$observe` integrates with `$interpolate`.
      //
      // Slice 11: the `exceptionHandler` is also stashed on `attrs`
      // here so `$observe` callback invocations can route their
      // throws through `invokeExceptionHandler(handler, err,
      // '$compile')` — keeps the wiring inside `attributes.ts`
      // self-contained.
      bindAttrsToScope(attrs, scope, interpolate, exceptionHandler);
      // Pre-link: priority-DESCENDING, runs BEFORE child linking.
      // Slice 11 (FS §2.16): each pre-link call is wrapped in
      // `try/catch`; on throw we route via `invokeExceptionHandler`
      // and continue to the next pre-link (and to child traversal
      // afterwards). Subsequent pre-link functions on the same node
      // still run; child traversal still happens.
      for (const entry of linkEntries) {
        if (entry.pre !== undefined) {
          try {
            entry.pre(scope, node as Element, attrs as Attributes);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
          }
        }
      }
      // Recurse into children — their pre-links fire next, so
      // pre-link is naturally top-down across the tree. Descendants
      // receive the chosen `scope` (the child scope when one was
      // created on this element, otherwise the unchanged parent) —
      // a descendant with `scope: false` shares; a descendant with
      // `scope: true` will create another nested child off `scope`.
      childLinker(scope);
      // Post-link: priority-ASCENDING, runs AFTER child linking
      // (so post-link is naturally bottom-up across the tree).
      // Slice 11 (FS §2.16): each post-link call is wrapped in
      // `try/catch`; on throw we route via `invokeExceptionHandler`
      // and continue. Subsequent post-link functions still run;
      // ancestor post-link still runs (the throw is fully isolated
      // inside the per-entry catch).
      for (const entry of linkEntries.slice().reverse()) {
        if (entry.post !== undefined) {
          try {
            entry.post(scope, node as Element, attrs as Attributes);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
          }
        }
      }
    };
  }

  return ((node: Element | NodeList | Comment): Linker => {
    if (isNodeList(node) || Array.isArray(node)) {
      const topLevelLinkers: NodeLinker[] = [];
      const list = node as ArrayLike<Node>;
      for (let i = 0; i < list.length; i++) {
        const child = list[i];
        if (child !== undefined) {
          topLevelLinkers.push(compileNode(child));
        }
      }
      const composite = composeLinkers(topLevelLinkers);
      return ((scope: Scope) => {
        composite(scope);
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

function isElement(node: Node): node is Element {
  return node.nodeType === 1; // Node.ELEMENT_NODE
}

function isComment(node: Node): node is Comment {
  return node.nodeType === 8; // Node.COMMENT_NODE
}

function isNodeList(value: unknown): value is NodeList {
  return typeof NodeList !== 'undefined' && value instanceof NodeList;
}

function composeLinkers(linkers: readonly NodeLinker[]): NodeLinker {
  return (scope: Scope): void => {
    for (const linker of linkers) {
      linker(scope);
    }
  };
}

const noopLinker: NodeLinker = () => {
  /* intentionally empty — text-and-other node types and empty children both reach this branch */
};
