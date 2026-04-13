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
  Registry extends Record<string, unknown> = Record<string, never>,
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
): Module<Record<string, never>, TName, TRequires> {
  const module = new Module<Record<string, never>, TName, TRequires>(name, requires);
  registry.set(name, module as unknown as AnyModule);
  return module;
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
