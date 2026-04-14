import type { Invokable, ResolveDeps } from './di-types';

/**
 * Recipe types supported by the module system. At Slice 1 only the identifier
 * strings are needed -- the actual `value`, `constant`, and `factory` methods
 * will be added to the `Module` class in later slices.
 */
export type RecipeType = 'value' | 'constant' | 'factory';

/**
 * A single pending registration in a module's invoke queue. The tuple is
 * `[recipeType, name, value]` where `value` is the raw argument passed to the
 * registration method (a plain value for `value`/`constant`, or an
 * {@link Invokable} for `factory`). The queue is drained by the injector when
 * it is created from the module graph.
 */
export type InvokeQueueEntry = readonly [RecipeType, string, unknown];

/**
 * The most-general `Module` type, used by the internal registry which must
 * hold modules of any concrete `Registry` / `Name` / `Requires` shape.
 */
export type AnyModule = Module<Record<string, unknown>>;

/**
 * Module-scoped registry of all modules created via {@link createModule}.
 * Keyed by module name. Kept private to this file -- both `createModule` and
 * `getModule` go through this registry so there is a single source of truth.
 */
const registry = new Map<string, AnyModule>();

/**
 * A declarative module: a named collection of pending service registrations
 * plus a list of module dependencies.
 *
 * The class is generic over three type parameters:
 *
 * - `Registry` -- a mapped type carrying the accumulated static registry of
 *   registered service names to their types. Each registration method
 *   (`value`, `constant`) returns `this` cast to a widened
 *   `Module<Registry & { [K in Name]: T }, Name, Requires>` so the builder
 *   pattern can accumulate precise static types for downstream injector
 *   lookups while keeping a single runtime instance.
 * - `Name` -- the string-literal type of this module's own name, preserved
 *   so that callers can statically track identity across the builder chain
 *   and so `createInjector` can reject references to unknown modules at
 *   compile time.
 * - `Requires` -- the readonly-tuple type of this module's declared
 *   dependencies, preserved for the same reason.
 */

export class Module<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{}` (not `Record<string, never>`) is the correct "empty registry" starting type: its `keyof` is `never`, which lets the typed-factory overloads reject dep names against newly-added literal keys. `Record<string, never>` has a wide `string` index signature that swallows literal keys and breaks `Module` subtype variance between the class and `AnyModule`.
  Registry extends Record<string, unknown> = {},
  Name extends string = string,
  Requires extends readonly string[] = readonly string[],
> {
  /** The unique name of this module within the module registry. */
  readonly name: Name;

  /** Names of other modules this module depends on. */
  readonly requires: Requires;

  /**
   * Queue of pending registrations accumulated by calls to `value`, `constant`,
   * and `factory`. The injector drains this queue during its load phase.
   */
  readonly invokeQueue: InvokeQueueEntry[];

  constructor(name: Name, requires: Requires) {
    this.name = name;
    this.requires = requires;
    this.invokeQueue = [];
  }

  /**
   * Register a plain value under `name`. The registration is appended to
   * {@link invokeQueue} as `['value', name, value]` and actually materialized
   * when an injector drains the queue. Returns the same module instance with
   * its `Registry` type widened to include the new entry.
   *
   * @param name - The name to register the value under.
   * @param value - The value to associate with `name`.
   */
  value<K extends string, T>(name: K, value: T): Module<Registry & { [P in K]: T }, Name, Requires> {
    this.invokeQueue.push(['value', name, value]);
    return this as unknown as Module<Registry & { [P in K]: T }, Name, Requires>;
  }

  /**
   * Register a constant under `name`. Constants are semantically identical to
   * values for the module-loading phase; the injector distinguishes them at
   * drain time. The registration is appended to {@link invokeQueue} as
   * `['constant', name, value]`. Returns the same module instance with its
   * `Registry` type widened to include the new entry.
   *
   * @param name - The name to register the constant under.
   * @param value - The constant value to associate with `name`.
   */
  constant<K extends string, T>(name: K, value: T): Module<Registry & { [P in K]: T }, Name, Requires> {
    this.invokeQueue.push(['constant', name, value]);
    return this as unknown as Module<Registry & { [P in K]: T }, Name, Requires>;
  }

  /**
   * Register a factory function under `name`. The factory will be called by the
   * injector to produce the service instance, with its declared dependencies
   * resolved and passed in. The factory is a {@link Invokable} — either an
   * array-style annotation `['dep1', 'dep2', fn]` or a function with a
   * `$inject` property. Unlike `value` and `constant`, which store the literal
   * argument, `factory` registrations are lazy: the function runs only when
   * the service is first requested, and the result is cached as a singleton.
   *
   * `Return` is inferred from the trailing function of the supplied invokable
   * so that `injector.get(name)` resolves to the factory's actual return type
   * without any explicit annotation. Callers may still provide `Return`
   * explicitly (e.g. `.factory<'svc', MyShape>(...)`) as an escape hatch.
   *
   * Note: the compile-time typed overloads that validate dep names against
   * this module's `Registry` live on {@link TypedModule}, not on the class.
   * `createModule` returns the same runtime instance cast to `TypedModule`,
   * which is where callers get the typed `.factory(...)` experience. Keeping
   * the class signature wide here preserves the covariance of `Module` in
   * `Registry`, which `AnyModule` and `createInjector` rely on.
   *
   * @param name - The name to register the factory under.
   * @param invokable - The factory, as an array-style annotation or an
   *   `$inject`-annotated function.
   */
  factory<K extends string, Return>(
    name: K,
    invokable: Invokable<Return>,
  ): Module<Registry & { [P in K]: Return }, Name, Requires> {
    this.invokeQueue.push(['factory', name, invokable]);
    return this as unknown as Module<Registry & { [P in K]: Return }, Name, Requires>;
  }
}

/**
 * Typed builder view of a {@link Module}, returned by {@link createModule}.
 *
 * At runtime this is exactly the same object as the underlying `Module` class
 * instance. At the type level it overlays three additional `factory` overloads
 * that validate dependency names against this module's own `Registry`:
 *
 * 1. **Array-style with typed deps** — each leading entry is constrained to
 *    `keyof Registry & string`, and the trailing callback's parameters are
 *    inferred from {@link ResolveDeps}. When every dep is a registered
 *    literal key, the callback arguments come back typed; when some dep is
 *    unknown to the local registry, the overload falls through to #3 below
 *    (see the typo-detection note on the overload itself).
 * 2. **`$inject`-annotated with typed deps** — the function's `$inject`
 *    property must be a `readonly` literal tuple of `keyof Registry & string`
 *    entries. Users must annotate `$inject` with `as const` (or a readonly
 *    tuple type) so TypeScript sees the literal dep names.
 * 3. **Untyped fallback** — the original `Invokable<Return>` signature,
 *    preserved for backward compatibility with factories that reference deps
 *    from transitively-required modules, factories whose `$inject` is a wider
 *    `string[]`, and existing call sites that explicitly annotate
 *    `.factory<'name', Shape>(...)`.
 *
 * The typed overloads live on this interface rather than on the class itself
 * because adding Registry-dependent parameter types to a class method puts
 * `Registry` in a contravariant position on the method. That breaks the
 * covariant subtype relationship `Module<A> <: Module<B>` when `A <: B`,
 * which `AnyModule` and `createInjector` rely on. Keeping the typed overloads
 * on `TypedModule` sidesteps the variance conflict: the interface extends the
 * class instance side but never participates in the `AnyModule` widening
 * check — the cast to `AnyModule` goes through the bare `Module` class.
 */
export interface TypedModule<
  Registry extends Record<string, unknown>,
  Name extends string,
  Requires extends readonly string[],
> extends Module<Registry, Name, Requires> {
  value<const K extends string, T>(name: K, value: T): TypedModule<Registry & { [P in K]: T }, Name, Requires>;

  constant<const K extends string, T>(name: K, value: T): TypedModule<Registry & { [P in K]: T }, Name, Requires>;

  /**
   * Array-style factory with deps validated against `Registry`. Each leading
   * entry must be a literal key of the current `Registry`, and the trailing
   * callback's parameters are inferred from {@link ResolveDeps} — so each
   * callback argument is typed from the earlier `value` / `constant` /
   * `factory` registration on this module.
   *
   * **Typo detection limitation.** When a dep name is a typo (or a name that
   * lives on a transitively-required module), this overload silently fails
   * to match and call sites fall through to the untyped fallback overload
   * below. TypeScript's overload resolution is "first success wins", so the
   * constraint error on this overload does not surface. Typed param inference
   * still works for valid cases; typo detection via the type system would
   * require a different, more invasive design and is intentionally out of
   * scope here.
   */
  factory<const K extends string, const Deps extends readonly (keyof Registry & string)[], Return>(
    name: K,
    invokable: readonly [...Deps, (...args: ResolveDeps<Registry, Deps>) => Return],
  ): TypedModule<Registry & { [P in K]: Return }, Name, Requires>;

  /**
   * `$inject`-annotated factory with deps validated against `Registry`. The
   * function's `$inject` property must be a `readonly` literal tuple whose
   * entries are keys of `Registry`; the function's parameters are validated
   * against {@link ResolveDeps}.
   */
  factory<const K extends string, const Inject extends readonly (keyof Registry & string)[], Return>(
    name: K,
    invokable: ((...args: ResolveDeps<Registry, Inject>) => Return) & { $inject: Inject },
  ): TypedModule<Registry & { [P in K]: Return }, Name, Requires>;

  /**
   * Untyped fallback — used when deps can't be validated statically (e.g.
   * cross-module deps from a `requires` dependency, wide `string[]` `$inject`
   * properties, or explicit `.factory<'name', Shape>(...)` return annotations).
   */
  factory<K extends string, Return>(
    name: K,
    invokable: Invokable<Return>,
  ): TypedModule<Registry & { [P in K]: Return }, Name, Requires>;
}

/**
 * Create a new {@link Module} and register it in the module-scoped registry.
 *
 * Creating a module with the same name as an existing module replaces the
 * previous registration.
 *
 * The `const` modifier on the type parameters forces TypeScript to infer
 * string-literal and tuple-literal types for `name` and `requires` instead of
 * widening them to `string` / `readonly string[]`. This is what enables
 * compile-time verification of the module dependency graph.
 *
 * @param name - Unique name for the module within the registry.
 * @param requires - Names of other modules this module depends on. Defaults
 *   to an empty array when no dependencies are required.
 */
export function createModule<const TName extends string, const TRequires extends readonly string[] = readonly []>(
  name: TName,
  requires: TRequires = [] as unknown as TRequires,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see note on the `Module` class declaration for why `{}` is the correct empty-registry starting type.
): TypedModule<{}, TName, TRequires> {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see above.
  const module = new Module<{}, TName, TRequires>(name, requires);
  registry.set(name, module as unknown as AnyModule);
  // Cast through `unknown` to expose the same runtime instance under the
  // typed-factory `TypedModule` view. The underlying `Module` class method is
  // untyped (for variance reasons — see the class's `factory` JSDoc); the
  // typed overloads live on `TypedModule` and are applied only from this
  // public entry point.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- see above.
  return module as unknown as TypedModule<{}, TName, TRequires>;
}

/**
 * Retrieve a previously-registered module by name.
 *
 * Because the registry is a runtime `Map<string, AnyModule>`, there is no way
 * for TypeScript to automatically infer a specific module's typed shape from
 * just a string lookup. Two usage modes are supported:
 *
 * **Dynamic (default):**
 *
 * ```ts
 * const mod = getModule('app'); // typed as AnyModule
 * ```
 *
 * **Typed via witness:** Supply an explicit type argument `M` — typically
 * `typeof someKnownModule`. The `name` parameter is then constrained to that
 * module's own `Name` literal, so typos become compile errors. The cast is
 * checked by TypeScript against the registry entry at the call site, so it is
 * safe as long as the witness type actually matches what was registered.
 *
 * ```ts
 * const app = createModule('app', ['common']).value('apiUrl', 'https://...');
 * // Later, from somewhere without direct access to `app`:
 * const sameApp = getModule<typeof app>('app'); // fully typed
 * const typo    = getModule<typeof app>('apx'); // compile error
 * ```
 *
 * When a typed reference is already in scope, prefer using it directly instead
 * of going through `getModule`.
 *
 * @param name - Name of the module to look up.
 * @throws {Error} with message `Module not found: <name>` when no module with
 *   the given name has been registered.
 */
export function getModule<M extends AnyModule = AnyModule>(name: M['name']): M {
  const module = registry.get(name);
  if (module === undefined) {
    throw new Error(`Module not found: ${name}`);
  }
  return module as M;
}

/**
 * Clear the module registry. Intended for use in test setup hooks
 * (`beforeEach(() => resetRegistry())`) to guarantee isolation between tests
 * that exercise the shared module registry.
 */
export function resetRegistry(): void {
  registry.clear();
}
