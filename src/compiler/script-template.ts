/**
 * `script` — inline `text/ng-template` registration directive (spec 030
 * Slice 1 / FS §2.1, technical-considerations §2.2).
 *
 * `<script type="text/ng-template" id="/tpl/card.html">…markup…</script>`
 * lets an app ship template fragments INLINE in its host document and
 * have them resolve later through the SAME `templateUrl` machinery a
 * networked template would use — but with ZERO network round-trip. At
 * compile time this directive reads the element's `textContent` and
 * `$templateCache.put`s it under the `id` attribute as the cache key.
 * A subsequent `templateUrl: '/tpl/card.html'` (or `ng-include`) then
 * finds the entry already present and skips the fetch entirely.
 *
 * **Registration contract.** The directive fires ONLY when both
 * conditions hold:
 *
 *   1. `attrs.type === 'text/ng-template'` — a `<script>` of any other
 *      type (e.g. a real `text/javascript` block) is left completely
 *      untouched, no cache write.
 *   2. `attrs.id` is present and non-empty — a missing / empty `id` is a
 *      SILENT no-op (no key to register under, no error). Mirrors
 *      AngularJS's lenient upstream behavior.
 *
 * The element is left in the DOM as-is; this directive never removes,
 * replaces, or rewrites the host node. `terminal: true` is upstream
 * parity — it triggers the spec-017 same-element directive-collector
 * cutoff so lower-priority same-element directives do not also run on
 * the `<script>`. Since spec 031 (text-node interpolation) the `script`
 * directive ALSO joins `ngNonBindable` on the no-descent walker hook
 * (the allow-list in `compile.ts`'s `haltsChildDescent` gate): now that
 * `{{ }}` in text nodes is compiled, the body of a
 * `<script type="text/ng-template">` must NOT be walked, or its
 * mustaches would be interpolated and rendered live where the script
 * stands. AngularJS treats script-template bodies as raw template text,
 * so the no-descent halt keeps the body structurally inert.
 *
 * **Last-wins semantics.** `$templateCache` is `Map`-backed, so two
 * `<script type="text/ng-template" id="x">` blocks with the same `id`
 * resolve to the LAST one's content — `put` overwrites the prior entry.
 * This matches AngularJS and the documented `$templateCache.put` Map
 * contract (see `src/template/template-cache.ts`).
 *
 * **Zero-network resolution path.** When `$templateRequest(url)` is
 * later called for a cached `id`, the cache-first check in
 * `src/template/template-request.ts` (around lines 161–166) returns the
 * stored string via `Promise.resolve(cached)` WITHOUT ever invoking the
 * fetcher — so an inline `<script>`-registered template costs no HTTP
 * request and resolves synchronously-then-microtask, never hitting the
 * network.
 *
 * The factory is array-form (`['$templateCache', scriptTemplateFactory]`)
 * because the project's `annotate` helper rejects bare functions without
 * `$inject` — the same canonical DI shape `ngPluralize` and the other
 * built-in directives use.
 *
 * @example Inline registration + zero-network reuse
 * ```html
 * <script type="text/ng-template" id="/tpl/card.html">
 *   <div class="card">{{ title }}</div>
 * </script>
 * <my-widget template-url="/tpl/card.html"></my-widget>
 * <!-- After $compile reaches the <script>:
 *      $templateCache.get('/tpl/card.html')
 *        === '\n  <div class="card">{{ title }}</div>\n'
 *      and the <my-widget> templateUrl resolves with no fetch. -->
 * ```
 *
 * @example Missing `id` — silent no-op
 * ```html
 * <script type="text/ng-template">ignored</script>
 * <!-- No cache write; the element is left untouched in the DOM. -->
 * ```
 */

import type { TemplateCacheService } from '@template/template-types';

import type { Attributes, DirectiveFactory, DirectiveFactoryReturn } from './directive-types';

/**
 * Normalized directive name used at the two coupled sites: the
 * `$compileProvider.directive(SCRIPT_TEMPLATE_NAME, …)` registration in
 * `src/core/ng-module.ts` and the factory below. AngularJS registers
 * this against the literal tag name `'script'` (restrict `'E'`).
 */
export const SCRIPT_TEMPLATE_NAME = 'script';

function scriptTemplateFactory(cache: TemplateCacheService): DirectiveFactoryReturn {
  return {
    restrict: 'E',
    // Upstream parity — same-element cutoff only (content safety is
    // structural here because this compiler has no text-node
    // interpolation). Default priority (0) is left implicit.
    terminal: true,
    compile(element: Element, attrs: Attributes): void {
      // Only register actual `text/ng-template` blocks; a missing / empty
      // `id` is a silent no-op (no key to put under). The `typeof` check
      // narrows the `Attributes` index union (which includes function /
      // record members) down to `string`.
      if (attrs.type === 'text/ng-template' && typeof attrs.id === 'string' && attrs.id !== '') {
        // `element.textContent` is non-nullable for an `Element` host (the
        // `string | null` union lives on `Node`); an empty `<script>` body
        // yields `''`, so no `?? ''` fallback is needed here.
        cache.put(attrs.id, element.textContent);
      }
    },
  };
}

/**
 * DI-annotated factory ready for
 * `$compileProvider.directive('script', scriptTemplateDirective)`.
 * Injects `$templateCache` so the compile fn can register inline
 * `text/ng-template` bodies under their `id`.
 */
export const scriptTemplateDirective: DirectiveFactory = ['$templateCache', scriptTemplateFactory];
