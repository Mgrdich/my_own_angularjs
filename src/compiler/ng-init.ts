/**
 * `ngInit` — seed scope variables once at the point an element first
 * renders (spec 027 Slice 1 / FS §2.4, technical-considerations §2.5).
 *
 * `<div ng-init="count = 0; user = {name:'Alice'}">…</div>` evaluates
 * the expression exactly once against the link-time scope. Assignment
 * expressions land via the parser's runtime (spec 009's interpreter
 * already supports `=` against scope identifiers), so any binding inside
 * the same subtree reads the initialized values on its very first
 * render — no transient empty render, no flicker.
 *
 * **Why pre-link, not post-link.** The directive is wired through a
 * `compile` fn that parses the expression once at compile time and
 * returns a `{ pre }` link object. The pre-link callback fires BEFORE
 * the child directives' link phase descends into the subtree, so by
 * the time `{{user.name}}` (or any other binding inside the marked
 * element) is set up, `scope.user` is already populated. A post-link
 * evaluation would happen AFTER child bindings have already first-
 * rendered against the still-empty scope — `<div ng-init="user={…}">
 * <h1>{{user.name}}</h1></div>` would briefly render `<h1></h1>` before
 * the digest re-runs with the assignment in place. Pre-link timing is
 * the AngularJS-canonical fix and the load-bearing behavioral
 * guarantee of this directive.
 *
 * **Why no watch.** `ngInit` is a one-shot initializer, not a binding.
 * The expression evaluates exactly once per mount; subsequent digests
 * do NOT re-evaluate. If the element unmounts and remounts (e.g. via
 * a surrounding `ng-if` flipping false → true again, spec 027 Slice 3),
 * the new mount runs through compile + link again — including the
 * `ngInit` pre-link callback — so the expression fires once on each
 * mount. That semantic is part of the contract.
 *
 * **Priority 450.** The AngularJS-1.x value. Above the default `0` so
 * `ngInit` runs before regular directives that bind to its
 * assignments. Below `ngIf`'s 600 so a surrounding `ng-if` decision
 * wins. Above `ngInclude`'s 400 so `<div ng-include ng-init>`
 * initializes BEFORE the include fires.
 *
 * **`restrict: 'AC'`.** Both the attribute form
 * `<div ng-init="…">` and the class form `<div class="ng-init: …">`
 * are accepted. The spec's acceptance criteria call out only the
 * attribute form explicitly, but the class form falls out of the
 * `'AC'` restrict letter for free and matches AngularJS-1.x parity.
 *
 * The factory is array-form (`[() => ({...})]`) because the
 * project's `annotate` helper rejects bare functions without
 * `$inject` — this is the same canonical shape used by every other
 * built-in directive on `ngModule`.
 *
 * @example Seed scope state, render with initialized values immediately
 * ```html
 * <div ng-init="user = {name: 'Alice'}; count = 0">
 *   <h1>{{ user.name }}</h1>
 *   <span>{{ count }}</span>
 * </div>
 * <!-- After $compile + first digest:
 *      - <h1>Alice</h1> (no transient empty render)
 *      - <span>0</span> -->
 * ```
 *
 * @example Multi-statement (semicolon-separated)
 * ```html
 * <div ng-init="a = 1; b = 2; total = a + b">
 *   {{ total }}
 * </div>
 * <!-- Renders 3 on first paint. -->
 * ```
 */

import { parse } from '@parser/index';

import type { DirectiveFactory, DirectiveFactoryReturn, LinkFn } from './directive-types';

/**
 * Normalized directive name — registration in `ng-module.ts` and the
 * `attrs[NG_INIT_NAME]` lookup in this file are tied together via this
 * constant so a rename touches both sites at once.
 *
 * Module-private: the registration in `src/core/ng-module.ts` imports
 * this re-export; nothing else does.
 */
export const NG_INIT_NAME = 'ngInit';

function ngInitFactory(): DirectiveFactoryReturn {
  return {
    restrict: 'AC',
    priority: 450,
    compile: (_element, attrs) => {
      const exprString = attrs[NG_INIT_NAME];
      if (typeof exprString !== 'string') {
        // Defensive — `attrs['ngInit']` is typed as `string | undefined`
        // through the index signature. If the attribute is missing
        // entirely the directive shouldn't have matched, but bail
        // cleanly rather than passing `undefined` into `parse()`.
        // Matches the spec 023 / 024 / 025 / 026 defensive pattern.
        return;
      }
      // Parse the expression ONCE at compile time. The returned function
      // is reused across every link invocation against this compiled
      // subtree (relevant when the same template is linked against
      // multiple scopes, e.g. via transclusion in spec 018).
      const expressionFn = parse(exprString);

      const preLink: LinkFn = (scope) => {
        // Pre-link timing is the load-bearing guarantee — see file-level
        // TSDoc. Evaluating here ensures assignment-targets on scope
        // are populated BEFORE child directives' link phase descends
        // into the subtree, so bindings inside the marked element see
        // the initialized values on their very first render.
        //
        // The interpreter accepts the live `Scope` instance directly
        // (Scope's structural shape satisfies the parser's
        // `Record<string, unknown>` parameter — same pattern used by
        // `ng-event-directives.ts` and `ng-bind-template.ts`).
        // Identifier lookups walk the prototype chain via the parser's
        // runtime, and assignment-form expressions (`x = 1`) land on
        // the scope through the same path. No `$watch` is installed —
        // `ngInit` is a one-shot initializer per mount, not a binding.
        expressionFn(scope);
      };

      return { pre: preLink };
    },
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('ngInit', ngInitDirective)`. Zero
 * dependencies — the `annotate` helper rejects bare functions, so
 * the factory is wrapped in the canonical array form even though
 * its dependency list is empty.
 */
export const ngInitDirective: DirectiveFactory = [ngInitFactory];
