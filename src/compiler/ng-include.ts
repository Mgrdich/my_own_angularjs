/**
 * `ngInclude` — async template inclusion (spec 027 Slice 6 / FS §2.3,
 * technical-considerations §2.4).
 *
 * `<div ng-include="'partials/header.html'"></div>` (attribute form) and
 * `<ng-include src="'partials/header.html'"></ng-include>` (element
 * form) both watch a scope expression yielding a URL string, fetch the
 * template through `$templateRequest`, compile + link the resulting
 * markup against a fresh child scope, and insert the rendered subtree
 * inline at the directive's slot. Subsequent URL changes swap the
 * content (old subtree torn down, new template fetched + rendered);
 * `null` / `undefined` / empty-string clears the slot.
 *
 * **URL source dispatch at link time.** The directive accepts the URL
 * from either of two attribute slots:
 *   - `attrs.ngInclude` — attribute form `<div ng-include="…">`.
 *   - `attrs.src` — element form `<ng-include src="…">`.
 * The link fn prefers `ngInclude`; if not present, it falls back to
 * `src`. The fallback is symmetric — both forms run THIS factory
 * (`restrict: 'ECA'` matches both attribute-on-arbitrary-element AND
 * element-tag-form `<ng-include>` because directive-name normalization
 * camelizes the element tag to `ngInclude`). Only the watched attribute
 * differs.
 *
 * **DDO shape and registration.** `restrict: 'ECA'`, `priority: 400`,
 * `terminal: true`, `transclude: 'element'`. The Slice 2 foundation
 * (`transclude: 'element'`) replaces the host element at compile time
 * with a `<!-- ngInclude: <attrValue> -->` Comment placeholder; the
 * matched directive's link fn receives the placeholder Comment as its
 * `element` argument. The link fn never USES `$transclude` itself —
 * the master fragment captured by Slice 2 carries the directive's
 * original ATTRIBUTES (which include the `src` / `ng-include`
 * expression) but its CONTENT is irrelevant: `ngInclude` REPLACES the
 * slot with the fetched-and-compiled template, it does not project
 * the original host's children. Declaring `transclude: 'element'` is
 * the canonical way to take ownership of the slot via a Comment
 * placeholder (and to participate in the "two structural directives
 * on the same element" detection that reuses
 * `MultipleTranscludeDirectivesError` from Slice 2).
 *
 * **Stale-fetch sentinel.** The closure-local `currentLoadToken` is a
 * monotonic identity object (`{}`) bumped on every load. The
 * resolve/reject callbacks capture the value at fetch-start time and
 * compare it against the closure-local on settlement; a mismatch
 * silently drops the install (the URL has since changed OR the
 * directive's scope has been destroyed and a parent cleanup ran the
 * registered teardown). Without this, a fetch resolving AFTER the
 * surrounding scope was destroyed would install a freshly-compiled
 * subtree into a torn-down DOM hole — a scope leak: the new child
 * scope would be unreachable from the parent's `$$children` (parent
 * is destroyed) but its watcher tree would still hold references to
 * everything it watches. The sentinel is the only mechanism preventing
 * that leak; the targeted regression test pins the behavior.
 *
 * **Lazy `$sce` probe.** `$sce` is registered on `ngModule` so it is
 * always reachable when `ngInclude` is, but the probe is intentionally
 * lazy — `$injector.has('$sce') ? $injector.get('$sce').getTrustedResourceUrl(url) : url`
 * — to mirror `$SceProvider.$get`'s lazy `$sanitize` lookup (spec 013).
 * The factory does NOT declare `'$sce'` as a hard dependency, so a
 * stripped-down injector lacking `$sce` (hypothetical SSR / Node
 * environment) would still resolve `ngInclude` and treat URLs as
 * pass-through. When `$sce` IS reachable, cross-origin URLs that fail
 * the trusted-resource-URL safelist throw from inside
 * `getTrustedResourceUrl`; the throw is caught and routed via
 * `$exceptionHandler('$compile')`, the `$includeContentError` event is
 * emitted, and the slot is cleared.
 *
 * **Three scope-event emissions.** Each emission uses
 * `scope.$emit(...)` (bubbles up the scope tree, matching AngularJS-
 * canonical behavior). The events are stable observable contract:
 *   1. `$includeContentRequested` — emitted with the requested URL
 *      BEFORE the fetch starts (after the empty/nullish gate but
 *      before the trust check, so consumers see the "load attempt"
 *      regardless of trust outcome).
 *   2. `$includeContentLoaded` — emitted with the loaded URL AFTER the
 *      template has been parsed, compiled, linked, and inserted into
 *      the DOM. The `onload` modifier (if any) fires immediately after
 *      this event.
 *   3. `$includeContentError` — emitted with the failing URL on any
 *      failure path (trust rejection, fetch rejection). The slot is
 *      cleared as part of the same error-handling branch.
 *
 * **`onload` parent-scope evaluation.** `<div ng-include="…" onload="counter = counter + 1">`
 * parses `attrs.onload` once at compile time and evaluates the parsed
 * expression against the PARENT scope (the scope the directive's link
 * fn was invoked with) on each successful `$includeContentLoaded` —
 * NOT against the included template's fresh child scope. This is
 * AngularJS-canonical: the `onload` expression names variables in the
 * caller's namespace (`counter` belongs to the outer view, not to the
 * partial). Mirrors `controllerAs`'s parent-scope-publication rule
 * (spec 020). If `attrs.onload` is missing/empty, no expression is
 * parsed and no evaluation happens.
 *
 * **Cleanup contract via `addElementCleanup(placeholder, …)`.** A
 * single cleanup callback is registered at link time against the
 * placeholder Comment. The callback closes over the closure-local
 * refs (`currentScope` / `currentClone`) so it ALWAYS tears down the
 * currently-active clone (not whatever was active when the
 * registration ran). Comment nodes have no `children` HTMLCollection
 * for `destroyElementScope` to walk, so this is the directive-author's
 * responsibility (per the Slice 2 cleanup-wiring documentation in
 * `transclude-capture.ts`'s TSDoc). The same callback also nulls
 * `currentLoadToken` indirectly via the next load's `thisToken`
 * mismatch — a registered teardown that runs AFTER a fetch was
 * initiated correctly causes the resolution callback to drop the
 * install when it eventually settles.
 *
 * **Why no `MultipleTranscludeDirectivesError` special-case.** The
 * same-element conflict detection (`<div ng-if="a" ng-include="…">`)
 * is handled automatically by Slice 2's foundation in
 * `transclude-capture.ts` — two `transclude: 'element'` directives on
 * the same host throw `MultipleTranscludeDirectivesError` routed via
 * `$exceptionHandler('$compile')` at compile time, before this link
 * fn ever runs. No additional check is needed here.
 *
 * **Errors.** No new error classes. No new `EXCEPTION_HANDLER_CAUSES`
 * token. Every error site reuses `'$compile'`:
 *   - SCE-rejection on `getTrustedResourceUrl` throw.
 *   - `$templateRequest` rejection (404, network failure).
 *   - A throwing `$compile` invocation on the parsed template (e.g.
 *     a malformed directive inside the fetched HTML).
 * A throwing `$watch` listener on the URL expression itself routes via
 * the digest's existing `'watchListener'` cause. The `onload`
 * modifier's expression evaluation runs OUTSIDE the watch listener
 * (in the fetch-resolution callback) — a throw from it propagates out
 * of the promise chain and is collected by the standard
 * unhandled-rejection surface; consumers who care about `onload`
 * errors should wrap them in their own try/catch inside the
 * expression. The tuple stays at 10.
 *
 * @example Attribute form
 * ```html
 * <div ng-include="'partials/header.html'"></div>
 * <!-- After compile + first digest:
 *      <!-- ngInclude: 'partials/header.html' -->
 *      <header>…fetched content…</header>
 *      The directive's link fn fired $includeContentRequested,
 *      called $templateRequest('partials/header.html'),
 *      parsed + compiled the HTML on resolve, inserted it as the
 *      next sibling of the placeholder, and emitted
 *      $includeContentLoaded. -->
 * ```
 *
 * @example Element form
 * ```html
 * <ng-include src="'partials/header.html'"></ng-include>
 * <!-- Identical behavior; the URL is read from attrs.src instead of
 *      attrs.ngInclude. -->
 * ```
 *
 * @example `onload` modifier
 * ```html
 * <div ng-include="page" onload="counter = counter + 1"></div>
 * <!-- Each successful load increments `counter` on the PARENT scope.
 *      Changing `page` from 'a.html' to 'b.html' triggers a second
 *      load + a second `counter` increment. -->
 * ```
 */

import type { Scope } from '@core/index';
import type { Injector } from '@di/index';
import { invokeExceptionHandler, type ExceptionHandler } from '@exception-handler/index';
import { parse } from '@parser/index';
import type { SceService } from '@sce/sce-types';
import type { TemplateRequestFn } from '@template/template-types';

import { addElementCleanup } from './cleanup';
import type { CompileService, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';
import { isComment } from './node-guards';
import { parseTemplate } from './template-parse';

/**
 * Normalized directive name. Module-private — only the registration in
 * `src/core/ng-module.ts` consumes the re-export. The element-form
 * `<ng-include>` tag normalizes to the SAME name via the AngularJS-
 * canonical directive-name normalization (camelize after stripping the
 * leading `ng-` separator), so registering once under `'ngInclude'`
 * covers both forms.
 */
export const NG_INCLUDE_NAME = 'ngInclude';

/**
 * Attribute name read for the element form `<ng-include src="…">`.
 * Defensive constant so a future rename touches both this file and
 * (if applicable) any documentation referencing the slot.
 */
const SRC_ATTR_NAME = 'src';

/**
 * Attribute name read for the optional `onload="expr"` modifier. The
 * expression is parsed once at compile time and evaluated against the
 * PARENT scope after every successful load (see file-level TSDoc).
 */
const ONLOAD_ATTR_NAME = 'onload';

function ngIncludeFactory(
  $templateRequest: TemplateRequestFn,
  $compile: CompileService,
  $injector: Injector,
  $exceptionHandler: ExceptionHandler,
): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    // The runtime `element` is the Comment placeholder Slice 2 installed
    // in place of the host element. The public LinkFn types it as
    // `Element`, but the Slice 2 `transclude: 'element'` foundation
    // guarantees a `Comment` at runtime — verify with the existing
    // guard and throw on mismatch rather than casting through
    // `unknown`. Matches the spec 027 Slice 3 / Slice 5 precedent.
    if (!isComment(element)) {
      throw new Error(`ngInclude: expected placeholder to be a Comment, got nodeType ${String(element.nodeType)}`);
    }
    const placeholder = element;

    // URL source dispatch: prefer `attrs.ngInclude` (attribute form),
    // fall back to `attrs.src` (element form). Both forms invoke this
    // same factory; only the attribute carrying the expression differs.
    // The directive shouldn't have matched without ONE of the two being
    // present, but the defensive bail keeps a hypothetical future seam
    // change from null-dereffing the watch installer below.
    const srcExpr = attrs[NG_INCLUDE_NAME] ?? attrs[SRC_ATTR_NAME];
    if (typeof srcExpr !== 'string') {
      return;
    }

    // Parse the optional `onload` expression ONCE at link time. The
    // parsed function is reused across every successful load. A missing
    // attribute (or empty string) leaves `onloadFn` null and the
    // post-load evaluation is skipped.
    const onloadRaw = attrs[ONLOAD_ATTR_NAME];
    const onloadFn = typeof onloadRaw === 'string' && onloadRaw.length > 0 ? parse(onloadRaw) : null;

    // Closure-local state shared between the $watch listener and the
    // single addElementCleanup callback registered below. All three
    // fields mutate in lock-step on each load — `currentLoadToken` on
    // load START, `currentClone` / `currentScope` on load SUCCESS, and
    // all three reset to null on `clearCurrentClone()` (the teardown
    // path used by both the empty/nullish branch and the error branch).
    let currentClone: Element | null = null;
    let currentScope: Scope | null = null;
    let currentLoadToken: object | null = null;

    /**
     * Tear down the currently-mounted clone (if any). Destroys the
     * child scope BEFORE detaching from the DOM so any
     * `$on('$destroy', …)` listeners that read DOM state still observe
     * the live tree (mirrors `ng-if`'s teardown order). Resets ALL
     * three closure-locals so the next load starts clean.
     *
     * The `currentLoadToken` reset is what makes a registered cleanup
     * callback (invoked via `destroyElementScope` reaching the
     * placeholder) ALSO short-circuit a pending fetch: the next
     * resolution `thisToken === currentLoadToken` check fails because
     * `currentLoadToken` is now null.
     */
    const clearCurrentClone = () => {
      if (currentScope !== null) {
        currentScope.$destroy();
      }
      if (currentClone !== null) {
        currentClone.remove();
      }
      currentClone = null;
      currentScope = null;
      currentLoadToken = null;
    };

    // Register the cleanup callback ONCE at link time. The closure-
    // bound `clearCurrentClone` always reads the CURRENTLY-ACTIVE
    // refs from the enclosing scope, so a single registration covers
    // every URL transition. Re-registering on each load would push
    // duplicate entries onto the placeholder's cleanup queue (mostly
    // harmless — `clearCurrentClone` is idempotent — but wasteful).
    addElementCleanup(placeholder, () => {
      clearCurrentClone();
    });

    // Also register a scope-destroy listener so a fetch resolving
    // AFTER the surrounding scope is torn down does NOT install a
    // freshly-compiled subtree into a torn-down DOM hole. The
    // `addElementCleanup` registration above only fires when an
    // ancestor structural directive walks its cleanup queue (e.g.
    // ng-if removing the placeholder); a plain `scope.$destroy()`
    // on the surrounding scope (without a parent DOM teardown)
    // would NOT reach that callback. Hooking `$destroy` directly
    // closes the gap. `clearCurrentClone` nulls `currentLoadToken`,
    // so the pending fetch's stale-check (`currentLoadToken !==
    // thisToken`) catches the install attempt on settlement.
    scope.$on('$destroy', clearCurrentClone);

    scope.$watch(srcExpr, (newSrc: unknown) => {
      // Empty / nullish: tear down current clone if any, leave slot
      // empty. Treat empty string the same as null/undefined to match
      // AngularJS — an explicit `ng-include=""` clears the slot.
      if (newSrc === null || newSrc === undefined || newSrc === '') {
        clearCurrentClone();
        return;
      }

      // After the empty/nullish gate, the URL expression's value MUST
      // be a string — `$templateRequest`'s public signature accepts
      // `(url: string, …)`, and a non-string here is a programming
      // error (the consumer's expression yielded e.g. an object or
      // number). Coerce defensively rather than risk `[object Object]`
      // landing in the fetch URL. The `@typescript-eslint/no-base-to-string`
      // rule flags `String(unknown)` because it can produce that exact
      // failure mode; gating on `typeof === 'string'` keeps the type
      // narrowing observable and the coercion explicit.
      if (typeof newSrc !== 'string') {
        // Treat a non-string URL the same as the empty/nullish path —
        // clear the slot and bail. Matches AngularJS's behavior
        // (its parser yields the expression's value verbatim; a
        // non-string value is silently treated as "no template").
        clearCurrentClone();
        return;
      }

      // Bump the sentinel BEFORE any async work. Capture the new value
      // in `thisToken` so the eventual resolve/reject callbacks compare
      // against IT, not the closure-local — the closure-local will be
      // overwritten by any subsequent URL change before this fetch
      // settles.
      const thisToken = {};
      currentLoadToken = thisToken;

      // Emit the "load attempt" event regardless of trust outcome. The
      // requested URL is what the consumer wrote, NOT the trusted-
      // resource-URL coercion result — consumers wiring telemetry
      // through this event observe the original expression value.
      scope.$emit('$includeContentRequested', newSrc);

      // Lazy `$sce` probe. The factory does NOT declare `'$sce'` as a
      // hard dependency (matches the `$SceProvider.$get` lazy
      // `$sanitize` lookup precedent — spec 013); a stripped-down
      // injector lacking `$sce` would treat URLs as pass-through. When
      // `$sce` IS reachable, cross-origin URLs that fail the trusted-
      // resource-URL safelist throw from `getTrustedResourceUrl`. The
      // throw is caught here (not in the promise chain) so the error
      // path stays synchronous: handler routes via `'$compile'`, the
      // `$includeContentError` event fires, and the slot clears.
      let resolvedSrc: string;
      try {
        if ($injector.has('$sce')) {
          const sce = $injector.get<SceService>('$sce');
          // `getTrustedResourceUrl` returns `unknown` (the SCE typing
          // is intentionally loose to support trusted-wrapper passthrough);
          // we narrow to string for `$templateRequest`. A non-string
          // return would be a programming error in a custom SCE
          // implementation — we accept the runtime risk for the
          // typing simplification, matching the SCE consumer pattern
          // elsewhere in the codebase.
          const trusted = sce.getTrustedResourceUrl(newSrc);
          resolvedSrc = typeof trusted === 'string' ? trusted : String(trusted);
        } else {
          resolvedSrc = newSrc;
        }
      } catch (err: unknown) {
        invokeExceptionHandler($exceptionHandler, err, '$compile');
        scope.$emit('$includeContentError', newSrc);
        clearCurrentClone();
        return;
      }

      // Fire the fetch. `$templateRequest` handles cache hits +
      // in-flight deduplication transparently — repeated loads of the
      // same URL settle off the cache (synchronously on the microtask
      // queue) without re-issuing network requests.
      $templateRequest(resolvedSrc).then(
        (html: string | undefined) => {
          // Stale-fetch check. If the URL changed (or the directive
          // was destroyed) since this fetch started, drop the install
          // silently. Without this, a fetch resolving AFTER the
          // surrounding scope was destroyed would install a freshly-
          // compiled subtree into a torn-down DOM hole (scope leak).
          if (currentLoadToken !== thisToken) {
            return;
          }

          // Defensive — `$templateRequest` resolves to `string` on
          // success and `undefined` only on the `ignoreRequestError`
          // suppression path (which we do not opt into). A missing
          // payload is treated as an empty template; the slot ends up
          // empty after the clear + no-op compile path.
          if (html === undefined) {
            clearCurrentClone();
            scope.$emit('$includeContentLoaded', newSrc);
            return;
          }

          // Tear down the previously-mounted clone BEFORE installing
          // the new one. The order matches `ng-if` / `ng-switch` —
          // `cloneScope.$destroy()` first, then detach from DOM.
          clearCurrentClone();

          // Re-stamp the load token immediately. `clearCurrentClone`
          // nulled it as part of the standard reset; we need it set
          // again so the cleanup callback registered above still
          // observes the in-progress load against THIS token (the
          // post-clear cleanup-callback fires the same way for any
          // active mount, but keeping the token in sync with the
          // active scope is the invariant the rest of the code
          // assumes).
          currentLoadToken = thisToken;

          // Parse the fetched HTML into a Node[] (spec 019's helper).
          // Wrap in a fresh container `<div>` so `$compile` has a
          // single Element to walk; after compile+link, transfer the
          // container's children to the placeholder's slot. We never
          // insert the container itself into the live DOM — only its
          // (now-compiled-and-linked) children.
          const parsedNodes = parseTemplate(html);
          const container = document.createElement('div');
          for (const tplNode of parsedNodes) {
            container.appendChild(tplNode);
          }

          // Fresh child scope for the included template. The
          // resolved-template runs in a NEW child scope (a child of
          // the surrounding scope, not an isolate) — FS §2.3
          // acceptance criterion. When the URL changes or the
          // directive is destroyed, this child scope is `$destroy()`-ed
          // by `clearCurrentClone`.
          const newScope = scope.$new();

          // Compile + link the parsed template against the new scope.
          // A throw from compile / link (e.g. a malformed directive
          // inside the fetched HTML) routes via the standard
          // `'$compile'` catch path inside the compiler — but
          // defensive try/catch keeps the rest of our cleanup path
          // intact even if a hypothetical future seam lets a throw
          // escape compile.
          try {
            $compile(container)(newScope);
          } catch (err: unknown) {
            invokeExceptionHandler($exceptionHandler, err, '$compile');
            // Tear down the half-mounted state: destroy the new scope
            // before discarding it so any watchers installed during
            // link unwind cleanly. The container is unreferenced
            // (never inserted) so it goes to GC on its own.
            newScope.$destroy();
            scope.$emit('$includeContentError', newSrc);
            clearCurrentClone();
            return;
          }

          // Insert the wrapper container itself (with its compiled +
          // linked children inside) as the next sibling of the
          // placeholder. The container is a plain `<div>` that holds
          // the included template's nodes as its descendants. Treating
          // a single wrapper Element as the "currentClone" keeps the
          // teardown path simple: `currentClone.remove()` detaches the
          // whole subtree in one call, no sibling walk needed, no
          // matter how many top-level nodes the fetched template had.
          //
          // Trade-off: consumer CSS rules using direct-child selectors
          // against a parent of `ng-include` (e.g. `.list > .item`)
          // see the wrapper interposed and may need descendant
          // selectors instead. This divergence from AngularJS-1.x's
          // inline-sibling insertion is documented; a future spec may
          // switch to a sibling-walk teardown if test coverage demands
          // inline insertion.
          placeholder.parentNode?.insertBefore(container, placeholder.nextSibling);
          currentClone = container;
          currentScope = newScope;

          // Emit the success event AFTER the DOM is in its final
          // state (mirrors AngularJS — observers reading the DOM
          // inside the listener see the rendered subtree).
          scope.$emit('$includeContentLoaded', newSrc);

          // Evaluate the optional `onload` expression against the
          // PARENT scope (`scope` here IS the parent — `newScope` is
          // the child created above for the included template). The
          // expression names variables in the caller's namespace.
          // A throw propagates out of the promise chain (see
          // file-level TSDoc); the digest's subsequent watch fire
          // routes any scope mutation through the standard digest
          // cycle.
          if (onloadFn !== null) {
            onloadFn(scope);
          }
        },
        (err: unknown) => {
          // Same stale-fetch check on the rejection path — a fetch
          // that rejected AFTER the directive was destroyed should
          // not emit lingering events into a torn-down scope tree.
          if (currentLoadToken !== thisToken) {
            return;
          }
          invokeExceptionHandler($exceptionHandler, err, '$compile');
          scope.$emit('$includeContentError', newSrc);
          clearCurrentClone();
        },
      );
    });
  };

  return {
    restrict: 'ECA',
    priority: 400,
    terminal: true,
    transclude: 'element',
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngInclude', ngIncludeDirective)`. The
 * factory injects `$templateRequest` (fetch + cache + dedup),
 * `$compile` (compile the fetched template), `$injector` (lazy `$sce`
 * probe), and `$exceptionHandler` (error routing). The lazy `$sce`
 * probe avoids a hard dependency on `$sce` — see the file-level TSDoc
 * for the rationale (mirrors `$SceProvider.$get`'s lazy `$sanitize`
 * lookup).
 */
export const ngIncludeDirective: DirectiveFactory = [
  '$templateRequest',
  '$compile',
  '$injector',
  '$exceptionHandler',
  ngIncludeFactory,
];
