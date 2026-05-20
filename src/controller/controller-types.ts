/**
 * Public TypeScript types for the `@controller` module (spec 020).
 *
 * Slice 1 of spec 020 ships the foundation: the public type surface plus
 * the six error classes. The factory (`createController`) lands in
 * Slice 2; the DI shim (`$ControllerProvider`) lands in Slice 3.
 * Surfacing the types now keeps the published `.d.ts` stable across the
 * spec's later slices — every consumer-visible signature shipped here
 * is the final one.
 *
 * The file is intentionally type-only — no runtime imports — so it can
 * be re-exported as `export type` from the module barrel.
 */

import type { Scope } from '@core/index';
import type { Attributes, TranscludeFn } from '@compiler/directive-types';
import type { Injector } from '@di/di-types';

/**
 * Bare controller function shape.
 *
 * Controllers are constructed via the AngularJS-canonical
 * `Object.create(prototype) + injector.invoke + return-value-replacement`
 * pattern (see `createController` in Slice 2). A controller may return
 * nothing — in which case the prototype-instance is returned to the
 * caller — or it may return a non-null object that **replaces** the
 * prototype-instance. Both shapes are admitted by the `unknown` return
 * type (`unknown` is the universal supertype and is compatible with
 * functions that have no `return` statement).
 *
 * Constructor parameters are typed as `...args: unknown[]` because the
 * DI system resolves them at invocation time from the controller's
 * `$inject` annotation (either an explicit `$inject` property, the array
 * form `['$scope', fn]`, or — in non-minified code — function-source
 * parsing). TypeScript cannot model that name-driven resolution
 * statically, so the inferred argument types are erased.
 *
 * @example
 * ```ts
 * // Plain-function controller — annotate $scope inline so TS knows its shape;
 * // the framework still injects it by name at runtime.
 * function Greeter($scope: Scope & { greeting: string }) {
 *   $scope.greeting = 'hi';
 * }
 * ```
 */
export type ControllerFn = (...args: unknown[]) => unknown;

/**
 * Either a bare controller function or its array-style annotation.
 *
 * The array form is the minification-safe spelling: the trailing element
 * is the function and every leading string is the name of an injected
 * dependency. Mirrors the existing `Invokable<T>` shape used elsewhere
 * in the DI module, but specialized for controllers so the published
 * `.d.ts` reads cleanly at directive call sites.
 *
 * @example
 * ```ts
 * // Both spellings register the same controller behavior:
 * const bare: ControllerInvokable = function ($scope) { void $scope; };
 * const annotated: ControllerInvokable = ['$scope', function ($scope) { void $scope; }];
 * ```
 */
export type ControllerInvokable = ControllerFn | (string | ControllerFn)[];

/**
 * Locals passed to `$controller(nameOrFn, locals, ident?)`.
 *
 * Every key is optional — `$controller(fn, {})` is legal — and the four
 * reserved keys (`$scope`, `$element`, `$attrs`, `$transclude`) carry
 * the shapes the compiler's per-element seam will populate in Slice 4.
 * Non-reserved string keys carry arbitrary values; injector lookups for
 * those names are overridden by the local on a key collision (locals
 * win, matching AngularJS's `$injector.invoke(fn, self, locals)`
 * contract).
 *
 * Generic over `TScope` so consumers can narrow `$scope` to a
 * project-specific shape (`ControllerLocals<MyScope>`) and avoid casts
 * at call sites that read `locals.$scope.someProp`. Defaults to the
 * untyped {@link Scope} for back-compat with all existing call sites.
 *
 * @example
 * ```ts
 * type MyScope = Scope & { greeting: string };
 * const locals: ControllerLocals<MyScope> = {
 *   $scope: rootScope.$new() as MyScope,
 *   $element: document.createElement('div'),
 *   // Override the registered `$location` with a fake for testing:
 *   $location: fakeLocation,
 * };
 * $controller('MyCtrl', locals);
 * ```
 */
export interface ControllerLocals<TScope extends Scope = Scope> {
  $scope?: TScope;
  $element?: Element;
  $attrs?: Attributes;
  $transclude?: TranscludeFn;
  [key: string]: unknown;
}

/**
 * Discriminated return of `$controller(..., locals, ident, later: true)`
 * — the deferred-alias call shape used by the compiler when isolate
 * `bindToController` requires bindings to populate on the instance
 * BEFORE the `controllerAs` alias is published on the scope (spec 022
 * Slice 2 / technical-considerations §2.4).
 *
 * `identifier` is the resolved alias — sourced from the explicit `ident`
 * argument (when present) else parsed from a `'Name as alias'` string —
 * and may be `undefined` when no alias was supplied. The caller is
 * responsible for assigning `scope[identifier] = instance` once it has
 * populated the instance's bindings (and, in Slice 4, resolved its
 * `require` dependencies).
 *
 * The `later: true` path does NOT publish the alias on the scope itself
 * — the legacy 1–3 arg call sites still run `bindAlias` internally, so
 * the deferred shape is opt-in.
 */
export interface DeferredControllerResult {
  readonly instance: unknown;
  readonly identifier: string | undefined;
}

/**
 * The run-phase `$controller` callable.
 *
 * Returns the instantiated controller — which is either the
 * prototype-instance (`Object.create(constructor.prototype)`) OR the
 * explicit non-null object returned from the constructor, per the
 * AngularJS-canonical return-value-replacement rule (`$injector.instantiate`
 * semantics). The compiler's per-element seam discards the result; direct
 * callers consume it.
 *
 * Resolution of the first argument:
 *
 * 1. **String** — parsed as `'Name'` or `'Name as alias'`, looked up in the
 *    provider's `$$registry`, instantiated. Throws `UnknownControllerError`
 *    if the name is not registered.
 * 2. **Function** — instantiated directly. An alias must come from the
 *    explicit `ident` argument or the directive's `controllerAs` field.
 * 3. **Array** — array-style annotation; the trailing element is the
 *    constructor; instantiated directly.
 * 4. **Anything else** — throws `InvalidControllerFactoryError`.
 *
 * The return type is `unknown` by design — there is no static link from
 * the string name to the registered constructor, so callers narrow with
 * an explicit assertion at the call site (e.g. `$controller(...) as Greeter`).
 * A generic-return parameter would be a disguised assertion: it provides
 * no real type checking, just renames the cast.
 *
 * The `TScope` parameter, by contrast, narrows `locals.$scope` — useful
 * because `$scope` is in an input position and the consumer's typed
 * property access flows through it. Defaults to {@link Scope} so today's
 * call sites are unchanged.
 *
 * **Spec 022 Slice 2 — `later: true`.** A fourth optional positional
 * argument enables the deferred-alias call shape. When `later === true`,
 * the call returns a {@link DeferredControllerResult} containing the
 * instance and the resolved identifier (the parsed `'Name as alias'`
 * suffix OR the explicit `ident` arg). The alias is NOT published on
 * `locals.$scope` — the caller binds it after populating the instance's
 * `bindToController` bindings (and, in Slice 4, after resolving
 * `require`). When omitted / `false`, behavior is identical to spec 020:
 * the instance is returned directly and the alias is published
 * internally via the standard `bindAlias` path.
 *
 * The call surface is a function-overload pair — the legacy 1–3 arg
 * call sites resolve to `unknown` exactly as before, and the only
 * 4-arg form (with `later: true`) yields {@link DeferredControllerResult}.
 * `later: false` is intentionally NOT overloaded as a 4-arg shape — a
 * call site that passes `false` would be indistinguishable from omitting
 * the arg, so the only valid 4th-arg value is the literal `true`.
 *
 * @example
 * ```ts
 * // Registered name + alias suffix — alias resolves to $scope.vm:
 * $controller('Greeter as vm', { $scope: rootScope });
 *
 * // Inline function — alias comes from the explicit ident argument:
 * $controller(function ($scope) {}, { $scope: rootScope }, 'vm');
 *
 * // Typed-scope locals — locals.$scope.greeting is `string`, not unknown:
 * type MyScope = Scope & { greeting: string };
 * const locals: ControllerLocals<MyScope> = { $scope: typedScope };
 * $controller('Greeter', locals);
 *
 * // Spec 022 Slice 2 — deferred alias. `instance` is the controller;
 * // `identifier` is the resolved alias (or undefined). The caller writes
 * // `scope[identifier] = instance` after wiring bindToController:
 * const { instance, identifier } = $controller('Greeter as vm', { $scope }, undefined, true);
 * // populate bindings onto instance, then publish:
 * if (identifier !== undefined) {
 *   ($scope as Record<string, unknown>)[identifier] = instance;
 * }
 * ```
 */
export interface ControllerService {
  <TScope extends Scope = Scope>(
    nameOrFn: string | ControllerInvokable,
    locals: ControllerLocals<TScope> | undefined,
    ident: string | undefined,
    later: true,
  ): DeferredControllerResult;
  <TScope extends Scope = Scope>(
    nameOrFn: string | ControllerInvokable,
    locals?: ControllerLocals<TScope>,
    ident?: string,
  ): unknown;
}

/**
 * Public surface of `$controllerProvider`.
 *
 * The concrete class (`$ControllerProvider`) lives in
 * `controller-provider.ts` and ships in Slice 3; this interface is shipped
 * in Slice 1 so the type surface stays stable across the spec's slices
 * and so the `declare module '@di/di-types'` augmentation (Slice 3) can
 * widen the config-phase registry without a churn moment.
 *
 * **Last-wins on duplicate `register(name, ...)`** — matches services and
 * filters; contrasts with directives' accumulation. Calling `register`
 * outside the config phase throws `ControllerRegistrationOutOfPhaseError`
 * (a programming error — direct throw, NOT routed through
 * `$exceptionHandler`).
 *
 * `has` is reachable in both phases (no guard).
 *
 * @example
 * ```ts
 * module.config(['$controllerProvider', ($cp: IControllerProvider) => {
 *   $cp
 *     .register('Greeter', ['$scope', ($s) => { ($s as { msg: string }).msg = 'hi'; }])
 *     .register('Counter', function ($scope) { void $scope; });
 *   if ($cp.has('Greeter')) {
 *     // …
 *   }
 * }]);
 * ```
 */
export interface IControllerProvider {
  register(name: string, fn: ControllerInvokable): IControllerProvider;
  register(map: Record<string, ControllerInvokable>): IControllerProvider;
  has(name: string): boolean;
}

/**
 * Internal — args consumed by the `createController` factory (Slice 2).
 *
 * Re-exported from `@controller/controller-types` so the factory's
 * unit tests can pass a hand-rolled fake injector + a real `Map`. NOT
 * re-exported from `@controller/index` and NOT re-exported from the
 * root `src/index.ts` barrel — this is an internal seam, not part of
 * the public surface.
 *
 * The `registry` is typed as `ReadonlyMap` so the factory cannot
 * mutate it; the live registry stays owned by `$ControllerProvider`.
 *
 * @example
 * ```ts
 * // Inside a unit test (Slice 2):
 * const fakeInjector: Injector = { invoke: ..., has: ..., get: ..., annotate: ... };
 * const registry = new Map<string, ControllerInvokable>([
 *   ['Greeter', function ($scope) { void $scope; }],
 * ]);
 * const $controller = createController({ injector: fakeInjector, registry });
 * ```
 */
export interface CreateControllerArgs {
  injector: Injector;
  registry: ReadonlyMap<string, ControllerInvokable>;
}
