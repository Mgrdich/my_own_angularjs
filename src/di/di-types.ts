/**
 * Core type definitions for the Dependency Injection module.
 *
 * The DI system uses a builder pattern where each registration call on a
 * {@link ModuleAPI} returns a new `ModuleAPI` whose `Registry` type parameter
 * has been extended with the newly-registered entry. The {@link Injector} is
 * generic over the merged registry so that `injector.get('name')` can infer
 * the return type from the string-literal name via indexed access.
 */

/**
 * A function that may optionally carry an `$inject` annotation listing the
 * names of its dependencies. This mirrors AngularJS's property-based inline
 * annotation style: `fn.$inject = ['dep1', 'dep2']`.
 */
export type Annotated<Fn extends (...args: never[]) => unknown> = Fn & {
  $inject?: readonly string[];
};

/**
 * Array-style dependency annotation: a tuple whose leading entries are
 * dependency names and whose final entry is the function to invoke.
 *
 * Generic over `Return` so callers get the trailing function's return type
 * inferred automatically -- no explicit annotation required at call sites of
 * `Module.factory` or `Injector.invoke`.
 *
 * Example: `['dep1', 'dep2', (dep1, dep2) => { ... }]`.
 */
export type InvokableArray<Return = unknown> = readonly [...string[], (...deps: never[]) => Return];

/**
 * Anything that can be invoked by the injector: either an annotated function
 * (with an optional `$inject` property) or an array-style annotation.
 *
 * Generic over `Return` so callers get return-type inference on
 * `Module.factory` and `Injector.invoke`. The default `Return = unknown`
 * keeps `Invokable` usable as an opaque "any invokable" type in spots like
 * the `annotate` helper or the injector's internal factory cache.
 */
export type Invokable<Return = unknown> = Annotated<(...args: never[]) => Return> | InvokableArray<Return>;

/**
 * Given a `Registry` and a tuple of dependency names, produce a tuple of the
 * corresponding service types. Used by `Module.factory` to type a factory
 * callback's parameters based on what the registry has registered.
 *
 * If a dependency name is not a key of `Registry` (for example, a name that
 * comes from a transitively-required module), the slot resolves to `unknown`,
 * which keeps the overload matchable while preserving type safety at call sites
 * where every dep is statically known.
 */
export type ResolveDeps<Registry extends Record<string, unknown>, Deps extends readonly string[]> = {
  [I in keyof Deps]: Deps[I] extends keyof Registry ? Registry[Deps[I]] : unknown;
};

/**
 * A provider registered as a constructor function. The provider is
 * instantiated via `new P()` at load time (or `new P(...deps)` for the
 * array-style form). The instance must carry a `$get` method that the
 * injector calls during the run phase to produce the actual service.
 *
 * **Structural utility type** — used in `extends` pattern matching, not for
 * call-site validation. See `TypedModule.provider` overloads for the typed
 * call-site signatures that validate dep names against `ConfigRegistry`.
 */
export type ProviderConstructor = new (...args: never[]) => { $get: Invokable };

/**
 * A provider registered as an object literal. Must have a `$get` method
 * (plain function or array-style invokable) that the injector calls during
 * the run phase to produce the actual service.
 *
 * **Structural utility type** — used in `extends` pattern matching.
 */
export type ProviderObject = { $get: Invokable };

/**
 * A provider registered in array-style form: `[...depNames, Ctor]`. The
 * dep names are resolved from the **config-phase** injector and passed as
 * positional args to `new Ctor(...)`. The resulting instance must carry a
 * `$get` method.
 *
 * **Structural utility type** — dep names are plain `string[]` here because
 * this type is used for inferring the provider shape from an existing value,
 * not for validating dep names at a call site. See `TypedModule.provider`
 * Form 3 for the typed version that constrains deps to
 * `keyof ConfigRegistry & string`.
 */
export type ProviderArray = readonly [...string[], ProviderConstructor];

/**
 * Given an `Invokable`, extract the return type of its underlying function.
 * For an array-style invokable `[...deps, fn]`, the return type comes from
 * the trailing function. For an annotated function, the return type comes
 * from the function itself.
 *
 * Returns `unknown` if the invokable shape doesn't match either pattern —
 * a defensive fallback that keeps downstream mapped types from collapsing
 * to `never`.
 */
export type InvokableReturn<I> = I extends readonly [...string[], (...args: never[]) => infer R]
  ? R
  : I extends (...args: never[]) => infer R
    ? R
    : unknown;

/**
 * Given a provider in any of the three registration forms (constructor
 * function, object literal, or array-style with deps), extract the
 * **provider instance** type — the object that carries the `$get` method
 * and any user-defined configuration methods. This is the type that appears
 * under `<name>Provider` in the config-phase registry.
 *
 * **Structural utility type** — used for mapping provider registrations
 * to their `ConfigRegistry` entries in the typed `provider` overloads.
 */
export type ProviderInstance<P> = P extends ProviderConstructor
  ? InstanceType<P>
  : P extends ProviderArray
    ? P extends readonly [...string[], infer Ctor]
      ? Ctor extends ProviderConstructor
        ? InstanceType<Ctor>
        : never
      : never
    : P extends ProviderObject
      ? P
      : never;

/**
 * Given a provider, extract the **service** type — the return type of the
 * provider instance's `$get` method. This is the type that appears under
 * `<name>` in the run-phase `Registry`.
 *
 * Composes `ProviderInstance<P>` with `InvokableReturn<...$get>` so that
 * both plain-function `$get` methods and array-style `$get` invokables
 * have their return types extracted correctly.
 */
export type ProviderService<P> = ProviderInstance<P> extends { $get: infer G } ? InvokableReturn<G> : never;

/**
 * The module builder interface, generic over an accumulated registry of
 * registered service names to their types. Each registration method returns
 * a new `ModuleAPI` whose registry type has been extended with the new entry,
 * enabling precise type inference on downstream `injector.get(name)` calls.
 */
export interface ModuleAPI<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see note on `Module` in module.ts: `{}` (not `Record<string, never>`) is the correct empty-registry starting type so that newly-added literal keys aren't swallowed by a wide `string` index signature, which would break the typed-factory overloads.
  Registry extends Record<string, unknown> = {},
  Name extends string = string,
  Requires extends readonly string[] = readonly string[],
> {
  /** The unique name of this module. */
  readonly name: Name;

  /** Names of other modules this module depends on. */
  readonly requires: Requires;

  /**
   * Register a plain value under `name`. Values are not invoked; they are
   * returned as-is from the injector.
   */
  value<K extends string, T>(name: K, value: T): ModuleAPI<Registry & { [P in K]: T }, Name, Requires>;

  /**
   * Register a constant under `name`. Constants are available during the
   * module configuration phase and are never overridden by decorators.
   */
  constant<K extends string, T>(name: K, value: T): ModuleAPI<Registry & { [P in K]: T }, Name, Requires>;

  /**
   * Register a factory under `name` using an array-style annotation whose
   * leading entries are keys of the current `Registry`. The trailing
   * function's parameters are inferred from {@link ResolveDeps}, giving each
   * dep argument the exact type recorded by an earlier `value` / `constant` /
   * `factory` registration on this module.
   *
   * **Typo detection limitation.** When a dep name does not exist on the
   * module's `Registry` (e.g. because it's a typo, or because it comes from
   * a transitively-required module), this typed overload silently fails to
   * match and the call site falls through to the untyped fallback below.
   * TypeScript's overload resolution is "first success wins," so the
   * constraint error on this overload does not surface. Callback param
   * inference still fires for valid dep lists; detecting typos via the type
   * system would require a different, more invasive design and is out of
   * scope here.
   */
  factory<const K extends string, const Deps extends readonly (keyof Registry & string)[], Return>(
    name: K,
    invokable: readonly [...Deps, (...args: ResolveDeps<Registry, Deps>) => Return],
  ): ModuleAPI<Registry & { [P in K]: Return }, Name, Requires>;

  /**
   * Register a factory under `name` using a `$inject`-annotated function whose
   * `$inject` property is a readonly literal tuple of keys of `Registry`. The
   * function's parameter types are validated against {@link ResolveDeps}.
   * Annotate `$inject` with `as const` (or a `readonly` tuple type) so the
   * compiler can see the literal dep names.
   */
  factory<const K extends string, const Inject extends readonly (keyof Registry & string)[], Return>(
    name: K,
    invokable: ((...args: ResolveDeps<Registry, Inject>) => Return) & { $inject: Inject },
  ): ModuleAPI<Registry & { [P in K]: Return }, Name, Requires>;

  /**
   * Fallback overload for factories whose dependencies cannot be validated at
   * compile time against the current `Registry` — for example, factories that
   * reference services from a transitively-required module, or those whose
   * `$inject` property is typed as the wider `string[]`. Behaves exactly like
   * the old untyped signature: `Return` is still inferred from the trailing
   * function, but the callback's parameters are not typed from the registry.
   */
  factory<K extends string, Return>(
    name: K,
    invokable: Invokable<Return>,
  ): ModuleAPI<Registry & { [P in K]: Return }, Name, Requires>;
}

/**
 * The injector interface, generic over the merged registry produced by the
 * modules it was bootstrapped from.
 *
 * `get` is overloaded: when called with a key that is statically known to be
 * in the registry, the return type is inferred from the registry entry.
 * Otherwise, callers may provide an explicit type parameter as an escape
 * hatch for dynamic lookups.
 */
export interface Injector<Registry extends Record<string, unknown> = Record<string, unknown>> {
  /** Retrieve a registered service by its statically-known name. */
  get<K extends keyof Registry>(name: K): Registry[K];

  /**
   * Retrieve a registered service by a dynamic name, with an explicit type.
   * This is the escape-hatch overload for lookups where the name is not a
   * statically-known key of `Registry`.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- caller-provided type for dynamic-name escape hatch
  get<T>(name: string): T;

  /** Check whether a service with the given name is registered. */
  has(name: string): boolean;

  /**
   * Array-style invoke with deps validated against `Registry`. Each leading
   * entry must be a literal key of this injector's registry, and the trailing
   * callback's parameters are inferred from {@link ResolveDeps} — so each
   * callback argument is typed from the earlier `value` / `constant` /
   * `factory` registration that populated the registry.
   *
   * **Typo / cross-registry limitation.** When a dep name does not exist on
   * the injector's `Registry` (for example, a typo or a service registered on
   * a transitively-required module that isn't reflected in `Mods`), this
   * overload silently fails to match and call sites fall through to the
   * untyped fallback below. TypeScript's overload resolution is "first
   * success wins," so the constraint error on this overload does not surface.
   * Typed param inference still works for valid dep lists.
   */
  invoke<const Deps extends readonly (keyof Registry & string)[], Return>(
    fn: readonly [...Deps, (...args: ResolveDeps<Registry, Deps>) => Return],
    self?: unknown,
    locals?: Record<string, unknown>,
  ): Return;

  /**
   * `$inject`-annotated invoke with deps validated against `Registry`. The
   * function's `$inject` property must be a `readonly` literal tuple whose
   * entries are keys of `Registry`; the function's parameters are validated
   * against {@link ResolveDeps}. Annotate `$inject` with `as const` (or a
   * readonly tuple type) so the compiler can see the literal dep names.
   */
  invoke<const Inject extends readonly (keyof Registry & string)[], Return>(
    fn: ((...args: ResolveDeps<Registry, Inject>) => Return) & { $inject: Inject },
    self?: unknown,
    locals?: Record<string, unknown>,
  ): Return;

  /**
   * Fallback untyped overload — used when deps can't be validated statically
   * (e.g. cross-module deps from a `requires` dependency, wide `string[]`
   * `$inject` properties, or pre-built `Invokable<Return>` values passed as
   * opaque variables). `Return` is still inferred from the trailing function
   * so callers don't need to annotate it explicitly.
   */
  invoke<Return>(fn: Invokable<Return>, self?: unknown, locals?: Record<string, unknown>): Return;

  /** Return the list of dependency names declared by an {@link Invokable}. */
  annotate(fn: Invokable): readonly string[];
}
