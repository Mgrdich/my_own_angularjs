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

import type { ControllerInvokable, ControllerLocals } from '@controller/controller-types';
import type { Scope } from '@core/index';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';

import { bindAttrsToScope } from './attributes';
import { addElementCleanup, setElementScope } from './cleanup';
import {
  MultipleIsolateScopeError,
  MultipleTemplateDirectivesError,
  MultipleTranscludeDirectivesError,
  RequiredTranscludeSlotUnfilledError,
  TemplateFunctionReturnedNonStringError,
  TemplateUrlFunctionReturnedNonStringError,
} from './compile-error';
import { describeValue } from './describe-value';
import { collectDirectives } from './directive-collector';
import {
  isNgManagedElement,
  NG_BOUND_TRANSCLUDE,
  NG_CONTROLLERS,
  NG_ELEMENT_TRANSCLUDED,
  NG_SCOPE,
} from './element-slots';
import type { CompileOptions, CompileService, Directive, Linker, LinkFn, Attributes } from './directive-types';
import { wireIsolateBindings, type NormalizedBindingMap } from './isolate-bindings';
import { ChangesQueue, flushChangesQueue, hasHook, invokeHook, UNINITIALIZED_VALUE } from './lifecycle';
import { NG_NON_BINDABLE_NAME } from './ng-non-bindable';
import { isComment, isElement } from './node-guards';
import { parseTemplate } from './template-parse';
import { resolveRequireForm } from './require-resolver';
import { captureChildren } from './transclude-capture';
import { compileBuckets } from './transclude-compile';
import { buildTranscludeFn } from './transclude-fn';
import type { BoundTranscludeFn, NormalizedTransclude, TranscludeFn, TranscludeSlotMap } from './transclude-types';

type LinkEntry = {
  pre?: LinkFn;
  post?: LinkFn;
  /**
   * The directive that contributed this entry. Spec 022 Slice 4 reads
   * it at link time to look up `require` and pass the resolved
   * controllers as the link fn's 4th argument. Older paths that built
   * entries before the seam carried no per-entry metadata still work —
   * `directive` is optional and an unset slot means "no require for
   * this link entry".
   */
  directive?: Directive;
  /**
   * Resolved `require` controllers for this entry (spec 022 Slice 4).
   * Populated AFTER `runControllerSeam` completes so the resolver sees
   * every own-element controller stashed on `$$ngControllers`. Shape
   * mirrors the directive's `require` declaration form: single value
   * for string form, array for `string[]`, record for object form.
   * `null` for an optional miss; `undefined` when the directive
   * declared no `require`.
   */
  requiredControllers?: unknown;
};

/**
 * The internal walker contract. Per-node linker closures capture the
 * master `node` in scope; when invoked with a `cloneMap`, they resolve
 * `target = cloneMap.get(node) ?? node` and operate on the cloned
 * counterpart instead. The map is extended in parallel as the walker
 * descends so descendants find their own clones.
 */
type NodeLinker = (scope: Scope, cloneMap?: Map<Node, Node>) => void;

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
 * A scope is "destroyed" when `$destroy()` sets `$$watchers = null`
 * (spec 002 / scope.ts:516). The deferred drain peeks this slot to
 * decide whether to install the template or silently drop the entry.
 */
interface ScopeWatchersSlot {
  $$watchers: unknown[] | null;
}

function isScopeDestroyed(scope: Scope | undefined) {
  if (scope === undefined) {
    return false;
  }
  return (scope as unknown as ScopeWatchersSlot).$$watchers === null;
}

/**
 * Internal per-controller bookkeeping for Slice 3 lifecycle dispatch.
 * Walked by the per-element link site after the post-link loop to
 * fire `$postLink`. The `scope` is the scope the controller was
 * constructed against — kept here in case future slices need it for
 * lifecycle teardown sequencing.
 */
interface TrackedController {
  readonly instance: unknown;
  readonly scope: Scope;
}

/**
 * Structural shape passed to `$onChanges(changes)` — see
 * `lifecycle.ts`'s `SimpleChange`. Re-spelled here as an interface so
 * the compiler's call sites don't need to import `SimpleChange`
 * concretely (Slice 3 keeps the class internal to the integration
 * tests; the compiler reads it through this shape).
 */
interface SimpleChangeLike {
  currentValue: unknown;
  previousValue: unknown;
  isFirstChange(): boolean;
}

/**
 * Build a `SimpleChange`-shaped record. Re-spelled as a small helper
 * so the lifecycle.ts class import stays scoped to the wiring sites
 * that strictly need it.
 */
function makeSimpleChange(currentValue: unknown, previousValue: unknown, isFirst: boolean): SimpleChangeLike {
  return {
    currentValue,
    previousValue,
    isFirstChange: () => isFirst,
  };
}

/**
 * Spec 027 Slice 4 — attribute-source sentinel detector. Returns `true`
 * when `controller` is the `{ __attributeSource: string }` shape used
 * by the built-in `ng-controller` directive (and reserved for any
 * future structural directive that wants `runControllerSeam` to read
 * its controller name from `attrs[__attributeSource]` at link time).
 *
 * The check is intentionally strict: rejects `null`, arrays, and any
 * object whose `__attributeSource` is not a string. The detected union
 * arm is disjoint from `ControllerInvokable` (`string | function |
 * array`), so the sentinel never collides with the eager- or
 * bindToController-path inputs.
 */
function isAttributeSourceController(controller: unknown): controller is { __attributeSource: string } {
  return (
    controller !== null &&
    typeof controller === 'object' &&
    !Array.isArray(controller) &&
    typeof (controller as { __attributeSource?: unknown }).__attributeSource === 'string'
  );
}

/**
 * Stash `instance` on `element.$$ngControllers` under `directiveName`.
 * Creates the map lazily on first call. Non-enumerable so it does not
 * appear in `for..in` traversals.
 *
 * Slice 4 will add the READ path (the `^` / `^^` ancestor walk for
 * `require`); Slice 3 only writes.
 */
function stashController(element: Element, directiveName: string, instance: unknown): void {
  let map: Map<string, unknown> | undefined;
  if (isNgManagedElement(element)) {
    map = element[NG_CONTROLLERS];
  }
  if (map === undefined) {
    map = new Map<string, unknown>();
    Object.defineProperty(element, NG_CONTROLLERS, {
      value: map,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  map.set(directiveName, instance);
}

/**
 * Object-form `require` auto-assignment (spec 022 Slice 4). When a
 * directive declares `require: { alias: '^name', … }` AND its own
 * `controller`, the resolved controllers are written onto the requiring
 * controller's instance under their declared aliases BEFORE `$onInit`
 * fires — so `$onInit` reads `this.<alias>` and gets the resolved
 * collaborator.
 *
 * AngularJS-canonical: only the object form auto-assigns. The string
 * and array forms do NOT mutate the requiring instance — they are
 * delivered exclusively via the link fn's 4th argument. The asymmetry
 * is deliberate: object-form aliases are the AngularJS-typical
 * "shorthand for getting a collaborator on `this`"; the string / array
 * forms expose lower-level access through the link signature.
 */
function assignRequireToInstance(
  instance: unknown,
  requireSpec: string | string[] | Record<string, string>,
  resolved: unknown,
): void {
  if (typeof requireSpec === 'string' || Array.isArray(requireSpec)) {
    return;
  }
  if (instance === null || typeof instance !== 'object') {
    return;
  }
  const target = instance as Record<string, unknown>;
  const resolvedRecord = resolved as Record<string, unknown>;
  for (const alias of Object.keys(requireSpec)) {
    target[alias] = resolvedRecord[alias];
  }
}

/**
 * Walk a per-element link-entry list and populate each entry's
 * `requiredControllers` slot (spec 022 Slice 4). Entries whose
 * directive has no `require` are left untouched (`undefined`).
 *
 * Two sources of resolved controllers:
 *
 *  - The shared `requireResults` map (populated by `runControllerSeam`
 *    when the requiring directive ALSO declared `controller` — so the
 *    seam saw it). The map hit is the common case; the resolver is
 *    NOT re-invoked, preserving "resolve once, deliver everywhere".
 *  - On-the-fly `resolveRequireForm` for directives without a
 *    controller but with `require` — the canonical "link-only
 *    directive consuming a sibling's controller" pattern.
 *
 * Resolution failures (`MissingRequiredControllerError`) at this site
 * route via `$exceptionHandler('$compile')` and the failing entry's
 * `requiredControllers` stays `undefined`. The link fn still runs but
 * receives `undefined` for the 4th arg — same behavior as the
 * optional-miss path delivering `null`, but without the explicit
 * `?` marker.
 */
function resolveRequiredControllersForLinkEntries(
  // Spec 027 Slice 5: widened to `Element | Comment` so a
  // `transclude: 'element'` directive's link entry (whose host is a
  // Comment placeholder per Slice 2) can resolve its `require`. The
  // underlying `resolveRequireForm` reads `parentElement`, which is a
  // standard DOM property on Comment, so the runtime semantics are
  // unchanged — the cast to `Element` below is a type-system bridge
  // only (require-resolver.ts is the canonical signature owner).
  element: Element | Comment,
  entries: readonly LinkEntry[],
  requireResults: ReadonlyMap<Directive, unknown>,
  exceptionHandler: ExceptionHandler,
): void {
  for (const entry of entries) {
    const directive = entry.directive;
    if (directive === undefined || directive.require === undefined) {
      continue;
    }
    if (requireResults.has(directive)) {
      // The seam already attempted resolution (whether it succeeded
      // OR threw — a throwing path records `undefined` in the map).
      // We reuse the cached value and DO NOT re-attempt, preserving
      // the "resolve once, report once" rule.
      entry.requiredControllers = requireResults.get(directive);
      continue;
    }
    try {
      entry.requiredControllers = resolveRequireForm(element as Element, directive.name, directive.require);
    } catch (err) {
      invokeExceptionHandler(exceptionHandler, err, '$compile');
    }
  }
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
   * Per-element controller seam (spec 020 Slice 4, extended in spec 022
   * Slice 2 + Slice 3). Runs ONCE per directive on the element that
   * declares `controller`, AFTER the attrs-to-scope binding and the
   * `$transclude` stash, BEFORE the pre-link loop. Errors route via
   * `$exceptionHandler('$compile')` — no new `EXCEPTION_HANDLER_CAUSES`
   * token; the surrounding link passes on this element AND on siblings
   * continue.
   *
   * Extracted to a small helper because both the transcluding-host
   * link path and the non-transcluding link path call it with the
   * same shape (the only difference is whether `$transclude` is
   * threaded into the locals). The helper is closed over `$controller`
   * + `exceptionHandler` so the call sites stay short.
   *
   * **Spec 022 Slice 2 — `bindToController` integration.** When a
   * directive declares `bindToController === true` AND a `controller`,
   * the seam instantiates via the new `later: true` call shape
   * (`{ instance, identifier }`), wires the relevant binding map
   * (form 1: `directive.isolateBindings`; form 2:
   * `directive.bindToControllerBindings`) onto the INSTANCE via
   * {@link wireIsolateBindings} with `target: instance`, then publishes
   * the resolved `identifier` on the per-element scope so the
   * `controllerAs` alias becomes readable AFTER bindings have populated.
   * Directives without `bindToController` (or with no `controller`)
   * fall through to the spec-020 1–3 arg path unchanged.
   *
   * **Spec 022 Slice 3 — lifecycle hooks.** For every directive that
   * declares a controller, the seam:
   *
   *  1. Stashes the instance into `element.$$ngControllers` (keyed by
   *     directive name) — Slice-3 plants this for the future Slice-4
   *     `require` resolver and for the post-link-time `$postLink`
   *     walk.
   *  2. Registers `scope.$on('$destroy', () => invokeHook($onDestroy))`
   *     BEFORE `$onInit` fires so a `$onInit` that throws does not
   *     prevent `$onDestroy` from running on scope destruction.
   *  3. After binding wiring populates the instance, invokes
   *     `$onInit`.
   *  4. If `<` / `@` bindings have surfaced any initial-change
   *     records (via the wireIsolateBindings `onChange` callback),
   *     fires a synchronous initial `$onChanges` with those records.
   *  5. Subsequent `<` / `@` watcher fires feed the per-element
   *     {@link ChangesQueue}; when the queue transitions empty →
   *     non-empty, schedules ONE `$$postDigest` drain that walks the
   *     queue and fires `$onChanges(batch)` for each accumulated
   *     controller.
   *
   * The returned `lifecycleControllers` list pairs each instance with
   * the scope it was registered on so the per-element link site can
   * walk the list AFTER post-link to fire `$postLink`. The list also
   * remains the only callsite that knows the directive names — `$$ngControllers`
   * is non-enumerable map state, deliberately opaque to outside code.
   *
   * `parentScope` is the OUTER scope (the per-element linker's
   * `parentScope` arg) and is the namespace used for `=` / `<` / `&`
   * parent-expression evaluation when bindings target the instance —
   * matches the spec-022 Slice 1 contract for the scope-target wiring
   * site.
   *
   * **Spec 027 Slice 4 — attribute-source sentinel branch.** A third
   * dispatch is added alongside the existing `bindToController` (deferred-
   * alias `later: true`) and eager paths. When `directive.controller`
   * is the sentinel shape `{ __attributeSource: 'ngController' }` (or
   * any future built-in's attribute-source key), the seam reads the
   * controller name from `attrs[__attributeSource]` at link time and
   * invokes `$controller(attrs[…], locals)` with NO separate `ident`
   * argument — the alias (`'Name as alias'` syntax) is parsed from the
   * attribute string by `$controller`'s own `parseControllerName`. The
   * branch runs on the EAGER path (`ng-controller` declares no isolate
   * bindings, so `bindToController` is absent), so all four lifecycle
   * hooks (`$onInit`, `$postLink`, `$onDestroy`; NOT `$onChanges` —
   * matches AngularJS, no isolate bindings to drive change records),
   * the `$$ngControllers` stash, the `require` resolution dance, and
   * the `controllerAs` alias publication (handled internally by
   * `$controller` since `later !== true`) all fire on the same timeline
   * as the eager path. An empty / undefined / non-string attribute
   * value causes a clean bail (no instantiation, no error — the
   * directive matched on an element that supplies no controller name).
   * The sentinel shape never collides with `ControllerInvokable`
   * (`string | function | array`) — the union arms are disjoint.
   */
  function runControllerSeam(
    directives: readonly Directive[],
    scope: Scope,
    parentScope: Scope,
    // Spec 027 Slice 5: widened to `Element | Comment` so the per-element
    // link site can invoke the seam for a `transclude: 'element'`
    // directive's children whose host is a Comment placeholder. The
    // inner loop body only runs for directives declaring `controller`
    // (the `directive.controller === undefined` continue below), and
    // no spec-027 child directive on a Comment host declares one — so
    // the `stashController(element, …)` / `resolveRequireForm(element, …)`
    // call sites still pass an `Element` in practice. The `as Element`
    // bridges below preserve type safety without re-typing those helpers.
    element: Element | Comment,
    attrs: Attributes,
    $transclude: TranscludeFn | undefined,
    requireResults: Map<Directive, unknown>,
  ): TrackedController[] {
    const tracked: TrackedController[] = [];
    // Lazily-created per-element `$onChanges` queue. The queue is
    // shared across every controller on THIS element — when multiple
    // controllers (different directives) on one element each declare
    // `$onChanges`, they all batch into the same per-digest drain.
    let changesQueue: ChangesQueue | null = null;
    function ensureQueue(): ChangesQueue {
      if (changesQueue === null) {
        changesQueue = new ChangesQueue();
      }
      return changesQueue;
    }

    for (const directive of directives) {
      if (directive.controller === undefined) {
        continue;
      }

      // Spec 027 Slice 4 — attribute-source sentinel resolution. When
      // the directive's normalized `controller` field is the sentinel
      // shape `{ __attributeSource: 'ngController' }` (a non-callable,
      // non-array object with a string `__attributeSource` key), read
      // the controller name from `attrs[__attributeSource]` at this
      // point. The resolved name flows into the eager-path
      // `$controller(name, locals, controllerAs)` invocation below
      // VIA `resolvedControllerArg` (an inner-scoped binding that
      // shadows `directive.controller` for the rest of this iteration).
      // An empty / non-string / missing attribute value causes a clean
      // bail (no instantiation, no error) — the directive matched on
      // an element that supplies no controller name. The detection is
      // disjoint from `ControllerInvokable` (`string | function | array`),
      // so the sentinel never collides with the eager- or
      // bindToController-path inputs.
      let resolvedControllerArg: string | ControllerInvokable;
      if (isAttributeSourceController(directive.controller)) {
        const attrName = directive.controller.__attributeSource;
        const attrValue = attrs[attrName];
        if (typeof attrValue !== 'string' || attrValue.length === 0) {
          // Clean bail — no instantiation, no error, no entry in the
          // tracked list. A directive that opts into the sentinel
          // shape declares no concrete fallback name; an empty /
          // undefined attribute value at link time is the documented
          // "no controller to attach" case.
          continue;
        }
        resolvedControllerArg = attrValue;
      } else {
        // The guard narrows `directive.controller` to
        // `string | ControllerInvokable` here — the sentinel and
        // `undefined` branches have both been ruled out, so no cast
        // is needed.
        resolvedControllerArg = directive.controller;
      }

      const locals: ControllerLocals = {
        $scope: scope,
        // `ControllerLocals.$element` is typed `Element` in
        // controller-types.ts. Spec 027's widening to `Element | Comment`
        // is only reachable when the directive has no `controller` (the
        // loop skips above), so this cast is unreachable at runtime for
        // a Comment host — kept as a type bridge.
        $element: element as Element,
        $attrs: attrs,
      };
      if ($transclude !== undefined) {
        locals.$transclude = $transclude;
      }

      // Slice 2 — `bindToController` instance-target path. The
      // binding map source is: `bindToControllerBindings` (object
      // form, spec 022 §2.2 "form 2") if present, else
      // `isolateBindings` (re-used `scope: { … }` map, spec 022 §2.2
      // "form 1"). When neither is present the flag silently degrades
      // to the standard 1–3 arg path (`bindToController: true` without
      // an isolate-binding map is an AngularJS-canonical no-op).
      const bindings = directive.bindToControllerBindings ?? directive.isolateBindings;
      const useBindToController = directive.bindToController && bindings !== undefined;

      let instance: unknown = undefined;
      try {
        if (useBindToController) {
          // `resolvedControllerArg` is identical to `directive.controller`
          // in the `bindToController` path — the sentinel shape is
          // reserved for the EAGER path (`ng-controller` declares no
          // isolate bindings, so it never lands here). Reusing the
          // resolved local keeps the call signature uniform across both
          // branches without an `as` cast.
          const deferred = $controller(resolvedControllerArg, locals, directive.controllerAs, true);
          instance = deferred.instance;
          // Stash on `$$ngControllers` BEFORE binding wiring + lifecycle
          // hooks fire so a `$onInit` (or downstream Slice-4 `require`
          // resolution) can find the instance on this element by name.
          stashController(element as Element, directive.name, instance);
          // Spec 022 Slice 4 — resolve `require` AFTER stash, BEFORE
          // binding wiring + `$onInit`. The object-form auto-assignment
          // here is what lets `$onInit` read `this.<alias>` for its
          // declared `require` aliases. The resolved value is also
          // stored on `requireResults` so the link site can pass it as
          // the link fn's 4th argument.
          //
          // Resolution failures route via `$exceptionHandler('$compile')`
          // inside an inner try/catch so the surrounding binding wiring
          // + lifecycle hooks still run for this directive (the rest of
          // the seam stays robust to a single missing-require throw).
          // The `requireResults` map records the directive either way
          // (with the resolved value, or `undefined` on throw) so the
          // post-seam link-entry walk knows the seam already handled it.
          if (directive.require !== undefined) {
            try {
              const resolved = resolveRequireForm(element as Element, directive.name, directive.require);
              requireResults.set(directive, resolved);
              assignRequireToInstance(instance, directive.require, resolved);
            } catch (err) {
              invokeExceptionHandler(exceptionHandler, err, '$compile');
              requireResults.set(directive, undefined);
            }
          }
          // Slice 3: pre-collect initial-change records for the
          // synchronous `$onChanges` first fire. The compiler then
          // fires `$onChanges(initialRecord)` AFTER `$onInit`.
          const initialRecord: Record<string, SimpleChangeLike> = {};
          const queueRef = hasHook(instance, '$onChanges') ? ensureQueue() : null;
          wireIsolateBindings({
            parentScope,
            isolateScope: scope,
            attrs,
            bindings,
            target: instance as Record<string, unknown>,
            interpolate,
            onChange: (localName, currentValue, _previousValue, isFirst) => {
              if (!hasHook(instance, '$onChanges')) {
                return;
              }
              if (isFirst) {
                // Initial fire — accumulate into the synchronous
                // initial batch with the canonical `UNINITIALIZED_VALUE`
                // sentinel as `previousValue`.
                initialRecord[localName] = makeSimpleChange(currentValue, UNINITIALIZED_VALUE, true);
                return;
              }
              // Subsequent fire — record into the per-element changes
              // queue. The compiler schedules ONE `$$postDigest` drain
              // when the queue transitions empty → non-empty.
              if (queueRef === null) {
                return;
              }
              // `previousValue` for the queued record is the prior
              // current-value the listener last surfaced (the watcher's
              // `oldValue`). For `@` bindings this is the prior raw
              // string; for `<` bindings the prior expression value.
              const wasEmpty = queueRef.record(instance as object, localName, currentValue, _previousValue, false);
              if (wasEmpty) {
                // Schedule the drain on the next digest's post-digest
                // tick — flush ALL accumulated records (across every
                // controller on this element) in one pass.
                scope.$$postDigest(() => {
                  flushChangesQueue(queueRef, exceptionHandler);
                });
              }
            },
          });
          // Publish the alias on the per-element scope. We always use
          // `scope` (the isolate scope when one exists on this element,
          // else the parent / child scope) — the spec-020 seam's
          // bindAlias path writes here too.
          if (deferred.identifier !== undefined) {
            (scope as unknown as Record<string, unknown>)[deferred.identifier] = instance;
          }
          // ----- Slice 3 lifecycle wiring (instance-target path) -----
          registerOnDestroy(scope, instance, changesQueue);
          invokeHook(instance, '$onInit', exceptionHandler);
          // Fire the initial synchronous `$onChanges` ONLY if any
          // first-change records actually got collected during the
          // binding wiring above. `Object.keys` length is the
          // cleanest "did anything land?" check — and works whether
          // the controller declares `$onChanges` or not (a missing
          // hook makes the `invokeHook` a no-op anyway).
          if (Object.keys(initialRecord).length > 0) {
            invokeHook(instance, '$onChanges', exceptionHandler, initialRecord);
          }
        } else {
          // Eager path. When the sentinel sourced the controller name
          // from `attrs[__attributeSource]` (spec 027 Slice 4), the
          // resolved string flows through `resolvedControllerArg` and
          // `$controller`'s own `parseControllerName` handles the
          // `'Name as alias'` syntax inside the attribute value — no
          // separate `ident` argument is passed (the sentinel directive
          // never declares `controllerAs` on its DDO). For the standard
          // eager path, `resolvedControllerArg === directive.controller`
          // and `directive.controllerAs` carries any explicit alias.
          instance = $controller(resolvedControllerArg, locals, directive.controllerAs);
          stashController(element as Element, directive.name, instance);
          // Spec 022 Slice 4 — resolve `require` AFTER stash, BEFORE
          // `$onInit`. Same ordering as the bindToController branch:
          // object-form auto-assignment populates `this.<alias>` so
          // `$onInit` sees its required collaborators on `this`.
          if (directive.require !== undefined) {
            try {
              const resolved = resolveRequireForm(element as Element, directive.name, directive.require);
              requireResults.set(directive, resolved);
              assignRequireToInstance(instance, directive.require, resolved);
            } catch (err) {
              invokeExceptionHandler(exceptionHandler, err, '$compile');
              requireResults.set(directive, undefined);
            }
          }
          // ----- Slice 3 lifecycle wiring (scope-target / no-binding path) -----
          //
          // Even without `bindToController`, a controller may still
          // define `$onInit` / `$onDestroy` / `$postLink`. `$onChanges`
          // for scope-target wiring is intentionally NOT plumbed: the
          // scope-target binding wiring lives in the early per-element
          // linker site (outside this seam), where no controller exists
          // to receive change records. Slice 3 mirrors AngularJS
          // canonical behavior — `$onChanges` is for `bindToController`
          // bindings on the instance.
          registerOnDestroy(scope, instance, changesQueue);
          invokeHook(instance, '$onInit', exceptionHandler);
        }
      } catch (err) {
        invokeExceptionHandler(exceptionHandler, err, '$compile');
      }

      if (instance !== undefined) {
        tracked.push({ instance, scope });
      }
    }
    return tracked;
  }

  /**
   * Register the per-controller `$onDestroy` listener on the scope the
   * controller was constructed against. Drops any pending `$onChanges`
   * batch for the controller BEFORE invoking `$onDestroy` so a deferred
   * flush can't fire after destruction.
   */
  function registerOnDestroy(scope: Scope, instance: unknown, queue: ChangesQueue | null): void {
    if (typeof instance !== 'object' || instance === null) {
      return;
    }
    const ctrlObject = instance;
    scope.$on('$destroy', () => {
      if (queue !== null) {
        queue.clearForController(ctrlObject);
      }
      invokeHook(ctrlObject, '$onDestroy', exceptionHandler);
    });
  }

  /**
   * Fire `$postLink` on every controller in `tracked`. Walks in
   * registration order (priority-DESCENDING by `Directive.index`
   * tie-break — same as `runControllerSeam`'s iteration). Called by
   * the per-element link site AFTER the post-link loop completes for
   * this element (which itself runs after child linking).
   */
  function firePostLinkHooks(tracked: TrackedController[]): void {
    for (const { instance } of tracked) {
      invokeHook(instance, '$postLink', exceptionHandler);
    }
  }

  /**
   * Decide whether the directive's binding map should be wired onto the
   * isolate scope at the early wiring site (BEFORE attrs-to-scope and
   * BEFORE the controller seam runs). Returns `true` for the
   * scope-target cases:
   *
   *  - `isolateBindings` present AND `bindToController` is `false`
   *    (form-1 binding map targets the scope, no controller
   *    indirection).
   *  - `isolateBindings` present AND `bindToController` is `true`
   *    BUT the directive declares NO controller (the documented
   *    silent-degrade case — `bindToController` is meaningless without
   *    a controller).
   *
   * Returns `false` when the controller seam will handle the wiring on
   * the instance target.
   */
  function shouldWireBindingsToScope(directive: Directive | null): directive is Directive {
    if (directive === null) return false;
    if (directive.isolateBindings === undefined) return false;
    if (!directive.bindToController) return true;
    // `bindToController === true` AND a binding map exists. Degrade to
    // the scope target only when no controller is present to receive
    // the bindings.
    return directive.controller === undefined;
  }

  /**
   * Form-2 scope-target degrade: when a directive declared
   * `bindToController: { … }` (object form) BUT no controller, the
   * map's bindings target the existing scope on the element. The
   * isolate-scope-creation contract does NOT widen here — form 2 never
   * creates an isolate scope on its own (a deliberate asymmetry vs.
   * form 1's `scope: { … }`). When this returns a non-`undefined`
   * directive, the early wiring site uses its
   * `bindToControllerBindings` as the binding map.
   */
  function findOrphanedBindToControllerBindings(directives: readonly Directive[]): Directive | undefined {
    for (const directive of directives) {
      if (directive.bindToControllerBindings !== undefined && directive.controller === undefined) {
        return directive;
      }
    }
    return undefined;
  }

  function compileNode(node: Node, queue: DeferredTemplateEntry[]) {
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
  function makeInternalLinker(nodes: readonly Node[]) {
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

    // ----- Spec 022 Slice 1: isolate-scope pre-pass -----
    //
    // Identify the directive (if any) requesting an isolate scope on
    // this element. At most ONE isolate-scope directive is allowed per
    // element; a second match routes `MultipleIsolateScopeError` via
    // `$exceptionHandler('$compile')` at LINK time so the per-element
    // linker can return early before any wiring runs. The conflict is
    // captured here (at compile time) and the actual error route +
    // early-return happens inside the linker closure below.
    let isolateDirective: Directive | null = null;
    let isolateConflict: { firstName: string; secondName: string } | null = null;
    if (isElement(node)) {
      for (const directive of directives) {
        if (directive.isolateBindings === undefined) {
          continue;
        }
        if (isolateDirective === null) {
          isolateDirective = directive;
          continue;
        }
        if (isolateConflict === null) {
          isolateConflict = { firstName: isolateDirective.name, secondName: directive.name };
        }
      }
    }

    // ----- Spec 018 / Slice 3 + spec 027 / Slice 2: transclusion pre-pass -----
    //
    // Scan the priority-sorted directive list for entries declaring
    // `transclude`. The FIRST match wins; any second match is reported
    // via `MultipleTranscludeDirectivesError` and its `transclude` is
    // cleared on a LOCAL shallow copy (the shared registered directive
    // object is NOT mutated).
    //
    // Spec 027 Slice 2 — re-entrancy guard for element-form. When a
    // `kind: 'element'` capture detaches the host, the master fragment
    // is the host itself; `makeInternalLinker([host])` then walks back
    // through this function recursively. On the SECOND invocation we
    // skip the same directive's transclude pre-pass so we don't
    // re-capture infinitely. The first-pass capture stamps the host's
    // `$$ngElementTranscluded` slot with the directive name; the
    // second pass reads it and strips `transclude` on a LOCAL shallow
    // copy of the directive (the registered object is NOT mutated).
    const alreadyElementTranscluded =
      isElement(node) && isNgManagedElement(node) ? node[NG_ELEMENT_TRANSCLUDED] : undefined;
    let transcludingDirective: Directive | null = null;
    const effectiveDirectives: Directive[] = [];
    for (const directive of directives) {
      if (directive.transclude !== undefined) {
        if (
          alreadyElementTranscluded !== undefined &&
          alreadyElementTranscluded === directive.name &&
          directive.transclude.kind === 'element'
        ) {
          // Re-entrancy guard: the master fragment's recompile pass
          // sees the same directive whose `kind: 'element'` capture
          // already ran. Strip transclude on a LOCAL copy so the
          // directive's other behavior (compile / link / controller)
          // still applies to the master, but the capture does NOT
          // recur. Mirrors AngularJS's `terminalPriority`-based
          // re-entry guard without introducing a new priority axis.
          const stripped: Directive = { ...directive, transclude: undefined };
          effectiveDirectives.push(stripped);
          continue;
        }
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
    // directive matched. All three discriminants flow through the same
    // pipeline:
    //   - `kind: 'content'` (spec 018 Slice 3): captures host children
    //     into the default bucket; host stays in the DOM.
    //   - `kind: 'slots'` (spec 018 Slice 4): routes host children by
    //     slot selector; host stays in the DOM.
    //   - `kind: 'element'` (spec 027 Slice 2): detaches the host
    //     ITSELF into the default bucket (single-element array) and
    //     leaves a `<!-- directiveName: attrValue -->` Comment
    //     placeholder in its slot. The local `node` binding is then
    //     rebound to the placeholder so `$$ngBoundTransclude`,
    //     `$$ngCleanupQueue`, and the matched directive's link-time
    //     element argument all hang off the Comment going forward.
    let defaultLinker: Linker | null = null;
    let slotLinkers: Record<string, Linker | null> = {};
    let transcludeDecl: NormalizedTransclude | null = null;
    let transcludeMasters: Node[] = [];
    let transcludeNamedMasters: Record<string, Node[]> = {};
    let transcludeUnfilledRequired: string[] = [];
    if (transcludingDirective !== null && transcludingDirective.transclude !== undefined && isElement(node)) {
      transcludeDecl = transcludingDirective.transclude;
      // Defensively coerce the attribute lookup — `attrs[name]` may be
      // a non-string runtime value (e.g. a Record from the `$attr`
      // back-pointer in the typed surface). For element-form
      // transclusion the value is purely cosmetic (labels the Comment
      // placeholder for dev-tools inspection), so a defensive empty
      // string covers both "attribute absent" and "value is non-string"
      // without affecting behavior.
      const attrLookup = attrs[transcludingDirective.name];
      const attrValue = typeof attrLookup === 'string' ? attrLookup : '';
      // Stamp the host BEFORE handing the bucket to `compileBuckets`
      // so the recursive master-compile pass reads the marker and
      // strips its own `transclude` declaration on a local copy. The
      // stamp lives on the host Element (not the placeholder Comment)
      // because the master fragment IS the host and that's what the
      // re-entrant `compileElementOrComment` invocation receives.
      if (transcludeDecl.kind === 'element') {
        Object.defineProperty(node, NG_ELEMENT_TRANSCLUDED, {
          value: transcludingDirective.name,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }
      const buckets = captureChildren(node, transcludeDecl, transcludingDirective.name, attrValue);
      const compiled = compileBuckets(
        { defaultBucket: buckets.defaultBucket, slotBuckets: buckets.slotBuckets },
        (nodes) => makeInternalLinker(nodes),
      );
      defaultLinker = compiled.defaultLinker;
      slotLinkers = compiled.slotLinkers;
      transcludeMasters = buckets.defaultBucket;
      transcludeNamedMasters = buckets.slotBuckets;
      transcludeUnfilledRequired = buckets.unfilledRequired;
      // Spec 027 Slice 2: rebind `node` to the Comment placeholder for
      // the rest of `compileElementOrComment`. From this point onward
      // the per-element linker, the child snapshot, the
      // `$$ngBoundTransclude` stash, and the matched directive's
      // link-time `element` argument all operate against the Comment
      // — the original host element lives on only inside the captured
      // default bucket as a master fragment for deep-clone + re-link.
      if (buckets.replacementNode !== undefined) {
        node = buckets.replacementNode;
      }
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
          templateTimeLinkEntries.push({ post: compileResult, directive });
        } else {
          templateTimeLinkEntries.push({
            pre: compileResult.pre,
            post: compileResult.post,
            directive,
          });
        }
      }
    }

    // Spec 023 §2.6 — `ng-non-bindable` halts child descent. The
    // AngularJS-canonical semantic broadens `terminal: true` to ALSO
    // stop the walker from recursing into the matched element's
    // children. Spec 017's same-element terminal cutoff (in
    // `directive-collector.ts`) is preserved. The audit of the spec
    // 002–022 test suite found one test (`terminal.test.ts` —
    // "terminal does NOT affect descendants") that pinned the OLD
    // narrower semantic with a custom `terminal: true` directive plus
    // a child directive that asserted child compilation runs. Per the
    // spec 023 risk-mitigation guidance (tech-considerations §3), we
    // narrow the broadened semantic to the `ngNonBindable` name only —
    // every existing `terminal: true` consumer keeps the spec-017
    // same-element-only behavior. Slice 6 ships `ng-non-bindable` and
    // is the sole consumer of this opt-out path.
    const hasNonBindableTerminal = effectiveDirectives.some((d) => d.terminal && d.name === NG_NON_BINDABLE_NAME);

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
    if (hasChildren && !isAsyncTemplateHost && !hasNonBindableTerminal && isElement(node)) {
      for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes.item(i);
        if (isElement(child) || isComment(child)) {
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
          Object.defineProperty(target, NG_BOUND_TRANSCLUDE, {
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

      // ----- Spec 018 / Slice 3 + spec 027 / Slice 2: build $transclude closure -----
      //
      // The closure captures `parentScope` as the OUTER scope BEFORE
      // the `scope: true` child is created below — FS §2.5 acceptance
      // #1 requires `transcludedScope.$parent === outerScope`. The
      // host element receives a non-enumerable `$$ngBoundTransclude`
      // stash so the future `ng-transclude` marker (Slice 5) can find
      // it via parent-element walk.
      //
      // Spec 027 Slice 2 widens this site to ALSO fire when `target`
      // is the Comment placeholder produced by `kind: 'element'`
      // transclusion — the matched directive's link fn needs
      // `$transclude` as its 5th argument to mount its clone. The
      // `$$ngBoundTransclude` stash still lands on the Comment, but
      // `ng-transclude`'s `parentElement` walk skips Comments so the
      // stash is effectively only consumed by the directive's own
      // link fn (which receives `$transclude` directly anyway).
      let $transclude: TranscludeFn | undefined;
      if (transcludingDirective !== null && transcludeDecl !== null && (isElement(target) || isComment(target))) {
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
        Object.defineProperty(target, NG_BOUND_TRANSCLUDE, {
          value: bound,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      }

      // ----- Spec 022 Slice 1: isolate-scope conflict guard -----
      //
      // Two object-form `scope: { … }` directives on the same element
      // is unrecoverable — the element cannot host two isolate scopes.
      // Route the error and return early so downstream wiring doesn't
      // run against a partially-initialized state. The directive's
      // other behavior (link / compile / etc.) is intentionally skipped
      // for THIS element only; sibling elements continue to link.
      if (isolateConflict !== null && isElement(target)) {
        invokeExceptionHandler(
          exceptionHandler,
          new MultipleIsolateScopeError(
            isolateConflict.firstName,
            isolateConflict.secondName,
            target.tagName.toLowerCase(),
          ),
          '$compile',
        );
        return;
      }

      // Slice 10 — `scope: true` wiring (FS §2.12). Create the child
      // scope AFTER the `$transclude` closure is built so the closure
      // captures `parentScope` (the OUTER scope) rather than the
      // freshly-created child.
      //
      // Spec 022 Slice 1: when ANY directive on this element requested
      // an isolate scope (object-form `scope: { … }`), create the scope
      // via `parentScope.$new(true)` (isolate, no prototypal
      // inheritance) instead of `parentScope.$new()` (child).
      const isolate = isolateDirective !== null;
      const scope: Scope = needsChildScope ? parentScope.$new(isolate) : parentScope;
      if (needsChildScope && isElement(target)) {
        setElementScope(target, scope);
      }
      // Wire isolate bindings AFTER scope creation and BEFORE attrs are
      // bound to the scope (binding `@` reads attrs and seeds the
      // initial value; binding `<` / `=` parse `attrs[attrName]` strings).
      // The wiring uses `attrs` directly — the same view all link
      // functions see — and uses `parentScope` for parent-expression
      // evaluation (binding `<` / `=` / `&`) so values cross the isolate
      // boundary explicitly.
      //
      // Spec 022 Slice 2: only wire bindings on the SCOPE target here.
      // Directives with `bindToController` (form 1 or form 2) + a
      // controller defer binding-wiring to the per-element controller
      // seam below, which targets the instance. The two scope-target
      // cases that DO run here:
      //
      //  1. form 1 with no `bindToController` (existing Slice-1 path):
      //     `isolateDirective.isolateBindings` → isolate scope.
      //  2. form 1 with `bindToController: true` BUT no controller
      //     (the documented silent-degrade case): same source map,
      //     same scope target.
      //  3. form 2 (`bindToController: { … }`) without a controller:
      //     `directive.bindToControllerBindings` → existing scope on
      //     the element (which may be the parent or another
      //     directive's isolate scope; form 2 does NOT create one).
      if (isolate && shouldWireBindingsToScope(isolateDirective)) {
        wireIsolateBindings({
          parentScope,
          isolateScope: scope,
          attrs: attrs as Attributes,
          bindings: isolateDirective.isolateBindings as NormalizedBindingMap,
          target: scope as unknown as Record<string, unknown>,
          interpolate,
        });
      }
      const orphanForm2 = findOrphanedBindToControllerBindings(effectiveDirectives);
      if (orphanForm2 !== undefined) {
        wireIsolateBindings({
          parentScope,
          isolateScope: scope,
          attrs: attrs as Attributes,
          bindings: orphanForm2.bindToControllerBindings as NormalizedBindingMap,
          target: scope as unknown as Record<string, unknown>,
          interpolate,
        });
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
            liveLinkEntries.push({ post: compileResult, directive });
          } else {
            liveLinkEntries.push({
              pre: compileResult.pre,
              post: compileResult.post,
              directive,
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
      //
      // Spec 022 Slice 2: the seam now ALSO handles `bindToController`
      // — directives requesting instance-target binding wiring are
      // instantiated via `$controller(…, true)`'s deferred-alias path,
      // wired against the instance, then have their `controllerAs`
      // alias published on `scope`. `parentScope` is threaded through
      // so the binding wiring uses it for parent-expression evaluation.
      //
      // Spec 022 Slice 3: the seam additionally fires `$onInit` and the
      // initial synchronous `$onChanges`, registers `$onDestroy` via
      // `scope.$on('$destroy', …)`, and returns the controllers it
      // touched. The per-element linker walks the returned list
      // AFTER the post-link loop completes (see below) to invoke
      // `$postLink`.
      const requireResults = new Map<Directive, unknown>();
      let trackedControllers: TrackedController[] = [];
      // Spec 027 Slice 5: admit Comment placeholders so a
      // `transclude: 'element'` directive's children (e.g.
      // `ng-switch-when` with `require: '^ngSwitch'`) can resolve their
      // require against the ancestor chain. Mirrors the Slice-2
      // precedent at the `$$ngBoundTransclude` stash gate above.
      if (isElement(target) || isComment(target)) {
        trackedControllers = runControllerSeam(
          effectiveDirectives,
          scope,
          parentScope,
          target,
          attrs as Attributes,
          $transclude,
          requireResults,
        );
      }

      // ----- Spec 022 Slice 4: populate `requiredControllers` on each
      // link entry so the per-directive link fn receives the resolved
      // controllers as its 4th argument. For controller-having
      // directives the seam already resolved + auto-assigned (object
      // form) above; we just look up the cached result here. For
      // directives WITHOUT controllers but WITH `require`, we resolve
      // them on the fly so the 4th-arg contract still holds — this is
      // the canonical AngularJS pattern of a link-only directive
      // consuming a sibling's controller.
      //
      // Spec 027 Slice 5: also admit Comment placeholders so a
      // `transclude: 'element'` directive's children (e.g.
      // `ng-switch-when`) get their `require: '^ngSwitch'` populated.
      if (isElement(target) || isComment(target)) {
        resolveRequiredControllersForLinkEntries(target, effectiveLinkEntries, requireResults, exceptionHandler);
      }

      // Pre-link: priority-DESCENDING, runs BEFORE child linking.
      for (const entry of effectiveLinkEntries) {
        if (entry.pre !== undefined) {
          try {
            entry.pre(scope, target as Element, attrs as Attributes, entry.requiredControllers, $transclude);
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
            entry.post(scope, target as Element, attrs as Attributes, entry.requiredControllers, $transclude);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
          }
        }
      }

      // ----- Spec 022 Slice 3: `$postLink` dispatch -----
      //
      // Fires AFTER the per-element post-link loop completes — which
      // itself runs AFTER child linking. The order across the tree
      // is therefore CHILD `$postLink` (fired by the recursive
      // child linker) BEFORE parent `$postLink` (here), matching
      // AngularJS's "inside-out" semantics.
      firePostLinkHooks(trackedControllers);

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
  function drainDeferredTemplateQueue(entries: DeferredTemplateEntry[]) {
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
    const elementScope = isNgManagedElement(entry.element) ? entry.element[NG_SCOPE] : undefined;
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
      if (isElement(child) || isComment(child)) {
        childNodes.push(child);
      }
    }
    const childLinker = compileNodes(childNodes, childQueue);

    // Determine `scope: true` requirement on the pending directives.
    const needsChildScope = pendingDirectives.some((d) => d.scope);

    // Spec 022 Slice 1: detect isolate-scope directive among pending
    // directives (mirrors the synchronous-link pre-pass). At most one
    // is allowed; a second match routes `MultipleIsolateScopeError`
    // and the post-template link returns early.
    let pendingIsolateDirective: Directive | null = null;
    let pendingIsolateConflict: { firstName: string; secondName: string } | null = null;
    for (const directive of pendingDirectives) {
      if (directive.isolateBindings === undefined) {
        continue;
      }
      if (pendingIsolateDirective === null) {
        pendingIsolateDirective = directive;
        continue;
      }
      if (pendingIsolateConflict === null) {
        pendingIsolateConflict = { firstName: pendingIsolateDirective.name, secondName: directive.name };
      }
    }

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
        templateTimeLinkEntries.push({ post: compileResult, directive });
      } else {
        templateTimeLinkEntries.push({
          pre: compileResult.pre,
          post: compileResult.post,
          directive,
        });
      }
    }

    return (parentScope): void => {
      // ----- Spec 022 Slice 1: isolate-scope conflict guard (post-template path).
      if (pendingIsolateConflict !== null) {
        invokeExceptionHandler(
          exceptionHandler,
          new MultipleIsolateScopeError(
            pendingIsolateConflict.firstName,
            pendingIsolateConflict.secondName,
            element.tagName.toLowerCase(),
          ),
          '$compile',
        );
        return;
      }

      const isolate = pendingIsolateDirective !== null;
      const scope: Scope = needsChildScope ? parentScope.$new(isolate) : parentScope;
      if (needsChildScope) {
        setElementScope(element, scope);
      }
      // Wire isolate bindings BEFORE attrs are bound to scope so the
      // `@` binding's $observe seed reads the same `attrs[attrName]`
      // the synchronous path sees.
      //
      // Spec 022 Slice 2: as in the inline-link path, only the
      // SCOPE-target cases run here. `bindToController` + controller
      // routes binding wiring through the controller seam below.
      if (isolate && shouldWireBindingsToScope(pendingIsolateDirective)) {
        wireIsolateBindings({
          parentScope,
          isolateScope: scope,
          attrs,
          bindings: pendingIsolateDirective.isolateBindings as NormalizedBindingMap,
          target: scope as unknown as Record<string, unknown>,
          interpolate,
        });
      }
      const pendingOrphanForm2 = findOrphanedBindToControllerBindings(pendingDirectives);
      if (pendingOrphanForm2 !== undefined) {
        wireIsolateBindings({
          parentScope,
          isolateScope: scope,
          attrs,
          bindings: pendingOrphanForm2.bindToControllerBindings as NormalizedBindingMap,
          target: scope as unknown as Record<string, unknown>,
          interpolate,
        });
      }

      // Recover the bound transclude (if any) so directive pre/post
      // link callbacks receive the same `$transclude` they would have
      // received synchronously. Pre-link reads the stash directly.
      const bound = isNgManagedElement(element) ? element[NG_BOUND_TRANSCLUDE] : undefined;
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
      //
      // Spec 022 Slice 2 — `bindToController` integration runs here
      // too: directives requesting instance-target bindings get
      // instantiated via the deferred-alias path inside `runControllerSeam`.
      //
      // Spec 022 Slice 3: `$onInit` / initial `$onChanges` / `$onDestroy`
      // wiring runs inside the seam exactly as in the synchronous path;
      // the returned `trackedControllers` list is walked AFTER the
      // post-link loop below to fire `$postLink`.
      const requireResults = new Map<Directive, unknown>();
      const trackedControllers = runControllerSeam(
        pendingDirectives,
        scope,
        parentScope,
        element,
        attrs,
        $transclude,
        requireResults,
      );

      // Spec 022 Slice 4 — populate `requiredControllers` on each link
      // entry (post-template link path). Same contract as the inline
      // path: controller-having directives have their require resolved
      // by the seam; controllerless `require` directives resolve here.
      resolveRequiredControllersForLinkEntries(element, templateTimeLinkEntries, requireResults, exceptionHandler);

      for (const entry of templateTimeLinkEntries) {
        if (entry.pre !== undefined) {
          try {
            entry.pre(scope, element, attrs, entry.requiredControllers, $transclude);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
          }
        }
      }
      childLinker(scope);
      for (const entry of templateTimeLinkEntries.slice().reverse()) {
        if (entry.post !== undefined) {
          try {
            entry.post(scope, element, attrs, entry.requiredControllers, $transclude);
          } catch (err) {
            invokeExceptionHandler(exceptionHandler, err, '$compile');
          }
        }
      }

      // ----- Spec 022 Slice 3: `$postLink` dispatch (post-template
      // link path). Same contract as the synchronous link site.
      firePostLinkHooks(trackedControllers);
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
function pairChildren(masters: readonly Node[], cloneParent: Element, parentMap: Map<Node, Node>) {
  const cloneChildren: Node[] = [];
  for (let i = 0; i < cloneParent.childNodes.length; i++) {
    const child = cloneParent.childNodes.item(i);
    if (isElement(child) || isComment(child)) {
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

function isNodeList(value: unknown): value is NodeList {
  return typeof NodeList !== 'undefined' && value instanceof NodeList;
}

const noopLinker: NodeLinker = () => {
  /* intentionally empty — text-and-other node types and empty children both reach this branch */
};
