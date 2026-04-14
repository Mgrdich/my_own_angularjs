/**
 * Injector factory for the Dependency Injection module.
 *
 * Slice 4 scope: supports `value`, `constant`, and `factory` recipes, and
 * walks the module dependency graph. `createInjector` recursively loads
 * each module's `requires` from the module registry before draining its
 * own `$$invokeQueue`, tracking loaded module names in a `Set<string>` so
 * that shared, diamond, and circular module-level dependencies are each
 * loaded at most once. Factory entries are stored as unresolved invokables
 * at load time and invoked lazily on the first `get(name)` call, with
 * their results cached as singletons. `invoke`/`annotate` remain stubs
 * until Slice 5.
 */

import { isArray, isFunction } from '@core/utils';

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
  M extends TypedModule<infer R, Record<string, unknown>, string, readonly string[]>
    ? R
    : M extends Module<infer R, Record<string, unknown>>
      ? R
      : never;

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
 * and loaded recursively before the enclosing module's own `$$invokeQueue` is
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
  // Service constructors registered via `module.service(name, Ctor)`. Stored
  // as raw `Invokable`s (either a bare constructor or a `[...deps, Ctor]`
  // array) and instantiated lazily on first `get(name)` via `new Ctor(...)`.
  // Mirrors `factoryInvokables` so services participate in the same lazy
  // resolution, cycle detection, and singleton caching machinery.
  const serviceCtors = new Map<string, Invokable>();
  // Provider instances — one per `provider('name', ...)` registration.
  // Keyed by the `<name>Provider` form (e.g. 'loggerProvider'), these are
  // the configurable objects that config blocks inject and mutate before
  // the run phase drains `$get` to produce the final service.
  const providerInstances = new Map<string, unknown>();
  // Lazy `$get` invokables — one per `provider('name', ...)` registration.
  // Keyed by the service name (e.g. 'logger'), these are the unresolved
  // `$get` functions that the run-phase `get` will invoke with the correct
  // `this` binding once the service is first requested. The `providerInstance`
  // slot carries the matching provider instance so `$get.apply(providerInstance, deps)`
  // can be used.
  const providerGetInvokables = new Map<string, { invokable: Invokable; providerInstance: unknown }>();
  const loadedModules = new Set<string>();
  // Stack of names currently being resolved by `get`. When a factory
  // (transitively) requests a name already on the stack we have a service-
  // level circular dependency; we surface the full chain in the error
  // message so callers can see exactly which services form the cycle. The
  // stack is push/pop-balanced via `try/finally` so a thrown dependency
  // does not leak stale entries into later lookups.
  const resolutionPath: string[] = [];

  /**
   * Normalize a provider registration to a provider instance + lazy `$get`
   * invokable. Handles all three registration forms:
   *
   * 1. **Array-style** `[...deps, Ctor]` — instantiate `Ctor` via the
   *    config-phase injector so its dependencies resolve from the current
   *    `providerCache` and `providerInstances`. The resulting object is
   *    the provider instance.
   * 2. **Constructor function** — call `new Ctor()` directly (no deps).
   * 3. **Object literal** — use the value directly as the provider instance.
   *
   * Throws with a clear error if the source is none of these forms or if
   * the resulting instance has no `$get` method.
   */
  function loadProvider(name: string, providerSource: unknown): void {
    let providerInstance: { $get: Invokable };

    if (isArray(providerSource)) {
      // Form 3: array-style `[...deps, Ctor]`. Resolve deps via the
      // config-phase injector so that providers can depend on constants and
      // on other providers (via their `<name>Provider` key). We can't route
      // through `providerInjector.invoke` because that calls the trailing
      // function with `.apply(self, resolvedDeps)` — we need `new Ctor(...)`.
      //
      // `isArray` narrows a `T | readonly unknown[]` input to the
      // array-shaped subtype via `Extract`, which collapses to `never`
      // when the input is plain `unknown`, so we hold on to a separately
      // typed alias of the source before indexing into it.
      const providerArray = providerSource as readonly unknown[];
      const deps = annotateInvokable(providerArray as unknown as Invokable);
      const resolvedDeps = deps.map((depName) => providerInjector.get(depName));
      const Ctor = providerArray[providerArray.length - 1] as new (...args: unknown[]) => unknown;
      providerInstance = new Ctor(...resolvedDeps) as { $get: Invokable };
    } else if (isFunction(providerSource)) {
      // Form 1: bare constructor function with no deps.
      const Ctor = providerSource as unknown as new () => unknown;
      providerInstance = new Ctor() as { $get: Invokable };
    } else if (providerSource !== null && typeof providerSource === 'object' && '$get' in providerSource) {
      // Form 2: object literal with a `$get` method.
      providerInstance = providerSource as { $get: Invokable };
    } else {
      throw new Error(`Expected provider for "${name}" to be a function, array, or object with $get`);
    }

    // All three forms must produce an instance with a `$get` method. Form 2
    // is pre-checked by the `'$get' in providerSource` guard, but Form 1 and
    // Form 3 may construct an object that omits `$get` (e.g. a constructor
    // that forgets to assign it), so re-validate here as the single choke
    // point for the error message. TypeScript already believes `$get` is
    // present on `providerInstance` (we annotated it that way to keep the
    // rest of the function honest), so we widen through `unknown` to run
    // the runtime check without tripping `no-unnecessary-condition`.
    if ((providerInstance as { $get?: unknown }).$get === undefined) {
      throw new Error(`Provider "${name}" has no $get method`);
    }

    // Register the instance under its `<name>Provider` key so config blocks
    // can inject and mutate it. Stash `$get` (with its owning provider
    // instance as the `this` binding) into the lazy invocation map so a
    // later sub-task can wire the run-phase `get` to materialize the final
    // service singleton from it.
    providerInstances.set(`${name}Provider`, providerInstance);
    providerGetInvokables.set(name, {
      invokable: providerInstance.$get,
      providerInstance,
    });
  }

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

    for (const [recipe, name, value] of mod.$$invokeQueue) {
      if (recipe === 'value' || recipe === 'constant') {
        providerCache.set(name, value);
      } else if (recipe === 'factory') {
        // Factories are lazy: stash the invokable now and invoke it on the
        // first `get(name)` call. The invoke-queue entry's `value` slot holds
        // the raw `Invokable` passed to `module.factory(name, invokable)`.
        factoryInvokables.set(name, value as Invokable);
      } else if (recipe === 'service') {
        // Services are also lazy: stash the constructor now and `new`-it on
        // the first `get(name)` call. The invoke-queue entry's `value` slot
        // holds the raw `Invokable` passed to `module.service(name, invokable)`,
        // which can be either a bare constructor or a `[...deps, Ctor]`
        // array-style annotation.
        serviceCtors.set(name, value as Invokable);
      } else {
        // `recipe` narrows to `'provider'` here -- the only remaining member
        // of `RecipeType`. Normalize the registration source (Form 1/2/3)
        // into a provider instance and extract its `$get` invokable. This
        // runs eagerly so that later providers in the same invoke queue can
        // depend on earlier ones via the config-phase injector.
        loadProvider(name, value);
      }
    }
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
    if (serviceCtors.has(name)) {
      // Service resolution mirrors the factory branch above: same cycle
      // detection via `resolutionPath`, same recursive dependency walk via
      // `annotateInvokable` + `get`, same singleton caching in
      // `providerCache`. The only runtime difference is that the producer is
      // invoked with `new Ctor(...deps)` instead of `fn(...deps)` so the
      // constructed instance -- not its return value -- becomes the service.
      if (resolutionPath.includes(name)) {
        const chain = [...resolutionPath, name].join(' <- ');
        throw new Error(`Circular dependency: ${chain}`);
      }

      const invokable = serviceCtors.get(name);
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
        // For array-style `[...deps, Ctor]` the constructor is the last
        // element; for a bare annotated constructor the invokable *is* the
        // constructor. Both paths end up calling `new Ctor(...resolvedDeps)`.
        const Ctor = isArray(invokable)
          ? (invokable[invokable.length - 1] as unknown as new (...args: unknown[]) => unknown)
          : (invokable as unknown as new (...args: unknown[]) => unknown);
        const result = new Ctor(...resolvedDeps);
        providerCache.set(name, result);
        // Drop the pending constructor *after* caching so that a re-entry
        // during dependency resolution hits the `resolutionPath` check above
        // and reports a proper cycle instead of silently re-constructing.
        serviceCtors.delete(name);
        return result as T;
      } finally {
        resolutionPath.pop();
      }
    }
    if (providerGetInvokables.has(name)) {
      // Provider-backed services resolve their final value by invoking the
      // stashed `$get` invokable against its owning provider instance. The
      // branch mirrors the factory/service branches: same `resolutionPath`
      // cycle detection, same recursive dependency walk, same singleton
      // caching in `providerCache`. The two provider-specific wrinkles are
      // (1) `$get` is called with `.apply(providerInstance, ...)` so inner
      // references to `this.level`, `this.config`, etc. resolve against the
      // configured provider, and (2) the pending entry is deleted from
      // `providerGetInvokables` once the result is cached so later lookups
      // fall through to the `providerCache.has` fast path.
      if (resolutionPath.includes(name)) {
        const chain = [...resolutionPath, name].join(' <- ');
        throw new Error(`Circular dependency: ${chain}`);
      }

      const entry = providerGetInvokables.get(name);
      if (entry === undefined) {
        // Defensive: `Map.has` just said yes, so this branch is only reachable
        // if an `undefined` was somehow stored under `name`. Treat it the
        // same as an unregistered provider rather than silently returning.
        throw new Error(`Unknown provider: ${name}`);
      }

      resolutionPath.push(name);
      try {
        const { invokable, providerInstance } = entry;
        const deps = annotateInvokable(invokable);
        const resolvedDeps = deps.map((depName) => get(depName));
        // For array-style `[...deps, $get]` the actual `$get` function is the
        // last element; for a bare function the invokable *is* `$get`. Both
        // paths end up calling `.apply(providerInstance, resolvedDeps)` to
        // bind `this` to the provider instance so AngularJS-style references
        // like `this.level` inside `$get` continue to work.
        const getFn = isArray(invokable)
          ? (invokable[invokable.length - 1] as (...args: unknown[]) => unknown)
          : (invokable as unknown as (...args: unknown[]) => unknown);
        const result = getFn.apply(providerInstance, resolvedDeps);
        providerCache.set(name, result);
        // Drop the pending `$get` entry *after* caching so that a re-entry
        // during dependency resolution hits the `resolutionPath` check above
        // and reports a proper cycle instead of silently re-invoking `$get`.
        providerGetInvokables.delete(name);
        return result as T;
      } finally {
        resolutionPath.pop();
      }
    }
    throw new Error(`Unknown provider: ${name}`);
  }

  function has(name: string) {
    return (
      providerCache.has(name) ||
      factoryInvokables.has(name) ||
      serviceCtors.has(name) ||
      providerGetInvokables.has(name)
    );
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

  // ==================================================================
  // Config-phase injector facade
  // ==================================================================
  //
  // The provider injector runs during the config phase (before any service
  // is instantiated). It has a strict, whitelisted view of the registry:
  //
  //   - `providerCache` for constants and values already drained by
  //     `loadModule` (constants are the only recipe registered eagerly
  //     and usable in both phases).
  //   - `providerInstances` for provider instances registered under
  //     their `<name>Provider` key via the `provider` recipe.
  //
  // Services (`factory`, `service`, and provider-produced services) are
  // NOT visible during the config phase — attempting to inject them is
  // a clear error. Run blocks get the full run-phase injector instead.

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- caller-provided return type; mirrors the run-phase `get`
  function providerGet<T = unknown>(name: string): T {
    if (providerCache.has(name)) {
      return providerCache.get(name) as T;
    }
    if (providerInstances.has(name)) {
      return providerInstances.get(name) as T;
    }
    // If the name is a known service, give a helpful hint.
    if (factoryInvokables.has(name) || serviceCtors.has(name) || providerGetInvokables.has(name)) {
      throw new Error(`Cannot inject "${name}" during config phase; use "${name}Provider" instead`);
    }
    throw new Error(`Unknown provider: ${name}`);
  }

  function providerHas(name: string): boolean {
    return providerCache.has(name) || providerInstances.has(name);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- caller-provided return type; mirrors the run-phase `invoke`
  function providerInvoke<T = unknown>(fn: Invokable, self?: unknown, locals?: Record<string, unknown>): T {
    const deps = annotateInvokable(fn);
    const resolvedDeps = deps.map((depName) => {
      if (locals !== undefined && Object.prototype.hasOwnProperty.call(locals, depName)) {
        return locals[depName];
      }
      return providerGet(depName);
    });
    const actualFn = isArray(fn)
      ? (fn[fn.length - 1] as (...args: unknown[]) => unknown)
      : (fn as unknown as (...args: unknown[]) => unknown);
    return actualFn.apply(self, resolvedDeps) as T;
  }

  function providerAnnotate(fn: Invokable): readonly string[] {
    return annotateInvokable(fn);
  }

  const providerInjector: Injector = {
    get: providerGet,
    has: providerHas,
    invoke: providerInvoke,
    annotate: providerAnnotate,
  };
  // `providerInjector` is intentionally NOT returned from `createInjector`.
  // It's used internally by `loadProvider` (to resolve array-style provider
  // deps during the config phase) and will later drive config blocks.

  // Drain modules *after* `providerInjector` is declared. `loadProvider`
  // closes over `providerInjector` to resolve array-style provider deps
  // during the config phase, so invoking `loadModule` earlier would trip
  // the `const`'s temporal dead zone. The recipe storage maps
  // (`providerCache`, `factoryInvokables`, `serviceCtors`,
  // `providerInstances`, `providerGetInvokables`) are all declared at the
  // top of `createInjector` and are safe to mutate from here.
  for (const module of modules) {
    loadModule(module);
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
