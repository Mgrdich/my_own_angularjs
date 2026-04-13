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
 * Example: `['dep1', 'dep2', (dep1, dep2) => { ... }]`.
 */
export type InvokableArray = readonly [...string[], (...deps: never[]) => unknown];

/**
 * Anything that can be invoked by the injector: either an annotated function
 * (with an optional `$inject` property) or an array-style annotation.
 */
export type Invokable = Annotated<(...args: never[]) => unknown> | InvokableArray;

/**
 * The module builder interface, generic over an accumulated registry of
 * registered service names to their types. Each registration method returns
 * a new `ModuleAPI` whose registry type has been extended with the new entry,
 * enabling precise type inference on downstream `injector.get(name)` calls.
 */
export interface ModuleAPI<
  Registry extends Record<string, unknown> = Record<string, never>,
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
   * Register a factory under `name`. The factory is invoked lazily by the
   * injector with its declared dependencies, and its return value is cached
   * as the resolved service instance.
   *
   * `T` appears only in the return position because the factory's return
   * type cannot yet be statically inferred from an `Invokable` -- callers
   * supply it explicitly so downstream `injector.get(name)` lookups resolve
   * to the correct type.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- explicit caller-provided return type for registry inference
  factory<K extends string, T>(name: K, factory: Invokable): ModuleAPI<Registry & { [P in K]: T }, Name, Requires>;
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
   * Invoke an {@link Invokable} with its dependencies resolved from the
   * injector. An optional `self` binds `this`, and `locals` override specific
   * dependency names for this call. `T` is a caller-provided hint for the
   * invoked function's return type.
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- caller-provided return type hint
  invoke<T = unknown>(fn: Invokable, self?: unknown, locals?: Record<string, unknown>): T;

  /** Return the list of dependency names declared by an {@link Invokable}. */
  annotate(fn: Invokable): readonly string[];
}
