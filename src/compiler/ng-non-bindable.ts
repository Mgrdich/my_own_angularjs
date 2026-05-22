/**
 * `ngNonBindable` — opt a subtree out of compilation (spec 023 Slice 6 /
 * FS §2.6, technical-considerations §2.6).
 *
 * `<pre ng-non-bindable>{{ literal }}</pre>` marks the subtree under
 * the element as content the framework should leave alone: literal
 * `{{ … }}` mustaches stay verbatim, directive-looking text on child
 * elements is never matched, and `$interpolate` is not invoked against
 * any text node inside. Useful for documentation pages, code samples,
 * developer-tools panels — anywhere the template needs to display
 * AngularJS-style markup as literal characters.
 *
 * **Mechanism — interaction with the Slice 1 compiler extension.**
 *
 * The directive itself is pure metadata: it declares no `compile` and
 * no `link` function. Its presence on an element is detected by the
 * compiler walker in `src/compiler/compile.ts` via the Slice 1 hook —
 * `compileElementOrComment` skips recursion into `element.childNodes`
 * when ANY matched directive on the current element has
 * `terminal === true` AND `directive.name === 'ngNonBindable'`. Spec 017
 * had already implemented the same-element half of `terminal: true`
 * (the directive-collector cutoff that prevents lower-priority same-
 * element directives from running); this directive simply opts into
 * that cutoff with `priority: 1000` while also triggering the Slice 1
 * walker hook by registering under the exact name `'ngNonBindable'`.
 *
 * **Why the no-descent semantic is NARROWED to this directive.** A
 * spec 002–022 audit found one existing test
 * (`src/compiler/__tests__/terminal.test.ts:178–228`) that pinned the
 * OLD narrower semantic against a custom `terminal: true` directive
 * plus a child directive — i.e. it asserted "`terminal: true` does
 * NOT stop descent into children." To preserve that pre-existing
 * invariant for every other `terminal: true` consumer, the Slice 1
 * walker hook is gated on `directive.name === 'ngNonBindable'`
 * specifically. The broadened AngularJS-canonical semantic is therefore
 * applied ONLY to this directive — not to every `terminal: true`
 * directive in the codebase. This is the deliberate narrowing
 * documented in the spec brief; tasks.md Slice 1 audit row captures
 * the decision.
 *
 * **Same-element cutoff.** `priority: 1000` puts `ngNonBindable` above
 * every reasonable user directive (the AngularJS default priority is
 * `0`). Combined with `terminal: true` and the spec-017 directive-
 * collector cutoff, this means a lower-priority directive declared on
 * the SAME element as `ngNonBindable` does NOT run — its compile / link
 * are pruned alongside the child walk. The host element's OWN raw
 * attributes (e.g. `class="foo"`) still survive because they are plain
 * DOM, not directives, and `ngNonBindable` does not touch the element
 * itself.
 *
 * `restrict: 'AC'` lets consumers use either form:
 *
 * - Attribute form: `<pre ng-non-bindable>…</pre>`
 * - Class form: `<pre class="ng-non-bindable">…</pre>`
 *
 * The directive installs NO watchers and has zero per-digest cost — its
 * effect is entirely a compile-time signal to the walker.
 *
 * The factory is array-form (`[() => ({...})]`) because the project's
 * `annotate` helper rejects bare functions without `$inject` — this is
 * the same canonical shape used by `ngCloak` and every other built-in
 * directive on `ngModule`.
 *
 * @example Attribute form — literal `{{ }}` preserved
 * ```html
 * <pre ng-non-bindable>{{ this stays literal }}</pre>
 * <!-- After $compile reaches the element + a digest:
 *      element.textContent === '{{ this stays literal }}'
 *      (the mustache is NOT interpolated). -->
 * ```
 *
 * @example Class form — child directives do not run
 * ```html
 * <div class="ng-non-bindable">
 *   <span my-directive>{{ ignored }}</span>
 * </div>
 * <!-- After $compile:
 *      - my-directive's link function is NOT invoked.
 *      - {{ ignored }} stays in the rendered text verbatim. -->
 * ```
 */

import type { DirectiveFactory, DirectiveFactoryReturn } from './directive-types';

/**
 * Normalized directive name used at THREE coupled sites:
 *   1. Registration: `$compileProvider.directive(NG_NON_BINDABLE_NAME, …)`
 *      in `src/core/ng-module.ts`.
 *   2. Walker gate: `d.name === NG_NON_BINDABLE_NAME` in
 *      `compileElementOrComment` (`src/compiler/compile.ts`) — the
 *      no-descent extension is narrowed to THIS directive only.
 *   3. The directive's own factory below (re-exported for documentation).
 *
 * Keeping the literal in one place means a rename touches all three call
 * sites at once. A drift between (1) and (2) would silently break the
 * directive — no compile error, no test failure unless a specific
 * regression test catches it.
 */
export const NG_NON_BINDABLE_NAME = 'ngNonBindable';

function ngNonBindableFactory(): DirectiveFactoryReturn {
  // Pure metadata — no `compile`, no `link`. The directive's effect is
  // delivered entirely by the Slice 1 walker hook (no-descent into
  // children, gated on `directive.name === 'ngNonBindable'`) and the
  // spec-017 directive-collector cutoff (same-element lower-priority
  // directives pruned). `priority: 1000` outranks every reasonable user
  // directive so the cutoff catches them.
  return {
    restrict: 'AC',
    terminal: true,
    priority: 1000,
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngNonBindable', ngNonBindableDirective)`.
 * Zero dependencies — the `annotate` helper rejects bare functions, so
 * the factory is wrapped in the canonical array form even though its
 * dependency list is empty.
 */
export const ngNonBindableDirective: DirectiveFactory = [ngNonBindableFactory];
