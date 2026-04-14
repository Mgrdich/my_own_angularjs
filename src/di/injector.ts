/**
 * Injector factory for the Dependency Injection module.
 *
 * Slice 4 scope: supports `value`, `constant`, and `factory` recipes, and
 * walks the module dependency graph. `createInjector` recursively loads
 * each module's `requires` from the module registry before draining its
 * own `invokeQueue`, tracking loaded module names in a `Set<string>` so
 * that shared, diamond, and circular module-level dependencies are each
 * loaded at most once. Factory entries are stored as unresolved invokables
 * at load time and invoked lazily on the first `get(name)` call, with
 * their results cached as singletons. `invoke`/`annotate` remain stubs
 * until Slice 5.
 */

import { isArray } from '@core/utils';

import { annotate as annotateInvokable } from './annotate';
import type { Injector, Invokable } from './di-types';
import { getModule, type AnyModule, type Module, type TypedModule } from './module';

/**
 * Extract the `Registry` type parameter from a concrete {@link Module} or
 * {@link TypedModule} type. The `TypedModule` branch is tried first because
 * `createModule` returns that typed view; `TypedModule<R, ...>` structurally
 * also extends `Module<R, ...>`, but the extra factory overloads on
 * `TypedModule` can confuse single-pattern inference in some cases, so we
 * match it explicitly. Resolves to `never` when the input is neither, which
 * keeps it safe inside a distributive conditional type.
 */
type ExtractRegistry<M> =
  M extends TypedModule<infer R, string, readonly string[]> ? R : M extends Module<infer R> ? R : never;

/**
 * Convert a union type `U` into the intersection of all its members.
 *
 * Implementation note: wrapping `U` in a contravariant position
 * (`(x: U) => void`) and then inferring back out of that position forces
 * TypeScript to collapse the distributed union into a single intersection.
 * This is the standard trick for union-to-intersection conversion and is the
 * only way to combine an unknown number of module registries at the type
 * level without recursive conditional types.
 */
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/**
 * Given a tuple of {@link Module} instances, produce an intersection of all
 * their `Registry` type parameters.
 *
 * Used by {@link createInjector} to build a single typed registry from
 * multiple input modules so that `injector.get(name)` is typed against the
 * union of every registered service across all input modules.
 *
 * The result is constrained to `Record<string, unknown>` so it satisfies the
 * shape expected by the {@link Injector} interface even in the edge case of
 * an empty `Mods` tuple (where the intersection collapses to `unknown`).
 */
export type MergeRegistries<Mods extends readonly AnyModule[]> =
  UnionToIntersection<ExtractRegistry<Mods[number]>> extends infer R
    ? R extends Record<string, unknown>
      ? R
      : Record<string, never>
    : Record<string, never>;

/**
 * Build a typed {@link Injector} from a tuple of module instances.
 *
 * Slice 3 behavior: for every input module, the injector performs a
 * post-order walk of the module dependency graph. Each module in
 * `module.requires` is looked up in the module registry via {@link getModule}
 * and loaded recursively before the enclosing module's own `invokeQueue` is
 * drained. A `Set<string>` of already-loaded module names guards the walk so
 * that:
 *
 * - **Shared dependencies** (two modules depending on the same third) load
 *   the shared module exactly once.
 * - **Diamond dependencies** (A -> {B, C} -> D) load `D` exactly once.
 * - **Circular module-level dependencies** (A -> B -> A) terminate on the
 *   second visit instead of recursing forever.
 *
 * Dependencies are loaded before their dependents so that when `factory`
 * entries begin resolving their own dependencies in Slice 4, every name they
 * reference is already registered in the provider cache.
 *
 * The return type `Injector<MergeRegistries<Mods>>` lets TypeScript infer
 * the registered service types from the input module tuple, so
 * `injector.get('apiUrl')` resolves to the exact type recorded by the
 * corresponding `module.value('apiUrl', ...)` call at compile time. A
 * fallback `get<T>(name: string): T` overload on the {@link Injector}
 * interface provides an escape hatch for dynamic-name lookups.
 *
 * **Compile-time vs. runtime dependency tracking.** At runtime the injector
 * auto-walks `requires`, so callers only need to pass the root module(s) they
 * care about. At compile time, however, `MergeRegistries<Mods>` only sees the
 * modules that were passed explicitly -- transitively-loaded modules are not
 * reflected in the resulting `Injector`'s static registry. Lookups for names
 * registered on a transitive module therefore fall through to the dynamic
 * `get<T>(name: string): T` escape hatch and must supply their own type
 * argument. Tightening this to full compile-time transitive tracking is a
 * future concern; it is deliberately out of scope for Slice 3.
 *
 * @param modules - Tuple of module instances whose registrations should be
 *   drained into the returned injector. Any modules referenced transitively
 *   through `requires` are resolved automatically via the module registry.
 * @throws {Error} with message `Module not found: <name>` when a `requires`
 *   entry references a module that is not present in the registry.
 */
export function createInjector<const Mods extends readonly AnyModule[]>(
  modules: Mods,
): Injector<MergeRegistries<Mods>> {
  const providerCache = new Map<string, unknown>();
  const factoryInvokables = new Map<string, Invokable>();
  const loadedModules = new Set<string>();
  // Stack of names currently being resolved by `get`. When a factory
  // (transitively) requests a name already on the stack we have a service-
  // level circular dependency; we surface the full chain in the error
  // message so callers can see exactly which services form the cycle. The
  // stack is push/pop-balanced via `try/finally` so a thrown dependency
  // does not leak stale entries into later lookups.
  const resolutionPath: string[] = [];

  /**
   * Recursively load `mod` and everything it transitively requires. The
   * traversal is post-order: dependencies are drained into `providerCache`
   * before the enclosing module's own queue, which matches AngularJS's
   * behavior and ensures that Slice 4 factories will find their dependencies
   * already resolved. The `loadedModules` set makes the walk idempotent on a
   * per-module-name basis, which also breaks any cycles at the module graph
   * level.
   */
  function loadModule(mod: AnyModule): void {
    if (loadedModules.has(mod.name)) {
      return;
    }
    loadedModules.add(mod.name);

    for (const requiredName of mod.requires) {
      // `getModule` throws `Module not found: <name>` when the registry has
      // no entry, which is exactly the error contract this function wants to
      // propagate, so we deliberately let it bubble up unchanged.
      const required = getModule(requiredName);
      loadModule(required);
    }

    for (const [recipe, name, value] of mod.invokeQueue) {
      if (recipe === 'value' || recipe === 'constant') {
        providerCache.set(name, value);
      } else {
        // `recipe` narrows to `'factory'` here -- it is the only remaining
        // member of `RecipeType`. Factories are lazy: stash the invokable
        // now and invoke it on the first `get(name)` call. The invoke-queue
        // entry's `value` slot holds the raw `Invokable` passed to
        // `module.factory(name, invokable)`.
        factoryInvokables.set(name, value as Invokable);
      }
    }
  }

  for (const module of modules) {
    loadModule(module);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- caller-provided type for dynamic-name escape hatch; the typed `Injector.get` overload relies on this signature.
  function get<T>(name: string): T {
    if (providerCache.has(name)) {
      return providerCache.get(name) as T;
    }
    if (factoryInvokables.has(name)) {
      // Circular dependency detection: if `name` is already on the resolution
      // stack, a factory higher up the call chain (transitively) asked for a
      // service that is still pending. Build a right-to-left chain of the
      // pending names followed by `name` itself so the error shows the full
      // cycle (e.g. `A <- B <- A`). The chain reads "A is waiting on B, which
      // is waiting on A" -- the `<-` arrows point from the waiter to what it
      // is waiting on.
      if (resolutionPath.includes(name)) {
        const chain = [...resolutionPath, name].join(' <- ');
        throw new Error(`Circular dependency: ${chain}`);
      }

      const invokable = factoryInvokables.get(name);
      if (invokable === undefined) {
        // Defensive: `Map.has` just said yes, so this branch is only reachable
        // if an `undefined` was somehow stored under `name`. Treat it the
        // same as an unregistered provider rather than silently returning.
        throw new Error(`Unknown provider: ${name}`);
      }

      resolutionPath.push(name);
      try {
        const deps = annotateInvokable(invokable);
        const resolvedDeps = deps.map((depName) => get(depName));
        const fn = isArray(invokable)
          ? (invokable[invokable.length - 1] as (...args: unknown[]) => unknown)
          : (invokable as unknown as (...args: unknown[]) => unknown);
        const result = fn(...resolvedDeps);
        providerCache.set(name, result);
        // Now that the result is cached, the invokable is no longer pending
        // and can be dropped from the factory map. Deleting *after* caching
        // (rather than before resolving) is what lets the `resolutionPath`
        // check above see the entry on re-entry and report a proper cycle.
        factoryInvokables.delete(name);
        return result as T;
      } finally {
        resolutionPath.pop();
      }
    }
    throw new Error(`Unknown provider: ${name}`);
  }

  function has(name: string) {
    return providerCache.has(name) || factoryInvokables.has(name);
  }

  function invoke<Return>(fn: Invokable<Return>, self?: unknown, locals?: Record<string, unknown>): Return {
    const deps = annotateInvokable(fn);
    const resolvedDeps = deps.map((depName) => {
      // `hasOwnProperty.call` rather than `locals[depName] !== undefined` so
      // that callers can explicitly pass `undefined` as an override value
      // without it silently falling through to the injector lookup.
      if (locals !== undefined && Object.prototype.hasOwnProperty.call(locals, depName)) {
        return locals[depName];
      }
      return get(depName);
    });

    const actualFn = isArray(fn)
      ? (fn[fn.length - 1] as (...args: unknown[]) => unknown)
      : (fn as unknown as (...args: unknown[]) => unknown);

    return actualFn.apply(self, resolvedDeps) as Return;
  }

  /**
   * Delegate to the shared `annotate` helper to extract the dependency name
   * list from an {@link Invokable}. Exposed on the injector so that consumers
   * (e.g. test harnesses, higher-level APIs) can inspect an invokable's
   * declared dependencies without importing the helper directly.
   */
  function annotate(fn: Invokable): readonly string[] {
    return annotateInvokable(fn);
  }

  // The `get` local is typed as the dynamic-name overload `<T>(name: string) => T`.
  // The public `Injector<Registry>` interface exposes a second, registry-keyed
  // overload that narrows the return type at call sites. Both overloads share
  // the same runtime implementation, so we widen through `unknown` here rather
  // than duplicating the overload signatures on the local function expression.
  return {
    get,
    has,
    invoke,
    annotate,
  };
}
