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
import type { ControllerInvokable, ControllerService } from '@controller/controller-types';
import type { Injector, Invokable } from '@di/di-types';
import type { ExceptionHandler } from '@exception-handler/index';
import type { InterpolateService } from '@interpolate/interpolate-types';
import type { NormalizedTemplate, TemplateFn, TemplateRequestFn, TemplateUrlFn } from '@template/template-types';

import type { NormalizedBindingMap } from './isolate-bindings';
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

// Re-export `ControllerInvokable` so directive authors importing
// `DirectiveDefinition` from `@compiler/directive-types` don't need a
// parallel `@controller/controller-types` import to spell the
// `controller` field's type (spec 020 Slice 4). The runtime symbol
// stays owned by `@controller`; this is a type-only re-export.
export type { ControllerInvokable };

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
 * argument (spec 022 Slice 4 — resolved `require` controllers), and
 * an OPTIONAL `$transclude` callable (spec 018) made available only
 * when the directive declares `transclude: true | { … }`. Returns
 * nothing.
 *
 * **`controllers` shape (spec 022 Slice 4).** The argument carries the
 * resolved `require` controllers for THIS directive — its runtime
 * shape matches the directive's `require` declaration:
 *
 *  - String `require: '^parent'` → single resolved controller (or
 *    `null` for an optional miss).
 *  - Array `require: ['parent', '^^outer']` → an array of resolved
 *    controllers (1:1 with the input array; `null` for optional
 *    misses).
 *  - Object `require: { p: 'parent', o: '^^outer' }` → a record
 *    keyed by the declared aliases.
 *  - No `require` declaration → `undefined`.
 *
 * Directives without `require` should treat the slot as `undefined`.
 * TypeScript function-parameter subtyping keeps the spec-017-canonical
 * 3-arg `(scope, element, attrs)` callers assignable to this widened
 * type without source changes.
 *
 * **`$transclude` is `undefined` unless the directive's DDO declared
 * `transclude`.** Same subtyping rule as above.
 *
 * Errors thrown from a link function are routed through
 * `$exceptionHandler` with cause `'$compile'` (spec 017 Slice 11).
 */
export type LinkFn = (
  scope: Scope,
  element: Element,
  attrs: Attributes,
  controllers?: unknown,
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
  /**
   * Scope declaration. Three shapes are accepted:
   *
   * - `false` (default) — the directive shares its parent scope; no new
   *   scope is created.
   * - `true` — the directive gets a child scope created via
   *   `parent.$new()`. The child inherits prototypically.
   * - `Record<string, string>` — the directive gets an ISOLATE scope
   *   (spec 022 Slice 1). The map declares one binding per local name;
   *   each value is a binding-spec string of the form `[=@<&][?][alias]?`
   *   parsed by `parseBindingSpec`. The isolate scope does NOT inherit
   *   from the parent — only the declared bindings cross the boundary.
   *
   * A malformed binding-spec string routes
   * {@link import('./compile-error').InvalidIsolateBindingError} via
   * `$exceptionHandler('$compile')` at directive registration. Two
   * directives on the same element both declaring the object form
   * trigger {@link import('./compile-error').MultipleIsolateScopeError}
   * at link time.
   *
   * @example
   * ```ts
   * $compileProvider.directive('myCard', () => ({
   *   scope: {
   *     value: '=',        // two-way
   *     title: '@',        // one-way text (interpolated)
   *     item:  '<',        // one-way expression
   *     onDone: '&',       // expression / callback
   *     hint:  '@?',       // optional one-way text
   *     name:  '<sourceAttr', // attribute aliasing
   *   },
   * }));
   * ```
   */
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
  /**
   * Controller declaration (spec 020). Accepts:
   *
   * - `string` — registered controller name; looked up at link time via
   *   `$controller(name, locals, controllerAs)` against the names
   *   registered with `$controllerProvider.register(name, fn)`.
   * - `ControllerInvokable` — bare function or array-style annotation
   *   (`['$scope', '$element', fn]`); instantiated directly via
   *   `$controller(fn, locals, controllerAs)`.
   *
   * The controller is instantiated ONCE per matched element, AFTER
   * `$transclude` setup, BEFORE any pre-link function on the element
   * (and therefore before any post-link). The seam reuses the existing
   * `'$compile'` cause token — no new `EXCEPTION_HANDLER_CAUSES` entry.
   * A throw from the controller constructor routes via
   * `$exceptionHandler('$compile')` and the directive's other behavior
   * (pre/post-link) on the same element still runs; sibling elements
   * are unaffected.
   *
   * The compiler's locals for the seam are
   * `{ $scope, $element, $attrs, $transclude }`. `$transclude` is
   * present only on transcluding hosts; on non-transcluding hosts the
   * key is omitted from the locals map.
   *
   * @example Inline controller plus `controllerAs: 'vm'`
   * ```ts
   * $compileProvider.directive('myCard', () => ({
   *   controller: ['$scope', function ($scope) {
   *     this.value = 42;
   *     void $scope;
   *   }],
   *   controllerAs: 'vm',
   * }));
   * // Inside the template, `vm.value` reads through scope.vm.value.
   * ```
   *
   * @see ControllerAsWithoutControllerError — `controllerAs` requires
   *      `controller`. Rejected at directive registration.
   * @see MalformedControllerAliasError — `controllerAs` must match
   *      `IDENT_RE`.
   *
   * **Spec 027 Slice 4 — attribute-source sentinel.** A third accepted
   * shape, `{ __attributeSource: string }`, is reserved for built-in
   * structural directives (`ng-controller`) whose controller name is
   * supplied through a DOM attribute rather than baked into the DDO.
   * `runControllerSeam` dispatches on the sentinel and reads the
   * controller name from `attrs[__attributeSource]` at link time. NOT
   * intended for direct consumer use.
   */
  controller?: string | ControllerInvokable | { __attributeSource: string };
  /**
   * Controller alias (spec 020). Exposes the controller instance on the
   * matched element's scope under this name (or the child scope when
   * `scope: true`). MUST be a non-empty string matching `IDENT_RE`
   * (`/^[A-Za-z_$][\w$]*$/`) and MUST be accompanied by `controller`.
   *
   * Both validations run at directive registration time inside
   * `normalizeDirective`. Failures route via `$exceptionHandler('$compile')`
   * through the existing factory `try/catch` in
   * `$$buildDirectiveArrayProvider`, so the directive simply doesn't
   * resolve — sibling directives on the same element continue to run.
   *
   * @example
   * ```ts
   * $compileProvider.directive('myCard', () => ({
   *   controller: function ($scope) { $scope.value = 42; },
   *   controllerAs: 'vm',
   * }));
   * // Inside the template, `vm.value` reads through scope.vm.value.
   * ```
   *
   * @see ControllerAsWithoutControllerError — `controllerAs` without
   *      `controller` is a registration-time error.
   * @see MalformedControllerAliasError — Non-identifier alias strings
   *      (e.g. `''`, `'1bad'`, `'has space'`) are rejected at registration.
   */
  controllerAs?: string;
  /**
   * Route isolate-scope bindings to the CONTROLLER INSTANCE rather than
   * onto the isolate scope (spec 022 Slice 2 / technical-considerations
   * §2.2). Two accepted shapes:
   *
   * - `true` — re-use the binding map declared via `scope: { … }`. The
   *   isolate scope is still created (so the directive still requires
   *   `scope: { … }` to be present); the bindings just write to the
   *   controller instance instead of to the scope. The
   *   `controllerAs` alias is published on the isolate scope AFTER
   *   bindings have populated, so the template's `$ctrl.foo` reads land
   *   on the post-binding instance.
   * - `Record<string, string>` — an object-form binding map IDENTICAL
   *   in shape to `scope: { … }`. The directive does NOT need to also
   *   declare `scope`. UNLIKE the `scope: { … }` declaration, this form
   *   does NOT request creation of an isolate scope on its own — the
   *   directive consumes whatever scope the element already has (which
   *   may be the parent scope, a `scope: true` child, or an isolate
   *   scope created by ANOTHER directive on the same element). Bindings
   *   target the controller instance. Malformed entries throw
   *   {@link import('./compile-error').InvalidIsolateBindingError} at
   *   registration, routed via `$exceptionHandler('$compile')` through
   *   the existing factory `try/catch`. This asymmetry mirrors
   *   AngularJS-canonical behavior: a `bindToController`-only directive
   *   does NOT trigger {@link import('./compile-error').MultipleIsolateScopeError}
   *   when it shares an element with a `scope: { … }` directive.
   *
   * When `bindToController` is set but the directive declares NO
   * controller, the flag silently degrades — bindings land on the
   * isolate scope as if `bindToController` were unset. This matches
   * AngularJS-canonical no-op behavior; a controllerless directive
   * has nowhere to put the instance bindings.
   *
   * The compiler invokes the controller with `later: true`
   * (see {@link import('@controller/controller-types').ControllerService}),
   * populates bindings onto the returned `instance`, then publishes the
   * `controllerAs` alias on the isolate scope. The ordering matters for
   * the eventual `$onInit` hook (spec 022 Slice 3) — bindings will be
   * present on `this` before `$onInit` runs.
   *
   * @example
   * ```ts
   * // Form 1 — re-use the scope: { … } binding map.
   * $compileProvider.directive('myCard', () => ({
   *   scope: { user: '<' },
   *   bindToController: true,
   *   controller: function () { void this; },
   *   controllerAs: '$ctrl',
   * }));
   *
   * // Form 2 — object-form binding map (no `scope` declaration needed).
   * $compileProvider.directive('myCard', () => ({
   *   bindToController: { user: '<' },
   *   controller: function () { void this; },
   *   controllerAs: '$ctrl',
   * }));
   * ```
   *
   * @see InvalidIsolateBindingError — Malformed entries in the object
   *      form are rejected at registration.
   */
  bindToController?: boolean | Record<string, string>;
  /**
   * Declares one or more controllers this directive requires (spec 022
   * Slice 4 / technical-considerations §2.4). Three accepted shapes:
   *
   *  - `string` — a single requirement. Resolves to ONE controller (or
   *    `null` for an optional miss).
   *  - `string[]` — multiple requirements, 1:1 with the resolved array
   *    passed as the link fn's 4th argument.
   *  - `Record<string, string>` — multiple requirements keyed by alias.
   *    The resolved object IS the link fn's 4th argument, AND when the
   *    requiring directive declares its own `controller`, each alias is
   *    ALSO assigned onto the controller instance BEFORE `$onInit` runs
   *    (so `this.<alias>` is populated inside `$onInit`).
   *
   * Each entry string supports two prefix flags (order-tolerant):
   *
   *  - `?`  — optional. A missing controller resolves to `null`
   *    instead of throwing.
   *  - `^`  — search this element AND its ancestors (the
   *    `parentElement` chain).
   *  - `^^` — search ancestors ONLY (skip this element).
   *
   * `?` and the ancestor-walk flag are order-tolerant: `'?^name'` and
   * `'^?name'` parse identically. `^^` is parsed before `^` so longer
   * prefixes win.
   *
   * A non-optional miss throws
   * {@link import('./compile-error').MissingRequiredControllerError},
   * routed via `$exceptionHandler('$compile')` from the per-element
   * link site. The directive's other behavior (link, compile,
   * transclude) on the same element still runs; sibling elements are
   * unaffected.
   *
   * Resolution reads from the per-element non-enumerable
   * `$$ngControllers: Map<string, unknown>` stash planted by the
   * controller seam — see `src/compiler/cleanup.ts:NgManagedElement`.
   *
   * @example String form (own element, optional)
   * ```ts
   * $compileProvider.directive('child', () => ({
   *   require: '?parent',
   *   link: (_s, _e, _a, parentCtrl) => {
   *     // parentCtrl is the resolved instance or `null`
   *   },
   * }));
   * ```
   *
   * @example Array form
   * ```ts
   * $compileProvider.directive('child', () => ({
   *   require: ['parent', '^^outer'],
   *   link: (_s, _e, _a, ctrls: unknown) => {
   *     // ctrls === [parentCtrl, outerCtrl] (or null entries for optional misses)
   *   },
   * }));
   * ```
   *
   * @example Object form with auto-assignment
   * ```ts
   * $compileProvider.directive('child', () => ({
   *   require: { parent: '^parent' },
   *   controller: ['$scope', function () {
   *     this.$onInit = function () {
   *       // `this.parent` is populated before `$onInit` runs
   *     };
   *   }],
   *   controllerAs: '$ctrl',
   * }));
   * ```
   */
  require?: string | string[] | Record<string, string>;
  /**
   * Opt-in for ranged (multi-element) `<name>-start` / `<name>-end`
   * support (spec 033). Defaults to `false`. When `true`, the directive
   * may be applied across a RANGE of sibling elements by marking the
   * first element with `<name>-start` and the matching last element with
   * `<name>-end`; the directive then operates on the start element, the
   * end element, and every node in between as one group.
   *
   * The grouping is depth-aware (nested same-named ranges resolve by
   * counting `-start` / `-end` pairs), and a `-start` with no matching
   * `-end` routes
   * {@link import('./compile-error').UnterminatedMultiElementDirectiveError}
   * via `$exceptionHandler('$compile')` at compile time, leaving the DOM
   * untouched.
   *
   * `multiElement` only activates on the `-start` suffix — the ordinary
   * single-element form of the directive is completely unaffected.
   *
   * @example
   * ```ts
   * // <tr ng-repeat-start="r in rows">…</tr><tr ng-repeat-end>…</tr>
   * $compileProvider.directive('ngRepeat', () => ({
   *   multiElement: true,
   *   transclude: 'element',
   *   // … compile / link …
   * }));
   * ```
   */
  multiElement?: boolean;
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
 * Component Definition Object — the concise shape consumed by
 * `$compileProvider.component(name, definition)` (spec 022 Slice 5 /
 * FS §2.5 / technical-considerations §2.5).
 *
 * A component is, internally, a directive registration. The provider
 * translates this object into a directive factory returning a DDO
 * with the AngularJS 1.5+ canonical defaults:
 *
 *  - `restrict: 'E'`
 *  - `scope: definition.bindings ?? {}` — always object-form (isolate
 *    scope), empty when no bindings are declared
 *  - `bindToController: true`
 *  - `controller: definition.controller ?? function NoopController() {}`
 *  - `controllerAs: definition.controllerAs ?? '$ctrl'`
 *  - Pass-through: `template`, `templateUrl`, `transclude`, `require`
 *
 * Every field is optional — a component with no fields is the canonical
 * empty isolate-scoped wrapper element with a noop controller exposed
 * as `$ctrl`.
 *
 * @example
 * ```ts
 * $compileProvider.component('userCard', {
 *   bindings: { user: '<', onSelect: '&' },
 *   controller: ['$element', function () {
 *     this.$onInit = () => { void this.user; };
 *     this.pick = () => this.onSelect({ id: this.user.id });
 *   }],
 *   template: '<div class="card">{{ $ctrl.user.name }}</div>',
 * });
 * // Consumer markup:
 * //   <user-card user="someExpr" on-select="handler(id)"></user-card>
 * ```
 *
 * @see InvalidComponentDefinitionError — Registration-time errors.
 */
export interface ComponentDefinition {
  /**
   * Inline template (string) or function-form template returning a
   * string. Same semantics as {@link DirectiveDefinition.template}.
   * Mutually exclusive with {@link templateUrl} — declaring both is
   * rejected at directive-registration time.
   */
  template?: string | TemplateFn;
  /**
   * Async template URL or function-form URL. Same semantics as
   * {@link DirectiveDefinition.templateUrl}. Mutually exclusive with
   * {@link template}.
   */
  templateUrl?: string | TemplateUrlFn;
  /**
   * Controller declaration. Same shapes as
   * {@link DirectiveDefinition.controller}: a registered controller
   * name string OR a {@link ControllerInvokable} (bare function or
   * array-style annotation). Defaults to an empty noop constructor
   * when omitted (named `NoopController` for stack-trace clarity).
   */
  controller?: ControllerInvokable | string;
  /**
   * Template-side alias for the controller instance. Defaults to
   * `'$ctrl'` when omitted (the AngularJS 1.5+ component canonical).
   */
  controllerAs?: string;
  /**
   * Isolate-scope bindings. Translates 1:1 to the underlying directive's
   * `scope: { … }` declaration. Each value is a binding-spec string of
   * the form `[=@<&][?][alias]?` parsed by `parseBindingSpec`. When
   * omitted, an empty object is used — the component still gets an
   * isolate scope (canonical AngularJS 1.5+ behavior), there are simply
   * no declared bindings crossing the boundary.
   *
   * Because `bindToController: true` is applied by default, bindings
   * land on the controller instance (`this.user`, `this.onSelect`) and
   * NOT on the isolate scope.
   */
  bindings?: Record<string, string>;
  /**
   * Transclusion declaration. Passed through verbatim to the underlying
   * directive's `transclude`. Same shapes accepted as
   * {@link DirectiveDefinition.transclude}: `true` for content
   * transclusion, or a multi-slot `Record<string, string>` map.
   * `'element'` form is not supported by the underlying directive.
   */
  transclude?: boolean | Record<string, string>;
  /**
   * Controller-require declaration. Passed through verbatim to the
   * underlying directive's `require`. Same shapes accepted as
   * {@link DirectiveDefinition.require}: string / array / object form,
   * with the `^` / `^^` / `?` flags.
   */
  require?: string | string[] | Record<string, string>;
}

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
  /**
   * Post-normalize controller declaration (spec 020 / spec 027 Slice 4).
   * Unset when the directive declared no controller. Populated by
   * `normalizeDirective` from the factory's `controller` field. The
   * compiler's per-element seam reads this slot once per directive and
   * invokes `$controller` with element-local `$scope` / `$element` /
   * `$attrs` / `$transclude`.
   *
   * **Sentinel form `{ __attributeSource: string }` (spec 027 Slice 4).**
   * The third accepted shape is a small object carrying a single
   * `__attributeSource` string field. The compiler's `runControllerSeam`
   * recognizes the sentinel and dispatches to a third branch (alongside
   * `bindToController` and eager) that reads the controller name from
   * `attrs[__attributeSource]` at link time and invokes `$controller`
   * with the resolved string. This shape powers the `ng-controller`
   * built-in directive (`{ __attributeSource: 'ngController' }`) where
   * the controller name is supplied through the DOM attribute value at
   * link time rather than baked into the DDO at registration. It is
   * NOT intended for direct consumer use — the surface is exposed only
   * so the built-in `ng-controller` factory can produce it; future
   * structural directives may consume the same shape.
   */
  controller?: string | ControllerInvokable | { __attributeSource: string };
  /**
   * Post-normalize `controllerAs` alias (spec 020). Always paired with
   * `controller` — `normalizeDirective` rejects `controllerAs` without
   * `controller` via {@link DirectiveDefinition.controllerAs}'s
   * registration check. Forwarded to `$controller` as the `ident`
   * argument so the resolved instance is exposed on `scope[controllerAs]`.
   */
  controllerAs?: string;
  /**
   * Post-normalize isolate-scope binding map (spec 022 Slice 1). Unset
   * when the directive declared `scope: false` / `scope: true` /
   * omitted; populated by `normalizeDirective` from the object-form
   * `scope: { … }` declaration. When present, the per-element linker
   * creates an isolate scope via `parentScope.$new(true)` (instead of
   * `parentScope.$new()` for `scope: true`) and wires every entry via
   * {@link import('./isolate-bindings').wireIsolateBindings}.
   *
   * The `scope` flag remains `boolean` — its `true` value still means
   * "create a non-default scope". The choice between "child scope" and
   * "isolate scope" is determined by `isolateBindings != null` at link
   * time, so existing `scope: true` code paths keep working unchanged.
   */
  isolateBindings?: NormalizedBindingMap;
  /**
   * Post-normalize `bindToController` boolean (spec 022 Slice 2).
   * Defaults to `false`. When `true`, the per-element linker targets the
   * controller INSTANCE (rather than the isolate scope) when wiring
   * isolate bindings — the binding map comes from
   * {@link bindToControllerBindings} when present, else falls back to
   * the directive's {@link isolateBindings} (spec 022 §2.2 — "form 1").
   *
   * `bindToController === true` without a controller silently degrades
   * to the isolate-scope target (the documented AngularJS no-op case).
   * The flag stays `true` after normalization regardless of the
   * controller's presence — the per-element linker decides at LINK time
   * whether to honor it.
   */
  bindToController: boolean;
  /**
   * Post-normalize `bindToController` object-form binding map (spec 022
   * Slice 2). Unset when the directive declared
   * `bindToController: true` or omitted the field entirely. Populated by
   * `normalizeDirective` from the object-form
   * `bindToController: { … }` declaration via
   * {@link import('./isolate-bindings').parseIsolateBindings}.
   *
   * When this field is set, the per-element linker uses THIS map as the
   * binding map (instead of {@link isolateBindings}); bindings target
   * the controller instance. The form-2 directive does NOT trigger
   * isolate-scope creation on its own — that is the deliberate
   * asymmetry vs. `scope: { … }`. The existing scope on the element
   * (whether parent, `scope: true` child, or an isolate scope created
   * by another directive) is reused. As a consequence two directives
   * sharing an element where one declares `scope: { … }` and the other
   * declares `bindToController: { … }` do NOT route
   * {@link import('./compile-error').MultipleIsolateScopeError}.
   *
   * When unset AND `bindToController` is `true`, the binding map is
   * taken from {@link isolateBindings} (the directive's `scope: { … }`
   * declaration is reused for the instance-target form).
   *
   * Malformed entries throw {@link import('./compile-error').InvalidIsolateBindingError}
   * at registration, routed via `$exceptionHandler('$compile')` through
   * the existing factory `try/catch` in `$$buildDirectiveArrayProvider`.
   */
  bindToControllerBindings?: NormalizedBindingMap;
  /**
   * Post-normalize `require` declaration (spec 022 Slice 4). Unset when
   * the directive declared no `require`. Carries the SAME runtime shape
   * as {@link DirectiveDefinition.require} — flag parsing (`^` / `^^`
   * / `?`) is deferred to the per-element link site
   * (`require-resolver.ts:parseRequireFlags`) so the normalized
   * directive stays cheap and the resolver owns the lazy parsing.
   */
  require?: string | string[] | Record<string, string>;
  /**
   * Post-normalize `multiElement` flag (spec 033). Defaults to `false`.
   * When `true`, the directive collector recognizes the `<name>-start` /
   * `<name>-end` ranged form for this directive and the compiler groups
   * the start→end sibling range into one unit (Mode A — `transclude:
   * 'element'` directives capture the whole range as the transclusion
   * master). Normalized from the factory's `multiElement` field by
   * `normalizeDirective` like the other boolean flags.
   */
  multiElement: boolean;
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
  /**
   * The run-phase `$controller` service (spec 020 Slice 4). The
   * compiler invokes it once per directive that declares a `controller`,
   * per matched element, AFTER `$transclude` setup and BEFORE the
   * pre-link loop. Threaded via the existing `$CompileProvider.$get`
   * deps array — the linker holds the resolved reference in its
   * closure rather than reaching for it through `injector.get(...)`
   * on every element.
   *
   * Throws from the controller constructor route via
   * `invokeExceptionHandler(exceptionHandler, err, '$compile')` — no
   * new `EXCEPTION_HANDLER_CAUSES` entry; the tuple stays at 10.
   */
  readonly controller: ControllerService;
}
