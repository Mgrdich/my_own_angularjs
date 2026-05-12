/**
 * Public TypeScript types for the DOM compiler.
 *
 * Slice 2 of spec 017 ships the minimum surface needed for an
 * attribute-restricted directive to register and run a post-link
 * function. Later slices grow this file with `$set` / `$observe`
 * (Slices 8 / 9), the full pre+post linker entry shape (Slice 3),
 * and `CompileOptions.flags` (Slice 6 / 7).
 *
 * The file is intentionally type-only — no runtime imports — so it
 * can be re-exported as `export type` from the public barrel.
 */

import type { Scope } from '@core/index';
import type { Injector, Invokable } from '@di/di-types';
import type { ExceptionHandler } from '@exception-handler/index';
import type { InterpolateService } from '@interpolate/interpolate-types';
import type { NormalizedTemplate, TemplateFn, TemplateRequestFn, TemplateUrlFn } from '@template/template-types';

import type { CloneAttachFn, NormalizedTransclude, TranscludeFn, TranscludeSlotName } from './transclude-types';

// Re-export the public transclusion types so directive authors can
// pull every signature they need from a single barrel
// (`@compiler/directive-types`). The internal types
// (`NormalizedTransclude`, `BoundTranscludeFn`) are NOT re-exported
// here — they remain visible to other compiler modules via direct
// `./transclude-types` import only.
export type { CloneAttachFn, TranscludeFn, TranscludeSlotName };

// Re-export the public template types so directive authors can pull
// the function-form `template` / `templateUrl` signatures from the
// same `@compiler/directive-types` barrel they already use for
// `LinkFn` / `CompileFn` / `DirectiveDefinition`. `NormalizedTemplate`
// is internal — re-exported for future structural directives — and
// is NOT surfaced through the public root barrel.
export type { NormalizedTemplate, TemplateFn, TemplateUrlFn };

/**
 * The shared {@link Attributes} object passed to every `compile`,
 * `pre-link`, and `post-link` invocation on a single element.
 *
 * Slice 8 adds `$set(name, value, writeAttr?)` — directives may now
 * mutate normalized attribute values, optionally sync the DOM, and
 * notify observers. `$observe` arrives in Slice 9; the runtime class
 * carries a throwing stub for it so the surface type stays consistent
 * across slices.
 *
 * @example
 * ```ts
 * const link: LinkFn = (_scope, element, attrs) => {
 *   const value = attrs['myDir'];
 *   const original = attrs.$attr['myDir']; // 'data-my-dir' | 'my-dir' | …
 *   attrs.$set('class', 'highlighted'); // updates attrs.class + element.className + observers
 * };
 * ```
 */
/**
 * The element-bound `$$scope`-aware mutator on the {@link Attributes}
 * surface. Defined as a standalone type so the index signature in
 * `Attributes` can include it without prose duplication.
 */
export type AttributesSetFn = (name: string, value: string | null, writeAttr?: boolean) => void;

/**
 * Observer callback signature passed to `$observe(name, fn)`. Receives
 * the new attribute value (or `undefined` after a `$set(name, null)`
 * removal). Defined as a standalone type so the {@link Attributes}
 * index signature can include the `$observe` slot without prose
 * duplication.
 */
export type AttributesObserveFn = (name: string, fn: (value: string | undefined) => void) => () => void;

export interface Attributes {
  readonly [normalizedName: string]:
    | string
    | undefined
    | Record<string, string>
    | AttributesSetFn
    | AttributesObserveFn;
  readonly $attr: Record<string, string>;
  $set: AttributesSetFn;
  $observe: AttributesObserveFn;
}

/**
 * Post-link / pre-link function signature.
 *
 * Receives the bound scope, the raw DOM `Element` (or `Comment` for
 * an M-restricted match in a future slice), the shared
 * {@link Attributes} for the element, an OPTIONAL `controllers`
 * placeholder reserved for the controllers spec, and an OPTIONAL
 * `$transclude` callable (spec 018) made available only when the
 * directive declares `transclude: true | { … }`. Returns nothing.
 *
 * **`controllers` is a stable placeholder.** Spec 018 defers the
 * controllers DDO; directives MUST NOT introspect this argument as
 * `undefined` until the controllers spec ships. The slot is preserved
 * so the future addition can fill it in without breaking the
 * signature. The TypeScript type is narrowed to `undefined` exactly
 * so accidental `controllers as ControllerInstance` casts surface at
 * compile time.
 *
 * **`$transclude` is `undefined` unless the directive's DDO declared
 * `transclude`.** TypeScript function-parameter subtyping keeps the
 * spec-017-canonical 3-arg `(scope, element, attrs)` callers
 * assignable to this widened type without source changes.
 *
 * Errors thrown from a link function are routed through
 * `$exceptionHandler` with cause `'$compile'` (spec 017 Slice 11).
 */
export type LinkFn = (
  scope: Scope,
  element: Element,
  attrs: Attributes,
  controllers?: undefined,
  $transclude?: TranscludeFn,
) => void;

/**
 * Compile function signature.
 *
 * Runs once per template (NOT per scope). May mutate the element in
 * place; its return value becomes the link function (or
 * `{ pre, post }`) for the directive.
 *
 * **`$transclude` lands as the 3rd argument on `compile`** since
 * `compile` has no `scope` / `controllers` slots (this matches
 * AngularJS exactly). The argument is `undefined` unless the
 * directive's DDO declared `transclude`. Spec-017-canonical 2-arg
 * `(element, attrs)` callers remain assignable.
 */
export type CompileFn = (
  element: Element,
  attrs: Attributes,
  $transclude?: TranscludeFn,
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- AngularJS-canonical: a directive's compile fn may legitimately return nothing (`void`) to signal "no link function". The union mirrors the public AngularJS API surface; rejecting `void` here would force callers into `undefined` returns that don't match the historical contract.
) => LinkFn | { pre?: LinkFn; post?: LinkFn } | void;

/**
 * Directive Definition Object — the rich form a factory may return.
 *
 * Slice 2 supports `restrict`, `priority`, `terminal`, `link`,
 * `compile`, `scope`, and `name`. The `Record<string, string>`
 * variant of `scope` is included only so the registration validator
 * can reject it with `IsolateScopeNotSupportedError`. Future slices
 * widen this interface (transclude, controller, template, …).
 */
export interface DirectiveDefinition {
  restrict?: string;
  priority?: number;
  terminal?: boolean;
  link?: LinkFn | { pre?: LinkFn; post?: LinkFn };
  compile?: CompileFn;
  scope?: false | true | Record<string, string>;
  name?: string;
  /**
   * Transclusion declaration (spec 018). Three shapes are accepted at
   * registration:
   *
   * - `true` — content transclusion (capture this element's children).
   * - `{ [slotName]: 'fill-tag' | '?fill-tag' }` — multi-slot
   *   transclusion (the multi-slot object form). `?` prefix declares
   *   an optional slot.
   * - `false` or omitted — no transclusion (default).
   *
   * `'element'` and any other runtime value are REJECTED at
   * registration with a typed error class routed via
   * `$exceptionHandler('$compile')`. See `compile-error.ts` for the
   * full surface. The runtime field shape is `unknown` here because
   * `normalizeDirective` validates the value lazily and the typed
   * field would force authors to import `NormalizedTransclude`
   * (which is internal).
   */
  transclude?: boolean | string | Record<string, string>;
  /**
   * Inline template (spec 019). Replaces the host element's children
   * before compile descends into the new subtree. Two shapes accepted:
   *
   * - `string` — an HTML fragment installed verbatim. Empty strings
   *   are REJECTED at registration with `EmptyTemplateError` routed
   *   via `$exceptionHandler('$compile')`.
   * - `TemplateFn` — `(element, attrs) => string`. Invoked exactly
   *   once per compile invocation per host element; the returned
   *   string is treated identically to the static form. Non-string
   *   return values route `TemplateFunctionReturnedNonStringError`.
   *
   * Mutually exclusive with `templateUrl`. Declaring both routes
   * `TemplateAndTemplateUrlCombinedError` at registration.
   *
   * Template installation slots BEFORE the per-directive `compile`
   * loop on the host (so `compile` sees the post-template DOM) and
   * AFTER transclude capture (so `transclude: true` + `template`
   * works as the canonical wrapper pattern).
   *
   * @example
   * ```ts
   * // Directive declaration:
   * $compileProvider.directive('myCard', () => ({
   *   restrict: 'E',
   *   scope: true,
   *   template: '<div class="card"><h2>{{title}}</h2></div>',
   *   link: (scope, _el, attrs) => { scope.title = attrs.title; },
   * }));
   *
   * // Consumer markup:
   * //   <my-card title="Settings"></my-card>
   * //
   * // After $compile(node)(scope) + $digest:
   * //   <my-card title="Settings">
   * //     <div class="card"><h2>Settings</h2></div>
   * //   </my-card>
   * //
   * // Host element preserved (tag + attributes); only children
   * // are replaced by the template content.
   * ```
   */
  template?: string | TemplateFn;
  /**
   * Async template URL (spec 019). Fetched via `$templateRequest`,
   * which reads from `$templateCache` first; on miss, calls the
   * configured `TemplateFetcher` (default: `globalThis.fetch`) and
   * stores the response back to the cache. The host element stays
   * empty until the fetch resolves; the deferred subtree is then
   * compiled and linked in a microtask. The public `Linker` signature
   * is unchanged — async work is internal.
   *
   * Two shapes accepted:
   *
   * - `string` — URL passed to `$templateRequest`. Empty strings are
   *   REJECTED at registration with `EmptyTemplateUrlError`.
   * - `TemplateUrlFn` — `(element, attrs) => string`. Invoked exactly
   *   once per compile invocation; the returned string is the URL.
   *   Non-string return values route
   *   `TemplateUrlFunctionReturnedNonStringError`.
   *
   * Mutually exclusive with `template` (routes
   * `TemplateAndTemplateUrlCombinedError`).
   *
   * Sync-linker contract: `$compile(node)(scope)` returns a synchronous
   * linker; the host's children stay empty immediately after
   * `linker(scope)` returns. The template installs in a microtask
   * after `$templateRequest` resolves. Tests `await Promise.resolve()`
   * (at least twice, defensively three times) to observe post-install
   * DOM state.
   *
   * @example
   * ```ts
   * // Register the directive in a config() block and pre-seed the
   * // cache from a run() block — config() cannot inject
   * // $templateCache (it's a .factory(), not a .provider()).
   * module.config(['$compileProvider', ($cp) => {
   *   $cp.directive('myCard', () => ({ templateUrl: '/tpl/card.html' }));
   * }]).run(['$templateCache', ($templateCache) => {
   *   $templateCache.put('/tpl/card.html', '<div class="card">…</div>');
   * }]);
   * // Compile + link returns synchronously; the host is empty
   * // immediately; the template installs in a microtask:
   * //
   * //   $compile(host)(scope);
   * //   expect(host.firstChild).toBeNull();
   * //   await Promise.resolve(); await Promise.resolve();
   * //   expect(host.firstElementChild?.className).toBe('card');
   * ```
   */
  templateUrl?: string | TemplateUrlFn;
  /**
   * @deprecated AngularJS 1.x deprecated `replace: true`; this project
   * does not ship it. The host element is ALWAYS preserved — its tag
   * name, attributes, and event listeners stay; only its children are
   * replaced by the template content.
   *
   * `replace: false` (the default) is accepted unchanged. Any other
   * runtime value — including `replace: true`, `replace: 'yes'`,
   * `replace: 1` — is REJECTED at registration with
   * `ReplaceTrueNotSupportedError` routed via
   * `$exceptionHandler('$compile')`. The directive's other behavior
   * (link, compile, transclude) continues to run; only the `replace`
   * declaration is rejected.
   *
   * @see ReplaceTrueNotSupportedError
   */
  replace?: boolean;
}

/**
 * The shape a directive factory may return.
 *
 * - **Function shape:** sugar for `{ link: fn, restrict: 'EA' }` —
 *   the function becomes the post-link.
 * - **Object shape:** a {@link DirectiveDefinition} with explicit
 *   `restrict` / `priority` / `compile` / `link` / etc.
 */
export type DirectiveFactoryReturn = LinkFn | DirectiveDefinition;

/**
 * The DI-invokable shape of a directive factory.
 *
 * Reuses the project's standard {@link Invokable} so directive
 * factories share annotation handling with every other DI form
 * (plain function, `$inject`-tagged function, or array-style
 * `[...deps, fn]`). Resolved lazily by `$injector.invoke(...)` the
 * first time the `<name>Directive` provider's `$get` runs.
 */
export type DirectiveFactory = Invokable<DirectiveFactoryReturn>;

/**
 * The normalized internal directive shape after the factory has
 * been invoked and validated. Stored in the `<name>Directive`
 * provider's `$get` array and consumed by the tree walker.
 *
 * `index` is a global registration counter assigned at factory
 * resolution time; it acts as the registration-order tie-breaker
 * during priority sorting (FS §2.7). `compile` is always present
 * after normalization — sugar `link` forms are upgraded to
 * `compile: () => link` in `buildDirectiveArray`.
 */
export interface Directive {
  name: string;
  restrict: string;
  priority: number;
  terminal: boolean;
  index: number;
  compile: CompileFn | undefined;
  link: LinkFn | { pre?: LinkFn; post?: LinkFn } | undefined;
  scope: false | true;
  /**
   * Post-normalize transclusion declaration (spec 018). Unset when the
   * directive did not declare `transclude` — preserves spec-017
   * behavior. Populated by `normalizeDirective` in Slice 2 from the
   * factory's `transclude: true | false | { … }` field.
   */
  transclude?: NormalizedTransclude;
  /**
   * Post-normalize template declaration (spec 019). Unset when the
   * directive declared neither `template` nor `templateUrl` —
   * preserves spec-017 / spec-018 behavior. Populated by
   * `normalizeDirective` in Slice 4 from the factory's
   * `template` / `templateUrl` fields. The discriminated union
   * encodes both inline-vs-async dispatch and string-vs-function form
   * so the compiler walker can switch on `kind` to choose between
   * synchronous installation (`inline-string` / `inline-fn`) and
   * deferred-drain installation (`url-string` / `url-fn`).
   *
   * Slices 5 / 6 light up the runtime read path; Slice 1 only widens
   * the type surface.
   */
  template?: NormalizedTemplate;
}

/**
 * The run-phase `$compile` callable.
 *
 * Walks the input node and its descendants, matches and sorts
 * directives, runs each directive's compile function in document
 * order, and returns a {@link Linker}. The linker, when invoked
 * with a {@link Scope}, runs pre-link top-down then post-link
 * bottom-up across the walked subtree.
 */
export type CompileService = (node: Element | NodeList | Comment) => Linker;

/**
 * The link function returned by `$compile(node)`.
 *
 * Calling it with a scope binds the matched directives to the live
 * tree and returns the same root node reference (or NodeList /
 * Comment for those input forms — never a clone).
 */
export type Linker = (scope: Scope) => Element | NodeList | Comment;

/**
 * Collaborators consumed by `createCompile`.
 *
 * Slice 2 only USES `getDirectivesByName` — `injector`,
 * `interpolate`, and `exceptionHandler` are received and stashed in
 * closure for Slice 9 (`$observe` interpolation wiring) and Slice
 * 11 (`'$compile'` cause-token routing).
 *
 * **Spec 019 / Slice 5** widens the interface with `templateRequest`.
 * The inline template path (this slice) does NOT consume it — only the
 * async `templateUrl` deferred-drain (Slice 6) does. The option threads
 * through now so the DI wiring for `$templateRequest` (the new run-phase
 * dep on `$compile`) is in place ahead of Slice 6.
 */
export interface CompileOptions {
  readonly getDirectivesByName: (name: string) => Directive[];
  readonly injector: Injector;
  readonly interpolate: InterpolateService;
  readonly exceptionHandler: ExceptionHandler;
  readonly templateRequest: TemplateRequestFn;
}
