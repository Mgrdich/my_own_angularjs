/**
 * `a` — native-anchor override directive (spec 030 Slice 5 / FS §2.4,
 * technical-considerations §2.4).
 *
 * AngularJS ships a built-in directive that matches EVERY `<a>` element
 * and layers two browser-safety behaviors on top of the author's markup
 * WITHOUT taking ownership of the element. The directive is
 * `restrict: 'E'`, priority 0, non-terminal, and link-only — it adds
 * nothing to compilation and does not stop other `a` directives from
 * running. Because directive registration ACCUMULATES per name (see the
 * CLAUDE.md "Directive registration accumulates per name" invariant), an
 * app's own `$compileProvider.directive('a', …)` runs ALONGSIDE this
 * built-in, and it composes with attribute directives on the same anchor
 * such as `ng-click` and `ng-href`.
 *
 * **Behavior 1 — empty-link click guard (live, zero watches).**
 *
 * A bare `<a href="">` or `<a>` with no `href` is a common UI idiom for
 * "button-styled link whose behavior lives entirely in `ng-click`". The
 * browser default for an anchor with empty / missing `href` is to scroll
 * to the top of the page (navigating to the current URL), which is almost
 * never what the author wants. This directive registers a single native
 * `click` listener that reads `element.getAttribute('href')` AT CLICK
 * TIME and calls `event.preventDefault()` when the live value is `null`
 * (attribute absent) or `''` (attribute present but empty).
 *
 * Reading the href at click time — rather than caching it at link time —
 * is what makes the guard LIVE: by the time the user clicks, `ng-href`
 * (priority 99) may have written a real URL into the `href` attribute
 * during a digest. The guard sees that written value and does NOT
 * prevent navigation. Conversely an anchor whose `ng-href` resolves to
 * empty (attribute removed) is guarded again on the next click. No
 * `scope.$watch` is installed — the check costs nothing per digest and
 * runs only on actual clicks.
 *
 * The guard never mutates scope and never triggers a digest, so the
 * spec-026 `scope.$apply` `try/catch` workaround (see
 * `src/compiler/ng-event-directives.ts`) is deliberately NOT needed here:
 * there is no `$apply` / `$evalAsync` dispatch and therefore no throw to
 * route through `$exceptionHandler`.
 *
 * **Behavior 2 — new-tab `rel` hardening (reverse-tabnabbing defense).**
 *
 * An `<a target="_blank">` without `rel="noopener"` lets the opened page
 * reach back into the opener via `window.opener` (reverse tabnabbing).
 * The directive token-merges `noopener` and `noreferrer` into the
 * anchor's existing `rel` attribute whenever `target` is `'_blank'`. The
 * merge runs at TWO moments:
 *
 *  - Immediately at link time, so a STATIC `<a target="_blank">` is
 *    hardened without waiting for the first digest.
 *  - On every `attrs.$observe('target', …)` notification, so an
 *    interpolated / late-set `target` (`<a target="{{mode}}">`) is
 *    hardened the moment it resolves to `'_blank'`.
 *
 * The merge is IDEMPOTENT (a token already present is not duplicated) and
 * PRESERVES author tokens — `<a target="_blank" rel="license">` becomes
 * `rel="license noopener noreferrer"`, not `rel="noopener noreferrer"`.
 *
 * The hardening is ONE-WAY: once added, `noopener` / `noreferrer` are
 * never removed even if `target` later changes away from `_blank`. This
 * is intentional — the functional spec only requires the tokens be
 * "added to" the `rel` attribute, and stripping them on a transition back
 * would re-open the tabnabbing window for any click that races the next
 * digest. Leaving them in place is strictly safer and matches the
 * AngularJS-canonical behavior.
 *
 * **Module visibility.** Like every other built-in directive in this
 * package (`ngTransclude`, the spec 023–029 directives), `htmlAnchorDirective`
 * is exported from THIS file but NOT re-exported from `@compiler/index`
 * or the root barrel. It is reachable only through DI on `ngModule`
 * (`injector.get('aDirective')` when the app declares `'ng'` in its deps
 * chain). No new error classes, no new `EXCEPTION_HANDLER_CAUSES` token.
 *
 * The factory is array-form (`[() => ({...})]`) — the project's
 * `annotate` helper rejects bare functions without `$inject`, so the
 * zero-dependency factory is wrapped in the canonical array shape used by
 * every other no-dep built-in (e.g. `ng-non-bindable.ts`).
 *
 * @example Empty-link guard — `ng-click` button styled as a link
 * ```html
 * <a href="" ng-click="doThing()">Do the thing</a>
 * <!-- A click does NOT scroll to top / navigate: the click-time href
 *      read sees '' and calls event.preventDefault(). The ng-click
 *      expression still fires. -->
 * ```
 *
 * @example Live transition once `ng-href` writes a real URL
 * ```html
 * <a ng-href="{{profileUrl}}">Profile</a>
 * <!-- Before the first digest: no `href` attribute → a click is
 *      prevented (goes nowhere). After scope.profileUrl = '/me' + digest:
 *      `href="/me"` → the click-time read sees a non-empty value and
 *      navigation proceeds normally. -->
 * ```
 *
 * @example New-tab hardening preserves the author's `rel` token
 * ```html
 * <a href="https://example.com" target="_blank" rel="license">Terms</a>
 * <!-- After compile: rel="license noopener noreferrer" (idempotent,
 *      author's `license` token preserved). -->
 * ```
 */

import type { Attributes, DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

/**
 * Normalized directive name. Registered at
 * `$compileProvider.directive(HTML_ANCHOR_NAME, htmlAnchorDirective)` in
 * `src/core/ng-module.ts`. The literal `'a'` is the AngularJS-canonical
 * element-form match — every `<a>` element in a compiled template picks
 * this directive up.
 */
export const HTML_ANCHOR_NAME = 'a';

/** The two tokens merged into `rel` for `target="_blank"` anchors. */
const REL_HARDENING_TOKENS = ['noopener', 'noreferrer'] as const;

/**
 * Merge `noopener` / `noreferrer` into the anchor's current `rel`
 * attribute when `target` is `'_blank'`.
 *
 * Reads the current `rel` from the live DOM (`element.getAttribute('rel')`)
 * so the merge always operates on the most recent value, splits on
 * whitespace to recover the author's tokens, appends only the missing
 * hardening tokens (idempotent), and writes the re-joined value back
 * through `attrs.$set('rel', …)` — keeping `attrs.rel` and the DOM in
 * sync. A no-op when `target` is not `'_blank'` or when both tokens are
 * already present.
 */
function hardenRelForBlank(element: Element, attrs: Attributes, targetValue: string | undefined): void {
  if (targetValue !== '_blank') {
    return;
  }

  const currentRel = element.getAttribute('rel');
  // Split on any run of whitespace; the leading `''` produced by a
  // null / empty current value is filtered out by the `Boolean` pass.
  const tokens = (currentRel ?? '').split(/\s+/).filter(Boolean);

  let changed = false;
  for (const token of REL_HARDENING_TOKENS) {
    if (!tokens.includes(token)) {
      tokens.push(token);
      changed = true;
    }
  }

  if (changed) {
    // Idempotent: only write when we actually added a token, so an
    // already-hardened anchor doesn't churn the attribute (and observers).
    attrs.$set('rel', tokens.join(' '));
  }
}

function htmlAnchorFactory(): DirectiveFactoryReturn {
  const link: LinkFn = (scope, element, attrs) => {
    // --- Behavior 1: empty-link click guard (live, zero watches) ---
    const clickHandler = (event: Event) => {
      // Read at CLICK TIME so the check is live — sees values written by
      // `ng-href` (priority 99) during a prior digest. No $apply, no
      // scope mutation, no digest → the spec-026 $apply try/catch
      // workaround is intentionally NOT needed here.
      const href = element.getAttribute('href');
      if (href === null || href === '') {
        event.preventDefault();
      }
    };
    element.addEventListener('click', clickHandler);
    // Cleanup mirrors the `ng-event-directives.ts` add/remove pattern so
    // a destroyed-scope anchor still in the DOM stops guarding clicks.
    scope.$on('$destroy', () => {
      element.removeEventListener('click', clickHandler);
    });

    // --- Behavior 2: new-tab `rel` hardening (one-way, idempotent) ---
    // Immediate check covers a STATIC `target="_blank"` without waiting
    // for a digest; `attrs.target` is the link-time-normalized value.
    const initialTarget = attrs.target;
    hardenRelForBlank(element, attrs, typeof initialTarget === 'string' ? initialTarget : undefined);
    // Plus an observer for interpolated / late-set `target` values.
    attrs.$observe('target', (value) => {
      hardenRelForBlank(element, attrs, value);
    });
  };

  return {
    restrict: 'E',
    priority: 0,
    link,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('a', htmlAnchorDirective)`. Zero
 * dependencies — wrapped in the canonical array form because the
 * `annotate` helper rejects bare functions without `$inject`.
 */
export const htmlAnchorDirective: DirectiveFactory = [htmlAnchorFactory];
